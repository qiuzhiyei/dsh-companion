<div align="center">

<img src="icon.svg" width="84" alt="DSH Companion" />

# DSH Companion 2.0

A companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Desktop pet · live status · usage stats · budget/balance · session management

[中文](README.md) · [Install](#install) · [Usage](#usage) · [Development](#development)

![npm](https://img.shields.io/npm/v/@qiuzhiyei/dsh-companion?label=npm&color=cb3837)
![CI](https://github.com/qiuzhiyei/dsh-companion/actions/workflows/ci.yml/badge.svg?branch=main)

</div>

## What's new in 2.0.0

- **Deep Sea Terminal UI** — redesigned panel, pet HUD, sidebar badge and icon
- **Reasoning level** — switch the model's thinking effort from the composer
- **Balance / peak hours** — moved to the bottom-left sidebar badge
- **Panel upgrades** — task detail drawer, alert log, 30-day balance trend, UI font size
- **Session management** — hard-delete and bulk-delete sessions
- **Running status** — task name on start, persistent status bubble while running

## Features

- **Desktop pet** — animations and status bubbles for start / thinking / output / wrap-up / done / failure; pet, drag and idle roaming
- **5 skins** — JK, secretary, police, hanfu, qipao, each with its own expressions and voice
- **Bottom-left badge** — current task, today's tokens, running state, balance and peak/off-peak pricing; click to open the panel
- **Stats panel** — tokens, cost, cache hits, success rate, duration, charts, model/project rankings and alert log
- **Budget & balance** — per-task and daily budget alerts; DeepSeek account balance sampling and low-balance reminders
- **Session management** — permanently delete sessions (the host only archives), with bulk cleanup
- **Data retention** — keep the last N months, or keep everything (default)
- **Desktop experience** — transparent floating window, click-through, tray, sitting reminder, privacy mode and pure-pet mode

## Install

### Plugin manager (recommended)

DSH → Plugin Manager → Install plugin → enter:

```text
@qiuzhiyei/dsh-companion
```

Then **enable** the plugin and **fully quit and relaunch DSH**.

### CLI

```sh
dsh plugin --profile desktop add @qiuzhiyei/dsh-companion
```

Replace `desktop` with your profile name. Enable it in the plugin manager, then fully restart DSH.

### Upgrade

```sh
dsh plugin --profile desktop add @qiuzhiyei/dsh-companion@latest
```

Then restart DSH.

> The pet downloads its Electron runtime on first launch (~150 MB). If the download fails, the panel and stats still work; the companion falls back to browser mode.

## Usage

- **Bottom-left badge**: current task, today's usage, balance and peak/off-peak; click for the full panel.
- **Pet**: left-click to pet, drag to move, double-click for balance; Ctrl + wheel to resize.
- **Panel**: Tasks / Stats / Sessions / Settings; click a task row for details.
- **Reasoning level**: click the current effort next to the model name in the composer, then drag the sonar bar.
- **Settings**: appearance, behavior, budget, balance and retention; UI font size 90–110%.

## Data & privacy

- Tasks, settings and balance snapshots stay locally in `~/.dsh/dsh-companion`.
- No conversation text is stored — only task metadata (project, model, tokens, cost, tool counts).
- Privacy mode hides task names, models and amounts; pure-pet mode keeps only the animation.

## Development

```sh
pnpm install
pnpm run build
pnpm test
```

Architecture and pitfalls: [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 QiuWenXiong
