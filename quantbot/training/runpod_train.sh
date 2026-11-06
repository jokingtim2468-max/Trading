#!/usr/bin/env bash
# One command on a RunPod GPU pod (PyTorch template): install, smoke test, full QLoRA run, GGUF export.
#   bash runpod_train.sh            # 16k context
#   MAX_LEN=12288 bash runpod_train.sh   # if the smoke test runs out of memory (16 GB cards)
set -euo pipefail
MAX_LEN="${MAX_LEN:-16384}"
cd /workspace
if [ ! -d Trading ]; then git clone -b vibe-coded/clever-thompson-2f91fo --depth 1 https://github.com/jokingtim2468-max/Trading.git; else git -C Trading pull --ff-only; fi
cd Trading/quantbot
nvidia-smi --query-gpu=name,memory.total --format=csv
df -h /workspace | tail -1
pip install -q -U unsloth
echo "== smoke test (20 steps) =="
python training/train_unsloth.py --data training/dataset/quantbot-sft.jsonl.gz --out /workspace/out-smoke --steps 20 --verified-only --max-len "$MAX_LEN"
echo "== full run =="
python training/train_unsloth.py --data training/dataset/quantbot-sft.jsonl.gz --out /workspace/out --epochs 2 --verified-only --max-len "$MAX_LEN" --gguf
rm -rf /workspace/out-smoke
echo "== done. Download this file, then STOP THE POD =="
ls -lh /workspace/out/gguf/*.gguf
