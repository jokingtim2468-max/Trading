#!/usr/bin/env python3
"""QuantBot Train: fine-tunes a small open model with Unsloth to predict each day's high and low from the days before.

Runs inside Unsloth's Docker image (QuantBot starts it from the Train page):

    python qb_train.py <job folder>      # reads <job>/config.json, writes events, the adapter and result.json

or one step at a time: `prepare` (no GPU needed), `train`, `evaluate`. Every step prints one JSON object per line
({"type": "progress" | "log" | "metric" | "done" | "error", ...}); QuantBot reads them for the live view.

The task, for every trading day: given the last 10 days (each day's move from its open to its high, low and close,
in % of price) and today's opening gap, answer {"high": <% from today's open to today's high>, "low": <% to the low>}.
Training days and test days come from separate date ranges, so the test is on days the model never saw. The result
compares the model with a simple guess (today's open +/- half the 20-day average range).
"""
import csv
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

CONTEXT_DAYS = 10
# Used when the config has no hf_id (QuantBot always sends hf_id and load_in_4bit)
MODELS = {
    "qwen3.5-0.8b": ("unsloth/Qwen3.5-0.8B", False),
    "qwen3.5-2b": ("unsloth/Qwen3.5-2B", False),
    "qwen3-4b-4bit": ("unsloth/Qwen3-4B-unsloth-bnb-4bit", True),
}


def text_tokenizer(tok):
    """Vision-language models (Qwen3.5, Gemma 3, ...) come with a processor that reads its first argument as images;
    this training is text only, so use the processor's own text tokenizer."""
    return getattr(tok, "tokenizer", None) or tok


def model_of(cfg):
    """(weights to load: a Hugging Face id or /workspace/model, load in 4-bit)"""
    if cfg.get("hf_id"):
        return cfg["hf_id"], bool(cfg.get("load_in_4bit"))
    return MODELS[cfg.get("model", "qwen3.5-2b")]


def emit(kind, **data):
    print(json.dumps({"type": kind, "time": time.time(), **data}), flush=True)


# ---------- Data

def read_bars(path):
    """MT5 export (<DATE> <TIME> ... tab separated) or QuantBot's CSV (time,open,high,low,close[,volume])."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        first = f.readline()
        f.seek(0)
        if first.startswith("<DATE>"):
            rd = csv.reader(f, delimiter="\t")
            next(rd)
            for r in rd:
                if len(r) < 6:
                    continue
                t = datetime.strptime(f"{r[0]} {r[1]}", "%Y.%m.%d %H:%M:%S")
                yield t, float(r[2]), float(r[3]), float(r[4]), float(r[5])
        else:
            rd = csv.DictReader(f)
            for r in rd:
                t = datetime.fromisoformat(r["time"].replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
                yield t, float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])


def daily(path):
    """Bars -> daily [date, open, high, low, close], weekdays only, in the file's own clock."""
    days = {}
    for t, o, h, l, c in read_bars(path):
        if t.weekday() >= 5:
            continue
        d = t.date()
        if d not in days:
            days[d] = [o, h, l, c]
        else:
            x = days[d]
            x[1] = max(x[1], h); x[2] = min(x[2], l); x[3] = c
    return [(d, *v) for d, v in sorted(days.items())]


def pct(a, b):
    return 100.0 * (a - b) / b


# What the model is told about each market, so one model learns them apart (NQ and US100 share the Nasdaq-100
# price feed, so they're one market here; MNQ is the same prices on a smaller contract)
MARKETS = {
    "XAUUSD": "Gold (XAUUSD, spot gold vs US dollar; MGC is its micro future)",
    "NQ": "Nasdaq-100 (NQ E-mini futures; US100 and MNQ trade the same prices)",
    "US100": "Nasdaq-100 (US100 index CFD; NQ and MNQ trade the same prices)",
}


def examples(days, market=None):
    """One example per day that has 250 days before it (20 days of context plus a year for the market profile).
    The profile only uses days before the forecast day, so nothing leaks from the answer."""
    name = MARKETS.get(market, market or "Gold (XAUUSD)")
    out = []
    for i in range(250, len(days)):
        d, o, h, l, c = days[i]
        prev_close = days[i - 1][4]
        ctx = []
        for k in range(CONTEXT_DAYS, 0, -1):
            _, po, ph, pl, pc = days[i - k]
            ctx.append(f"day-{k}: high {pct(ph, po):+.2f}% low {pct(pl, po):+.2f}% close {pct(pc, po):+.2f}%")
        rng = [pct(x[2], x[1]) - pct(x[3], x[1]) for x in days[i - 250:i]]  # (high-low) % of open
        avg20, avg250 = sum(rng[-20:]) / 20, sum(rng) / 250
        moves = [pct(days[j][4], days[j - 1][4]) for j in range(i - 249, i)]
        sd = math.sqrt(sum(m * m for m in moves) / len(moves))
        prompt = (f"{name} daily range forecast.\n"
                  f"Market profile (last year): average daily range {avg250:.2f}%, daily close-to-close moves {sd:.2f}% (1 sd).\n"
                  + "\n".join(ctx) +
                  f"\ntoday: {d.strftime('%A')}, gap from yesterday's close {pct(o, prev_close):+.2f}%, 20-day average range {avg20:.2f}%"
                  "\nAnswer with today's high and low as % from today's open.")
        answer = json.dumps({"high": round(pct(h, o), 2), "low": round(pct(l, o), 2)})
        out.append({"date": d.isoformat(), "market": market or "", "prompt": prompt, "answer": answer,
                    "high": pct(h, o), "low": pct(l, o), "guess": avg20 / 2})
    return out


def prepare(job, cfg):
    # One file per market (built-in data), or the trader's single file
    files = cfg.get("data_files") or {cfg.get("symbol") or "": cfg["data_file"]}
    tr, te, lines = [], [], []
    for market, path in files.items():
        days = daily(path)
        if len(days) < 300:
            raise SystemExit(f"Only {len(days)} trading days of {market or 'data'}; need at least 300")
        ex = examples(days, market or None)
        mtr = [e for e in ex if cfg["train_from"] <= e["date"] <= cfg["train_to"]]
        mte = [e for e in ex if cfg["test_from"] <= e["date"] <= cfg["test_to"]]
        tr += mtr; te += mte
        lines.append(f"{market or 'data'}: {len(days)} trading days {days[0][0]} to {days[-1][0]}: {len(mtr)} for training, {len(mte)} for the test")
    if not tr or not te:
        raise SystemExit("The train or test date range has no days in the data")
    tr.sort(key=lambda e: (e["date"], e["market"]))
    te.sort(key=lambda e: (e["date"], e["market"]))
    for name, rows in (("train", tr), ("test", te)):
        with open(os.path.join(job, f"{name}.jsonl"), "w") as f:
            for e in rows:
                f.write(json.dumps(e) + "\n")
    for m in lines:
        emit("log", message=m)
    studio_recipe(job, cfg, tr)
    return tr, te


def yaml_lines(d, indent=0):
    out = []
    for k, v in d.items():
        pad = "  " * indent
        if isinstance(v, dict):
            out += [f"{pad}{k}:"] + yaml_lines(v, indent + 1)
        elif isinstance(v, list):
            out += [f"{pad}{k}:"] + [f"{pad}  - {x}" for x in v]
        elif isinstance(v, bool):
            out.append(f"{pad}{k}: {'true' if v else 'false'}")
        else:
            out.append(f"{pad}{k}: {json.dumps(v) if isinstance(v, str) else v}")
    return out


def studio_recipe(job, cfg, rows):
    """The same run as an Unsloth Studio recipe: an alpaca-format dataset and a config YAML to Upload in Studio."""
    folder = os.path.join(job, "unsloth_studio")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "gold_daily_range.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps({"instruction": "Forecast today's gold (XAUUSD) high and low as % from today's open.",
                                "input": r["prompt"], "output": r["answer"]}) + "\n")
    hf_id, four_bit = model_of(cfg)
    recipe = {
        "model": {"name": hf_id, "method": "qlora" if four_bit else "lora", "type": "text"},
        "dataset": {"path": "gold_daily_range.jsonl", "format": "alpaca"},
        "training": {"max_steps": 0, "num_train_epochs": cfg["epochs"], "per_device_train_batch_size": cfg["batch_size"],
                     "gradient_accumulation_steps": cfg["grad_accum"], "learning_rate": cfg["learning_rate"],
                     "max_seq_length": cfg["max_seq_length"], "warmup_steps": 10, "weight_decay": 0.01, "optim": "adamw_8bit",
                     "lr_scheduler_type": "linear", "gradient_checkpointing": "unsloth", "seed": 3407,
                     "packing": False, "train_on_completions": True},
        "lora": {"r": cfg["lora_r"], "lora_alpha": cfg["lora_r"] * 2, "lora_dropout": 0.0,
                 "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]},
        "logging": {"report_to": "none", "logging_steps": 5},
    }
    short = (cfg.get("model_name") or cfg.get("model") or hf_id).split("/")[-1].lower().replace(" ", "-")
    name = f"{short}_{recipe['model']['method']}_gold-daily-range_{time.strftime('%Y%m%d-%H%M%S')}.yaml"
    with open(os.path.join(folder, name), "w") as f:
        f.write("# QuantBot recipe for Unsloth Studio: Upload this file on the training page, then pick the dataset next to it\n")
        f.write("\n".join(yaml_lines(recipe)) + "\n")
    emit("log", message=f"Unsloth Studio recipe written: unsloth_studio/{name}")


def load_rows(job, name):
    with open(os.path.join(job, f"{name}.jsonl")) as f:
        return [json.loads(x) for x in f]


# ---------- Training (Unsloth)

def template(prompt, answer=""):
    return f"### Question\n{prompt}\n### Answer\n{answer}"


def train(job, cfg):
    import torch
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from transformers import TrainerCallback
    from trl import SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        raise SystemExit("No NVIDIA GPU visible inside Docker: install the NVIDIA driver and run Docker Desktop with WSL 2 GPU support")
    hf_id, four_bit = model_of(cfg)
    emit("log", message=f"Loading {hf_id} on {torch.cuda.get_device_name(0)} ({torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GB)")
    model, tok = FastLanguageModel.from_pretrained(model_name=hf_id, max_seq_length=cfg["max_seq_length"],
                                                   load_in_4bit=four_bit, load_in_16bit=not four_bit, full_finetuning=False)
    tok = text_tokenizer(tok)
    model = FastLanguageModel.get_peft_model(model, r=cfg["lora_r"], lora_alpha=cfg["lora_r"], lora_dropout=0, bias="none",
                                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
                                             use_gradient_checkpointing="unsloth", random_state=3407, max_seq_length=cfg["max_seq_length"])
    eos = tok.eos_token or ""
    rows = load_rows(job, "train")
    texts = [template(r["prompt"], r["answer"]) + eos for r in rows]
    if cfg.get("auto", True):
        longest = max(len(tok(t)["input_ids"]) for t in texts[:: max(1, len(texts) // 400)])
        seq = min(cfg["max_seq_length"], 64 * math.ceil((longest + 32) / 64))
        if seq != cfg["max_seq_length"]:
            emit("log", message=f"Auto: longest example is {longest} tokens, sequence length set to {seq} (saves GPU memory)")
            cfg["max_seq_length"] = seq
    ds = Dataset.from_list([{"text": t} for t in texts])

    class Progress(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kw):
            if logs and "loss" in logs:
                emit("progress", step=state.global_step, total=state.max_steps, loss=round(float(logs["loss"]), 4),
                     epoch=round(float(state.epoch or 0), 3), vram_gb=round(torch.cuda.max_memory_reserved() / 2**30, 2))

        def on_step_end(self, args, state, control, **kw):
            if os.path.exists(os.path.join(job, "STOP")):
                control.should_training_stop = True

    def make_trainer(batch, accum):
        t = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, callbacks=[Progress()], args=SFTConfig(
            dataset_text_field="text", max_seq_length=cfg["max_seq_length"], per_device_train_batch_size=batch,
            gradient_accumulation_steps=accum, warmup_steps=10, num_train_epochs=cfg["epochs"],
            learning_rate=cfg["learning_rate"], logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
            lr_scheduler_type="linear", seed=3407, output_dir=os.path.join(job, "checkpoints"), save_strategy="no",
            report_to="none", dataset_num_proc=1))
        try:  # learn only the answers, not to repeat the question
            from unsloth.chat_templates import train_on_responses_only
            t = train_on_responses_only(t, instruction_part="### Question\n", response_part="### Answer\n")
        except Exception as e:  # noqa: BLE001 - older Unsloth: train on the whole text
            emit("log", message=f"Training on the whole text ({type(e).__name__})")
        return t

    batch, accum = cfg["batch_size"], cfg["grad_accum"]
    while True:
        try:
            make_trainer(batch, accum).train()
            break
        except torch.cuda.OutOfMemoryError:
            if batch == 1:
                raise SystemExit("Out of GPU memory even at batch size 1: pick a smaller model")
            torch.cuda.empty_cache()
            batch, accum = batch // 2, accum * 2
            emit("log", message=f"Out of GPU memory: retrying with batch size {batch} (gradient accumulation {accum}, same effective batch)")
    model.save_pretrained(os.path.join(job, "adapter"))
    tok.save_pretrained(os.path.join(job, "adapter"))
    emit("log", message="Adapter saved")
    return model, tok


# ---------- Evaluation

def parse_answer(text):
    s, e = text.find("{"), text.find("}")
    if s < 0 or e < s:
        return None
    try:
        v = json.loads(text[s:e + 1])
        h, l = float(v["high"]), float(v["low"])
        return (h, l) if math.isfinite(h) and math.isfinite(l) else None
    except (ValueError, KeyError, TypeError):
        return None


def score(rows, preds):
    """Overall scores, plus the same per market when the test holds more than one."""
    res = score_one(rows, preds)
    markets = sorted({r.get("market", "") for r in rows})
    if len(markets) > 1:
        res["markets"] = {m: score_one([r for r in rows if r.get("market", "") == m], [p for r, p in zip(rows, preds) if r.get("market", "") == m]) for m in markets}
    return res


def score_one(rows, preds):
    """Mean error in % of price for the model and for the simple guess, plus how often price reached each level."""
    m_err, g_err, reach_h, reach_l, bad = [], [], 0, 0, 0
    for r, p in zip(rows, preds):
        if p is None:
            bad += 1
            continue
        ph, pl = max(p[0], 0.0), min(p[1], 0.0)
        m_err += [abs(r["high"] - ph), abs(r["low"] - pl)]
        g_err += [abs(r["high"] - r["guess"]), abs(r["low"] + r["guess"])]
        reach_h += r["high"] >= ph
        reach_l += r["low"] <= pl
    n = len(rows) - bad
    if n == 0:
        return {"days": len(rows), "unreadable": bad}
    me, ge = sum(m_err) / len(m_err), sum(g_err) / len(g_err)
    return {"days": len(rows), "unreadable": bad, "model_error_pct": round(me, 4), "guess_error_pct": round(ge, 4),
            "better_than_guess_pct": round(100 * (1 - me / ge), 2), "reached_high_pct": round(100 * reach_h / n, 1),
            "reached_low_pct": round(100 * reach_l / n, 1)}


def evaluate(job, cfg, model=None, tok=None):
    import torch
    from unsloth import FastLanguageModel
    if model is None:
        model, tok = FastLanguageModel.from_pretrained(model_name=os.path.join(job, "adapter"), max_seq_length=cfg["max_seq_length"],
                                                       load_in_4bit=model_of(cfg)[1])
    FastLanguageModel.for_inference(model)
    tok = text_tokenizer(tok)
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    rows = load_rows(job, "test")
    # Big batches while the GPU has room (much faster), halved on an out-of-memory error
    free_gb = (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_reserved()) / 2**30
    preds, bs, i = [], max(8, min(128, int(free_gb * 16))), 0
    while i < len(rows):
        chunk = rows[i:i + bs]
        enc = tok([template(r["prompt"]) for r in chunk], return_tensors="pt", padding=True).to("cuda")
        try:
            with torch.no_grad():
                out = model.generate(**enc, max_new_tokens=32, do_sample=False, pad_token_id=tok.pad_token_id, use_cache=True)
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            if bs <= 4:
                raise
            bs //= 2
            emit("log", message=f"Test batch lowered to {bs} to fit the GPU")
            continue
        for k in range(len(chunk)):
            preds.append(parse_answer(tok.decode(out[k][enc["input_ids"].shape[1]:], skip_special_tokens=True)))
        emit("progress", phase="evaluate", step=min(i + bs, len(rows)), total=len(rows))
        i += len(chunk)
    res = score(rows, preds)
    with open(os.path.join(job, "predictions.jsonl"), "w") as f:
        for r, p in zip(rows, preds):
            f.write(json.dumps({"date": r["date"], "high": r["high"], "low": r["low"], "pred": p}) + "\n")
    return res


# ---------- Export: every format the trained model can be stored in, and an optional Hugging Face upload

GGUF = {"gguf_q4_k_m": "q4_k_m", "gguf_q5_k_m": "q5_k_m", "gguf_q8_0": "q8_0", "gguf_f16": "f16"}


def _load_adapter(job, cfg):
    from unsloth import FastLanguageModel
    return FastLanguageModel.from_pretrained(model_name=os.path.join(job, "adapter"), max_seq_length=cfg["max_seq_length"],
                                             load_in_4bit=model_of(cfg)[1])


def export_one(job, cfg, e):
    """One export format, in its own process (see export()). Prints an export_result event; a hard crash shows as a
    non-zero exit code to the parent instead of killing the whole run."""
    model, tok = _load_adapter(job, cfg)
    repo = (cfg.get("push_repo") or "").strip()
    token, private = os.environ.get("HF_TOKEN") or None, bool(cfg.get("push_private", True))
    try:
        if e == "__upload__":
            model.push_to_hub(repo, token=token, private=private)
            tok.push_to_hub(repo, token=token, private=private)
            status = f"https://huggingface.co/{repo}"
        elif e in ("merged_16bit", "merged_4bit"):
            method = "merged_16bit" if e == "merged_16bit" else "merged_4bit_forced"
            model.save_pretrained_merged(os.path.join(job, "export", e), tok, save_method=method)
            if repo:
                model.push_to_hub_merged(f"{repo}-{e.replace('_', '-')}", tok, save_method=method, token=token, private=private)
            status = "ok"
        else:
            model.save_pretrained_gguf(os.path.join(job, "export", "gguf"), tok, quantization_method=GGUF[e])
            if repo:
                model.push_to_hub_gguf(f"{repo}-gguf", tok, quantization_method=GGUF[e], token=token, private=private)
            status = "ok"
    except Exception as ex:  # noqa: BLE001
        status = f"failed: {type(ex).__name__}: {ex}"[:300]
    emit("export_result", format=e, status=status)


def export(job, cfg, model=None, tok=None):
    """Every export format the run asked for, each in a separate Python process with the GPU freed first. GGUF F16 /
    Q8_0 merge the whole 16-bit model; on an 8 GB card that can crash the interpreter outright, which used to take the
    finished run (scores and all) down with it. Now a crash costs only that one format."""
    import gc
    import subprocess
    wanted = [e for e in cfg.get("exports", []) if e != "adapter"]
    repo = (cfg.get("push_repo") or "").strip()
    if repo:
        wanted.append("__upload__")
    if not wanted:
        return {}
    # Release the trained model's VRAM so each export process has the whole GPU
    del model, tok
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass
    out = {}
    for i, e in enumerate(wanted):
        emit("progress", phase="export", step=i, total=len(wanted), label=e)
        p = subprocess.run([sys.executable, os.path.abspath(__file__), job, "export_one", e], capture_output=True, text=True)
        status, child_err = None, None
        for line in p.stdout.splitlines():
            if line.startswith("{"):
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if ev.get("type") == "export_result" and ev.get("format") == e:
                    status = ev.get("status")
                    continue
                if ev.get("type") == "error":
                    child_err = ev.get("message")
                    continue
            print(line, flush=True)  # the child's own progress/log events reach the app
        if p.returncode != 0 or status is None:
            why = child_err or " | ".join((p.stderr or "").strip().splitlines()[-4:])[-400:] or "no output"
            oom = p.returncode in (-9, 137, 2) or "memory" in why.lower()
            status = f"failed (exit {p.returncode}): {why}" + (" — likely out of memory: use GGUF Q4_K_M, or close other GPU apps" if oom else "")
        key = "upload" if e == "__upload__" else e
        out[key] = status
        emit("log", message=f"Export {key}: {status}")
    return out


def main(argv):
    job = argv[1]
    step = argv[2] if len(argv) > 2 else "all"
    cfg = json.load(open(os.path.join(job, "config.json")))
    try:
        if step in ("prepare", "all"):
            prepare(job, cfg)
        model = tok = None
        if step in ("train", "all"):
            model, tok = train(job, cfg)
        if step in ("evaluate", "all"):
            res = evaluate(job, cfg, model, tok)
            res["model"] = cfg.get("model_name") or cfg.get("model")
            json.dump(res, open(os.path.join(job, "result.json"), "w"), indent=1)  # saved before exports
            if step == "all":
                model = tok = None  # drop every reference so export() can hand the GPU to the export processes
                res["exports"] = export(job, cfg)
                json.dump(res, open(os.path.join(job, "result.json"), "w"), indent=1)
            emit("metric", **res)
        if step == "export":
            emit("metric", exports=export(job, cfg))
        if step == "export_one":
            export_one(job, cfg, argv[3])
            return
        emit("done", step=step)
    except SystemExit as e:
        emit("error", message=str(e))
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 - reported to the app, then the container exits
        import traceback
        emit("error", message=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-4000:])
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
