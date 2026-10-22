# Build prompt: Eclipse (local AI dev workbench for my MacBook)

Paste everything below the line into a new Claude Code session on the MacBook. The agent checks the hardware itself, so the prompt works on any Apple Silicon Mac.

---

Build me a native-feeling macOS desktop app called **Eclipse**. It is a fully local AI development workbench that runs open models on this MacBook. I use it to build apps, games and custom GUIs, to harden my own software against tampering, and to analyse firmware, APIs and binaries for my own hardware and integration projects. Nothing leaves the Mac unless I switch on a feature that needs the internet (web search, model downloads, Imgur upload), and each of those has its own switch in Settings.

Work in small, tested steps. Commit after each working feature. Ask me only when a choice is truly mine (money, accounts, deleting my data); otherwise pick the sensible default and tell me what you picked.

## 0. Check this Mac first
- Run `sysctl -n machdep.cpu.brand_string hw.memsize hw.ncpu`, `system_profiler SPHardwareDataType SPDisplaysDataType` and `sw_vers`, and record the chip, unified memory, GPU cores, free disk and macOS version in `docs/hardware.md`.
- Intel Mac: tell me plainly that local models will be slow and recommend 3B-8B models only. Apple Silicon: use Metal everywhere.
- Install what is missing with Homebrew (`brew install ollama llama.cpp node python@3.12 git`). Install Xcode command line tools if they are missing. Never use `sudo` without asking me.

## 1. Models (sized to this Mac's unified memory)
- Backends: **Ollama** (default), **llama.cpp server** (Metal) and **MLX** (`mlx-lm`, fastest on Apple Silicon). One backend interface so each model runs on any of them.
- Leave about 6 GB for macOS and the app. Model choices by memory:
  - 8-16 GB: Qwen2.5-Coder 7B Q4_K_M, Llama 3.1 8B Q4.
  - 18-24 GB: Qwen2.5-Coder 14B Q4_K_M, DeepSeek-Coder-V2-Lite.
  - 32-48 GB: Qwen2.5-Coder 32B Q4_K_M (the main coding model).
  - 64 GB+: Qwen2.5 72B Q4, Llama 3.3 70B Q4, plus a 7B draft model for speculative decoding.
- Model manager: pull, delete, choose the quantization, set context length, show the disk used, and benchmark tokens per second on this Mac. Show the result next to each model.
- Thermal and battery: show "Plugged in / On battery". On battery, offer to switch to the smaller model. Read `pmset -g therm` and warn when the Mac throttles.

## 2. App shell
- **Tauri 2** (Rust core + React/Vite/TypeScript frontend) for a small, fast native .app. Fall back to Electron only if a feature needs it. Python 3.12 sidecar for the analysis tools.
- Build a signed universal or arm64 `.dmg`. Add a menu-bar icon that shows the model status and has a "Stop all models" item.
- Data lives in `~/Library/Application Support/Eclipse`. Projects, chats and logs are plain files I can open.

## 3. Eclipse theme (strict)
- Colors as CSS variables: background `#0A0A0A`, panels `#121212`, raised `#1A1A1A`, borders `#262626`, text `#E0E0E0`, muted `#8A8A8A`, accent Cyber Orange `#FF6D00`, accent hover `#FF8C00`, success `#3DDC84`, danger `#FF3B30`.
- Orange appears only on buttons, the active tab, the focus ring, the cursor and the selection. No gradients, no purple, no glow spam.
- Fonts: JetBrains Mono for code, the terminal and numbers. Inter Tight or SF Pro for UI text.
- Terminal-inspired layout: a left rail of icons, a center workspace with tabs, a right panel for the inspector, and a bottom drawer for the terminal and logs. Every panel can be docked, resized and hidden. Cmd+K opens the command palette.
- Motion: 150 ms ease-out. Panels open from the button that opened them. Respect "Reduce motion".
- Write the full spec to `docs/ui-spec.md` and keep it updated.

## 4. Features
1. **Chat + agent.** Streaming chat with each local model, plus a thinking indicator. It has tools: read/write files in the project folder only, run shell commands with my approval, web search (switch), and calculator. App-side `/commands` (`/context` shows the token use, `/model`, `/tools`, `/clear`) run in the app, not in the model.
2. **Projects.** Open a folder. Get a file tree, a Monaco editor, git status, and diff review for every change the agent makes, with Accept/Reject per hunk.
3. **Game dev kit.** Templates: Godot 4 (GDScript), a Rust/Bevy ECS game, and a Three.js web game. One button builds and runs each one. Live reload. A physics and frame-time HUD.
4. **GUI builder.** Generate PyQt6, CustomTkinter (Eclipse-themed) or React screens from a description. Show a live preview beside the code.
5. **Anti-tamper lab (for my own games and apps).** Server-authoritative netcode template, input validation, rate limits, signed and versioned save files, code-signature and hash checks at start, heartbeat checks, and memory-integrity checks on key values (redundant copies + checksums). Explain each attack the check stops (memory editing, DLL/dylib injection, speed hacks, packet replay). Test harness: a sample game plus scripted "attacks" on it, with a report of what each check caught.
6. **Analysis bench (my own binaries, firmware and devices).** Wrappers for Ghidra headless, radare2/rizin, `binwalk`, `strings`, `otool`, `nm`, and `lldb`. Firmware unpack → file tree → string and symbol search. Network: a mitmproxy capture of my own app's traffic → an auto-written OpenAPI draft. Serial/USB: a `pyserial` console with hex view and protocol notes. Every session writes notes to the project's `analysis/` folder.
7. **Open-source adapter.** Paste a GitHub URL. Clone it into the project, map its structure, list the licence, and plan the changes to fit my spec. The agent changes the code and never copies it blindly. Keep the licence file.
8. **Assets.** Asset library per project (images, models .glb/.fbx/.obj, audio) with previews. Optional Imgur upload through the official API, with my client ID stored in the macOS Keychain. Copy the link after upload.
9. **Obsidian sync.** Write project notes, UI specs (colors, fonts, spacing) and decisions as Markdown to my Obsidian vault folder (I pick the path once). Use the Obsidian MCP if it is connected.

## 5. Quality bar
- Unit tests for the backend interface, tools and file sandbox. Playwright end-to-end tests drive every screen and save screenshots to `test-results/`.
- Store all secrets in the Keychain, never in plain files. The agent's file and shell tools cannot leave the project folder without my approval.
- After each feature: run the tests, take a screenshot, update `docs/ui-spec.md` and `README.md`, and commit.
- Be honest: if something is slow on this Mac, or a model is too big for it, say so with the measured number.

## 6. Cost check
Everything here is free and open source. Before any paid item (a paid API, a code-signing certificate at $99/year, a bigger Mac), tell me what it costs, why, and whether a free option does the job. Verify that any store selling it is the official one.

Start with step 0, then show me the plan for steps 1-4 as a checklist and begin.
