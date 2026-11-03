/**
 * dsh-companion — 统计面板页（/panel）。
 *
 * 视觉系统：01-设计稿「深海终端 v1.3」——低照度、荧光青、等宽数字、
 * 硬边界气泡、状态色语义（蓝=交互 / 青=进行中 / 琥珀=警示 / 珊瑚=错误）。
 *
 * 结构（与设计稿一一对应）：
 *   rail（任务 / 统计 / 会话 / 设置 + 余额 + 峰谷）
 *   page-head（标题 / 副标题 / 导出 / 刷新）
 *   tasks   —— 筛选工具条 + 实时任务行 + 任务表 + 分页 + 任务详情抽屉
 *   stats   —— 周期 + 消耗/产出指标组 + 诊断 + 图表 + 余额卡 + 排行 + 告警记录
 *   sessions—— 会话清单（多选 + 批量彻底删除）
 *   settings—— 伴侣 / 提醒 / 计费 / 数据 四组卡片（即时生效）
 *
 * 页面以模板字符串内嵌；嵌入式 JS 只能字符串拼接（不能出现模板字面量插值）。
 */
export function panelPageHTML() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH 伴侣 · 面板</title>
<style>
  :root{
    color-scheme: dark;
    --font-cjk:"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;
    --font-mono:"JetBrains Mono","Cascadia Mono",Consolas,ui-monospace,monospace;
    /* 面板字号倍率：设置页可调（0.9..1.1），所有 font-size 都乘这个变量。 */
    --ui-scale:1;
    --bg:#050d12; --win:#07141c; --surface:#0b1b24; --surface-2:#0e2431; --raise:#102b38;
    --line:rgba(126,197,214,.13); --line-strong:rgba(126,197,214,.22);
    --ink:#e8f3f6; --ink-2:#a8bfc7; --ink-3:#7d959e;
    --cyan:#46e5c3; --cyan-dim:#2a8f7c; --cyan-wash:rgba(70,229,195,.10);
    --amber:#f0b64a; --red:#ff7a7a; --blue:#6fb6ff;
    --r-card:14px; --r-ctl:9px; --ease:cubic-bezier(.2,.7,.3,1);
    --bar:#061119; --field-bg:rgba(255,255,255,.03); --hover:rgba(255,255,255,.03);
    --chart-grid:rgba(126,197,214,.10); --chart-axis:#6b838c; --chart-bar:#244c5c; --chart-now:#46e5c3;
    --shadow-card:0 12px 28px rgba(0,0,0,.18);
    --ok-ink:#7ff0d6; --bad-ink:#ffadad; --warn-ink:#f7cf86;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  [hidden]{display:none !important}
  html,body{height:100%}
  body{background:var(--win);color:var(--ink);font-family:var(--font-cjk);font-size:calc(14.5px * var(--ui-scale, 1));line-height:1.55;overflow:hidden;
    -webkit-font-smoothing:antialiased}
  button{font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer}
  input,select{font:inherit;color:inherit}
  :focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
  h1,h2,h3,h4{font-weight:600;letter-spacing:.01em}
  p{margin:0}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-thumb{background:rgba(126,197,214,.18);border-radius:4px}
  ::-webkit-scrollbar-track{background:transparent}

  /* ================= 窗口骨架 ================= */
  .win{position:relative;height:100%;display:grid;grid-template-rows:minmax(0,1fr) 26px;
    background:var(--win);overflow:clip}
  .win-body{display:grid;grid-template-columns:84px minmax(0,1fr);min-height:0}
  .rail{display:flex;flex-direction:column;align-items:center;padding:14px 10px 12px;
    border-right:1px solid var(--line);background:var(--bar);min-height:0}
  .nav-items{display:grid;gap:6px;width:100%}
  .nav-item{display:grid;justify-items:center;gap:3px;padding:9px 4px 8px;border-radius:12px;
    border:1px solid transparent;color:var(--ink-3);transition:all .16s var(--ease)}
  .nav-item:hover{color:var(--ink-2);background:var(--hover)}
  .nav-item.is-active{color:var(--cyan);background:var(--cyan-wash);border-color:rgba(70,229,195,.18)}
  .nav-item svg{width:19px;height:19px;display:block}
  .nav-item span{font-size:calc(13px * var(--ui-scale, 1));letter-spacing:.02em}

  .main{display:grid;grid-template-rows:66px minmax(0,1fr);min-height:0}
  .page-head{display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding:0 24px;border-bottom:1px solid var(--line);min-width:0}
  .page-head h2{font-size:calc(18px * var(--ui-scale, 1));letter-spacing:-.01em;white-space:nowrap}
  .page-head p{font-size:calc(13.5px * var(--ui-scale, 1));color:var(--ink-3);font-family:var(--font-mono);margin-top:2px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:62vw}
  .head-actions{display:flex;align-items:center;gap:8px;flex:none}
  .tag-demo{font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));letter-spacing:.08em;color:var(--ink-3);
    border:1px dashed var(--line-strong);border-radius:999px;padding:3px 8px;white-space:nowrap}
  .stale{margin-left:0;padding:2px 7px;border-radius:999px;background:rgba(255,122,122,.14);
    color:var(--bad-ink);font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));white-space:nowrap}
  .icon-btn{width:30px;height:30px;display:grid;place-items:center;border:1px solid var(--line);
    border-radius:var(--r-ctl);color:var(--ink-2);background:var(--field-bg);transition:all .15s}
  .icon-btn:hover{border-color:var(--cyan-dim);color:var(--cyan);background:var(--cyan-wash)}
  .icon-btn svg{width:14px;height:14px;display:block}
  .page-body{overflow-y:auto;padding:16px 24px 22px;scrollbar-width:thin;min-height:0}
  .pane{display:block}
  .pane:not([hidden]){animation:paneIn .22s var(--ease) both}
  @keyframes paneIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

  /* ================= 通用控件 ================= */
  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);
    box-shadow:0 1px 0 rgba(255,255,255,.03) inset,var(--shadow-card)}
  .card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:14px 16px;border-bottom:1px solid var(--line)}
  .ch-title{display:flex;align-items:baseline;gap:9px;min-width:0}
  .ch-title h3{font-size:calc(14.5px * var(--ui-scale, 1));letter-spacing:.02em}
  .ch-title span{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .ch-hint{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);white-space:nowrap}
  .toolbar-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;row-gap:8px;margin-bottom:12px}
  .toolbar-row .note{margin-left:auto;font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .seg{display:inline-flex;padding:3px;gap:2px;border:1px solid var(--line);border-radius:10px;
    background:var(--field-bg)}
  .seg button{padding:5px 13px;border-radius:7px;font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-3);transition:all .15s}
  .seg button:hover{color:var(--ink-2);background:var(--hover)}
  .seg button[aria-selected="true"],.seg button.is-active{background:var(--cyan-wash);color:var(--cyan);
    box-shadow:0 0 0 1px rgba(70,229,195,.16) inset}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 13px;
    border-radius:var(--r-ctl);border:1px solid var(--line);background:var(--field-bg);color:var(--ink-2);
    font-size:calc(14.5px * var(--ui-scale, 1));transition:all .15s;white-space:nowrap}
  .btn:hover{border-color:var(--cyan-dim);color:var(--ink)}
  .btn:active{transform:translateY(1px)}
  .btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
  .btn.sm{height:28px;padding:0 10px;font-size:calc(14px * var(--ui-scale, 1))}
  .btn.danger{border-color:rgba(255,122,122,.28);color:#ff9e9e;background:rgba(255,122,122,.06)}
  .btn.danger:hover{border-color:var(--red);color:#ffc0c0}
  .field{display:grid;gap:4px;min-width:0}
  .field>span{font-size:calc(12px * var(--ui-scale, 1));letter-spacing:.08em;color:var(--ink-3);text-transform:uppercase;
    font-family:var(--font-mono)}
  .field select,.field input{height:30px;padding:0 10px;background:var(--field-bg);
    border:1px solid var(--line);border-radius:var(--r-ctl);color:var(--ink);font-size:calc(14.5px * var(--ui-scale, 1));
    min-width:106px;transition:border-color .15s,background .15s}
  select option{background:var(--surface);color:var(--ink)}
  .field select:hover,.field input:hover{border-color:var(--line-strong)}
  .field select:focus,.field input:focus{outline:none;border-color:var(--cyan-dim);background:var(--cyan-wash)}
  .field input::placeholder{color:#5d757e}
  .field-search input{min-width:180px}
  .field-search{flex:1 1 200px;max-width:300px}
  .custom-range{display:flex;gap:8px;align-items:flex-end}
  .custom-range input{min-width:136px}
  .toolbar-row .spacer{flex:1}
  .switch{width:38px;height:20px;border-radius:999px;background:#1c3541;border:1px solid #24414e;
    position:relative;transition:background .18s,border-color .18s;flex:none}
  .switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#7d959e;transition:transform .18s,background .18s}
  .switch[aria-checked="true"]{background:rgba(70,229,195,.2);border-color:var(--cyan-dim)}
  .switch[aria-checked="true"]::after{transform:translateX(18px);background:var(--cyan)}
  input[type=range]{-webkit-appearance:none;appearance:none;width:104px;height:18px;
    background:transparent;cursor:pointer}
  input[type=range]::-webkit-slider-runnable-track{height:3px;background:#1c3541;border-radius:2px}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;
    background:var(--cyan);margin-top:-4.5px;border:none}
  input[type=range]::-moz-range-track{height:3px;background:#1c3541;border-radius:2px}
  input[type=range]::-moz-range-thumb{width:12px;height:12px;border:none;border-radius:50%;background:var(--cyan)}
  .range-val{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-2);width:42px;text-align:right;
    font-variant-numeric:tabular-nums}
  .num-input{width:92px;height:27px;padding:0 8px;background:var(--field-bg);border:1px solid var(--line);
    border-radius:7px;font-family:var(--font-mono);font-size:calc(13.5px * var(--ui-scale, 1));text-align:right;color:var(--ink)}
  .num-input:focus{border-color:var(--cyan-dim);outline:none}
  .unit{font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));color:var(--ink-3);width:34px}
  .skin-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,.22);
    flex:none;display:block}
  .skin-select{height:28px;padding:0 8px;background:var(--field-bg);border:1px solid var(--line);
    border-radius:8px;color:var(--ink);font-size:calc(14.5px * var(--ui-scale, 1));min-width:132px;cursor:pointer}
  .skin-select:hover{border-color:var(--line-strong)}
  .skin-select:focus{outline:none;border-color:var(--cyan-dim)}
  .skin-pick{display:flex;align-items:center;gap:10px;flex:none}
  .skin-pick img{width:58px;height:52px;flex:none;background:var(--bar);border:1px solid var(--line);
    border-radius:10px;padding:3px;object-fit:contain}
  .info{position:relative;display:inline-flex;align-items:center;justify-content:center;width:15px;
    height:15px;padding:0;margin-left:6px;vertical-align:1px;border:1px solid var(--line-strong);
    border-radius:50%;background:var(--field-bg);color:var(--ink-3);font-family:inherit;font-size:calc(13px * var(--ui-scale, 1));
    font-weight:600;line-height:1;cursor:help;flex:none}
  .info:hover,.info:focus{color:var(--ink);border-color:var(--cyan-dim);outline:none}
  .info::after{content:attr(data-tip);position:absolute;left:-6px;top:calc(100% + 9px);width:286px;
    padding:9px 11px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line-strong);
    color:var(--ink-2);font-size:calc(14px * var(--ui-scale, 1));font-weight:400;line-height:1.55;text-align:left;white-space:normal;
    opacity:0;transform:translateY(-3px);transition:opacity .12s,transform .12s;pointer-events:none;
    z-index:40;box-shadow:0 6px 18px rgba(0,0,0,.35)}
  .info:hover::after,.info:focus::after{opacity:1;transform:none}

  /* ================= 任务 ================= */
  .table-toolbar{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .table-card{overflow:hidden}
  .table-head{flex-wrap:wrap;align-items:center;gap:10px}
  .table-scroll{overflow-x:auto}
  table.task-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:calc(14.5px * var(--ui-scale, 1));min-width:760px}
  .task-table thead th{text-align:left;font-weight:500;font-size:calc(12.5px * var(--ui-scale, 1));letter-spacing:.1em;
    text-transform:uppercase;color:var(--ink-3);padding:9px 14px;background:var(--field-bg);
    border-bottom:1px solid var(--line);font-family:var(--font-mono)}
  .task-table td{padding:8px 14px;border-bottom:1px solid rgba(126,197,214,.07);vertical-align:middle}
  .task-table tbody tr{transition:background .15s;cursor:pointer}
  .task-table tbody tr:hover{background:rgba(70,229,195,.035)}
  .task-table tbody tr:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
  .task-table tbody tr:last-child td{border-bottom:none}
  .cell-stack{display:grid;gap:1px;min-width:0}
  .cell-stack time{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3)}
  .cell-stack b{font-size:calc(14.5px * var(--ui-scale, 1));font-weight:500;color:var(--ink);display:block;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .model-name{font-family:var(--font-mono);font-size:calc(13.5px * var(--ui-scale, 1));color:var(--ink-2);overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;display:block}
  .status{display:inline-flex;align-items:center;gap:5px;font-size:calc(13px * var(--ui-scale, 1));padding:2px 8px;
    border-radius:999px;border:1px solid transparent;white-space:nowrap}
  .status i{width:5px;height:5px;border-radius:50%;flex:none}
  .status.ok{color:var(--ok-ink);background:rgba(70,229,195,.09);border-color:rgba(70,229,195,.18)}
  .status.ok i{background:var(--cyan)}
  .status.fail{color:var(--bad-ink);background:rgba(255,122,122,.09);border-color:rgba(255,122,122,.2)}
  .status.fail i{background:var(--red)}
  .status.interrupted{color:var(--warn-ink);background:rgba(240,182,74,.09);border-color:rgba(240,182,74,.2)}
  .status.interrupted i{background:var(--amber)}
  .status.run{color:#9fd8ff;background:rgba(111,182,255,.1);border-color:rgba(111,182,255,.22)}
  .status.run i{background:var(--blue)}
  .task-table .num{font-family:var(--font-mono);font-size:calc(13.5px * var(--ui-scale, 1));color:var(--ink-2);text-align:right;
    font-variant-numeric:tabular-nums;white-space:nowrap}
  .task-table th.r{text-align:right}
  .task-table .cost{color:var(--ink);font-weight:500}
  .empty-row td{padding:42px 14px;text-align:center;color:var(--ink-3);font-size:calc(14px * var(--ui-scale, 1))}
  .table-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;
    border-top:1px solid var(--line)}
  .table-foot .info2{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .pager{display:flex;gap:4px;align-items:center}
  .pager button{min-width:27px;height:27px;padding:0 8px;border:1px solid var(--line);border-radius:8px;
    font-size:calc(13.5px * var(--ui-scale, 1));font-family:var(--font-mono);color:var(--ink-3);background:var(--field-bg);
    transition:all .15s}
  .pager button:hover:not(:disabled){border-color:var(--cyan-dim);color:var(--ink)}
  .pager button[aria-current="true"]{border-color:var(--cyan-dim);background:var(--cyan-wash);color:var(--cyan)}
  .pager button:disabled{opacity:.35;cursor:not-allowed}
  .pager .dots{color:var(--ink-3);padding:0 2px;font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1))}
  .live-task{display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--line);
    background:rgba(70,229,195,.05);cursor:pointer;transition:background .15s}
  .live-task:hover{background:rgba(70,229,195,.08)}
  .live-task:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 8px var(--cyan);
    animation:pulse 2s infinite;flex:none}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .live-name{font-size:calc(14.5px * var(--ui-scale, 1));font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis;max-width:220px}
  .live-meta{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);white-space:nowrap}
  .live-bar{flex:1;min-width:60px;height:4px;border-radius:2px;background:rgba(255,255,255,.07);
    overflow:hidden}
  .live-bar i{display:block;height:100%;width:0;background:var(--cyan);border-radius:2px;transition:width .3s}
  .live-bar i.warn{background:var(--amber)}
  .live-bar i.over{background:var(--red)}
  .live-pct{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--cyan);white-space:nowrap}
  .live-open{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);white-space:nowrap}

  /* ================= 统计 ================= */
  .metric-groups{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:10px}
  .metric-group{min-width:0}
  .group-cap{display:flex;align-items:center;gap:7px;margin-bottom:6px;font-family:var(--font-mono);
    font-size:calc(12px * var(--ui-scale, 1));letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
  .group-cap span{font-weight:500}
  .group-cap em{font-style:normal;color:#4f6a74;font-size:calc(11px * var(--ui-scale, 1))}
  .group-cap::after{content:"";flex:1;height:1px;background:var(--line)}
  .metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .metric-card{padding:11px 12px 9px;border-radius:var(--r-card);background:var(--surface);
    border:1px solid var(--line);display:grid;gap:5px;transition:border-color .16s,transform .16s,box-shadow .16s;
    box-shadow:0 1px 0 rgba(255,255,255,.03) inset;min-width:0}
  .metric-card:hover{border-color:rgba(70,229,195,.24);transform:translateY(-1px);
    box-shadow:0 12px 24px rgba(0,0,0,.22)}
  .mc-top{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
  .mc-label{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));letter-spacing:.06em;color:var(--ink-3);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mc-delta{font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));padding:2px 6px;border-radius:999px;
    white-space:nowrap;display:inline-flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums}
  .mc-delta svg{width:8px;height:8px;display:block}
  .mc-delta.good{color:var(--cyan);background:rgba(70,229,195,.10)}
  .mc-delta.bad{color:#ff9e9e;background:rgba(255,122,122,.10)}
  .mc-delta.flat{color:var(--ink-3);background:var(--field-bg)}
  .mc-value{font-family:var(--font-mono);font-size:calc(22px * var(--ui-scale, 1));line-height:1.2;letter-spacing:-.03em;
    color:var(--ink);min-width:0;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap}
  .mc-value small{font-size:calc(14px * var(--ui-scale, 1));color:var(--ink-3);margin-left:2px;letter-spacing:0}
  .mc-sub{font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));line-height:1.35;color:var(--ink-3);
    letter-spacing:-.01em;margin-top:1px;min-height:2.7em;overflow:hidden;text-overflow:ellipsis}
  .diagnosis{display:grid;gap:5px;padding:11px 14px;margin-bottom:12px;
    border:1px solid rgba(70,229,195,.16);border-radius:12px;background:rgba(70,229,195,.04)}
  .diag-row{display:flex;gap:8px;align-items:flex-start;font-size:calc(14px * var(--ui-scale, 1));line-height:1.55;color:var(--ink-2)}
  .diag-row svg{width:12px;height:12px;flex:none;color:var(--cyan);margin-top:2px}
  .diag-row.tone-warn svg{color:var(--amber)}
  .diag-row.tone-bad svg{color:var(--red)}
  .diag-row.tone-good svg{color:var(--cyan)}
  .diag-row b{color:var(--ink);font-weight:500}
  .diag-row em{font-style:normal;font-family:var(--font-mono);color:var(--cyan)}
  .stats-grid{display:grid;gap:12px;margin-bottom:12px}
  .chart-card{padding:15px 16px 13px;position:relative}
  .chart-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap}
  .chart-head h3{font-size:calc(14.5px * var(--ui-scale, 1))}
  .chart-head .chart-note{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .chart-head .spacer{flex:1}
  .legend{display:flex;gap:14px;margin-bottom:2px;font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));
    color:var(--ink-3)}
  .legend i{display:inline-block;width:8px;height:8px;margin-right:5px;border-radius:3px;vertical-align:0}
  #tokenChart{display:block;width:100%;height:auto}
  #tokenChart .grid{stroke:var(--chart-grid);stroke-width:1;stroke-dasharray:2 4}
  #tokenChart .ax{fill:var(--chart-axis);font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1))}
  #tokenChart .bar{fill:var(--chart-bar);transition:fill .2s,opacity .1s}
  #tokenChart .bar.is-active{fill:var(--chart-now)}
  #tokenChart .bar.hot{fill:var(--cyan)}
  #tokenChart.has-hot rect.bar:not(.hot){opacity:.45}
  #chartEmpty{display:grid;place-items:center;min-height:150px}
  #chartSkeleton .sk-chart{display:block;width:100%;height:190px;border-radius:10px}
  .chart-foot{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));
    color:var(--ink-3);margin-top:6px}
  .chart-tip{position:absolute;z-index:20;transform:translate(-50%,-100%);padding:6px 9px;border-radius:8px;
    background:var(--surface-2);border:1px solid var(--line-strong);color:var(--ink);font-size:calc(14px * var(--ui-scale, 1));
    line-height:1.45;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .1s;
    box-shadow:0 8px 20px rgba(0,0,0,.35)}
  .chart-tip.show{opacity:1}
  .balance-card{padding:16px 18px;display:grid;align-items:center;gap:24px;
    grid-template-columns:minmax(180px,1.05fr) minmax(0,2fr) minmax(190px,1.15fr)}
  .bal-top{display:grid;gap:0;min-width:0}
  .bal-label{font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));letter-spacing:.12em;text-transform:uppercase;
    color:var(--ink-3)}
  .bal-amount{display:flex;align-items:baseline;gap:6px;margin-top:3px}
  .bal-amount b{font-family:var(--font-mono);font-size:calc(30px * var(--ui-scale, 1));font-weight:500;letter-spacing:-.04em;
    line-height:1.1;font-variant-numeric:tabular-nums}
  .bal-amount span{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--cyan)}
  .bal-chip{display:inline-flex;align-items:center;gap:5px;margin-top:7px;padding:3px 8px;
    border-radius:999px;justify-self:start;background:rgba(70,229,195,.08);
    border:1px solid rgba(70,229,195,.16);font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));color:var(--cyan);
    max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bal-chip.is-muted{background:var(--field-bg);border-color:var(--line);color:var(--ink-3)}
  .bal-rows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0}
  .bal-row{display:grid;gap:4px;padding:0 0 0 20px;border-left:1px solid var(--line);min-width:0}
  .bal-row:first-child{border-left:none;padding-left:0}
  .bal-row span{font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .bal-row b{font-family:var(--font-mono);font-weight:500;color:var(--ink);font-size:calc(15px * var(--ui-scale, 1));
    font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bal-trend{display:grid;gap:4px;min-width:0}
  #spark{display:block;width:100%;height:38px}
  #spark polyline{fill:none;stroke:var(--cyan);stroke-width:1.4}
  #spark .area{fill:rgba(70,229,195,.08);stroke:none}
  .spark-empty{font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));color:var(--ink-3);height:38px;
    display:flex;align-items:center}
  .bal-foot{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));
    color:var(--ink-3);gap:8px}
  .rank-grid{display:grid;gap:12px}
  .rank-card{padding:14px 16px}
  .rank-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;gap:10px}
  .rank-head h3{font-size:calc(14.5px * var(--ui-scale, 1))}
  .rank-head span{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3)}
  .rank-row{display:grid;grid-template-columns:minmax(110px,190px) minmax(40px,1fr) auto 78px;gap:14px;
    padding:8px 0;border-bottom:1px solid rgba(126,197,214,.07);align-items:center}
  .rank-row:last-child{border-bottom:none}
  .rank-name{display:flex;align-items:center;gap:8px;min-width:0;font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-2)}
  .rank-name b{font-weight:500;color:var(--ink);font-size:calc(14.5px * var(--ui-scale, 1));overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap}
  .rank-name .dot{width:5px;height:5px;border-radius:2px;flex:none}
  .rank-val{font-family:var(--font-mono);font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink);text-align:right;
    font-variant-numeric:tabular-nums;white-space:nowrap}
  .rank-meta{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);text-align:right;
    white-space:nowrap}
  .rank-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.05);overflow:hidden}
  .rank-bar i{display:block;height:100%;border-radius:2px}
  .rank-empty{color:var(--ink-3);font-size:calc(14px * var(--ui-scale, 1));padding:14px 0 6px;text-align:center}
  .alert-card{margin-top:0}
  .alert-list{display:grid}
  .alert-row{display:grid;grid-template-columns:74px 62px 1fr;gap:10px;align-items:center;
    padding:9px 16px;border-bottom:1px solid rgba(126,197,214,.07)}
  .alert-row:last-child{border-bottom:none}
  .alert-time{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);white-space:nowrap}
  .alert-type{display:inline-flex;align-items:center;justify-content:center;height:18px;
    border-radius:999px;font-family:var(--font-mono);font-size:calc(11.5px * var(--ui-scale, 1));letter-spacing:.04em;
    border:1px solid transparent}
  .alert-type.warn{color:var(--warn-ink);background:rgba(240,182,74,.09);border-color:rgba(240,182,74,.2)}
  .alert-type.error{color:var(--bad-ink);background:rgba(255,122,122,.09);border-color:rgba(255,122,122,.2)}
  .alert-type.info{color:var(--cyan);background:rgba(70,229,195,.08);border-color:rgba(70,229,195,.18)}
  .alert-text{font-size:calc(13.5px * var(--ui-scale, 1));color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .alert-empty{padding:30px 16px;text-align:center;color:var(--ink-3);font-size:calc(14.5px * var(--ui-scale, 1))}

  /* ================= 详情抽屉 ================= */
  .drawer-scrim{position:absolute;left:0;right:0;top:0;bottom:26px;background:rgba(3,10,14,.58);
    z-index:30;opacity:0;transition:opacity .2s;pointer-events:none}
  .drawer-scrim.is-on{opacity:1;pointer-events:auto}
  .drawer{position:absolute;top:0;right:0;bottom:26px;width:clamp(560px,78%,1000px);z-index:31;
    display:flex;flex-direction:column;container-type:inline-size;
    background:linear-gradient(180deg,var(--surface-2),var(--win) 30%);
    border-left:1px solid var(--line-strong);border-radius:16px 0 0 16px;
    box-shadow:-24px 0 60px rgba(0,0,0,.5);transform:translateX(100%);
    transition:transform .24s var(--ease)}
  .drawer.is-open{transform:none}
  .drawer-head{display:flex;align-items:flex-start;gap:14px;padding:20px 24px;
    border-bottom:1px solid var(--line)}
  .drawer-head .dh-text{min-width:0;flex:1}
  .dh-kicker{display:block;font-family:var(--font-mono);font-size:calc(11px * var(--ui-scale, 1));letter-spacing:.18em;
    text-transform:uppercase;color:var(--ink-3);margin-bottom:5px}
  .drawer-head h3{font-size:calc(18px * var(--ui-scale, 1));line-height:1.35;margin-bottom:6px;overflow-wrap:anywhere}
  .drawer-head .dh-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
    font-family:var(--font-mono);font-size:calc(13.5px * var(--ui-scale, 1));color:var(--ink-3)}
  .drawer-close{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--line);
    border-radius:9px;color:var(--ink-2);flex:none;transition:all .15s}
  .drawer-close:hover{border-color:var(--cyan-dim);color:var(--cyan)}
  .drawer-close svg{width:14px;height:14px;display:block}
  .drawer-body{overflow-y:auto;padding:20px 24px 28px;display:grid;gap:20px;min-height:0}
  .dw-sec>h4{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));letter-spacing:.14em;text-transform:uppercase;
    color:var(--ink-3);margin-bottom:10px}
  .dw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .dw-stat{padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--field-bg)}
  .dw-stat span{display:block;font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);
    margin-bottom:5px}
  .dw-stat b{font-family:var(--font-mono);font-size:calc(15px * var(--ui-scale, 1));font-weight:500;color:var(--ink);
    font-variant-numeric:tabular-nums}
  .tok-bar{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;margin:6px 0 11px;
    background:rgba(255,255,255,.04)}
  .tok-bar i{display:block;height:100%}
  .dw-legend{display:grid;gap:7px}
  .dw-line{display:flex;align-items:center;gap:9px;font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-2)}
  .dw-line i.sw{width:9px;height:9px;border-radius:3px;flex:none}
  .dw-line b{margin-left:auto;font-family:var(--font-mono);font-weight:500;color:var(--ink);font-size:calc(14px * var(--ui-scale, 1));
    font-variant-numeric:tabular-nums}
  .dw-line em{font-style:normal;font-family:var(--font-mono);color:var(--ink-3);font-size:calc(13.5px * var(--ui-scale, 1));
    width:72px;text-align:right}
  .dw-table{display:grid}
  .dw-trow{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:9px 0;
    border-bottom:1px solid rgba(126,197,214,.07);font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-2);align-items:center}
  .dw-trow:last-child{border-bottom:none}
  .dw-trow b{font-family:var(--font-mono);font-weight:500;color:var(--ink);text-align:right;
    font-variant-numeric:tabular-nums}
  .dw-trow em{font-style:normal;font-family:var(--font-mono);color:var(--ink-3);width:64px;
    text-align:right;font-size:calc(13.5px * var(--ui-scale, 1))}
  .dw-total{display:flex;justify-content:space-between;padding-top:9px;margin-top:2px;
    border-top:1px solid var(--line);font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-2)}
  .dw-total b{font-family:var(--font-mono);color:var(--cyan);font-weight:500;font-size:calc(15px * var(--ui-scale, 1));
    font-variant-numeric:tabular-nums}
  .tool-seq{display:flex;flex-wrap:wrap;gap:6px}
  .tool-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--line);
    border-radius:999px;font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-2)}
  .tool-chip i{width:5px;height:5px;border-radius:50%;background:var(--cyan-dim)}
  .tool-chip.fail i{background:var(--red)}
  .tool-note{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);margin-top:8px;line-height:1.6}
  .err-box{border:1px solid rgba(255,122,122,.24);background:rgba(255,122,122,.05);
    border-radius:11px;padding:12px 14px}
  .err-box b{display:block;font-size:calc(14.5px * var(--ui-scale, 1));color:var(--bad-ink);margin-bottom:3px}
  .err-box p{font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-2);line-height:1.55}
  .err-box.info{border-color:rgba(111,182,255,.24);background:rgba(111,182,255,.05)}
  .err-box.info b{color:#9fd8ff}
  .err-box.warn{border-color:rgba(240,182,74,.26);background:rgba(240,182,74,.05)}
  .err-box.warn b{color:var(--warn-ink)}
  .err-box.good{border-color:rgba(70,229,195,.24);background:rgba(70,229,195,.05)}
  .err-box.good b{color:var(--cyan)}
  .drawer-foot{display:flex;gap:10px;padding:14px 24px;border-top:1px solid var(--line);
    background:var(--bar)}
  .drawer-foot .btn{flex:1}
  .budget-line{display:flex;align-items:center;gap:10px;margin-top:8px;
    font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .budget-line .bar{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
  .budget-line .bar i{display:block;height:100%;background:var(--cyan)}
  .budget-line .bar i.warn{background:var(--amber)}
  .budget-line .bar i.over{background:var(--red)}
  @container (min-width:760px){
    .drawer-body{grid-template-columns:1fr 1fr;align-content:start;gap:22px 26px;padding:24px 28px 32px}
    .drawer-head{padding:24px 28px}
    .drawer-head h3{font-size:calc(20px * var(--ui-scale, 1))}
    .dw-sec:first-child{grid-column:1/-1}
    .dw-wide{grid-column:1/-1}
    .dw-stat b{font-size:calc(17px * var(--ui-scale, 1))}
    .drawer-foot{padding:16px 28px}
  }

  /* ================= 会话 ================= */
  .sessions-bar{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .check-all{display:flex;align-items:center;gap:7px;font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-2);cursor:pointer}
  .check-all input{accent-color:var(--cyan);width:14px;height:14px;cursor:pointer}
  #sel-count,#smSummary{font-family:var(--font-mono);font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3)}
  .sessions-bar .btn{margin-left:auto}
  .sm-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .sm-q{width:230px;flex:0 1 230px}
  .sm-sort{height:30px;padding:0 8px;background:var(--field-bg);color:var(--ink);
    border:1px solid var(--line);border-radius:var(--r-ctl);font-size:calc(14.5px * var(--ui-scale, 1))}
  details.more{position:relative}
  details.more summary{list-style:none;cursor:pointer}
  details.more summary::-webkit-details-marker{display:none}
  .more-body{position:absolute;right:0;top:calc(100% + 6px);z-index:20;display:flex;
    flex-direction:column;gap:6px;background:var(--surface-2);border:1px solid var(--line-strong);
    border-radius:10px;padding:8px;min-width:140px;box-shadow:0 8px 22px rgba(0,0,0,.35)}
  .more-body .btn{justify-content:flex-start}
  .session-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
  .session{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:14px;
    padding:12px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface);
    transition:all .15s;cursor:pointer}
  .session:hover{border-color:var(--line-strong);transform:translateY(-1px)}
  .session.is-selected{border-color:rgba(70,229,195,.35);background:rgba(70,229,195,.05)}
  .session-check{display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0}
  .session-check input{accent-color:var(--cyan);width:14px;height:14px;flex:none;cursor:pointer}
  .session-title{font-size:calc(14px * var(--ui-scale, 1));color:var(--ink);overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap;display:block}
  .session-title small{display:block;font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));color:var(--ink-3);
    margin-top:1px;overflow:hidden;text-overflow:ellipsis}
  .session-meta{display:flex;gap:14px;font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);
    white-space:nowrap}
  .session-tags{display:flex;gap:5px;justify-content:flex-end;min-width:80px}
  .tag{display:inline-block;padding:1px 7px;border-radius:9px;font-family:var(--font-mono);font-size:calc(11.5px * var(--ui-scale, 1));
    white-space:nowrap}
  .tag.arch{background:rgba(126,197,214,.10);color:var(--ink-2)}
  .tag.pin{background:rgba(240,182,74,.12);color:var(--warn-ink)}
  .empty-sessions{padding:46px 18px;text-align:center;color:var(--ink-3);font-size:calc(14px * var(--ui-scale, 1));
    border:1px dashed var(--line-strong);border-radius:12px}
  .bulk-bar,.sm-confirm{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:40;
    display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;font-size:calc(14px * var(--ui-scale, 1));
    max-width:min(1180px,calc(100vw - 44px));box-shadow:0 10px 30px rgba(0,0,0,.42);
    backdrop-filter:blur(10px)}
  .bulk-bar{background:rgba(11,27,36,.96);border:1px solid var(--line-strong);color:var(--ink)}
  .bulk-text b{color:var(--cyan);font-weight:600;font-variant-numeric:tabular-nums}
  .bulk-spacer{flex:1}
  .sm-confirm{background:rgba(58,28,28,.96);border:1px solid #b05252;color:var(--bad-ink)}
  .sm-confirm .btn{flex:none}
  .sm-confirm .btn.danger{background:rgba(143,58,52,.9);color:#ffe3da;border-color:#b05252}

  /* ================= 设置 ================= */
  .settings-shell{display:block}
  .settings-nav{display:flex;gap:0;overflow-x:auto;border-bottom:1px solid var(--line);
    margin-bottom:16px;scrollbar-width:none}
  .settings-nav::-webkit-scrollbar{display:none}
  .settings-nav button{position:relative;height:38px;padding:0 4px;margin-right:24px;flex:none;
    font-size:calc(14.5px * var(--ui-scale, 1));color:var(--ink-3);white-space:nowrap;transition:color .15s}
  .settings-nav button::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;
    border-radius:2px 2px 0 0;background:transparent;transition:background .15s}
  .settings-nav button:hover{color:var(--ink-2)}
  .settings-nav button.on{color:var(--cyan)}
  .settings-nav button.on::after{background:var(--cyan)}
  .settings-nav button:last-child{margin-right:0}
  .settings-group{display:none}
  .settings-group.on{display:block}
  .settings-desc{font-size:calc(14px * var(--ui-scale, 1));color:var(--ink-3);margin:0 0 12px}
  .settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .setting-card{padding:14px;border:1px solid var(--line);border-radius:var(--r-card);
    background:var(--surface);box-shadow:0 1px 0 rgba(255,255,255,.03) inset;min-width:0}
  .setting-card>h4,.sc-head h4{font-size:calc(14.5px * var(--ui-scale, 1));margin-bottom:3px;display:flex;align-items:center}
  .sc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:3px}
  .setting-card>p{font-size:calc(13px * var(--ui-scale, 1));color:var(--ink-3);margin-bottom:10px;line-height:1.55}
  .setting-card.wide{grid-column:1/-1}
  .setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;
    border-top:1px solid rgba(126,197,214,.07)}
  .setting-row:first-of-type{border-top:none}
  .setting-row .label{font-size:calc(14px * var(--ui-scale, 1));color:var(--ink-2);min-width:0}
  .setting-row .hint{display:block;font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);margin-top:1px}
  .setting-row .control{display:flex;align-items:center;gap:8px;flex:none}
  .wide-split{display:grid;grid-template-columns:1fr;gap:24px;align-items:start}
  .price-meta{display:flex;justify-content:space-between;gap:10px;margin-top:10px;
    font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));color:var(--ink-3)}
  #officialRows{overflow-x:auto}
  .price-table{width:100%;min-width:430px;border-collapse:collapse;margin-top:6px;font-size:calc(13.5px * var(--ui-scale, 1))}
  .price-table th,.price-table td{padding:7px 8px;border-bottom:1px solid rgba(126,197,214,.08);
    text-align:right;font-family:var(--font-mono);white-space:nowrap}
  .price-table th{font-size:calc(11.5px * var(--ui-scale, 1));letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);
    font-weight:500}
  .price-table th:first-child,.price-table td:first-child{text-align:left;font-family:var(--font-cjk);
    color:var(--ink-2);text-transform:none;letter-spacing:0}
  .price-table td{color:var(--ink-2)}
  .price-table .op-off{display:block;color:var(--cyan-dim);font-size:calc(12px * var(--ui-scale, 1));margin-top:1px}
  .price-note{margin-top:8px;font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);line-height:1.55}
  .price-empty{color:var(--ink-3);font-size:calc(14px * var(--ui-scale, 1));text-align:center;padding:14px;
    background:var(--field-bg);border:1px dashed var(--line-strong);border-radius:10px;margin-top:8px}
  .official-box{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
    background:var(--field-bg);border:1px solid var(--line);border-radius:10px;padding:9px 12px;
    font-size:calc(14px * var(--ui-scale, 1));color:var(--ink-3);line-height:1.6}
  .official-box b{color:var(--ink-2)}
  .official-box .off-ok{color:var(--cyan)}
  .official-box .off-warn{color:var(--warn-ink)}
  .budget-row{display:grid;grid-template-columns:1fr 96px 26px;align-items:center;gap:8px;padding:5px 0}
  .budget-row span{font-size:calc(13.5px * var(--ui-scale, 1));color:var(--ink-2)}
  .budget-usage{margin-top:10px}
  .budget-usage .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
  .budget-usage .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--cyan),var(--amber));
    transition:width .3s ease}
  .budget-usage .bar i.warn{background:linear-gradient(90deg,var(--amber),var(--red))}
  .budget-text{margin-top:6px;font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1));color:var(--ink-3);line-height:1.6}
  .btn-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}
  .act-btn{background:var(--field-bg);color:var(--ink-2);border:1px solid var(--line);
    border-radius:10px;padding:10px 12px;cursor:pointer;font-size:calc(14px * var(--ui-scale, 1));width:100%;transition:all .15s}
  .act-btn:hover{border-color:var(--cyan-dim);color:var(--ink);background:var(--hover)}
  .act-btn:disabled{opacity:.45;cursor:not-allowed}
  .act-btn.danger{background:rgba(143,58,52,.3);color:#ffe3da;border-color:#b05252}
  .retention-confirm{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:calc(14.5px * var(--ui-scale, 1));
    line-height:1.6;background:rgba(58,28,28,.95);border:1px solid #b05252;color:var(--bad-ink)}
  .retention-confirm .rc-actions{display:flex;gap:8px;margin-top:8px}
  .retention-confirm .rc-actions .act-btn{width:auto;flex:1;padding:6px 10px;font-size:calc(14px * var(--ui-scale, 1))}
  .mini-table{width:100%;border-collapse:collapse;font-size:calc(13px * var(--ui-scale, 1))}
  .mini-table th{text-align:left;font-weight:500;color:var(--ink-3);font-size:calc(11.5px * var(--ui-scale, 1));letter-spacing:.06em;
    padding:5px 0;border-bottom:1px solid var(--line);font-family:var(--font-mono)}
  .mini-table td{padding:6px 0;border-bottom:1px solid rgba(126,197,214,.07);color:var(--ink-2)}
  .mini-table td:first-child{font-family:var(--font-mono);font-size:calc(12.5px * var(--ui-scale, 1))}
  .mini-table td:last-child{text-align:right}

  /* ================= 状态栏 / toast / 骨架 ================= */
  .win-status{display:flex;align-items:center;gap:14px;padding:0 14px;background:var(--bar);
    border-top:1px solid var(--line);font-family:var(--font-mono);font-size:calc(12px * var(--ui-scale, 1));color:#5d7881;
    letter-spacing:.03em;white-space:nowrap;overflow:hidden}
  .win-status .st-dot{width:5px;height:5px;border-radius:50%;background:var(--cyan);
    box-shadow:0 0 7px var(--cyan);flex:none}
  .win-status .st-dot.off{background:var(--red);box-shadow:0 0 7px var(--red)}
  .win-status .right{margin-left:auto;display:flex;gap:14px;min-width:0;overflow:hidden}
  .win-status b{font-weight:500;color:var(--ink-3)}
  .save-toast{position:fixed;right:24px;bottom:24px;z-index:50;padding:10px 14px;border-radius:10px;
    background:var(--surface-2);border:1px solid var(--cyan-dim);color:var(--ink);font-size:calc(14px * var(--ui-scale, 1));
    box-shadow:0 12px 30px rgba(0,0,0,.5);transform:translateY(12px);opacity:0;
    transition:opacity .2s var(--ease),transform .2s var(--ease);pointer-events:none;max-width:70vw}
  .save-toast.is-on{opacity:1;transform:translateY(0)}
  .save-toast.err{border-color:var(--red);color:var(--bad-ink)}
  .sk{display:inline-block;height:10px;border-radius:6px;
    background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.10) 37%,rgba(255,255,255,.04) 63%);
    background-size:400% 100%;animation:skShimmer 1.4s ease-in-out infinite}
  .sk-line{display:block;height:9px}
  .sk-num{display:block;width:62%;height:22px;margin-top:8px}
  .sk-chart{display:block;width:100%;height:190px;border-radius:10px}
  @keyframes skShimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}
  .empty-cell{text-align:center;padding:30px 10px;color:var(--ink-3)}
  .empty-cell b{display:block;color:var(--ink);font-size:calc(14.5px * var(--ui-scale, 1));font-weight:600;margin-bottom:4px}
  .empty-art{display:block;width:84px;height:56px;margin:0 auto 10px;color:var(--cyan-dim);opacity:.7}

  /* ================= 浅色主题（跟随系统；深色为默认） ================= */
  @media (prefers-color-scheme: light){
    :root{color-scheme:light;
      --bg:#eef3f5; --win:#f8fbfb; --surface:#ffffff; --surface-2:#f1f7f8; --raise:#e8f1f3;
      --line:rgba(22,60,72,.12); --line-strong:rgba(22,60,72,.22);
      --ink:#16232b; --ink-2:#41565f; --ink-3:#6b828b;
      --cyan:#0e8a74; --cyan-dim:#0b6b5b; --cyan-wash:rgba(14,138,116,.10);
      --amber:#a86a00; --red:#c2453a; --blue:#2b6fb8;
      --bar:#eef4f5; --field-bg:#ffffff; --hover:rgba(16,60,72,.04);
      --chart-grid:rgba(22,60,72,.10); --chart-axis:#7b8b9a; --chart-bar:#b9d6dc; --chart-now:#0e8a74;
      --shadow-card:0 10px 24px rgba(20,45,60,.07);
      --ok-ink:#1d7a66; --bad-ink:#b3402e; --warn-ink:#8a5a00;
    }
    body{background:var(--win)}
    .rail,.win-status,.drawer-foot{background:#eef4f5}
    .win-status{color:#6b828b}
    .nav-item.is-active{background:rgba(14,138,116,.1);border-color:rgba(14,138,116,.22)}
    .switch{background:#c6d0da;border-color:#b6c2cc}
    .switch::after{background:#fff}
    .switch[aria-checked="true"]{background:rgba(14,138,116,.2);border-color:var(--cyan-dim)}
    input[type=range]::-webkit-slider-runnable-track{background:#d5dde6}
    input[type=range]::-moz-range-track{background:#d5dde6}
    .status.ok{color:#1d7a66;background:rgba(14,138,116,.09);border-color:rgba(14,138,116,.2)}
    .status.fail{color:#b3402e;background:rgba(194,69,58,.08);border-color:rgba(194,69,58,.2)}
    .status.interrupted{color:#8a5a00;background:rgba(168,106,0,.08);border-color:rgba(168,106,0,.2)}
    .status.run{color:#2b6fb8;background:rgba(43,111,184,.08);border-color:rgba(43,111,184,.2)}
    .live-task{background:rgba(14,138,116,.06)}
    .live-task:hover{background:rgba(14,138,116,.1)}
    .live-bar{background:rgba(22,60,72,.10)}
    .metric-card:hover{box-shadow:0 10px 20px rgba(20,45,60,.1)}
    .mc-delta.good{background:rgba(14,138,116,.10)}
    .mc-delta.bad{color:#b3402e;background:rgba(194,69,58,.08)}
    .diagnosis{background:rgba(14,138,116,.04);border-color:rgba(14,138,116,.16)}
    .bal-chip{background:rgba(14,138,116,.07);border-color:rgba(14,138,116,.16)}
    .rank-bar{background:rgba(22,60,72,.08)}
    .task-table thead th{background:#f2f7f8}
    .task-table tbody tr:hover{background:rgba(14,138,116,.04)}
    .task-table td{border-bottom-color:#e8eef0}
    .cell-stack b,.setting-row .label,.rank-name b{color:var(--ink)}
    .alert-type.warn{background:rgba(168,106,0,.08);border-color:rgba(168,106,0,.22)}
    .alert-type.error{background:rgba(194,69,58,.08);border-color:rgba(194,69,58,.2)}
    .alert-type.info{background:rgba(14,138,116,.08);border-color:rgba(14,138,116,.18)}
    .drawer{background:linear-gradient(180deg,#fff,#f6fafb 30%);box-shadow:-24px 0 60px rgba(20,45,60,.18)}
    .drawer-scrim{background:rgba(20,45,60,.28)}
    .tok-bar{background:rgba(22,60,72,.08)}
    .err-box{background:rgba(194,69,58,.05)}
    .err-box.info{background:rgba(43,111,184,.05)}
    .err-box.warn{background:rgba(168,106,0,.05)}
    .err-box.good{background:rgba(14,138,116,.05)}
    .session:hover{box-shadow:0 8px 18px rgba(20,45,60,.06)}
    .session.is-selected{background:rgba(14,138,116,.06);border-color:rgba(14,138,116,.3)}
    .bulk-bar{background:rgba(255,255,255,.97)}
    .sm-confirm{background:rgba(253,234,229,.97);border-color:#d98d7e;color:#a13c29}
    .official-box,.act-btn{background:#fff}
    .retention-confirm{background:rgba(253,234,229,.96);border-color:#d98d7e;color:#a13c29}
    .save-toast{background:#fff;box-shadow:0 10px 24px rgba(20,45,60,.16)}
    .sk{background:linear-gradient(90deg,#e7eef1 25%,#f4f8f9 37%,#e7eef1 63%);background-size:400% 100%}
    ::-webkit-scrollbar-thumb{background:rgba(22,60,72,.18)}
  }
  @media (max-width:1040px){
    .win-body{grid-template-columns:66px minmax(0,1fr)}
    .rail{padding:12px 8px 10px}
    .nav-item{padding:8px 2px 7px}
    .nav-item span{display:none}
    .page-head{padding:0 18px}
    .page-body{padding:14px 18px 18px}
    .mc-value{font-size:calc(20px * var(--ui-scale, 1))}
  }
  @media (max-width:880px){
    .win-body{grid-template-columns:60px minmax(0,1fr)}
    .metric-groups{grid-template-columns:1fr;gap:12px}
    .settings-grid{grid-template-columns:1fr}
    .wide-split{grid-template-columns:1fr;gap:12px}
    .live-task{flex-wrap:wrap;row-gap:5px}
    .live-bar{order:5;flex-basis:100%}
    .task-table{min-width:760px}
    .alert-row{grid-template-columns:64px 56px 1fr}
    .win-status .right span:nth-child(1){display:none}
  }
  @media (max-width:760px){
    .settings-nav button{height:34px;padding:0 3px;margin-right:18px}
    .balance-card{grid-template-columns:1fr;gap:14px}
    .bal-rows{padding-top:12px;border-top:1px solid var(--line)}
  }
  @media (max-width:640px){
    .page-head{gap:10px}
    .page-head h2{font-size:calc(16px * var(--ui-scale, 1))}
    .tag-demo{display:none}
    .metric-grid{grid-template-columns:1fr 1fr}
    .drawer{width:100%}
    .sessions-bar{flex-wrap:wrap}
    .sessions-bar .btn{margin-left:0}
    .rank-row{grid-template-columns:1fr auto;gap:5px 10px}
    .rank-name{grid-column:1;grid-row:1}
    .rank-val{grid-column:2;grid-row:1}
    .rank-bar{grid-column:1/-1;grid-row:2}
    .rank-meta{grid-column:1/-1;grid-row:3;text-align:left}
    .bal-rows{grid-template-columns:1fr;gap:8px}
    .bal-row{border-left:none;padding-left:0;display:flex;justify-content:space-between;align-items:baseline}
    .session{grid-template-columns:1fr auto;gap:8px}
    .session-tags{min-width:0}
  }
  @media (max-width:520px){
    .win{grid-template-rows:minmax(0,1fr) 0}
    .win-status{display:none}
    .main{grid-template-rows:auto minmax(0,1fr)}
    .page-head{padding:10px 12px;flex-wrap:wrap;row-gap:8px}
    .drawer,.drawer-scrim{bottom:0}
    .metric-grid{grid-template-columns:1fr}
    .page-head p{display:none}
    .page-body{padding:12px 12px 16px}
  }
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.001ms !important;transition-duration:.001ms !important}
  }
</style>
</head>
<body>
<div class="win">
  <div class="win-body">
    <nav class="rail" aria-label="主导航">
      <div class="nav-items">
        <button class="nav-item is-active" data-tab="tasks" aria-current="page" type="button">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span>任务</span>
        </button>
        <button class="nav-item" data-tab="stats" type="button">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 13V8M8 13V3M13 13V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span>统计</span>
        </button>
        <button class="nav-item" data-tab="sessions" type="button">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8.5c0 2.2-2.2 4-5 4-.6 0-1.2-.1-1.7-.2L3 13.2l.9-2.3A3.9 3.9 0 0 1 3 8.5c0-2.2 2.2-4 5-4s5 1.8 5 4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          <span>会话</span>
        </button>
        <button class="nav-item" data-tab="settings" type="button">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h10M3 11h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="5" r="1.6" fill="var(--bar)" stroke="currentColor" stroke-width="1.2"/><circle cx="10.5" cy="11" r="1.6" fill="var(--bar)" stroke="currentColor" stroke-width="1.2"/></svg>
          <span>设置</span>
        </button>
      </div>
    </nav>

    <div class="main">
      <header class="page-head">
        <div>
          <h2 id="head-title">历史任务</h2>
          <p id="head-sub">加载中…</p>
        </div>
        <div class="head-actions">
          <span class="tag-demo" id="demoTag" hidden>示例数据</span>
          <span class="stale" id="liveStale" hidden>离线</span>
          <button class="icon-btn" id="histExport" type="button" aria-label="导出当前筛选结果" title="导出当前筛选结果">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.8v7.4M8 10.2 5.2 7.4M8 10.2l2.8-2.8M3 12.6h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn" id="btnRefresh" type="button" aria-label="刷新数据" title="刷新数据">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </header>

      <main class="page-body">
        <!-- ============ 任务 ============ -->
        <section class="pane" id="pane-tasks" aria-label="历史任务">
          <div class="table-toolbar">
            <label class="field"><span>模型</span>
              <select id="histModel"><option value="">全部</option></select>
            </label>
            <label class="field"><span>状态</span>
              <select id="histStatus">
                <option value="">全部</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="interrupted">中断</option>
                <option value="blocked">待输入</option>
                <option value="max-tokens">触顶</option>
              </select>
            </label>
            <label class="field"><span>日期</span>
              <select id="histRange">
                <option value="today">今天</option>
                <option value="7d" selected>近 7 天</option>
                <option value="30d">近 30 天</option>
                <option value="all">全部</option>
                <option value="custom">自定义…</option>
              </select>
            </label>
            <div class="custom-range" id="customRange" hidden>
              <label class="field"><span>起始</span><input type="date" id="histFrom"></label>
              <label class="field"><span>结束</span><input type="date" id="histTo"></label>
            </div>
            <label class="field field-search"><span>关键词</span>
              <input id="histQ" type="search" placeholder="搜索任务名称 / 模型" autocomplete="off">
            </label>
            <button class="btn sm" id="histReset" type="button">重置</button>
          </div>

          <div class="card table-card">
            <div class="card-head table-head">
              <div class="ch-title"><h3>任务记录</h3><span id="taskCount">—</span></div>
              <span class="ch-hint">点击任意行查看详情</span>
            </div>

            <div class="live-task" id="liveTask" role="button" tabindex="0" aria-label="查看进行中任务详情" hidden>
              <i class="live-dot"></i>
              <span class="live-name" id="liveName">进行中任务</span>
              <span class="live-meta" id="liveMeta">—</span>
              <span class="live-bar" id="liveBudget" hidden><i id="liveBar"></i></span>
              <span class="live-pct" id="livePct" hidden>—</span>
              <span class="live-open">查看 ›</span>
            </div>

            <div class="table-scroll">
              <table class="task-table">
                <colgroup>
                  <col style="width:24%"><col style="width:17%"><col style="width:11%"><col style="width:12%">
                  <col style="width:12%"><col style="width:12%"><col style="width:12%">
                </colgroup>
                <thead>
                  <tr><th>开始时间 / 任务</th><th>模型</th><th>状态</th><th class="r">时长</th><th class="r">Token</th><th class="r">费用</th><th class="r">工具调用</th></tr>
                </thead>
                <tbody id="historyBody"></tbody>
              </table>
            </div>

            <div class="table-foot">
              <span class="info2" id="pageInfo">—</span>
              <div class="pager" id="pager" role="navigation" aria-label="分页"></div>
            </div>
          </div>
        </section>

        <!-- ============ 统计 ============ -->
        <section class="pane" id="pane-stats" aria-label="统计" hidden>
          <div class="toolbar-row">
            <div class="seg" id="periodSeg" role="tablist" aria-label="统计周期">
              <button role="tab" data-period="today" aria-selected="true" class="is-active">今日</button>
              <button role="tab" data-period="week" aria-selected="false">本周</button>
              <button role="tab" data-period="month" aria-selected="false">本月</button>
              <button role="tab" data-period="all" aria-selected="false">全部</button>
            </div>
            <span class="note" id="periodNote">对比昨日</span>
          </div>

          <div class="metric-groups">
            <div class="metric-group">
              <div class="group-cap"><span>消耗</span><em>SPEND</em></div>
              <div class="metric-grid" id="gridSpend"></div>
            </div>
            <div class="metric-group">
              <div class="group-cap"><span>产出</span><em>OUTPUT</em></div>
              <div class="metric-grid" id="gridOutput"></div>
            </div>
          </div>

          <div class="diagnosis" id="diagnosis"></div>

          <div class="stats-grid">
            <section class="card chart-card">
              <div class="chart-head">
                <h3 id="chartTitle">Token 用量</h3>
                <span class="chart-note" id="chartNote">按小时 · 今日</span>
                <span class="spacer"></span>
                <div class="seg" id="metricSeg" role="tablist" aria-label="图表指标">
                  <button role="tab" data-metric="tokens" aria-selected="true" class="is-active">Token</button>
                  <button role="tab" data-metric="cost" aria-selected="false">费用</button>
                  <button role="tab" data-metric="duration" aria-selected="false">时长</button>
                </div>
              </div>
              <div class="legend">
                <span><i style="background:var(--chart-bar)"></i><span id="chartLegend">已用</span></span>
                <span><i style="background:var(--chart-now)"></i>当前时段</span>
                <span id="chartUnit">单位 token</span>
              </div>
              <svg id="tokenChart" viewBox="0 0 880 200" role="img" aria-label="用量柱状图"></svg>
              <div id="chartEmpty" hidden></div>
              <div id="chartSkeleton" hidden><div class="sk sk-chart"></div></div>
              <div class="chart-foot"><span id="chartMax">—</span><span id="chartFootTime">—</span></div>
              <div class="chart-tip" id="chartTip"></div>
            </section>

            <section class="card balance-card" aria-label="余额">
              <div class="bal-top">
                <span class="bal-label">账户余额</span>
                <div class="bal-amount"><b id="balAmount">—</b><span id="balCur">CNY</span></div>
                <span class="bal-chip is-muted" id="balChip">未开启余额台账</span>
              </div>
              <div class="bal-rows">
                <div class="bal-row"><span>今日消耗</span><b id="balToday">—</b></div>
                <div class="bal-row"><span>本月消耗</span><b id="balMonth">—</b></div>
                <div class="bal-row"><span>预计可用</span><b id="balDays">—</b></div>
              </div>
              <div class="bal-trend">
                <svg id="spark" viewBox="0 0 260 44" preserveAspectRatio="none" role="img" aria-label="30 天余额趋势"></svg>
                <div class="spark-empty" id="sparkEmpty">暂无采样</div>
                <div class="bal-foot"><span>30 天趋势</span><span id="balUpdated">—</span></div>
              </div>
            </section>
          </div>

          <div class="rank-grid">
            <section class="card rank-card">
              <div class="rank-head"><h3>按模型</h3><span id="rankModelSub">今日</span></div>
              <div id="rankModels"></div>
            </section>
            <section class="card rank-card">
              <div class="rank-head"><h3>按项目</h3><span id="rankProjectSub">今日</span></div>
              <div id="rankProjects"></div>
            </section>
          </div>

          <section class="card alert-card">
            <div class="card-head">
              <div class="ch-title"><h3>告警记录</h3><span id="alertCount">最近 5 条</span></div>
              <span class="ch-hint">气泡消失后仍可回查</span>
            </div>
            <div class="alert-list" id="alertList"></div>
          </section>
        </section>

        <!-- ============ 会话 ============ -->
        <section class="pane" id="pane-sessions" aria-label="会话管理" hidden>
          <div class="sessions-bar">
            <label class="check-all"><input type="checkbox" id="smSelAll"> 全选</label>
            <span id="smSummary">加载中…</span>
            <span id="sel-count">已选 0 项</span>
            <button class="btn danger sm" id="smDelete" type="button" disabled>删除所选</button>
          </div>
          <div class="sm-tools">
            <input class="sm-q num-input" style="width:230px;text-align:left;height:30px" id="smQ" type="search" placeholder="搜索标题 / 工作区 / ID…" autocomplete="off">
            <select id="smSort" class="sm-sort" title="排序方式">
              <option value="time">最近活动</option>
              <option value="size">占用大小</option>
              <option value="msg">消息数</option>
            </select>
            <span class="spacer"></span>
            <details class="more">
              <summary class="btn sm">更多 ▾</summary>
              <div class="more-body">
                <button class="btn sm" id="smSelArchived" type="button">选归档</button>
                <button class="btn sm" id="smSelEmpty" type="button">选空会话</button>
                <button class="btn sm" id="smSelNone" type="button">清除选择</button>
                <button class="btn sm" id="smRefresh" type="button">刷新清单</button>
              </div>
            </details>
          </div>
          <ul class="session-list" id="smBody"></ul>
          <div class="bulk-bar" id="bulkBar" hidden>
            <span class="bulk-text">已选 <b id="bulkCount">0</b> 个 · 合计 <b id="bulkSize">0 B</b></span>
            <span class="bulk-spacer"></span>
            <button class="btn sm" id="smCancelSel" type="button">取消选择</button>
            <button class="btn sm danger" id="smDeleteBottom" type="button">删除所选</button>
          </div>
          <div class="sm-confirm" id="smConfirm" hidden>
            <span id="smConfirmText"></span>
            <span class="bulk-spacer"></span>
            <button class="btn sm" id="smConfirmNo" type="button">取消</button>
            <button class="btn sm danger" id="smConfirmYes" type="button">确认彻底删除</button>
          </div>
        </section>

        <!-- ============ 设置 ============ -->
        <section class="pane" id="pane-settings" aria-label="设置" hidden>
          <div class="settings-shell">
            <nav class="settings-nav" id="settingsIndex" aria-label="设置分类">
              <button type="button" data-group="pet" class="on" aria-current="page">伴侣</button>
              <button type="button" data-group="remind">提醒</button>
              <button type="button" data-group="bill">计费</button>
              <button type="button" data-group="data">数据</button>
            </nav>
            <div class="settings-content">
              <div class="settings-group on" data-pane="pet" id="set-pet">
                <p class="settings-desc">伴侣的外观、存在方式与随宿主启动的行为。</p>
                <div class="settings-grid">
                  <div class="setting-card" id="card-appearance">
                    <div class="sc-head"><h4>外观<button class="info" type="button" data-tip="皮肤决定形象、状态文案与台词口吻（换装即换性格）；不透明度与缩放同时作用于伴侣窗口。">i</button></h4></div>
                    <p>换装即换性格，改动即时生效。</p>
                    <div class="setting-row">
                      <span class="label">皮肤</span>
                      <span class="control skin-pick">
                        <img id="skinPreview" alt="皮肤预览">
                        <select class="skin-select" id="setSkin" aria-label="皮肤"></select>
                      </span>
                    </div>
                    <div class="setting-row">
                      <span class="label">不透明度<span class="hint">伴侣与悬浮窗整体</span></span>
                      <span class="control"><input type="range" id="setOpacity" min="20" max="100" step="1"><span class="range-val" id="setOpacityVal">100%</span></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">缩放<span class="hint">悬浮页 Ctrl + 滚轮也可调</span></span>
                      <span class="control"><input type="range" id="setScale" min="40" max="300" step="5"><span class="range-val" id="setScaleVal">100%</span></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">界面字号<span class="hint">只影响面板文字，不改变伴侣大小</span></span>
                      <span class="control"><input type="range" id="setUiScale" min="90" max="110" step="5"><span class="range-val" id="setUiScaleVal">100%</span></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">显示伴侣<span class="hint">桌面悬浮窗口（立即生效）</span></span>
                      <span class="control"><button class="switch" id="setShowPet" role="switch" aria-checked="true" aria-label="显示伴侣" type="button"></button></span>
                    </div>
                  </div>

                  <div class="setting-card" id="card-behavior">
                    <div class="sc-head"><h4>行为<button class="info" type="button" data-tip="决定伴侣在桌面上的存在方式：纯宠物模式隐藏文字；自由活动是闲着自己在屏幕上逛；点击穿透只影响 Electron 壳；隐私模式让气泡只显示状态词。">i</button></h4></div>
                    <p>决定它在桌面上的存在方式，以及与宿主窗口的关系。</p>
                    <div class="setting-row">
                      <span class="label">纯宠物模式<span class="hint">隐藏所有文字，只保留动画</span></span>
                      <span class="control"><button class="switch" id="setPurePet" role="switch" aria-checked="false" aria-label="纯宠物模式" type="button"></button></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">自由活动<span class="hint">闲着没事时自己在屏幕上逛逛</span></span>
                      <span class="control"><button class="switch" id="setRoam" role="switch" aria-checked="true" aria-label="自由活动" type="button"></button></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">点击穿透<span class="hint">鼠标穿过伴侣（Electron 壳）</span></span>
                      <span class="control"><button class="switch" id="setClickThrough" role="switch" aria-checked="false" aria-label="点击穿透" type="button"></button></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">隐私模式<span class="hint">面板与气泡隐藏任务名 / 金额 / 模型</span></span>
                      <span class="control"><button class="switch" id="setPrivacy" role="switch" aria-checked="false" aria-label="隐私模式" type="button"></button></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">随 DSH 启动伴侣<span class="hint">下次启动生效</span></span>
                      <span class="control"><button class="switch" id="setAutoStart" role="switch" aria-checked="true" aria-label="随 DSH 启动伴侣" type="button"></button></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">系统通知<span class="hint">长任务（≥60s）完成/失败、预算触顶时弹通知（Electron 壳）</span></span>
                      <span class="control"><button class="switch" id="setNotify" role="switch" aria-checked="true" aria-label="系统通知" type="button"></button></span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="settings-group" data-pane="remind" id="set-remind" hidden>
                <p class="settings-desc">久坐提醒的开关与节奏。</p>
                <div class="settings-grid">
                  <div class="setting-card wide" id="card-rest">
                    <div class="sc-head"><h4>久坐提醒<button class="info" type="button" data-tip="墙钟计时：坐够设定分钟数就提醒，不管有没有任务在跑；鼠标键盘空闲 ≥3 分钟视为离开，自动重置计时。到点气泡里有「起来走走 / 稍后 10 分钟」两个出口。">i</button></h4></div>
                    <p>坐够就提醒，不管有没有任务；起来走走或离开电脑会自动重算。</p>
                    <div class="wide-split">
                      <div>
                        <div class="setting-row">
                          <span class="label">启用提醒<span class="hint">到点伴侣气泡弹出并带两个操作按钮</span></span>
                          <span class="control"><button class="switch" id="setRestEnabled" role="switch" aria-checked="true" aria-label="启用久坐提醒" type="button"></button></span>
                        </div>
                        <div class="setting-row">
                          <span class="label">提醒间隔<span class="hint">点预设即生效，也可手填（5–480）</span></span>
                          <span class="control">
                            <div class="seg" id="restPresets">
                              <button data-min="25" type="button">25</button>
                              <button data-min="45" type="button">45</button>
                              <button data-min="60" type="button">60</button>
                              <button data-min="90" type="button">90</button>
                            </div>
                            <input class="num-input" type="number" id="setRestMinutes" min="5" max="480" step="5" placeholder="60" aria-label="提醒间隔（分钟）">
                            <span class="unit">分钟</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="settings-group" data-pane="bill" id="set-bill" hidden>
                <p class="settings-desc">预算告警、余额采样与模型计价。</p>
                <div class="settings-grid">
                  <div class="setting-card" id="card-budget">
                    <div class="sc-head"><h4>预算告警<button class="info" type="button" data-tip="单任务 / 每日 × Token / 费用共四档，填 0 = 不限制；触顶时伴侣气泡提醒一次。只统计 DeepSeek 账号或官方 API key 的任务，自定义渠道不计费。">i</button></h4></div>
                    <p>0 = 不限制，触顶气泡提醒。</p>
                    <div class="budget-row"><span>单任务 Token</span><input class="num-input" type="number" id="setTaskTokens" min="0" step="10000" placeholder="0" aria-label="单任务 Token 上限"><span class="unit">tok</span></div>
                    <div class="budget-row"><span>单任务费用</span><input class="num-input" type="number" id="setTaskCost" min="0" step="1" placeholder="0" aria-label="单任务费用上限"><span class="unit">元</span></div>
                    <div class="budget-row"><span>每日 Token</span><input class="num-input" type="number" id="setDailyTokens" min="0" step="100000" placeholder="0" aria-label="每日 Token 上限"><span class="unit">tok</span></div>
                    <div class="budget-row"><span>每日费用</span><input class="num-input" type="number" id="setDailyCost" min="0" step="1" placeholder="0" aria-label="每日费用上限"><span class="unit">元</span></div>
                    <div class="budget-usage" id="budgetUsage" hidden>
                      <div class="bar"><i id="budgetBarFill"></i></div>
                      <div class="budget-text" id="budgetText"></div>
                    </div>
                  </div>

                  <div class="setting-card" id="card-balance">
                    <div class="sc-head"><h4>余额台账<button class="info" type="button" data-tip="只记录登录的 DeepSeek 账号余额（第三方渠道一律不查）。开启后按间隔采样，消耗 = 相邻快照的下降量，充值单列；双击桌宠可随时举牌查看。设了「余额低告警」阈值后，余额（含赠金）跌破时弹系统通知与桌宠气泡，充值回升后重新武装。数据只存本地。">i</button></h4></div>
                    <p>记录余额变化，双击桌宠可查看。</p>
                    <div class="setting-row">
                      <span class="label">记录余额<span class="hint">仅登录账号；不联网上报，只存本地</span></span>
                      <span class="control"><button class="switch" id="setBalanceEnabled" role="switch" aria-checked="false" aria-label="记录余额" type="button"></button></span>
                    </div>
                    <div class="setting-row">
                      <span class="label">采样间隔<span class="hint">低频即可；查看与任务结束会额外补采</span></span>
                      <span class="control">
                        <select class="skin-select" id="setBalanceInterval" aria-label="余额采样间隔">
                          <option value="15">15</option><option value="30">30</option><option value="60">60</option><option value="120">120</option>
                        </select><span class="unit">分钟</span>
                      </span>
                    </div>
                    <div class="setting-row">
                      <span class="label">余额低告警<span class="hint">余额（含赠金）跌破阈值时通知；0 = 关闭</span></span>
                      <span class="control"><input class="num-input" type="number" id="setBalanceLow" min="0" step="1" placeholder="0" aria-label="余额低告警阈值"><span class="unit">元</span></span>
                    </div>
                  </div>

                  <div class="setting-card wide" id="card-pricing">
                    <div class="sc-head"><h4>货币与计价<button class="info" type="button" data-tip="只统计用 DeepSeek 账号（官方 API）跑的任务：模型名与最新价格从官网自动同步；自定义渠道（如阿里云百炼）与其他模型一律不计费，Token 照记。">i</button></h4><button class="btn sm" id="btnSyncPricing" type="button">同步最新价格</button></div>
                    <p>官方价自动同步；高峰 = 北京时间工作日 9:00–12:00 / 14:00–18:00，法定节假日全天闲时。</p>
                    <div class="setting-row">
                      <span class="label">显示货币</span>
                      <span class="control"><div class="seg" id="currencySeg"><button type="button" data-cur="CNY">人民币</button><button type="button" data-cur="USD">美元</button></div></span>
                    </div>
                    <div class="official-box" id="officialBox">官方价格：加载中…</div>
                    <div id="officialRows"></div>
                  </div>

                  <div class="setting-card wide" id="card-holidays">
                    <div class="sc-head"><h4>节假日日历<button class="info" type="button" data-tip="高峰时段按北京时间：周一至周五 9:00–12:00、14:00–18:00；周末和中国法定节假日全天为闲时。同步会拉取当年和次年数据；官方尚未发布的年份保留原日历，不会被清空。">i</button></h4><button class="btn sm" id="btnSyncHolidays" type="button">同步节假日</button></div>
                    <p>高峰 = 北京时间工作日 9:00–12:00 / 14:00–18:00；法定节假日全天闲时。</p>
                    <div class="official-box" id="holidayBox">已内置 2025–2026 节假日，点击同步最新年份。</div>
                  </div>
                </div>
              </div>

              <div class="settings-group" data-pane="data" id="set-data" hidden>
                <p class="settings-desc">本地统计的导出、保留与清理。</p>
                <div class="settings-grid">
                  <div class="setting-card" id="card-ops">
                    <div class="sc-head"><h4>操作<button class="info" type="button" data-tip="暂停统计只停记账，伴侣和面板照常；导出 CSV 带 BOM，Excel 直接打开。">i</button></h4></div>
                    <p>统计开关与数据导出。</p>
                    <div class="btn-grid">
                      <button class="act-btn" id="btnPauseToggle" type="button">⏸ 暂停统计</button>
                      <button class="act-btn" id="btnExportCsv" type="button">⬇ 任务 CSV</button>
                      <button class="act-btn" id="btnExportJson" type="button">⬇ 任务 JSON</button>
                    </div>
                  </div>

                  <div class="setting-card" id="card-retention">
                    <div class="sc-head"><h4>数据保留<button class="info" type="button" data-tip="设了保留期后，超过期限的任务记录每天自动清理一次（启动 30 秒后先跑一次），不再询问——这是「保留 N 个月」这条策略本身的含义。手动点「立即清理」则会先显示将删除多少条并要二次确认。删除不可恢复，想留全量历史请先导出 CSV/JSON。永久保留 = 完全不删（默认）。余额快照不受此设置影响（固定保留 90 天）。">i</button></h4></div>
                    <p>历史任务自动清理。</p>
                    <div class="setting-row">
                      <span class="label">保留时长<span class="hint">永久 = 不清理（默认）；设了期限即每天自动清理</span></span>
                      <span class="control">
                        <select class="skin-select" id="setRetentionMonths">
                          <option value="">永久</option>
                          <option value="1">1 个月</option>
                          <option value="3">3 个月</option>
                          <option value="6">6 个月</option>
                          <option value="12">12 个月</option>
                          <option value="24">24 个月</option>
                        </select>
                      </span>
                    </div>
                    <div class="setting-row">
                      <span class="label">当前库量<span class="hint" id="retentionInfo">加载中…</span></span>
                      <span class="control"><button class="act-btn" id="btnPruneNow" type="button" style="width:auto;padding:7px 12px">🧹 立即清理</button></span>
                    </div>
                    <div class="retention-confirm" id="retentionConfirm" hidden>
                      <span id="retentionConfirmText"></span>
                      <span class="rc-actions">
                        <button class="act-btn" id="retentionCancel" type="button">取消</button>
                        <button class="act-btn danger" id="retentionConfirmYes" type="button">确认删除</button>
                      </span>
                    </div>
                  </div>

                  <div class="setting-card" id="mockFieldset">
                    <div class="sc-head"><h4>事件模拟<button class="info" type="button" data-tip="适配层为 mock 时可用：注入一轮模拟事件，演示伴侣状态切换与统计落库。">i</button></h4></div>
                    <p>适配层为 mock 时可用。</p>
                    <div class="setting-row">
                      <span class="label">模拟场景</span>
                      <span class="control">
                        <select class="skin-select" id="mockScenario">
                          <option value="success">成功</option><option value="long">长任务</option><option value="error">失败</option><option value="interrupted">中断</option>
                        </select>
                      </span>
                    </div>
                    <button class="act-btn" id="mockStart" type="button" style="margin-top:10px">▶ 跑一次模拟任务</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <div class="win-status" aria-live="polite">
    <i class="st-dot" id="stDot"></i>
    <span id="stText">连接中</span>
    <span id="stAdapter">适配层 —</span>
    <span class="right">
      <span id="stServer">—</span>
      <span id="stDemo" hidden><b>示例数据</b></span>
      <span id="stTime">--:--:--</span>
    </span>
  </div>

  <div class="drawer-scrim" id="drawerScrim" hidden></div>
  <aside class="drawer" id="taskDrawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" aria-hidden="true" hidden>
    <div class="drawer-head">
      <div class="dh-text">
        <span class="dh-kicker">Task detail</span>
        <h3 id="drawerTitle">任务详情</h3>
        <div class="dh-meta" id="drawerMeta"></div>
      </div>
      <button class="drawer-close" id="drawerClose" type="button" aria-label="关闭详情">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="drawer-body" id="drawerBody"></div>
    <div class="drawer-foot">
      <button class="btn sm" id="drawerCopy" type="button">复制任务 ID</button>
      <button class="btn sm" id="drawerSession" type="button">复制会话 ID</button>
    </div>
  </aside>
</div>
<div class="save-toast" id="saveToast" role="status" aria-live="polite"></div>
<script>
'use strict'
const $ = (id) => document.getElementById(id)
const PAGE_MIN = 3
const PAGE_MAX = 12
const RESP_CACHE_MS = 30000

let snap = null
let histPage = 0
let histPageSize = 8
let histTotal = 0
let histTasks = []
let liveTask = null
let histLoaded = false
let statsLoaded = false
let smLoaded = false
let currentPeriod = 'today'
let currentMetric = 'tokens'
let lastSeries = null
let lastDoneKey = ''
let officialPricing = null
let balanceView = null
let balanceToday = null
let balanceMonth = null
let balanceSeries = null
let budgetToday = null
let smSessions = []
let smSelected = new Set()
let smVisible = []
let smLastTotal = 0
let smError = false
let smErrorText = ''
let retentionState = null
let retentionBusy = false
let toastTimer = null
let currentTab = 'tasks'
let drawerTask = null
let drawerReturn = null
let lastLivePaint = 0

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function fmtTokens(n) {
  n = Number(n) || 0
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}
function tokParts(n) {
  n = Number(n) || 0
  if (n >= 1e6) return [(n / 1e6).toFixed(2), 'M']
  if (n >= 1e3) return [(n / 1e3).toFixed(1), 'k']
  return [String(n), '']
}
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + '小时' + String(m).padStart(2, '0') + '分'
  if (m > 0) return m + '分' + String(s % 60).padStart(2, '0') + '秒'
  return s + '秒'
}
function fmtDurShort(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + 'h ' + m + 'm'
  if (m > 0) return m + ':' + String(s % 60).padStart(2, '0')
  return s + 's'
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  const p = (n) => String(n).padStart(2, '0')
  return h > 0 ? h + ':' + p(m) + ':' + p(s % 60) : p(m) + ':' + p(s % 60)
}
function fmtTime(t) {
  const d = new Date(Number(t) || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
function fmtHM(t) {
  const d = new Date(Number(t) || Date.now())
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function fmtAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - Number(ts)
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前'
  return fmtTime(ts)
}
function fmtSize(n) {
  if (n == null) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1048576).toFixed(1) + ' MB'
}
function cur() { return snap && snap.currency === 'USD' ? '$' : '¥' }
function mask(s) { return snap && snap.settings && snap.settings.privacyMode ? '***' : (s == null ? '' : String(s)) }
function fmtCost(c) {
  const n = Number(c) || 0
  if (n <= 0) return '<span style="color:var(--ink-3)">—</span>'
  return cur() + (n < 1 ? n.toFixed(4) : n.toFixed(2))
}
function fmtCostText(c) {
  const n = Number(c) || 0
  if (n <= 0) return '—'
  return cur() + (n < 1 ? n.toFixed(4) : n.toFixed(2))
}
function isOffPeakNow(at) {
  // 官方口径按北京时间：工作日 9–12 / 14–18 为高峰；周末/法定节假日全天闲时。
  const d = new Date((at || Date.now()) + 8 * 60 * 60 * 1000)
  const weekday = d.getUTCDay()
  if (weekday === 0 || weekday === 6) return true
  const p = (n) => String(n).padStart(2, '0')
  const key = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
  if (snap && Array.isArray(snap.holidays) && snap.holidays.indexOf(key) >= 0) return true
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return minutes < 9 * 60 || (minutes >= 12 * 60 && minutes < 14 * 60) || minutes >= 18 * 60
}
function privateMode() { return !!(snap && snap.settings && snap.settings.privacyMode) }

// ---- 响应缓存：页签来回点不重复打网络（30s）；任务起止/删除/保存后失效 ----
let respCache = {}
function dropCache() { respCache = {} }
async function fetchJSON(url, force) {
  const hit = respCache[url]
  if (!force && hit && Date.now() - hit.at < RESP_CACHE_MS) return hit.data
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const data = await res.json()
  respCache[url] = { at: Date.now(), data }
  return data
}
function showToast(text, ok) {
  const t = $('saveToast')
  if (!t) return
  t.textContent = text
  t.classList.toggle('err', ok === false)
  t.classList.add('is-on')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 1800)
}
function toastSaved() { showToast('✓ 已保存', true) }

// ---- 骨架屏：延迟 120ms 才画（本地请求够快就不闪灰条） ----
const skTimers = {}
function skLater(key, paint) {
  skCancel(key)
  skTimers[key] = setTimeout(() => { delete skTimers[key]; paint() }, 120)
}
function skCancel(key) {
  if (skTimers[key]) { clearTimeout(skTimers[key]); delete skTimers[key] }
}
function skRows(widths, n) {
  let html = ''
  for (let i = 0; i < n; i++) {
    html += '<tr>' + widths.map((w) => '<td><span class="sk sk-line" style="width:' + w + '%"></span></td>').join('') + '</tr>'
  }
  return html
}
function paintHistorySkeleton() { $('historyBody').innerHTML = skRows([28, 17, 11, 12, 12, 12, 12], 6) }
function paintSessionsSkeleton() {
  let html = ''
  for (let i = 0; i < 5; i++) html += '<li class="session"><span class="sk sk-line" style="width:45%"></span><span class="sk sk-line" style="width:16%"></span><span class="sk sk-line" style="width:10%"></span></li>'
  $('smBody').innerHTML = html
}
function paintStatsSkeleton() {
  const card = '<div class="metric-card"><span class="sk sk-line" style="width:44%"></span><span class="sk sk-num"></span><span class="sk sk-line" style="width:70%"></span></div>'
  $('gridSpend').innerHTML = card + card + card
  $('gridOutput').innerHTML = card + card + card
  $('tokenChart').setAttribute('hidden', '')
  $('chartEmpty').hidden = true
  $('chartSkeleton').hidden = false
}
const EMPTY_ART = '<svg class="empty-art" viewBox="0 0 96 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 40c0-10 10-17 24-17 13 0 22 6 25 14 2-2 6-3 9-1l8 5-8 5c-3 2-7 1-9-1-3 8-12 14-25 14-14 0-24-7-24-19z"/>' +
  '<circle cx="30" cy="33" r="1.9" fill="currentColor" stroke="none"/>' +
  '<path d="M33 22c1-6 5-9 10-10M26 22c-1-4-3-6-6-7"/></g></svg>'
function emptyHTML(title, hint) {
  return '<div class="empty-cell">' + EMPTY_ART + '<b>' + esc(title) + '</b>' + esc(hint || '') + '</div>'
}

// ---- 连接状态 ----
let sseConnected = false
function setConnected(on) {
  sseConnected = !!on
  $('liveStale').hidden = !!on
  $('stText').textContent = on ? '已连接' : '离线'
  $('stDot').classList.toggle('off', !on)
}
function paintStatus() {
  $('stTime').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  if (!snap) return
  $('stAdapter').textContent = '适配层 ' + (snap.adapter === 'mock' ? 'mock' : 'DSH')
  $('stServer').textContent = String(snap.serverUrl || '').replace('http://', '')
  $('demoTag').hidden = snap.adapter !== 'mock'
  $('stDemo').hidden = snap.adapter !== 'mock'
  if (sseConnected) {
    $('stText').textContent = '已连接'
    $('stDot').classList.remove('off')
    $('liveStale').hidden = true
  }
}

// ---- 页签 ----
const TABS = {
  tasks: { title: '历史任务' },
  stats: { title: '统计' },
  sessions: { title: '会话管理' },
  settings: { title: '设置' },
}
function switchTab(tab) {
  currentTab = tab
  document.querySelectorAll('.nav-item').forEach((b) => {
    const on = b.getAttribute('data-tab') === tab
    b.classList.toggle('is-active', on)
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current')
  })
  ;['tasks', 'stats', 'sessions', 'settings'].forEach((name) => { $('pane-' + name).hidden = name !== tab })
  $('head-title').textContent = TABS[tab].title
  $('histExport').hidden = tab !== 'tasks'
  document.querySelector('.page-body').scrollTop = 0
  if (tab === 'tasks') { loadHistory(); syncPageSize() }
  if (tab === 'stats') loadStats()
  if (tab === 'sessions') loadSessions()
  if (tab === 'settings') loadSettings()
  updateHead()
}
function updateHead() {
  if (currentTab === 'tasks') {
    const range = $('histRange').value
    $('head-sub').textContent = histTotal + ' 条记录 · ' + rangeLabel(range)
  } else if (currentTab === 'stats') {
    $('head-sub').textContent = PERIOD_LABEL[currentPeriod] + ' · ' + fmtHM(Date.now()) + ' 更新'
  } else if (currentTab === 'sessions') {
    $('head-sub').textContent = smSessions.length + ' 个会话 · 占用 ' + fmtSize(smLastTotal)
  } else {
    $('head-sub').textContent = '4 组 · 面板与伴侣设置'
  }
}
const PERIOD_LABEL = { today: '今日', week: '本周', month: '本月', all: '全部' }
document.querySelectorAll('.nav-item').forEach((b) => {
  b.onclick = () => switchTab(b.getAttribute('data-tab'))
})
$('btnRefresh').onclick = () => {
  dropCache()
  if (currentTab === 'tasks') loadHistory(true)
  else if (currentTab === 'stats') loadStats(true)
  else if (currentTab === 'sessions') loadSessions(true)
  else loadSettings()
  showToast('✓ 已刷新', true)
}

// 深链（/panel?tab=stats 等）必须等整段脚本跑完再点：currentPeriod / histTotal /
// smSessions 这些是后面才赋值的，同步点击会撞 TDZ（页面只剩骨架）。setTimeout(0)
// 排在脚本收尾之后，确保所有声明都已就位。
const initialTab = new URLSearchParams(location.search).get('tab')
if (initialTab) {
  setTimeout(() => {
    const b = document.querySelector('.nav-item[data-tab="' + initialTab + '"]')
    if (b) b.click()
  }, 0)
}

// ---- 任务：筛选（模型 / 状态 / 日期 / 关键词） ----
const RANGE_LABEL = { today: '今天', '7d': '近 7 天', '30d': '近 30 天', all: '全部', custom: '自定义' }
function rangeLabel(r) { return RANGE_LABEL[r] || '近 7 天' }
function rangeBounds() {
  const range = $('histRange').value
  if (range === 'all') return { from: 0, to: 0 }
  if (range === 'custom') {
    const from = $('histFrom').value
    const to = $('histTo').value
    return {
      from: from ? new Date(from + 'T00:00:00').getTime() : 0,
      to: to ? new Date(to + 'T00:00:00').getTime() + 86400000 : 0,
    }
  }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (range === 'today') return { from: start.getTime(), to: start.getTime() + 86400000 }
  const days = range === '30d' ? 30 : 7
  start.setDate(start.getDate() - (days - 1))
  return { from: start.getTime(), to: new Date().setHours(0, 0, 0, 0) + 86400000 }
}
function histParams() {
  const p = new URLSearchParams()
  p.set('limit', String(histPageSize))
  p.set('offset', String(histPage * histPageSize))
  const b = rangeBounds()
  const model = $('histModel').value
  const status = $('histStatus').value
  const q = $('histQ').value.trim()
  if (model) p.set('model', model)
  if (status) p.set('status', status)
  if (b.from) p.set('from', String(b.from))
  if (b.to) p.set('to', String(b.to))
  if (q) p.set('q', q)
  return p.toString()
}
let histModelsLoaded = false
async function loadHistModels() {
  if (histModelsLoaded) return
  histModelsLoaded = true
  try {
    const data = await (await fetch('/api/models')).json()
    const sel = $('histModel')
    for (const m of data.models || []) {
      const opt = document.createElement('option')
      opt.value = m
      opt.textContent = m
      sel.appendChild(opt)
    }
  } catch (err) { /* 模型清单拿不到不影响其他筛选维度 */ }
}
function statusText(status) {
  return status === 'success' ? '成功'
    : status === 'failed' ? '失败'
    : status === 'interrupted' ? '中断'
    : status === 'blocked' ? '待输入'
    : status === 'max-tokens' ? '触顶'
    : status === 'running' ? '进行中'
    : '失败'
}
function statusClass(status) {
  return status === 'success' ? 'ok'
    : status === 'failed' ? 'fail'
    : status === 'interrupted' ? 'interrupted'
    : (status === 'blocked' || status === 'max-tokens') ? 'interrupted'
    : 'run'
}
async function loadHistory(force) {
  if (!histLoaded) skLater('history', paintHistorySkeleton)
  try {
    await loadHistModels()
    const data = await fetchJSON('/api/history?' + histParams(), force)
    histTotal = Number(data.total) || 0
    histTasks = data.tasks || []
    const pages = Math.max(1, Math.ceil(histTotal / histPageSize))
    if (histPage > pages - 1) {
      histPage = pages - 1
      return loadHistory(force)
    }
    renderHistory()
  } catch (err) {
    $('historyBody').innerHTML = '<tr class="empty-row"><td colspan="7">' + emptyHTML('加载失败', '伴侣服务没起来？重启 DSH 再试') + '</td></tr>'
    $('taskCount').textContent = '—'
    $('pageInfo').textContent = '—'
    $('pager').innerHTML = ''
  } finally {
    skCancel('history')
    histLoaded = true
    updateHead()
    setTimeout(syncPageSize, 0)
  }
}
function renderHistory() {
  const rows = histTasks.map((t) => {
    const dur = t.endTime ? fmtDuration(t.endTime - t.startTime) : '…'
    return '<tr data-id="' + esc(t.id) + '" tabindex="0">' +
      '<td><div class="cell-stack"><time>' + fmtTime(t.startTime) + '</time><b title="' + esc(mask(t.project)) + '">' + (esc(mask(t.project)) || '（未命名任务）') + '</b></div></td>' +
      '<td><span class="model-name" title="' + esc(mask(t.model)) + '">' + (esc(mask(t.model)) || '—') + '</span></td>' +
      '<td><span class="status ' + statusClass(t.status) + '"><i></i>' + statusText(t.status) + '</span></td>' +
      '<td class="num">' + dur + '</td>' +
      '<td class="num">' + fmtTokens(t.totalTokens) + '</td>' +
      '<td class="num cost">' + fmtCost(t.cost) + '</td>' +
      '<td class="num">' + (Number(t.toolCalls) || 0) + ' 次</td></tr>'
  })
  $('historyBody').innerHTML = rows.join('') ||
    '<tr class="empty-row"><td colspan="7">' + emptyHTML('没有匹配的任务', '换个筛选条件，或先跑一个任务') + '</td></tr>'
  $('taskCount').textContent = histTotal + ' 条'
  const pages = Math.max(1, Math.ceil(histTotal / histPageSize))
  $('pageInfo').textContent = histTotal > 0 ? ('第 ' + (histPage + 1) + ' / ' + pages + ' 页 · 共 ' + histTotal + ' 条') : '0 条记录'
  renderPager(pages)
  updateHead()
}
function renderPager(pages) {
  if (pages <= 1) { $('pager').innerHTML = ''; return }
  const current = histPage + 1
  const nums = []
  for (let i = 1; i <= pages; i += 1) {
    if (i === 1 || i === pages || Math.abs(i - current) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== '…') nums.push('…')
  }
  let html = '<button type="button" data-page="prev"' + (current === 1 ? ' disabled' : '') + ' aria-label="上一页">‹</button>'
  for (const n of nums) {
    html += n === '…'
      ? '<span class="dots">…</span>'
      : '<button type="button" data-page="' + n + '"' + (n === current ? ' aria-current="true"' : '') + '>' + n + '</button>'
  }
  html += '<button type="button" data-page="next"' + (current === pages ? ' disabled' : '') + ' aria-label="下一页">›</button>'
  $('pager').innerHTML = html
}
$('pager').onclick = (e) => {
  const b = e.target.closest('button[data-page]')
  if (!b) return
  const v = b.getAttribute('data-page')
  const pages = Math.max(1, Math.ceil(histTotal / histPageSize))
  if (v === 'prev') histPage = Math.max(0, histPage - 1)
  else if (v === 'next') histPage = Math.min(pages - 1, histPage + 1)
  else histPage = Math.max(0, parseInt(v, 10) - 1)
  loadHistory()
}
for (const id of ['histModel', 'histStatus', 'histFrom', 'histTo']) {
  $(id).onchange = () => { histPage = 0; loadHistory() }
}
$('histRange').onchange = () => {
  const custom = $('histRange').value === 'custom'
  $('customRange').hidden = !custom
  if (custom && !$('histFrom').value && !$('histTo').value) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - 6)
    const p = (n) => String(n).padStart(2, '0')
    const fmtDate = (d) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    $('histFrom').value = fmtDate(start)
    $('histTo').value = fmtDate(new Date())
  }
  histPage = 0
  loadHistory()
}
let histQTimer = null
$('histQ').oninput = () => {
  if (histQTimer) clearTimeout(histQTimer)
  histQTimer = setTimeout(() => { histPage = 0; loadHistory() }, 300)
}
$('histReset').onclick = () => {
  $('histModel').value = ''
  $('histStatus').value = ''
  $('histRange').value = '7d'
  $('histFrom').value = ''
  $('histTo').value = ''
  $('histQ').value = ''
  $('customRange').hidden = true
  histPage = 0
  loadHistory()
}
$('histExport').onclick = () => {
  const p = new URLSearchParams()
  p.set('format', 'csv')
  const b = rangeBounds()
  const model = $('histModel').value
  const status = $('histStatus').value
  const q = $('histQ').value.trim()
  if (model) p.set('model', model)
  if (status) p.set('status', status)
  if (b.from) p.set('from', String(b.from))
  if (b.to) p.set('to', String(b.to))
  if (q) p.set('q', q)
  window.location = '/api/export/sessions?' + p.toString()
}
function syncPageSize() {
  if (currentTab !== 'tasks' || $('pane-tasks').hidden) return
  const body = document.querySelector('.page-body')
  const head = document.querySelector('#pane-tasks .card-head')
  const live = $('liveTask')
  const thead = document.querySelector('#pane-tasks thead')
  const foot = document.querySelector('#pane-tasks .table-foot')
  const row = document.querySelector('#historyBody tr')
  if (!body || !head || !live || !thead || !foot) return
  const avail = body.clientHeight - 24
  const fixed = head.offsetHeight + (live.hidden ? 0 : live.offsetHeight) + thead.offsetHeight + foot.offsetHeight + 50
  const rowH = row ? row.offsetHeight : 42
  const n = Math.max(PAGE_MIN, Math.min(PAGE_MAX, Math.floor((avail - fixed) / Math.max(36, rowH))))
  if (n !== histPageSize && histLoaded) {
    histPageSize = n
    loadHistory()
  }
}
// ---- 实时任务行 ----
function currentLiveTask() {
  if (!snap || !snap.task) return null
  const t = snap.task
  return {
    id: t.id,
    sessionId: t.sessionId,
    turn: t.turn,
    project: t.project,
    workspace: t.workspace,
    provider: t.provider,
    model: t.model,
    status: 'running',
    startTime: t.startTime,
    endTime: null,
    promptTokens: t.tokens.inputTokens || 0,
    completionTokens: t.tokens.outputTokens || 0,
    totalTokens: t.tokens.totalTokens || ((t.tokens.inputTokens || 0) + (t.tokens.outputTokens || 0)),
    cachedTokens: t.tokens.cachedTokens || 0,
    reasoningTokens: t.tokens.reasoningTokens || 0,
    cost: t.cost || 0,
    toolCalls: t.toolCalls || 0,
    toolSuccess: t.toolSuccess || 0,
    toolFail: t.toolFail || 0,
    steps: t.steps || 0,
    tags: [],
    note: '',
    subagent: !!t.subagent,
  }
}
function renderLive() {
  const t = snap && snap.task
  $('liveTask').hidden = !t
  if (!t) { liveTask = null; return }
  liveTask = currentLiveTask()
  $('liveName').textContent = privateMode() ? '任务进行中' : (t.project || '未命名任务')
  const tot = t.tokens.totalTokens || ((t.tokens.inputTokens || 0) + (t.tokens.outputTokens || 0))
  const bits = ['已用 ' + fmtClock(Date.now() - t.startTime), fmtTokens(tot) + ' token']
  if (t.cost > 0) bits.push(fmtCostText(t.cost))
  $('liveMeta').textContent = bits.join(' · ')
  const budget = (snap.settings && snap.settings.budget) || {}
  const tokenCap = Number(budget.taskMaxTokens) || 0
  const costCap = Number(budget.taskMaxCost) || 0
  let cap = 0
  let used = 0
  if (tokenCap > 0 && (costCap <= 0 || tot / tokenCap >= t.cost / costCap)) { cap = tokenCap; used = tot }
  else if (costCap > 0) { cap = costCap; used = t.cost || 0 }
  const show = cap > 0
  $('liveBudget').hidden = !show
  $('livePct').hidden = !show
  if (show) {
    const pct = Math.round((used / cap) * 100)
    const bar = $('liveBar')
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%'
    bar.classList.toggle('warn', pct >= 80 && pct < 100)
    bar.classList.toggle('over', pct >= 100)
    $('livePct').textContent = '预算 ' + pct + '%'
    $('livePct').style.color = pct >= 100 ? 'var(--red)' : (pct >= 80 ? 'var(--amber)' : 'var(--cyan)')
  }
  if (currentTab === 'tasks') updateHead()
}
$('liveTask').onclick = () => { if (liveTask) openDrawer(liveTask, $('liveTask')) }
$('liveTask').onkeydown = (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && liveTask) { e.preventDefault(); openDrawer(liveTask, $('liveTask')) }
}
$('historyBody').onclick = (e) => {
  const tr = e.target.closest('tr[data-id]')
  if (!tr) return
  const task = histTasks.find((t) => t.id === tr.getAttribute('data-id'))
  if (task) openDrawer(task, tr)
}
$('historyBody').onkeydown = (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const tr = e.target.closest('tr[data-id]')
  if (!tr) return
  e.preventDefault()
  const task = histTasks.find((t) => t.id === tr.getAttribute('data-id'))
  if (task) openDrawer(task, tr)
}

// ---- 统计 ----
function deltaHTML(now, before, upGood, mode) {
  if (before === null || before === undefined || now === null || now === undefined) return ''
  const up = Number(now), old = Number(before)
  if (!isFinite(up) || !isFinite(old)) return ''
  const arrow = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 10V2M6 2 2.6 5.4M6 2l3.4 3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const downArrow = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 2v8M6 10 2.6 6.6M6 10l3.4-3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  if (old === 0) return up > 0 ? '<span class="mc-delta ' + (upGood ? 'good' : 'bad') + '">新增</span>' : ''
  if (mode === 'pt') {
    const diff = Math.round((up - old) * 10) / 10
    if (Math.abs(diff) < 0.1) return '<span class="mc-delta flat">持平</span>'
    const grew = diff > 0
    const good = upGood === undefined ? !grew : upGood ? grew : !grew
    return '<span class="mc-delta ' + (good ? 'good' : 'bad') + '">' + (grew ? arrow : downArrow) + Math.abs(diff) + 'pt</span>'
  }
  const pct = Math.round(((up - old) / old) * 1000) / 10
  if (Math.abs(pct) < 0.1) return '<span class="mc-delta flat">持平</span>'
  const grew = pct > 0
  const good = upGood === undefined ? !grew : upGood ? grew : !grew
  const text = Math.abs(pct) >= 999 ? (grew ? '10 倍+' : '10 倍-') : Math.abs(pct) + '%'
  return '<span class="mc-delta ' + (good ? 'good' : 'bad') + '">' + (grew ? arrow : downArrow) + text + '</span>'
}
function metricCard(label, value, unit, delta, sub) {
  return '<div class="metric-card"><div class="mc-top"><span class="mc-label">' + esc(label) + '</span>' + (delta || '') + '</div>' +
    '<div class="mc-value">' + value + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' +
    '<div class="mc-sub">' + (sub || '&nbsp;') + '</div></div>'
}
function renderMetricGroups(s) {
  if (!s) return
  const prev = s.previous || null
  const tok = tokParts(s.totalTokens)
  const cacheRate = s.totalTokens > 0 ? Math.round((s.cachedTokens / s.totalTokens) * 100) : 0
  const pCache = prev && prev.totalTokens > 0 ? Math.round((prev.cachedTokens / prev.totalTokens) * 100) : null
  const avgMs = s.tasks > 0 ? s.totalDurationMs / s.tasks : 0
  const pAvgMs = prev && prev.tasks > 0 ? prev.totalDurationMs / prev.tasks : null
  $('gridSpend').innerHTML = [
    metricCard('总 Token', tok[0], tok[1], deltaHTML(s.totalTokens, prev && prev.totalTokens, true), '输入 ' + fmtTokens(s.promptTokens) + ' · 输出 ' + fmtTokens(s.completionTokens) + ' · 缓存 ' + fmtTokens(s.cachedTokens)),
    metricCard('总费用', (Number(s.cost) || 0).toFixed(2), cur(), deltaHTML(s.cost, prev && prev.cost, false), '单任务 ' + (s.tasks > 0 ? fmtCostText(s.cost / s.tasks) : '—')),
    metricCard('缓存命中率', String(cacheRate), '%', deltaHTML(s.tasks > 0 ? cacheRate : null, pCache, true, 'pt'), '缓存 ' + fmtTokens(s.cachedTokens) + ' / 总量 ' + fmtTokens(s.totalTokens)),
  ].join('')
  $('gridOutput').innerHTML = [
    metricCard('任务数', String(s.tasks), '', deltaHTML(s.tasks, prev && prev.tasks, true), '成功 ' + s.success + ' · 失败 ' + s.failed + ' · 中断 ' + s.interrupted),
    metricCard('成功率', s.tasks > 0 ? String(s.successRate) : '—', s.tasks > 0 ? '%' : '', deltaHTML(s.tasks > 0 ? s.successRate : null, prev && prev.tasks > 0 ? prev.successRate : null, true, 'pt'), '失败 ' + s.failed + ' · 中断 ' + s.interrupted),
    metricCard('平均时长', s.tasks > 0 ? fmtDurShort(avgMs) : '—', '', deltaHTML(avgMs, pAvgMs, false), '总时长 ' + (s.tasks > 0 ? fmtDuration(s.totalDurationMs) : '—')),
  ].join('')
}
const DIAG_ICON = {
  warn: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.6 14 13H2L8 2.6Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.4v3.1M8 11.4v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  bad: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  good: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="m5.2 8.2 2 2 3.6-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2v3.6M8 5.1v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
}
function diagRow(tone, html) {
  return '<p class="diag-row tone-' + tone + '">' + DIAG_ICON[tone] + '<span>' + html + '</span></p>'
}
function renderDiagnosis(s, ranking) {
  if (!s) { $('diagnosis').innerHTML = ''; return }
  const rows = []
  if (s.tasks > 0) {
    const per = s.cost / s.tasks
    const prev = s.previous
    const costDelta = prev && prev.tasks > 0 && prev.cost > 0 ? ((s.cost / s.tasks) / (prev.cost / prev.tasks) - 1) * 100 : null
    rows.push(diagRow(
      costDelta !== null && costDelta > 5 ? 'warn' : 'info',
      '单任务成本 <b>' + fmtCostText(per) + '</b>' + (costDelta !== null
        ? '，较上一周期' + (costDelta >= 0 ? '上升' : '下降') + ' <em>' + Math.abs(costDelta).toFixed(1) + '%</em>'
        : '') + '；缓存命中 <em>' + (s.totalTokens > 0 ? Math.round((s.cachedTokens / s.totalTokens) * 100) : 0) + '%</em>。'
    ))
  }
  if (s.failed + s.interrupted > 0) {
    rows.push(diagRow('bad', '失败 <b>' + s.failed + '</b> 次、中断 <b>' + s.interrupted + '</b> 次；最近记录见下方「告警记录」。'))
  } else if (s.tasks > 0) {
    rows.push(diagRow('good', '本周期没有失败或中断任务，成功率 <em>' + s.successRate + '%</em>。'))
  }
  if (ranking && ranking.models && ranking.models.length > 1 && s.cost > 0) {
    const top = ranking.models[0]
    const share = Math.round((top.share || 0) * 100)
    if (share >= 60) {
      rows.push(diagRow('warn', '<b>' + esc(mask(top.key)) + '</b> 占本周期费用的 <em>' + share + '%</em>，高度集中。'))
    } else {
      rows.push(diagRow('info', '费用最高的模型是 <b>' + esc(mask(top.key)) + '</b>（<em>' + share + '%</em>），共 ' + top.tasks + ' 个任务。'))
    }
  }
  if (!rows.length) rows.push(diagRow('info', '该周期还没有任务数据。'))
  $('diagnosis').innerHTML = rows.join('')
}
const METRICS = {
  tokens: {
    title: 'Token 用量',
    value: (b) => b.tokens,
    axis: (v) => fmtAxis(v),
    peak: (v) => fmtTokens(v) + ' token',
    tip: (b) => b.label + ' · ' + fmtTokens(b.tokens) + ' token · ' + b.tasks + ' 个任务',
    unit: '单位 token',
  },
  cost: {
    title: '费用分布',
    value: (b) => b.cost,
    axis: (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(3)),
    peak: (v) => fmtCostText(v),
    tip: (b) => b.label + ' · ' + fmtCostText(b.cost) + ' · ' + b.tasks + ' 个任务',
    unit: '单位 ' + cur(),
  },
  duration: {
    title: '任务时长分布',
    value: (b) => b.durationMs,
    axis: (v) => fmtDurShort(v),
    peak: (v) => fmtDuration(v),
    tip: (b) => b.label + ' · ' + fmtDuration(b.durationMs) + ' · ' + b.tasks + ' 个任务',
    unit: '单位 时长',
  },
}
function fmtAxis(n) {
  n = Number(n) || 0
  if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return +(n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
const PERIOD_NOTE = { today: '按小时', week: '按天 · 本周', month: '按天 · 本月', all: '按月 · 最近 24 个月' }
function activeBucketIndex(buckets) {
  if (!buckets.length) return -1
  const now = new Date()
  if (currentPeriod === 'today') {
    const h = String(now.getHours())
    const i = buckets.findIndex((b) => b.key === 'h' + h)
    return i >= 0 ? i : buckets.length - 1
  }
  if (currentPeriod === 'week' || currentPeriod === 'month') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    const key = 'd' + d.getTime()
    const i = buckets.findIndex((b) => b.key === key)
    return i >= 0 ? i : buckets.length - 1
  }
  return buckets.length - 1
}
function renderChart(series) {
  lastSeries = series
  const metric = METRICS[currentMetric] || METRICS.tokens
  const buckets = (series && series.buckets) || []
  const svg = $('tokenChart')
  const empty = $('chartEmpty')
  const tip = $('chartTip')
  $('chartSkeleton').hidden = true
  tip.classList.remove('show')
  $('chartTitle').textContent = metric.title
  $('chartNote').textContent = PERIOD_NOTE[currentPeriod] + ' · ' + PERIOD_LABEL[currentPeriod]
  $('chartUnit').textContent = metric.unit
  $('chartLegend').textContent = currentMetric === 'duration' ? '时长' : (currentMetric === 'cost' ? '费用' : '已用')
  const values = buckets.map((b) => metric.value(b) || 0)
  const hasData = values.some((v) => v > 0)
  // SVGElement 没有 HTMLElement 的 hidden IDL 属性：写 svg.hidden 只是挂个 expando，
  // 属性/CSS 都不会变（无数据时留下一条 880:200 的大空白，骨架屏之后图表也出不来）。
  // 必须走 toggleAttribute，让全局 [hidden]{display:none!important} 生效。
  svg.toggleAttribute('hidden', !hasData)
  empty.hidden = hasData
  if (!hasData) {
    empty.innerHTML = emptyHTML(
      currentMetric === 'cost' ? '没有可计费任务' : currentMetric === 'duration' ? '暂无任务时长' : '暂无任务数据',
      currentMetric === 'cost' ? '自定义渠道任务不计费，Token 照记' : '换个周期，或先跑一个任务'
    )
    $('chartMax').textContent = '—'
    $('chartFootTime').textContent = '截至 ' + fmtHM(Date.now())
    return
  }
  const W = 880, H = 200, PL = 48, PR = 8, PT = 22, PB = 24
  const iw = W - PL - PR, ih = H - PT - PB
  const max = Math.max.apply(null, values) || 1
  const n = values.length
  const step = iw / n
  const bw = Math.max(3, Math.min(30, step - 4))
  const active = activeBucketIndex(buckets)
  const parts = []
  for (let g = 0; g <= 3; g += 1) {
    const y = PT + ih * g / 3
    parts.push('<line class="grid" x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '"/>')
    parts.push('<text class="ax" x="' + (PL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + metric.axis(max * (3 - g) / 3) + '</text>')
  }
  // 设计稿的刻度密度：今天每 3 小时、本月每 5 天；其余按 12 个标签上限自动取步长。
  const labelStep = currentPeriod === 'today' ? 3 : (currentPeriod === 'month' ? 5 : Math.max(1, Math.ceil(n / 12)))
  for (let i = 0; i < n; i += 1) {
    const v = values[i]
    const h = Math.max(1, ih * (v / max))
    const x = PL + i * step + (step - bw) / 2
    const y = H - PB - h
    const on = i === active
    parts.push('<rect class="bar' + (on ? ' is-active' : '') + '" data-i="' + i + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>')
    if (on) {
      const labelY = Math.max(12, y - 9)
      parts.push('<text class="ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + labelY.toFixed(1) + '" text-anchor="middle" fill="var(--cyan)">' + metric.axis(v) + '</text>')
    }
    if (i % labelStep === 0 && buckets[i].label) {
      parts.push('<text class="ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - PB + 14) + '" text-anchor="middle">' + esc(buckets[i].label) + '</text>')
    }
  }
  svg.innerHTML = parts.join('')
  const peak = values.reduce((acc, v, i) => (v > values[acc] ? i : acc), 0)
  $('chartMax').textContent = '峰值 ' + (buckets[peak] ? buckets[peak].label : '—') + ' · ' + metric.peak(values[peak])
  $('chartFootTime').textContent = '截至 ' + fmtHM(Date.now())
  svg.onmousemove = (ev) => {
    const rect = svg.getBoundingClientRect()
    if (!rect.width) return
    const x = (ev.clientX - rect.left) * (W / rect.width)
    const idx = Math.max(0, Math.min(n - 1, Math.floor((x - PL) / step)))
    for (const r of svg.querySelectorAll('rect.bar')) r.classList.toggle('hot', Number(r.getAttribute('data-i')) === idx)
    if (!(values[idx] > 0)) {
      svg.classList.remove('has-hot')
      tip.classList.remove('show')
      return
    }
    svg.classList.add('has-hot')
    tip.textContent = metric.tip(buckets[idx])
    const crect = svg.parentElement.getBoundingClientRect()
    tip.style.left = Math.max(84, Math.min(crect.width - 84, ev.clientX - crect.left)) + 'px'
    tip.style.top = (ev.clientY - crect.top - 10) + 'px'
    tip.classList.add('show')
  }
  svg.onmouseleave = () => {
    svg.classList.remove('has-hot')
    for (const r of svg.querySelectorAll('rect.bar.hot')) r.classList.remove('hot')
    tip.classList.remove('show')
  }
}
function renderRanking(ranking) {
  const paint = (el, sub, rows) => {
    if (!rows || rows.length === 0) {
      el.innerHTML = '<div class="rank-empty">暂无数据</div>'
      sub.textContent = ''
      return
    }
    const useCost = rows.some((r) => r.cost > 0)
    sub.textContent = useCost ? '按费用 · ' + PERIOD_LABEL[currentPeriod] : '按 Token（无计费任务）'
    const colors = ['var(--cyan)', 'var(--blue)', 'var(--amber)', 'var(--ink-3)', '#8f9fb4']
    el.innerHTML = rows.map((r, i) => {
      const pct = Math.max(0, Math.min(100, Math.round((r.share || 0) * 100)))
      const val = useCost ? fmtCostText(r.cost) : fmtTokens(r.tokens)
      const color = colors[i % colors.length]
      return '<div class="rank-row" title="' + esc(mask(r.key)) + ' · ' + r.tasks + ' 个任务">' +
        '<div class="rank-name"><i class="dot" style="background:' + color + '"></i><b>' + esc(mask(r.key)) + '</b></div>' +
        '<div class="rank-bar"><i style="width:' + pct + '%;background:' + color + '"></i></div>' +
        '<div class="rank-meta">' + fmtTokens(r.tokens) + ' · ' + r.tasks + ' 任务 · ' + pct + '%</div>' +
        '<div class="rank-val">' + val + '</div></div>'
    }).join('')
  }
  paint($('rankModels'), $('rankModelSub'), ranking && ranking.models)
  paint($('rankProjects'), $('rankProjectSub'), ranking && ranking.projects)
}
function renderSpark(points) {  const svg = $('spark')
  const empty = $('sparkEmpty')
  const list = (points || []).filter((p) => Number.isFinite(p.total))
  if (list.length < 2) {
    svg.innerHTML = ''
    empty.hidden = false
    empty.textContent = list.length === 1 ? '仅 1 个采样点' : '暂无采样'
    return
  }
  empty.hidden = true
  const W = 260, H = 44, pad = 3
  const min = Math.min.apply(null, list.map((p) => p.total))
  const max = Math.max.apply(null, list.map((p) => p.total))
  const span = max - min || 1
  const pts = list.map((p, i) => {
    const x = pad + (W - pad * 2) * i / (list.length - 1)
    const y = pad + (H - pad * 2) * (1 - (p.total - min) / span)
    return x.toFixed(1) + ',' + y.toFixed(1)
  })
  const line = pts.join(' ')
  const area = '0,' + (H - pad) + ' ' + line + ' ' + W + ',' + (H - pad)
  svg.innerHTML = '<polygon class="area" points="' + area + '"/><polyline points="' + line + '"/>'
}
async function loadBalanceView(force) {
  try {
    balanceView = await fetchJSON('/api/balance' + (force ? '?refresh=1' : ''), force).catch(() => null)
  } catch (err) {
    balanceView = null
  }
  renderBalance()
}
function renderBalance() {
  const v = balanceView
  const enabled = !!(v && v.enabled !== false)
  const ok = !!(v && v.ok && enabled)
  const sym = v && v.currency === 'USD' ? '$' : cur()
  const normal = ok ? Number(v.normal) || 0 : 0
  $('balAmount').textContent = ok ? normal.toFixed(2) : '—'
  $('balCur').textContent = v && v.currency ? v.currency : (snap ? snap.currency : 'CNY')
  const chip = $('balChip')
  if (!enabled) {
    chip.textContent = '未开启 · 设置 → 计费 → 余额台账'
    chip.classList.add('is-muted')
  } else if (!ok) {
    chip.textContent = v && v.signedIn ? '暂时查不到余额' : '未登录 DeepSeek 账号'
    chip.classList.add('is-muted')
  } else {
    const bonus = Number(v.bonus) || 0
    chip.textContent = bonus > 0 ? '含赠金 ' + sym + bonus.toFixed(2) : 'DeepSeek 账号余额'
    chip.classList.remove('is-muted')
  }
  const t = balanceToday && balanceToday.samples > 0 ? balanceToday : null
  const m = balanceMonth && balanceMonth.samples > 0 ? balanceMonth : null
  $('balToday').textContent = t ? sym + Number(t.spent || 0).toFixed(2) : '—'
  $('balMonth').textContent = m ? sym + Number(m.spent || 0).toFixed(2) : '—'
  const dayOfMonth = new Date().getDate()
  const daily = t && Number(t.spent) > 0 ? Number(t.spent) : (m ? Number(m.spent) / dayOfMonth : 0)
  if (ok && daily > 0) {
    const days = Math.floor(normal / daily)
    $('balDays').textContent = days > 365 ? '> 365 天' : '约 ' + days + ' 天'
  } else {
    $('balDays').textContent = '—'
  }
  $('balUpdated').textContent = v && v.at ? fmtHM(v.at) + ' 更新' : '—'
  renderSpark(balanceSeries ? balanceSeries.points : [])
}
function periodPrevLabel(period) {
  const d = new Date()
  if (period === 'today') { d.setDate(d.getDate() - 1); return '对比昨日 · ' + fmtTime(d.getTime()).slice(0, 5) }
  if (period === 'week') { d.setDate(d.getDate() - 7); return '对比上周 · ' + fmtTime(d.getTime()).slice(0, 5) }
  if (period === 'month') { d.setMonth(d.getMonth() - 1); return '对比上月 · ' + fmtTime(d.getTime()).slice(0, 5) }
  return '累计口径 · 全部历史'
}
function renderPeriodNote() {
  $('periodNote').textContent = periodPrevLabel(currentPeriod)
}
async function loadStats(force) {
  if (!statsLoaded) skLater('stats', paintStatsSkeleton)
  try {
    const period = currentPeriod
    const reqs = [
      fetchJSON('/api/stats?period=' + period, force),
      fetchJSON('/api/stats/series?period=' + period, force),
      fetchJSON('/api/ranking?period=' + period, force).catch(() => null),
      fetchJSON('/api/alerts?limit=5', force).catch(() => null),
      fetchJSON('/api/balance/summary?period=today', force).catch(() => null),
      fetchJSON('/api/balance/summary?period=month', force).catch(() => null),
      fetchJSON('/api/balance/series?days=30', force).catch(() => null),
    ]
    const [s, series, ranking, alerts, balT, balM, balSeries] = await Promise.all(reqs)
    lastSeries = series
    balanceToday = balT
    balanceMonth = balM
    balanceSeries = balSeries
    $('chartSkeleton').hidden = true
    renderMetricGroups(s)
    renderDiagnosis(s, ranking)
    renderChart(series)
    renderRanking(ranking)
    renderBalance()
    renderAlerts(alerts && alerts.alerts)
    renderPeriodNote()
    updateHead()
    // 余额查询可能走网络（仅登录账号），不阻塞统计首屏：先出图，回来再补余额区。
    void loadBalanceView(force)
  } catch (err) {
    console.error('[panel] 统计加载失败', currentPeriod, err && (err.stack || err.message || err))
    $('chartSkeleton').hidden = true
    $('chartEmpty').hidden = false
    $('chartEmpty').innerHTML = emptyHTML('统计加载失败', '伴侣服务可能没起来')
    $('gridSpend').innerHTML = emptyHTML('加载失败', '刷新试试')
    $('gridOutput').innerHTML = ''
    $('diagnosis').innerHTML = ''
  } finally {
    skCancel('stats')
    statsLoaded = true
  }
}
const ALERT_TYPE = { budget: '预算', balance: '余额', failed: '失败', interrupted: '中断' }
function renderAlerts(alerts) {
  const list = alerts || []
  $('alertCount').textContent = list.length ? '最近 ' + list.length + ' 条' : '暂无'
  if (!list.length) {
    $('alertList').innerHTML = '<div class="alert-empty">还没有告警。预算触顶与失败/中断任务会记录在这里。</div>'
    return
  }
  $('alertList').innerHTML = list.map((a) => {
    const type = ALERT_TYPE[a.type] || '告警'
    return '<div class="alert-row">' +
      '<span class="alert-time">' + fmtTime(a.time) + '</span>' +
      '<span class="alert-type ' + (a.level || 'info') + '">' + type + '</span>' +
      '<span class="alert-text" title="' + esc(mask(a.text)) + '">' + esc(mask(a.text)) + '</span></div>'
  }).join('')
}
for (const btn of document.querySelectorAll('#periodSeg button')) {
  btn.onclick = () => {
    currentPeriod = btn.getAttribute('data-period')
    document.querySelectorAll('#periodSeg button').forEach((b) => {
      const on = b === btn
      b.classList.toggle('is-active', on)
      b.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    renderPeriodNote()
    loadStats()
  }
}
for (const btn of document.querySelectorAll('#metricSeg button')) {
  btn.onclick = () => {
    currentMetric = btn.getAttribute('data-metric')
    document.querySelectorAll('#metricSeg button').forEach((b) => {
      const on = b === btn
      b.classList.toggle('is-active', on)
      b.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    if (lastSeries) renderChart(lastSeries)
  }
}

// ---- 会话管理 ----
function smIsEmpty(s) { return !s.messageCount }
async function loadSessions(force) {
  $('smSummary').textContent = '加载中…'
  if (!smLoaded) skLater('sessions', paintSessionsSkeleton)
  try {
    let data = null
    try { data = await fetchJSON('/api/dsh-sessions', force) } catch (err) { data = null }
    if (!data || data.ok !== true) {
      smSessions = []
      smLastTotal = 0
      smError = true
      smErrorText = (data && data.message) || '连不上伴侣服务，无法读取会话清单'
      renderSessions()
      return
    }
    smError = false
    smErrorText = ''
    smSessions = data.sessions || []
    smLastTotal = data.totalSizeBytes || 0
    const alive = new Set(smSessions.map((s) => s.sessionId))
    for (const id of [...smSelected]) { if (!alive.has(id)) smSelected.delete(id) }
    renderSessions()
  } finally {
    skCancel('sessions')
    smLoaded = true
    updateHead()
  }
}
function renderSessions() {
  const q = ($('smQ') && $('smQ').value || '').trim().toLowerCase()
  const sortBy = ($('smSort') && $('smSort').value) || 'time'
  let list = smSessions.slice()
  if (q) {
    list = list.filter((s) =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.workspaceTitle || '').toLowerCase().includes(q) ||
      (s.sessionId || '').toLowerCase().includes(q))
  }
  if (sortBy === 'size') list.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
  else if (sortBy === 'msg') list.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0))
  else list.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
  const rows = list.map((s) => {
    const title = s.title ? esc(mask(s.title)) : '（无标题）'
    const wsName = s.workspaceTitle ? esc(mask(s.workspaceTitle)) : ''
    const tags = (s.archived ? '<span class="tag arch">归档</span>' : '') + (s.pinned ? '<span class="tag pin">置顶</span>' : '')
    const msg = s.messageCount == null ? '—' : String(s.messageCount)
    return '<li class="session' + (smSelected.has(s.sessionId) ? ' is-selected' : '') + '" data-sid="' + esc(s.sessionId) + '">' +
      '<label class="session-check"><input type="checkbox"' + (smSelected.has(s.sessionId) ? ' checked' : '') + ' aria-label="选择会话">' +
      '<span class="session-title">' + title + '<small>' + (wsName ? wsName + ' · ' : '') + esc(s.sessionId) + '</small></span></label>' +
      '<div class="session-meta"><span>最后活跃 ' + fmtAgo(s.lastActivityAt) + '</span><span>' + msg + ' 条消息</span><span>' + fmtSize(s.sizeBytes) + '</span></div>' +
      '<div class="session-tags">' + (tags || '<span style="color:var(--ink-3)">—</span>') + '</div></li>'
  })
  $('smBody').innerHTML = rows.join('') ||
    '<li class="empty-sessions">' + (smError
      ? emptyHTML('读不到会话清单', '宿主工作区注册表未就绪；演示模式没有 DSH 会话')
      : emptyHTML(q ? '没有匹配的会话' : '没有会话', q ? '换个关键词，或清空搜索框' : '宿主注册表为空——先在 DSH 里开一个对话吧')) + '</li>'
  smVisible = list
  let selSize = 0
  for (const s of smSessions) { if (smSelected.has(s.sessionId) && s.sizeBytes) selSize += s.sizeBytes }
  const n = smSelected.size
  $('smSummary').textContent = smError
    ? smErrorText
    : ((q ? '匹配 ' + list.length + ' / ' : '共 ') + smSessions.length + ' 个会话 · 磁盘占用 ' + fmtSize(smLastTotal))
  $('sel-count').textContent = '已选 ' + n + ' 项'
  $('bulkCount').textContent = String(n)
  $('bulkSize').textContent = fmtSize(selSize)
  $('bulkBar').hidden = n === 0 || !$('smConfirm').hidden
  const del = $('smDelete')
  del.disabled = n === 0
  del.textContent = n > 0 ? '删除所选（' + n + '）' : '删除所选'
  const bottom = $('smDeleteBottom')
  bottom.disabled = n === 0
  bottom.textContent = n > 0 ? '删除所选（' + n + '）' : '删除所选'
  $('smSelAll').checked = list.length > 0 && list.every((s) => smSelected.has(s.sessionId))
  $('smSelAll').indeterminate = n > 0 && !$('smSelAll').checked
  updateHead()
}
$('smQ').oninput = () => {
  if (smQTimer) clearTimeout(smQTimer)
  smQTimer = setTimeout(renderSessions, 120)
}
let smQTimer = null
$('smSort').onchange = () => renderSessions()
$('smBody').onchange = (e) => {
  const cb = e.target.closest('input[type=checkbox]')
  if (!cb) return
  const li = cb.closest('li[data-sid]')
  if (!li) return
  const sid = li.getAttribute('data-sid')
  if (cb.checked) smSelected.add(sid); else smSelected.delete(sid)
  li.classList.toggle('is-selected', cb.checked)
  renderSessions()
}
$('smBody').onclick = (e) => {
  // 点勾选框/标题 label 交给原生 change，行内其它区域点一下也能选中。
  if (e.target.closest('input,label')) return
  const li = e.target.closest('li[data-sid]')
  if (!li) return
  const sid = li.getAttribute('data-sid')
  if (smSelected.has(sid)) smSelected.delete(sid); else smSelected.add(sid)
  renderSessions()
}
$('smSelAll').onchange = (e) => {
  const scope = smVisible.length ? smVisible : smSessions
  if (e.target.checked) { for (const s of scope) smSelected.add(s.sessionId) }
  else smSelected.clear()
  renderSessions()
}
function smSelectWhere(pred) {
  for (const s of smSessions) { if (pred(s)) smSelected.add(s.sessionId) }
  renderSessions()
}
for (const id of ['smSelArchived', 'smSelEmpty', 'smSelNone', 'smRefresh']) {
  const el = $(id)
  if (el) el.addEventListener('click', () => {
    const d = document.querySelector('details.more')
    if (d && d.open) d.open = false
  })
}
$('smSelArchived').onclick = () => smSelectWhere((s) => s.archived)
$('smSelEmpty').onclick = () => smSelectWhere(smIsEmpty)
$('smSelNone').onclick = () => { smSelected.clear(); renderSessions() }
$('smRefresh').onclick = () => loadSessions(true)
$('smCancelSel').onclick = () => { smSelected.clear(); renderSessions() }
function askDelete() {
  if (smSelected.size === 0) return
  let size = 0
  for (const s of smSessions) { if (smSelected.has(s.sessionId) && s.sizeBytes) size += s.sizeBytes }
  $('smConfirmText').textContent = '将彻底删除 ' + smSelected.size + ' 个会话（' + fmtSize(size) + '），不可恢复；运行中的会话会被逐个跳过。'
  $('smConfirm').hidden = false
  $('bulkBar').hidden = true
}
$('smDelete').onclick = askDelete
$('smDeleteBottom').onclick = askDelete
$('smConfirmNo').onclick = () => { $('smConfirm').hidden = true; renderSessions() }
$('smConfirmYes').onclick = async (e) => {
  const btn = e.currentTarget
  btn.disabled = true
  $('smConfirmNo').disabled = true
  let data = null
  try {
    data = await (await fetch('/api/dsh-sessions/delete-many', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: [...smSelected] }),
    })).json()
  } catch (err) { data = null }
  btn.disabled = false
  $('smConfirmNo').disabled = false
  $('smConfirm').hidden = true
  if (!data || data.ok !== true) {
    showToast('⚠ 批量删除失败：' + ((data && data.message) || '网络错误'), false)
    return
  }
  if (data.failedCount > 0) {
    const fails = (data.results || []).filter((r) => !r.ok)
    const first = fails[0] || {}
    showToast('⚠ 已删 ' + data.deletedCount + ' 个，失败 ' + data.failedCount + ' 个（' +
      (first.message || first.error || '未知') + (fails.length > 1 ? ' 等' : '') + '）', false)
  } else {
    showToast('✓ 已删除 ' + data.deletedCount + ' 个会话', true)
  }
  smSelected.clear()
  dropCache()
  await loadSessions(true)
}

// ---- 设置 ----
function setSwitch(id, on) { const el = $(id); if (el) el.setAttribute('aria-checked', on ? 'true' : 'false') }
function switchOn(id) { return !!$(id) && $(id).getAttribute('aria-checked') === 'true' }
/** 面板字号：只写 --ui-scale（所有 font-size 都乘它），不动布局尺寸。 */
function applyUiScale(value) {
  const n = Number(value)
  const scale = Number.isFinite(n) ? Math.min(1.1, Math.max(0.9, n)) : 1
  document.documentElement.style.setProperty('--ui-scale', String(scale))
  const pct = Math.round(scale * 100)
  const input = $('setUiScale')
  if (input) input.value = String(pct)
  const label = $('setUiScaleVal')
  if (label) label.textContent = pct + '%'
}
function bindSwitch(id, onChange) {
  const el = $(id)
  if (!el) return
  el.onclick = () => {
    const next = el.getAttribute('aria-checked') !== 'true'
    setSwitch(id, next)
    onChange(next)
  }
}
async function put(patch) {
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) { showToast('⚠ 保存失败（HTTP ' + res.status + '）', false); return null }
    const settings = await res.json()
    if (snap) snap.settings = settings
    toastSaved()
    return settings
  } catch (err) {
    showToast('⚠ 保存失败：伴侣服务未连接', false)
    return null
  }
}
function updateSkinPreview(skin, state) {
  $('skinPreview').src = '/skins/' + encodeURIComponent(skin) + '/' + encodeURIComponent(state || 'idle') + '.svg'
}
async function loadSettings() {
  try {
    const [stateRes, skinsRes] = await Promise.all([fetch('/api/state'), fetch('/api/skins')])
    snap = await stateRes.json()
    const skins = await skinsRes.json()
    const s = snap.settings
    paintStatus()
    renderLive()
    applyUiScale(s.uiScale)
    $('setSkin').innerHTML = skins.map((sk) => '<option value="' + esc(sk.name) + '">' + esc(sk.displayName) + '（' + esc(sk.name) + '）</option>').join('')
    $('setSkin').value = s.skin
    updateSkinPreview(s.skin, snap.state)
    $('setOpacity').value = Math.round((Number(s.opacity) || 1) * 100)
    $('setOpacityVal').textContent = Math.round((Number(s.opacity) || 1) * 100) + '%'
    $('setScale').value = Math.round((Number(s.scale) || 1) * 100)
    $('setScaleVal').textContent = Math.round((Number(s.scale) || 1) * 100) + '%'
    setSwitch('setClickThrough', !!s.clickThrough)
    setSwitch('setShowPet', s.showPet !== false)
    setSwitch('setPurePet', !!s.purePetMode)
    setSwitch('setRoam', s.roam !== false)
    setSwitch('setPrivacy', !!s.privacyMode)
    setSwitch('setAutoStart', !!s.autoStart)
    setSwitch('setNotify', s.notify !== false)
    const rr = s.restReminder || {}
    setSwitch('setRestEnabled', rr.enabled !== false)
    $('setRestMinutes').value = rr.intervalMinutes || 60
    syncRestPresets(rr.intervalMinutes || 60)
    const bal = s.balance || {}
    setSwitch('setBalanceEnabled', bal.enabled === true)
    const balMin = String(bal.intervalMinutes || 30)
    const balSel = $('setBalanceInterval')
    if (!Array.prototype.some.call(balSel.options, (o) => o.value === balMin)) {
      const opt = document.createElement('option')
      opt.value = balMin; opt.textContent = balMin
      balSel.appendChild(opt)
    }
    balSel.value = balMin
    $('setBalanceLow').value = bal.lowBalance > 0 ? String(bal.lowBalance) : ''
    const ret = s.retention || {}
    const retSel = $('setRetentionMonths')
    const retMonths = ret.months > 0 ? String(ret.months) : ''
    if (retMonths !== '' && !Array.prototype.some.call(retSel.options, (o) => o.value === retMonths)) {
      const opt = document.createElement('option')
      opt.value = retMonths
      opt.textContent = retMonths + ' 个月'
      retSel.appendChild(opt)
    }
    retSel.value = retMonths
    document.querySelectorAll('#currencySeg button').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-cur') === s.currency))
    const budget = s.budget || {}
    $('setTaskTokens').value = budget.taskMaxTokens || 0
    $('setTaskCost').value = budget.taskMaxCost || 0
    $('setDailyTokens').value = budget.dailyMaxTokens || 0
    $('setDailyCost').value = budget.dailyMaxCost || 0
    $('mockFieldset').hidden = snap.adapter !== 'mock'
    $('btnPauseToggle').textContent = s.paused ? '▶ 恢复统计' : '⏸ 暂停统计'
    renderBudgetUsage()
    void loadOfficialPricing()
    void loadRetention()
  } catch (err) {
    console.error('[panel] 设置加载失败', err && (err.stack || err.message || err))
    showToast('⚠ 设置加载失败：伴侣服务未连接', false)
  }
}
function bindSlider(id, labelId, key) {
  const input = $(id)
  if (!input) return
  let timer = null
  input.oninput = () => {
    const pct = Number(input.value)
    $(labelId).textContent = Math.round(pct) + '%'
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => put({ [key]: Math.round(pct) / 100 }), 200)
  }
}
// 对象字面量计算属性在脚本模式下也可用；这里写成显式映射避免老浏览器差异
bindSlider('setOpacity', 'setOpacityVal', 'opacity')
bindSlider('setScale', 'setScaleVal', 'scale')
let uiScaleTimer = null
let uiScaleEditingUntil = 0
$('setUiScale').oninput = () => {
  const pct = Number($('setUiScale').value)
  // 拖动期间别让 SSE 快照把滑杆弹回旧值。
  uiScaleEditingUntil = Date.now() + 600
  applyUiScale(pct / 100)
  if (uiScaleTimer) clearTimeout(uiScaleTimer)
  uiScaleTimer = setTimeout(() => put({ uiScale: pct / 100 }), 200)
}
$('setSkin').onchange = (e) => {
  updateSkinPreview(e.target.value, snap && snap.state)
  put({ skin: e.target.value })
}
bindSwitch('setShowPet', (v) => put({ showPet: v }))
bindSwitch('setPurePet', (v) => put({ purePetMode: v }))
bindSwitch('setRoam', (v) => { put({ roam: v }); showToast(v ? '✓ 闲时会自己逛逛' : '✓ 已关闭自由活动', true) })
bindSwitch('setClickThrough', (v) => put({ clickThrough: v }))
bindSwitch('setPrivacy', (v) => put({ privacyMode: v }))
bindSwitch('setAutoStart', (v) => put({ autoStart: v }))
bindSwitch('setNotify', (v) => put({ notify: v }))
function putBalance() {
  const low = Number($('setBalanceLow').value) || 0
  put({
    balance: {
      enabled: switchOn('setBalanceEnabled'),
      intervalMinutes: Number($('setBalanceInterval').value) || 30,
      lowBalance: low > 0 ? low : null,
    },
  }).then(() => loadStats(true))
}
bindSwitch('setBalanceEnabled', putBalance)
$('setBalanceInterval').onchange = putBalance
$('setBalanceLow').onchange = putBalance
bindSwitch('setRestEnabled', () => {
  const mins = Math.min(480, Math.max(5, Math.round(Number($('setRestMinutes').value) || 60)))
  put({ restReminder: { enabled: switchOn('setRestEnabled'), intervalMinutes: mins } })
})
$('setRestMinutes').onchange = () => {
  const mins = Math.min(480, Math.max(5, Math.round(Number($('setRestMinutes').value) || 60)))
  $('setRestMinutes').value = mins
  syncRestPresets(mins)
  put({ restReminder: { enabled: switchOn('setRestEnabled'), intervalMinutes: mins } })
}
function syncRestPresets(mins) {
  for (const b of document.querySelectorAll('#restPresets button')) {
    b.classList.toggle('is-active', Number(b.getAttribute('data-min')) === Number(mins))
  }
}
for (const b of document.querySelectorAll('#restPresets button')) {
  b.onclick = () => {
    const mins = Number(b.getAttribute('data-min')) || 60
    $('setRestMinutes').value = mins
    syncRestPresets(mins)
    put({ restReminder: { enabled: switchOn('setRestEnabled'), intervalMinutes: mins } })
  }
}
for (const b of document.querySelectorAll('#currencySeg button')) {
  b.onclick = () => {
    document.querySelectorAll('#currencySeg button').forEach((x) => x.classList.toggle('is-active', x === b))
    void put({ currency: b.getAttribute('data-cur') }).then(() => { dropCache(); loadOfficialPricing(); loadStats(true) })
  }
}
for (const id of ['setTaskTokens', 'setTaskCost', 'setDailyTokens', 'setDailyCost']) {
  $(id).onchange = () => {
    const budget = {
      taskMaxTokens: Number($('setTaskTokens').value) || null,
      taskMaxCost: Number($('setTaskCost').value) || null,
      dailyMaxTokens: Number($('setDailyTokens').value) || null,
      dailyMaxCost: Number($('setDailyCost').value) || null,
    }
    put({ budget }).then(() => {
      if (snap) snap.settings.budget = budget
      budgetToday = null
      renderBudgetUsage()
      renderLive()
    })
  }
}
$('btnPauseToggle').onclick = async () => {
  try { await fetch('/api/pause', { method: 'POST' }) } catch (err) {}
  await loadSettings()
}
$('mockStart').onclick = () => {
  fetch('/api/mock/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: $('mockScenario').value }) })
}
$('btnExportCsv').onclick = () => { window.location = '/api/export/sessions?format=csv' }
$('btnExportJson').onclick = () => { window.location = '/api/export/sessions?format=json' }
for (const b of document.querySelectorAll('#settingsIndex button')) {
  b.onclick = () => {
    const group = b.getAttribute('data-group')
    document.querySelectorAll('#settingsIndex button').forEach((x) => {
      const on = x === b
      x.classList.toggle('on', on)
      if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current')
    })
    document.querySelectorAll('.settings-group').forEach((p) => {
      const on = p.getAttribute('data-pane') === group
      p.classList.toggle('on', on)
      p.hidden = !on
    })
  }
}
function renderBudgetUsage() {
  const box = $('budgetUsage')
  if (!box || !snap) return
  const budget = (snap.settings && snap.settings.budget) || {}
  const costCap = Number(budget.dailyMaxCost) || 0
  const tokenCap = Number(budget.dailyMaxTokens) || 0
  if (costCap <= 0 && tokenCap <= 0) { box.hidden = true; return }
  // 预算本身是「今日」口径，不能拿统计页当前周期的数字糊弄（切到本月会算错）。
  const paint = (s) => {
    if (!s) { box.hidden = true; return }
    const useCost = costCap > 0 && (tokenCap <= 0 || (s.cost / costCap) >= (s.totalTokens / tokenCap))
    const used = useCost ? s.cost : s.totalTokens
    const cap = useCost ? costCap : tokenCap
    const pctRaw = cap > 0 ? (used / cap) * 100 : 0
    const pct = Math.max(0, Math.min(100, Math.round(pctRaw)))
    box.hidden = false
    const fill = $('budgetBarFill')
    fill.style.width = pct + '%'
    fill.classList.toggle('warn', pct >= 80)
    const fmt = (v) => useCost ? fmtCostText(v) : fmtTokens(v) + ' tok'
    $('budgetText').innerHTML = '今日已用 <b>' + fmt(used) + '</b> / ' + fmt(cap) + '（' + pct + '%）· 剩余 ' + fmt(Math.max(0, cap - used)) +
      (pctRaw >= 100 ? ' <span style="color:var(--red)">已超预算</span>' : '')
  }
  if (budgetToday) { paint(budgetToday); return }
  fetch('/api/stats?period=today').then((r) => r.json()).then((s) => {
    budgetToday = s
    paint(s)
  }).catch(() => { box.hidden = true })
}

// ---- 模型计价（只读官方价 + 同步） ----
function officialNames() {
  return officialPricing && officialPricing.models ? Object.keys(officialPricing.models) : []
}
function fmtStamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
async function loadOfficialPricing() {
  try { officialPricing = await (await fetch('/api/pricing')).json() } catch (err) { officialPricing = null }
  renderOfficialBox()
}
function renderOfficialBox() {
  const box = $('officialBox')
  if (!box) return
  const names = officialNames()
  let text
  if (officialPricing && officialPricing.ok && names.length) {
    text = '<span class="off-ok">✓ 官方价已同步 ' + fmtStamp(officialPricing.fetchedAt) + '</span>（' +
      (officialPricing.currency === 'CNY' ? 'USD→CNY ' + officialPricing.rate : '美元计价') + '；单位：每百万 token）'
  } else {
    const why = officialPricing && officialPricing.error ? '：' + esc(officialPricing.error) : ''
    text = '<span class="off-warn">官方价未同步' + why + '</span>，当前按内置兜底价计'
  }
  box.innerHTML = '<span>' + text + '</span>'
  renderOfficialRows()
}
function renderOfficialRows() {
  const box = $('officialRows')
  if (!box) return
  const names = officialNames()
  const sym = officialPricing && officialPricing.currency === 'USD' ? '$' : '¥'
  if (!names.length) {
    box.innerHTML = '<div class="price-empty">等待官方价同步 — 同步成功后自动列出 DeepSeek 当前模型与价格</div>'
    return
  }
  const off = isOffPeakNow()
  box.innerHTML =
    '<div class="price-meta"><span>当前计价时段：' + (off ? '空闲（5 折）' : '高峰') + '</span><span>高峰价 · 闲时小字</span></div>' +
    '<table class="price-table"><thead><tr><th>模型</th><th>输入 / 百万</th><th>缓存命中 / 百万</th><th>输出 / 百万</th></tr></thead><tbody>' +
    names.map((n) => {
      const p = officialPricing.models[n]
      const offText = (v) => (v != null && v > 0 ? '<small class="op-off">闲时 ' + sym + v + '</small>' : '')
      return '<tr><td>' + esc(n) + '</td>' +
        '<td>' + sym + p.inputPerMillion + offText(p.inputOffPeakPerMillion) + '</td>' +
        '<td>' + sym + (p.cacheInputPerMillion != null ? p.cacheInputPerMillion : 0) + offText(p.cacheInputOffPeakPerMillion) + '</td>' +
        '<td>' + sym + p.outputPerMillion + offText(p.outputOffPeakPerMillion) + '</td></tr>'
    }).join('') + '</tbody></table>' +
    '<p class="price-note">空闲价为高峰价的一半。高峰 = 北京时间工作日 9:00–12:00 / 14:00–18:00；周末与中国法定节假日全天闲时。同一任务按开始时刻取价，不跨档拆价。</p>'
}
$('btnSyncPricing').onclick = async (e) => {
  const btn = e.currentTarget || $('btnSyncPricing')
  btn.disabled = true
  let res = null
  try { res = await (await fetch('/api/pricing/refresh', { method: 'POST' })).json() } catch (err) { res = null }
  await loadOfficialPricing()
  btn.disabled = false
  if (res && res.ok) showToast('✓ 官方价格已同步', true)
  else showToast('⚠ 同步失败：' + ((res && res.error) || '网络错误'), false)
}

// ---- 节假日日历（峰谷判断数据源；官方发布后手动同步） ----
let holidayInfo = null
let holidaySync = null
function renderHolidayBox() {
  const box = $('holidayBox')
  if (!box) return
  if (!holidayInfo || !Array.isArray(holidayInfo.years)) {
    box.textContent = '节假日日历加载中…'
    return
  }
  const years = holidayInfo.years
  const total = Array.isArray(holidayInfo.dates) ? holidayInfo.dates.length : 0
  let text = '已加载 ' + (years.length ? years.join('、') : '—') + ' 节假日' +
    (total ? '（共 ' + total + ' 天）' : '') + '。'
  if (holidayInfo.updatedAt) text += '上次同步 ' + fmtStamp(holidayInfo.updatedAt) + '。'
  if (holidaySync && Array.isArray(holidaySync.years)) {
    const bits = holidaySync.years.map((y) => {
      if (y.updated) return y.year + ' 已更新 ' + y.count + ' 天'
      return y.year + ' ' + (y.reason || '保持原数据')
    })
    text += ' ' + bits.join('；') + '。'
  }
  box.textContent = text
}
async function loadHolidayInfo() {
  try { holidayInfo = await (await fetch('/api/holidays')).json() } catch (err) { holidayInfo = null }
  renderHolidayBox()
}
$('btnSyncHolidays').onclick = async (e) => {
  const btn = e.currentTarget || $('btnSyncHolidays')
  btn.disabled = true
  btn.textContent = '同步中…'
  let res = null
  try { res = await (await fetch('/api/holidays/sync', { method: 'POST' })).json() } catch (err) { res = null }
  holidaySync = res
  await loadHolidayInfo()
  renderOfficialRows()
  btn.disabled = false
  btn.textContent = '同步节假日'
  if (res && res.ok) showToast('✓ 节假日日历已同步', true)
  else showToast('⚠ ' + ((res && res.error) || '同步失败，保持原日历'), false)
}
void loadHolidayInfo()

// 峰谷在 9:00 / 12:00 / 14:00 / 18:00 自动切换：面板每分钟重算一次。
setInterval(() => {
  if (document.visibilityState === 'visible') renderOfficialRows()
}, 60_000)

// ---- 数据保留 ----
function retentionCutoffText(cutoff) {
  const d = new Date(cutoff)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function setRetentionInfo(text) { const el = $('retentionInfo'); if (el) el.textContent = text }
function renderRetention() {
  const r = retentionState
  const btn = $('btnPruneNow')
  if (!r) { setRetentionInfo('加载中…'); return }
  if (r.months === null) {
    setRetentionInfo('共 ' + r.total.toLocaleString() + ' 条 · 永久保留（不清理）')
    btn.disabled = true
    btn.textContent = '🧹 立即清理（永久保留中）'
    return
  }
  setRetentionInfo('共 ' + r.total.toLocaleString() + ' 条 · 保留 ' + r.months + ' 个月 · 可清理 ' + r.candidates.toLocaleString() + ' 条')
  btn.disabled = retentionBusy || r.candidates <= 0
  btn.textContent = r.candidates > 0
    ? '🧹 立即清理 ' + r.candidates.toLocaleString() + ' 条'
    : '🧹 立即清理（无过期数据）'
}
async function loadRetention() {
  try { retentionState = await (await fetch('/api/retention')).json() } catch (err) {
    retentionState = null
    setRetentionInfo('伴侣服务未连接')
    return
  }
  renderRetention()
}
function retentionConfirmClose() { $('retentionConfirm').hidden = true }
$('setRetentionMonths').onchange = (e) => {
  const raw = e.target.value
  put({ retention: { months: raw === '' ? null : Number(raw) } }).then(loadRetention)
}
$('btnPruneNow').onclick = () => {
  const r = retentionState
  if (!r || r.months === null || r.candidates <= 0 || retentionBusy) return
  $('retentionConfirmText').textContent = '将删除 ' + r.candidates.toLocaleString() + ' 条早于 ' + retentionCutoffText(r.cutoff) +
    ' 的任务记录，不可恢复。建议先导出 CSV/JSON 备份。'
  $('retentionConfirm').hidden = false
}
$('retentionCancel').onclick = retentionConfirmClose
$('retentionConfirmYes').onclick = async () => {
  if (retentionBusy) return
  retentionBusy = true
  const yes = $('retentionConfirmYes')
  const btn = $('btnPruneNow')
  yes.disabled = true
  btn.disabled = true
  yes.textContent = '清理中…'
  try {
    const res = await (await fetch('/api/retention/prune', { method: 'POST' })).json()
    const removed = Number(res.removed) || 0
    retentionConfirmClose()
    showToast(removed > 0
      ? '已清理 ' + removed.toLocaleString() + ' 条过期任务，剩余 ' + (Number(res.total) || 0).toLocaleString() + ' 条'
      : '没有需要清理的过期任务', removed > 0)
    dropCache()
    await loadRetention()
    loadHistory(true)
  } catch (err) {
    showToast('清理失败：伴侣服务未连接', false)
  } finally {
    retentionBusy = false
    yes.disabled = false
    yes.textContent = '确认删除'
    renderRetention()
  }
}

// ---- 任务详情抽屉 ----
function taskDuration(t) {
  if (!t) return 0
  if (t.durationMs != null) return Number(t.durationMs)
  return Math.max(0, Number(t.endTime || Date.now()) - Number(t.startTime || Date.now()))
}
function rateFor(model, at) {
  if (!officialPricing || !officialPricing.models) return null
  const table = officialPricing.models
  const price = table[model] || table[String(model || '').split('/').pop()]
  if (!price) return null
  const off = isOffPeakNow(at)
  return {
    off,
    input: off ? (price.inputOffPeakPerMillion != null ? price.inputOffPeakPerMillion : price.inputPerMillion) : price.inputPerMillion,
    cache: off
      ? (price.cacheInputOffPeakPerMillion != null ? price.cacheInputOffPeakPerMillion : (price.cacheInputPerMillion != null ? price.cacheInputPerMillion : price.inputPerMillion))
      : (price.cacheInputPerMillion != null ? price.cacheInputPerMillion : price.inputPerMillion),
    output: off ? (price.outputOffPeakPerMillion != null ? price.outputOffPeakPerMillion : price.outputPerMillion) : price.outputPerMillion,
  }
}
function drawerHTML(t) {
  const prompt = Number(t.promptTokens) || 0
  const completion = Number(t.completionTokens) || 0
  const cached = Math.min(Number(t.cachedTokens) || 0, prompt)
  const uncached = Math.max(0, prompt - cached)
  const total = uncached + cached + completion || 1
  const pct = (v) => Math.round((v / total) * 100)
  const dur = taskDuration(t)
  const budget = (snap && snap.settings && snap.settings.budget) || {}
  const tokenCap = Number(budget.taskMaxTokens) || 0
  const costCap = Number(budget.taskMaxCost) || 0
  const totalTokens = Number(t.totalTokens) || (prompt + completion)
  const cost = Number(t.cost) || 0
  const pricing = rateFor(t.model, t.startTime)
  const costParts = pricing ? {
    input: uncached / 1e6 * pricing.input,
    cache: cached / 1e6 * pricing.cache,
    output: completion / 1e6 * pricing.output,
  } : null
  const costSum = costParts ? costParts.input + costParts.cache + costParts.output : 0
  const showCost = !!(costParts && (costSum > 0 || cost > 0))
  const budgetUse = tokenCap > 0 ? totalTokens / tokenCap : (costCap > 0 ? cost / costCap : 0)
  const budgetPct = tokenCap > 0 || costCap > 0 ? Math.round(budgetUse * 100) : 0
  const budgetLabel = tokenCap > 0
    ? fmtTokens(totalTokens) + ' / ' + fmtTokens(tokenCap) + ' token'
    : fmtCostText(cost) + ' / ' + fmtCostText(costCap)
  const status = t.status || 'running'
  const statusInfo = status === 'success'
    ? { cls: 'good', title: '成功', text: '任务正常结束。' }
    : status === 'failed'
      ? { cls: '', title: '失败', text: 'DSH 没有把错误详情传给伴侣；可在宿主会话里查看原始记录。已产生的用量照常记账。' }
      : status === 'interrupted'
        ? { cls: 'warn', title: '中断', text: '用户取消或进程退出。已产生的用量照常记账。' }
        : status === 'blocked'
          ? { cls: 'warn', title: '等待输入', text: '任务在等待你的确认或补充输入。' }
          : status === 'max-tokens'
            ? { cls: '', title: '触顶结束', text: '达到上下文上限而结束，可考虑拆小任务或换更大上下文的模型。' }
            : { cls: 'info', title: '任务进行中', text: '数据每秒刷新；完成后自动转入历史记录。' }
  const toolTotal = Number(t.toolCalls) || 0
  const toolOk = Number(t.toolSuccess) || 0
  const toolFail = Number(t.toolFail) || 0
  const modelName = esc(mask(t.model) || '—')
  const projectName = esc(mask(t.project) || '（未命名任务）')
  return '<div class="dw-sec"><h4>概览</h4><div class="dw-stats">' +
      '<div class="dw-stat"><span>Token</span><b>' + totalTokens.toLocaleString() + '</b></div>' +
      '<div class="dw-stat"><span>费用</span><b>' + fmtCostText(cost) + '</b></div>' +
      '<div class="dw-stat"><span>工具调用</span><b>' + toolTotal + '</b></div>' +
      '<div class="dw-stat"><span>时长</span><b>' + fmtDuration(dur) + '</b></div>' +
    '</div></div>' +
    '<div class="dw-sec"><h4>Token 构成</h4>' +
      '<div class="tok-bar"><i style="width:' + pct(uncached) + '%;background:var(--blue)"></i>' +
      '<i style="width:' + pct(cached) + '%;background:var(--cyan)"></i>' +
      '<i style="width:' + pct(completion) + '%;background:var(--cyan-dim)"></i></div>' +
      '<div class="dw-legend">' +
        '<div class="dw-line"><i class="sw" style="background:var(--blue)"></i>输入（未命中）<b>' + uncached.toLocaleString() + '</b><em>' + pct(uncached) + '%</em></div>' +
        '<div class="dw-line"><i class="sw" style="background:var(--cyan)"></i>缓存命中<b>' + cached.toLocaleString() + '</b><em>' + pct(cached) + '%</em></div>' +
        '<div class="dw-line"><i class="sw" style="background:var(--cyan-dim)"></i>输出<b>' + completion.toLocaleString() + '</b><em>' + pct(completion) + '%</em></div>' +
      '</div>' +
      (tokenCap > 0 || costCap > 0
        ? '<div class="budget-line"><span>单任务预算</span><span class="bar"><i class="' + (budgetPct >= 100 ? 'over' : (budgetPct >= 80 ? 'warn' : '')) + '" style="width:' + Math.max(0, Math.min(100, budgetPct)) + '%"></i></span><b style="color:var(--ink-2)">' + budgetLabel + ' · ' + budgetPct + '%</b></div>'
        : '') +
    '</div>' +
    (showCost
      ? '<div class="dw-sec"><h4>费用构成 · 官方价估算' + (pricing.off ? '（闲时档）' : '（高峰档）') + '</h4><div class="dw-table">' +
          '<div class="dw-trow"><span>输入（未命中）</span><em>' + Math.round(costParts.input / (costSum || 1) * 100) + '%</em><b>' + fmtCostText(costParts.input) + '</b></div>' +
          '<div class="dw-trow"><span>缓存命中</span><em>' + Math.round(costParts.cache / (costSum || 1) * 100) + '%</em><b>' + fmtCostText(costParts.cache) + '</b></div>' +
          '<div class="dw-trow"><span>输出</span><em>' + Math.round(costParts.output / (costSum || 1) * 100) + '%</em><b>' + fmtCostText(costParts.output) + '</b></div>' +
        '</div><div class="dw-total"><span>合计（估算）</span><b>' + fmtCostText(costSum) + '</b></div>' +
        (cost > 0 ? '<div class="tool-note">落库费用 ' + fmtCostText(cost) + '，与估算的差异来自自定义价格覆盖或计价口径。</div>' : '') +
        '</div>'
      : '<div class="dw-sec"><h4>费用构成</h4><div class="tool-note">该任务没有可计费价格（自定义渠道 / 缺少官方价），费用不计入统计。</div></div>') +
    '<div class="dw-sec"><h4>工具调用 · ' + toolTotal + ' 次</h4>' +
      '<div class="tool-seq"><span class="tool-chip"><i></i>成功 ' + toolOk + '</span>' +
      '<span class="tool-chip' + (toolFail > 0 ? ' fail' : '') + '"><i></i>失败 ' + toolFail + '</span>' +
      '<span class="tool-chip"><i></i>共 ' + toolTotal + '</span></div>' +
      '<div class="tool-note">逐次工具明细不落库，只保留计数（伴侣状态机也用它）。</div>' +
    '</div>' +
    '<div class="dw-sec dw-wide"><h4>状态</h4><div class="err-box ' + statusInfo.cls + '"><b>' + statusInfo.title + ' · ' + projectName + '</b><p>' + statusInfo.text + '</p>' +
      '<div class="tool-note">模型 ' + modelName + ' · 开始 ' + fmtTime(t.startTime) + (t.endTime ? ' · 结束 ' + fmtTime(t.endTime) : '') + '</div>' +
    '</div></div>'
}
function openDrawer(task, trigger) {
  if (!task) return
  drawerTask = task
  drawerReturn = trigger || null
  $('drawerTitle').textContent = mask(task.project) || '（未命名任务）'
  $('drawerMeta').innerHTML = '<span>' + fmtTime(task.startTime) + '</span>' +
    '<span class="status ' + statusClass(task.status) + '"><i></i>' + statusText(task.status) + '</span>' +
    '<span>' + esc(mask(task.model) || '—') + '</span>'
  $('drawerBody').innerHTML = drawerHTML(task)
  const scrim = $('drawerScrim')
  const drawer = $('taskDrawer')
  scrim.hidden = false
  drawer.hidden = false
  drawer.setAttribute('aria-hidden', 'false')
  requestAnimationFrame(() => {
    scrim.classList.add('is-on')
    drawer.classList.add('is-open')
    $('drawerClose').focus()
  })
}
function closeDrawer() {
  const scrim = $('drawerScrim')
  const drawer = $('taskDrawer')
  if (drawer.hidden) return
  scrim.classList.remove('is-on')
  drawer.classList.remove('is-open')
  drawer.setAttribute('aria-hidden', 'true')
  setTimeout(() => {
    if (!drawer.classList.contains('is-open')) {
      drawer.hidden = true
      scrim.hidden = true
    }
  }, 240)
  if (drawerReturn && document.contains(drawerReturn)) drawerReturn.focus()
  else $('btnRefresh').focus()
  drawerReturn = null
}
$('drawerClose').onclick = closeDrawer
$('drawerScrim').onclick = closeDrawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('taskDrawer').hidden) closeDrawer()
})
function copyText(text, okMsg) {
  const done = () => showToast(okMsg, true)
  const fail = () => showToast('复制失败：浏览器不允许', false)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fail)
    return
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    done()
  } catch (err) { fail() }
}
$('drawerCopy').onclick = () => { if (drawerTask) copyText(drawerTask.id, '✓ 任务 ID 已复制') }
$('drawerSession').onclick = () => {
  if (!drawerTask) return
  const sid = drawerTask.sessionId || ''
  if (!sid) { showToast('该任务没有会话 ID', false); return }
  copyText(sid, '✓ 会话 ID 已复制')
}

// ---- SSE / 状态 ----
const es = new EventSource('/api/events')
es.onopen = () => setConnected(true)
es.onerror = () => setConnected(false)
es.onmessage = (e) => {
  try {
    const next = JSON.parse(e.data)
    if (next && next.bye) return
    const wasTask = !!(snap && snap.task)
    const nextDone = next.lastResult ? JSON.stringify(next.lastResult) : ''
    if (wasTask !== !!next.task || nextDone !== lastDoneKey) {
      dropCache()
      budgetToday = null
      lastDoneKey = nextDone
    }
    snap = next
    paintStatus()
    if (Date.now() > uiScaleEditingUntil) applyUiScale(next.settings && next.settings.uiScale)
    renderLive()
  } catch (err) {}
}
setInterval(() => {
  $('stTime').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  if (snap && snap.task) {
    const now = Date.now()
    if (now - lastLivePaint >= 950) { lastLivePaint = now; renderLive() }
  }
}, 1000)
let resizeTimer = null
addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(syncPageSize, 180)
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentTab === 'stats') loadStats(true)
})

// ---- 启动 ----
async function loadState() {
  try {
    snap = await (await fetch('/api/state')).json()
    paintStatus()
    renderLive()
    applyUiScale(snap.settings && snap.settings.uiScale)
    if (snap.settings && snap.settings.balance && snap.settings.balance.enabled) void loadBalanceView(false)
  } catch (err) { /* 服务未就绪时由 SSE 首帧补齐 */ }
}
renderPeriodNote()
// 先拿一次快照再拉历史：隐私模式要在第一屏就生效，不能先露出任务名。
void loadState().then(() => loadHistory())
loadSettings()
</script>
</body>
</html>`;
}
