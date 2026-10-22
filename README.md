<div align="center">

# 🐳 DSH 伴侣

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的伴飞插件

桌宠 · 用量统计 · 费用估算 · 预算告警 · 界面增强

[English](README.en.md) · [npm](https://www.npmjs.com/package/@qiuzhiyei/dsh-companion)

![npm](https://img.shields.io/npm/v/@qiuzhiyei/dsh-companion?label=npm&color=cb3837)
![ci](https://github.com/qiuzhiyei/dsh-companion/actions/workflows/ci.yml/badge.svg?branch=main)

<img src="docs/images/pet.png" width="180" alt="鲸鱼娘桌宠" />

</div>

## 功能

- 🐳 **桌宠**：随任务状态换表情，可摸、可拖，闲下来自己散步
- 👗 **5 套皮肤**：JK / 秘书 / 女警 / 中华娘 / 旗袍，表情与台词口吻一起换
- 📊 **统计面板**：Token、任务数、成功率、时长、费用、缓存命中，都带环比
- 💰 **费用估算**：DeepSeek 官方计价，高峰 / 闲时分档，缓存命中单独计价
- 🚨 **预算告警**：单任务 / 每日上限，Token 或费用，触顶弹气泡和系统通知
- 🗂 **历史与导出**：按模型 / 状态 / 日期 / 关键词筛选，导出 CSV / JSON
- 🧹 **会话管理**：彻底删除会话（宿主只提供归档）
- ⏰ **久坐提醒**：坐够 N 分钟提醒起来走走
- 🖥 **桌面悬浮窗**：透明置顶、点击穿透、真托盘

## 安装

**桌面版**：插件管理器 → 安装插件 → 输入 `@qiuzhiyei/dsh-companion` → 启用 → 完全退出 DSH 重开。

**命令行**：

```sh
dsh plugin --profile <你的 profile> add @qiuzhiyei/dsh-companion
```

> 装完要在插件管理器里**启用**，再完全退出重开 DSH。
> 桌宠首次启动会自动下载运行时（约 150 MB，国内镜像），不用手动装 electron。

## 开发

```sh
pnpm install && pnpm run build
pnpm test
```

架构决策与踩过的坑见 [AGENTS.md](AGENTS.md)，发版流程见 [npm发布.md](npm发布.md)。

## License

[MIT](LICENSE) © 2026 QiuWenXiong