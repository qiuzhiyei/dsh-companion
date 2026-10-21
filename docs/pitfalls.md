# 开发陷阱与 FAQ

写给想给 **DeepSeek Harness** 写插件、或者想改这个插件的人。全部来自真实踩坑。
（内部架构决策与逐条设计取舍在仓库根的 [AGENTS.md](../AGENTS.md)。）

## 通用：写 DSH 插件

1. **Node 版本**：DSH 要求 `^22.19.0 || >=24.0.0`。旧版本只告警 `EBADENGINE` 不阻断，
   但会在运行时踩到 `node:sqlite` 之类的新 API。
2. **npm dist-tag 坑（最大的一个）**：`@deepseek-ai/dsh-tools` 这类包的 `latest` 可能是过期版本，
   真正在迭代的是 `next` tag。别手动 `npm i` 覆盖脚手架锁定的版本。
3. **版本线对齐**：所有 `@deepseek-ai/dsh-*` 保持在同一条 rc 线上，否则 pnpm 会装出两份模块，
   运行时表现为 `instanceof` 莫名其妙失败。
4. **`@deepseek-ai/cordis` 是 peerDependency**：运行时代码只 `import type { Context }`
   （编译期擦除），`ctx` 由宿主传入。不要 import cordis 的运行时值。
5. **纯 ESM**：`"type": "module"` + `module: esnext` + `moduleResolution: bundler`；
   相对导入必须带 `.js` 后缀。
6. **`dsh plugin add <dir>` 的相对路径锚定「调用目录」**，不是插件目录——所以在插件的**父目录**执行。
7. **bundle 的 `cordis.patch.yml` 里 `name` 是包名**（走 node_modules 解析），不是相对路径。
8. **注册即 effect**：`ctx.on()` / `ctx.tools.register()` 卸载时自动清理；你自己的
   timer / 连接 / 服务必须包在 `ctx.effect(() => { acquire; return cleanup })` 里，
   否则插件重载会泄漏（本插件把存储 / HTTP / 托盘 / 适配层全收进一个 effect）。
9. **加载顺序 = 服务依赖**：靠 `export const inject` 声明依赖，不要指望文件顺序。
10. **`pnpm run build` 必须先于 `dsh plugin add`**：`files` 里含 `dist`，没 build 就装会拿到空包。
11. **插件管理器的标题/描述/图标不走代码**：宿主不激活插件、直读 `exports['./locale/*.json']`
    和 `exports['./icon']`。缺了就退化成包名 + 默认画。
12. **`ctx` 是 Proxy**：没在 `inject` 里声明的服务属性直读会**同步抛**
    `cannot get property "..." without inject`。可选读取用 `ctx.get('<服务名>')`（未提供返回 undefined）。
13. **给插件仓库加 `dsh-plugin` 话题**，才会出现在
    [github.com/topics/dsh-plugin](https://github.com/topics/dsh-plugin)（官方 README 的推荐做法）。

## 本项目专属

14. **浏览器半边是「脚本模式」**：`src/client/index.ts` 单独用 `tsconfig.client.json` 编译，
    产物不能有顶层 `import`/`export`，靠 `window.__ModuleLoader__.load` 注册；
    主 tsconfig 必须 `exclude: ["src/client"]`。
15. **客户端注册 id 必须等于包名**，不一致时**静默不加载**，没有任何报错。
16. **面板 / 悬浮页的 HTML 是服务端生成的单文件**（`src/ui/pages.ts`），里面的内联 JS
    只能用字符串拼接：**不能写反引号、不能写 `${}`**，连注释里的反引号都会把外层
    TS 模板字符串截断（`TS1005`）。改完用 `node --check` 过一次再提交。
17. **改了 `pages.ts` 要重启 DSH**：页面在服务端进程里生成，热更新不会重新渲染它。
18. **深链（`?tab=stats`）不能在脚本中段就点**：`currentPeriod` 之类是后面用 `let` 声明的，
    提前触发 `loadStats()` 会撞 TDZ，表现是「骨架闪过之后一片空白、控制台没有报错」。
    现在用 `setTimeout(..., 0)` 推到脚本收尾之后再点。
19. **Electron 壳里不要往补间循环塞裸原生调用**：`win.setPosition(NaN, y)` 会在主进程抛错，
    16ms 一跳 → Electron 每次抛错弹一个模态框，用户看到的是「偶尔多次弹窗」。
    所有挪窗/改尺寸走 `safeSetPosition` / `safeSetBounds`，主进程再挂
    `process.on('uncaughtException')` 只记日志。
20. **拖窗必须由主进程跟手**：`MouseEvent.screenX/Y` 在 175% 这类非整数缩放下与窗口 DIP
    坐标不一致，页面算位移会让宠物「自己跑走」。主进程读 `screen.getCursorScreenPoint()` 才准。
21. **`-webkit-app-region: drag` 会吞掉鼠标事件**：宠物本体必须 `no-drag` 才能收到点击。
22. **窗口位置要夹回屏幕**：用户真把伴侣拖到 `y=-561` 过，重启后「桌宠不见了」。
    启动恢复 / 显示 / 挪窗三条路径都要过 `clampBounds()`，托盘备一个「伴侣回到屏幕」。
23. **计费只认 DeepSeek 官方 provider**：`deepseek-account` / `deepseek-official`。
    自建渠道（如百炼）无论模型名多像都不计价（Token 照记、费用 0）——和 DSH 台账口径一致。
24. **上下文进度条/告警不要做**：DSH 自带 UI 的口径更准，插件侧重复实现只会对不上
    （尤其有子代理任务时）。