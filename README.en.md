<div align="center">

# 🐳 DSH Companion

A companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Desktop pet · usage & cost stats · budget alerts · UI enhancements

[中文](README.md) · [npm](https://www.npmjs.com/package/@qiuzhiyei/dsh-companion)

![npm](https://img.shields.io/npm/v/@qiuzhiyei/dsh-companion?label=npm&color=cb3837)
![ci](https://github.com/qiuzhiyei/dsh-companion/actions/workflows/ci.yml/badge.svg?branch=main)

<img src="docs/images/pet.png" width="180" alt="Whale girl desktop pet" />

</div>

## Features

- 🐳 **Desktop pet** — expression follows the task state; click to pet, drag to move, wanders when idle
- 👗 **5 skins** — JK / secretary / police / hanfu / qipao, each with its own expressions and dialogue voice
- 📊 **Stats panel** — tokens, tasks, success rate, duration, cost, cache hits, all with period deltas
- 💰 **Cost estimation** — official DeepSeek pricing, peak/off-peak halves, cache hits priced separately
- 🚨 **Budget alerts** — per-task and daily caps on tokens or cost, with a bubble and a system notification
- 🗂 **History & export** — filter by model / status / date / keyword, export CSV or JSON
- 🧹 **Session management** — hard-delete sessions (the host only archives)
- ⏰ **Sitting reminder** — nudge to stand up every N minutes
- 🖥 **Floating window** — transparent, always on top, click-through, real tray icon

## Install

**Desktop app**: plugin manager → install plugin → `@qiuzhiyei/dsh-companion` → enable → fully quit and relaunch DSH.

**CLI**:

```sh
dsh plugin --profile <your-profile> add @qiuzhiyei/dsh-companion
```

> Enable it in the plugin manager afterwards, then fully restart DSH.
> The pet downloads its Electron runtime on first launch (~150 MB, China mirror) — no manual install.

## Development

```sh
pnpm install && pnpm run build
pnpm test
```

Architecture and pitfalls: [AGENTS.md](AGENTS.md). Release process: [npm发布.md](npm发布.md).

## License

[MIT](LICENSE) © 2026 QiuWenXiong