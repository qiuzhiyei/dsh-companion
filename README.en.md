<div align="center">

# 🐳 DSH Companion · dsh-companion

**A companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**
desktop pet · usage & cost stats · budget alerts · GUI enhancements

[中文](README.md) · [Quick start](#quick-start) · [Features](#features) · [Config](#config) · [Skins](#custom-skins)

![license](https://img.shields.io/badge/license-MIT-blue)
![npm](https://img.shields.io/npm/v/@qiuzhiyei/dsh-companion?label=npm&color=cb3837)
![release](https://img.shields.io/github/v/release/qiuzhiyei/dsh-companion?label=release&color=blue)
![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)
![ci](https://github.com/qiuzhiyei/dsh-companion/actions/workflows/ci.yml/badge.svg?branch=main)
![topic](https://img.shields.io/badge/topic-dsh--plugin-8a2be2)

<img src="docs/images/pet.png" width="220" alt="Desktop pet: whale girl, JK uniform" />

</div>

---

DeepSeek Harness (`dsh`) is an "everything is a plugin" agent harness. While it runs long
tasks you usually can't tell what it's doing, what it costs, or whether you should take a
break. **DSH Companion** answers all three: a desktop pet that reacts to task state, a
usage/cost panel you can actually read, and a sitting reminder that nudges you to stand up.

Everything stays local (`node:sqlite` or JSON), the HTTP server binds `127.0.0.1` only, and
nothing is reported anywhere — the single outbound request is fetching DeepSeek's official
price page.

<table>
<tr>
<td width="50%"><img src="docs/images/stats.png" alt="Stats panel" /></td>
<td width="50%"><img src="docs/images/history.png" alt="History" /></td>
</tr>
<tr>
<td align="center"><sub>Stats: KPIs vs. previous period · chart · where the money went</sub></td>
<td align="center"><sub>History: filter chips · paging · export what you filtered</sub></td>
</tr>
</table>

## Features

| | |
| --- | --- |
| 🐳 **Desktop pet** | A chibi whale girl that follows DSH task state: idle → starting → thinking → working (streaming / tool calls) → wrapping up → done / error / interrupted |
| 👗 **5 skins = 5 personalities** | `whale` (JK uniform, default), `whale-ol` (secretary), `whale-police`, `whale-hanfu`, `whale-qipao`. A skin swaps the frames, the reaction art **and** the dialogue voice |
| 💬 **Interactions** | Click to pet (hearts + a line), click 5× fast for a dizzy easter egg, pick her up while dragging, she gets grumpy on landing; when idle she looks around, stretches, dozes off, and **wanders around your screen** on her own — snapping back home the moment you touch her |
| 🖱 **Ctrl + wheel to resize** | Hold **Ctrl** while scrolling over her to grow / shrink (40%–300%, 8% per notch) — no need to open the panel. A plain scroll never resizes her, so scrolling a document behind her is safe. Same value as *Settings → Companion → Scale*, saved immediately |
| ⏰ **Sitting reminder** | Nudge after N minutes (default 60, 5–480, can be off) with "go stretch / 10 more minutes"; the timer resets itself when you leave the keyboard for 3+ minutes |
| 📊 **Stats panel** | 6 KPI cards (tokens / tasks / success rate / duration / cost / cache hit), **each with a vs-previous-period delta**; a bar chart switchable between tokens, cost and duration; **cost breakdown** by model and by project |
| 💰 **Cost estimate** | Pulls DeepSeek's official pricing, bills **peak / off-peak (50%)** separately, prices cache hits at the cache rate, pins each task to the rate of its start time. Only DeepSeek account/API-key tasks are billed; third-party channels still record tokens at zero cost |
| 🚨 **Budget alerts** | Per-task / daily limits for both tokens and cost; on breach the pet bubbles, a system notification fires and `companion/budget-alert` is emitted. The settings page shows today's usage bar |
| 🗂 **History & export** | Server-side filtering (model / status / date range / keyword), CSV & JSON export (BOM included, Excel-friendly), export respects the current filter |
| 🧹 **Session management** | True session deletion, which the host does not offer: a menu item on each GUI session row plus batch delete in the panel, guarded by safety checks (running sessions are refused) |
| 🖥 **Desktop shell (optional)** | Install Electron and get a real tray, a transparent frameless always-on-top window, and click-through (only the pet body catches the mouse — clicks on the transparent area go straight to the desktop) |
| 🔔 **System notifications** | Only for long tasks (≥60 s) finishing/failing and budget breaches; short tasks stay quiet. Toggle in settings |
| 🧩 **Zero front-end deps** | Panel and overlay are single-file server-rendered HTML — no bundler, no CDN, no webfonts; charts are hand-drawn SVG. Works offline |

## Quick start

**Requirements**: Node.js `^22.19.0 || >=24.0.0`, [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (0.2.0-rc line), pnpm.

### Option 1 — desktop GUI (no terminal needed)

DSH desktop → **Plugin Manager** → **Install plugin** → pick the npm official registry or a mirror → enter:

```
@qiuzhiyei/dsh-companion
```

→ install → toggle the plugin **on** in the list → **fully quit DSH (including the tray) and relaunch**.

### Option 2 — command line

```sh
# recommended: from npm (uses your configured registry / mirror, immune to GitHub connectivity)
dsh plugin --profile <your-profile> add @qiuzhiyei/dsh-companion

# alternative: straight from the GitHub repo (it ships a compiled dist/)
dsh plugin --profile <your-profile> add github:qiuzhiyei/dsh-companion

dsh --profile <your-profile>
```

> `dsh plugin` simply forwards its arguments to pnpm inside the profile directory, so the two lines
> are `pnpm add @qiuzhiyei/dsh-companion` and `pnpm add github:qiuzhiyei/dsh-companion` under the hood.
> Both the package and the repo **ship a compiled `dist/`** (~0.3 MB), so there is no build step and
> nothing trips pnpm 10+'s "git dependencies may not run build scripts" gate.
>
> **Why the `@qiuzhiyei/` prefix**: the bare name `dsh-companion` on npm is already taken by another
> author, so the release lives under the author's scope
> ([npm page](https://www.npmjs.com/package/@qiuzhiyei/dsh-companion)). The plugin's display name and
> behaviour in DSH are unaffected.

> **Installed is not enabled**: the host only loads a plugin when its `insert` entry exists in the
> profile's `cordis.patch.yml`, so you must toggle it **on** in the Plugin Manager above, then fully
> quit (tray included) and relaunch DSH.

**Hacking on the source?** Clone it and link it instead — edits take effect after `pnpm run build` + a restart:

```sh
git clone https://github.com/qiuzhiyei/dsh-companion.git
cd dsh-companion && pnpm install && pnpm run build

cd .. && dsh plugin --profile <your-profile> add ./dsh-companion
```

Once DSH starts:

- **Sidebar badge**: one line at the bottom of the GUI (`today 30.98M tokens`); click it to open the full panel right inside the GUI
- **Overlay**: `http://127.0.0.1:17573` (the port auto-increments up to +10 if taken)
- **Panel**: `http://127.0.0.1:17573/panel`

> **The pet runs in browser-tab mode by default**: the floating desktop window needs an
> optional shell, and the npm package does **not** ship `electron` (it sits in
> `devDependencies`, 100 MB+, deliberately unpublished). See
> [Getting the floating desktop pet](#getting-the-floating-desktop-pet).

### Try it without DSH

```sh
node demo.mjs        # mock event loop; data goes to a temp dir, Ctrl+C exits cleanly
node demo.mjs fast   # 20× speed
```

Then open `http://127.0.0.1:17573`. No DSH, no API key needed.

## Config

Plugin config lives in the profile's `cordis.patch.yml` (schemastery). **Everything you touch
day to day is in the panel's Settings tab** — changes apply immediately, no save button.

| Key | Default | Meaning |
| --- | --- | --- |
| `adapter` | `'auto'` | `auto` = real DSH events, `mock` = built-in simulator |
| `dataDir` | `''` | Data directory; empty = `$DSH_HOME/dsh-companion` (or `~/.dsh/dsh-companion`) |
| `storage` | `'auto'` | `auto` (SQLite first, JSON fallback) / `sqlite` / `json` |
| `currency` | `'CNY'` | Cost currency |
| `settleMs` | `8000` | How long the final expression stays on screen |
| `logEvents` | `false` | Debug: print host events |
| `server.enabled` | `true` | Start the local HTTP server (loopback only) |
| `server.host` / `server.port` | `127.0.0.1` / `17573` | Port auto-increments by 1 (up to 10 tries) when busy |
| `server.shell` | `'auto'` | Launch the optional Electron shell when available |
| `server.toast` | `true` | Try a native toast for budget alerts |
| `mock.auto` / `mock.intervalMs` / `mock.speed` | `false` / `45000` / `1` | Simulator behaviour |

<img src="docs/images/settings.png" alt="Settings" />

**Tip**: hover the pet and **hold Ctrl while scrolling** to resize her on the spot (40%–300%, 8% per notch; ⌘ on macOS) —
the same value as *Settings → Companion → Scale*, saved immediately, panel slider follows. A plain scroll does not resize (no accidental changes).


All data stays in `$DSH_HOME/dsh-companion/` (`pet.sqlite` or `pet.json`, plus
`pricing-official.json`). Delete that folder to reset.

## Desktop shell (optional)

The host does not expose Electron's tray/window APIs to plugins, so the desktop-grade
experience ships as an **optional** shell process (`electron/`) — skip it and the browser
mode still works:

- transparent, frameless, always-on-top window, hidden from the taskbar
- **hit area = the pet's body**; clicks on the transparent surroundings pass through to
  whatever is underneath
- tray menu: show/hide, pause tracking, open panel, switch skin, export,
  **bring companion back on screen**, quit
- remembers its position and clamps itself back on screen (dragging her off-screen cannot
  make her "disappear")
- tied to DSH's lifetime: clean plugin unload exits the shell immediately; if the host is
  killed, a watchdog exits within ~15 s

> **The pet runs in browser-tab mode by default**: the floating desktop window needs an
> optional shell, and the npm package does **not** ship `electron` (it sits in
> `devDependencies`, 100 MB+, deliberately unpublished). **The plugin fetches it on demand** —
> see below.

### Getting the floating desktop pet (auto-fetched runtime)

On startup the plugin looks for an Electron runtime in this order:

1. env var `DSH_COMPANION_ELECTRON` (point it at an executable — manual escape hatch)
2. an `electron` you already installed (link/dev install or `add -D electron`)
3. **`<data dir>/runtime/electron-<version>/`** — the copy the plugin downloaded itself

If none matches, it downloads ~150 MB in the background (China mirror first, GitHub as
fallback), extracts it into the data dir and launches the shell. **The download never blocks
DSH startup** — progress goes to the DSH log and the pet appears when it finishes. That copy
is reused forever afterwards.

```
[dsh-companion] 本机暂无 Electron 运行时，后台自动获取中（桌面桌宠装好后会自动出现）…
[dsh-companion] 正在下载 Electron 运行时：42.0 MB / 150.6 MB 28%
[dsh-companion] 下载完成，正在解压 Electron 运行时…
[dsh-companion] electron 伴侣壳已启动 → http://127.0.0.1:17573
```

> - **Don't want the download?** Set `server.shell: 'off'` — panel, badge, stats and session
>   management all keep working; you just get no floating window or tray. The browser page at
>   `http://127.0.0.1:17573` is the same pet.
> - **Download failed?** A marker is written and it won't retry for 6 hours (no startup stalls);
>   the log prints the manual command `dsh plugin --profile <your-profile> add -D electron`.
> - **Reset the cache**: delete `<data dir>/runtime`.

## Custom skins

```
assets/skins/my-skin/
  manifest.json
  idle.png  casting.png  waiting.png  hooked.png  reeling.png
  done.png  error.png  interrupted.png
  pat.png  angry.png  dizzy.png  drag.png    ← reaction frames, optional
```

```json
{
  "name": "my-skin",
  "displayName": "My skin",
  "labels": { "idle": "Idle", "done": "Done" },
  "states": { "idle": { "file": "idle.png" }, "done": { "file": "done.png" } },
  "reactions": { "pat": { "file": "pat.png" } }
}
```

- Skin and file names are restricted to `[A-Za-z0-9_-]`; missing frames fall back
  (`interrupted→error→done`, …)
- PNG / SVG / GIF / WebP are supported. **PNGs must have a transparent background**; the
  display area is 220×200 with `object-fit: contain`. ~400 px tall source frames, ≤150 KB
  each, and the **same crop box for every frame** so switching does not jitter
- With `reactions` frames the pet swaps whole images for interactions; without them it falls
  back to pure CSS animation — both kinds of skin work
- Drop the folder in and it shows up in the settings dropdown; no code changes required
  (dialogue packs are documented in [AGENTS.md](AGENTS.md))

## Development

```
src/index.ts            plugin entry (cordis: name + apply + Schema config)
src/client/index.ts     browser half: sidebar badge, panel window, session-row delete item
src/adapter/            real event adapter / mock simulator
src/state-machine/      animation state machine, task tracker, budget, cost
src/pricing/            DeepSeek official pricing fetch & parse
src/storage/            SQLite (JSON fallback), stats aggregation, export
src/ui/                 HTTP + SSE server, pages, tray, skin registry
src/ui-enhance/         host GUI enhancements (session deletion)
electron/               optional desktop shell
assets/skins/           5 skins
tests/                  node --test, 86 tests
```

```sh
pnpm run build          # double tsc: node half + browser half (script mode)
pnpm test               # 86 tests, all green
node demo.mjs           # offline demo
```

- node half changes (server/stats/alerts) → quit and restart DSH
- browser half changes (badge/panel) → restart DSH, then Ctrl+R
- installed as a link (`link:<path>`): rebuild + restart, no reinstall needed

Architecture decisions and every pitfall we hit live in [AGENTS.md](AGENTS.md) (an onboarding
document for AI collaborators) and [docs/pitfalls.md](docs/pitfalls.md). The release procedure is in
[npm发布.md](npm发布.md) (Chinese).

## Known limitations

- **Cost only applies to DeepSeek's official providers** (`deepseek-account`, `deepseek-official`).
  Third-party channels (e.g. Alibaba Bailian) record tokens with zero cost — same convention
  as DSH's own ledger.
- **No context-window progress bar**: DSH's built-in UI is more accurate; duplicating it in a
  plugin drifts (especially with sub-agent sessions).
- **Browser mode** cannot do click-through / always-on-top / transparency / system idle
  detection — install the desktop shell for those.
- **System notifications** rely on Windows toast + Focus Assist; other platforms degrade to
  logs and bubbles.
- The desktop shell requires you to install Electron; the plugin never installs anything by itself.

## Contributing

- Bugs and feature requests: open an [issue](/issues) or drop by
  [DSH Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- Writing your own DSH plugin? Add the **`dsh-plugin`** topic to your repo so it shows up in
  [github.com/topics/dsh-plugin](https://github.com/topics/dsh-plugin) (the official
  recommendation)

## License

[MIT](LICENSE) © 2026 QiuWenXiong