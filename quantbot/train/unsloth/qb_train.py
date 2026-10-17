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


def examples(days):
    """One example per day that has 20 days before it."""
    out = []
    for i in range(20, len(days)):
        d, o, h, l, c = days[i]
        prev_close = days[i - 1][4]
        ctx = []
        for k in range(CONTEXT_DAYS, 0, -1):
            _, po, ph, pl, pc = days[i - k]
            ctx.append(f"day-{k}: high {pct(ph, po):+.2f}% low {pct(pl, po):+.2f}% close {pct(pc, po):+.2f}%")
        avg20 = sum(pct(x[2], x[1]) - pct(x[3], x[1]) for x in days[i - 20:i]) / 20  # mean (high-low) % of open
        prompt = ("Gold (XAUUSD) daily range forecast.\n" + "\n".join(ctx) +
                  f"\ntoday: {d.strftime('%A')}, gap from yesterday's close {pct(o, prev_close):+.2f}%, 20-day average range {avg20:.2f}%"
                  "\nAnswer with today's high and low as % from today's open.")
        answer = json.dumps({"high": round(pct(h, o), 2), "low": round(pct(l, o), 2)})
        out.append({"date": d.isoformat(), "prompt": prompt, "answer": answer,
                    "high": pct(h, o), "low": pct(l, o), "guess": avg20 / 2})
    return out


def prepare(job, cfg):
    days = daily(cfg["data_file"])
    if len(days) < 300:
        raise SystemExit(f"Only {len(days)} trading days in the data file; need at least 300")
    ex = examples(days)
    tr = [e for e in ex if cfg["train_from"] <= e["date"] <= cfg["train_to"]]
    te = [e for e in ex if cfg["test_from"] <= e["date"] <= cfg["test_to"]]
    if not tr or not te:
        raise SystemExit("The train or test date range has no days in the data file")
    for name, rows in (("train", tr), ("test", te)):
        with open(os.path.join(job, f"{name}.jsonl"), "w") as f:
            for e in rows:
                f.write(json.dumps(e) + "\n")
    emit("log", message=f"{len(days)} trading days {days[0][0]} to {days[-1][0]}: {len(tr)} for training, {len(te)} for the test")
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
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    rows = load_rows(job, "test")
    preds, bs = [], 16
    for i in range(0, len(rows), bs):
        chunk = rows[i:i + bs]
        enc = tok([template(r["prompt"]) for r in chunk], return_tensors="pt", padding=True).to("cuda")
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=32, do_sample=False, pad_token_id=tok.pad_token_id)
        for k in range(len(chunk)):
            preds.append(parse_answer(tok.decode(out[k][enc["input_ids"].shape[1]:], skip_special_tokens=True)))
        emit("progress", phase="evaluate", step=min(i + bs, len(rows)), total=len(rows))
    res = score(rows, preds)
    with open(os.path.join(job, "predictions.jsonl"), "w") as f:
        for r, p in zip(rows, preds):
            f.write(json.dumps({"date": r["date"], "high": r["high"], "low": r["low"], "pred": p}) + "\n")
    return res


# ---------- Export: every format the trained model can be stored in, and an optional Hugging Face upload

GGUF = {"gguf_q4_k_m": "q4_k_m", "gguf_q5_k_m": "q5_k_m", "gguf_q8_0": "q8_0", "gguf_f16": "f16"}


def export(job, cfg, model=None, tok=None):
    from unsloth import FastLanguageModel
    wanted = [e for e in cfg.get("exports", []) if e != "adapter"]
    repo = (cfg.get("push_repo") or "").strip()
    if not wanted and not repo:
        return {}
    if model is None:
        model, tok = FastLanguageModel.from_pretrained(model_name=os.path.join(job, "adapter"), max_seq_length=cfg["max_seq_length"],
                                                       load_in_4bit=model_of(cfg)[1])
    out, token, private = {}, os.environ.get("HF_TOKEN") or None, bool(cfg.get("push_private", True))
    for e in wanted:
        emit("progress", phase="export", step=wanted.index(e), total=len(wanted), label=e)
        try:
            if e in ("merged_16bit", "merged_4bit"):
                method = "merged_16bit" if e == "merged_16bit" else "merged_4bit_forced"
                folder = os.path.join(job, "export", e)
                model.save_pretrained_merged(folder, tok, save_method=method)
                if repo:
                    model.push_to_hub_merged(f"{repo}-{e.replace('_', '-')}", tok, save_method=method, token=token, private=private)
            else:
                folder = os.path.join(job, "export", "gguf")
                model.save_pretrained_gguf(folder, tok, quantization_method=GGUF[e])
                if repo:
                    model.push_to_hub_gguf(f"{repo}-gguf", tok, quantization_method=GGUF[e], token=token, private=private)
            out[e] = "ok"
            emit("log", message=f"Exported {e}")
        except Exception as ex:  # noqa: BLE001 - one format failing must not lose the others
            out[e] = f"failed: {type(ex).__name__}: {ex}"[:300]
            emit("log", message=f"Export {e} failed: {ex}")
    if repo:
        try:
            model.push_to_hub(repo, token=token, private=private)
            tok.push_to_hub(repo, token=token, private=private)
            out["upload"] = f"https://huggingface.co/{repo}"
            emit("log", message=f"LoRA adapter uploaded to https://huggingface.co/{repo}")
        except Exception as ex:  # noqa: BLE001
            out["upload"] = f"failed: {ex}"[:300]
            emit("log", message=f"Upload to Hugging Face failed: {ex}")
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
            if step == "all":
                res["exports"] = export(job, cfg, model, tok)
            json.dump(res, open(os.path.join(job, "result.json"), "w"), indent=1)
            emit("metric", **res)
        if step == "export":
            emit("metric", exports=export(job, cfg))
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
