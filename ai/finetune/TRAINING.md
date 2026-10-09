# Train your own Llama on this market data (RTX 4060 + Ryzen 5 7600)

What the model learns, from `data/train.jsonl`:

| Kind | What | From |
| --- | --- | --- |
| news | Headline → how Nasdaq e-mini and gold actually moved that day (−2..+2), plus relevance | Google News headlines by day, ~10 years; end-of-day recap headlines removed so the answer isn't given away |
| range | Snapshot when a session's lines lock → the session's real high and low | Full day (6 PM open, 10 years, Nasdaq + gold), regular session (9:30, 10 years of the Nasdaq-100 cash index), after-market (4 PM, ~2 years) |
| system | Questions and answers about these tools and their tested accuracy | written from the training report |

`data/val.jsonl` holds the most recent ~20% of days. It is never trained on, so you can check the result fairly.

## 1. One-time setup (Windows 11)

1. Update the NVIDIA driver (Game Ready or Studio, any 2025+ version).
2. Open PowerShell as admin: `wsl --install -d Ubuntu`, then reboot and create your Ubuntu user.
3. In Ubuntu:
   ```bash
   sudo apt update && sudo apt install -y python3-venv python3-pip git build-essential cmake
   python3 -m venv ~/unsloth && source ~/unsloth/bin/activate
   pip install --upgrade pip
   pip install unsloth
   nvidia-smi        # should list the RTX 4060
   ```
4. Copy this repo (or just the `ai/` folder plus `data/`) into Ubuntu, e.g. `cp -r /mnt/c/Users/<you>/Trading ~/`.

## 2. Train

```bash
source ~/unsloth/bin/activate && cd ~/Trading
python ai/finetune/train_unsloth.py --preset smoke     # 2-5 minute check that everything works
python ai/finetune/train_unsloth.py                    # the real run (preset rtx4060)
```

If it stops (reboot, crash), run the same command with `--resume` added.

### Settings used for an RTX 4060 (6 GB budget) + Ryzen 5 7600

| Setting | Value | Why |
| --- | --- | --- |
| Base model | `unsloth/Llama-3.2-3B-Instruct-bnb-4bit` | 4-bit 3B uses about 4–5 GB of VRAM while training. 8B needs about 7–8 GB |
| Method | QLoRA, rank 16, alpha 16, dropout 0, all attention + MLP projections | Unsloth's fastest, lowest-memory setup |
| Max sequence length | 512 | examples are ~150–350 tokens; longer only wastes memory |
| Batch × accumulation | 8 × 2 (effective 16) | fills the 4060 without going over 6 GB |
| Learning rate / schedule | 2e-4, cosine, 3% warm-up | standard for LoRA |
| Epochs | 1 | the news labels are noisy; more epochs memorize noise. Watch `eval_loss` |
| Precision | bf16 (the 4060 supports it), 8-bit AdamW | less memory, same quality |
| Gradient checkpointing | `"unsloth"` | about 30% less VRAM |
| Loss on answers only | `train_on_responses_only` | the model learns the answers, not to repeat prompts |
| CPU | `dataset_num_proc=6`, `dataloader_num_workers=4` | matches the 6-core / 12-thread Ryzen |
| Memory env | `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` | avoids fragmentation out-of-memory errors |

Expect about 1 hour per epoch on a 4060 for ~50,000 examples. Close games and browsers with hardware acceleration while it trains. If you get an out-of-memory error, use `--batch 4 --accum 4`.

Training uses about 120–150 W for that hour, roughly 0.15 kWh, so a few cents of electricity.

## 3. Use it

Training ends by writing `ai/finetune/out/gguf/*.gguf` (q4_k_m, about 2 GB) and a `Modelfile`. Then, on Windows with Ollama installed:

```bash
cd ai/finetune/out
ollama create drp-llama -f Modelfile
```

Set `"ollama_model": "drp-llama"` in `ai/config.json` and restart `ai.bat`. The service sends the same prompts the model was trained on.

## 4. Check it actually learned something

```bash
python ai/finetune/eval_news.py --model llama3.2:3b --model drp-llama --limit 300
```

It compares the base and the fine-tuned model on held-out days:
- **headline direction:** how often the model's Nasdaq/gold score had the same sign as the real move (50% = coin flip)
- **range:** average miss of the predicted high/low, next to the locked-line model that was in the prompt

Keep the fine-tuned model only if it beats the base model there. A language model is not a better number-cruncher than the regression in the prompt; if its range answers are worse than the locked-line model's, use the locked lines and let Llama do the news.
