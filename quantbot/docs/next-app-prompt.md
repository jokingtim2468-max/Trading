# Build prompt: Forge (next local AI app)

Paste everything below the line into a new Claude Code session on the new machine.

---

Build me a desktop app called **Forge**: a fully local AI workbench that runs open models on my own hardware (Ollama and llama.cpp, with vLLM optional) and helps me build software, games, GUIs and security tools, and do reverse engineering. Nothing leaves the machine unless I turn on a feature that needs the internet, such as web search or downloads.

## Hardware and models
- Detect the GPUs, VRAM, RAM and CPU at first launch. Recommend models that fit, and show the tokens per second the machine actually gets.
- Ship a model manager for pull, delete, quantization choice (Q4_K_M, Q5_K_M, Q8, FP16), context size and