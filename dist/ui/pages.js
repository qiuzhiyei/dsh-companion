/**
 * dsh-companion — 内嵌 Web 页面入口（伴侣悬浮页 + 统计面板页）。
 *
 * 两个页面各自独立成模块，这里只做再导出，保持原有的 `./pages.js` 导入契约
 * （server.ts / 测试都从这里取 HTML）。页面以模板字符串内嵌（不落盘、无静态
 * 目录依赖）；皮肤资源经 /skins/<skin>/<state> 由 server 从 assets 目录提供。
 */
export { petPageHTML } from './pet-page.js';
export { panelPageHTML } from './panel-page.js';
