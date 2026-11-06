"""Export the trained LoRA (out/lora) to a GGUF for Ollama, without training again.
  python training/export_gguf.py --lora /workspace/out/lora --out /workspace/out/gguf
Needs about 35 GB free on the disk holding --out (merged 16-bit model + 16-bit GGUF + the Q4_K_M file).
"""
import argparse, glob, os, shutil
ap = argparse.ArgumentParser()
ap.add_argument('--lora', default='/workspace/out/lora')
ap.add_argument('--out', default='/workspace/out/gguf')
ap.add_argument('--max-len', type=int, default=16384)
a = ap.parse_args()
free = shutil.disk_usage(os.path.dirname(a.out.rstrip('/')) or '/').free / 1e9
print(f'{free:.0f} GB free')
if free < 33: raise SystemExit(f'Only {free:.0f} GB free: delete checkpoints / partial files or give the pod more disk (need ~35 GB).')
from unsloth import FastLanguageModel  # noqa: E402
model, tok = FastLanguageModel.from_pretrained(a.lora, max_seq_length=a.max_len, load_in_4bit=True)
model.save_pretrained_gguf(a.out, tok, quantization_method='q4_k_m')
# keep only the quantized file
for f in glob.glob(os.path.join(a.out, '**', '*.gguf'), recursive=True):
    if not f.lower().endswith('q4_k_m.gguf'): os.remove(f); print('removed', f)
print('done:', glob.glob(os.path.join(a.out, '**', '*Q4_K_M*.gguf'), recursive=True))
