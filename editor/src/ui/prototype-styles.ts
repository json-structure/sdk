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
  --js-quiet:#a1aab2;
  --js-accent:#59b6d6;
  --js-accent-strong:#85d8f3;
  --js-ok:#63c08a;
  --js-warn:#e6b85c;
  --js-error:#ef7474;
  --js-violet:#b99bea;
  --js-focus:#f2cf72;
  --js-on-accent:#071115;
  --js-hover:rgba(255,255,255,.045);
  --js-selected:rgba(89,182,214,.11);
  --js-grid-surface:rgba(36,40,44,.82);
  --js-subtle-line:rgba(60,66,72,.55);
  --js-canvas-grid:rgba(255,255,255,.025);
  --js-minimap-bg:rgba(29,32,35,.96);
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
  --js-quiet:#606f73;
  --js-accent:#00647b;
  --js-accent-strong:#005d75;
  --js-ok:#237a48;
  --js-warn:#8a5700;
  --js-error:#b42318;
  --js-violet:#7256a8;
  --js-focus:#9b6300;
  --js-on-accent:#fff;
  --js-hover:rgba(24,33,36,.06);
  --js-selected:rgba(0,100,123,.12);
  --js-grid-surface:#fff;
  --js-subtle-line:rgba(76,91,96,.3);
  --js-canvas-grid:rgba(24,33,36,.055);
  --js-minimap-bg:rgba(240,242,242,.97);
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
  --js-on-accent:#000;
  --js-hover:#222;
  --js-selected:#202020;
  --js-grid-surface:#000;
  --js-subtle-line:#fff;
  --js-canvas-grid:#444;
  --js-minimap-bg:#000;
}
.json-structure-editor * { box-sizing:border-box; letter-spacing:0; }
.json-structure-editor [hidden] { display:none!important; }
.json-structure-editor button,.json-structure-editor input,.json-structure-editor select,.json-structure-editor textarea { color:inherit; font:inherit; }
.json-structure-editor button { cursor:pointer; }
.json-structure-editor button:disabled { cursor:default; opacity:.45; }
.json-structure-editor button:focus-visible,.json-structure-editor input:focus-visible,.json-structure-editor select:focus-visible,.json-structure-editor textarea:focus-visible,.json-structure-editor [tabindex]:focus-visible { outline:2px solid var(--js-focus); outline-offset:-2px; }
.js-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.js-spacer { flex:1; }
.js-shell { height:100%; min-height:0; display:grid; grid-template-rows:44px 36px minmax(0,1fr) 22px; overflow:hidden; background:var(--js-bg); }
.js-shell.js-chrome-integrated { grid-template-rows:35px 36px minmax(0,1fr) 22px; }
.js-shell.js-chrome-embedded { grid-template-rows:36px minmax(0,1fr) 22px; }
.js-titlebar { position:relative; min-width:0; height:35px; border-bottom:1px solid var(--js-line); background:var(--js-chrome); color:var(--js-text); user-select:none; -webkit-app-region:drag; }
.js-titlebar-drag { position:absolute; inset-block:0; inset-inline:0 138px; display:grid; grid-template-columns:auto minmax(120px,520px) 1fr; align-items:center; gap:8px; min-width:0; padding-inline:6px; -webkit-app-region:drag; }
.js-titlebar-icon { width:22px; height:22px; display:grid; place-items:center; -webkit-app-region:drag; }
.js-titlebar-icon .js-product-logo { width:18px; height:18px; }
.js-menubar { display:flex; align-self:stretch; align-items:center; gap:0; -webkit-app-region:no-drag; }
.js-app-menu { position:relative; height:100%; }
.js-app-menu>summary { height:100%; display:flex; align-items:center; padding:0 7px; color:var(--js-muted); cursor:default; list-style:none; }
.js-app-menu>summary::-webkit-details-marker { display:none; }
.js-app-menu>summary:hover,.js-app-menu[open]>summary { background:var(--js-raised); color:var(--js-text); }
.js-app-menu-popup { position:absolute; z-index:30; inset-block-start:34px; inset-inline-start:0; width:max-content; min-width:240px; padding:4px; border:1px solid var(--js-line-strong); border-radius:4px; background:var(--js-panel); box-shadow:0 8px 24px rgba(0,0,0,.35); }
.js-app-menu-popup button { width:100%; min-height:28px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:24px; align-items:center; border:0; border-radius:3px; padding:0 8px; background:transparent; color:var(--js-text); text-align:start; }
.js-app-menu-popup button:hover,.js-app-menu-popup button:focus-visible { background:var(--js-selected); }
.js-app-menu-popup kbd { color:var(--js-quiet); font:11px/1 Consolas,"Cascadia Code",monospace; }
.js-app-menu-popup hr { height:1px; margin:4px 6px; border:0; background:var(--js-line); }
.js-command-center { width:min(520px,72vw); min-width:0; height:24px; justify-self:center; display:flex; align-items:center; justify-content:center; gap:7px; border:1px solid var(--js-line); border-radius:4px; padding:0 10px; background:var(--js-panel); color:var(--js-muted); -webkit-app-region:no-drag; }
.js-command-center:hover { border-color:var(--js-line-strong); background:var(--js-raised); color:var(--js-text); }
.js-command-center span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-command-center .js-icon { width:14px; height:14px; }
.js-title,.js-document-toolbar,.js-status { display:flex; align-items:center; background:var(--js-chrome); }
.js-title { min-width:0; padding:0 10px; gap:9px; border-bottom:1px solid var(--js-line); user-select:none; }
.js-product-logo { width:24px; height:24px; flex:0 0 auto; }
.js-empty-logo { width:88px; height:82px; margin-bottom:12px; }
.js-title strong { font-weight:650; }
.js-file { min-width:0; margin-inline:auto; overflow:hidden; color:var(--js-muted); text-overflow:ellipsis; white-space:nowrap; }
.js-command-trigger { width:44px; height:44px; flex:0 0 44px; border:1px solid transparent; border-radius:3px; background:transparent; color:var(--js-muted); font:11px/1 Consolas,monospace; }
.js-command-trigger:hover { border-color:var(--js-line); background:var(--js-raised); color:var(--js-text); }
.js-icon { width:18px; height:18px; display:inline-block; flex:0 0 auto; fill:currentColor; vertical-align:middle; }
.js-chevron { width:14px; height:14px; }
.js-icon-down { transform:rotate(180deg); }
.js-command-trigger,.js-activity-button,.js-panel-head button,.js-problems-head button,.js-graph-toolbar button,.js-catalog-head button { display:inline-flex; align-items:center; justify-content:center; }
.js-theme-label { display:flex; align-items:center; }
.js-theme { width:112px; height:26px; border:1px solid var(--js-line); border-radius:3px; padding:0 5px; background:var(--js-panel); color:var(--js-muted); }
.js-document-toolbar { min-width:0; padding:0 8px 0 52px; gap:5px; border-bottom:1px solid var(--js-line); }
.js-document-toolbar>button,.js-tabs button,.js-panel-head button,.js-problems-head button,.js-status button { height:26px; border:1px solid transparent; border-radius:3px; padding:0 8px; background:transparent; color:var(--js-muted); }
.js-document-toolbar>button { display:inline-flex; align-items:center; gap:5px; }
.js-document-toolbar>button:hover,.js-panel-head button:hover,.js-problems-head button:hover { border-color:var(--js-line); background:var(--js-raised); color:var(--js-text); }
.js-tabs { display:flex; overflow:hidden; border:1px solid var(--js-line); border-radius:4px; }
.js-tabs button { border:0; border-inline-end:1px solid var(--js-line); border-radius:0; padding:0 10px; }
.js-tabs button:last-child { border-inline-end:0; }
.js-tabs button[aria-selected="true"] { background:var(--js-raised); color:var(--js-text); box-shadow:inset 0 -2px var(--js-accent); }
.js-chip { display:inline-flex; align-items:center; min-height:22px; border:1px solid var(--js-line); border-radius:3px; padding:0 7px; background:var(--js-panel); color:var(--js-muted); font:11px/1.3 Consolas,"Cascadia Code",monospace; }
.js-workbench { min-width:0; min-height:0; display:grid; grid-template-columns:var(--js-rail) var(--js-sidebar) minmax(360px,1fr) var(--js-inspector); grid-template-rows:minmax(0,1fr) 31px; transition:grid-template-rows 120ms ease; }
.js-workbench[data-problems-open="true"] { grid-template-rows:minmax(0,1fr) 174px; }
.js-activity { grid-column:1; grid-row:1/3; display:flex; flex-direction:column; align-items:stretch; padding-top:4px; border-inline-end:1px solid var(--js-line); background:var(--js-chrome); }
.js-activity-button { width:45px; height:43px; border:0; border-inline-start:2px solid transparent; background:transparent; color:var(--js-quiet); }
.js-activity-button .js-icon { width:22px; height:22px; }
.js-activity-button:hover { color:var(--js-text); }
.js-activity-button[aria-pressed="true"],.js-activity-primary[aria-expanded="true"] { border-inline-start-color:var(--js-accent); background:var(--js-selected); color:var(--js-text); }
.js-outline { grid-column:2; grid-row:1/3; min-width:0; display:flex; flex-direction:column; overflow:hidden; border-inline-end:1px solid var(--js-line); background:var(--js-chrome); }
.js-panel-head { height:34px; flex:0 0 auto; display:flex; align-items:center; padding:0 9px; border-bottom:1px solid var(--js-line); color:var(--js-muted); font-size:11px; text-transform:uppercase; }
.js-panel-head span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-panel-head button { width:26px; margin-inline-start:auto; padding:0; font-size:16px; }
.js-panel-head .js-spacer+button { margin-inline-start:0; }
.js-drawer-close { display:none; }
.js-filter { width:calc(100% - 16px); height:28px; margin:8px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-canvas); }
.js-tree { min-height:0; overflow:auto; padding-bottom:12px; }
.js-tree-group { padding:10px 9px 5px; color:var(--js-quiet); font-size:11px; text-transform:uppercase; }
.js-tree-item { width:100%; height:28px; display:flex; align-items:center; gap:7px; border:0; border-inline-start:2px solid transparent; padding:0 8px 0 11px; background:transparent; color:var(--js-muted); text-align:start; }
.js-tree-item:hover { background:var(--js-hover); color:var(--js-text); }
.js-tree-item[aria-current="true"] { border-inline-start-color:var(--js-accent); background:var(--js-selected); color:var(--js-text); }
.js-tree-item>span:not(.js-kind) { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-tree-item small { margin-inline-start:auto; color:var(--js-quiet); font-size:9px; }
.js-tree-item-imported { border-inline-start-style:dashed; }
.js-tree-namespace>summary { min-height:28px; display:flex; align-items:center; gap:6px; padding:0 8px; color:var(--js-muted); cursor:pointer; list-style:none; }
.js-tree-namespace>summary::-webkit-details-marker { display:none; }
.js-tree-namespace>summary:hover { background:var(--js-hover); color:var(--js-text); }
.js-tree-namespace>summary small { margin-inline-start:auto; color:var(--js-quiet); font-size:9px; }
.js-tree-namespace>summary .js-tree-chevron { width:14px; display:grid; place-items:center; transition:transform 120ms ease; }
.js-tree-namespace>summary .js-icon { width:13px; height:13px; }
.js-tree-namespace[open]>summary .js-tree-chevron { transform:rotate(90deg); }
.js-tree-namespace>[role="group"] { border-inline-start:1px solid var(--js-line); margin-inline-start:14px; }
.js-kind { width:18px; flex:0 0 auto; color:var(--js-accent); text-align:center; }
.js-kind .js-icon { width:16px; height:16px; }
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
.js-section-head>button,.js-empty-actions button,.js-add-row,.js-value-actions button { display:inline-flex; align-items:center; justify-content:center; gap:5px; }
.js-section-head>button:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-section-meta { color:var(--js-quiet); font-size:12px; }
.js-member-mode { display:flex; overflow:hidden; border:1px solid var(--js-line); border-radius:3px; }
.js-member-mode button { height:27px; border:0; border-inline-end:1px solid var(--js-line); padding:0 8px; background:transparent; color:var(--js-muted); }
.js-member-mode button:last-child { border-inline-end:0; }
.js-member-mode button[aria-pressed="true"] { background:var(--js-raised); color:var(--js-text); box-shadow:inset 0 -2px var(--js-accent); }
.js-grid { border:1px solid var(--js-line); background:var(--js-grid-surface); }
.js-row { min-height:36px; display:grid; grid-template-columns:minmax(115px,1.05fr) minmax(180px,1.45fr) 66px 66px 82px 34px; align-items:center; border-bottom:1px solid var(--js-line); }
.js-row:last-child { border-bottom:0; }
.js-row.js-header { min-height:29px; background:var(--js-panel); color:var(--js-quiet); font-size:10px; text-transform:uppercase; }
.js-row[aria-current="true"] { background:var(--js-selected); box-shadow:inset 2px 0 var(--js-accent); }
.js-effective-row[data-member-origin="inherited"] { box-shadow:inset 2px 0 var(--js-violet); }
.js-effective-row[data-member-origin="add-in"] { box-shadow:inset 2px 0 var(--js-ok); }
.js-origin-chip { display:inline-flex; margin-inline-end:5px; border:1px solid var(--js-line); border-radius:3px; padding:1px 5px; color:var(--js-muted); font:9px/1.35 Consolas,monospace; }
.js-effective-row[data-member-origin="inherited"] .js-origin-chip { border-color:var(--js-violet); color:var(--js-violet); }
.js-effective-row[data-member-origin="add-in"] .js-origin-chip { border-color:var(--js-ok); color:var(--js-ok); }
.js-effective-row small { display:block; overflow:hidden; margin-top:2px; color:var(--js-quiet); text-overflow:ellipsis; white-space:nowrap; }
.js-conflict { display:grid; grid-template-columns:minmax(100px,.3fr) minmax(0,1fr); gap:8px; margin:7px 0; border-inline-start:2px solid var(--js-warn); padding:7px 9px; background:rgba(230,184,92,.07); }
.js-conflict span { color:var(--js-muted); overflow-wrap:anywhere; }
.js-cell { min-width:0; overflow:hidden; padding:0 9px; text-overflow:ellipsis; white-space:nowrap; }
.js-property-editor[aria-current="true"]>.js-row { background:var(--js-selected); box-shadow:inset 2px 0 var(--js-accent); }
.js-inline-property-row,.js-effective-row { grid-template-areas:"name type nullable identity presence action" ". composite composite composite composite composite" ". description description description description description"; align-items:start; }
.js-inline-property-row>.js-cell:nth-child(1),.js-effective-row>.js-cell:nth-child(1) { grid-area:name; }
.js-inline-property-row>.js-cell:nth-child(2),.js-effective-row>.js-cell:nth-child(2) { grid-area:type; }
.js-inline-property-row>.js-cell:nth-child(3),.js-effective-row>.js-cell:nth-child(3) { grid-area:nullable; }
.js-inline-property-row>.js-cell:nth-child(4),.js-effective-row>.js-cell:nth-child(4) { grid-area:identity; }
.js-inline-property-row>.js-cell:nth-child(5),.js-effective-row>.js-cell:nth-child(5) { grid-area:presence; }
.js-inline-property-row>.js-cell:nth-child(6),.js-effective-row>.js-cell:nth-child(6) { grid-area:description; }
.js-inline-property-row>.js-cell:nth-child(7),.js-effective-row>.js-cell:nth-child(7) { grid-area:action; }
.js-inline-property-row>.js-cell:nth-child(8) { grid-area:composite; }
.js-inline-property-row .js-cell { padding:3px 4px; }
.js-inline-property-row input:not([type="checkbox"]),.js-inline-property-row select { width:100%; min-width:0; min-height:28px; border-color:transparent; padding:3px 6px; background:transparent; }
.js-inline-property-row input:not([type="checkbox"]):hover,.js-inline-property-row select:hover { border-color:var(--js-line); background:var(--js-canvas); }
.js-inline-property-row input:not([type="checkbox"]):focus,.js-inline-property-row select:focus { border-color:var(--js-accent); background:var(--js-canvas); }
.js-inline-description { width:100%; min-height:28px; max-height:180px; resize:none; overflow-y:auto; border-color:transparent; padding:5px 6px; background:transparent; line-height:1.4; white-space:pre-wrap; }
.js-inline-description:hover { border-color:var(--js-line); background:var(--js-canvas); }
.js-inline-description:focus { border-color:var(--js-accent); background:var(--js-canvas); }
.js-inline-required-cell label,.js-inline-nullable-cell label,.js-inline-identity-cell label { min-height:28px; display:flex; align-items:center; gap:5px; color:var(--js-muted); font-size:11px; }
.js-inline-required-cell input,.js-inline-nullable-cell input,.js-inline-identity-cell input { margin:0; }
.js-inline-type-cell { position:relative; }
.js-type-composer { display:flex; min-width:0; flex-wrap:wrap; align-items:center; gap:3px; overflow:visible; }
.js-type-member { display:inline-flex; min-width:max-content; max-width:100%; align-items:center; gap:2px; border:1px solid var(--js-line); border-radius:3px; padding-inline-start:5px; background:var(--js-panel); color:var(--js-text); font:11px/22px Consolas,monospace; }
.js-type-member>span { overflow:visible; text-overflow:clip; white-space:nowrap; }
.js-type-member button { width:20px; height:22px; border:0; padding:3px; background:transparent; color:var(--js-muted); }
.js-type-member button:hover { color:var(--js-text); }
.js-type-empty { color:var(--js-quiet); font-size:11px; }
.js-inline-type-add { flex:0 1 88px; max-width:100%; }
.js-composite-cell { display:grid; gap:4px; overflow:visible; padding:3px 4px 6px 14px!important; white-space:normal; }
.js-collection-expression { min-width:0; display:grid; grid-template-columns:auto auto minmax(0,1fr) auto; align-items:center; gap:6px; border-inline-start:2px solid var(--js-accent); padding:5px 8px; background:var(--js-chrome); }
.js-collection-kind,.js-collection-angle { color:var(--js-accent); font:600 11px/1.4 Consolas,monospace; }
.js-collection-member { min-width:0; display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:8px; }
.js-collection-member>span { color:var(--js-muted); font-size:11px; }
.js-nullable-indicator { color:var(--js-muted); font-size:11px; }
.js-identity-indicator { color:var(--js-muted); font-size:11px; }
.js-type-drop-zone { position:absolute; z-index:2; pointer-events:none; inset:2px; border:1px dashed transparent; }
.js-type-drag-active .js-type-drop-zone { pointer-events:auto; }
.js-inline-type-cell.js-type-drop-active .js-type-drop-zone { border-color:var(--js-focus); background:rgba(242,207,114,.08); }
.js-inline-type-cell.js-type-drop-active .js-type-composer { opacity:.42; }
.js-tree-item[draggable="true"] { cursor:grab; }
.js-tree-item.js-type-dragging { cursor:grabbing; opacity:.5; }
.js-property-details { border-bottom:1px solid var(--js-line); border-inline-start:2px solid var(--js-accent); padding:10px 14px 12px; background:var(--js-chrome); }
.js-property-chevron { transform:rotate(90deg); transition:transform 120ms ease; }
.js-property-chevron.js-expanded { transform:rotate(-90deg); }
.js-property-detail-columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
.js-property-detail-group { min-width:0; border:1px solid var(--js-line); background:var(--js-panel); }
.js-property-detail-group>header { min-height:30px; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--js-line); padding:0 9px; color:var(--js-muted); font-size:11px; text-transform:uppercase; }
.js-property-detail-group>header strong { font-weight:650; }
.js-property-detail-group>header span { min-width:18px; margin-inline-start:auto; color:var(--js-quiet); text-align:center; }
.js-property-detail-fields { min-width:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 10px; padding:9px; }
.js-detail-empty { grid-column:1/-1; margin:0; color:var(--js-quiet); font-size:12px; }
.js-property-details label { min-width:0; display:grid; gap:4px; margin:0; color:var(--js-muted); font-size:11px; }
.js-property-details input:not([type="checkbox"]),.js-property-details select { width:100%; min-width:0; min-height:28px; padding:3px 6px; }
.js-property-details .js-detail-check { min-height:44px; grid-template-columns:20px minmax(0,1fr); align-items:center; }
.js-detail-field { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:6px; }
.js-detail-label { display:block; margin-bottom:4px; color:var(--js-muted); font-size:11px; }
.js-structured-summary { display:block; min-height:28px; overflow:hidden; border:1px solid var(--js-line); padding:5px 6px; background:var(--js-raised); color:var(--js-text); text-overflow:ellipsis; white-space:nowrap; }
.js-detail-remove,.js-detail-add button { min-height:28px; border:1px solid var(--js-line); padding:3px 8px; background:var(--js-raised); color:var(--js-muted); }
.js-detail-add { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:6px; border-top:1px solid var(--js-line); padding:8px 9px 9px; }
.js-detail-json { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px; }
.js-detail-json button,.js-property-advanced button { min-height:44px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-raised); color:var(--js-muted); }
.js-property-advanced { margin-top:12px; border-top:1px solid var(--js-line); padding-top:8px; }
.js-property-advanced summary { min-height:44px; display:flex; align-items:center; cursor:pointer; color:var(--js-muted); }
.js-property-advanced textarea { width:100%; min-height:140px; margin-top:8px; resize:vertical; font-family:Consolas,"Cascadia Code",monospace; }
.js-inline-status { min-height:18px; margin:7px 0 0; color:var(--js-error); font-size:11px; }
.js-property-link { width:100%; height:100%; border:0; padding:0; background:transparent; color:inherit; text-align:start; }
.js-property-link:hover { color:var(--js-accent-strong); }
.js-code { font-family:Consolas,"Cascadia Code",monospace; }
.js-required { color:var(--js-ok); }
.js-optional { color:var(--js-quiet); }
.js-action-cell { align-self:stretch; padding:0; }
.js-row-action { width:100%; height:100%; border:0; padding:0; background:transparent; color:var(--js-quiet); font-size:18px; text-align:center; }
.js-row-action:hover { color:var(--js-text); background:var(--js-raised); }
.js-add-row { width:100%; height:36px; display:flex; align-items:center; gap:8px; border:0; padding:0 10px; background:transparent; color:var(--js-quiet); text-align:start; }
.js-add-row:hover { background:var(--js-hover); color:var(--js-text); }
.js-design-section { margin-top:22px; }
.js-identity-list { display:flex; flex-wrap:wrap; gap:6px; margin:0; padding:0; list-style:none; }
.js-identity-list li { display:inline-flex; align-items:center; overflow:hidden; border:1px solid var(--js-line); border-radius:3px; background:var(--js-panel); }
.js-order { min-width:25px; align-self:stretch; display:grid; place-items:center; border-inline-end:1px solid var(--js-line); background:var(--js-raised); color:var(--js-accent); font:11px/1 Consolas,monospace; }
.js-identity-list .js-code { padding:5px 8px; }
.js-relation-list { border:1px solid var(--js-line); }
.js-relation-row { width:100%; min-height:48px; display:grid; grid-template-columns:minmax(130px,1fr) auto minmax(100px,.7fr) 20px; gap:8px; align-items:center; border:0; border-bottom:1px solid var(--js-line); padding:6px 9px; background:var(--js-panel); color:var(--js-muted); text-align:start; }
.js-relation-row:last-child { border-bottom:0; }
.js-relation-row:hover { background:var(--js-raised); color:var(--js-text); }
.js-relation-row[aria-current="true"] { background:var(--js-selected); box-shadow:inset 2px 0 var(--js-accent); }
.js-relation-row strong,.js-relation-row small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-relation-row strong { color:var(--js-text); }
.js-relation-row small,.js-relation-scope { color:var(--js-quiet); font:10px/1.35 Consolas,monospace; }
.js-inline-relation-draft { display:grid; grid-template-columns:minmax(130px,.8fr) minmax(160px,1fr) 110px minmax(150px,1fr) auto; gap:7px; align-items:center; padding:8px; background:var(--js-panel); }
.js-inline-relation-draft input,.js-inline-relation-draft select { width:100%; min-width:0; min-height:30px; }
.js-inline-relation-actions { display:flex; gap:5px; }
.js-inline-relation-actions button { min-height:30px; }
.js-inline-relation-draft>.js-inline-status { grid-column:1/-1; }
.js-cardinality { display:grid; grid-template-columns:1fr 1fr; overflow:hidden; margin-top:8px; border:1px solid var(--js-line-strong); }
.js-cardinality button { min-height:30px; border:0; background:var(--js-panel); color:var(--js-muted); }
.js-cardinality button+button { border-inline-start:1px solid var(--js-line-strong); }
.js-cardinality button[aria-pressed="true"] { background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-inspector-action { width:100%; min-height:28px; margin-top:8px; border:1px solid var(--js-line); border-radius:3px; background:var(--js-raised); color:var(--js-muted); }
.js-scope-list { margin:8px 0 0; padding-inline-start:18px; color:var(--js-muted); overflow-wrap:anywhere; }
.js-value-item { display:grid; grid-template-columns:24px minmax(0,1fr) auto; gap:6px; align-items:center; min-height:34px; border-bottom:1px solid var(--js-line); }
.js-value-order { min-height:24px; display:grid; place-items:center; color:var(--js-accent); font:10px/1 Consolas,monospace; }
.js-value-actions { display:flex; gap:3px; }
.js-value-actions button { width:28px; height:26px; border:1px solid var(--js-line); border-radius:3px; background:var(--js-raised); }
.js-value-item:not(.js-value-selected) .js-value-actions { opacity:.35; }
.js-empty-state { height:100%; min-height:330px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center; }
.js-empty-state h1 { margin:6px 0; font-size:24px; font-weight:600; }
.js-empty-state p { max-width:430px; margin:0; color:var(--js-muted); line-height:1.5; }
.js-empty-actions { display:flex; gap:7px; margin-top:18px; }
.js-empty-actions button { height:30px; border:1px solid var(--js-line-strong); border-radius:3px; padding:0 13px; background:var(--js-raised); }
.js-empty-actions .js-primary { border-color:var(--js-accent); background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-empty { padding:16px; color:var(--js-muted); text-align:center; }
.js-inspector { grid-column:4; grid-row:1; min-width:0; min-height:0; overflow:auto; border-inline-start:1px solid var(--js-line); background:var(--js-chrome); }
.js-inspector>section,.js-inspector-section { padding:12px 10px; border-bottom:1px solid var(--js-line); }
.js-inspector h2 { margin:4px 0 6px; overflow-wrap:anywhere; font-size:16px; line-height:1.25; }
.js-inspector-section dl { margin:8px 0 0; }
.js-inspector-row { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:8px; border-bottom:1px solid var(--js-subtle-line); padding:5px 0; }
.js-inspector-row:last-child { border-bottom:0; }
.js-inspector-row dt { min-width:0; overflow-wrap:anywhere; color:var(--js-muted); }
.js-inspector-row dd { min-width:0; margin:0; overflow-wrap:anywhere; text-align:end; }
.js-origin { display:block; color:var(--js-violet); font-size:10px; }
.js-actions { display:flex; gap:5px; margin-top:10px; }
.js-actions button { min-height:44px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-raised); color:var(--js-muted); }
.js-actions button:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-actions .js-danger { margin-inline-start:auto; border-color:rgba(239,116,116,.5); color:var(--js-error); }
.js-problems { grid-column:3/5; grid-row:2; min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; border-top:1px solid var(--js-line); background:var(--js-chrome); }
.js-problems-head { height:31px; flex:0 0 auto; display:flex; align-items:center; border-bottom:1px solid var(--js-line); padding:0 9px; }
.js-problems-tab { border-bottom:2px solid var(--js-accent)!important; border-radius:0!important; color:var(--js-text)!important; }
.js-count { margin-inline-start:5px; border:1px solid var(--js-line); border-radius:8px; padding:1px 5px; font-size:10px; }
.js-problem-list { min-height:0; overflow:auto; }
.js-problem { width:100%; min-height:30px; display:grid; grid-template-columns:24px minmax(0,1fr) auto; align-items:center; border:0; border-bottom:1px solid rgba(60,66,72,.5); padding:0 10px; background:transparent; color:var(--js-muted); text-align:start; }
.js-problem:hover { background:var(--js-hover); color:var(--js-text); }
.js-problem-error { color:var(--js-error); }
.js-problem-warning { color:var(--js-warn); }
.js-problem-error .js-icon,.js-problem-warning .js-icon { width:16px; height:16px; }
.js-location { color:var(--js-quiet); font:11px/1.3 Consolas,monospace; }
.js-status { gap:13px; padding:0 8px; background:var(--js-accent); color:var(--js-on-accent); font-size:11px; }
.js-status button { height:22px; display:flex; gap:9px; padding:0 2px; color:inherit; }
.js-status button span { display:inline-flex; align-items:center; gap:3px; }
.js-status .js-icon { width:14px; height:14px; }
.js-status button:hover { background:rgba(255,255,255,.2); }
.js-graph { display:flex; flex-direction:column; padding:0; background:var(--js-canvas); }
.js-workbench[data-active-mode="graph"]>.js-inspector { display:none; }
.js-workbench[data-active-mode="graph"]>.js-center { grid-column:3/5; grid-template-rows:minmax(0,1fr); }
.js-workbench[data-active-mode="graph"]>.js-center>.js-editor-tab,.js-workbench[data-active-mode="graph"]>.js-center>.js-breadcrumbs { display:none; }
.js-workbench[data-active-mode="graph"]>.js-center>.js-view { grid-row:1; }
.js-workbench[data-active-mode="graph"]>.js-problems { grid-column:1/5; }
.js-workbench[data-active-mode="source"]>.js-outline,.js-workbench[data-active-mode="source"]>.js-inspector,.js-workbench[data-active-mode="instance"]>.js-outline,.js-workbench[data-active-mode="instance"]>.js-inspector,.js-workbench[data-active-mode="conversion"]>.js-outline,.js-workbench[data-active-mode="conversion"]>.js-inspector,.js-workbench[data-active-mode="analysis"]>.js-outline,.js-workbench[data-active-mode="analysis"]>.js-inspector { display:none; }
.js-workbench[data-active-mode="source"]>.js-center,.js-workbench[data-active-mode="instance"]>.js-center,.js-workbench[data-active-mode="conversion"]>.js-center,.js-workbench[data-active-mode="analysis"]>.js-center { grid-column:2/5; }
.js-graph-toolbar { min-height:40px; flex:0 0 auto; display:flex; flex-wrap:wrap; align-items:center; gap:5px; border-bottom:1px solid var(--js-line); padding:5px 9px; background:var(--js-chrome); }
.js-graph-toolbar button { height:27px; border:1px solid transparent; border-radius:3px; padding:0 8px; background:transparent; color:var(--js-muted); }
.js-graph-toolbar button .js-icon { width:16px; height:16px; }
.js-graph-toolbar button:hover { border-color:var(--js-line); background:var(--js-raised); color:var(--js-text); }
.js-graph-toolbar [data-semantic-zoom] { min-width:94px; color:var(--js-muted); text-align:center; font:11px/1 Consolas,monospace; }
.js-graph-divider { width:1px; height:20px; margin:0 4px; background:var(--js-line); }
.js-graph-toolbar .js-graph-crumbs { flex:0 1 auto; }
.js-graph-toolbar .js-graph-search { width:220px; }
.js-graph-workspace { min-width:0; min-height:0; flex:1 1 0; display:grid; grid-template-columns:minmax(470px,1fr) 286px; }
.js-graph-navigator,.js-graph-inspector { min-width:0; min-height:0; overflow:auto; background:var(--js-chrome); font-size:11px; }
.js-graph-navigator { border-inline-end:1px solid var(--js-line); }
.js-graph-inspector { border-inline-start:1px solid var(--js-line); }
.js-graph-panel-title { min-height:30px; display:flex; align-items:center; padding:0 9px; border-bottom:1px solid var(--js-line); color:var(--js-muted); font-size:9px; letter-spacing:.07em; text-transform:uppercase; }
.js-graph-panel-title span { margin-inline-start:auto; color:var(--js-quiet); letter-spacing:0; }
.js-graph-panel-section { padding:8px 9px; border-bottom:1px solid var(--js-line); }
.js-graph-level-step { display:grid; grid-template-columns:20px minmax(0,1fr); gap:6px; border-inline-start:2px solid var(--js-line); padding:5px 4px; color:var(--js-quiet); }
.js-graph-level-step.js-complete { border-inline-start-color:var(--js-accent); color:var(--js-muted); }
.js-graph-level-step.js-active { border-inline-start-color:var(--js-focus); background:rgba(242,207,114,.06); color:var(--js-text); }
.js-graph-level-step>span { font:9px/1.3 Consolas,monospace; }
.js-graph-level-step strong,.js-graph-level-step small { display:block; }
.js-graph-level-step strong { font-size:10px; }
.js-graph-level-step small { margin-top:2px; color:var(--js-quiet); }
.js-graph-history { display:grid; padding:4px; }
.js-graph-history button { min-width:0; min-height:27px; display:grid; grid-template-columns:12px minmax(0,1fr) auto; align-items:center; gap:5px; border:0; padding:0 5px; background:transparent; color:var(--js-muted); text-align:start; }
.js-graph-history button:hover,.js-graph-history button[aria-current="true"] { background:var(--js-hover); color:var(--js-text); }
.js-graph-history button>span:nth-child(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-history-dot { width:6px; height:6px; border:1px solid var(--js-accent); transform:rotate(45deg); }
.js-graph-history small,.js-graph-instructions kbd { color:var(--js-quiet); font:9px/1 Consolas,monospace; }
.js-graph-instructions { display:grid; gap:8px; }
.js-graph-instructions span { display:flex; justify-content:space-between; gap:8px; }
.js-graph-viewport { position:relative; min-width:0; min-height:0; overflow:hidden; background:var(--js-canvas); }
.js-graph-viewport>.js-graph-canvas { width:100%; height:100%; }
.js-graph-level-banner { position:absolute; z-index:2; inset-block-start:13px; inset-inline-start:14px; display:grid; pointer-events:none; }
.js-graph-level-banner>span { color:var(--js-accent); font:10px/1.3 Consolas,monospace; text-transform:uppercase; }
.js-graph-level-banner>strong { margin-top:3px; font-size:20px; }
.js-graph-level-banner>small { color:var(--js-muted); font-size:11px; }
.js-graph-lenses { position:static; flex:0 0 auto; margin-inline-start:6px; background:var(--js-panel); }
.js-graph-command-bar { position:absolute; z-index:3; inset-block-start:47px; inset-inline-end:12px; display:flex; gap:4px; }
.js-graph-command-bar button { height:26px; border:1px solid var(--js-line); border-radius:3px; padding:0 7px; background:rgba(28,32,35,.96); color:var(--js-muted); font-size:9px; }
.js-graph-command-bar button:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-graph-hint { position:absolute; z-index:2; inset-inline-start:50%; inset-block-end:15px; transform:translateX(-50%); max-width:70%; border:1px solid var(--js-line); border-radius:3px; padding:6px 9px; background:rgba(28,32,35,.94); color:var(--js-muted); font-size:11px; pointer-events:none; text-align:center; }
.js-minimap-wrap { position:absolute; z-index:3; inset-inline-end:12px; inset-block-end:12px; width:190px; border:1px solid var(--js-line-strong); border-radius:3px; padding:8px; background:rgba(28,32,35,.96); }
.js-minimap-head { display:flex; justify-content:space-between; margin-bottom:5px; color:var(--js-muted); font-size:10px; }
.js-minimap { width:172px; height:92px; display:block; background:var(--js-minimap-bg); cursor:crosshair; touch-action:none; }
.js-graph-inspector>header { padding:10px; border-bottom:1px solid var(--js-line); }
.js-graph-inspector>header>span { color:var(--js-accent); font:9px/1.3 Consolas,monospace; text-transform:uppercase; }
.js-graph-inspector h2 { margin:3px 0; overflow-wrap:anywhere; font-size:15px; }
.js-graph-inspector p { margin:0; color:var(--js-muted); line-height:1.35; }
.js-graph-metrics { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
.js-graph-metrics div { min-width:0; border:1px solid var(--js-line); padding:6px; background:var(--js-panel); }
.js-graph-metrics strong,.js-graph-metrics span { display:block; }
.js-graph-metrics strong { font:600 13px/1.2 Consolas,monospace; }
.js-graph-metrics span { color:var(--js-quiet); font-size:9px; }
.js-graph-related { max-height:260px; overflow:auto; padding:0 9px; }
.js-graph-related button { width:100%; min-height:42px; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:5px; border:0; border-bottom:1px solid var(--js-subtle-line); padding:4px 2px; background:transparent; color:var(--js-muted); text-align:start; }
.js-graph-related button:hover { background:var(--js-hover); color:var(--js-text); }
.js-graph-related strong,.js-graph-related small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-graph-related em { color:var(--js-violet); font-size:9px; font-style:normal; }
.js-graph-inspector-actions button { width:100%; min-height:30px; border:1px solid var(--js-accent); background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-graph-context { min-height:58px; display:grid; grid-template-columns:minmax(180px,1fr) minmax(160px,240px) auto; gap:12px; align-items:center; border-bottom:1px solid var(--js-line); padding:6px 9px; background:var(--js-chrome); }
.js-graph-location { min-width:0; display:grid; grid-template-columns:minmax(0,1fr); }
.js-graph-location>strong,.js-graph-location>span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-graph-location>strong { font-size:13px; }
.js-graph-location>span { color:var(--js-quiet); font-size:11px; }
.js-graph-crumbs { min-width:0; display:flex; align-items:center; gap:3px; overflow:hidden; color:var(--js-quiet); }
.js-graph-crumbs button { border:0; padding:1px 3px; background:transparent; color:var(--js-muted); font-size:10px; }
.js-graph-crumbs button:hover,.js-graph-crumbs button[aria-current="page"] { color:var(--js-text); }
.js-graph-search input { width:100%; height:28px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-canvas); }
.js-graph-lenses { display:flex; overflow:hidden; border:1px solid var(--js-line); border-radius:3px; }
.js-graph-lenses button { height:27px; border:0; border-inline-end:1px solid var(--js-line); padding:0 7px; background:transparent; color:var(--js-muted); font-size:10px; }
.js-graph-lenses button:last-child { border-inline-end:0; }
.js-graph-lenses button[aria-pressed="true"] { background:var(--js-raised); color:var(--js-text); box-shadow:inset 0 -2px var(--js-accent); }
.js-graph-canvas { width:100%; height:0; min-width:0; min-height:0; flex:1 1 0; display:block; contain:layout paint; cursor:grab; touch-action:none; background-color:var(--js-canvas); background-image:linear-gradient(var(--js-canvas-grid) 1px,transparent 1px),linear-gradient(90deg,var(--js-canvas-grid) 1px,transparent 1px); background-size:24px 24px; }
.js-graph-canvas.js-panning { cursor:grabbing; }
.js-graph-canvas.js-node-dragging { cursor:move; }
.js-node[data-graph-pinned="false"] { cursor:grab; }
.js-node[data-graph-pinned="true"],.js-graph-canvas.js-node-dragging .js-node { cursor:grabbing; }
.js-edge-group { color:var(--js-quiet); }
.js-edge { fill:none; stroke:currentColor; stroke-width:1.5; }
.js-edge-label { fill:var(--js-muted); stroke:var(--js-canvas); stroke-width:3px; paint-order:stroke; font-size:9px; }
.js-edge-group[role="button"] { cursor:pointer; }
.js-edge-group[role="button"]:focus-visible .js-edge,.js-edge-group[aria-current="true"] .js-edge { stroke:var(--js-focus); stroke-width:2.5; }
.js-edge-group[aria-current="true"] .js-edge-label { fill:var(--js-focus); }
.js-edge-inheritance { color:var(--js-violet); }
.js-edge-relation { color:var(--js-ok); }
.js-edge-relation-qualifier { color:var(--js-warn); }
.js-edge-root,.js-edge-import { color:var(--js-accent); }
.js-node .js-node-shape { fill:var(--js-panel); stroke:var(--js-line-strong); stroke-width:1.5; rx:3; }
.js-node .js-node-hit-target { fill:transparent; stroke:transparent; stroke-width:44; pointer-events:all; vector-effect:non-scaling-stroke; }
.js-node text { fill:var(--js-text); font-size:12px; pointer-events:none; }
.js-node .js-node-meta { fill:var(--js-muted); font-size:9px; }
.js-node[role="button"] { cursor:pointer; }
.js-node[role="button"]:focus-visible .js-node-shape,.js-node[aria-current="true"] .js-node-shape { stroke:var(--js-focus); stroke-width:2.5; }
.js-node[data-search-match="true"] .js-node-shape { stroke:var(--js-accent-strong); stroke-width:2.5; filter:drop-shadow(0 0 5px rgba(89,182,214,.42)); }
.js-graph-canvas[data-search-active="true"] .js-node[data-search-match="false"] { opacity:.18; }
.js-node[data-graph-pinned="true"] .js-node-shape { stroke:var(--js-accent); stroke-width:2; }
.js-node[data-graph-pinned="true"] .js-node-meta { fill:var(--js-accent-strong); }
.js-node-namespace .js-node-shape { fill:var(--js-chrome); stroke-dasharray:3 2; }
.js-node-document .js-node-shape { stroke:var(--js-focus); }
.js-status-external { color:var(--js-accent); }
.js-status-unresolved { color:var(--js-error); }
.js-status-unresolved .js-edge { stroke-dasharray:7 4; }
.js-status-indeterminate { color:var(--js-warn); }
.js-status-indeterminate .js-edge { stroke-dasharray:2 4; }
.js-minimap>rect:first-child { fill:var(--js-minimap-bg); stroke:var(--js-line-strong); }
.js-minimap rect:not([data-minimap]) { fill:rgba(89,182,214,.35); stroke:none; pointer-events:none; }
.js-minimap .js-minimap-viewport { fill:rgba(242,207,114,.06); stroke:var(--js-focus); stroke-width:1; }
.js-source-view { overflow:hidden; padding:0; }
.js-source { width:100%; height:100%; min-height:220px; }
.js-analysis-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:24px; }
.js-analysis-row { display:flex; justify-content:space-between; gap:16px; border-bottom:1px solid var(--js-line); padding:8px 0; }
.js-section-head [role="group"] { display:flex; overflow:hidden; border:1px solid var(--js-line); border-radius:3px; }
.js-section-head [role="group"] button { height:26px; border:0; border-inline-end:1px solid var(--js-line); padding:0 7px; background:transparent; color:var(--js-muted); }
.js-section-head [role="group"] button[aria-pressed="true"] { background:var(--js-accent); color:var(--js-on-accent); }
.js-instance-label { display:grid; gap:8px; }
.js-instance-label textarea { min-height:240px; resize:vertical; border:1px solid var(--js-line); padding:12px; background:var(--js-panel); font-family:Consolas,monospace; }
.js-instance-sheet { width:min(1120px,100%); }
.js-instance-toolbar { display:flex; align-items:end; gap:8px; margin:18px 0 10px; }
.js-instance-toolbar label { min-width:220px; display:grid; gap:4px; color:var(--js-muted); font-size:11px; }
.js-instance-toolbar select { width:100%; }
.js-instance-toolbar button { height:44px; border:1px solid var(--js-accent); border-radius:3px; padding:0 12px; background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-instance-layout { display:grid; grid-template-columns:minmax(280px,.9fr) minmax(320px,1.1fr); gap:14px; align-items:start; }
.js-instance-sheet .js-instance-label textarea { min-height:420px; }
.js-trace-panel { min-width:0; max-height:480px; overflow:auto; border:1px solid var(--js-line); padding:0 10px 10px; background:var(--js-chrome); }
.js-trace { border-inline-start:1px solid var(--js-line); margin-inline-start:8px; padding-inline-start:8px; }
.js-trace>summary { min-height:30px; display:grid; grid-template-columns:18px max-content minmax(0,1fr); gap:5px; align-items:center; cursor:pointer; color:var(--js-muted); }
.js-trace>summary strong { color:var(--js-text); font:11px/1.3 Consolas,monospace; }
.js-trace>summary>span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-trace-status { text-align:center; }
.js-trace-valid>.js-trace-locations+.js-trace-children { border-color:var(--js-ok); }
.js-trace-invalid>.js-trace-locations,.js-trace-invalid>summary .js-trace-status { color:var(--js-error); }
.js-trace-indeterminate>.js-trace-locations,.js-trace-indeterminate>summary .js-trace-status { color:var(--js-warn); }
.js-trace-locations { display:grid; grid-template-columns:1fr 1fr; gap:4px; margin:2px 0 5px 23px; }
.js-trace-locations[aria-current="true"] { outline:1px solid var(--js-focus); }
.js-trace-locations button { min-width:0; min-height:26px; overflow:hidden; border:1px solid var(--js-line); border-radius:3px; padding:3px 6px; background:var(--js-panel); color:var(--js-muted); text-align:start; text-overflow:ellipsis; white-space:nowrap; }
.js-trace-locations button:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-trace-children { margin-inline-start:6px; }
.js-conversion-sheet { width:min(1100px,100%); }
.js-conversion-sheet>.js-type-head>button { align-self:start; height:28px; border:1px solid var(--js-line); border-radius:3px; padding:0 9px; background:var(--js-raised); color:var(--js-muted); }
.js-conversion-layout { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr); gap:20px; margin-top:20px; }
.js-conversion-group+ .js-conversion-group { margin-top:20px; }
.js-conversion-group>h2 { margin:0 0 8px; color:var(--js-muted); font-size:12px; font-weight:600; text-transform:uppercase; }
.js-conversion-tiles { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.js-conversion-tile { min-width:0; min-height:96px; display:grid; grid-template-columns:44px minmax(0,1fr); gap:10px; align-items:start; border:1px solid var(--js-line); border-radius:4px; padding:11px; background:var(--js-panel); color:var(--js-muted); text-align:start; }
.js-conversion-tile:hover { border-color:var(--js-line-strong); background:var(--js-raised); color:var(--js-text); }
.js-conversion-tile[aria-pressed="true"] { border-color:var(--js-accent); background:var(--js-selected); box-shadow:inset 2px 0 var(--js-accent); color:var(--js-text); }
.js-format-icon { width:42px; height:42px; display:grid; place-items:center; border:1px solid var(--js-line-strong); border-radius:3px; color:var(--js-accent-strong); }
.js-technology-icon { width:25px; height:25px; fill:currentColor; }
.js-format-icon[data-format="avro"] { color:#d89b37; }
.js-format-icon[data-format="csharp"],.js-format-icon[data-format="tmsl"] { color:#7377d5; }
.js-format-icon[data-format="go"] { color:#00add8; }
.js-format-icon[data-format="java"] { color:#e76f00; }
.js-format-icon[data-format="javascript"] { color:#f0db4f; }
.js-format-icon[data-format="markdown"] { color:var(--js-text); }
.js-format-icon[data-format="python"] { color:#3776ab; }
.js-format-icon[data-format="rust"] { color:#ce412b; }
.js-format-icon[data-format="sql"],.js-format-icon[data-format="kusto"],.js-format-icon[data-format="cassandra"] { color:#4e95d9; }
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
.js-conversion-arrow { display:inline-flex!important; align-items:center; justify-content:center; color:var(--js-accent)!important; }
.js-conversion-tile small .js-icon,.js-review-summary dd .js-icon { width:13px; height:13px; }
.js-conversion-source { min-width:0; display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:7px; align-items:center; margin-top:10px; border:1px solid var(--js-line); padding:7px; background:var(--js-panel); }
.js-conversion-source>span { color:var(--js-quiet); font-size:10px; text-transform:uppercase; }
.js-conversion-source>strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-conversion-source>button { min-height:28px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-raised); color:var(--js-muted); }
.js-conversion-config fieldset { display:grid; gap:9px; margin:14px 0; padding:10px; }
.js-conversion-config fieldset>label { min-width:0; display:grid; grid-template-columns:18px minmax(0,1fr); gap:5px 7px; align-items:start; margin:0; color:var(--js-muted); }
.js-conversion-config fieldset>label:not(:has(input[type="checkbox"])) { grid-template-columns:1fr; }
.js-option-name { min-width:0; line-height:1.35; }
.js-conversion-config fieldset>label>input:not([type="checkbox"]),.js-conversion-config fieldset>label>select { width:100%; margin:0; }
.js-conversion-config fieldset>label>.js-description { grid-column:1/-1; margin:0; color:var(--js-quiet); font-size:11px; line-height:1.35; }
.js-conversion-config .js-primary { width:100%; min-height:44px; border:1px solid var(--js-accent); border-radius:3px; background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-conversion-loading { margin-top:20px; border:1px dashed var(--js-line); padding:24px; color:var(--js-muted); text-align:center; }
.js-conversion-review { margin-top:18px; border-top:1px solid var(--js-line-strong); border-bottom:1px solid var(--js-line); padding:0 0 12px; }
.js-conversion-review>.js-section-head { margin:12px 0 9px; }
.js-lossiness { margin-inline-start:auto; border:1px solid var(--js-line); border-radius:3px; padding:3px 7px; color:var(--js-muted); font:10px/1.3 Consolas,monospace; }
.js-lossiness[data-lossiness="none"] { border-color:var(--js-ok); color:var(--js-ok); }
.js-lossiness[data-lossiness="formatting"] { border-color:var(--js-accent); color:var(--js-accent); }
.js-lossiness[data-lossiness="metadata"],.js-lossiness[data-lossiness="precision"],.js-lossiness[data-lossiness="unsupported-feature"] { border-color:var(--js-warn); color:var(--js-warn); }
.js-lossiness[data-lossiness="data-loss"] { border-color:var(--js-error); color:var(--js-error); }
.js-review-summary { display:grid; grid-template-columns:minmax(240px,.8fr) minmax(300px,1.2fr); gap:14px; border:1px solid var(--js-line); background:var(--js-chrome); }
.js-review-summary>dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:5px 10px; margin:0; padding:10px; }
.js-review-summary dt { color:var(--js-quiet); }
.js-review-summary dd { min-width:0; margin:0; overflow-wrap:anywhere; }
.js-conversion-lifecycle { display:flex; align-items:center; align-self:stretch; overflow:auto; margin:0; border-inline-start:1px solid var(--js-line); padding:10px; list-style:none; }
.js-conversion-lifecycle li { position:relative; flex:0 0 auto; border:1px solid var(--js-line); padding:4px 7px; color:var(--js-quiet); font:9px/1.3 Consolas,monospace; }
.js-conversion-lifecycle li+li { margin-inline-start:15px; }
.js-conversion-lifecycle li+li::before { content:"→"; position:absolute; inset-inline-start:-12px; color:var(--js-quiet); }
.js-conversion-lifecycle li[data-state="completed"] { border-color:var(--js-ok); color:var(--js-ok); }
.js-conversion-lifecycle li[data-state="cancelled"],.js-conversion-lifecycle li[data-state="failed"] { border-color:var(--js-error); color:var(--js-error); }
.js-conversion-warnings { border:1px solid var(--js-line); border-top:0; }
.js-conversion-warning { border-inline-start:2px solid var(--js-warn); border-bottom:1px solid var(--js-line); padding:8px 10px; background:rgba(230,184,92,.045); }
.js-conversion-warning:last-child { border-bottom:0; }
.js-conversion-warning[data-lossiness="data-loss"] { border-inline-start-color:var(--js-error); background:rgba(239,116,116,.055); }
.js-conversion-warning header { display:flex; gap:8px; align-items:center; }
.js-conversion-warning header strong { min-width:0; flex:1; overflow-wrap:anywhere; font:11px/1.35 Consolas,monospace; }
.js-conversion-warning header span { border:1px solid var(--js-line); border-radius:3px; padding:1px 5px; color:var(--js-warn); font-size:9px; }
.js-conversion-warning p { margin:5px 0; color:var(--js-muted); }
.js-conversion-warning dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:3px 8px; margin:5px 0 0; }
.js-conversion-warning dt { color:var(--js-quiet); }
.js-conversion-warning dd { min-width:0; margin:0; overflow-wrap:anywhere; color:var(--js-muted); }
.js-conversion-warning pre { overflow:auto; margin:7px 0 0; border:1px solid var(--js-line); padding:7px; background:var(--js-canvas); color:var(--js-muted); font:10px/1.4 Consolas,monospace; }
.js-review-clean { margin:0; border-inline-start:2px solid var(--js-ok); padding:8px 10px; background:rgba(99,192,138,.055); color:var(--js-muted); }
.js-integrity-manifest { margin-top:10px; border:1px solid var(--js-line); background:var(--js-chrome); }
.js-integrity-manifest summary { min-height:44px; display:flex; align-items:center; cursor:pointer; padding:7px 9px; color:var(--js-muted); }
.js-integrity-row { display:grid; grid-template-columns:minmax(140px,.35fr) minmax(0,1fr); gap:10px; align-items:center; border-top:1px solid var(--js-line); padding:7px 9px; }
.js-integrity-row>span { min-width:0; }
.js-integrity-row strong,.js-integrity-row small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-integrity-row small { color:var(--js-quiet); font-size:9px; }
.js-integrity-row code { min-width:0; overflow-wrap:anywhere; color:var(--js-muted); font-size:9px; }
.js-library-workbench { width:min(1260px,100%); margin:0 auto; }
.js-library-header { min-height:78px; display:flex; align-items:flex-start; gap:16px; border-bottom:1px solid var(--js-line-strong); padding-bottom:14px; }
.js-library-header>div { min-width:0; flex:1; }
.js-library-header h1 { margin:3px 0 5px; font-size:25px; line-height:1.18; }
.js-library-header p { margin:0; color:var(--js-muted); }
.js-library-header>button { min-height:30px; border:1px solid var(--js-line); border-radius:3px; padding:0 10px; background:var(--js-raised); color:var(--js-muted); }
.js-library-policy { min-height:42px; display:flex; align-items:center; gap:15px; border-bottom:1px solid var(--js-line); padding:5px 9px; background:var(--js-chrome); }
.js-library-policy>span { color:var(--js-quiet); font-size:10px; text-transform:uppercase; }
.js-library-policy label { display:flex; align-items:center; gap:5px; color:var(--js-muted); white-space:nowrap; }
.js-library-policy input { margin:0; }
.js-library-offline { margin-inline-start:auto; }
.js-library-browser { min-height:520px; display:grid; grid-template-columns:190px minmax(280px,1fr) minmax(300px,.85fr); border:1px solid var(--js-line); border-top:0; background:var(--js-canvas); }
.js-library-providers { min-width:0; overflow:auto; border-inline-end:1px solid var(--js-line); background:var(--js-chrome); }
.js-library-provider-row { position:relative; display:grid; grid-template-columns:minmax(0,1fr) 44px; border-bottom:1px solid var(--js-subtle-line); }
.js-library-provider { width:100%; min-height:58px; display:block; border:0; border-inline-start:2px solid transparent; padding:7px 9px; background:transparent; color:var(--js-muted); text-align:start; }
.js-library-provider:hover { background:var(--js-hover); color:var(--js-text); }
.js-library-provider[aria-pressed="true"] { border-inline-start-color:var(--js-accent); background:var(--js-selected); color:var(--js-text); }
.js-library-provider strong,.js-library-provider small,.js-library-provider span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-library-provider small { margin-top:2px; color:var(--js-quiet); font-size:10px; }
.js-library-provider span { margin-top:3px; color:var(--js-quiet); font-size:9px; }
.js-library-provider[aria-pressed="true"] small,.js-library-provider[aria-pressed="true"] span { color:var(--js-muted); }
.js-provider-required { align-self:start; margin:7px 6px 0 -42px; color:var(--js-ok); font-size:9px; pointer-events:none; }
.js-provider-remove { width:44px; height:44px; align-self:center; border:0; background:transparent; color:var(--js-quiet); }
.js-provider-remove:hover { color:var(--js-error); }
.js-provider-add { border-top:1px solid var(--js-line); padding:8px; }
.js-provider-add summary,.js-library-publish summary { cursor:pointer; color:var(--js-muted); }
.js-provider-form,.js-library-publish-body { display:grid; gap:8px; margin-top:9px; }
.js-provider-form label,.js-library-publish-body label,.js-library-operation label { min-width:0; display:grid; gap:4px; color:var(--js-muted); font-size:11px; }
.js-provider-form input,.js-provider-form select,.js-library-publish-body input,.js-library-publish-body select,.js-library-operation input,.js-library-operation select { width:100%; min-width:0; min-height:30px; border:1px solid var(--js-line); border-radius:3px; padding:5px 7px; background:var(--js-canvas); color:var(--js-text); }
.js-provider-form .js-check,.js-library-publish-body .js-check { display:flex; align-items:flex-start; gap:5px; }
.js-provider-form button { min-height:30px; border:1px solid var(--js-line); border-radius:3px; background:var(--js-raised); color:var(--js-muted); }
.js-library-publish-body button { min-height:44px; border:1px solid var(--js-line); border-radius:3px; background:var(--js-raised); color:var(--js-muted); }
.js-library-catalog { min-width:0; min-height:0; display:grid; grid-template-rows:48px minmax(0,1fr); border-inline-end:1px solid var(--js-line); }
.js-library-catalog-toolbar { min-width:0; display:grid; grid-template-columns:minmax(100px,auto) minmax(130px,1fr); gap:10px; align-items:center; border-bottom:1px solid var(--js-line); padding:7px 9px; background:var(--js-chrome); }
.js-library-catalog-toolbar>div strong,.js-library-catalog-toolbar>div span { display:block; }
.js-library-catalog-toolbar>div span { color:var(--js-quiet); font-size:10px; }
.js-library-catalog-toolbar input { width:100%; min-width:0; min-height:30px; border:1px solid var(--js-line); border-radius:3px; padding:5px 7px; background:var(--js-canvas); color:var(--js-text); }
.js-library-catalog-results { min-height:0; overflow:auto; }
.js-library-catalog-entry { border-bottom:1px solid var(--js-line); padding:11px; background:var(--js-panel); }
.js-library-catalog-entry:hover { background:var(--js-raised); }
.js-library-entry-head { min-width:0; display:flex; align-items:start; gap:8px; }
.js-library-entry-head>div { min-width:0; flex:1; }
.js-library-entry-head span { color:var(--js-accent); font-size:9px; text-transform:uppercase; }
.js-library-entry-head h2 { margin:2px 0 0; overflow:hidden; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
.js-library-entry-head code { max-width:42%; overflow:hidden; color:var(--js-quiet); font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
.js-library-catalog-entry>p { margin:7px 0; color:var(--js-muted); font-size:11px; }
.js-version-list { display:flex; flex-wrap:wrap; gap:4px; }
.js-version-chip { border:1px solid var(--js-line); border-radius:3px; padding:2px 5px; color:var(--js-quiet); font:9px/1.3 Consolas,monospace; }
.js-version-chip[data-default="true"] { border-color:var(--js-ok); color:var(--js-ok); }
.js-library-resolve-actions { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
.js-library-resolve { min-height:28px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-canvas); color:var(--js-muted); }
.js-library-resolve:hover { border-color:var(--js-accent); color:var(--js-text); }
.js-library-resolve span { margin-inline-start:5px; color:var(--js-ok); font-size:9px; }
.js-library-detail { min-width:0; min-height:0; overflow:auto; background:var(--js-chrome); }
.js-library-empty-detail { min-height:100%; display:grid; place-content:center; justify-items:center; padding:28px; color:var(--js-muted); text-align:center; }
.js-library-logo { width:48px; height:45px; margin-bottom:12px; }
.js-library-empty-detail h2 { margin:0 0 5px; }
.js-library-empty-detail p { max-width:280px; margin:0; }
.js-library-consume { padding:12px; }
.js-library-consume>header { display:flex; align-items:start; gap:8px; border-bottom:1px solid var(--js-line); padding-bottom:9px; }
.js-library-consume>header>div { min-width:0; flex:1; }
.js-library-consume h2 { margin:3px 0; overflow-wrap:anywhere; font-size:17px; }
.js-library-consume h2 small { color:var(--js-muted); font:10px/1.3 Consolas,monospace; }
.js-library-guarantee,.js-trust-badge { display:inline-flex; border:1px solid var(--js-line); border-radius:3px; padding:2px 5px; color:var(--js-muted); font:9px/1.3 Consolas,monospace; }
.js-library-guarantee[data-guarantee="online-verified"],.js-library-guarantee[data-guarantee="offline-integrity-verified"],.js-trust-badge[data-trusted="true"] { border-color:var(--js-ok); color:var(--js-ok); }
.js-trust-badge[data-trusted="false"] { border-color:var(--js-warn); color:var(--js-warn); }
.js-library-source { overflow-wrap:anywhere; margin:8px 0; color:var(--js-quiet); font-size:10px; }
.js-library-consume dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:4px 9px; margin:9px 0; }
.js-library-consume dt { color:var(--js-quiet); }
.js-library-consume dd { min-width:0; margin:0; overflow-wrap:anywhere; }
.js-library-declarations { margin-top:12px; }
.js-library-declarations .js-section-head { margin:0 0 5px; }
.js-library-declaration { min-width:0; min-height:44px; display:grid; grid-template-columns:20px minmax(0,1fr); gap:0 5px; align-items:center; border-bottom:1px solid var(--js-subtle-line); padding:6px 2px; color:var(--js-muted); }
.js-library-declaration input { grid-row:1/3; align-self:center; margin:0; }
.js-library-declaration small { overflow:hidden; color:var(--js-quiet); font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
.js-library-operation { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:12px; border-top:1px solid var(--js-line); padding-top:10px; }
.js-library-operation>button,.js-library-preview>button { min-height:44px; align-self:end; border:1px solid var(--js-accent); border-radius:3px; padding:0 9px; background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-library-preview { grid-column:1/-1; margin-top:10px; border-top:1px solid var(--js-line); padding-top:8px; }
.js-library-preview .js-section-head { margin:0 0 6px; }
.js-library-provenance { overflow-wrap:anywhere; color:var(--js-muted); font-size:10px; }
.js-library-publish { border-top:1px solid var(--js-line-strong); padding:11px 12px; }
.js-publish-preview { border-inline-start:2px solid var(--js-warn); padding:7px 9px; background:rgba(230,184,92,.06); }
.js-publish-preview code { overflow-wrap:anywhere; }
.js-library-status { min-height:24px; margin:0; border:1px solid var(--js-line); border-top:0; padding:4px 9px; background:var(--js-chrome); color:var(--js-muted); }
.js-library-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:10px 0; }
.js-library-form label { display:grid; gap:5px; color:var(--js-muted); }
.js-library-form input,.js-library-form select,:where(.js-sheet input:not([type="checkbox"]):not([type="radio"]),.js-sheet select,.js-sheet textarea) { min-height:32px; border:1px solid var(--js-line); border-radius:3px; padding:6px 8px; background:var(--js-canvas); color:var(--js-text); }
.js-library-entry,.js-resolution { margin:14px 0; border:1px solid var(--js-line); padding:12px; background:var(--js-chrome); }
.js-resolution dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:5px 12px; }
.js-resolution dt { color:var(--js-muted); }
.js-resolution dd { margin:0; overflow-wrap:anywhere; }
.js-sheet fieldset { margin:14px 0; border:1px solid var(--js-line); }
.js-sheet fieldset>label { display:block; margin:7px 0; }
:where(.js-sheet section>button,.js-sheet fieldset>button,.js-library-entry button) { min-height:44px; margin:6px 6px 0 0; border:1px solid var(--js-line); border-radius:3px; padding:0 10px; background:var(--js-raised); }
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
.js-catalog-field { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:5px; margin-top:5px; }
.js-catalog-field input { margin:0!important; }
.js-catalog-field button { min-height:32px; border:1px solid var(--js-line); border-radius:3px; padding:0 10px; background:var(--js-raised); color:var(--js-muted); }
.js-catalog-drawer { position:absolute; z-index:24; inset-block:70px 22px; inset-inline-end:0; width:min(560px,calc(100% - 60px)); display:grid; grid-template-columns:165px minmax(0,1fr); overflow:hidden; border-inline-start:1px solid var(--js-line-strong); background:var(--js-chrome); box-shadow:-14px 0 34px rgba(0,0,0,.45); }
.js-catalog-provider-list { min-width:0; overflow:auto; border-inline-end:1px solid var(--js-line); }
.js-catalog-provider { width:100%; min-height:48px; display:block; border:0; border-inline-start:2px solid transparent; padding:6px 9px; background:transparent; color:var(--js-muted); text-align:start; }
.js-catalog-provider:hover { background:var(--js-hover); color:var(--js-text); }
.js-catalog-provider[aria-pressed="true"] { border-inline-start-color:var(--js-accent); background:var(--js-selected); color:var(--js-text); }
.js-catalog-provider strong,.js-catalog-provider small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-catalog-provider small { margin-top:2px; color:var(--js-quiet); font-size:9px; }
.js-catalog-content { min-width:0; min-height:0; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; }
.js-catalog-head { min-height:50px; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--js-line); padding:7px 9px; }
.js-catalog-head div { min-width:0; }
.js-catalog-head strong,.js-catalog-head small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-catalog-head small { color:var(--js-quiet); font-size:10px; }
.js-catalog-head button { width:44px; height:44px; margin-inline-start:auto; border:0; background:transparent; color:var(--js-muted); font-size:18px; }
.js-catalog-search { height:30px; margin:8px; border:1px solid var(--js-line); border-radius:3px; padding:0 8px; background:var(--js-canvas); }
.js-catalog-results { min-height:0; overflow:auto; padding:0 8px 8px; }
.js-catalog-result { width:100%; min-height:62px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; border:0; border-bottom:1px solid var(--js-line); padding:7px 6px; background:transparent; color:var(--js-muted); text-align:start; }
.js-catalog-result:hover { background:var(--js-selected); color:var(--js-text); }
.js-catalog-result strong,.js-catalog-result small,.js-catalog-result code { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.js-catalog-result strong { color:var(--js-text); }
.js-catalog-result small { margin-top:2px; color:var(--js-muted); }
.js-catalog-result code { margin-top:4px; color:var(--js-quiet); font:9px/1.35 Consolas,monospace; }
.js-catalog-sources { display:flex; flex-direction:column; gap:3px; align-items:end; }
.js-catalog-sources .js-origin-chip[data-trusted="false"] { border-color:var(--js-warn); color:var(--js-warn); }
.js-catalog-custom { border-top:1px solid var(--js-line); padding:9px; }
.js-catalog-custom p { margin:0 0 7px; color:var(--js-quiet); font-size:10px; }
.js-catalog-custom>div { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:5px; }
.js-catalog-custom input { min-width:0; border:1px solid var(--js-line); border-radius:3px; padding:6px 7px; background:var(--js-canvas); }
.js-catalog-custom button { min-height:44px; border:1px solid var(--js-accent); border-radius:3px; padding:0 10px; background:var(--js-accent); color:var(--js-on-accent); font-weight:650; }
.js-dialog { pointer-events:none; }
.js-dialog-card { position:relative; z-index:1; pointer-events:auto; }
.js-library-dialog { width:min(1280px,calc(100vw - 48px)); max-width:none; height:min(820px,calc(100vh - 48px)); max-height:none; margin:auto; border:1px solid var(--js-line-strong); padding:0; overflow:hidden; background:var(--js-bg); color:var(--js-text); box-shadow:0 18px 70px rgba(0,0,0,.6); }
.js-library-dialog::backdrop { background:rgba(0,0,0,.62); }
.js-library-dialog-head { height:38px; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--js-line); padding:0 10px; background:var(--js-chrome); }
.js-library-dialog-head strong { flex:1; font-size:12px; }
.js-library-dialog-head button { width:28px; height:28px; display:grid; place-items:center; border:0; background:transparent; color:var(--js-muted); }
.js-library-dialog-head button:hover { background:var(--js-raised); color:var(--js-text); }
.js-library-dialog>.js-library-workbench { height:calc(100% - 38px); overflow:auto; padding:12px; }
.js-mobile-toggle,.js-mobile-mode { display:none; }
@media (max-width:1120px) {
  :host,.json-structure-editor { --js-sidebar:205px; --js-inspector:250px; }
  .js-workbench { position:relative; grid-template-columns:46px var(--js-sidebar) minmax(0,1fr); }
  .js-center { grid-column:3; }
  .js-problems { grid-column:3; }
  .js-inspector:not(.js-drawer-open) { display:none; }
  .js-inspector.js-drawer-open { position:absolute; z-index:12; grid-area:1 / 1 / -1 / -1; inset-block:0; inset-inline-end:0; width:min(340px,90%); display:block; box-shadow:-8px 0 24px rgba(0,0,0,.45); }
  .js-document-toolbar>[data-mobile-drawer="inspector"] { display:inline-flex; align-items:center; }
  .js-drawer-close { display:inline-block; }
  .js-row { grid-template-columns:minmax(100px,1fr) minmax(110px,1.1fr) 70px minmax(95px,1fr) 32px; }
  .js-view { padding-inline:18px; }
  .js-library-browser { grid-template-columns:160px minmax(240px,1fr) minmax(270px,.9fr); }
}
@media (max-width:860px) {
  .js-document-toolbar { padding-inline:8px; }
  .js-mobile-toggle { display:inline-flex!important; align-items:center; }
  .js-workbench { position:relative; grid-template-columns:46px minmax(0,1fr); }
  .js-activity { grid-column:1; }
  .js-center { grid-column:2; }
  .js-problems { grid-column:2; }
  .js-outline:not(.js-drawer-open),.js-inspector:not(.js-drawer-open) { display:none; }
  .js-outline.js-drawer-open,.js-inspector.js-drawer-open { position:absolute; z-index:12; grid-area:1 / 1 / -1 / -1; inset-block:0; width:min(340px,90%); display:flex; box-shadow:8px 0 24px rgba(0,0,0,.45); }
  .js-outline.js-drawer-open { inset-inline-start:46px; }
  .js-inspector.js-drawer-open { inset-inline-end:0; }
  .js-analysis-grid { grid-template-columns:1fr; }
  .js-conversion-layout { grid-template-columns:1fr; }
  .js-review-summary { grid-template-columns:1fr; }
  .js-conversion-lifecycle { border-inline-start:0; border-top:1px solid var(--js-line); }
  .js-instance-layout { grid-template-columns:1fr; }
  .js-instance-sheet .js-instance-label textarea { min-height:280px; }
  .js-graph-context { grid-template-columns:minmax(0,1fr) minmax(130px,180px); }
  .js-graph-lenses { grid-column:1/-1; justify-self:start; }
  .js-conversion-config { position:static; }
  .js-library-browser { grid-template-columns:150px minmax(0,1fr); }
  .js-library-detail { grid-column:1/-1; min-height:360px; border-top:1px solid var(--js-line-strong); }
  .js-theme-label,.js-document-toolbar>.js-chip { display:none; }
  .js-row { grid-template-columns:minmax(90px,1fr) minmax(120px,1fr) 64px 64px 70px 32px; }
  .js-inline-relation-draft { grid-template-columns:minmax(120px,1fr) minmax(150px,1fr) 100px; }
  .js-inline-relation-draft [data-inline-relation-scope],.js-inline-relation-actions { grid-column:auto; }
  .js-property-detail-columns { grid-template-columns:1fr; }
}
@media (max-width:620px) {
  .js-shell { min-width:0; grid-template-rows:44px 40px minmax(0,1fr) 22px; }
  .js-title strong { display:none; }
  .js-file { margin-inline-start:0; }
  .js-title { padding-inline:6px; gap:5px; }
  .js-command-trigger { width:44px; flex-basis:44px; }
  .js-document-toolbar>button:not(.js-mobile-toggle),.js-document-toolbar>.js-spacer,.js-document-toolbar .js-tabs { display:none; }
  .js-mobile-mode { min-width:0; flex:1; display:block; }
  .js-mobile-mode select { width:100%; height:30px; border:1px solid var(--js-line); border-radius:3px; padding:0 6px; background:var(--js-panel); }
  .js-workbench { grid-template-columns:minmax(0,1fr); }
  .js-activity { display:none; }
  .js-center,.js-problems { grid-column:1; }
  .js-outline.js-drawer-open { inset-inline-start:0; }
  .js-editor-tab { width:70%; }
  .js-breadcrumbs { font-size:12px; }
  .js-view { padding:14px 12px 48px; }
  .js-type-head { display:block; }
  .js-type-head>.js-chip { margin-top:10px; }
  .js-row { grid-template-columns:minmax(80px,1fr) minmax(100px,1fr) 44px; }
  .js-row.js-header .js-cell:nth-child(3),.js-row.js-header .js-cell:nth-child(4),.js-row.js-header .js-cell:nth-child(5) { display:none; }
  .js-inline-property-row,.js-effective-row { grid-template-areas:"name type action" "nullable identity presence" ". composite composite" ". description description"; }
  .js-collection-expression { grid-template-columns:auto auto minmax(0,1fr) auto; }
  .js-collection-member { grid-template-columns:1fr; gap:3px; }
  .js-inline-property-row .js-inline-nullable-cell,.js-inline-property-row .js-inline-identity-cell,.js-inline-property-row .js-inline-required-cell,.js-inline-property-row .js-description-cell { display:block; }
  .js-inline-relation-draft { grid-template-columns:1fr; }
  .js-property-details { padding-inline:10px; }
  .js-property-detail-fields { grid-template-columns:1fr; }
  .js-library-form,.js-resolution dl { grid-template-columns:1fr; }
  .js-library-header { min-height:0; }
  .js-library-policy { align-items:flex-start; flex-wrap:wrap; padding-block:8px; }
  .js-library-offline { margin-inline-start:0; }
  .js-library-browser { min-height:0; grid-template-columns:1fr; }
  .js-library-providers { max-height:220px; border-inline-end:0; border-bottom:1px solid var(--js-line); }
  .js-library-catalog { min-height:360px; border-inline-end:0; }
  .js-library-detail { grid-column:auto; }
  .js-library-operation { grid-template-columns:1fr; }
  .js-conversion-tiles { grid-template-columns:1fr; }
  .js-conversion-source { grid-template-columns:1fr; }
  .js-conversion-source>button { width:100%; }
  .js-integrity-row { grid-template-columns:1fr; }
  .js-instance-toolbar { align-items:stretch; flex-direction:column; }
  .js-instance-toolbar label,.js-instance-toolbar button { width:100%; }
  .js-graph { max-width:100%; overflow:hidden; }
  .js-graph-toolbar { height:auto; overflow:hidden; }
  .js-graph-toolbar .js-spacer { display:none; }
  .js-graph-toolbar [data-semantic-zoom] { min-width:0; flex:1 1 80px; }
  .js-graph-context { min-width:0; grid-template-columns:minmax(0,1fr); gap:6px; }
  .js-graph-search { display:block; min-width:0; }
  .js-graph-lenses { width:100%; justify-self:stretch; }
  .js-graph-lenses button { min-width:0; flex:1; padding-inline:3px; }
  .js-empty-actions { width:min(240px,100%); flex-direction:column; }
  .js-empty-actions button { width:100%; }
  .js-catalog-drawer { inset-block:74px 28px; width:100%; grid-template-columns:112px minmax(0,1fr); }
  .js-catalog-provider { padding-inline:6px; }
  .js-catalog-result { grid-template-columns:1fr; }
  .js-catalog-sources { align-items:start; }
}
@media (pointer:coarse), (max-width:620px) {
  .js-document-toolbar>button,.js-tabs button,.js-activity-button,.js-tree-item,.js-panel-head button,.js-graph-toolbar button,.js-problems-head button,.js-status button { min-width:44px; min-height:44px; }
  .js-document-toolbar,.js-panel-head,.js-editor-tab { min-height:44px; }
  .js-tree-item { height:44px; }
  .js-shell { grid-template-rows:44px 44px minmax(0,1fr) 44px; }
  .js-center { grid-template-rows:44px 30px minmax(0,1fr); }
  .js-mobile-mode select,.js-inline-property-row input:not([type="checkbox"]),.js-inline-property-row select,.js-inline-property-row textarea,.js-row-action,.js-add-row,.js-member-mode button,.js-section-head>button,.js-section-head [role="group"] button,.js-cardinality button,.js-inspector-action,.js-actions button,.js-value-actions button { min-height:44px; }
  .js-inline-property-row { grid-template-columns:minmax(80px,1fr) minmax(100px,1fr) 44px; }
  .js-inline-property-row .js-action-cell { padding:0; }
  .js-row-action { min-width:44px; }
  .js-inline-required-cell label,.js-inline-nullable-cell label,.js-inline-identity-cell label,.js-property-details input:not([type="checkbox"]),.js-property-details select,.js-detail-json button,.js-property-advanced button,.js-property-advanced summary,.js-integrity-manifest summary { min-height:44px; }
  .js-graph-crumbs button,.js-graph-lenses button,.js-graph-search input { min-height:44px; }
  .js-instance-toolbar select,.js-instance-toolbar button,.js-trace>summary,.js-trace-locations button { min-height:44px; }
  .js-conversion-sheet>.js-type-head>button,.js-conversion-source>button,.js-conversion-config input:not([type="checkbox"]),.js-conversion-config select,.js-conversion-config .js-primary { min-height:44px; }
  .js-conversion-config fieldset>label { min-height:44px; align-items:center; }
  .js-library-header>button,.js-library-policy label,.js-library-provider,.js-provider-remove,.js-provider-add summary,.js-provider-form input,.js-provider-form select,.js-provider-form button,.js-library-catalog-toolbar input,.js-library-resolve,.js-library-declaration,.js-library-operation input,.js-library-operation select,.js-library-operation>button,.js-library-publish summary,.js-library-publish-body input,.js-library-publish-body select,.js-library-publish-body button { min-height:44px; }
  .js-catalog-field button,.js-catalog-provider,.js-catalog-head button,.js-catalog-search,.js-catalog-result,.js-catalog-custom input,.js-catalog-custom button { min-height:44px; }
  .js-catalog-head button { min-width:44px; }
}
@media (prefers-reduced-motion:reduce) { .js-workbench { transition:none; } }
.js-shell.js-chrome-integrated { grid-template-rows:35px 36px minmax(0,1fr) 22px; }
.js-shell.js-chrome-embedded { grid-template-rows:36px minmax(0,1fr) 22px; }
@media (max-width:620px) {
  .js-titlebar-drag { grid-template-columns:auto minmax(0,1fr); }
  .js-menubar { display:none; }
  .js-shell.js-chrome-integrated { grid-template-rows:35px 40px minmax(0,1fr) 22px; }
  .js-shell.js-chrome-embedded { grid-template-rows:40px minmax(0,1fr) 22px; }
}
@media (pointer:coarse) {
  .js-shell.js-chrome-integrated { grid-template-rows:35px 44px minmax(0,1fr) 44px; }
  .js-shell.js-chrome-embedded { grid-template-rows:44px minmax(0,1fr) 44px; }
}
@media (max-width:1120px) {
  .js-graph-workspace { grid-template-columns:minmax(430px,1fr) 248px; }
  .js-graph-toolbar .js-graph-search { width:145px; }
  .js-minimap-wrap { width:154px; }
  .js-minimap { width:136px; }
}
@media (max-width:860px) {
  .js-workbench[data-active-mode="graph"]>.js-center { grid-column:2; }
  .js-graph-workspace { grid-template-columns:minmax(0,1fr); }
  .js-graph-navigator,.js-graph-inspector { display:none; }
  .js-graph-toolbar .js-graph-crumbs { display:none; }
  .js-graph-toolbar .js-graph-search { width:min(180px,32vw); }
  .js-graph-command-bar { display:none; }
}
@media (max-width:620px) {
  .js-workbench[data-active-mode="graph"]>.js-center { grid-column:1; }
  .js-graph-toolbar { min-height:44px; flex-wrap:nowrap; overflow:hidden; }
  .js-graph-toolbar .js-graph-search { width:min(120px,28vw); }
  .js-graph-divider { display:none; }
  .js-graph-level-banner { max-width:55%; }
  .js-graph-level-banner>strong { font-size:15px; }
  .js-graph-level-banner>small { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .js-minimap-wrap { width:126px; padding:6px; }
  .js-minimap { width:112px; height:64px; }
  .js-graph-hint { display:none; }
}
`;
