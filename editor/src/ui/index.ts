import { AddPropertyCommand, DeletePropertyCommand, EditPropertyCommand, RenamePropertyCommand } from '../commands.js';
import { PROTOCOL_VERSION, type Diagnostic, type DocumentSnapshot, type EditorHost, type TextEdit } from '../contracts.js';
import { DocumentSession } from '../session.js';
import { diagnosticsForPointer, pointerLabel, projectGraph, projectProperties, type PropertyRow } from './helpers.js';
import { editorStyles } from './styles.js';

export { diagnosticsForPointer, pointerLabel, projectGraph, projectProperties } from './helpers.js';

/** Options accepted by the browser editor mount point. */
export interface JsonStructureEditorOptions {
  /** Initial JSON Structure text. */
  readonly text: string;
  /** Stable URI used in diagnostics and host synchronization. */
  readonly uri?: string;
  /** Optional host adapter; command writes are forwarded to this host. */
  readonly host?: EditorHost;
  /** An accessible document label displayed by the workbench. */
  readonly title?: string;
  /** Called after the source changes through a command or source editor input. */
  readonly onChange?: (text: string, snapshot: DocumentSnapshot) => void;
}

/** Imperative handle returned by {@link mountJsonStructureEditor}. */
export interface JsonStructureEditorHandle {
  /** Replaces the open JSON text and rerenders every synchronized view. */
  setText(text: string): void;
  /** Returns the exact current JSON source text. */
  getText(): string;
  /** Releases DOM created by this editor instance. */
  dispose(): void;
}

type Mode = 'design' | 'graph' | 'source';

/**
 * Mounts the ALPHA JSON Structure workbench into a browser container.
 *
 * The UI consumes the foundation's normalized document model and property
 * commands, while remaining host-neutral: a host is optional for browser demos.
 */
export function mountJsonStructureEditor(container: HTMLElement, options: JsonStructureEditorOptions): JsonStructureEditorHandle {
  const session = new DocumentSession(options.uri ?? 'memory://json-structure-editor/untitled.struct.json', options.text);
  let selectedPointer: string | undefined;
  let mode: Mode = 'design';
  let disposed = false;
  container.innerHTML = `<style>${editorStyles}</style><main class="json-structure-editor" data-theme="dark"></main>`;
  const root = container.querySelector('.json-structure-editor') as HTMLElement;

  const setText = (text: string): void => {
    session.update(text, session.snapshot().documentVersion + 1);
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(text, session.snapshot());
  };
  const select = (pointer: string | undefined, nextMode?: Mode): void => {
    selectedPointer = pointer;
    if (nextMode) mode = nextMode;
    render();
  };
  const applyCommand = async (command: { canExecute(context: { session: DocumentSession; documentVersion: number }): boolean; execute(context: { session: DocumentSession; documentVersion: number }): { edits: readonly TextEdit[] } }): Promise<void> => {
    const snapshot = session.snapshot();
    const context = { session, documentVersion: snapshot.documentVersion };
    if (!command.canExecute(context)) return;
    const result = command.execute(context);
    if (options.host) {
      const response = await options.host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `ui-${Date.now()}`, documentVersion: snapshot.documentVersion, edits: result.edits });
      if (!response.applied) { session.update(snapshot.text, snapshot.documentVersion); render(); return; }
      const hostSnapshot = await options.host.readDocument();
      session.update(hostSnapshot.text, hostSnapshot.documentVersion);
    } else session.update(applyEdits(snapshot.text, result.edits), snapshot.documentVersion + 1);
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(session.snapshot().text, session.snapshot());
  };
  const render = (): void => {
    if (disposed) return;
    const snapshot = session.snapshot();
    const definitions = (snapshot.model?.projections.definitions ?? []).filter((definition) => definition.reusable);
    selectedPointer = selectFallback(snapshot, selectedPointer);
    const selectedDefinition = definitions.find((definition) => definition.pointer === selectedPointer) ?? definitions.find((definition) => selectedPointer?.startsWith(`${definition.pointer}/properties/`)) ?? definitions[0];
    const rows = projectProperties(selectedDefinition);
    root.innerHTML = shell(snapshot, options.title ?? 'Untitled JSON Structure', definitions.map((item) => ({ name: item.name, pointer: item.pointer, namespace: item.namespacePointer })), selectedDefinition?.pointer, rows, selectedPointer, mode);
    wire(selectedDefinition?.pointer, rows);
  };
  const wire = (definitionPointer: string | undefined, rows: readonly PropertyRow[]): void => {
    root.querySelectorAll('[data-mode]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => select(selectedPointer, button.dataset.mode as Mode)));
    root.querySelectorAll('[data-select]').forEach((target: HTMLButtonElement) => {
      target.addEventListener('click', () => select(target.dataset.select));
      target.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(target.dataset.select);
        }
      });
    });
    const theme = root.querySelector('[data-theme-select]') as HTMLInputElement | null;
    theme?.addEventListener('change', () => { root.dataset.theme = theme.value; });
    const source = root.querySelector('[data-source]') as HTMLTextAreaElement | null;
    source?.addEventListener('input', () => setText(source.value));
    source?.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Tab') { event.preventDefault(); insertTab(source); } });
    root.querySelector('[data-command="add"]')?.addEventListener('click', () => showPropertyDialog(root, 'Add property', async (name, type) => {
      if (definitionPointer) await applyCommand(new AddPropertyCommand(definitionPointer, name, { type }));
    }));
    root.querySelector('[data-command="rename"]')?.addEventListener('click', () => {
      if (!selectedPointer?.includes('/properties/')) return;
      showPropertyDialog(root, 'Rename property', async (name) => applyCommand(new RenamePropertyCommand(selectedPointer!, name)), pointerLabel(selectedPointer));
    });
    root.querySelector('[data-command="edit"]')?.addEventListener('click', () => {
      const row = rows.find((candidate) => candidate.pointer === selectedPointer);
      if (!row) return;
      showPropertyDialog(root, 'Change property type', async (_name, type) => applyCommand(new EditPropertyCommand(row.pointer, { type })), row.name, row.type, true);
    });
    root.querySelector('[data-command="delete"]')?.addEventListener('click', () => {
      if (selectedPointer?.includes('/properties/') && window.confirm(`Delete ${pointerLabel(selectedPointer)}?`)) void applyCommand(new DeletePropertyCommand(selectedPointer));
    });
    root.querySelectorAll('[data-problem]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => select(button.dataset.problem, 'source')));
  };
  render();
  return { setText, getText: () => session.snapshot().text, dispose: () => { disposed = true; container.innerHTML = ''; } };
}

function shell(snapshot: DocumentSnapshot, title: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly namespace: string }[], definitionPointer: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, mode: Mode): string {
  const definition = snapshot.model?.projections.definitions.find((item) => item.pointer === definitionPointer);
  const selectedProperty = rows.find((row) => row.pointer === selectedPointer);
  const selectedDiagnostics = diagnosticsForPointer(snapshot.diagnostics, selectedPointer);
  return `<div class="js-shell"><header class="js-title"><span class="js-mark" aria-hidden="true"></span><strong>JSON Structure</strong><span class="js-file">${escapeHtml(title)}</span></header><div class="js-toolbar" role="toolbar" aria-label="Editor commands"><button data-command="add" title="Add property">Add property</button><button data-command="rename" title="Rename selected property">Rename</button><button data-command="edit" title="Change selected property type">Change type</button><button data-command="delete" title="Delete selected property">Delete</button><span class="js-spacer"></span><label>Theme <select class="js-theme" data-theme-select aria-label="Color theme"><option value="dark">Dark</option><option value="light">Light</option><option value="contrast">High contrast</option></select></label></div><div class="js-workbench"><aside class="js-outline"><div class="js-panel-head">Types and namespaces</div><input class="js-filter" type="search" placeholder="Filter types" aria-label="Filter types"><div class="js-tree-group">${definitions.length} definitions</div>${definitions.map((item) => `<button class="js-tree-item" data-select="${escapeAttribute(item.pointer)}" aria-current="${item.pointer === definitionPointer}"><span class="js-kind">{ }</span><span>${escapeHtml(item.name)}</span></button>`).join('') || '<div class="js-empty">No reusable types found.</div>'}</aside><section class="js-center"><nav class="js-tabs" role="tablist" aria-label="Editor mode">${(['design', 'graph', 'source'] as const).map((item) => `<button role="tab" data-mode="${item}" aria-selected="${mode === item}">${item[0]!.toUpperCase()}${item.slice(1)}</button>`).join('')}</nav><section class="js-view" ${mode === 'design' ? '' : 'hidden'}>${designView(definition?.name, definition?.type, definition?.description, rows, selectedPointer)}</section><section class="js-view js-graph" ${mode === 'graph' ? '' : 'hidden'}>${graphView(snapshot, selectedPointer)}</section><section class="js-view" ${mode === 'source' ? '' : 'hidden'}><textarea class="js-source" data-source aria-label="JSON source editor" spellcheck="false">${escapeHtml(snapshot.text)}</textarea></section></section><aside class="js-inspector"><div class="js-panel-head">Inspector</div>${inspector(selectedProperty, definition, selectedDiagnostics)}</aside><section class="js-problems"><div class="js-panel-head">Problems <span style="margin-left:auto">${snapshot.diagnostics.length}</span></div>${problems(snapshot.diagnostics)}</section></div><footer class="js-status"><span>${escapeHtml(snapshot.recovery)}</span><span>${definitions.length} types</span><span>${snapshot.diagnostics.length} diagnostics</span><span>${selectedPointer ? escapeHtml(selectedPointer) : 'No selection'}</span></footer></div>`;
}

function designView(name: string | undefined, type: string | undefined, description: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined): string {
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Focused type</div><h1>${escapeHtml(name ?? 'Document')}</h1><p class="js-description">${escapeHtml(description ?? 'Select a reusable type to inspect and edit its properties.')}</p></div><span class="js-chip">${escapeHtml(type ?? 'unknown')}</span></header><div class="js-section-head"><h2>Properties (${rows.length})</h2><button data-command="add">Add property</button></div><div class="js-grid"><div class="js-row js-header"><div class="js-cell">Name</div><div class="js-cell">Type</div><div class="js-cell">Presence</div><div class="js-cell js-description-cell">Description</div><div class="js-cell">Action</div></div>${rows.map((row) => `<div class="js-row" aria-current="${row.pointer === selectedPointer}"><button class="js-cell js-code" data-select="${escapeAttribute(row.pointer)}">${escapeHtml(row.name)}</button><div class="js-cell js-code">${escapeHtml(row.type)}</div><div class="js-cell ${row.required ? 'js-required' : 'js-optional'}">${row.required ? 'required' : 'optional'}</div><div class="js-cell js-description-cell">${escapeHtml(row.description ?? 'No description')}</div><button class="js-cell" data-select="${escapeAttribute(row.pointer)}">Inspect</button></div>`).join('') || '<div class="js-empty">This type has no properties yet.</div>'}</div></div>`;
}

function graphView(snapshot: DocumentSnapshot, selectedPointer: string | undefined): string {
  const graph = projectGraph(snapshot); const positions = graph.nodes.map((node, index) => ({ ...node, x: 80 + (index % 3) * 210, y: 80 + Math.floor(index / 3) * 130 }));
  const position = new Map(positions.map((node) => [node.id, node]));
  return `<svg viewBox="0 0 ${Math.max(680, 120 + Math.min(3, positions.length) * 210)} ${Math.max(430, 150 + Math.ceil(positions.length / 3) * 130)}" role="img" aria-label="Type relationship graph"><defs><marker id="js-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="currentColor"></path></marker></defs>${graph.edges.map((edge) => { const from = position.get(edge.from); const to = position.get(edge.to); return from && to ? `<path class="js-edge js-edge-${edge.kind}" d="M${from.x + 150} ${from.y + 25} L${to.x} ${to.y + 25}" marker-end="url(#js-arrow)"><title>${escapeHtml(edge.label)}</title></path>` : ''; }).join('')}${positions.map((node) => `<g class="js-node" role="button" tabindex="0" data-select="${escapeAttribute(node.pointer)}" aria-current="${node.pointer === selectedPointer}" transform="translate(${node.x} ${node.y})"><rect width="150" height="50" rx="3"></rect><text x="12" y="22">${escapeHtml(node.label)}</text><text class="js-node-meta" x="12" y="39">${escapeHtml(node.namespace)}</text></g>`).join('') || '<text x="30" y="50">No types to graph.</text>'}</svg>`;
}

function inspector(property: PropertyRow | undefined, definition: { readonly name: string; readonly type?: string; readonly description?: string } | undefined, diagnostics: readonly Diagnostic[]): string {
  if (!property) return `<section><div class="js-eyebrow">${escapeHtml(definition?.type ?? 'document')}</div><h2>${escapeHtml(definition?.name ?? 'No selection')}</h2><p class="js-description">Choose a property in Design or Graph to inspect it.</p></section><section><div class="js-eyebrow">Diagnostics</div><p class="js-description">${diagnostics.length} for this selection.</p></section>`;
  return `<section><div class="js-eyebrow">Property</div><h2>${escapeHtml(property.name)}</h2></section><section><label class="js-field">Type<input value="${escapeAttribute(property.type)}" readonly></label><label class="js-field">Description<textarea readonly>${escapeHtml(property.description ?? '')}</textarea></label><div class="js-actions"><button data-command="rename">Rename</button><button data-command="edit">Change type</button><button class="js-danger" data-command="delete">Delete</button></div></section><section><div class="js-eyebrow">Diagnostics</div><p class="js-description">${diagnostics.length} for this selection.</p></section>`;
}

function problems(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `<button class="js-problem" data-problem="${escapeAttribute(diagnostic.location?.pointer ?? '')}"><span class="js-problem-${diagnostic.severity}">${diagnostic.severity === 'error' ? 'x' : '!'}</span><span>${escapeHtml(diagnostic.message)}</span><span class="js-location">${escapeHtml(diagnostic.location?.pointer ?? '')}</span></button>`).join('') || '<div class="js-empty">No problems detected.</div>';
}

function showPropertyDialog(root: HTMLElement, title: string, submit: (name: string, type: string) => Promise<void>, initialName = '', initialType = 'string', typeOnly = false): void {
  const dialog = document.createElement('div'); dialog.className = 'js-dialog';
  dialog.innerHTML = `<form class="js-dialog-card"><h2>${escapeHtml(title)}</h2>${typeOnly ? '' : '<label>Name<input name="name" required></label>'}<label>Type<input name="type" required></label><div class="js-actions"><button type="button" data-cancel>Cancel</button><button>Apply</button></div></form>`;
  root.append(dialog); const form = dialog.querySelector('form') as any; form.name && (form.name.value = initialName); form.type.value = initialType; form.querySelector('[data-cancel]').addEventListener('click', () => dialog.remove()); form.addEventListener('submit', (event: Event) => { event.preventDefault(); void submit(typeOnly ? initialName : form.name.value.trim(), form.type.value.trim()).then(() => dialog.remove()); }); (typeOnly ? form.type : form.name).focus();
}

function applyEdits(text: string, edits: readonly TextEdit[]): string { return [...edits].sort((a, b) => (b.range.startOffset ?? 0) - (a.range.startOffset ?? 0)).reduce((current, edit) => current.slice(0, edit.range.startOffset) + edit.newText + current.slice(edit.range.endOffset), text); }
function selectFallback(snapshot: DocumentSnapshot, current: string | undefined): string | undefined { if (current && snapshot.model?.nodes.some((node) => node.pointer === current)) return current; return snapshot.model?.projections.definitions.find((definition) => definition.reusable)?.pointer; }
function insertTab(source: HTMLTextAreaElement): void { const start = source.selectionStart; source.setRangeText('  ', start, source.selectionEnd, 'end'); source.dispatchEvent(new Event('input', { bubbles: true })); }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, '&#39;'); }