# 鲸鱼娘皮肤制作交接书（给接手的 AI）

> **状态：已交付 ✅** —— WorkBuddy 出图 5 套服装帧包（`D:\Software\Angent\WorkBuddy_File\2026-10-20-11-20-10\鲸鱼娘5套定稿\`），
> 已按 B 段流程接入为 `assets/skins/whale{,-ol,-police,-hanfu,-qipao}`（7 动作帧 → 8 状态映射，
> 见 AGENTS.md）。本文档保留作流程记录与下次出图的提示词模板。

> 任务：为 `dsh-companion` 插件的桌面伴侣默认皮肤「Q版鲸鱼娘」制作 **8 张状态图**，
> 并（可选）接入工程替换现有的手绘占位 SVG。
> 分两段：**A 出图（必做）**、**B 工程接入（可选——若图片交回原会话处理则跳过）**。

---

## 1. 背景（30 秒了解）

- 项目：DSH 伴侣插件，仓库 `D:\Code_Project\Dsh_Plugin_Project\dsh-companion`（Node + TypeScript + pnpm，cordis 插件）。
- 桌宠 = Electron 透明置顶悬浮窗，页面里一个 `<img>` 按当前工作状态加载对应皮肤图。
- 皮肤系统 = `assets/skins/<皮肤名>/` 目录 + `manifest.json`；状态文件经内置 HTTP 服务
  （`/skins/<皮肤名>/<状态名>.<任意扩展名>`）喂给页面。**URL 里的扩展名会被服务端剥掉**，
  实际文件由 manifest 决定 → 换成 PNG 不用改任何 URL 逻辑。
- 支持格式：`.png .gif .webp .apng .svg .jpg .jpeg`（`src/ui/skins.ts` CONTENT_TYPES）。
- 现状：`assets/skins/whale/` 里是 8 张手绘 SMIL SVG 占位图，**用户嫌丑，要用 AI 生成图整体替换**。
- 显示区：220×200 CSS 像素，`#pet img` 已是 `object-fit: contain`——**方形图原样完整显示，不会拉伸**。
- ⚠ Electron 窗口整体透明悬浮在桌面上：**图必须透明背景**，否则桌宠会变成一块白底板。

## 2. 八个状态（图的用途，别对错号）

| 文件名（严格小写） | 状态语义 | 画面建议 |
|---|---|---|
| `idle` | 待机（无任务） | 闭眼打盹，头顶飘 zzz，双手身前交叠，尾巴放松 |
| `casting` | 任务启动 | 元气举手/挥手出发，星星眼，闪光粒子 |
| `waiting` | 模型思考中 | 单手托腮望斜上方，「…」思考泡泡，歪头 |
| `hooked` | 输出/工具执行中 | 专注，在悬浮全息蓝键盘上敲字，屏幕光映脸 |
| `reeling` | 任务收尾 | 闭眼舒心笑，双臂上举伸懒腰，小音符 |
| `done` | 任务完成 | 开心跳起，双臂 V 字，头顶背鳍喷小水花，金色✨ |
| `error` | 任务出错 | 蚊香眼，委屈波浪嘴，头顶乌云+闪电，尾巴耷拉 |
| `interrupted` | 任务中断 | 吓一跳，瞪眼小瞳孔，双手捂脸，红色「!」气泡 |

## 3. 生图提示词

### 3.1 基础人设（每张都原样带上，一字不改）

中文：

```
Q版鲸鱼娘，DeepSeek品牌形象拟人化，二头身chibi比例，可爱圆脸，大眼睛，
蓝色短发，头顶一个小鲸鱼背鳍（代替呆毛），身后有一条蓝色鲸鱼尾巴，
身穿蓝白配色科技感连衣裙（白色上身、蓝色渐变裙摆、青色荧光裙边），
胸前有一个小小的蓝色鲸鱼徽记，卡通渲染风格，柔和渐变，海洋元素点缀，
可爱治愈系，高清细节，全身像，正面视角，纯白背景，居中构图，
角色占画面80%，四周留边距，无文字，无水印
```

英文（Midjourney/SD 系优先用这版）：

```
chibi whale girl mascot, anthropomorphized DeepSeek brand image, 2-head-tall
chibi proportions, cute round face, big sparkling eyes, short blue hair,
small blue whale dorsal fin on top of head, blue whale tail behind her,
blue-and-white tech-style dress (white bodice, blue gradient skirt, glowing
cyan hem), tiny blue whale emblem on chest, cartoon cel-shading, soft
gradient lighting, subtle ocean bubble accents, kawaii healing style,
full body, front view, plain white background, centered composition,
character fills 80% of frame, no text, no watermark, high detail
```

### 3.2 状态短语（追加在基础人设后面）

| 状态 | 中文追加 | 英文追加 |
|---|---|---|
| idle | 闭眼打盹，头顶飘zzz，双手身前交叠，尾巴放松下垂 | eyes closed dozing, zzz floating above head, hands clasped in front, relaxed tail |
| casting | 元气举手出发，星星眼，灿烂笑容，闪光粒子 | energetic salute, sparkling star eyes, bright smile, sparkle particles |
| waiting | 单手托腮望斜上方，「…」思考泡泡，微微歪头 | hand on chin gazing upward, thought bubble with dots, head tilted |
| hooked | 专注认真，在悬浮全息蓝键盘上敲字，屏幕光映脸 | focused, typing on floating blue holographic keyboard, screen glow on face |
| reeling | 闭眼舒心微笑，双臂向上伸懒腰，小音符飘 | relieved smile eyes closed, arms stretched up, music notes floating |
| done | 开心跳起，双臂举V字，背鳍喷小水花，金色闪光 | jumping happily, arms in V, water spout from head fin, golden sparkles |
| error | 蚊香眼，委屈波浪嘴，头顶乌云闪电，尾巴耷拉 | dizzy spiral eyes, sad wobbly mouth, dark cloud with lightning, drooping tail |
| interrupted | 吓一跳，瞪大小瞳孔，双手捂脸，红色「!」气泡 | startled, wide eyes tiny pupils, hands on cheeks, red exclamation bubble |

### 3.3 负面提示词

```
文字, 水印, 签名, 边框, 写实, 真人照片, 恐怖, 多余手指, 多余肢体, 裁切, 复杂背景, 场景
--no text, watermark, signature, frame, realistic, photo, horror, extra fingers, extra limbs, cropped, complex background
```

### 3.4 一致性（最重要）

- 8 张**锁同一个 seed**（或用角色参考图/垫图功能），基础人设段一字不动，只换状态短语。
- 角色在画面中的**大小、位置、色板必须一致**——状态切换时图片是瞬间替换的，比例不一致会「跳」。

## 4. 图片硬性规格

1. **PNG，透明背景**（工具不支持透明就纯白底交付，并在交付说明里注明「需抠底」，由接入方处理）
2. 画布**正方形 1:1，≥1024×1024**（显示端会缩到 220×200，`object-fit: contain`）
3. 全身完整入画，道具（泡泡/乌云/气泡）离边缘留距，防裁切
4. 恰好 8 张，文件名 = 上表状态名小写（`idle.png` … `interrupted.png`）
5. 加分项：任一状态可用**循环动图**（GIF/WebP/APNG，循环 1–3s，单文件 ≤2MB）——用了就在 manifest 里填对应扩展名，并在交付说明里写明哪个状态是动图
6. 图内**不要自带投影/阴影**（页面容器已有 drop-shadow）

## 5. 交付（A 段完成线）

放到任意目录（建议 `D:\Downloads\whale-skin\`），8 张按状态名命名，附一句话说明：
背景是否已透明、哪些状态是动图。到此 A 段结束；若你还要负责接入工程，继续 B 段。

---

## 6. B 段：工程接入（可选）

前提：本机已装 Node.js ≥ 22 + pnpm；插件以 link 模式挂在 DSH profile（改完构建+重启即生效，无需重装）。

### 6.1 替换素材

1. 8 张图放入 `assets/skins/whale/`
2. **删除**同目录旧的 8 个 `*.svg`（idle/casting/waiting/hooked/reeling/done/error/interrupted.svg）
3. `manifest.json` 的 `states` 改为实际文件名（PNG 版如下；若某状态是动图就填实际扩展名，`labels` 等其余字段不动）：

```json
{
  "name": "whale",
  "displayName": "Q版鲸鱼娘",
  "version": "1.1.0",
  "author": "dsh-companion",
  "labels": {
    "idle": "待机中",
    "casting": "任务启动",
    "waiting": "模型思考中…",
    "hooked": "输出 / 工具执行中",
    "reeling": "收尾中…",
    "done": "任务完成",
    "error": "任务出错",
    "interrupted": "任务中断"
  },
  "states": {
    "idle": { "file": "idle.png" },
    "casting": { "file": "casting.png" },
    "waiting": { "file": "waiting.png" },
    "hooked": { "file": "hooked.png" },
    "reeling": { "file": "reeling.png" },
    "done": { "file": "done.png" },
    "error": { "file": "error.png" },
    "interrupted": { "file": "interrupted.png" }
  }
}
```

### 6.2 同步测试（不改会红）

`tests/plugin-smoke.test.mjs` 里这段锁的是旧 SVG：

```js
  const skinRes = await fetch(`${baseUrl}/skins/whale/hooked.svg`)
  assert.ok(skinRes.ok)
  const svgText = await skinRes.text()
  assert.ok(svgText.includes('<svg'))
  assert.ok(svgText.includes('<animate'), 'whale 皮肤应含 SMIL 动画')
```

替换为（若 hooked 交付为动图，把文件名/魔数按实际格式改）：

```js
  const skinRes = await fetch(`${baseUrl}/skins/whale/hooked.png`)
  assert.ok(skinRes.ok)
  assert.ok((skinRes.headers.get('content-type') || '').includes('image/png'), '状态资源应为 PNG')
  const pngBytes = new Uint8Array(await skinRes.arrayBuffer())
  assert.equal(pngBytes[0], 0x89, 'PNG 魔数 \\x89PNG')
  assert.equal(pngBytes[1], 0x50)
```

其余皮肤断言（whale 排第一、monitor 存在、fisherman 已移除）**不要动**。

### 6.3 同步文档

`AGENTS.md` 设计决定里「皮肤下拉默认皮肤（whale 鲸鱼娘）…」一条：把手绘 SMIL SVG 的描述
改为 AI 生成 PNG（保留状态情绪一览与迁移事实），其余内容勿动。

### 6.4 构建与测试（都在仓库根目录）

```powershell
pnpm run build        # 双 tsc，exit 0 才算过
# 测试必须用后台 Job 模式跑（直接跑可能因 HTTP 句柄卡死）：
$job = Start-Job -ScriptBlock { Set-Location 'D:\Code_Project\Dsh_Plugin_Project\dsh-companion'; pnpm test 2>&1 | Out-String }
Wait-Job $job -Timeout 160
(Receive-Job $job) -split "`n" | Select-String 'tests |pass |fail |not ok'
Remove-Job $job -Force
```

预期：**tests 73, pass 73, fail 0**（输出前缀有 GBK 乱码属正常显示问题）。

### 6.5 提交与生效

```powershell
git add -A
git commit -m "feat: 鲸鱼娘皮肤换装 AI 生成图（SVG 占位 → PNG）"
```

生效方式：**完全退出并重开 DSH**（皮肤资源走 node 半边的 HTTP 服务）。

### 6.6 避坑清单（工程侧红线）

- 仓库无远程（`git remote -v` 为空），只在本地提交即可
- 文件一律 **UTF-8 无 BOM**
- 若需要动 `src/ui/pages.ts`：页面内嵌 JS **只能字符串拼接，禁止反引号模板/`${`**（有测试锁）；
  改完把 `<script>` 内容抽出来跑 `node --check` 验语法
- 皮肤名 `whale` **不可改名**（设置迁移 `whaleMigrated` 和测试都引用它）
- **不得复活 fisherman**（用户明确要求删除）
- 台词人格包（LINE_PACKS/petPersona）、隐私模式、计费逻辑与皮肤**正交**，一概不碰
- PowerShell 输出中文乱码是显示问题，不代表文件坏了；别用输出判断文件内容，用 `read`/`Get-Content -Encoding utf8`

## 7. 验收清单

- [ ] 8 张图同角色同风格同比例，透明背景（桌面无白底）
- [ ] 重启 DSH 后桌宠显示新图，各状态切换正确（可用 `node demo.mjs` 无 DSH 预览 mock 状态循环）
- [ ] 面板「设置 → 皮肤」下拉 whale 第一位，切 monitor 再切回正常
- [ ] 抚摸/拖拽/连点彩蛋动画正常（CSS transform 与图片格式无关）
- [ ] `pnpm test` 73 全绿
- [ ] git 已提交、工作区干净
