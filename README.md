<div align="center">

# 🐳 DSH 伴侣 · dsh-companion

**给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的伴飞插件**
桌宠陪伴 · 用量与费用统计 · 预算告警 · 界面增强

[English](README.en.md) · [功能](#功能) · [安装](#安装) · [配置](#配置) · [开发](#开发)

![license](https://img.shields.io/badge/license-MIT-blue)
![npm](https://img.shields.io/npm/v/@qiuzhiyei/dsh-companion?label=npm&color=cb3837)
![release](https://img.shields.io/github/v/release/qiuzhiyei/dsh-companion?label=release&color=blue)
![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)
![ci](https://github.com/qiuzhiyei/dsh-companion/actions/workflows/ci.yml/badge.svg?branch=main)

<img src="docs/images/pet.png" width="220" alt="桌宠：鲸鱼娘·JK 学院风" />

</div>

---

跑长任务时你通常不知道 DSH 在忙什么、花了多少、要不要歇一会儿。这个插件把三件事一起解决：
一只随任务状态换表情的桌宠、一套看得懂的用量/费用面板、一个到点提醒你起来走走的久坐闹钟。

数据全部留在本机（SQLite，失败降级 JSON），只监听 `127.0.0.1`，不联网上报。

<table>
<tr>
<td width="50%"><img src="docs/images/stats.png" alt="统计面板" /></td>
<td width="50%"><img src="docs/images/history.png" alt="历史任务" /></td>
</tr>
<tr>
<td align="center"><sub>统计：KPI 环比 · 趋势图 · 费用去向</sub></td>
<td align="center"><sub>历史：筛选 · 分页 · 按筛选导出</sub></td>
</tr>
</table>

## 功能

| 能力 | 说明 |
| --- | --- |
| 🐳 **桌宠** | 鲸鱼娘随任务状态换表情：待机 → 启动 → 思考 → 流式输出/工具执行 → 收尾 → 完成 / 出错 / 中断 |
| 👗 **5 套皮肤 = 5 种人格** | `whale`（JK，默认）/ `whale-ol`（秘书）/ `whale-police`（女警）/ `whale-hanfu`（中华娘）/ `whale-qipao`（旗袍）。换装连表情帧、反应帧、台词口吻一起换 |
| 💬 **互动** | 左键抚摸出爱心和台词、连点 5 下有彩蛋、拖着走时被拎起、闲时自己张望/打瞌睡，还会在屏幕上慢慢散步 |
| 🖱 **Ctrl + 滚轮缩放** | 40%–300%，不用开面板；平时滚文档经过她不会误改 |
| ⏰ **久坐提醒** | 坐够 N 分钟（默认 60）伸懒腰提醒，可选「起来走走 / 稍后 10 分钟」；离开电脑 3 分钟自动重算 |
| 📊 **统计面板** | 6 张 KPI（Token / 任务数 / 成功率 / 时长 / 费用 / 缓存命中）带环比，柱状图可切指标，另有费用去向排行 |
| 💰 **费用估算** | 拉 DeepSeek 官方定价，高峰/闲时（5 折）分档、缓存命中按 1/50 计；只算 DeepSeek 账号与 API Key 的任务 |
| 🚨 **预算告警** | 单任务 / 每日 × Token / 费用四档上限，触顶时气泡 + 系统通知 + `companion/budget-alert` 事件 |
| 🗂 **历史与导出** | 服务端筛选（模型 / 状态 / 日期 / 关键词），CSV / JSON 导出（Excel 友好），支持按当前筛选导出 |
| 🧹 **会话管理** | 补上宿主没有的「彻底删除会话」：会话行菜单单个删 + 面板批量删，运行中的会话拒删 |
| 🖥 **桌面悬浮窗** | 装了 Electron 运行时就自动有：真托盘 + 透明置顶 + 点击穿透（只有宠物本体接鼠标） |
| 🧩 **零依赖前端** | 面板与悬浮页是服务端生成的单文件 HTML，无 CDN、无外部字体，离线可用；图表是手绘 SVG |

## 安装

前置：Node.js `^22.19.0 || >=24.0.0`、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、pnpm。

### 桌面版 GUI

**插件管理器 → 安装插件** → 源选「中国大陆镜像源」或「npm 官方源」→ 输入包名：

```
@qiuzhiyei/dsh-companion
```

安装 → 在列表里把 **「DSH 伴侣」** 启用 → **完全退出 DSH（含托盘）再重开**。

### 命令行

```sh
dsh plugin --profile <你的 profile> add @qiuzhiyei/dsh-companion   # 推荐
dsh plugin --profile <你的 profile> add github:qiuzhiyei/dsh-companion   # 备选
```

包和仓库都带着编译好的 `dist/`，装完即用，不需要构建。

> **装完要启用**：宿主只加载 profile 里 `cordis.patch.yml` 有 `insert` 条目的插件，
> 装完请在插件管理器里启用，然后完全退出重开 DSH。

### 桌宠

装完插件就能用：首次启动时插件会**在后台自动下载 Electron 运行时**（约 150 MB，国内镜像优先），
进度写在 DSH 日志里，下完桌宠自己出现，之后不再联网。

> 不想要桌面壳：设 `server.shell: 'off'`。面板、角标、统计、会话管理照常，浏览器打开
> `http://127.0.0.1:17573` 是同一只桌宠。

### 先看看长什么样

```sh
node demo.mjs        # mock 事件自动循环，数据写临时目录
node demo.mjs fast   # 20 倍速，30 秒看完一整套状态
```

打开 `http://127.0.0.1:17573`。不需要 API Key，也不需要 DSH。

## 使用

- **侧边栏角标**：GUI 侧边栏底部一行「今日 X token」，点它弹出完整面板
- **面板**：`http://127.0.0.1:17573/panel` —— 历史 / 统计 / 会话 / 设置
- **桌宠**：左键抚摸、按住拖动、Ctrl + 滚轮缩放；托盘菜单可显示隐藏、暂停统计、回到屏幕、退出

## 配置

日常开关都在面板「设置」页（改一个存一个，没有保存按钮）。需要写进 profile 的 `cordis.patch.yml`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `''` | 数据目录；空 = `$DSH_HOME/dsh-companion` |
| `storage` | `'auto'` | `auto`（SQLite 优先，失败降级 JSON）/ `sqlite` / `json` |
| `currency` | `'CNY'` | 费用货币 |
| `server.port` | `17573` | 被占用时自动 +1（最多 10 次），仅回环 |
| `server.shell` | `'auto'` | `off` = 不要桌面悬浮窗 |
| `server.toast` | `true` | 预算告警是否弹系统 Toast |
| `adapter` | `'auto'` | `mock` = 内置模拟器，不看真实任务 |

数据在 `$DSH_HOME/dsh-companion/`，删掉目录即彻底重置。

## 自制皮肤

```
assets/skins/my-skin/
  manifest.json
  idle.png  casting.png  waiting.png  hooked.png  reeling.png
  done.png  error.png  interrupted.png
  pat.png  angry.png  dizzy.png  drag.png    ← 反应帧，可选
```

```json
{
  "name": "my-skin",
  "displayName": "我的皮肤",
  "states": { "idle": { "file": "idle.png" }, "done": { "file": "done.png" } },
  "reactions": { "pat": { "file": "pat.png" } }
}
```

PNG 需透明底，显示区 220×200（`object-fit: contain` 不拉伸），源图高 400px、单帧 ≤150 KB 为宜；
同一套所有帧用统一裁剪框，切换才不会跳位。放进去就出现在设置页皮肤下拉里，无需改代码。
风格与美术规格见 [docs/whale-skin-brief.md](docs/whale-skin-brief.md)。

## 开发

```sh
pnpm install
pnpm run build        # 双 tsc：node 半边 + 浏览器半边（脚本模式）
pnpm test             # 86 项
node demo.mjs         # 离线演示
```

改完 `pnpm run build` + 重启 DSH 即生效（link 安装，不用重新 add）；只改浏览器半边可 Ctrl+R。

架构决策、契约、踩过的坑都记在 [AGENTS.md](AGENTS.md)，公共 FAQ 见 [docs/pitfalls.md](docs/pitfalls.md)，
发版流程见 [npm发布.md](npm发布.md)。

## 已知限制

- **费用只对 DeepSeek 官方渠道计价**（`deepseek-account` / `deepseek-official`）：走第三方渠道的任务 Token 照记，费用恒 0
- **不做上下文进度条**：DSH 自带 UI 的口径更准，插件侧重复做只会对不上
- **浏览器模式**没有点击穿透 / 置顶 / 透明 / 系统空闲检测，需要桌面壳

## License

[MIT](LICENSE) © 2026 QiuWenXiong