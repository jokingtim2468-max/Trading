"""QLoRA fine-tune of Qwen2.5-Coder-7B-Instruct on QuantBot's dataset, with Unsloth. Run it on a RunPod GPU (24-48 GB).

  pip install unsloth
  python train_unsloth.py --data dataset/quantbot-sft.jsonl.gz --out out --steps 20     # smoke test first
  python train_unsloth.py --data dataset/quantbot-sft.jsonl.gz --out out --epochs 2     # full run

Training uses the model's own chat template with the app's tool list, so tool calls look exactly as they do in Ollama.
Only the assistant turns are trained on (system, user and tool results are masked).
"""
import argparse, gzip, json

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', default='out')
ap.add_argument('--base', default='unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit')
ap.add_argument('--max-len', type=int, default=16384)
ap.add_argument('--rank', type=int, default=32)
ap.add_argument('--epochs', type=float, default=2)
ap.add_argument('--steps', type=int, default=-1, help='stop after this many steps (smoke test)')
ap.add_argument('--lr', type=float, default=1e-4)
ap.add_argument('--verified-only', action='store_true', help='drop template-only examples (Pine / MQL5 / NinjaScript ports)')
ap.add_argument('--gguf', action='store_true', help='also export GGUF q4_k_m for Ollama')
a = ap.parse_args()

from unsloth import FastLanguageModel  # noqa: E402  (import after argparse so --help works without a GPU)
from unsloth.chat_templates import train_on_responses_only  # noqa: E402
from datasets import Dataset  # noqa: E402
from trl import SFTTrainer, SFTConfig  # noqa: E402

model, tok = FastLanguageModel.from_pretrained(a.base, max_seq_length=a.max_len, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=a.rank, lora_alpha=a.rank, lora_dropout=0,
                                         target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
                                         use_gradient_checkpointing='unsloth', random_state=7)

op = gzip.open if a.data.endswith('.gz') else open
rows = [json.loads(l) for l in op(a.data, 'rt', encoding='utf8')]
if a.verified_only: rows = [r for r in rows if r['meta'].get('verified')]


def text(r):
    msgs = []
    for m in r['messages']:
        m = dict(m)
        for tc in m.get('tool_calls', []) or []:
            if isinstance(tc['function']['arguments'], str): tc['function']['arguments'] = json.loads(tc['function']['arguments'])
        msgs.append(m)
    return tok.apply_chat_template(msgs, tools=r['tools'], tokenize=False)


texts = [text(r) for r in rows]
lens = [len(tok(t).input_ids) for t in texts]
keep = [t for t, n in zip(texts, lens) if n <= a.max_len]
print(f'{len(rows)} rows, {len(keep)} fit in {a.max_len} tokens, longest {max(lens)} tokens')
ds = Dataset.from_dict({'text': keep})

trainer = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, args=SFTConfig(
    dataset_text_field='text', max_seq_length=a.max_len, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=a.epochs, max_steps=a.steps, learning_rate=a.lr, lr_scheduler_type='cosine', warmup_ratio=0.03,
    logging_steps=5, save_steps=100, save_total_limit=3, output_dir=a.out, bf16=True, optim='adamw_8bit', seed=7, report_to='none'))
trainer = train_on_responses_only(trainer, instruction_part='<|im_start|>user\n', response_part='<|im_start|>assistant\n')
trainer.train()

model.save_pretrained(f'{a.out}/lora'); tok.save_pretrained(f'{a.out}/lora')
if a.gguf:
    model.save_pretrained_gguf(f'{a.out}/gguf', tok, quantization_method='q4_k_m')
    print(f'GGUF written to {a.out}/gguf; see training/README.md for the Modelfile')
