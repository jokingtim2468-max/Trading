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
MODELS = {
    # name: (Hugging Face id, load in 4-bit, note)
    "qwen3.5-0.8b": ("unsloth/Qwen3.5-0.8B", False, "about 3 GB, quickest test run"),
    "qwen3.5-2b": ("unsloth/Qwen3.5-2B", False, "about 5 GB, best fit for an 8 GB RTX 4060"),
    "qwen3-4b-4bit": ("unsloth/Qwen3-4B-unsloth-bnb-4bit", True, "about 7-8 GB, tight on 8 GB: short prompts only"),
}


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
    return tr, te


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
    hf_id, four_bit, _ = MODELS[cfg["model"]]
    emit("log", message=f"Loading {hf_id} on {torch.cuda.get_device_name(0)} ({torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GB)")
    model, tok = FastLanguageModel.from_pretrained(model_name=hf_id, max_seq_length=cfg["max_seq_length"],
                                                   load_in_4bit=four_bit, load_in_16bit=not four_bit, full_finetuning=False)
    model = FastLanguageModel.get_peft_model(model, r=cfg["lora_r"], lora_alpha=cfg["lora_r"], lora_dropout=0, bias="none",
                                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
                                             use_gradient_checkpointing="unsloth", random_state=3407, max_seq_length=cfg["max_seq_length"])
    eos = tok.eos_token or ""
    rows = load_rows(job, "train")
    ds = Dataset.from_list([{"text": template(r["prompt"], r["answer"]) + eos} for r in rows])

    class Progress(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kw):
            if logs and "loss" in logs:
                emit("progress", step=state.global_step, total=state.max_steps, loss=round(float(logs["loss"]), 4),
                     epoch=round(float(state.epoch or 0), 3), vram_gb=round(torch.cuda.max_memory_reserved() / 2**30, 2))

        def on_step_end(self, args, state, control, **kw):
            if os.path.exists(os.path.join(job, "STOP")):
                control.should_training_stop = True

    trainer = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, callbacks=[Progress()], args=SFTConfig(
        dataset_text_field="text", max_seq_length=cfg["max_seq_length"], per_device_train_batch_size=cfg["batch_size"],
        gradient_accumulation_steps=cfg["grad_accum"], warmup_steps=10, num_train_epochs=cfg["epochs"],
        learning_rate=cfg["learning_rate"], logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
        lr_scheduler_type="linear", seed=3407, output_dir=os.path.join(job, "checkpoints"), save_strategy="no",
        report_to="none", dataset_num_proc=1))
    trainer.train()
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
                                                       load_in_4bit=MODELS[cfg["model"]][1])
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
            res["model"] = cfg["model"]
            json.dump(res, open(os.path.join(job, "result.json"), "w"), indent=1)
            emit("metric", **res)
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
