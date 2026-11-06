# Training QuantBot's local model

The dataset is `dataset/quantbot-sft.jsonl.gz`: one JSON chat per line, in the exact format the app sends to Ollama:
`{"messages": [...], "tools": [...], "meta": {...}}`.

| meta.kind | What it teaches | Verified |
|---|---|---|
| backtest | load the skill, write a script, run it with `run_python`, quote only the real output. About 15% start with a bug (crash or look-ahead) and fix it | yes: every script ran on 22 years of gold H1 |
| sizing, prop-math | contract sizing, Lucid limits, the pass odds with no edge | yes: computed exactly |
| port-pine, port-mq5, port-cs | Pine v6, MQL5 and NinjaScript versions of the trend strategy | **no**: templates, not compiled here |

Train with `--verified-only` to leave out the ports.

## Rebuild the dataset

```bash
cd quantbot
node training/export_prompt.mjs > training/dataset/prompt.json     # the app's real system prompt and tools
python3 training/build_dataset.py --data <folder with XAUUSD_H1*.csv>
```

Rebuild it whenever the system prompt, the tools or the skills change, so training matches what the app sends.

## Train on RunPod (plan, so no money is wasted)

1. **Measure first.** Run the base `qwen2.5-coder:7b` in QuantBot with tools and skills on your test requests. Only train if it fails.
2. **Pod:** one RTX 4090 or A40/L40S (24-48 GB). Check today's per-hour price on runpod.io. Add a network volume so checkpoints survive.
3. **Smoke test** (a few minutes):
   ```bash
   pip install unsloth
   python training/train_unsloth.py --data training/dataset/quantbot-sft.jsonl.gz --steps 20
   ```
4. **Full run** (about 1-2 hours for this size):
   ```bash
   python training/train_unsloth.py --data training/dataset/quantbot-sft.jsonl.gz --epochs 2 --gguf
   ```
5. Download `out/gguf/*.gguf`, then **stop the pod** (a running pod bills even when idle).

## Use it in Ollama (8 GB RTX 4060)

```
# Modelfile
FROM ./unsloth.Q4_K_M.gguf
PARAMETER num_ctx 32768
PARAMETER temperature 0.2
```

`ollama create quant-coder -f Modelfile`, set `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0`, then pick
`quant-coder` in QuantBot. Keep it only if it beats the base model on the same test requests.
