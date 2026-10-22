<div align="center">

# 🐳 DSH Companion · dsh-companion

**A companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**
Desktop pet · usage & cost analytics · budget alerts · UI enhancements

[中文](README.md) · [Features](#features) · [Install](#install) · [Config](#config) · [Development](#development)

![license](https://img.shields.io/badge/license-MIT-blue)
![npm](https://img.shields.io/npm/v/@qiuzhiyei/dsh-companion?label=npm&color=cb3837)
![release](https://img.shields.io/github/v/release/qiuzhiyei/dsh-companion?label=release&color=blue)
![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)
![ci](https://github.com/qiuzhiyei/dsh-companion/actions/workflows/ci.yml/badge.svg?branch=main)

<img src="docs/images/pet.png" width="220" alt="Pet: whale girl, JK uniform" />

</div>

---

On a long task you rarely know what DSH is doing, what it costs, or whether you should take a
break. This plugin covers all three: a pet whose expression tracks the task, a readable
usage/cost panel, and a sitting-break reminder.

Everything stays on your machine (SQLite, falling back to JSON), bound to `127.0.0.1`, no
telemetry.

<table>
<tr>
<td width="50%"><img src="docs/images/stats.png" alt="Stats panel" /></td>
<td width="50%"><img src="docs/images/history.png" alt="Task history" /></td>
</tr>
<tr>
<td align="center"><sub>Stats: KPI deltas · trend chart · cost breakdown</sub></td>
<td align="center"><sub>History: filters · paging · filtered export</sub></td>
</tr>
</table>

## Features

| | |
| --- | --- |
| 🐳 **Pet** | A whale girl mirroring the task state: idle → start → thinking → streaming/tools → wrapping up → done / error / interrupted |
| 👗 **5 skins = 5 personas** | `whale` (JK, default) / `whale-ol` (secretary) / `whale-police` / `whale-hanfu` / `whale-qipao`. Switching skins swaps expressions, reactions and dialogue voice |
| 💬 **Interaction** | Click to pet (hearts + a line), 5 quick clicks for an easter egg, picked up while dragged, naps when idle, wanders around the screen on her own |
| 🖱 **Ctrl + wheel to resize** | 40%–300% without opening the panel; plain scrolling past her never changes it |
| ⏰ **Sitting reminder** | Nudges you every N minutes (default 60), with "go stretch" / "10 more minutes"; resets when you step away for 3 min |
| 📊 **Stats panel** | Six KPI cards (tokens, tasks, success rate, duration, cost, cache hits) with period deltas, a switchable bar chart, and a cost breakdown per model/project |
| 💰 **Cost estimation** | Official DeepSeek pricing with peak/off-peak halves and separately priced cache hits; only DeepSeek account / API-key tasks are priced |
| 🚨 **Budget alerts** | Per-task and daily caps on tokens and cost — bubble + system notification + `companion/budget-alert` event |
| 🗂 **History & export** | Server-side filtering (model / status / date / keyword), CSV or JSON export (Excel-friendly), export honours the current filter |
| 🧹 **Session management** | Adds the hard delete the host lacks: single delete from the session row menu plus bulk delete in the panel, with a running-session guard |
| 🖥 **Floating window** | With an Electron runtime installed: real tray icon, transparent always-on-top window, click-through except on the pet itself |
| 🧩 **Zero-dependency frontend** | The panel and pet page are server-rendered single-file HTML — no CDN, no web fonts, works offline; charts are hand-written SVG |

## Install

Requires Node.js `^22.19.0 || >=24.0.0`, [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and pnpm.

### Desktop GUI

**Plugin manager → Install plugin** → pick the npm registry → enter:

```
@qiuzhiyei/dsh-companion
```

Install → **enable** "DSH Companion" in the list → **fully quit DSH (including the tray) and relaunch**.

### CLI

```sh
dsh plugin --profile <your-profile> add @qiuzhiyei/dsh-companion   # recommended
dsh plugin --profile <your-profile> add github:qiuzhiyei/dsh-companion   # fallback
```

Both the npm package and the repo ship the compiled `dist/`, so no build step is needed.

> **Installed is not enabled**: the host only loads plugins that have an `insert` entry in the
> profile's `cordis.patch.yml`. Enable it in the plugin manager, then fully restart DSH.

### The desktop pet

Works out of the box: on first launch the plugin **downloads an Electron runtime in the
background** (~150 MB, China mirror first), logs the progress, and then shows the pet. That copy
is reused and never fetched again.

> To skip the desktop shell, set `server.shell: 'off'`. Panel, badge, stats and session
> management keep working; `http://127.0.0.1:17573` in a browser is the same pet.

### Try it without DSH

```sh
node demo.mjs        # mock events loop, temp data dir
node demo.mjs fast   # 20x speed, whole state machine in 30s
```

Then open `http://127.0.0.1:17573`. No API key, no DSH required.

## Usage

- **Sidebar badge**: one line at the bottom of the GUI sidebar; click it for the full panel
- **Panel**: `http://127.0.0.1:17573/panel` — history / stats / sessions / settings
- **Pet**: click to pet, drag to move, Ctrl + wheel to resize; the tray menu can show/hide,
  pause tracking, bring her back on screen, quit

## Config

Day-to-day switches live in the panel's Settings page (saved instantly). These go in the
profile's `cordis.patch.yml`:

| Key | Default | Meaning |
| --- | --- | --- |
| `dataDir` | `''` | Data directory; empty = `$DSH_HOME/dsh-companion` |
| `storage` | `'auto'` | `auto` (SQLite, fallback JSON) / `sqlite` / `json` |
| `currency` | `'CNY'` | Cost currency |
| `server.port` | `17573` | Loopback only; auto-increments up to 10 times when taken |
| `server.shell` | `'auto'` | `off` = no floating desktop window |
| `server.toast` | `true` | System toast for budget alerts |
| `adapter` | `'auto'` | `mock` = built-in simulator instead of real events |

Data lives in `$DSH_HOME/dsh-companion/`; delete it to reset everything.

## Custom skins

```
assets/skins/my-skin/
  manifest.json
  idle.png  casting.png  waiting.png  hooked.png  reeling.png
  done.png  error.png  interrupted.png
  pat.png  angry.png  dizzy.png  drag.png    ← optional reaction frames
```

```json
{
  "name": "my-skin",
  "displayName": "My skin",
  "states": { "idle": { "file": "idle.png" }, "done": { "file": "done.png" } },
  "reactions": { "pat": { "file": "pat.png" } }
}
```

Use transparent PNGs; the display area is 220×200 with `object-fit: contain`, so ~400 px tall
frames at ≤150 KB each work well. Crop every frame in a skin with the same box to avoid jitter.
Drop the folder in and it appears in the skin dropdown — no code changes. Art specs:
[docs/whale-skin-brief.md](docs/whale-skin-brief.md).

## Development

```sh
pnpm install
pnpm run build        # two tsc passes: node half + browser half (script mode)
pnpm test             # 86 tests
node demo.mjs         # offline demo
```

Rebuild and restart DSH after changes (link install, no need to re-add); browser-half-only changes
just need Ctrl+R.

Architecture decisions and pitfalls live in [AGENTS.md](AGENTS.md), public FAQ in
[docs/pitfalls.md](docs/pitfalls.md), release process in [npm发布.md](npm发布.md).

## Known limitations

- **Only DeepSeek first-party providers are priced** (`deepseek-account` / `deepseek-official`);
  third-party channels still record tokens but cost 0
- **No context meter**: DSH's own UI is more accurate; duplicating it here would disagree
- **Browser mode** has no click-through, always-on-top, transparency or system-idle detection —
  that needs the desktop shell

## License

[MIT](LICENSE) © 2026 QiuWenXiong