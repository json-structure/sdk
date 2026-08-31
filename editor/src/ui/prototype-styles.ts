/** Production styles derived from the iterated JSON Structure editor prototype. */
export const editorStyles = `
:host,.json-structure-editor {
  --js-bg:#151719;
  --js-canvas:#111416;
  --js-chrome:#1d2023;
  --js-panel:#24282c;
  --js-raised:#2b3035;
  --js-line:#3c4248;
  --js-line-strong:#59616a;
  --js-text:#eef1f3;
  --js-muted:#aab2b9;
  --js-quiet:#7e8790;
  --js-accent:#59b6d6;
  --js-accent-strong:#85d8f3;
  --js-ok:#63c08a;
  --js-warn:#e6b85c;
  --js-error:#ef7474;
  --js-violet:#b99bea;
  --js-focus:#f2cf72;
  --js-rail:46px;
  --js-sidebar:238px;
  --js-inspector:284px;
  display:block;
  width:100%;
  height:100%;
  overflow:hidden;
  color:var(--js-text);
  background:var(--js-bg);
  font:13px/1.4 "Segoe UI Variable Text","Segoe UI",sans-serif;
}
.json-structure-editor[data-theme="light"] {
  --js-bg:#f7f8f8;
  --js-canvas:#fff;
  --js-chrome:#f0f2f2;
  --js-panel:#fff;
  --js-raised:#e5e9ea;
  --js-line:#c7d0d2;
  --js-line-strong:#9eaaad;
  --js-text:#182124;
  --js-muted:#4c5b60;
  --js-quiet:#69787c;
  --js-accent:#087d9b;
  --js-accent-strong:#005d75;
  --js-ok:#237a48;
  --js-warn:#8a5700;
  --js-error:#b42318;
  --js-violet:#7256a8;
  --js-focus:#9b6300;
}
.json-structure-editor[data-theme="contrast"] {
  --js-bg:#000;
  --js-canvas:#000;
  --js-chrome:#000;
  --js-panel:#000;
  --js-raised:#181818;
  --js-line:#fff;
  --js-line-strong:#fff;
  --js-text:#fff;
  --js-muted:#fff;
  --js-quiet:#ddd;
  --js-accent:#00e5ff;
  --js-accent-strong:#00e5ff;
  --js-ok:#66ff99;
  --js-warn:#ffe600;
  --js-error:#ff6b6b;
  --js-violet:#d4b5ff;
  --js-focus:#ffe600;
}
.json-structure-editor * { box-sizing:border-box; letter-spacing:0; }
.json-structure-editor [hidden] { display:none!important; }
.json-structure-editor button,.json-structure-editor input,.json-structure-editor select,.json-structure-editor textarea { color:inherit; font:inherit; }
.json-structure-editor button { cursor:pointer; }
.json-structure-editor button:disabled { cursor:default; opacity:.45; }
.json-structure-editor button:focus-visible,.json-structure-editor input:focus-visible,.json-structure-editor select:focus-visible,.json-structure-editor textarea:focus-visible,.json-structure-editor [tabindex]:focus-visible { outline:2px solid var(--js-focus); outline-offset:-2px; }
.js-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.js-spacer { flex:1; }
.js-shell { height:100%; min-height:520px; display:grid; grid-template-rows:34px 36px minmax(0,1fr) 22px; overflow:hidden; background:var(--js-bg); }
.js-title,.js-document-toolbar,.js-status { display:flex; align-items:center; background:var(--js-chrome); }
.js-title { min-width:0; padding:0 10px; gap:9px; border-bottom:1px solid #0e0f10; user-select:none; }
.js-mark,.js-empty-mark { display:inline-block; position:relative; border:2px solid var(--js-accent); transform:rotate(45deg); }
.js-mark { width:16px; height:16px; }
.js-mark::after,.js-empty-mark::after { content:""; position:absolute; inset:3px; border:1px solid var(--js-accent-strong); }
.js-title strong { font-weight:650; }
.js-file { min-width:0; margin-inline:auto; overflow:hidden; color:var(--js-muted); text-overflow:ellipsis; white-space:nowrap; }
.js-command-trigger { width:30px; height:26px; border:1px solid transparent; border-radius:3px; background:transparent; color:var(--js-muted); font:11px/1 Consolas,monospace; }
.js-command-trigger:hover { border-color:var(--js-line); background:var(--js-raised); color:var(--js-text); }
.js-theme-label { display:flex; align-items:center; }
.js-theme { width:112px; height:26px; border:1px solid var(--js-line); border-radius:3px; padding:0 5px; background:var(--js-panel); color:var(--js-muted); }
.js-document-toolbar { min-width:0; padding:0 8px 0 52px; gap:5px; border-bottom:1px solid var(--js-line); }
.js-document-toolbar>button,.js-tabs button,.js-panel-head button,.js-problems-head button,.js-status button { height:26px; border:1px solid transparent; border-radius:3px; padding:0 8px; background:transparent; color:var(--js-muted); }
.js-document-toolbar>button:hover,.js-panel-head button:hover,.js-problems-head button:hover { border-color:var(--js-line); background:var(--js-raised); color:var(--js-text); }
.js-tabs { display:flex; overflow:hidden; border:1px solid var(--js-line); border-radius:4px; }
.js-tabs button { border:0; border-inline-end:1px solid var(--js-line); border-radius:0; padding:0 10px; }
.js-tabs button:last-child { border-inline-end:0; }
.js-tabs button[aria-selected="true"] { background:var(--js-raised); color:var(--js-text); box-shadow:inset 0 -2px var(--js-accent); }
.js-chip { display:inline-flex; align-items:center; min-height:22px; border:1px solid var(--js-line); border-radius:3px; padding:0 7px; background:var(--js-panel); color:var(--js-muted); font:11px/1.3 Consolas,"Cascadia Code",monospace; }
.js-workbench { min-width:0; min-height:0; display:grid; grid-template-columns:var(--js-rail) var(--js-sidebar) minmax(360px,1fr) var(--js-inspector); grid-template-rows:minmax(0,1fr) 31px; transition:grid-template-rows 120ms ease; }
.js-workbench[data-problems-open="true"] { grid-template-rows:minmax(0,1fr) 174px; }
.js-activity { grid-column:1; grid-row:1/3; display:flex; flex-direction:column; align-items:stretch; padding-top:4px; border-inline-end:1px solid var(--js-line); background:#181b1e; }
.js-activity-button { width:45px; height:43px; border:0; border-inline-start:2px solid transparent; background:transparent; color:var(--js-quiet); font:17px/1 Consolas,monospace; }
.js-activity-button:hover { color:var(--js-text); }
.js-activity-button[aria-pressed="true"],.js-activity-primary[aria-expanded="true"] { border-inline-start-color:var(--js-accent); background:rgba(89,182,214,.08); color:var(--js-text); }
.js-outline { grid-column:2; grid-row:1/3; min-width:0; display:flex; flex-direction:column; overflow:hidden; border-inline-end:1px solid var(--js-line); background:var(--js-chrome); }
.js-panel-head { height:34px; flex:0 0 auto; display:flex; align-items:center; padding:0 9px; border-bottom:1px solid var(--js-line); color:var(--js-muted); font-size:11px; text-transform:uppercase; }
.js-panel-head span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-panel-head button { width:26px; margin-inline-start:auto; padding:0; font-size:16px; }
.js-filter { width:calc(100% - 16px); height:28px; margin:8px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-canvas); }
.js-tree { min-height:0; overflow:auto; padding-bottom:12px; }
.js-tree-group { padding:10px 9px 5px; color:var(--js-quiet); font-size:11px; text-transform:uppercase; }
.js-tree-item { width:100%; height:28px; display:flex; align-items:center; gap:7px; border:0; border-inline-start:2px solid transparent; padding:0 8px 0 11px; background:transparent; color:var(--js-muted); text-align:start; }
.js-tree-item:hover { background:rgba(255,255,255,.035); color:var(--js-text); }
.js-tree-item[aria-current="true"] { border-inline-start-color:var(--js-accent); background:rgba(89,182,214,.11); color:var(--js-text); }
.js-kind { width:18px; flex:0 0 auto; color:var(--js-accent); text-align:center; font:11px/1 Consolas,monospace; }
.js-tree-empty { margin:6px 9px; border:1px dashed var(--js-line); padding:12px; text-align:start; }
.js-center { grid-column:3; grid-row:1; min-width:0; min-height:0; display:grid; grid-template-rows:34px 30px minmax(0,1fr); overflow:hidden; background:var(--js-bg); }
.js-editor-tab { width:min(260px,45%); height:34px; display:flex; align-items:center; gap:6px; overflow:hidden; border-top:1px solid var(--js-accent); border-inline-end:1px solid var(--js-line); padding:0 10px; background:var(--js-bg); color:var(--js-text); }
.js-editor-tab span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-breadcrumbs { min-width:0; display:flex; align-items:center; gap:7px; overflow:hidden; border-bottom:1px solid var(--js-line); padding:0 12px; color:var(--js-quiet); white-space:nowrap; }
.js-breadcrumbs strong { color:var(--js-muted); font-weight:500; }
.js-center>.js-view { grid-row:3; min-width:0; min-height:0; overflow:auto; }
.js-view { padding:20px 24px 56px; }
.js-sheet { width:min(980px,100%); margin:0 auto; }
.js-type-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; border-bottom:1px solid var(--js-line-strong); padding-bottom:16px; }
.js-eyebrow { color:var(--js-accent); font:11px/1.3 Consolas,"Cascadia Code",monospace; text-transform:uppercase; }
.js-type-head h1,.js-sheet>header h1 { margin:4px 0 5px; font-size:25px; line-height:1.18; font-weight:650; }
.js-description { margin:0; color:var(--js-muted); line-height:1.45; }
.js-type-head>.js-chip { align-self:start; }
.js-section-head { display:flex; align-items:center; gap:8px; margin:20px 0 7px; }
.js-section-head>div:first-child { display:flex; align-items:baseline; gap:7px; }
.js-section-head h2,.js-sheet h2 { margin:0; font-size:13px; line-height:1.35; }
.js-section-head>button { height:28px; margin-inline-start:auto; border:1px solid var(--js-line); border-radius:3px; padding:0 9px; background:var(--js-raised); color:var(--js-muted); }
.js-section-head>button:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-section-meta { color:var(--js-quiet); font-size:12px; }
.js-grid { border:1px solid var(--js-line); background:rgba(36,40,44,.82); }
.js-row { min-height:36px; display:grid; grid-template-columns:minmax(115px,1.15fr) minmax(120px,1.2fr) 82px minmax(130px,1.5fr) 34px; align-items:center; border-bottom:1px solid var(--js-line); }
.js-row:last-child { border-bottom:0; }
.js-row.js-header { min-height:29px; background:var(--js-panel); color:var(--js-quiet); font-size:10px; text-transform:uppercase; }
.js-row[aria-current="true"] { background:rgba(89,182,214,.09); box-shadow:inset 2px 0 var(--js-accent); }
.js-cell { min-width:0; overflow:hidden; padding:0 9px; text-overflow:ellipsis; white-space:nowrap; }
.js-row button.js-cell { align-self:stretch; border:0; background:transparent; text-align:start; }
.js-row button.js-cell:hover { color:var(--js-accent-strong); }
.js-code { font-family:Consolas,"Cascadia Code",monospace; }
.js-required { color:var(--js-ok); }
.js-optional { color:var(--js-quiet); }
.js-row-action { padding:0!important; color:var(--js-quiet); font-size:18px!important; text-align:center!important; }
.js-add-row { width:100%; height:36px; display:flex; align-items:center; gap:8px; border:0; padding:0 10px; background:transparent; color:var(--js-quiet); text-align:start; }
.js-add-row:hover { background:rgba(255,255,255,.035); color:var(--js-text); }
.js-empty-state { height:100%; min-height:330px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center; }
.js-empty-mark { width:38px; height:38px; margin-bottom:22px; }
.js-empty-state h1 { margin:6px 0; font-size:24px; font-weight:600; }
.js-empty-state p { max-width:430px; margin:0; color:var(--js-muted); line-height:1.5; }
.js-empty-actions { display:flex; gap:7px; margin-top:18px; }
.js-empty-actions button { height:30px; border:1px solid var(--js-line-strong); border-radius:3px; padding:0 13px; background:var(--js-raised); }
.js-empty-actions .js-primary { border-color:var(--js-accent); background:var(--js-accent); color:#081114; font-weight:650; }
.js-empty { padding:16px; color:var(--js-muted); text-align:center; }
.js-inspector { grid-column:4; grid-row:1; min-width:0; min-height:0; overflow:auto; border-inline-start:1px solid var(--js-line); background:var(--js-chrome); }
.js-inspector>section,.js-inspector-section { padding:12px 10px; border-bottom:1px solid var(--js-line); }
.js-inspector h2 { margin:4px 0 6px; overflow-wrap:anywhere; font-size:16px; line-height:1.25; }
.js-inspector-section dl { margin:8px 0 0; }
.js-inspector-row { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:8px; border-bottom:1px solid rgba(60,66,72,.55); padding:5px 0; }
.js-inspector-row:last-child { border-bottom:0; }
.js-inspector-row dt { min-width:0; overflow-wrap:anywhere; color:var(--js-muted); }
.js-inspector-row dd { min-width:0; margin:0; overflow-wrap:anywhere; text-align:end; }
.js-origin { display:block; color:var(--js-violet); font-size:10px; }
.js-actions { display:flex; gap:5px; margin-top:10px; }
.js-actions button { height:28px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-raised); color:var(--js-muted); }
.js-actions button:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-actions .js-danger { margin-inline-start:auto; border-color:rgba(239,116,116,.5); color:var(--js-error); }
.js-problems { grid-column:3/5; grid-row:2; min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; border-top:1px solid var(--js-line); background:var(--js-chrome); }
.js-problems-head { height:31px; flex:0 0 auto; display:flex; align-items:center; border-bottom:1px solid var(--js-line); padding:0 9px; }
.js-problems-tab { border-bottom:2px solid var(--js-accent)!important; border-radius:0!important; color:var(--js-text)!important; }
.js-count { margin-inline-start:5px; border:1px solid var(--js-line); border-radius:8px; padding:1px 5px; font-size:10px; }
.js-problem-list { min-height:0; overflow:auto; }
.js-problem { width:100%; min-height:30px; display:grid; grid-template-columns:24px minmax(0,1fr) auto; align-items:center; border:0; border-bottom:1px solid rgba(60,66,72,.5); padding:0 10px; background:transparent; color:var(--js-muted); text-align:start; }
.js-problem:hover { background:rgba(255,255,255,.025); color:var(--js-text); }
.js-problem-error { color:var(--js-error); }
.js-problem-warning { color:var(--js-warn); }
.js-location { color:var(--js-quiet); font:11px/1.3 Consolas,monospace; }
.js-status { gap:13px; padding:0 8px; background:var(--js-accent); color:#081114; font-size:11px; }
.js-status button { height:22px; display:flex; gap:9px; padding:0 2px; color:inherit; }
.js-status button:hover { background:rgba(255,255,255,.2); }
.js-graph { display:flex; flex-direction:column; padding:0; background:var(--js-canvas); }
.js-graph-toolbar { height:40px; flex:0 0 auto; display:flex; align-items:center; gap:5px; border-bottom:1px solid var(--js-line); padding:0 9px; background:var(--js-chrome); }
.js-graph-toolbar button { height:27px; border:1px solid transparent; border-radius:3px; padding:0 8px; background:transparent; color:var(--js-muted); }
.js-graph-toolbar button:hover { border-color:var(--js-line); background:var(--js-raised); color:var(--js-text); }
.js-graph-toolbar span { margin-inline-start:auto; color:var(--js-muted); font:11px/1 Consolas,monospace; }
.js-graph-canvas { width:100%; height:0; min-width:0; min-height:0; flex:1 1 0; display:block; contain:layout paint; cursor:grab; touch-action:none; background-color:var(--js-canvas); background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px); background-size:24px 24px; }
.js-graph-canvas.js-panning { cursor:grabbing; }
.js-graph-canvas.js-node-dragging { cursor:move; }
.js-edge-group { color:var(--js-quiet); }
.js-edge { fill:none; stroke:currentColor; stroke-width:1.5; }
.js-edge-label { fill:var(--js-muted); stroke:var(--js-canvas); stroke-width:3px; paint-order:stroke; font-size:9px; }
.js-edge-inheritance { color:var(--js-violet); }
.js-edge-relation { color:var(--js-ok); }
.js-edge-relation-qualifier { color:var(--js-warn); }
.js-edge-root,.js-edge-import { color:var(--js-accent); }
.js-node rect { fill:var(--js-panel); stroke:var(--js-line-strong); stroke-width:1.5; rx:3; }
.js-node text { fill:var(--js-text); font-size:12px; pointer-events:none; }
.js-node .js-node-meta { fill:var(--js-muted); font-size:9px; }
.js-node[role="button"] { cursor:pointer; }
.js-node[role="button"]:focus-visible rect,.js-node[aria-current="true"] rect { stroke:var(--js-focus); stroke-width:2.5; }
.js-node[data-graph-pinned="true"] rect { stroke:var(--js-accent); stroke-width:2; }
.js-node[data-graph-pinned="true"] .js-node-meta { fill:var(--js-accent-strong); }
.js-node-namespace rect { fill:var(--js-chrome); stroke-dasharray:3 2; }
.js-node-document rect { stroke:var(--js-focus); }
.js-status-external { color:var(--js-accent); }
.js-status-unresolved { color:var(--js-error); }
.js-status-unresolved .js-edge { stroke-dasharray:7 4; }
.js-status-indeterminate { color:var(--js-warn); }
.js-status-indeterminate .js-edge { stroke-dasharray:2 4; }
.js-minimap>rect:first-child { fill:rgba(29,32,35,.96); stroke:var(--js-line-strong); }
.js-minimap rect:not([data-minimap]) { fill:rgba(89,182,214,.35); stroke:none; pointer-events:none; }
.js-minimap .js-minimap-viewport { fill:rgba(242,207,114,.06); stroke:var(--js-focus); stroke-width:1; }
.js-source-view { overflow:hidden; padding:0; }
.js-source { width:100%; height:100%; min-height:220px; }
.js-analysis-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:24px; }
.js-analysis-row { display:flex; justify-content:space-between; gap:16px; border-bottom:1px solid var(--js-line); padding:8px 0; }
.js-section-head [role="group"] { display:flex; overflow:hidden; border:1px solid var(--js-line); border-radius:3px; }
.js-section-head [role="group"] button { height:26px; border:0; border-inline-end:1px solid var(--js-line); padding:0 7px; background:transparent; color:var(--js-muted); }
.js-section-head [role="group"] button[aria-pressed="true"] { background:var(--js-accent); color:#081114; }
.js-instance-label { display:grid; gap:8px; }
.js-instance-label textarea { min-height:240px; resize:vertical; border:1px solid var(--js-line); padding:12px; background:var(--js-panel); font-family:Consolas,monospace; }
.js-conversion-sheet { width:min(1100px,100%); }
.js-conversion-sheet>.js-type-head>button { align-self:start; height:28px; border:1px solid var(--js-line); border-radius:3px; padding:0 9px; background:var(--js-raised); color:var(--js-muted); }
.js-conversion-layout { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr); gap:20px; margin-top:20px; }
.js-conversion-group+ .js-conversion-group { margin-top:20px; }
.js-conversion-group>h2 { margin:0 0 8px; color:var(--js-muted); font-size:12px; font-weight:600; text-transform:uppercase; }
.js-conversion-tiles { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.js-conversion-tile { min-width:0; min-height:96px; display:grid; grid-template-columns:44px minmax(0,1fr); gap:10px; align-items:start; border:1px solid var(--js-line); border-radius:4px; padding:11px; background:var(--js-panel); color:var(--js-muted); text-align:start; }
.js-conversion-tile:hover { border-color:var(--js-line-strong); background:var(--js-raised); color:var(--js-text); }
.js-conversion-tile[aria-pressed="true"] { border-color:var(--js-accent); background:rgba(89,182,214,.09); box-shadow:inset 2px 0 var(--js-accent); color:var(--js-text); }
.js-format-icon { width:42px; height:42px; display:grid; place-items:center; border:1px solid var(--js-line-strong); border-radius:3px; color:var(--js-accent-strong); font:700 11px/1 Consolas,monospace; }
.js-conversion-tile-copy { min-width:0; display:grid; gap:3px; }
.js-conversion-tile-copy strong { overflow:hidden; display:-webkit-box; color:var(--js-text); line-height:1.3; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.js-conversion-tile-copy>span { line-height:1.35; }
.js-conversion-tile-copy small { margin-top:4px; overflow:hidden; color:var(--js-quiet); font:10px/1.3 Consolas,monospace; text-overflow:ellipsis; white-space:nowrap; }
.js-conversion-config { align-self:start; position:sticky; top:0; border:1px solid var(--js-line); border-radius:4px; padding:14px; background:var(--js-chrome); }
.js-conversion-route { display:grid; grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr); gap:6px; align-items:center; }
.js-conversion-route>div { min-width:0; border:1px solid var(--js-line); padding:9px; background:var(--js-panel); }
.js-conversion-route span,.js-conversion-route strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-conversion-route>div>span { color:var(--js-quiet); font-size:10px; text-transform:uppercase; }
.js-conversion-route strong { margin-top:3px; }
.js-conversion-arrow { color:var(--js-accent)!important; text-align:center; }
.js-conversion-config fieldset { display:grid; gap:9px; margin:14px 0; padding:10px; }
.js-conversion-config fieldset>label { min-width:0; display:grid; grid-template-columns:18px minmax(0,1fr); gap:5px 7px; align-items:start; margin:0; color:var(--js-muted); }
.js-conversion-config fieldset>label:not(:has(input[type="checkbox"])) { grid-template-columns:1fr; }
.js-option-name { min-width:0; line-height:1.35; }
.js-conversion-config fieldset>label>input:not([type="checkbox"]),.js-conversion-config fieldset>label>select { width:100%; margin:0; }
.js-conversion-config fieldset>label>.js-description { grid-column:1/-1; margin:0; color:var(--js-quiet); font-size:11px; line-height:1.35; }
.js-conversion-config .js-primary { width:100%; min-height:32px; border:1px solid var(--js-accent); border-radius:3px; background:var(--js-accent); color:#081114; font-weight:650; }
.js-conversion-loading { margin-top:20px; border:1px dashed var(--js-line); padding:24px; color:var(--js-muted); text-align:center; }
.js-library-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:10px 0; }
.js-library-form label { display:grid; gap:5px; color:var(--js-muted); }
.js-library-form input,.js-library-form select,.js-sheet select,.js-sheet input,.js-sheet textarea { min-height:32px; border:1px solid var(--js-line); border-radius:3px; padding:6px 8px; background:var(--js-canvas); }
.js-library-entry,.js-resolution { margin:14px 0; border:1px solid var(--js-line); padding:12px; background:var(--js-chrome); }
.js-resolution dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:5px 12px; }
.js-resolution dt { color:var(--js-muted); }
.js-resolution dd { margin:0; overflow-wrap:anywhere; }
.js-sheet fieldset { margin:14px 0; border:1px solid var(--js-line); }
.js-sheet fieldset>label { display:block; margin:7px 0; }
.js-sheet section>button,.js-sheet fieldset>button,.js-library-entry button { min-height:30px; margin:6px 6px 0 0; border:1px solid var(--js-line); border-radius:3px; padding:0 10px; background:var(--js-raised); }
.js-inline-editor { margin:0 0 16px; border:1px solid var(--js-accent); border-inline-start:4px solid var(--js-accent); padding:14px 16px; background:var(--js-chrome); }
.js-inline-editor header { display:flex; align-items:flex-start; gap:12px; }
.js-inline-editor header>div { min-width:0; flex:1; }
.js-inline-editor h2 { margin:2px 0 0; font-size:16px; }
.js-inline-editor label { display:block; margin-top:10px; color:var(--js-muted); }
.js-inline-editor input,.js-inline-editor textarea { width:100%; display:block; margin-top:5px; }
.js-inline-editor textarea { min-height:88px; resize:vertical; font-family:Consolas,monospace; }
.js-inline-editor .js-actions { justify-content:flex-end; }
.js-inline-close { width:30px; height:30px; border:1px solid var(--js-line); border-radius:3px; background:var(--js-panel); font-size:20px; }
.js-command-palette { position:absolute; z-index:20; inset:46px auto auto 50%; width:min(620px,calc(100% - 32px)); transform:translateX(-50%); border:1px solid var(--js-line); padding:7px; background:var(--js-chrome); box-shadow:0 12px 32px rgba(0,0,0,.45); }
.js-command-palette form,.js-command-palette select { width:100%; }
.js-command-palette select { min-height:300px; border:0; padding:4px; background:var(--js-panel); }
.js-command-palette option { padding:5px 8px; }
.js-dialog { pointer-events:none; }
.js-dialog-card { position:relative; z-index:1; pointer-events:auto; }
.js-mobile-toggle { display:none; }
@media (max-width:1120px) {
  :host,.json-structure-editor { --js-sidebar:205px; --js-inspector:250px; }
  .js-workbench { position:relative; grid-template-columns:46px var(--js-sidebar) minmax(0,1fr); }
  .js-center { grid-column:3; }
  .js-problems { grid-column:3; }
  .js-inspector:not(.js-drawer-open) { display:none; }
  .js-inspector.js-drawer-open { position:absolute; z-index:12; inset-block:0; inset-inline-end:0; width:min(340px,90%); display:block; box-shadow:-8px 0 24px rgba(0,0,0,.45); }
  .js-document-toolbar>[data-mobile-drawer="inspector"] { display:inline-flex; align-items:center; }
  .js-row { grid-template-columns:minmax(100px,1fr) minmax(110px,1.1fr) 70px minmax(95px,1fr) 32px; }
  .js-view { padding-inline:18px; }
}
@media (max-width:860px) {
  .js-document-toolbar { padding-inline:8px; }
  .js-mobile-toggle { display:inline-flex!important; align-items:center; }
  .js-workbench { position:relative; grid-template-columns:46px minmax(0,1fr); }
  .js-activity { grid-column:1; }
  .js-center { grid-column:2; }
  .js-problems { grid-column:2; }
  .js-outline:not(.js-drawer-open),.js-inspector:not(.js-drawer-open) { display:none; }
  .js-outline.js-drawer-open,.js-inspector.js-drawer-open { position:absolute; z-index:12; inset-block:0; width:min(340px,90%); display:flex; box-shadow:8px 0 24px rgba(0,0,0,.45); }
  .js-outline.js-drawer-open { inset-inline-start:46px; }
  .js-inspector.js-drawer-open { inset-inline-end:0; }
  .js-analysis-grid { grid-template-columns:1fr; }
  .js-conversion-layout { grid-template-columns:1fr; }
  .js-conversion-config { position:static; }
  .js-theme-label,.js-document-toolbar>.js-chip { display:none; }
  .js-row { grid-template-columns:minmax(90px,1fr) minmax(90px,1fr) 70px 32px; }
  .js-row .js-description-cell { display:none; }
}
@media (max-width:620px) {
  .js-shell { min-width:0; grid-template-rows:34px 40px minmax(0,1fr) 22px; }
  .js-title strong { display:none; }
  .js-file { margin-inline-start:0; }
  .js-document-toolbar>button:not(.js-mobile-toggle),.js-document-toolbar>.js-spacer { display:none; }
  .js-document-toolbar .js-tabs { margin-inline:auto; }
  .js-workbench { grid-template-columns:minmax(0,1fr); }
  .js-activity { display:none; }
  .js-center,.js-problems { grid-column:1; }
  .js-outline.js-drawer-open { inset-inline-start:0; }
  .js-editor-tab { width:70%; }
  .js-breadcrumbs { font-size:12px; }
  .js-view { padding:14px 12px 48px; }
  .js-type-head { display:block; }
  .js-type-head>.js-chip { margin-top:10px; }
  .js-row { grid-template-columns:minmax(80px,1fr) minmax(80px,1fr) 32px; }
  .js-row .js-description-cell,.js-row .js-required,.js-row .js-optional,.js-row.js-header .js-cell:nth-child(3) { display:none; }
  .js-library-form,.js-resolution dl { grid-template-columns:1fr; }
  .js-conversion-tiles { grid-template-columns:1fr; }
  .js-empty-actions { width:min(240px,100%); flex-direction:column; }
  .js-empty-actions button { width:100%; }
}
@media (prefers-reduced-motion:reduce) { .js-workbench { transition:none; } }
`;
