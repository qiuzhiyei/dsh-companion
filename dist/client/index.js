"use strict";
/**
 * dsh-companion — GUI 客户端：侧边栏角标 + 面板大窗 + 会话行「删除会话」菜单项。
 *
 * 这是插件的“浏览器半边”：package.json 里声明 `dsh.client`（inject 为空，
 * platform web）后，宿主把本文件以 /plugins/dsh-companion/client.js 提供
 * 给 Web GUI 加载。文件用 `window.__ModuleLoader__.load` 注册，导出
 * `apply(ctx)` / `inject`（与宿主半边的 cordis 约定同构）。
 *
 * 三层结构：
 * 1. 角标（单行）：坐在侧边栏 foot 区、Settings 行上方——今日 token
 *    总量（任务中换当前任务实时 token + 呼吸点），详细数字进 tooltip；
 * 2. 面板大窗：点击角标直接打开，GUI 内全屏模态（backdrop + 大 iframe
 *    加载 /panel），Esc/点背景/× 关闭——全程不打开浏览器标签页，没有
 *    中间详情卡。
 * 3. 删除会话（UI 增强）：经 ctx.slots 官方槽位向侧栏会话行 "…" 菜单注入
 *    「删除会话…」（sidebar.workspaces.session.menu.item，order 550），
 *    确认弹窗后 POST /api/dsh-sessions/delete——node 半边做宿主 registry
 *    除名 + 软删回收站（src/ui-enhance/session-manager.ts）。宿主没有
 *    slots 服务或 require 不可用时静默降级，只剩角标/面板。
 *
 * 数据来自插件自己的 HTTP 服务（127.0.0.1:17573 起，端口自动探测 + 记忆），
 * 跨域由插件服务端的 CORS 头放行（仅回环）；服务不在时角标自动隐藏。
 * 颜色全部走 --dsw-alias-* 皮肤令牌并带回退值（DSH Web 皮肤契约），
 * 容器带 data-dsh-plugin / data-dsh-part 语义属性。
 *
 * 注意：本文件是“脚本模式”（无顶层 import/export），tsc 按全局脚本输出，
 * 这样 ModuleLoader 的 factory 包装才能直接生效。
 */
const BADGE_ATTR = 'data-dsh-companion-badge';
const PANEL_ATTR = 'data-dsh-companion-panel';
const CONFIRM_ATTR = 'data-dsh-companion-delete-confirm';
const TOAST_ATTR = 'data-dsh-companion-toast';
/** 角标轮询发现过的服务地址，删除会话请求复用（空则重新发现）。 */
let cachedServerUrl = '';
let balanceInfo = null;
let balanceFetchedAt = 0;
const LS_PORT_KEY = 'dsh-companion.badge-port';
const PORT_BASE = 17573;
const PORT_RANGE = 10;
const POLL_MS = 5000;
const DISCOVER_MS = 15000;
/** 工作中状态的呼吸点颜色（空闲无点）。 */
const STATE_TONE = {
    casting: '#46e5c3',
    waiting: '#46e5c3',
    hooked: '#46e5c3',
    reeling: '#f0b64a',
    done: '#46e5c3',
    error: '#ff7a7a',
    interrupted: '#f0b64a',
    blocked: '#f0b64a',
};
/** 侧栏角标里的鲸鱼背鳍标记（设计稿 04：识别元素只有背鳍与眼睛）。 */
const FIN_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M2 12c2.6 0 3.6-1.4 5.1-3.4C8.7 6.3 9.8 4 12 4c1.2 0 2 .7 2 2 0 3.6-3.2 6-7 6H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<circle cx="12.2" cy="5.6" r=".8" fill="currentColor"/></svg>';
/** 与面板/计价卡同口径：UTC 16:30–00:30 为闲时（北京 00:30–08:30）。 */
function isOffPeakNow() {
    const d = new Date();
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    return minutes >= 16 * 60 + 30 || minutes < 30;
}
function fmtTokens(n) {
    if (!Number.isFinite(n) || n <= 0)
        return '0';
    if (n < 1000)
        return String(n);
    if (n < 1_000_000)
        return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
}
/** 中文时长：12分34秒 / 1小时23分45秒。 */
function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0)
        return `${h}小时${m}分${sec}秒`;
    if (m > 0)
        return `${m}分${sec}秒`;
    return `${sec}秒`;
}
function fmtElapsed(from, now) {
    return fmtDur(now - from);
}
function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls !== '')
        node.className = cls;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function ensureStyle() {
    const style = document.createElement('style');
    style.setAttribute('data-dsh-plugin', 'dsh-companion');
    style.textContent = [
        /* ---- 侧栏角标（设计稿 04：像一张本来就存在的卡片，而不是挂件） ---- */
        `[${BADGE_ATTR}] {`,
        '  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 10px;',
        '  flex: none; margin: 4px 10px 2px; padding: 10px 11px; border-radius: 11px;',
        '  cursor: pointer; user-select: none; line-height: 1.4;',
        '  color: var(--dsw-alias-text-primary, #e8f3f6);',
        '  background: var(--dsw-alias-bg-elevated, rgba(18,32,42,.9));',
        '  border: 1px solid var(--dsw-alias-separator-primary, rgba(70,229,195,.22));',
        '  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset;',
        '  transition: border-color .15s ease, background .15s ease;',
        '}',
        `[${BADGE_ATTR}]:hover {`,
        '  border-color: rgba(70,229,195,.5);',
        '  background: var(--dsw-alias-bg-hover, rgba(24,42,52,.95));',
        '}',
        `[${BADGE_ATTR}] .sb-icon {`,
        '  width: 24px; height: 24px; flex: none; display: grid; place-items: center;',
        '  border-radius: 8px; background: rgba(70,229,195,.14); color: #46e5c3;',
        '}',
        `[${BADGE_ATTR}] .sb-icon svg { display: block; }`,
        `[${BADGE_ATTR}] .sb-text { display: grid; gap: 2px; min-width: 0; }`,
        `[${BADGE_ATTR}] .sb-text b {`,
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
        '  color: inherit; font-variant-numeric: tabular-nums;',
        '}',
        `[${BADGE_ATTR}] .sb-text span {`,
        '  font-size: 12.5px; color: var(--dsw-alias-text-secondary, #9db4bd);',
        '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
        '}',
        `[${BADGE_ATTR}] .sb-text .sb-foot {`,
        '  display: flex; align-items: center; gap: 6px; min-width: 0; padding-top: 1px;',
        '  font-size: 12px; color: var(--dsw-alias-text-secondary, #9db4bd);',
        '}',
        `[${BADGE_ATTR}] .sb-text .sb-foot b {`,
        '  min-width: 0; overflow: hidden; text-overflow: ellipsis;',
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 12px; font-weight: 500; color: var(--dsw-alias-text-primary, #e8f3f6);',
        '  font-variant-numeric: tabular-nums;',
        '}',
        `[${BADGE_ATTR}] .sb-text .sb-period {`,
        '  display: inline-flex; align-items: center; gap: 4px; flex: none; height: 16px; padding: 0 6px;',
        '  border-radius: 999px; border: 1px solid rgba(240,182,74,.24);',
        '  background: rgba(240,182,74,.10); color: #f0b64a;',
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 10px; line-height: 1;',
        '}',
        `[${BADGE_ATTR}] .sb-period i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; flex: none; }`,
        `[${BADGE_ATTR}] .sb-text .sb-period.is-off {`,
        '  color: #46e5c3; background: rgba(70,229,195,.08); border-color: rgba(70,229,195,.20);',
        '}',
        `[${BADGE_ATTR}] .sb-dot {`,
        '  width: 7px; height: 7px; border-radius: 50%; flex: none; justify-self: end;',
        '  animation: dsh-companion-breath 2s ease-in-out infinite;',
        '}',
        `[${BADGE_ATTR}] .sb-arrow {`,
        '  justify-self: end; color: var(--dsw-alias-text-secondary, #7d959e); font-size: 12px; line-height: 1;',
        '}',
        `@keyframes dsh-companion-breath {`,
        '  0%, 100% { opacity: 1; } 50% { opacity: .35; }',
        '}',
        /* 宿主浅色主题：角标是深色卡片的浅色变体（与面板的浅色令牌同源）。 */
        '@media (prefers-color-scheme: light) {',
        `  [${BADGE_ATTR}] {`,
        '    background: var(--dsw-alias-bg-elevated, #ffffff);',
        '    border-color: var(--dsw-alias-separator-primary, #d5dde0);',
        '    color: var(--dsw-alias-text-primary, #16232b);',
        '    box-shadow: 0 2px 8px rgba(20,40,55,.07);',
        '  }',
        `  [${BADGE_ATTR}]:hover { border-color: #9fc9c0; }`,
        `  [${BADGE_ATTR}] .sb-icon { background: rgba(20,90,80,.09); color: #0e5c4e; }`,
        `  [${BADGE_ATTR}] .sb-text span { color: var(--dsw-alias-text-secondary, #5e727a); }`,
        `  [${BADGE_ATTR}] .sb-text .sb-foot b { color: var(--dsw-alias-text-primary, #16232b); }`,
        `  [${BADGE_ATTR}] .sb-text .sb-period { color: #a86a00; background: rgba(168,106,0,.08); border-color: rgba(168,106,0,.22); }`,
        `  [${BADGE_ATTR}] .sb-text .sb-period.is-off { color: #0e8a74; background: rgba(14,138,116,.08); border-color: rgba(14,138,116,.2); }`,
        '}',
        /* ---- 完整面板大窗（设计稿窗口：52px 标题栏 + 1280×920 上限） ---- */
        `[${PANEL_ATTR}] {`,
        '  position: fixed; inset: 0; z-index: 10001; display: none;',
        '  background: rgba(2,8,11,.72); backdrop-filter: blur(2px);',
        '  align-items: center; justify-content: center; padding: 2vh 2vw;',
        '}',
        `[${PANEL_ATTR}][data-open="1"] { display: flex; }`,
        `[${PANEL_ATTR}] .pm-box {`,
        '  display: flex; flex-direction: column;',
        '  width: min(1280px, 96vw); height: min(920px, 90vh);',
        '  border-radius: 16px; overflow: hidden; background: #07141c;',
        '  border: 1px solid rgba(126,197,214,.22);',
        '  box-shadow: 0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(70,229,195,.04),',
        '    0 1px 0 rgba(255,255,255,.05) inset;',
        '}',
        `[${PANEL_ATTR}] .pm-head {`,
        '  height: 56px; flex: none; display: flex; align-items: center; gap: 10px;',
        '  padding: 0 12px 0 16px; background: #061119;',
        '  border-bottom: 1px solid rgba(126,197,214,.13); color: #e8f3f6;',
        '}',
        `[${PANEL_ATTR}] .pm-icon {`,
        '  width: 28px; height: 28px; flex: none; display: grid; place-items: center;',
        '  border: 1px solid rgba(70,229,195,.22); border-radius: 8px;',
        '  background: rgba(70,229,195,.10); color: #46e5c3;',
        '}',
        `[${PANEL_ATTR}] .pm-title { font-size: 15px; font-weight: 600; letter-spacing: .01em; }`,
        `[${PANEL_ATTR}] .pm-sub {`,
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 11px; letter-spacing: .10em; text-transform: uppercase; color: #4f6a74;',
        '}',
        `[${PANEL_ATTR}] .pm-spacer { flex: 1; }`,
        `[${PANEL_ATTR}] .pm-live {`,
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 11px; color: #7d959e; white-space: nowrap;',
        '}',
        `[${PANEL_ATTR}] .pm-close {`,
        '  width: 30px; height: 28px; border-radius: 6px; cursor: pointer;',
        '  display: grid; place-items: center;',
        '  color: #7d959e; background: transparent; border: none; padding: 0;',
        '}',
        `[${PANEL_ATTR}] .pm-close:hover { background: #8e2f2f; color: #fff; }`,
        `[${PANEL_ATTR}] .pm-close svg { width: 12px; height: 12px; display: block; }`,
        `[${PANEL_ATTR}] iframe.pm-frame { flex: 1; width: 100%; border: none; background: #07141c; }`,
        '@media (max-width: 760px) {',
        `  [${PANEL_ATTR}] { padding: 0; }`,
        `  [${PANEL_ATTR}] .pm-box { width: 100vw; height: 100vh; border-radius: 0; border: none; }`,
        `  [${PANEL_ATTR}] .pm-sub, [${PANEL_ATTR}] .pm-live { display: none; }`,
        '}',
        /* ---- 删除会话确认弹窗 ---- */
        `[${CONFIRM_ATTR}] {`,
        '  position: fixed; inset: 0; z-index: 10002; display: flex;',
        '  align-items: center; justify-content: center; background: rgba(0,0,0,.45);',
        '}',
        `[${CONFIRM_ATTR}] .dc-box {`,
        '  width: min(420px, 92vw); border-radius: 12px; padding: 18px 20px;',
        '  background: var(--dsw-alias-bg-base, #f4f6f8);',
        '  border: 1px solid var(--dsw-alias-separator-strong, rgba(128,128,128,.3));',
        '  box-shadow: 0 16px 48px rgba(0,0,0,.4);',
        '  color: var(--dsw-alias-text-primary, #222);',
        '}',
        `[${CONFIRM_ATTR}] .dc-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }`,
        `[${CONFIRM_ATTR}] .dc-name {`,
        '  font-size: 12px; margin-bottom: 10px; word-break: break-all;',
        '  color: var(--dsw-alias-text-secondary, #666);',
        '}',
        `[${CONFIRM_ATTR}] .dc-note {`,
        '  font-size: 12px; line-height: 1.6; margin-bottom: 14px;',
        '  color: var(--dsw-alias-text-secondary, #666);',
        '}',
        `[${CONFIRM_ATTR}] .dc-error {`,
        '  font-size: 12px; margin-bottom: 10px; display: none;',
        '  color: var(--dsw-alias-state-error-primary, #e0564f);',
        '}',
        `[${CONFIRM_ATTR}] .dc-actions { display: flex; justify-content: flex-end; gap: 8px; }`,
        `[${CONFIRM_ATTR}] button {`,
        '  font-size: 12px; padding: 6px 14px; border-radius: 8px; cursor: pointer;',
        '  border: 1px solid var(--dsw-alias-separator-strong, rgba(128,128,128,.3));',
        '  background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.08));',
        '  color: var(--dsw-alias-text-primary, #222);',
        '}',
        `[${CONFIRM_ATTR}] button.dc-danger {`,
        '  background: var(--dsw-alias-state-error-primary, #e0564f);',
        '  border-color: var(--dsw-alias-state-error-primary, #e0564f);',
        '  color: #fff;',
        '}',
        `[${CONFIRM_ATTR}] button:disabled { opacity: .6; cursor: default; }`,
        /* ---- 推理等级：官方模型选择器「推理等级」行 → 能量条面板 ---- */
        '.cr-host { position: fixed; z-index: 10006; width: 322px; max-width: calc(100vw - 16px); }',
        '.cr-host[hidden] { display: none !important; }',
        '.cr-panel {',
        '  --cr-surface: var(--dsw-alias-bg-elevated, #0b1b24);',
        '  --cr-line: var(--dsw-alias-separator-strong, rgba(126,197,214,.22));',
        '  --cr-ink: var(--dsw-alias-text-primary, #e8f3f6);',
        '  --cr-muted: var(--dsw-alias-text-secondary, #9db4bd);',
        '  --cr-accent: var(--dsw-alias-accent, #46e5c3);',
        '  color: var(--cr-ink); background: var(--cr-surface);',
        '  border: 1px solid var(--cr-line); border-radius: 12px;',
        '  padding: 14px 14px 12px; box-shadow: 0 20px 50px rgba(0,0,0,.42);',
        '  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);',
        '  font-family: inherit; font-size: 12px; line-height: 1.5;',
        '}',
        '.cr-sub { margin-top: 3px; font-size: 10px; color: var(--cr-muted); line-height: 1.55; }',
        '.cr-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px;',
        '  padding-top: 8px; border-top: 1px solid var(--cr-line);',
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 8.5px; color: var(--cr-muted); }',
        '.cr-error { color: var(--dsw-alias-state-error-primary, #ff7a7a); }',
        '.cr-retry { margin-left: 8px; padding: 2px 8px; border: 1px solid var(--cr-line);',
        '  border-radius: 6px; background: transparent; color: var(--cr-ink); font: inherit;',
        '  font-size: 10px; cursor: pointer; }',
        '.cr-retry:hover { border-color: var(--cr-accent); color: var(--cr-accent); }',
        /* ---- 推理深度 · 声呐深度计（设计稿 02） ---- */
        '.cr-sonar { padding: 14px 16px 12px; border-radius: 16px; position: relative; }',
        '.cr-sonar::after { content: ""; position: absolute; right: 30px; bottom: -6px; width: 10px; height: 10px;',
        '  background: var(--cr-surface); border-right: 1px solid var(--cr-line); border-bottom: 1px solid var(--cr-line);',
        '  transform: rotate(45deg); }',
        '.cr-sonar[data-level="off"] { --cr-accent: #8fa0a8; --cr-accent-soft: rgba(143,160,168,.4); }',
        '.cr-sonar[data-level="low"] { --cr-accent: #37b39c; --cr-accent-soft: rgba(55,179,156,.4); }',
        '.cr-sonar[data-level="high"] { --cr-accent: #46e5c3; --cr-accent-soft: rgba(70,229,195,.45); }',
        '.cr-sonar[data-level="max"] { --cr-accent: #a78bfa; --cr-accent-soft: rgba(167,139,250,.45); }',
        '.cr-sonar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }',
        '.cr-sonar-text { min-width: 0; }',
        '.cr-kicker { font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 8px; letter-spacing: .18em; text-transform: uppercase; color: var(--cr-muted); }',
        '.cr-tier { padding-top: 1px; font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 11px; letter-spacing: .16em; color: var(--cr-accent); white-space: nowrap; }',
        '.cr-sonar-desc { min-height: 15px; margin-top: 7px; font-size: 10.5px; color: var(--cr-muted); line-height: 1.45; }',
        '.cr-gauge { position: relative; height: 52px; margin-top: 10px; cursor: pointer;',
        '  touch-action: none; user-select: none; outline: none; }',
        '.cr-gauge:focus-visible .cr-water { box-shadow: inset 0 0 0 1px var(--cr-accent), 0 0 0 1px var(--cr-accent); }',
        '.cr-water { position: absolute; left: 0; right: 0; top: 14px; height: 20px; overflow: hidden;',
        '  border-radius: 999px; background: var(--dsw-alias-bg-hover, rgba(0,0,0,.24));',
        '  box-shadow: inset 0 1px 3px rgba(0,0,0,.35), inset 0 0 0 1px var(--cr-line), 0 0 18px var(--cr-accent-soft); }',
        '.cr-water-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 999px 0 0 999px;',
        '  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent 48%), linear-gradient(90deg, rgba(70,229,195,.3), var(--cr-accent));',
        '  box-shadow: inset 0 1px 0 rgba(255,255,255,.22);',
        '  transition: width .3s cubic-bezier(.2,.7,.2,1), background .2s ease; }',
        '.cr-gauge.is-drag .cr-water-fill, .cr-gauge.is-drag .cr-cursor { transition: none; }',
        '.cr-water::after { content: ""; position: absolute; top: 0; bottom: 0; width: 48px;',
        '  background: linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent);',
        '  animation: cr-sweep 4.4s linear infinite; }',
        '@keyframes cr-sweep { 0% { left: -48px; } 100% { left: 100%; } }',
        '.cr-ticks { position: absolute; left: 0; right: 0; top: 14px; height: 20px; pointer-events: none; }',
        '.cr-ticks i { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(126,197,214,.14); }',
        '.cr-major { position: absolute; top: 10px; height: 28px; width: 1px;',
        '  background: var(--cr-surface); pointer-events: none; }',
        '.cr-cursor { position: absolute; top: 6px; left: 0; width: 2px; height: 36px; margin-left: -1px;',
        '  background: var(--cr-accent); box-shadow: 0 0 14px var(--cr-accent);',
        '  transition: left .3s cubic-bezier(.2,.7,.2,1), background .2s ease; }',
        '.cr-cursor::before { content: ""; position: absolute; top: -5px; left: 50%; width: 9px; height: 9px;',
        '  margin-left: -4.5px; background: var(--cr-accent); transform: rotate(45deg);',
        '  box-shadow: 0 0 14px var(--cr-accent); }',
        '.cr-cursor::after { content: ""; position: absolute; top: 25px; left: 50%; width: 6px; height: 6px;',
        '  margin-left: -3px; border-radius: 50%; background: #fff; box-shadow: 0 0 10px var(--cr-accent); }',
        '.cr-scale { position: relative; height: 14px; margin-top: 4px;',
        '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
        '  font-size: 8.5px; color: var(--cr-muted); }',
        '.cr-scale span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap;',
        '  transition: color .18s ease; }',
        '.cr-scale span.on { color: var(--cr-accent); }',
        '.cr-sonar .cr-sub { margin-top: 8px; }',
        '@media (prefers-reduced-motion: reduce) {',
        '  .cr-water-fill, .cr-cursor { transition: none; }',
        '  .cr-water::after { animation: none; }',
        '}',
        /* ---- 轻量 toast ---- */
        `[${TOAST_ATTR}] {`,
        '  position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 10003;',
        '  padding: 8px 16px; border-radius: 10px; font-size: 12px; max-width: 80vw;',
        '  background: var(--dsw-alias-bg-elevated, rgba(20,28,38,.92));',
        '  color: var(--dsw-alias-text-primary, #e8f1fa);',
        '  border: 1px solid var(--dsw-alias-separator-primary, rgba(255,255,255,.14));',
        '  box-shadow: 0 8px 24px rgba(0,0,0,.35);',
        '}',
    ].join('\n');
    document.head.appendChild(style);
    return () => style.remove();
}
function footArea() {
    const sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
    return sidebar?.querySelector('[class*="footArea"]') ?? null;
}
/** 座位：插到 Settings 行上方；被 GUI 重渲染挤掉时由观察器重放。 */
function placeBadge(container) {
    const foot = footArea();
    if (foot === null)
        return;
    const settings = foot.querySelector('[class*="settingsArea"]');
    if (settings !== null) {
        if (container.nextElementSibling !== settings)
            foot.insertBefore(container, settings);
        return;
    }
    if (foot.lastElementChild !== container)
        foot.append(container);
}
async function probePort(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
            signal: AbortSignal.timeout(1500),
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (data && data.plugin === 'dsh-companion')
            return data;
        return null;
    }
    catch {
        return null;
    }
}
async function discoverServer() {
    const candidates = [];
    const cached = Number(window.localStorage.getItem(LS_PORT_KEY));
    if (Number.isInteger(cached) && cached >= PORT_BASE)
        candidates.push(cached);
    for (let p = PORT_BASE; p < PORT_BASE + PORT_RANGE; p += 1) {
        if (!candidates.includes(p))
            candidates.push(p);
    }
    for (const port of candidates) {
        const state = await probePort(port);
        if (state !== null) {
            window.localStorage.setItem(LS_PORT_KEY, String(port));
            return { url: `http://127.0.0.1:${port}`, state };
        }
    }
    return null;
}
async function fetchJson(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
}
/* ---------- 推理等级（官方模型选择器的「推理等级」行 → 能量条面板） ---------- */
/**
 * 宿主模型选择器把「推理等级 / Effort」做成 root 菜单里的一行；点它原本会
 * drill 到宿主自带的档位 pane。这里在捕获阶段接管这一行，换成设计稿的能量条
 * 面板，写入仍走官方 `connection.api.sessions.selectModel({ reasoningEffort })`。
 *
 * 刻意不替换官方模型选择器（不占宿主单实例模型座位槽位），也不直接改宿主
 * 文件：旧宿主没有 connection/sessions 服务时静默放行，原生菜单照旧可用。
 * 做法与 dsh-adaptive-reasoning 相同的官方 RPC 路径。
 */
const REASONING_ROW_LABELS = ['推理等级', '思考强度', '推理强度', 'Effort', 'Reasoning effort', 'Thinking'];
const REASONING_LEVEL_NAMES = {
    off: 'Off',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
};
function mountReasoningControl(ctx) {
    const getter = ctx.get;
    if (typeof getter !== 'function')
        return;
    const safeGet = (name) => {
        try {
            return getter.call(ctx, name);
        }
        catch {
            return undefined;
        }
    };
    const host = document.createElement('div');
    host.className = 'cr-host';
    host.setAttribute('data-dsh-plugin', 'dsh-companion');
    host.setAttribute('data-dsh-part', 'reasoning-panel');
    host.hidden = true;
    document.body.appendChild(host);
    let state = null;
    const currentSessionId = () => {
        // 0.2.x：uiSession.current 是主视图的 binding source，value.key 才是会话 id；
        // sessions.list 的快照只有 ids/byId，没有 current（旧插件口径已失效）。
        const uiSession = safeGet('uiSession');
        const binding = uiSession?.current?.value;
        const fromBinding = binding?.key ?? binding?.sessionId;
        if (typeof fromBinding === 'string' && fromBinding.length > 0)
            return fromBinding;
        const sessions = safeGet('sessions');
        const legacy = sessions?.list?.getSnapshot?.()?.current;
        return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
    };
    /** 从 session.models 的目录里找当前 provider/model（与宿主选择器同口径）。 */
    const currentModel = (directory) => {
        if (directory === null || directory === undefined || directory.current === null)
            return null;
        for (const group of directory.groups || []) {
            const model = (group.models || []).find((candidate) => candidate.id === directory.current.model);
            if (group.id === directory.current.provider && model !== undefined) {
                return { group, model, current: directory.current };
            }
        }
        return null;
    };
    const levelName = (effort) => (effort && (effort.name || REASONING_LEVEL_NAMES[String(effort.id)] || String(effort.id))) || '—';
    const levelTone = (effort) => {
        const id = String(effort?.id ?? '').toLowerCase();
        if (id === 'off' || id === 'none')
            return 'off';
        if (id === 'minimal' || id === 'low')
            return 'low';
        if (id === 'max' || id === 'xhigh')
            return 'max';
        return 'high';
    };
    const levelDescription = (effort) => {
        if (effort?.description)
            return String(effort.description);
        const id = String(effort?.id ?? '').toLowerCase();
        if (id === 'off' || id === 'none')
            return '关闭推理 · 最快，也最省';
        if (id === 'minimal' || id === 'low')
            return '轻量推理 · 更快';
        if (id === 'max' || id === 'xhigh')
            return '最高档 · 推理更深，也更慢';
        return '深度推理 · 速度与质量的平衡';
    };
    const close = () => {
        if (state === null)
            return;
        state = null;
        host.hidden = true;
        host.textContent = '';
        document.removeEventListener('keydown', onKey, true);
    };
    /** 把面板贴在锚点上方/原位；再夹进视口。 */
    const position = (rect) => {
        host.style.visibility = 'hidden';
        host.style.left = '0px';
        host.style.top = '0px';
        const w = host.offsetWidth || 322;
        const h = host.offsetHeight || 210;
        const anchorRight = state?.placeAbove === true && rect.right !== undefined;
        let left = anchorRight ? rect.right - w : rect.left;
        let top = state?.placeAbove === true ? rect.top - h - 14 : rect.top;
        left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8));
        top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - h - 8));
        host.style.left = Math.round(left) + 'px';
        host.style.top = Math.round(top) + 'px';
        host.style.visibility = '';
    };
    const choose = (effort) => {
        if (state === null || state.busy)
            return;
        const selection = currentModel(state.directory);
        if (selection === null)
            return;
        const currentEffort = selection.current.reasoningEffort ?? selection.model.reasoning?.defaultEffort;
        if (effort.id === currentEffort) {
            close();
            return;
        }
        state.busy = true;
        state.error = '';
        render();
        const mode = state.mode;
        Promise.resolve()
            .then(() => {
            if (state === null)
                return null;
            if (mode === 'directory') {
                const directory = state.live || state.models.directoryFor(state.sessionId);
                state.live = directory;
                return directory.select({
                    provider: selection.current.provider,
                    model: selection.current.model,
                    reasoningEffort: String(effort.id),
                });
            }
            return state.api.sessions.selectModel({
                sessionId: state.sessionId,
                provider: selection.current.provider,
                model: selection.current.model,
                reasoningEffort: String(effort.id),
            });
        })
            .then((response) => {
            if (state === null)
                return;
            const ok = mode === 'directory'
                ? response !== null && response !== undefined && response.ok === true
                : !!(response && response.result && response.result.ok === true);
            if (!ok) {
                state.busy = false;
                state.error =
                    response?.error?.message ||
                        response?.result?.error?.message ||
                        '无法更新推理等级';
                render();
                return;
            }
            close();
        })
            .catch((error) => {
            if (state === null)
                return;
            state.busy = false;
            state.error = error instanceof Error ? error.message : String(error);
            render();
        });
    };
    const paint = (index) => {
        if (state === null || state.ui === null)
            return;
        const ui = state.ui;
        const efforts = ui.efforts;
        const bounded = Math.max(0, Math.min(efforts.length - 1, index));
        const pct = efforts.length <= 1 ? 100 : (bounded / (efforts.length - 1)) * 100;
        state.preview = bounded;
        ui.panel.setAttribute('data-level', levelTone(efforts[bounded]));
        ui.tier.textContent = levelName(efforts[bounded]).toUpperCase();
        ui.desc.textContent = levelDescription(efforts[bounded]);
        ui.fill.style.width = pct + '%';
        ui.cursor.style.left = pct + '%';
        ui.gauge.setAttribute('aria-valuenow', String(bounded));
        ui.gauge.setAttribute('aria-valuetext', levelName(efforts[bounded]));
        for (let i = 0; i < ui.labels.length; i += 1) {
            ui.labels[i].classList.toggle('on', i === bounded);
        }
    };
    const render = () => {
        if (state === null)
            return;
        host.textContent = '';
        state.ui = null;
        const selection = currentModel(state.directory);
        const reasoning = selection?.model?.reasoning;
        const efforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : [];
        const effective = selection?.current?.reasoningEffort ?? reasoning?.defaultEffort;
        const activeIndex = efforts.findIndex((effort) => effort.id === effective);
        const active = activeIndex >= 0 ? efforts[activeIndex] : null;
        const panel = el('div', 'cr-panel cr-sonar');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '推理等级');
        panel.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        panel.setAttribute('data-level', active ? levelTone(active) : 'high');
        const head = el('div', 'cr-sonar-head');
        const text = el('div', 'cr-sonar-text');
        text.appendChild(el('div', 'cr-kicker', 'REASONING · 推理等级'));
        const desc = el('div', 'cr-sonar-desc', active ? levelDescription(active) : '越高越慢，也越贵。');
        text.appendChild(desc);
        head.appendChild(text);
        const tier = el('span', 'cr-tier', active ? levelName(active).toUpperCase() : effective ? String(effective).toUpperCase() : '—');
        head.appendChild(tier);
        panel.appendChild(head);
        if (state.directory === null) {
            panel.appendChild(el('div', 'cr-sub', state.busy ? '正在更新…' : '正在读取模型能力…'));
            if (state.error) {
                const err = el('div', 'cr-sub cr-error', state.error);
                const retry = el('button', 'cr-retry', '重试');
                retry.type = 'button';
                retry.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    load();
                });
                err.appendChild(retry);
                panel.appendChild(err);
            }
        }
        else if (selection === null) {
            desc.textContent = '当前会话没有可读取的模型。';
        }
        else if (efforts.length === 0) {
            desc.textContent = '当前模型没有可调推理等级。';
        }
        else {
            const gauge = el('div', 'cr-gauge');
            gauge.setAttribute('role', 'slider');
            gauge.setAttribute('tabindex', '0');
            gauge.setAttribute('aria-label', '推理等级');
            gauge.setAttribute('aria-valuemin', '0');
            gauge.setAttribute('aria-valuemax', String(efforts.length - 1));
            gauge.setAttribute('aria-valuenow', String(activeIndex >= 0 ? activeIndex : 0));
            gauge.setAttribute('aria-valuetext', active ? levelName(active) : '—');
            const water = el('div', 'cr-water');
            const fill = el('i', 'cr-water-fill');
            water.appendChild(fill);
            gauge.appendChild(water);
            const ticks = el('div', 'cr-ticks');
            for (let i = 0; i <= 16; i += 1) {
                const tick = el('i', '');
                tick.style.left = (i / 16) * 100 + '%';
                ticks.appendChild(tick);
            }
            gauge.appendChild(ticks);
            for (let i = 1; i < efforts.length - 1; i += 1) {
                const major = el('span', 'cr-major');
                major.style.left = (i / (efforts.length - 1)) * 100 + '%';
                gauge.appendChild(major);
            }
            const cursor = el('span', 'cr-cursor');
            gauge.appendChild(cursor);
            panel.appendChild(gauge);
            const scale = el('div', 'cr-scale');
            const labels = [];
            efforts.forEach((effort, index) => {
                const label = el('span', 'cr-scale-label', levelName(effort));
                const pct = efforts.length <= 1 ? 100 : (index / (efforts.length - 1)) * 100;
                label.style.left = pct + '%';
                if (index === 0) {
                    label.style.left = '0%';
                    label.style.transform = 'none';
                }
                if (index === efforts.length - 1) {
                    label.style.left = 'auto';
                    label.style.right = '0%';
                    label.style.transform = 'none';
                }
                scale.appendChild(label);
                labels.push(label);
            });
            panel.appendChild(scale);
            state.ui = { panel, efforts, fill, cursor, tier, desc, gauge, labels };
            paint(activeIndex >= 0 ? activeIndex : 0);
            let dragging = false;
            const indexAt = (clientX) => {
                const rect = gauge.getBoundingClientRect();
                const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
                const bounded = Math.max(0, Math.min(1, ratio));
                return Math.round(bounded * (efforts.length - 1));
            };
            gauge.addEventListener('pointerdown', (event) => {
                if (state === null || state.busy)
                    return;
                dragging = true;
                gauge.classList.add('is-drag');
                try {
                    gauge.setPointerCapture(event.pointerId);
                }
                catch {
                    // 合成事件在个别环境没有 active pointer；拖动仍可用。
                }
                paint(indexAt(event.clientX));
                gauge.focus();
                event.preventDefault();
            });
            gauge.addEventListener('pointermove', (event) => {
                if (!dragging || state === null)
                    return;
                paint(indexAt(event.clientX));
            });
            const finish = (event) => {
                if (!dragging || state === null)
                    return;
                dragging = false;
                gauge.classList.remove('is-drag');
                const index = indexAt(event.clientX);
                paint(index);
                const effort = state.ui?.efforts[index];
                if (effort !== undefined)
                    choose(effort);
            };
            gauge.addEventListener('pointerup', finish);
            gauge.addEventListener('pointercancel', () => {
                dragging = false;
                gauge.classList.remove('is-drag');
            });
            gauge.addEventListener('keydown', (event) => {
                if (state === null || state.busy)
                    return;
                const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                if (!keys.includes(event.key))
                    return;
                const current = state.preview;
                let next = current;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
                    next = Math.max(0, current - 1);
                else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
                    next = Math.min(efforts.length - 1, current + 1);
                else if (event.key === 'Home')
                    next = 0;
                else if (event.key === 'End')
                    next = efforts.length - 1;
                event.preventDefault();
                paint(next);
                choose(efforts[next]);
            });
            if (state.error)
                panel.appendChild(el('div', 'cr-sub cr-error', state.error));
        }
        const foot = el('div', 'cr-foot');
        foot.appendChild(el('span', '', '仅影响之后的请求'));
        foot.appendChild(el('span', '', state.busy ? '更新中…' : 'Esc 关闭'));
        panel.appendChild(foot);
        host.appendChild(panel);
        host.hidden = false;
        position(state.rect);
    };
    const load = () => {
        if (state === null)
            return;
        const token = ++state.token;
        const mode = state.mode;
        const sessionId = state.sessionId;
        state.directory = null;
        state.error = '';
        state.busy = true;
        render();
        const read = async () => {
            if (state === null)
                return null;
            if (mode === 'directory') {
                const directory = state.models.directoryFor(sessionId);
                state.live = directory;
                await directory.load();
                return { ok: true, value: directory.store.getSnapshot() };
            }
            const response = await state.api.sessions.models({ sessionId });
            if (!response || !response.result || response.result.ok !== true) {
                return { ok: false, error: response?.result?.error };
            }
            return { ok: true, value: response.result.value };
        };
        Promise.resolve()
            .then(read)
            .then((result) => {
            if (state === null || state.token !== token)
                return;
            state.busy = false;
            if (!result || result.ok !== true) {
                state.error = result?.error?.message || '无法读取模型能力';
                render();
                return;
            }
            state.directory = result.value;
            render();
            requestAnimationFrame(() => {
                if (state === null)
                    return;
                host.querySelector('.cr-gauge')?.focus();
            });
        })
            .catch((error) => {
            if (state === null || state.token !== token)
                return;
            state.busy = false;
            state.error = error instanceof Error ? error.message : String(error);
            render();
        });
    };
    const onKey = (event) => {
        if (state === null)
            return;
        if (event.key !== 'Escape')
            return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    /** 解析当前会话 + 当前宿主可用的模型目录服务（0.2.x directory / 旧 connection）。 */
    const resolveContext = () => {
        const sessionId = currentSessionId();
        if (sessionId === null)
            return null;
        const sessions = safeGet('sessions');
        try {
            if (sessions && typeof sessions.subagentAddress === 'function' && sessions.subagentAddress(sessionId) !== undefined) {
                return null; // 子代理会话不提供模型/档位选择，交给宿主原生逻辑
            }
        }
        catch {
            return null;
        }
        const modelDirectories = safeGet('modelDirectories');
        const connection = safeGet('connection');
        const legacyApi = connection?.api?.sessions ? connection.api : null;
        const directoryMode = !!(modelDirectories && typeof modelDirectories.directoryFor === 'function');
        if (!directoryMode && legacyApi === null)
            return null;
        return {
            sessionId,
            mode: directoryMode ? 'directory' : 'legacy',
            models: modelDirectories,
            api: legacyApi,
        };
    };
    const openAt = (rect, context, placeAbove = false) => {
        if (context === null)
            return;
        state = {
            sessionId: context.sessionId,
            mode: context.mode,
            models: context.models,
            api: context.api,
            live: null,
            rect,
            placeAbove,
            directory: null,
            busy: true,
            error: '',
            token: 0,
            preview: 0,
            ui: null,
        };
        render();
        load();
        document.addEventListener('keydown', onKey, true);
    };
    const onClick = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target === null)
            return;
        if (host.contains(target))
            return;
        if (state !== null) {
            close();
            return;
        }
        // 设计稿 02 的入口：宿主模型触发器里的「当前档位」小字。
        // 点它直接开声呐面板；点模型名仍然开官方模型菜单。
        const effortChip = target.closest('[class*="triggerEffort"]');
        if (effortChip instanceof HTMLElement && effortChip.getBoundingClientRect().width > 0) {
            const context = resolveContext();
            if (context === null)
                return;
            event.preventDefault();
            event.stopPropagation();
            const box = effortChip.getBoundingClientRect();
            // 设计稿里 popover 悬在整条输入栏上方，而不是只压在档位小字上。
            const seat = effortChip.closest('[data-composer-seat]');
            const seatRect = seat instanceof HTMLElement ? seat.getBoundingClientRect() : null;
            openAt({
                left: box.left,
                top: seatRect?.top ?? box.top,
                right: seatRect !== null ? seatRect.right - 56 : box.right,
            }, context, true);
            return;
        }
        const row = target.closest('[role="menuitem"]');
        if (!(row instanceof HTMLElement))
            return;
        const menu = row.closest('[role="menu"]');
        if (!(menu instanceof HTMLElement))
            return;
        const text = (row.textContent || '').trim();
        if (!REASONING_ROW_LABELS.some((label) => text === label || text.startsWith(label)))
            return;
        const context = resolveContext();
        if (context === null)
            return;
        event.preventDefault();
        event.stopPropagation();
        const box = menu.getBoundingClientRect();
        menu.style.display = 'none';
        openAt({ left: box.left, top: box.top }, context);
    };
    document.addEventListener('click', onClick, true);
    ctx.effect(() => () => {
        close();
        document.removeEventListener('click', onClick, true);
        host.remove();
    });
}
/* ---------- 角标渲染 ---------- */
function renderBadge(container, state, stats, balance) {
    container.textContent = '';
    if (state === null) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    const working = state.task !== null && state.task !== undefined;
    const today = stats?.totalTokens ?? 0;
    const icon = el('span', 'sb-icon');
    icon.innerHTML = FIN_SVG;
    container.appendChild(icon);
    const text = el('span', 'sb-text');
    const main = el('b', '', working && state.task
        ? `${fmtTokens(state.task.tokens.totalTokens)} token`
        : `今日 ${fmtTokens(today)} token`);
    const sub = el('span', '');
    const bits = [];
    if (working && state.task) {
        // 进行中：第二行只用任务名 + 状态词，读数留给第一行（设计稿 04）。
        sub.textContent = `${state.task.project || state.label || '任务'} · 进行中`;
    }
    else {
        bits.push(`${stats?.tasks ?? 0} 个任务`);
        const cost = Number(stats?.cost) || 0;
        if (cost > 0) {
            const sym = state.settings.currency === 'USD' ? '$' : '¥';
            bits.push(`${sym}${cost.toFixed(2)}`);
        }
        sub.textContent = bits.join(' · ');
    }
    text.appendChild(main);
    text.appendChild(sub);
    // 第三行：余额 + 峰谷。用户要求放在 DSH 左下角角标，不占面板左栏。
    const sym = state.settings.currency === 'USD' ? '$' : '¥';
    let balText = '余额 —';
    if (balance !== null) {
        if (balance.enabled === false)
            balText = '余额 未开启';
        else if (balance.ok === true) {
            const balSym = balance.currency === 'USD' ? '$' : sym;
            balText = '余额 ' + balSym + (Number(balance.normal) || 0).toFixed(2);
        }
    }
    const offPeak = isOffPeakNow();
    const foot = el('span', 'sb-foot');
    foot.appendChild(el('b', '', balText));
    const period = el('span', 'sb-period' + (offPeak ? ' is-off' : ''));
    period.appendChild(el('i', ''));
    period.appendChild(document.createTextNode(offPeak ? '闲时' : '高峰'));
    period.title = offPeak
        ? '闲时（UTC 16:30–00:30，官方高峰价 5 折）'
        : '高峰时段，按官方高峰价计费；UTC 16:30–00:30 为闲时';
    foot.appendChild(period);
    text.appendChild(foot);
    container.appendChild(text);
    if (working) {
        const dot = el('i', 'sb-dot');
        const tone = STATE_TONE[state.state] ?? STATE_TONE.hooked;
        dot.style.background = tone;
        dot.style.boxShadow = `0 0 7px ${tone}`;
        container.appendChild(dot);
    }
    else {
        container.appendChild(el('span', 'sb-arrow', '›'));
    }
    const lines = ['DSH 伴侣'];
    if (working && state.task) {
        lines.push(`${state.task.project || state.label || '任务'} · 已 ${fmtElapsed(state.task.startTime, Date.now())}`);
        lines.push(`当前 ${state.task.tokens.totalTokens.toLocaleString()} token · 今日 ${today.toLocaleString()} tokens`);
        if ((stats?.cost ?? 0) > 0) {
            const sym = state.settings.currency === 'USD' ? '$' : '¥';
            lines.push(`今日 ${sym}${(stats?.cost ?? 0).toFixed(2)}`);
        }
    }
    else {
        lines.push(`今日 ${today.toLocaleString()} tokens · ${stats?.tasks ?? 0} 任务`);
        if ((stats?.cost ?? 0) > 0) {
            const sym = state.settings.currency === 'USD' ? '$' : '¥';
            lines.push(`今日 ${sym}${(stats?.cost ?? 0).toFixed(2)}`);
        }
    }
    lines.push('点击打开统计面板');
    lines.push(balText + ' · ' + (offPeak ? '闲时' : '高峰'));
    container.title = lines.join('\n');
}
function buildPanelModal(onClose) {
    const root = document.createElement('div');
    root.setAttribute(PANEL_ATTR, '');
    root.setAttribute('data-dsh-plugin', 'dsh-companion');
    root.setAttribute('data-dsh-part', 'panel-modal');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'DSH 伴侣统计面板');
    const box = el('div', 'pm-box');
    const head = el('div', 'pm-head');
    const icon = el('span', 'pm-icon');
    icon.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
            '<path d="M2 12c2.6 0 3.6-1.4 5.1-3.4C8.7 6.3 9.8 4 12 4c1.2 0 2 .7 2 2 0 3.6-3.2 6-7 6H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
            '<circle cx="12.2" cy="5.6" r=".8" fill="currentColor"/></svg>';
    head.appendChild(icon);
    head.appendChild(el('span', 'pm-title', 'DSH 伴侣'));
    head.appendChild(el('span', 'pm-sub', '统计面板'));
    head.appendChild(el('span', 'pm-spacer'));
    const live = el('span', 'pm-live', '本地服务 · 已连接');
    live.setAttribute('data-dsh-part', 'panel-live');
    head.appendChild(live);
    const close = el('button', 'pm-close');
    close.innerHTML =
        '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', onClose);
    head.appendChild(close);
    const iframe = document.createElement('iframe');
    iframe.className = 'pm-frame';
    iframe.title = '统计面板';
    iframe.src = 'about:blank';
    box.appendChild(head);
    box.appendChild(iframe);
    root.appendChild(box);
    // 点背景（盒子外）关闭。
    root.addEventListener('mousedown', (ev) => {
        if (ev.target === root)
            onClose();
    });
    document.body.appendChild(root);
    return { root, iframe };
}
/* ---------- 删除会话（UI 增强：官方槽位注入侧栏会话行 "…" 菜单） ---------- */
function showToast(message) {
    document.querySelector(`[${TOAST_ATTR}]`)?.remove();
    const toast = el('div', '', message);
    toast.setAttribute(TOAST_ATTR, '');
    toast.setAttribute('data-dsh-plugin', 'dsh-companion');
    toast.setAttribute('data-dsh-part', 'toast');
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
}
async function resolveServerUrl() {
    if (cachedServerUrl !== '')
        return cachedServerUrl;
    const found = await discoverServer();
    if (found !== null)
        cachedServerUrl = found.url;
    return cachedServerUrl;
}
/** 二次确认弹窗：确认后 POST 伴侣服务执行 registry 除名 + 软删回收站。 */
function openDeleteConfirm(sessionId, displayTitle) {
    if (document.querySelector(`[${CONFIRM_ATTR}]`) !== null)
        return;
    const root = document.createElement('div');
    root.setAttribute(CONFIRM_ATTR, '');
    root.setAttribute('data-dsh-plugin', 'dsh-companion');
    root.setAttribute('data-dsh-part', 'session-delete-confirm');
    const box = el('div', 'dc-box');
    box.appendChild(el('div', 'dc-title', '删除会话'));
    box.appendChild(el('div', 'dc-name', displayTitle !== '' ? `「${displayTitle}」` : sessionId));
    box.appendChild(el('div', 'dc-note', '将从会话列表移除，并彻底删除会话文件，不可恢复。运行中的会话不能删除。'));
    const error = el('div', 'dc-error');
    box.appendChild(error);
    const actions = el('div', 'dc-actions');
    const cancel = el('button', '', '取消');
    cancel.type = 'button';
    const danger = el('button', 'dc-danger', '删除');
    danger.type = 'button';
    actions.appendChild(cancel);
    actions.appendChild(danger);
    box.appendChild(actions);
    root.appendChild(box);
    function close() {
        document.removeEventListener('keydown', onKey, true);
        root.remove();
    }
    function onKey(ev) {
        if (ev.key === 'Escape')
            close();
    }
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', (ev) => {
        if (ev.target === root)
            close();
    });
    cancel.addEventListener('click', close);
    function fail(message) {
        error.textContent = message;
        error.style.display = 'block';
        danger.disabled = false;
        cancel.disabled = false;
        danger.textContent = '删除';
    }
    danger.addEventListener('click', () => {
        danger.disabled = true;
        cancel.disabled = true;
        danger.textContent = '删除中…';
        error.style.display = 'none';
        void (async () => {
            const url = await resolveServerUrl();
            if (url === '') {
                fail('伴侣服务不可用（未发现本机 17573+ 端口服务）');
                return;
            }
            try {
                const res = await fetch(`${url}/api/dsh-sessions/delete`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ sessionId }),
                    signal: AbortSignal.timeout(10_000),
                });
                const data = (await res.json().catch(() => null));
                if (res.ok && data?.ok === true) {
                    close();
                    showToast(data.pending === true
                        ? '会话已删除；个别文件被占用，稍后自动清除'
                        : '会话已彻底删除');
                    return;
                }
                if (res.status === 409)
                    fail(data?.message || '会话正在运行，请等任务结束后再删除');
                else if (res.status === 404)
                    fail('会话不存在或已被删除');
                else if (res.status === 503)
                    fail('宿主工作区注册表未就绪，请稍后再试');
                else
                    fail(data?.message || `删除失败（HTTP ${res.status}）`);
            }
            catch {
                fail('无法连接伴侣服务');
            }
        })();
    });
    document.body.appendChild(root);
}
/**
 * 官方槽位注入：会话行 "…" 菜单的「删除会话…」。
 * 槽位契约（dsh-client-ui-workspace README）：条目只收 { sessionId,
 * displayTitle } 与 hookContext 提供的 useMenuOpenState；Module Loader lane
 * 用 factory 的 require 解析 react 与 ui-primitives（MenuItemButton 是隐式
 * baseline external）。宿主没有 slots 服务或 require 不可用时静默降级。
 */
function mountSessionDeleteAction(ctx, modRequire) {
    const slots = ctx.slots;
    if (slots === undefined)
        return;
    let React = null;
    let MenuItemButton = null;
    let TrashIcon = null;
    try {
        React = modRequire !== undefined ? modRequire('react') : null;
    }
    catch {
        React = null;
    }
    if (React === null || typeof React.createElement !== 'function')
        return;
    try {
        const primitives = modRequire !== undefined ? modRequire('@deepseek-ai/dsh-client-ui-primitives') : null;
        MenuItemButton = primitives != null ? primitives.MenuItemButton : null;
        // 宿主图标族里的删除图标（pin/fork/archive 用的同族 Outline Regular，size 14）。
        TrashIcon = primitives != null ? primitives.IconTrashOutlineRegular : null;
    }
    catch {
        MenuItemButton = null;
        TrashIcon = null;
    }
    const h = React.createElement;
    function DeleteSessionMenuItem(props) {
        const menuState = props.useMenuOpenState !== undefined ? props.useMenuOpenState() : null;
        const onSelect = () => {
            if (menuState !== null)
                menuState[1](false);
            openDeleteConfirm(props.sessionId, props.displayTitle ?? '');
        };
        // 危险操作红色：用宿主官方危险色令牌（带回退），span 内联色穿透
        // MenuItemButton 的默认前景。
        const dangerColor = 'var(--dsw-alias-state-error-primary, #e0564f)';
        const label = h('span', { style: { color: dangerColor } }, '删除会话…');
        if (typeof MenuItemButton === 'function') {
            const itemProps = { separatorBefore: true, onSelect };
            if (typeof TrashIcon === 'function') {
                // icon 槽位与宿主自带项对齐；包一层红色 flex span 让图标随文字吃危险色。
                itemProps.icon = h('span', { style: { color: dangerColor, display: 'flex', alignItems: 'center' } }, h(TrashIcon, { size: 14 }));
            }
            return h(MenuItemButton, itemProps, label);
        }
        // primitives 不可用时的兜底：原生 menuitem 按钮 + 内联 SVG 垃圾桶
        //（槽位协议允许自渲染；图标 14px 与宿主菜单项同规格）。
        return h('button', {
            type: 'button',
            role: 'menuitem',
            onClick: onSelect,
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: dangerColor,
            },
        }, h('svg', {
            width: 14,
            height: 14,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            'aria-hidden': 'true',
            style: { flex: 'none' },
        }, h('path', { d: 'M2.5 4h11M6.5 4V2.8h3V4M4.2 4l.6 9.2h6.4l.6-9.2M6.6 6.6v4.2M9.4 6.6v4.2' })), '删除会话…');
    }
    ctx.effect(() => {
        const dispose = slots.inject('sidebar.workspaces.session.menu.item', () => slots.register({
            name: 'sidebar.workspaces.session.menu.item',
            id: 'companion.delete-session',
            // 宿主自带 pin(100)/rename(200)/fork(300)/archive(400)/session-id(450)；
            // 550 排最后，separatorBefore 开出插件分组。
            order: 550,
        }, DeleteSessionMenuItem));
        return typeof dispose === 'function' ? dispose : undefined;
    });
}
/* ---------- 主装配 ---------- */
function mountBadge() {
    if (document.querySelector(`[${BADGE_ATTR}]`) !== null)
        return () => { };
    const container = document.createElement('div');
    container.setAttribute(BADGE_ATTR, '');
    container.setAttribute('data-dsh-plugin', 'dsh-companion');
    container.setAttribute('data-dsh-part', 'usage-badge');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.style.display = 'none';
    let serverUrl = '';
    let state = null;
    let stats = null;
    let stopped = false;
    let pollTimer = 0;
    let discoverTimer = 0;
    let panelModal = null;
    let offPanelKeys = null;
    const openPanelModal = () => {
        if (serverUrl === '' || panelModal === null)
            return;
        panelModal.iframe.src = `${serverUrl}/panel`;
        panelModal.root.setAttribute('data-open', '1');
        const onKey = (ev) => {
            if (ev.key === 'Escape')
                closePanelModal();
        };
        document.addEventListener('keydown', onKey, true);
        offPanelKeys = () => document.removeEventListener('keydown', onKey, true);
    };
    const setLiveText = (text) => {
        if (panelModal === null)
            return;
        const live = panelModal.root.querySelector('[data-dsh-part="panel-live"]');
        if (live !== null)
            live.textContent = text;
    };
    const closePanelModal = () => {
        if (panelModal === null)
            return;
        offPanelKeys?.();
        offPanelKeys = null;
        panelModal.iframe.src = 'about:blank';
        panelModal.root.setAttribute('data-open', '0');
    };
    // 角标点击 = 直接进完整统计面板（不要中间详情卡）。
    container.addEventListener('click', openPanelModal);
    container.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            openPanelModal();
        }
    });
    const refresh = () => {
        if (stopped)
            return;
        void (async () => {
            if (serverUrl === '') {
                const found = await discoverServer();
                if (found === null) {
                    container.style.display = 'none';
                    setLiveText('本地服务 · 离线');
                    return;
                }
                serverUrl = found.url;
                cachedServerUrl = found.url;
                state = found.state;
            }
            const [s, st] = await Promise.all([
                fetchJson(`${serverUrl}/api/state`),
                fetchJson(`${serverUrl}/api/stats?period=today`),
            ]);
            if (s === null) {
                // 服务消失（DSH 关闭/插件卸载）：收起大窗、隐藏角标，回到发现模式。
                closePanelModal();
                serverUrl = '';
                cachedServerUrl = '';
                state = null;
                stats = null;
                balanceInfo = null;
                balanceFetchedAt = 0;
                container.style.display = 'none';
                setLiveText('本地服务 · 离线');
                return;
            }
            state = s;
            stats = st;
            setLiveText('本地服务 · 已连接');
            renderBadge(container, state, stats, balanceInfo);
            // 余额/峰谷：用户要求放在左下角角标。余额 30s 拉一次，不阻塞状态/统计。
            if (Date.now() - balanceFetchedAt > 30_000) {
                balanceFetchedAt = Date.now();
                void fetchJson(`${serverUrl}/api/balance`).then((bal) => {
                    if (stopped || serverUrl === '')
                        return;
                    balanceInfo = bal;
                    renderBadge(container, state, stats, balanceInfo);
                }, () => { });
            }
        })();
    };
    const removeStyle = ensureStyle();
    placeBadge(container);
    if (panelModal === null) {
        panelModal = buildPanelModal(() => closePanelModal());
    }
    const observer = new MutationObserver(() => {
        if (container.isConnected)
            return;
        placeBadge(container);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible')
            refresh();
    }, POLL_MS);
    discoverTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible' && serverUrl === '')
            refresh();
    }, DISCOVER_MS);
    refresh();
    return () => {
        stopped = true;
        window.clearInterval(pollTimer);
        window.clearInterval(discoverTimer);
        closePanelModal();
        observer.disconnect();
        removeStyle();
        panelModal?.root.remove();
        panelModal = null;
        container.remove();
    };
}
const loader = window.__ModuleLoader__;
const entry = {
    id: '@qiuzhiyei/dsh-companion',
    factory: (modRequire) => {
        /** 角标/面板纯 DOM + fetch；「删除会话」菜单项依赖宿主 slots 服务。 */
        const inject = ['slots'];
        function apply(ctx) {
            const dispose = mountBadge();
            if (dispose !== undefined)
                ctx.effect(() => dispose);
            mountSessionDeleteAction(ctx, modRequire);
            // 推理等级：不改模型选择器，只在官方「推理等级」行上接管点击。
            mountReasoningControl(ctx);
        }
        return { apply, inject };
    },
};
if (loader !== undefined) {
    loader.load(entry);
}
else {
    // ModuleLoader 尚未就绪（加载顺序边缘情况）：晚一点再注册。
    window.addEventListener('DOMContentLoaded', () => {
        const late = window.__ModuleLoader__;
        if (late !== undefined)
            late.load(entry);
    });
}
