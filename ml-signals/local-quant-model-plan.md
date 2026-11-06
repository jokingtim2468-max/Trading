# Plan: a local quant-script model (Ollama, 32k context, MCP tools, fine-tuned on RunPod)

Goal: a small model running on the RTX 4060 (8 GB) through a custom app. The app gives it 32k context, MCP tools and
skills. Its job is to write quant scripts the way this project needs them: tested, no look-ahead, real costs, prop
firm rules. RunPod is only used to fine-tune it, and only once a test shows fine-tuning is needed.

## 1. Pick the base model first (it decides everything else)

| Model | Size at Q4 | 32k context fits in 8 GB? | Tool calling in Ollama | Notes |
|---|---|---|---|---|
| **Qwen2.5-Coder 7B Instruct** | ~4.7 GB | yes, with q8 KV cache | yes | best-known small coder, already used in QuantBot |
| Qwen3 8B | ~5.2 GB | yes, tight (q8 KV cache) | yes | stronger reasoning, slower; thinking mode costs context |
| Qwen2.5-Coder 14B | ~9 GB | no (does not fit 8 GB) | yes | only if you upgrade the GPU |

- **Chosen: Qwen2.5-Coder 7B Instruct (Q4_K_M), for the 8 GB RTX 4060.** Train and serve the *same* base model, with the *same* chat template.
- Check that the exact tag you pull supports tools: `ollama show qwen2.5-coder:7b` should list "tools" under
  Capabilities.

## 2. Ollama settings for 32k context on 8 GB

KV cache for a 7B Qwen at 32k tokens is about 1.8 GB at fp16, or about 0.9 GB at q8. Use these settings:

```powershell
setx OLLAMA_FLASH_ATTENTION 1
setx OLLAMA_KV_CACHE_TYPE q8_0
setx OLLAMA_CONTEXT_LENGTH 32768
```

Restart Ollama after setting them. Also pin the context in the model itself, so the app cannot accidentally run at the
default 4k:

```
# Modelfile
FROM qwen2.5-coder:7b
PARAMETER num_ctx 32768
PARAMETER temperature 0.2
```

`ollama create quant-coder -f Modelfile`, then check with `ollama ps` that it shows 100% GPU and the 32768 context. If
it spills to CPU, drop to 24k.

## 3. The custom app (the model does not speak MCP by itself)

Ollama only knows "tools" in its `/api/chat` call. The app is the **MCP client**:
1. Connect to each MCP server and read its tools.
2. Convert each tool to Ollama's tool format and send it with the chat.
3. When the model returns a `tool_calls`, run it on the MCP server and send the result back as a `tool` message.
4. Repeat until the model answers without a tool call.

Rules that matter for a 7B model with 32k context:
- **Send only the tools a task needs.** Every tool schema uses context, and small models pick the wrong tool when
  there are many. Aim for 5-10 tools per request. Use a router: "backtest" tasks get the data, run and file tools;
  "Pine" tasks get the Pine tools.
- **Skills = markdown loaded on demand.** Keep a short index in the system prompt (one line per skill). Inject the full
  skill text only when the task matches.
- **Trim tool results.** Cap each result (e.g. 4k tokens), and summarize long backtest logs before sending them back.
- **Core tools for this project:**
  - `run_python` (sandboxed, with a timeout)
  - `read_file` / `write_file` (locked to the workspace)
  - `list_data` (the MT5 files and their date ranges)
  - `run_backtest` (the project's harness)
  - `pine_check`, if available
- The model must **run every script it writes** and fix errors before answering. This loop is what makes a small
  model useful.

## 4. Test before you train (this is what saves money)

Build an eval set first: about 40 real requests, each with a pass/fail check that runs automatically. Examples:
- "Write a gold daily EMA 13/55 trend backtest with Lucid 50K rules." It passes if the script runs, uses next-bar
  fills, and its result matches the reference within 5%.
- "Add a 2-loss daily stop to this script." It passes if the reference tests still pass and the new rule is enforced.
- "Port this Python strategy to Pine v6." It passes if the file compiles in the checker and the signals match on a
  sample.

Run the eval with the plain base model plus tools and skills. **Only train if it fails clearly.** Typical failures
fine-tuning fixes are a wrong output format, ignoring the project's harness, look-ahead mistakes, and broken tool-call
JSON. Fine-tuning won't make a 7B model smarter in general.

## 5. Training data (most of the quality comes from here)

- **Target: 500-2,000 examples.** Each is a full chat: system prompt, user request, the model's tool calls and tool
  results, and the final answer. Use the **exact same format and chat template the app uses**.
- **Sources:**
  - The scripts in this repo: `quantbot/scripts/*`, `ml-signals/*`.
  - Requests you write, answered by a strong model (Claude via your app).
- **Keep only verified examples:** every script in the data must have actually run and passed its checks. Bad examples
  teach bad habits.
- **Cover every rule:** next-bar fills, stop first in the same bar, choose / check / grade splits, costs, the trailing
  floor, flat by 4:45, honest reporting of losers.
- **Length:** most examples under 8k tokens. Include some at 16-24k so the model learns to use long context.
- **Hold out the eval set:** none of its 40 requests may appear in the training data.

## 6. RunPod training (cheap if it is planned)

- **Method:** QLoRA with Unsloth on Qwen2.5-Coder-7B-Instruct, rank 16-32, 1-3 epochs, sequence length 16k (32k
  training costs much more and is rarely needed). QuantBot already has an Unsloth setup in its Train page to reuse.
- **GPU:** one 24-48 GB card (RTX 4090, L40S or A40) is enough for a 7B QLoRA. 1,000 examples x 3 epochs is roughly
  1-3 hours. Check current per-hour prices on runpod.io before starting.
- **Before paying:**
  1. Run 20 steps on a tiny subset locally or on the cheapest pod to catch script errors.
  2. Use a network volume, so checkpoints survive if the pod stops.
  3. Save checkpoints every few hundred steps.
  4. Stop the pod as soon as training ends; a running pod bills even when idle.
- **Export:** merge the LoRA, convert to GGUF Q4_K_M, then build the Modelfile (step 2) with the same chat template.
  Re-run the 40-request eval locally. Keep the fine-tuned model only if it beats the base model.

## 7. Order of work

1. Pick the model and set up Ollama at 32k on the 4060, then confirm with `ollama ps`.
2. Build the app's MCP bridge with the 5-10 core tools, plus the skills index.
3. Write the 40-request eval and run it on the base model. Measure first.
4. If it fails: build 500+ verified training examples from the failures.
5. Do a short test run, then the full QLoRA on RunPod. Export to GGUF and re-run the eval.
6. Repeat 4-5 only when new failures show up.

## Decisions needed before spending money

- **Base model:** Qwen2.5-Coder 7B (default) or Qwen3 8B?
- **The custom app:** extend QuantBot's existing Ollama chat and agent setup, or build a new standalone app?
- **Which MCP servers it should use,** for example filesystem, the backtest harness, TradingView/Pine, and
  web search.
