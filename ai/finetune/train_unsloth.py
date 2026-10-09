"""Fine-tune Llama on the Day Range Predictor dataset with Unsloth (QLoRA), then export it for Ollama.

Needs an NVIDIA GPU. Default: Llama 3.2 3B in 4-bit (QLoRA), about 4-5 GB of VRAM, tuned for an RTX 4060
with a 6 GB budget and a 6-core CPU (Ryzen 5 7600). Run inside WSL2 (Ubuntu) on Windows, or on Linux:

    pip install unsloth                                  # pulls torch, trl, transformers, datasets
    python ai/finetune/build_dataset.py                  # if data/train.jsonl isn't there yet
    python ai/finetune/train_unsloth.py                  # RTX 4060 settings (3B, seq 512, batch 8x2)
    python ai/finetune/train_unsloth.py --preset 8b-8gb  # Llama 3.1 8B if your card really has 8 GB free

Then load it into Ollama and point the AI service at it:

    cd ai/finetune/out && ollama create drp-llama -f Modelfile
    set "ollama_model": "drp-llama" in ai/config.json and restart ai/service.py
    python ai/finetune/eval_news.py --model drp-llama    # compare against the base model on held-out days
"""

import argparse
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Examples here are short (about 150-350 tokens), so seq 512 is enough and keeps VRAM low.
PRESETS = {
    # RTX 4060 (8 GB card, kept under ~6 GB) + Ryzen 5 7600 (6 cores / 12 threads)
    "rtx4060": {"model": "unsloth/Llama-3.2-3B-Instruct-bnb-4bit", "max_seq": 512, "batch": 8, "accum": 2,
                "epochs": 1, "lr": 2e-4, "rank": 16, "workers": 4, "proc": 6},
    # Llama 3.1 8B: only if the full 8 GB is free (close the browser/games); about 7-7.5 GB
    "8b-8gb": {"model": "unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit", "max_seq": 512, "batch": 2, "accum": 8,
               "epochs": 1, "lr": 2e-4, "rank": 16, "workers": 4, "proc": 6},
    # very small test run to check everything works end to end (a few minutes)
    "smoke": {"model": "unsloth/Llama-3.2-1B-Instruct-bnb-4bit", "max_seq": 512, "batch": 8, "accum": 1,
              "epochs": 0.05, "lr": 2e-4, "rank": 8, "workers": 2, "proc": 4},
}
DATA = HERE / "data"
OUT = HERE / "out"

# Ollama chat template for Llama 3.x, matching what Unsloth trains on
MODELFILE = '''FROM ./{gguf}
TEMPLATE """{{{{- range .Messages }}}}<|start_header_id|>{{{{ .Role }}}}<|end_header_id|>

{{{{ .Content }}}}<|eot_id|>{{{{ end }}}}<|start_header_id|>assistant<|end_header_id|>

"""
PARAMETER stop "<|eot_id|>"
PARAMETER stop "<|start_header_id|>"
PARAMETER temperature 0
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", choices=list(PRESETS), default="rtx4060")
    ap.add_argument("--model")
    ap.add_argument("--epochs", type=float)
    ap.add_argument("--lr", type=float)
    ap.add_argument("--rank", type=int)
    ap.add_argument("--max-seq", type=int)
    ap.add_argument("--batch", type=int)
    ap.add_argument("--accum", type=int)
    ap.add_argument("--quant", default="q4_k_m", help="GGUF quantization for Ollama")
    ap.add_argument("--no-gguf", action="store_true", help="only save the LoRA adapter")
    ap.add_argument("--resume", action="store_true", help="continue from the last checkpoint after a crash or reboot")
    a = ap.parse_args()
    cfg = dict(PRESETS[a.preset])
    for k in ("model", "epochs", "lr", "rank", "max_seq", "batch", "accum"):
        if getattr(a, k) is not None:
            cfg[k] = getattr(a, k)
    print("settings:", json.dumps(cfg))
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    # Unsloth must be imported before transformers/trl
    from unsloth import FastLanguageModel, is_bfloat16_supported
    from unsloth.chat_templates import get_chat_template, train_on_responses_only
    from datasets import load_dataset
    from transformers import TrainingArguments, DataCollatorForSeq2Seq
    from trl import SFTTrainer

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=cfg["model"], max_seq_length=cfg["max_seq"], dtype=None, load_in_4bit=True)
    model = FastLanguageModel.get_peft_model(
        model, r=cfg["rank"], lora_alpha=cfg["rank"], lora_dropout=0, bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth", random_state=7)
    tokenizer = get_chat_template(tokenizer, chat_template="llama-3.1")

    def fmt(batch):
        return {"text": [tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=False)
                         for m in batch["messages"]]}

    train = load_dataset("json", data_files=str(DATA / "train.jsonl"), split="train").map(fmt, batched=True, num_proc=cfg["proc"])
    val = load_dataset("json", data_files=str(DATA / "val.jsonl"), split="train").map(fmt, batched=True, num_proc=cfg["proc"])
    print(f"train {len(train)} examples, val {len(val)}")

    trainer = SFTTrainer(
        model=model, tokenizer=tokenizer, train_dataset=train, eval_dataset=val.select(range(min(500, len(val)))),
        dataset_text_field="text", max_seq_length=cfg["max_seq"], dataset_num_proc=cfg["proc"],
        data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer), packing=False,
        args=TrainingArguments(
            per_device_train_batch_size=cfg["batch"], gradient_accumulation_steps=cfg["accum"],
            per_device_eval_batch_size=cfg["batch"], warmup_ratio=0.03, group_by_length=True,
            num_train_epochs=cfg["epochs"], learning_rate=cfg["lr"], lr_scheduler_type="cosine",
            fp16=not is_bfloat16_supported(), bf16=is_bfloat16_supported(),
            logging_steps=20, eval_strategy="steps", eval_steps=500, save_strategy="steps", save_steps=1000,
            save_total_limit=2, dataloader_num_workers=cfg["workers"], dataloader_pin_memory=True,
            optim="adamw_8bit", weight_decay=0.01, max_grad_norm=1.0, seed=7,
            output_dir=str(OUT / "checkpoints"), report_to="none"),
    )
    # learn only the answers, not the prompts
    trainer = train_on_responses_only(trainer, instruction_part="<|start_header_id|>user<|end_header_id|>\n\n",
                                      response_part="<|start_header_id|>assistant<|end_header_id|>\n\n")
    stats = trainer.train(resume_from_checkpoint=a.resume or None)
    print(stats)
    print("eval:", trainer.evaluate())

    OUT.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(OUT / "lora"))
    tokenizer.save_pretrained(str(OUT / "lora"))
    if a.no_gguf:
        return
    model.save_pretrained_gguf(str(OUT / "gguf"), tokenizer, quantization_method=a.quant)
    gguf = sorted((OUT / "gguf").glob("*.gguf"), key=lambda p: p.stat().st_size)[-1]
    (OUT / "Modelfile").write_text(MODELFILE.format(gguf=gguf.relative_to(OUT).as_posix()))
    (OUT / "train_info.json").write_text(json.dumps({**cfg, "preset": a.preset, "gguf": gguf.name}, indent=1))
    print(f"\nDone. Next:\n  cd {OUT}\n  ollama create drp-llama -f Modelfile\n"
          "  then set \"ollama_model\": \"drp-llama\" in ai/config.json")


if __name__ == "__main__":
    main()
