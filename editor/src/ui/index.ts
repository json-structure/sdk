import { PROTOCOL_VERSION, type ConversionResult, type Diagnostic, type DocumentSnapshot, type EditorHost, type ProgressEvent, type TextEdit } from '../contracts.js';
import { BUNDLED_ISO_4217_PROVIDER, BUNDLED_SEMANTIC_PROVIDER, BUNDLED_UCUM_PROVIDER, CatalogRegistry, bundledCatalogResult, type CatalogProvider } from '../catalogs.js';
import { DocumentSession } from '../session.js';
import { loadExternalDocuments } from '../external-documents.js';
import { actionById, commandActions, type CommandAction } from './actions.js';
import { actionAvailability, catalogFamilyForAction, parseActionValue, valueAtPointer } from './action-runtime.js';
import { diagnosticsForPointer, isInlineRootSchema, pointerLabel, projectGraph, projectInspectorSections, projectProperties, projectSchemaInspectorSections, type InspectorSection, type PropertyRow } from './helpers.js';
import { GraphNavigationController } from './graph-navigation.js';
import { editorStyles } from './styles.js';
import { InstanceWorkspace, type InstanceValidationResult } from '../phase4/instance-workspace.js';
import { resolveEffectiveMembers } from '../phase4/effective-members.js';
import { GraphRuntime } from '../phase4/graph-runtime.js';
import { detectMetaSchemaMode, paletteDescriptors } from '../phase4/meta-schema.js';
import type { ConversionCommandsManifest } from '../conversion/types.js';
import type { LibraryEntry } from '../libraries/contracts.js';
import type { LibraryDocument } from '../libraries/contracts.js';
import type { LibraryCatalogEntry, LibraryHostResolution, LibraryProviderSummary } from '../libraries/host-runtime.js';
import { CopyCollisionError, planLibraryCopy, planLibraryMaterialization, type CopyOperation, type LibraryProvenance } from '../libraries/planning.js';
import { planAddImport, planCopyDeclarations, planExtractInlineProperty, planLocalShadow, planMaterializeDeclarations, planMoveDefinition, type RefactoringPlan } from '../phase4/refactoring.js';
import { rangeFor } from '../parser.js';
import type { editor as MonacoEditor } from 'monaco-editor';

export { diagnosticsForPointer, pointerLabel, projectGraph, projectProperties } from './helpers.js';

type EditorServices = Pick<EditorHost, 'listConversionCommands' | 'convert' | 'onConversionProgress' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument'>;

export interface LibraryResolveSelection {
  readonly providerId: string;
  readonly entryId: string;
  readonly selector: { readonly kind: 'pinned'; readonly version: string } | { readonly kind: 'floating' };
  readonly offline: boolean;
}

export interface LibraryPublishDraft {
  readonly providerId: string;
  readonly entryId: string;
  readonly version: string;
  readonly sourceUri: string;
  readonly promoteDefault: boolean;
  readonly expectedEpoch?: string;
}

export interface LibraryPublishPreview {
  readonly draft: LibraryPublishDraft;
  readonly summary: string;
  readonly collisionRisks: readonly string[];
  readonly valid: boolean;
}

/** Loads the shared provider catalog through the host-owned library runtime. */
export async function loadLibraryCatalog(libraryRequest: NonNullable<EditorHost['libraryRequest']>): Promise<readonly LibraryCatalogEntry[]> {
  return libraryRequest<readonly LibraryCatalogEntry[]>('listCatalog');
}

/** Resolves a selected provider version without bypassing host trust or offline policy. */
export async function resolveLibrarySelection<T>(libraryRequest: NonNullable<EditorHost['libraryRequest']>, selection: LibraryResolveSelection): Promise<T> {
  return libraryRequest<T>('resolve', selection);
}

export function libraryPublishPreview(draft: LibraryPublishDraft, providers: readonly LibraryProviderSummary[], catalog: readonly LibraryCatalogEntry[], documentValid: boolean): LibraryPublishPreview {
  const provider = providers.find((candidate) => candidate.id === draft.providerId);
  const entry = catalog.find((candidate) => candidate.providerId === draft.providerId && candidate.id === draft.entryId);
  const collisionRisks = [
    ...(entry?.versions.some((candidate) => candidate.version === draft.version) ? [`${draft.entryId}@${draft.version} already exists.`] : []),
    ...(draft.promoteDefault ? [`Default version will move to ${draft.version}.`] : []),
  ];
  const valid = documentValid && Boolean(draft.entryId.trim() && draft.version.trim() && validLibrarySourceUri(draft.sourceUri) && provider?.publishSupported);
  return {
    draft,
    summary: `${draft.providerId}:${draft.entryId}@${draft.version} from ${draft.sourceUri}; promoteDefault=${draft.promoteDefault}; expectedEpoch=${draft.expectedEpoch ?? 'none'}`,
    collisionRisks,
    valid,
  };
}

export function libraryConflictMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /changed since it was read|epoch/i.test(message)
    ? `${message} Refresh the catalog, update Expected epoch, preview again, and retry.`
    : message;
}

export function clearCredentialSecret(control: HTMLInputElement): void {
  control.value = '';
}

function validLibrarySourceUri(value: string): boolean {
  try { return Boolean(new URL(value.trim()).protocol); }
  catch { return false; }
}

/** Options accepted by the browser editor mount point. */
export interface JsonStructureEditorOptions {
  /** Initial JSON Structure text. */
  readonly text: string;
  /** Stable URI used in diagnostics and host synchronization. */
  readonly uri?: string;
  /** Initial host document version. */
  readonly documentVersion?: number;
  /** Optional host adapter; command writes are forwarded to this host. */
  readonly host?: EditorHost;
  /** Optional host-owned conversion and library capabilities without document synchronization. */
  readonly services?: EditorServices;
  /** Optional resource reader used to resolve imported JSON Structure documents. */
  readonly readResource?: NonNullable<EditorHost['readResource']>;
  /** An accessible document label displayed by the workbench. */
  readonly title?: string;
  /** Called after the source changes through a command or source editor input. */
  readonly onChange?: (text: string, snapshot: DocumentSnapshot) => void;
  /** CSP nonce applied to the editor's injected style element in webview hosts. */
  readonly styleNonce?: string;
}

/** Imperative handle returned by {@link mountJsonStructureEditor}. */
export interface JsonStructureEditorHandle {
  /** Replaces the open JSON text and rerenders every synchronized view. */
  setText(text: string, documentVersion?: number): void;
  /** Returns the exact current JSON source text. */
  getText(): string;
  /** Opens the shared command palette. */
  showCommandPalette(): void;
  /** Releases DOM created by this editor instance. */
  dispose(): void;
}

type Mode = 'design' | 'graph' | 'analysis' | 'instance' | 'conversion' | 'libraries' | 'source';
type ImpactDirection = 'outgoing' | 'incoming' | 'both';
type LibraryOperation = 'import' | 'copy' | 'materialize';
type GraphResizeObserver = { observe(target: SVGElement): void; disconnect(): void };
const graphNavigationBySnapshot = new WeakMap<DocumentSnapshot, GraphNavigationController>();

/**
 * Mounts the ALPHA JSON Structure workbench into a browser container.
 *
 * The UI consumes the foundation's normalized document model and property
 * commands, while remaining host-neutral: a host is optional for browser demos.
 */
export function mountJsonStructureEditor(container: HTMLElement, options: JsonStructureEditorOptions): JsonStructureEditorHandle {
  const session = new DocumentSession(options.uri ?? 'memory://json-structure-editor/untitled.struct.json', options.text, options.documentVersion);
  let selectedPointer: string | undefined;
  let mode: Mode = 'design';
  let disposed = false;
  let sourceEditor: MonacoEditor.IStandaloneCodeEditor | undefined;
  let sourceModel: MonacoEditor.ITextModel | undefined;
  let sourceMount = 0;
  let synchronizedRender: ReturnType<typeof setTimeout> | undefined;
  let themeName: 'dark' | 'light' | 'contrast' = 'dark';
  let pendingDiagnostic: Diagnostic['location'] | undefined;
  let externalLoad = 0;
  let externalLoadKey: string | undefined;
  let graphResizeObserver: GraphResizeObserver | undefined;
  let instanceText = '{}';
  let instanceResult: InstanceValidationResult | undefined;
  let impactDirection: ImpactDirection = 'both';
  let selectedAddIns: readonly string[] = [];
  let refactoringPlan: RefactoringPlan | undefined;
  let refactoringBinding: PreviewBinding | undefined;
  let refactoringStatus = '';
  let conversionManifest: ConversionCommandsManifest | undefined;
  let conversionCommandId: string | undefined;
  let conversionResult: ConversionResult | undefined;
  let conversionStatus = '';
  let conversionProgress: ProgressEvent | undefined;
  let conversionRequestId: string | undefined;
  let libraryEntries: readonly LibraryEntry[] | undefined;
  let libraryProviders: readonly LibraryProviderSummary[] | undefined;
  let libraryCatalog: readonly LibraryCatalogEntry[] | undefined;
  let libraryResolution: LibraryHostResolution | undefined;
  let libraryOffline = false;
  let libraryPublishDraft: LibraryPublishDraft | undefined;
  let libraryPublishPreviewState: LibraryPublishPreview | undefined;
  let libraryPublishedEpoch: string | undefined;
  let librarySelector: 'pinned' | 'floating' = 'floating';
  let libraryDocument: LibraryDocument | undefined;
  let librarySelection: readonly string[] = [];
  let libraryOperation: LibraryOperation = 'materialize';
  let libraryPlan: RefactoringPlan | undefined;
  let libraryBinding: PreviewBinding | undefined;
  let libraryStatus = '';
  const graphNavigation = new GraphNavigationController();
  const catalogRegistry = createCatalogRegistry();
  const services = options.services ?? options.host;
  const unsubscribeConversionProgress = services?.onConversionProgress?.((progress) => {
    if (!disposed && progress.requestId === conversionRequestId) { conversionProgress = progress; conversionStatus = progress.message ?? progress.phase; render(); }
  });
  const styleNonce = options.styleNonce ? ` nonce="${escapeAttribute(options.styleNonce)}"` : '';
  container.innerHTML = `<style${styleNonce}>${editorStyles}</style><main class="json-structure-editor" data-theme="dark"></main>`;
  const root = container.querySelector('.json-structure-editor') as HTMLElement;

  const setText = (text: string, documentVersion = session.snapshot().documentVersion + 1): void => {
    session.update(text, documentVersion);
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(text, session.snapshot());
  };
  const setSourceText = (text: string): void => {
    session.update(text, options.host ? session.snapshot().documentVersion : session.snapshot().documentVersion + 1);
    options.onChange?.(text, session.snapshot());
    if (synchronizedRender) clearTimeout(synchronizedRender);
    synchronizedRender = setTimeout(() => { synchronizedRender = undefined; render(); }, 120);
  };
  const select = (pointer: string | undefined, nextMode?: Mode): void => {
    selectedPointer = pointer;
    if (nextMode) mode = nextMode;
    render();
  };
  const applyCommand = async (command: { canExecute(context: { session: DocumentSession; documentVersion: number }): boolean; execute(context: { session: DocumentSession; documentVersion: number }): { edits: readonly TextEdit[] } }): Promise<string | undefined> => {
    if (options.host) {
      const hostSnapshot = await options.host.readDocument();
      session.update(hostSnapshot.text, hostSnapshot.documentVersion);
    }
    const snapshot = session.snapshot();
    const context = { session, documentVersion: snapshot.documentVersion };
    if (!command.canExecute(context)) return 'This command cannot be applied to the current selection or document state.';
    let result: { edits: readonly TextEdit[] };
    try { result = command.execute(context); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
    if (options.host) {
      const revalidated = await options.host.readDocument();
      if (revalidated.documentVersion !== snapshot.documentVersion || revalidated.text !== snapshot.text) {
        session.update(revalidated.text, revalidated.documentVersion);
        return 'The preview is stale because the document changed. Preview again before applying.';
      }
      const response = await options.host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `ui-${Date.now()}`, documentVersion: snapshot.documentVersion, edits: result.edits });
      if (!response.applied) { session.update(snapshot.text, snapshot.documentVersion); return 'The host rejected the edit. Refresh the document and try again.'; }
      const hostSnapshot = await options.host.readDocument();
      session.update(hostSnapshot.text, hostSnapshot.documentVersion);
    } else session.update(applyEdits(snapshot.text, result.edits), snapshot.documentVersion + 1);
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(session.snapshot().text, session.snapshot());
    return undefined;
  };
  const render = (): void => {
    if (disposed) return;
    syncSourceModel(sourceModel, session.snapshot().text);
    const mount = ++sourceMount;
    const preservedSource = sourceEditor ? root.querySelector('[data-source]') as HTMLElement | null : null;
    preservedSource?.remove();
    const snapshot = session.snapshot();
    const definitions = (snapshot.model?.projections.definitions ?? []).filter((definition) => definition.reusable);
    selectedPointer = selectFallback(snapshot, selectedPointer);
    const selectedDefinition = selectedPointer === '' ? undefined : definitions.find((definition) => definition.pointer === selectedPointer) ?? definitions.find((definition) => selectedPointer?.startsWith(`${definition.pointer}/properties/`));
    const definitionPointer = selectedDefinition?.pointer ?? (isInlineRootSchema(session.value) ? '' : undefined);
    const rows = definitionPointer === '' ? projectRootProperties(session.value) : projectProperties(selectedDefinition);
    const graph = projectGraph(snapshot);
    graphNavigation.reconcileSelection(graph.nodes);
    graphNavigationBySnapshot.set(snapshot, graphNavigation);
    root.innerHTML = shell(snapshot, options.title ?? 'Untitled JSON Structure', definitions.map((item) => ({ name: item.name, pointer: item.pointer, namespace: item.namespacePointer })), definitionPointer, rows, selectedPointer, mode, graphNavigation, graph);
    mountAdvancedViews(root, snapshot, definitionPointer, graph, mode, instanceText, instanceResult, impactDirection, selectedAddIns, refactoringPlan, refactoringStatus, services, conversionManifest, conversionCommandId, conversionResult, conversionStatus, conversionProgress, conversionRequestId, libraryEntries, librarySelector, libraryDocument, librarySelection, libraryOperation, libraryPlan, libraryStatus, { providers: libraryProviders, catalog: libraryCatalog, resolution: libraryResolution, offline: libraryOffline, publishDraft: libraryPublishDraft, publishPreview: libraryPublishPreviewState, publishedEpoch: libraryPublishedEpoch, documentValid: snapshot.recovery === 'valid' });
    root.dataset.theme = themeName;
    const nextSource = root.querySelector('[data-source]');
    if (preservedSource && nextSource) nextSource.replaceWith(preservedSource);
    (['design', 'graph', 'analysis', 'instance', 'conversion', 'libraries', 'source'] as const).forEach((item, index) => {
      const tab = root.querySelector(`[data-mode="${item}"]`);
      const panel = root.querySelectorAll('.js-view')[index];
      tab?.setAttribute('id', `js-tab-${item}`);
      tab?.setAttribute('aria-controls', `js-panel-${item}`);
      panel?.setAttribute('id', `js-panel-${item}`);
      panel?.setAttribute('role', 'tabpanel');
      panel?.setAttribute('aria-labelledby', `js-tab-${item}`);
    });
    wire(definitionPointer, rows, graph);
    if (sourceEditor) revealPendingDiagnostic();
    else if (mode === 'source') void mountSourceEditor(root, snapshot.text, sourceModel, setSourceText, themeName, () => !disposed && mount === sourceMount).then((mounted) => {
      if (!mounted) return;
      sourceEditor = mounted.editor;
      sourceModel = mounted.model;
      revealPendingDiagnostic();
    });
    void refreshExternalDocuments(snapshot);
  };
  const refreshExternalDocuments = async (snapshot: DocumentSnapshot): Promise<void> => {
    const readResource = options.readResource ?? options.host?.readResource;
    if (!readResource || snapshot.recovery !== 'valid') return;
    const imports = snapshot.model?.projections.imports.map((entry) => entry.source) ?? [];
    const key = `${snapshot.documentVersion}\u0000${imports.join('\u0000')}`;
    if (key === externalLoadKey) return;
    const load = ++externalLoad;
    const external = await loadExternalDocuments(snapshot.uri, imports, readResource);
    if (disposed || load !== externalLoad || session.snapshot().documentVersion !== snapshot.documentVersion) return;
    externalLoadKey = key;
    session.setExternalDocuments(external);
    render();
  };
  const wire = (definitionPointer: string | undefined, _rows: readonly PropertyRow[], graph: ReturnType<typeof projectGraph>): void => {
    const modeButtons = [...root.querySelectorAll('[data-mode]')] as HTMLButtonElement[];
    modeButtons.forEach((button, index) => {
      button.tabIndex = button.dataset.mode === mode ? 0 : -1;
      button.addEventListener('click', () => select(selectedPointer, button.dataset.mode as Mode));
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!offset) return;
        event.preventDefault();
        const next = modeButtons[(index + offset + modeButtons.length) % modeButtons.length]!;
        select(selectedPointer, next.dataset.mode as Mode);
        (root.querySelector(`[data-mode="${next.dataset.mode}"]`) as HTMLButtonElement | null)?.focus();
      });
    });
    root.querySelectorAll('[data-select]').forEach((target: HTMLButtonElement) => {
      target.addEventListener('click', () => select(target.dataset.select));
      target.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(target.dataset.select);
        }
      });
    });
    enhanceWorkbenchDom(root);
    const theme = root.querySelector('[data-theme-select]') as HTMLInputElement | null;
    if (theme) theme.value = themeName;
    theme?.addEventListener('change', () => {
      themeName = theme.value as typeof themeName;
      root.dataset.theme = themeName;
      void import('./monaco.js').then(({ setJsonEditorTheme }) => setJsonEditorTheme(themeName));
    });
    const filter = root.querySelector('.js-filter') as HTMLInputElement | null;
    filter?.addEventListener('input', () => filterTypeButtons(root, filter.value));
    root.querySelectorAll('[data-mobile-drawer]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => toggleMobileDrawer(root, button.dataset.mobileDrawer!)));
    root.querySelector('[data-show-commands]')?.addEventListener('click', () => showCommandPalette());
    root.querySelector('[data-command="add"]')?.addEventListener('click', () => openAction('property.add', definitionPointer));
    root.querySelector('[data-command="rename"]')?.addEventListener('click', () => openAction('property.rename', selectedPointer));
    root.querySelector('[data-command="edit"]')?.addEventListener('click', () => openAction('property.edit', selectedPointer));
    root.querySelector('[data-command="delete"]')?.addEventListener('click', () => openAction('property.delete', selectedPointer));
    root.querySelector('[data-action-apply]')?.addEventListener('click', () => {
      const select = root.querySelector('[data-action-select]') as HTMLInputElement;
      const action = actionById(select.value);
      const pointer = selectedPointer ?? definitionPointer;
      if (action && pointer !== undefined) showActionEditor(root, action, pointer, session, catalogRegistry, applyCommand);
    });
    function openAction(id: string, pointer: string | undefined): void {
      const action = actionById(id);
      if (action && pointer !== undefined) showActionEditor(root, action, pointer, session, catalogRegistry, applyCommand);
    }
    root.querySelectorAll('[data-problem]').forEach((button: HTMLButtonElement, index: number) => button.addEventListener('click', () => {
      pendingDiagnostic = session.snapshot().diagnostics[index]?.location;
      select(button.dataset.problem, 'source');
    }));
        const instanceInput = root.querySelector('[data-instance-input]') as HTMLTextAreaElement | null;
        instanceInput?.addEventListener('input', () => { instanceText = instanceInput.value; });
        root.querySelector('[data-instance-validate]')?.addEventListener('click', () => {
          try {
            const schema = definitionPointer === '' ? session.value : valueAtPointer(session.value, definitionPointer ?? '');
            if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Select a schema declaration first.');
            instanceResult = new InstanceWorkspace(schema as Record<string, unknown>, JSON.parse(instanceText)).validate();
          } catch (error) {
            instanceResult = { status: 'invalid', diagnostics: [{ code: 'instance.parse', message: error instanceof Error ? error.message : String(error), severity: 'error', instancePointer: '', schemaPointer: definitionPointer ?? '' }], trace: { keyword: 'parse', status: 'invalid', instancePointer: '', schemaPointer: definitionPointer ?? '', children: [] } };
          }
          render();
        });
        root.querySelectorAll('[data-instance-schema]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
          const currentSnapshot = session.snapshot();
          pendingDiagnostic = { uri: currentSnapshot.uri, pointer: button.dataset.instanceSchema ?? '', range: currentSnapshot.model?.nodes.find((node) => node.pointer === button.dataset.instanceSchema)?.range };
          select(button.dataset.instanceSchema, 'source');
        }));
    root.querySelectorAll('[data-addin]').forEach((input: HTMLInputElement) => input.addEventListener('change', () => {
      const name = input.value;
      selectedAddIns = input.checked ? [...selectedAddIns, name] : selectedAddIns.filter((candidate) => candidate !== name);
      render();
    }));
    root.querySelectorAll('[data-impact-direction]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      impactDirection = button.dataset.impactDirection as ImpactDirection;
      render();
    }));
    root.querySelector('[data-refactor-preview]')?.addEventListener('click', () => {
      const operation = (root.querySelector('[data-refactor-operation]') as HTMLInputElement | null)?.value;
      const source = (root.querySelector('[data-refactor-source]') as HTMLInputElement | null)?.value.trim() ?? '';
      const target = (root.querySelector('[data-refactor-target]') as HTMLInputElement | null)?.value.trim() ?? '';
      const name = (root.querySelector('[data-refactor-name]') as HTMLInputElement | null)?.value.trim() ?? '';
      const document = session.value;
      if (!document || typeof document !== 'object' || Array.isArray(document)) return;
      if (operation === 'move') refactoringPlan = planMoveDefinition(document as Record<string, unknown>, { sourcePointer: source, targetNamespacePointer: target || '/definitions', ...(name ? { targetName: name } : {}) });
      else if (operation === 'extract') refactoringPlan = planExtractInlineProperty(document as Record<string, unknown>, { propertyPointer: source, definitionName: name, targetNamespacePointer: target || '/definitions' });
      else if (operation === 'copy') refactoringPlan = planCopyDeclarations({ sourceDocument: document as Record<string, unknown>, targetDocument: document as Record<string, unknown>, selectedPointers: source.split(',').map((pointer: string) => pointer.trim()).filter(Boolean), targetNamespacePointer: target || '/definitions' });
      else refactoringPlan = planLocalShadow(document as Record<string, unknown>, { sourcePointer: source, targetNamespacePointer: target || '/definitions', ...(name ? { targetName: name } : {}) });
      refactoringBinding = bindPreview(session.snapshot());
      refactoringStatus = refactoringPlan.applicable ? `Preview ready: ${refactoringPlan.impact.length} changes.` : refactoringPlan.collisions.map((collision) => collision.message).join(' ');
      render();
    });
    root.querySelector('[data-refactor-apply]')?.addEventListener('click', () => {
      if (!refactoringPlan?.applicable || !refactoringBinding) return;
      const provenanceCount = refactoringPlan.provenance.length;
      void applyCommand(refactoringPlanCommand(refactoringPlan, refactoringBinding)).then((error) => {
        refactoringStatus = error ?? `Applied refactoring with ${provenanceCount} provenance records.`;
        if (!error) refactoringPlan = undefined;
        render();
      });
    });
    root.querySelector('[data-conversion-load]')?.addEventListener('click', () => void services?.listConversionCommands?.().then((manifest) => { conversionManifest = manifest; conversionCommandId = manifest.commands[0]?.id; conversionResult = undefined; conversionStatus = ''; render(); }, (error) => { conversionStatus = error instanceof Error ? error.message : String(error); render(); }));
    root.querySelector('[data-conversion-command]')?.addEventListener('change', (event: Event) => {
      conversionCommandId = (event.currentTarget as HTMLInputElement).value;
      conversionResult = undefined;
      conversionStatus = '';
      render();
    });
    root.querySelector('[data-conversion-run]')?.addEventListener('click', () => {
      const commandId = (root.querySelector('[data-conversion-command]') as HTMLInputElement | null)?.value;
      const command = conversionManifest?.commands.find((item) => item.id === commandId);
      if (!command || !services?.convert) return;
      const current = session.snapshot();
      let conversionOptions: Record<string, string | number | boolean>;
      try { conversionOptions = readConversionOptions(root); }
      catch (error) { conversionStatus = error instanceof Error ? error.message : String(error); render(); return; }
      conversionRequestId = `convert-${Date.now()}`; conversionProgress = undefined; conversionResult = undefined; conversionStatus = 'Converting...'; render();
      void services.convert({ protocolVersion: PROTOCOL_VERSION, requestId: conversionRequestId, kind: 'conversion', documentVersion: current.documentVersion, commandId: command.id, sourceName: current.uri.replace(/^.*[\\/]/, '') || 'schema.struct.json', sourceText: current.text, options: conversionOptions }).then(async (result) => {
        conversionRequestId = undefined; conversionProgress = undefined;
        conversionResult = result;
        conversionStatus = result.succeeded ? `Generated ${result.outputs.length} output${result.outputs.length === 1 ? '' : 's'}.` : result.diagnostics.map((diagnostic) => diagnostic.message).join(' ');
        if (result.succeeded && command.defaultAutoOpen && services.openGeneratedOutput) await services.openGeneratedOutput({ protocolVersion: PROTOCOL_VERSION, requestId: `open-${Date.now()}`, kind: 'open-generated-output', outputs: result.outputs });
        render();
      }, (error) => { conversionRequestId = undefined; conversionProgress = undefined; conversionStatus = error instanceof Error ? error.message : String(error); render(); });
    });
    root.querySelector('[data-conversion-cancel]')?.addEventListener('click', () => {
      if (!conversionRequestId || !services?.cancelConversion) return;
      conversionStatus = 'Cancelling...'; render();
      void services.cancelConversion(conversionRequestId).catch((error) => { conversionStatus = error instanceof Error ? error.message : String(error); render(); });
    });
    root.querySelector('[data-conversion-open]')?.addEventListener('click', () => {
      if (!conversionResult?.outputs.length || !services?.openGeneratedOutput) return;
      void services.openGeneratedOutput({ protocolVersion: PROTOCOL_VERSION, requestId: `open-${Date.now()}`, kind: 'open-generated-output', outputs: conversionResult.outputs }).then((result) => { conversionStatus = result.message ?? (result.opened ? 'Opened generated outputs.' : 'No generated outputs were opened.'); render(); }, (error) => { conversionStatus = error instanceof Error ? error.message : String(error); render(); });
    });
    root.querySelector('[data-libraries-load]')?.addEventListener('click', () => {
      if (services?.libraryRequest) {
        libraryStatus = 'Refreshing library providers and catalog...'; render();
        void Promise.all([services.libraryRequest<readonly LibraryProviderSummary[]>('listProviders'), loadLibraryCatalog(services.libraryRequest)])
          .then(([providers, catalog]) => { libraryProviders = providers; libraryCatalog = catalog; libraryResolution = undefined; libraryDocument = undefined; librarySelection = []; libraryPlan = undefined; libraryStatus = `Loaded ${catalog.length} catalog entries from ${providers.length} providers.`; render(); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); });
      } else void services?.listLibraryEntries?.().then((entries) => { libraryEntries = entries; libraryDocument = undefined; librarySelection = []; libraryPlan = undefined; libraryStatus = ''; render(); }, (error) => { libraryStatus = error instanceof Error ? error.message : String(error); render(); });
    });
    root.querySelector('[data-library-offline]')?.addEventListener('change', (event: Event) => { libraryOffline = (event.currentTarget as HTMLInputElement).checked; libraryResolution = undefined; libraryDocument = undefined; libraryPlan = undefined; render(); });
    root.querySelector('[data-provider-configure]')?.addEventListener('click', () => {
      if (!services?.libraryRequest) return;
      const id = (root.querySelector('[data-provider-id]') as HTMLInputElement | null)?.value.trim() ?? '';
      const baseUrl = (root.querySelector('[data-provider-url]') as HTMLInputElement | null)?.value.trim() ?? '';
      const credentialId = (root.querySelector('[data-provider-credential-id]') as HTMLInputElement | null)?.value.trim() ?? '';
      const credentialScheme = (root.querySelector('[data-provider-credential-scheme]') as HTMLInputElement | null)?.value.trim() ?? '';
      const secretControl = root.querySelector('[data-provider-secret]') as HTMLInputElement | null;
      const trusted = (root.querySelector('[data-provider-trusted]') as HTMLInputElement | null)?.checked === true;
      const credentialSecret = secretControl?.value;
      if (secretControl) clearCredentialSecret(secretControl);
      libraryStatus = 'Configuring provider...';
      void services.libraryRequest<LibraryProviderSummary>('configureProvider', { config: { id, kind: 'xregistry', baseUrl, ...(credentialId ? { credentialId } : {}), ...(credentialScheme ? { credentialScheme } : {}), trusted }, ...(credentialSecret ? { credentialSecret } : {}) })
        .then(() => Promise.all([services.libraryRequest!<readonly LibraryProviderSummary[]>('listProviders'), loadLibraryCatalog(services.libraryRequest!)]))
        .then(([providers, catalog]) => { libraryProviders = providers; libraryCatalog = catalog; libraryStatus = `Configured provider '${id}'.`; render(); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); });
    });
    root.querySelectorAll('[data-provider-remove]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      if (!services?.libraryRequest) return;
      const providerId = button.dataset.providerRemove;
      if (!providerId || libraryProviders?.find((provider) => provider.id === providerId)?.kind === 'bundled') return;
      void services.libraryRequest<void>('removeProvider', { providerId })
        .then(() => Promise.all([services.libraryRequest!<readonly LibraryProviderSummary[]>('listProviders'), loadLibraryCatalog(services.libraryRequest!)]))
        .then(([providers, catalog]) => { libraryProviders = providers; libraryCatalog = catalog; libraryStatus = `Removed provider '${providerId}'.`; render(); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); });
    }));
    root.querySelectorAll('[data-library-selector]').forEach((input: HTMLInputElement) => input.addEventListener('change', () => {
      if (!input.checked) return;
      librarySelector = input.value as typeof librarySelector;
      libraryDocument = undefined;
      librarySelection = [];
      libraryPlan = undefined;
      render();
    }));
    root.querySelectorAll('[data-library-read]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const [providerOrEntryId, entryOrVersion, requestedVersion] = (button.dataset.libraryRead ?? '').split('\u0000');
      const catalogEntry = libraryCatalog?.find((candidate) => candidate.providerId === providerOrEntryId && candidate.id === entryOrVersion);
      const entryId = catalogEntry ? entryOrVersion : providerOrEntryId;
      const entry = catalogEntry ?? libraryEntries?.find((candidate) => candidate.id === entryId);
      const pinnedVersion = catalogEntry ? requestedVersion : entryOrVersion;
      const version = librarySelector === 'floating' ? entry?.versions.find((candidate) => candidate.isDefault)?.version ?? entry?.versions.at(-1)?.version : pinnedVersion;
      if (services?.libraryRequest && catalogEntry && providerOrEntryId && entryId) {
        const selector = librarySelector === 'floating' ? { kind: 'floating' as const } : { kind: 'pinned' as const, version: requestedVersion ?? '' };
        libraryStatus = 'Resolving...'; render();
        void resolveLibrarySelection<LibraryHostResolution>(services.libraryRequest, { providerId: providerOrEntryId, entryId, selector, offline: libraryOffline }).then((resolution) => { libraryResolution = resolution; libraryDocument = { entryId: resolution.provenance.entryId, version: resolution.provenance.version, uri: resolution.provenance.sourceUri, value: resolution.document }; librarySelection = []; libraryPlan = undefined; libraryStatus = `Resolved ${resolution.provenance.entryId} ${resolution.provenance.version}: ${resolution.resolution.label}.`; render(); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); });
        return;
      }
      if (!entryId || !version || !services?.readLibraryDocument) return;
      libraryStatus = 'Loading...'; render();
      void services.readLibraryDocument(entryId, version).then((document) => { libraryDocument = document; librarySelection = []; libraryPlan = undefined; libraryStatus = `Resolved ${document.entryId} ${document.version}.`; render(); }, (error) => { libraryStatus = error instanceof Error ? error.message : String(error); render(); });
    }));
    root.querySelectorAll('[data-library-declaration]').forEach((input: HTMLInputElement) => input.addEventListener('change', () => {
      const pointer = input.value;
      librarySelection = input.checked ? [...librarySelection, pointer] : librarySelection.filter((candidate) => candidate !== pointer);
      libraryPlan = undefined;
    }));
    root.querySelector('[data-library-operation]')?.addEventListener('change', (event: Event) => {
      libraryOperation = (event.currentTarget as HTMLInputElement).value as LibraryOperation;
      libraryPlan = undefined;
      render();
    });
    root.querySelector('[data-library-preview]')?.addEventListener('click', () => {
      if (!libraryDocument || !session.value || typeof session.value !== 'object' || Array.isArray(session.value)) return;
      const destination = (root.querySelector('[data-library-destination]') as HTMLInputElement | null)?.value.trim() || '/definitions';
      const importPointer = libraryOperation === 'materialize'
        ? (root.querySelector('[data-library-materialize-import]') as HTMLInputElement | null)?.value.trim() ?? window.prompt('Authored import pointer to materialize', '')?.trim() ?? ''
        : '';
      if (libraryOperation === 'import') {
        const keyword = (root.querySelector('[data-library-import-keyword]') as HTMLInputElement | null)?.value as '$import' | '$importdefs' | undefined;
        libraryPlan = planAddImport(session.value as Record<string, unknown>, { destinationPointer: destination, source: libraryDocument.uri, keyword });
      } else if (libraryResolution) {
        try {
          const provenance: LibraryProvenance = libraryResolution.provenance;
          const domainPlan = libraryOperation === 'copy'
            ? planLibraryCopy(libraryDocument.value, session.value, librarySelection, destination, provenance)
            : planLibraryMaterialization(libraryDocument.value, session.value, librarySelection, destination, importPointer, provenance);
          libraryPlan = libraryOperationsRefactoringPlan(session.value as Record<string, unknown>, domainPlan.operations, domainPlan.kind === 'materialize' ? domainPlan.importPointer : undefined);
        } catch (error) {
          libraryPlan = undefined;
          libraryStatus = error instanceof CopyCollisionError ? error.message : libraryConflictMessage(error);
          render(); return;
        }
      } else {
        if (!librarySelection.length) return;
        libraryPlan = libraryOperation === 'copy'
          ? planCopyDeclarations({ sourceDocument: libraryDocument.value as Record<string, unknown>, selectedPointers: librarySelection, targetDocument: session.value as Record<string, unknown>, targetNamespacePointer: destination })
          : planMaterializeDeclarations({ sourceDocument: libraryDocument.value as Record<string, unknown>, selectedPointers: librarySelection, targetDocument: session.value as Record<string, unknown>, targetNamespacePointer: destination, importPointer, importSource: libraryDocument.uri });
      }
      libraryBinding = bindPreview(session.snapshot());
      const previewPlan = libraryPlan;
      libraryStatus = previewPlan?.applicable ? `Preview ready: ${previewPlan.impact.length} changes.` : previewPlan?.collisions.map((collision) => collision.message).join(' ') ?? 'Preview could not be created.';
      render();
    });
    root.querySelector('[data-library-apply]')?.addEventListener('click', () => {
      if (!libraryPlan?.applicable || !libraryBinding) return;
      void applyCommand(refactoringPlanCommand(libraryPlan, libraryBinding)).then((error) => {
        libraryStatus = error ?? `Applied ${libraryOperation} with ${libraryPlan?.provenance.length ?? 0} provenance records.`;
        if (!error) { libraryPlan = undefined; librarySelection = []; }
        render();
      });
    });
    root.querySelector('[data-library-publish-preview]')?.addEventListener('click', () => {
      const expectedEpoch = (root.querySelector('[data-publish-epoch]') as HTMLInputElement | null)?.value.trim();
      libraryPublishDraft = {
        providerId: (root.querySelector('[data-publish-provider]') as HTMLInputElement | null)?.value ?? '',
        entryId: (root.querySelector('[data-publish-entry]') as HTMLInputElement | null)?.value.trim() ?? '',
        version: (root.querySelector('[data-publish-version]') as HTMLInputElement | null)?.value.trim() ?? '',
        sourceUri: (root.querySelector('[data-publish-source]') as HTMLInputElement | null)?.value.trim() ?? '',
        promoteDefault: (root.querySelector('[data-publish-default]') as HTMLInputElement | null)?.checked === true,
        ...(expectedEpoch ? { expectedEpoch } : {}),
      };
      libraryPublishPreviewState = libraryPublishPreview(libraryPublishDraft, libraryProviders ?? [], libraryCatalog ?? [], session.snapshot().recovery === 'valid');
      libraryPublishedEpoch = undefined;
      libraryStatus = libraryPublishPreviewState.valid ? 'Publish preview ready. Review collision risks, then publish explicitly.' : 'Publish preview is invalid. Select a non-bundled provider and provide entry, version, source URI, and valid JSON.';
      render();
    });
    root.querySelector('[data-library-publish]')?.addEventListener('click', () => {
      if (!services?.libraryRequest || !libraryPublishPreviewState?.valid || !libraryPublishDraft || session.snapshot().recovery !== 'valid') return;
      libraryStatus = 'Publishing...'; render();
      void services.libraryRequest<{ epoch: string }>('publish', { ...libraryPublishDraft, document: session.value }).then((result) => { libraryPublishedEpoch = result.epoch; libraryPublishPreviewState = undefined; libraryStatus = `Published ${libraryPublishDraft?.entryId}@${libraryPublishDraft?.version}; resulting epoch ${result.epoch}.`; render(); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); });
    });
    wireGraph(graph);
  };
  const wireGraph = (_graph: ReturnType<typeof projectGraph>): void => {
    graphResizeObserver?.disconnect();
    root.querySelectorAll('[data-graph-select]').forEach((target: SVGElement) => {
      const activate = (): void => { const pointer = target.dataset.graphSelect; if (!pointer) return; selectedPointer = pointer; graphNavigation.navigate({ kind: 'type', nodeId: pointer, pointer }, 'graph'); render(); };
      target.addEventListener('click', activate);
      target.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    });
    root.querySelector('[data-graph-fit]')?.addEventListener('click', () => { graphNavigation.fit(); render(); });
    root.querySelector('[data-graph-back]')?.addEventListener('click', () => { selectedPointer = graphNavigation.back().selection?.pointer; render(); });
    root.querySelector('[data-graph-forward]')?.addEventListener('click', () => { selectedPointer = graphNavigation.forward().selection?.pointer; render(); });
    const canvas = root.querySelector('[data-graph-canvas]') as SVGElement | null;
    if (!canvas) return;
    const syncViewport = () => { const bounds = canvas.getBoundingClientRect(); graphNavigation.setViewport({ x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }); return bounds; };
    syncViewport();
    const ResizeObserverConstructor = (globalThis as unknown as { ResizeObserver?: new (callback: () => void) => GraphResizeObserver }).ResizeObserver;
    if (ResizeObserverConstructor) {
      graphResizeObserver = new ResizeObserverConstructor(() => { if (!disposed && canvas.isConnected) syncViewport(); });
      graphResizeObserver.observe(canvas);
    }
    canvas.addEventListener('wheel', (event: WheelEvent) => { event.preventDefault(); const bounds = syncViewport(); graphNavigation.wheelZoom({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, event.deltaY); render(); }, { passive: false });
    let lastPoint: { x: number; y: number } | undefined;
    canvas.addEventListener('pointerdown', (event: PointerEvent) => { if ((event.target as SVGElement).closest('[data-graph-select], [data-minimap]')) return; lastPoint = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', (event: PointerEvent) => { if (!lastPoint) return; graphNavigation.pan({ x: event.clientX - lastPoint.x, y: event.clientY - lastPoint.y }); lastPoint = { x: event.clientX, y: event.clientY }; render(); });
    canvas.addEventListener('pointerup', () => { lastPoint = undefined; });
    root.querySelector('[data-minimap]')?.addEventListener('click', (event: Event) => { const target = event.currentTarget as SVGElement; const bounds = target.getBoundingClientRect(); const pointer = event as PointerEvent; graphNavigation.navigateMinimap({ x: ((pointer.clientX - bounds.left) / Math.max(1, bounds.width)) * 180, y: ((pointer.clientY - bounds.top) / Math.max(1, bounds.height)) * 120 }, { x: 0, y: 0, width: 180, height: 120 }); render(); });
  };
  const showCommandPalette = (): void => {
    const pointer = selectedPointer ?? selectFallback(session.snapshot(), selectedPointer);
    if (pointer === undefined) return;
    showActionPalette(root, pointer, session, catalogRegistry, applyCommand);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      showCommandPalette();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  render();
  function revealPendingDiagnostic(): void {
    if (!pendingDiagnostic?.range || !sourceEditor || !sourceModel) return;
    const { start, end, startOffset, endOffset } = pendingDiagnostic.range;
    const from = startOffset === undefined ? { lineNumber: start.line + 1, column: start.column + 1 } : sourceModel.getPositionAt(startOffset);
    const to = endOffset === undefined ? { lineNumber: end.line + 1, column: end.column + 1 } : sourceModel.getPositionAt(endOffset);
    const range = { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
    sourceEditor.setSelection(range);
    sourceEditor.revealRangeInCenter(range);
    sourceEditor.focus();
    pendingDiagnostic = undefined;
  }
  return { setText, getText: () => session.snapshot().text, showCommandPalette, dispose: () => { disposed = true; unsubscribeConversionProgress?.(); if (synchronizedRender) clearTimeout(synchronizedRender); graphResizeObserver?.disconnect(); window.removeEventListener('keydown', onKeyDown); sourceEditor?.dispose(); sourceModel?.dispose(); container.innerHTML = ''; } };
}

interface LibraryWorkbenchState {
  readonly providers?: readonly LibraryProviderSummary[];
  readonly catalog?: readonly LibraryCatalogEntry[];
  readonly resolution?: LibraryHostResolution;
  readonly offline: boolean;
  readonly publishDraft?: LibraryPublishDraft;
  readonly publishPreview?: LibraryPublishPreview;
  readonly publishedEpoch?: string;
  readonly documentValid: boolean;
}

function mountAdvancedViews(root: HTMLElement, snapshot: DocumentSnapshot, definitionPointer: string | undefined, graph: ReturnType<typeof projectGraph>, mode: Mode, instanceText: string, instanceResult: InstanceValidationResult | undefined, impactDirection: ImpactDirection, selectedAddIns: readonly string[], refactoringPlan: RefactoringPlan | undefined, refactoringStatus: string, host: EditorServices | undefined, conversionManifest: ConversionCommandsManifest | undefined, conversionCommandId: string | undefined, conversionResult: ConversionResult | undefined, conversionStatus: string, conversionProgress: ProgressEvent | undefined, conversionRequestId: string | undefined, libraryEntries: readonly LibraryEntry[] | undefined, librarySelector: 'pinned' | 'floating', libraryDocument: LibraryDocument | undefined, librarySelection: readonly string[], libraryOperation: LibraryOperation, libraryPlan: RefactoringPlan | undefined, libraryStatus: string, libraryState: LibraryWorkbenchState): void {
  const sourceTab = root.querySelector('[data-mode="source"]');
  sourceTab?.insertAdjacentHTML('beforebegin', `<button role="tab" data-mode="analysis" aria-selected="${mode === 'analysis'}">Analysis</button><button role="tab" data-mode="instance" aria-selected="${mode === 'instance'}">Instance</button><button role="tab" data-mode="conversion" aria-selected="${mode === 'conversion'}">Conversion</button><button role="tab" data-mode="libraries" aria-selected="${mode === 'libraries'}">Libraries</button>`);
  const sourcePanel = root.querySelector('.js-source-view');
  sourcePanel?.insertAdjacentHTML('beforebegin', `<section class="js-view" ${mode === 'analysis' ? '' : 'hidden'}>${analysisView(snapshot, definitionPointer, graph, impactDirection, refactoringPlan, refactoringStatus, selectedAddIns)}</section><section class="js-view" ${mode === 'instance' ? '' : 'hidden'}>${instanceView(instanceText, instanceResult)}</section><section class="js-view" ${mode === 'conversion' ? '' : 'hidden'}>${conversionView(host, conversionManifest, conversionCommandId, conversionResult, conversionStatus, conversionProgress, conversionRequestId)}</section><section class="js-view" ${mode === 'libraries' ? '' : 'hidden'}>${librariesView(host, libraryEntries, librarySelector, libraryDocument, librarySelection, libraryOperation, libraryPlan, libraryStatus, libraryState)}</section>`);
}

export function conversionView(host: EditorServices | undefined, manifest: ConversionCommandsManifest | undefined, commandId: string | undefined, result: ConversionResult | undefined, status: string, progress?: ProgressEvent, requestId?: string): string {
  if (!host?.listConversionCommands || !host.convert) return '<div class="js-sheet"><h1>Conversion</h1><p class="js-description">This host does not provide conversion tools.</p></div>';
  const selected = manifest?.commands.find((command) => command.id === commandId) ?? manifest?.commands[0];
  const converter = manifest?.converters.find((item) => item.id === selected?.converterId);
  const diagnostics = result?.diagnostics.map((diagnostic) => `<div class="js-problem"><span class="js-problem-${diagnostic.severity}">${diagnostic.severity === 'error' ? 'x' : '!'}</span><span><span class="js-code">${escapeHtml(diagnostic.code)}</span> ${escapeHtml(diagnostic.message)}</span></div>`).join('') ?? '';
  const outputs = result?.outputs.map((output) => `<div class="js-analysis-row"><span>${escapeHtml(output.name)}</span><span class="js-code">${escapeHtml(output.uri)}</span></div>`).join('') ?? '';
  const progressView = requestId ? `<div class="js-section-head"><progress max="100" value="${progress?.percent ?? 0}" aria-label="Conversion progress"></progress>${host.cancelConversion ? '<button data-conversion-cancel>Cancel</button>' : ''}</div>` : '';
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Toolchain</div><h1>Conversion</h1><p class="js-description">Run a packaged converter against the current document.</p></div><button data-conversion-load>${manifest ? 'Refresh' : 'Load converters'}</button></header>${manifest ? `<label>Command<select class="js-service-select" data-conversion-command>${manifest.commands.map((command) => `<option value="${escapeAttribute(command.id)}" ${command.id === selected?.id ? 'selected' : ''}>${escapeHtml(command.label)} (${escapeHtml(command.sourceFormat)} -> ${escapeHtml(command.targetFormat)})</option>`).join('')}</select></label><fieldset><legend>Options</legend>${converter?.options.map(conversionOptionControl).join('') || '<p class="js-description">This converter has no options.</p>'}</fieldset><button data-conversion-run ${requestId ? 'disabled' : ''}>Run conversion</button>` : ''}${progressView}<p role="status" aria-live="polite">${escapeHtml(status)}</p>${result ? `<section><div class="js-section-head"><h2>Outputs (${result.outputs.length})</h2>${result.outputs.length && host.openGeneratedOutput ? '<button data-conversion-open>Open outputs</button>' : ''}</div>${outputs || '<p class="js-description">No output files were committed.</p>'}</section><section><h2>Diagnostics (${result.diagnostics.length})</h2>${diagnostics || '<p class="js-description">No conversion warnings or errors.</p>'}</section>` : ''}</div>`;
}

function conversionOptionControl(option: import('../conversion/types.js').ConversionOption): string {
  const description = option.description ? `<span class="js-description">${escapeHtml(option.description)}</span>` : '';
  if (option.type === 'boolean') return `<label><input type="checkbox" data-conversion-option="${escapeAttribute(option.name)}" data-option-type="boolean" ${option.default ? 'checked' : ''}>${escapeHtml(option.name)}${description}</label>`;
  if (option.type === 'string' && option.allowedValues) return `<label>${escapeHtml(option.name)}<select data-conversion-option="${escapeAttribute(option.name)}" data-option-type="string">${option.allowedValues.map((value) => `<option value="${escapeAttribute(value)}" ${value === option.default ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>${description}</label>`;
  const constraints = option.type === 'number' ? `${option.minimum === undefined ? '' : ` min="${option.minimum}"`}${option.maximum === undefined ? '' : ` max="${option.maximum}"`}` : '';
  return `<label>${escapeHtml(option.name)}<input data-conversion-option="${escapeAttribute(option.name)}" data-option-type="${option.type}" type="${option.type === 'number' ? 'number' : 'text'}" value="${escapeAttribute(String(option.default ?? ''))}"${constraints}>${description}</label>`;
}

function readConversionOptions(root: HTMLElement): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  root.querySelectorAll('[data-conversion-option]').forEach((control: HTMLInputElement) => {
    const name = control.dataset.conversionOption;
    if (!name) return;
    if (control.dataset.optionType === 'boolean') result[name] = (control as HTMLInputElement).checked;
    else if (control.dataset.optionType === 'number') {
      const value = (control as HTMLInputElement).valueAsNumber;
      if (!Number.isFinite(value)) throw new Error(`Option ${name} must be a number.`);
      result[name] = value;
    } else result[name] = control.value;
  });
  return result;
}

export function librariesView(host: EditorServices | undefined, entries: readonly LibraryEntry[] | undefined, selector: 'pinned' | 'floating', document: LibraryDocument | undefined, selection: readonly string[], operation: LibraryOperation = 'materialize', plan?: RefactoringPlan, status = '', state?: LibraryWorkbenchState): string {
  if (!host?.libraryRequest && (!host?.listLibraryEntries || !host.readLibraryDocument)) return '<div class="js-sheet"><h1>Libraries</h1><p class="js-description">This host does not provide library catalogs.</p></div>';
  const definitions = document && document.value && typeof document.value === 'object' && !Array.isArray(document.value) ? (document.value as Record<string, unknown>).definitions : undefined;
  const declarationPointers = definitions && typeof definitions === 'object' && !Array.isArray(definitions) ? Object.keys(definitions).map((name) => `/definitions/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`) : [];
  const preview = plan ? `<section><h2>${escapeHtml(operation[0]!.toUpperCase() + operation.slice(1))} preview</h2>${plan.impact.map((impact) => `<div class="js-analysis-row"><span>${escapeHtml(impact.kind)}</span><span class="js-code">${escapeHtml(impact.pointer)}</span></div>`).join('')}${plan.collisions.map((collision) => `<p class="js-problem-warning">${escapeHtml(collision.message)}</p>`).join('')}${plan.provenance.map((entry) => `<p class="js-description">${escapeHtml(entry.reason)}: ${escapeHtml(entry.sourcePointer)} -> ${escapeHtml(entry.targetPointer)}</p>`).join('')}${plan.applicable ? `<button data-library-apply>Apply ${escapeHtml(operation)}</button>` : ''}</section>` : '';
  const requestBacked = Boolean(host.libraryRequest);
  const catalog = requestBacked ? state?.catalog : undefined;
  const listedEntries = catalog ?? entries?.map((entry) => ({ providerId: '', ...entry }));
  const providers = state?.providers ?? [];
  const providerView = requestBacked ? `<section><h2>Providers</h2>${providers.map((provider) => `<div class="js-analysis-row"><span><strong>${escapeHtml(provider.id)}</strong> <span class="js-chip">${escapeHtml(provider.kind)}</span><br><span class="js-description">${escapeHtml(provider.location)} | ${provider.trusted ? 'trusted' : 'untrusted'} | credential ${provider.credentialConfigured ? 'configured' : 'not configured'} | publishing ${provider.publishSupported ? 'supported' : 'unsupported'}</span></span>${provider.kind === 'bundled' ? '<span class="js-description">required</span>' : `<button data-provider-remove="${escapeAttribute(provider.id)}">Remove</button>`}</div>`).join('') || '<p class="js-description">Load providers to manage them.</p>'}<fieldset><legend>Configure HTTPS xRegistry provider</legend><div class="js-library-form"><label>Provider id<input data-provider-id autocomplete="off"></label><label>Base URL<input data-provider-url type="url" inputmode="url" placeholder="https://registry.example"></label><label>Credential id (optional)<input data-provider-credential-id autocomplete="off"></label><label>Credential scheme (optional)<select data-provider-credential-scheme><option value="">Default (Bearer)</option><option value="Bearer">Bearer</option><option value="Basic">Basic</option><option value="API-Key">API-Key</option></select></label><label>Credential secret (write-only)<input data-provider-secret type="password" autocomplete="new-password"></label></div><label><input data-provider-trusted type="checkbox"> I explicitly trust this provider and its HTTPS origin.</label><button data-provider-configure>Configure provider</button></fieldset></section>` : '';
  const catalogView = listedEntries?.map((entry) => `<section class="js-library-entry"><div class="js-section-head"><div><div class="js-eyebrow">${escapeHtml(entry.providerId || 'Bundled static provider')}</div><h2>${escapeHtml(entry.name)}</h2></div></div><p>${escapeHtml(entry.description ?? entry.id)}</p>${entry.versions.map((version) => `<button data-library-read="${escapeAttribute(requestBacked ? `${entry.providerId}\u0000${entry.id}\u0000${version.version}` : `${entry.id}\u0000${version.version}`)}">${selector === 'floating' ? `Resolve default (${escapeHtml(entry.versions.find((candidate) => candidate.isDefault)?.version ?? version.version)})` : `Resolve ${escapeHtml(version.version)}`}${version.integrity ? ' | integrity declared' : ''}</button>`).join('')}</section>`).join('') ?? '';
  const resolution = state?.resolution;
  const resolutionView = resolution ? `<div class="js-resolution"><p><strong>${escapeHtml(resolution.resolution.label)}</strong> | ${escapeHtml(resolution.resolution.state.connectivity)} | ${escapeHtml(resolution.resolution.state.verification)} | source ${escapeHtml(resolution.resolution.source)}</p><p>${resolution.trust.trusted ? 'Trusted resolution.' : 'Untrusted resolution.'}</p>${resolution.trust.reasons.map((reason) => `<p class="js-problem-warning">${escapeHtml(reason)}</p>`).join('')}<dl><dt>Provider</dt><dd>${escapeHtml(resolution.provenance.providerId)}</dd><dt>Entry</dt><dd>${escapeHtml(resolution.provenance.entryId)}</dd><dt>Version</dt><dd>${escapeHtml(resolution.provenance.version)}</dd><dt>Source URI</dt><dd class="js-code">${escapeHtml(resolution.provenance.sourceUri)}</dd></dl></div>` : '';
  const publishableProviders = providers.filter((provider) => provider.publishSupported);
  const draft = state?.publishDraft;
  const publishView = requestBacked ? `<section><h2>Publish current document</h2><div class="js-library-form"><label>Provider<select data-publish-provider><option value="">Select provider</option>${publishableProviders.map((provider) => `<option value="${escapeAttribute(provider.id)}" ${draft?.providerId === provider.id ? 'selected' : ''}>${escapeHtml(provider.id)}</option>`).join('')}</select></label><label>Entry id<input data-publish-entry value="${escapeAttribute(draft?.entryId ?? '')}"></label><label>Version<input data-publish-version value="${escapeAttribute(draft?.version ?? '')}"></label><label>Source URI<input data-publish-source type="url" value="${escapeAttribute(draft?.sourceUri ?? '')}"></label><label>Expected epoch (optional)<input data-publish-epoch value="${escapeAttribute(draft?.expectedEpoch ?? '')}"></label></div><label><input data-publish-default type="checkbox" ${draft?.promoteDefault ? 'checked' : ''}> Promote as default version</label><button data-library-publish-preview ${state?.documentValid ? '' : 'disabled'}>Preview publish</button>${state?.publishPreview ? `<div class="js-resolution"><p class="js-code">${escapeHtml(state.publishPreview.summary)}</p>${state.publishPreview.collisionRisks.map((risk) => `<p class="js-problem-warning">${escapeHtml(risk)}</p>`).join('') || '<p>No catalog collision detected.</p>'}<button data-library-publish ${state.publishPreview.valid ? '' : 'disabled'}>Publish</button></div>` : ''}${state?.publishedEpoch ? `<p>Resulting epoch: <strong>${escapeHtml(state.publishedEpoch)}</strong></p>` : ''}</section>` : '';
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Catalogs</div><h1>Libraries</h1><p class="js-description">Resolve versioned catalogs, import references, or copy declarations into this document.</p></div><button data-libraries-load>${listedEntries ? 'Refresh catalog' : 'Load libraries'}</button></header>${providerView}<fieldset><legend>Resolution policy</legend><label><input type="radio" name="library-selector" value="floating" data-library-selector ${selector === 'floating' ? 'checked' : ''}>Floating default</label><label><input type="radio" name="library-selector" value="pinned" data-library-selector ${selector === 'pinned' ? 'checked' : ''}>Pinned version</label>${requestBacked ? `<label><input type="checkbox" data-library-offline ${state?.offline ? 'checked' : ''}> Offline mode (resolve from cache)</label>` : ''}</fieldset>${catalogView}${document ? `<section><div class="js-section-head"><div><div class="js-eyebrow">${resolution ? `${escapeHtml(resolution.provenance.providerId)} | ${resolution.trust.trusted ? 'trusted' : 'untrusted'} | ${selector}` : `Bundled static provider | trusted | ${selector}`}</div><h2>${escapeHtml(document.entryId)} ${escapeHtml(document.version)}</h2></div><span class="js-chip">resolved</span></div>${resolutionView}<p class="js-code">${escapeHtml(document.uri)}</p><div class="js-analysis-grid"><label>Operation<select data-library-operation><option value="import" ${operation === 'import' ? 'selected' : ''}>Import reference</option><option value="copy" ${operation === 'copy' ? 'selected' : ''}>Copy declarations</option><option value="materialize" ${operation === 'materialize' ? 'selected' : ''}>Materialize declarations</option></select></label><label>Destination pointer<input data-library-destination value="/definitions"></label>${operation === 'import' ? '<label>Import keyword<select data-library-import-keyword><option value="$importdefs">$importdefs</option><option value="$import">$import</option></select></label>' : ''}</div>${operation === 'import' ? '' : `<fieldset><legend>Declarations</legend>${declarationPointers.map((pointer) => `<label><input type="checkbox" data-library-declaration value="${escapeAttribute(pointer)}" ${selection.includes(pointer) ? 'checked' : ''}>${escapeHtml(pointerLabel(pointer))}</label>`).join('') || '<p class="js-description">No reusable declarations.</p>'}</fieldset>`}<button data-library-preview ${operation === 'import' || selection.length ? '' : 'disabled'}>Preview ${escapeHtml(operation)}</button></section>` : ''}${preview}${publishView}<p role="status" aria-live="polite">${escapeHtml(status)}</p></div>`;
}

function libraryOperationsRefactoringPlan(targetDocument: Record<string, unknown>, operations: readonly CopyOperation[], importPointer?: string): RefactoringPlan {
  const resultingDocument = JSON.parse(JSON.stringify(targetDocument)) as Record<string, unknown>;
  const impact: Array<RefactoringPlan['impact'][number]> = [];
  const provenance: Array<{ sourcePointer: string; targetPointer: string; reason: 'selected' }> = [];
  for (const operation of operations) {
    setPointerValue(resultingDocument, operation.destinationPointer, operation.value);
    impact.push({ kind: 'add', pointer: operation.destinationPointer, to: operation.value });
    provenance.push({ sourcePointer: `${operation.provenance.providerId}:${operation.provenance.entryId}@${operation.provenance.version}${operation.provenance.sourcePointer ?? operation.sourcePointer} (${operation.provenance.sourceUri})`, targetPointer: operation.destinationPointer, reason: 'selected' });
  }
  if (importPointer) {
    const tokens = pointerTokens(importPointer);
    let parent: Record<string, unknown> = resultingDocument;
    for (const token of tokens.slice(0, -1)) parent = parent[token] as Record<string, unknown>;
    const name = tokens.at(-1)!;
    impact.push({ kind: 'remove', pointer: importPointer, from: parent[name] });
    delete parent[name];
  }
  return { applicable: true, resultingDocument, preview: impact, impact, collisions: [], provenance, referenceRewrites: {} };
}

function setPointerValue(document: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = pointer.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  let parent: Record<string, unknown> = document;
  for (const token of tokens.slice(0, -1)) {
    const next = parent[token];
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`Destination '${pointer}' is not an object path.`);
    parent = next as Record<string, unknown>;
  }
  parent[tokens.at(-1)!] = JSON.parse(JSON.stringify(value)) as unknown;
}

export interface PreviewBinding { readonly documentVersion: number; readonly sourceText: string }

export function bindPreview(snapshot: Pick<DocumentSnapshot, 'documentVersion' | 'text'>): PreviewBinding {
  return { documentVersion: snapshot.documentVersion, sourceText: snapshot.text };
}

export function refactoringPlanCommand(plan: RefactoringPlan, binding: PreviewBinding): { canExecute(context: { session: DocumentSession; documentVersion: number }): boolean; execute(context: { session: DocumentSession; documentVersion: number }): { edits: readonly TextEdit[] } } {
  return {
    canExecute: ({ session, documentVersion }) => {
      const snapshot = session.snapshot();
      return plan.applicable && snapshot.recovery === 'valid' && documentVersion === binding.documentVersion && snapshot.documentVersion === binding.documentVersion && snapshot.text === binding.sourceText;
    },
    execute: ({ session, documentVersion }) => {
      const snapshot = session.snapshot();
      if (!plan.applicable || snapshot.recovery !== 'valid' || documentVersion !== binding.documentVersion || snapshot.documentVersion !== binding.documentVersion || snapshot.text !== binding.sourceText) {
        throw new Error('The preview is stale because the document changed. Preview again before applying.');
      }
      return { edits: pointerScopedPlanEdits(snapshot, plan) };
    }
  };
}

function pointerScopedPlanEdits(snapshot: DocumentSnapshot, plan: RefactoringPlan): readonly TextEdit[] {
  const source = snapshot.text;
  const nodes = snapshot.model?.nodes ?? [];
  const edits: TextEdit[] = [];
  const additions = new Map<string, Array<{ name: string; value: unknown }>>();
  const addedPointers = plan.impact.filter((impact) => impact.kind === 'add').map((impact) => impact.pointer);
  for (const impact of plan.impact) {
    if (impact.kind === 'rewrite-reference' && addedPointers.some((pointer) => impact.pointer.startsWith(`${pointer}/`))) continue;
    const tokens = pointerTokens(impact.pointer);
    const node = nodes.find((candidate) => candidate.pointer === impact.pointer);
    if (impact.kind === 'add') {
      const parentPointer = formatPointer(tokens.slice(0, -1));
      const entries = additions.get(parentPointer) ?? [];
      entries.push({ name: tokens.at(-1)!, value: impact.to });
      additions.set(parentPointer, entries);
    } else if (impact.kind === 'remove') {
      if (!node?.keyRange || !node.range) throw new Error(`Source range is unavailable for ${impact.pointer}.`);
      edits.push(removeMemberEdit(source, nodes.find((candidate) => candidate.pointer === formatPointer(tokens.slice(0, -1)))?.range, node.keyRange, node.range));
    } else {
      if (!node?.range) throw new Error(`Source range is unavailable for ${impact.pointer}.`);
      edits.push({ range: node.range, newText: JSON.stringify(impact.to) });
    }
  }
  for (const [parentPointer, entries] of additions) {
    const parent = nodes.find((candidate) => candidate.pointer === parentPointer)?.range;
    if (parent?.startOffset === undefined || parent.endOffset === undefined) throw new Error(`Destination range is unavailable for ${parentPointer}.`);
    const close = parent.endOffset - 1;
    const body = source.slice(parent.startOffset + 1, close);
    const multiline = body.includes('\n');
    const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
    const separator = body.trim() ? (multiline ? `,\n${indent}` : ',') : '';
    const joined = entries.map((entry) => `${JSON.stringify(entry.name)}:${multiline ? ' ' : ''}${JSON.stringify(entry.value)}`).join(multiline ? `,\n${indent}` : ',');
    edits.push({ range: rangeFor(source, close, close), newText: `${separator}${joined}` });
  }
  return edits;
}

function removeMemberEdit(source: string, parentRange: import('../contracts.js').TextRange | undefined, keyRange: import('../contracts.js').TextRange, valueRange: import('../contracts.js').TextRange): TextEdit {
  if (parentRange?.startOffset === undefined || parentRange.endOffset === undefined || keyRange.startOffset === undefined || valueRange.endOffset === undefined) throw new Error('Member source range is unavailable.');
  let start = keyRange.startOffset;
  let end = valueRange.endOffset;
  let before = start - 1;
  while (before > parentRange.startOffset && /\s/.test(source[before] ?? '')) before--;
  if (source[before] === ',') start = before;
  else {
    let after = end;
    while (after < parentRange.endOffset && /\s/.test(source[after] ?? '')) after++;
    if (source[after] === ',') end = after + 1;
  }
  return { range: rangeFor(source, start, end), newText: '' };
}

function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function formatPointer(tokens: readonly string[]): string { return tokens.length ? `/${tokens.map((token) => token.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` : ''; }

function shell(snapshot: DocumentSnapshot, title: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly namespace: string }[], definitionPointer: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, mode: Mode, graphNavigation: GraphNavigationController, graph: ReturnType<typeof projectGraph>): string {
  const definition = snapshot.model?.projections.definitions.find((item) => item.pointer === definitionPointer);
  const selectedProperty = rows.find((row) => row.pointer === selectedPointer);
  const selectedDiagnostics = diagnosticsForPointer(snapshot.diagnostics, selectedPointer);
  void graphNavigation;
  void graph;
  return `<div class="js-shell"><header class="js-title"><span class="js-mark" aria-hidden="true"></span><strong>JSON Structure</strong><button class="js-command-trigger" data-show-commands title="Show Commands (Ctrl+Shift+P)" aria-label="Show Commands">&gt;_</button><span class="js-file">${escapeHtml(title)}</span><label class="js-theme-label">Theme <select class="js-theme" data-theme-select aria-label="Color theme"><option value="dark">Dark</option><option value="light">Light</option><option value="contrast">High contrast</option></select></label></header><div class="js-workbench"><aside class="js-outline"><div class="js-panel-head">Types and namespaces</div><input class="js-filter" type="search" placeholder="Filter types" aria-label="Filter types"><div class="js-tree-group">${definitions.length} definitions</div>${definitions.map((item) => `<button class="js-tree-item" data-select="${escapeAttribute(item.pointer)}" aria-current="${item.pointer === definitionPointer}"><span class="js-kind">{ }</span><span>${escapeHtml(item.name)}</span></button>`).join('') || '<div class="js-empty">No reusable types found.</div>'}</aside><section class="js-center"><nav class="js-tabs" role="tablist" aria-label="Editor mode">${(['design', 'graph', 'source'] as const).map((item) => `<button role="tab" data-mode="${item}" aria-selected="${mode === item}">${item[0]!.toUpperCase()}${item.slice(1)}</button>`).join('')}</nav><section class="js-view" ${mode === 'design' ? '' : 'hidden'}>${designView(definition?.name, definition?.type, definition?.description, rows, selectedPointer)}</section><section class="js-view js-graph" ${mode === 'graph' ? '' : 'hidden'}>${graphView(snapshot, selectedPointer)}</section><section class="js-view js-source-view" ${mode === 'source' ? '' : 'hidden'}><div class="js-source" data-source aria-label="JSON source editor"></div></section></section><aside class="js-inspector"><div class="js-panel-head">Inspector</div>${inspector(selectedProperty, definition, selectedDiagnostics)}</aside><section class="js-problems"><div class="js-panel-head">Problems <span style="margin-left:auto">${snapshot.diagnostics.length}</span></div>${problems(snapshot.diagnostics)}</section></div><footer class="js-status"><span>${escapeHtml(snapshot.recovery)}</span><span>${definitions.length} types</span><span>${snapshot.diagnostics.length} diagnostics</span><span>${selectedPointer ? escapeHtml(selectedPointer) : 'No selection'}</span></footer></div>`;
}

/*
  const value = snapshot.recovery === 'valid' ? JSON.parse(snapshot.text) : {};
  const effective = pointer !== undefined && snapshot.recovery === 'valid' ? resolveEffectiveMembers(value, pointer, { addIns: selectedAddIns }) : undefined;
  const runtime = new GraphRuntime({ nodes: graph.nodes.map((node) => ({ id: node.id, namespace: node.namespace, label: node.label })), edges: graph.edges.filter((edge) => graph.nodes.some((node) => node.id === edge.from) && graph.nodes.some((node) => node.id === edge.to)).map((edge, index) => ({ id: `${edge.kind}:${index}`, source: edge.from, target: edge.to, label: edge.label })), rootId: graph.nodes.find((node) => node.kind === 'document')?.id });
  const offers = value && typeof value === 'object' && !Array.isArray(value) && value.$offers && typeof value.$offers === 'object' && !Array.isArray(value.$offers) ? Object.keys(value.$offers) : [];
  const addIns = offers.length ? `<fieldset><legend>Offered add-ins</legend>${offers.map((name) => `<label><input type="checkbox" data-addin value="${escapeAttribute(name)}" ${selectedAddIns.includes(name) ? 'checked' : ''}>${escapeHtml(name)}</label>`).join('')}</fieldset>` : '<p class="js-description">This document offers no add-ins.</p>';
  const meta = detectMetaSchemaMode(value);
  const palette = paletteDescriptors(value).flatMap((descriptor) => descriptor.members);
  const impact = pointer ? runtime.analyzeImpact([pointer], { direction: impactDirection }) : [];
  const tuple = effective?.tuple.length ? `<p><strong>Tuple order:</strong> <span class="js-code">${effective.tuple.map(escapeHtml).join(', ')}</span></p>` : '';
  const effectiveDiagnostics = effective?.diagnostics.map((diagnostic) => `<p class="js-problem-warning">${escapeHtml(diagnostic.message)}</p>`).join('') ?? '';
  const unknownUses = meta.capabilities.unknownUses.length ? `<p class="js-problem-warning">Unknown $uses: ${meta.capabilities.unknownUses.map(escapeHtml).join(', ')}</p>` : '';
    const offers = value && typeof value === 'object' && !Array.isArray(value) && value.$offers && typeof value.$offers === 'object' && !Array.isArray(value.$offers) ? Object.keys(value.$offers) : [];
    const addIns = offers.length ? `<fieldset><legend>Offered add-ins</legend>${offers.map((name) => `<label><input type="checkbox" data-addin value="${escapeAttribute(name)}" ${selectedAddIns.includes(name) ? 'checked' : ''}>${escapeHtml(name)}</label>`).join('')}</fieldset>` : '<p class="js-description">This document offers no add-ins.</p>';
    return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Analysis</div><h1>${escapeHtml(pointerLabel(pointer ?? ''))}</h1><p class="js-description">Effective structure, graph impact, and meta-schema capabilities.</p></div><span class="js-chip">${escapeHtml(meta.mode)}</span></header>${unknownUses}<div class="js-analysis-grid"><section><h2>Effective members</h2>${addIns}${tuple}${effective ? effective.members.map((member) => `<div class="js-analysis-row"><span class="js-code">${escapeHtml(member.name)}</span><span>${member.required ? 'required' : 'optional'} | ${member.provenance}${member.addIn ? ` | ${escapeHtml(member.addIn)}` : ''}</span></div>`).join('') || '<p class="js-description">No effective members.</p>' : '<p class="js-description">Select an object or tuple declaration.</p>'}${effective?.conflicts.map((conflict) => `<p class="js-problem-warning">Conflict: ${escapeHtml(conflict.name)} (${escapeHtml(conflict.reason)}; ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)})</p>`).join('') ?? ''}${effectiveDiagnostics}</section><section><div class="js-section-head"><h2>Graph impact</h2><div role="group" aria-label="Impact direction">${(['outgoing', 'incoming', 'both'] as const).map((direction) => `<button data-impact-direction="${direction}" aria-pressed="${direction === impactDirection}">${direction}</button>`).join('')}</div></div><p>${runtime.metrics().nodeCount} nodes | ${runtime.metrics().edgeCount} edges</p><p>${impact.length} ${escapeHtml(impactDirection)} reachable declarations</p><h2>Palette</h2><p class="js-code">${escapeHtml(palette.join(', '))}</p></section></div><section><h2>Refactor document</h2>
    return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Analysis</div><h1>${escapeHtml(pointerLabel(pointer ?? ''))}</h1><p class="js-description">Effective structure, graph impact, and meta-schema capabilities.</p></div><span class="js-chip">${escapeHtml(meta.mode)}</span></header>${unknownUses}<div class="js-analysis-grid"><section><h2>Effective members</h2>${addIns}${tuple}${effective ? effective.members.map((member) => `<div class="js-analysis-row"><span class="js-code">${escapeHtml(member.name)}</span><span>${member.required ? 'required' : 'optional'} | ${member.provenance}${member.addIn ? ` | ${escapeHtml(member.addIn)}` : ''}</span></div>`).join('') || '<p class="js-description">No effective members.</p>' : '<p class="js-description">Select an object or tuple declaration.</p>'}${effective?.conflicts.map((conflict) => `<p class="js-problem-warning">Conflict: ${escapeHtml(conflict.name)} (${escapeHtml(conflict.reason)}; ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)})</p>`).join('') ?? ''}${effectiveDiagnostics}</section><section><div class="js-section-head"><h2>Graph impact</h2><div role="group" aria-label="Impact direction">${(['outgoing', 'incoming', 'both'] as const).map((direction) => `<button data-impact-direction="${direction}" aria-pressed="${direction === impactDirection}">${direction}</button>`).join('')}</div></div><p>${runtime.metrics().nodeCount} nodes | ${runtime.metrics().edgeCount} edges</p><p>${impact.length} ${escapeHtml(impactDirection)} reachable declarations</p><h2>Palette</h2><p class="js-code">${escapeHtml(palette.join(', '))}</p></section></div><section><h2>Refactor document</h2><div class="js-analysis-grid"><label>Operation<select data-refactor-operation><option value="move">Move definition</option><option value="extract">Extract inline property</option><option value="copy">Copy declarations</option><option value="shadow">Create local shadow</option></select></label><label>Source pointer<input data-refactor-source value="${escapeAttribute(pointer ?? '/definitions/Type')}"></label><label>Destination pointer<input data-refactor-destination value="/definitions"></label><label>New name<input data-refactor-name placeholder="Optional"></label></div><button data-refactor-preview>Preview refactoring</button>${refactoringStatus ? `<p>${escapeHtml(refactoringStatus)}</p>` : ''}${refactoringPreview}</section></div>`;
  const refactoringPreview = refactoringPlan ? `<section><h2>Refactoring preview</h2>${refactoringPlan.impact.map((entry) => `<div class="js-analysis-row"><span>${escapeHtml(entry.kind)}</span><span class="js-code">${escapeHtml(entry.pointer)}</span></div>`).join('')}${refactoringPlan.collisions.map((collision) => `<p class="js-problem-warning">${escapeHtml(collision.message)}</p>`).join('')}${refactoringPlan.provenance.map((entry) => `<p class="js-description">${escapeHtml(entry.reason)}: ${escapeHtml(entry.sourcePointer)} -> ${escapeHtml(entry.targetPointer)}</p>`).join('')}${refactoringPlan.applicable ? '<button data-refactor-apply>Apply refactoring</button>' : ''}</section>` : '';
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Analysis</div><h1>${escapeHtml(pointerLabel(pointer ?? ''))}</h1><p class="js-description">Effective structure, graph impact, and meta-schema capabilities.</p></div><span class="js-chip">${escapeHtml(meta.mode)}</span></header>${unknownUses}<div class="js-analysis-grid"><section><h2>Effective members</h2>${tuple}${effective ? effective.members.map((member) => `<div class="js-analysis-row"><span class="js-code">${escapeHtml(member.name)}</span><span>${member.required ? 'required' : 'optional'} | ${member.provenance}${member.addIn ? ` | ${escapeHtml(member.addIn)}` : ''}</span></div>`).join('') || '<p class="js-description">No effective members.</p>' : '<p class="js-description">Select an object or tuple declaration.</p>'}${effective?.conflicts.map((conflict) => `<p class="js-problem-warning">Conflict: ${escapeHtml(conflict.name)} (${escapeHtml(conflict.reason)}; ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)})</p>`).join('') ?? ''}${effectiveDiagnostics}</section><section><div class="js-section-head"><h2>Graph impact</h2><div role="group" aria-label="Impact direction">${(['outgoing', 'incoming', 'both'] as const).map((direction) => `<button data-impact-direction="${direction}" aria-pressed="${direction === impactDirection}">${direction}</button>`).join('')}</div></div><p>${runtime.metrics().nodeCount} nodes | ${runtime.metrics().edgeCount} edges</p><p>${impact.length} ${escapeHtml(impactDirection)} reachable declarations</p><h2>Palette</h2><p class="js-code">${escapeHtml(palette.join(', '))}</p></section></div><section><h2>Refactor document</h2><div class="js-analysis-grid"><label>Operation<select data-refactor-operation><option value="move">Move definition</option><option value="extract">Extract inline property</option><option value="copy">Copy declarations</option><option value="shadow">Create local shadow</option></select></label><label>Source pointer<input data-refactor-source value="${escapeAttribute(pointer ?? '')}" placeholder="/definitions/Type"></label><label>Target namespace<input data-refactor-target value="/definitions"></label><label>Target name<input data-refactor-name placeholder="NewName"></label></div><button data-refactor-preview>Preview refactoring</button><p role="status" aria-live="polite">${escapeHtml(refactoringStatus)}</p></section>${refactoringPreview}</div>`;
}

*/
export function analysisView(snapshot: DocumentSnapshot, pointer: string | undefined, graph: ReturnType<typeof projectGraph>, impactDirection: ImpactDirection = 'both', refactoringPlan?: RefactoringPlan, refactoringStatus = '', selectedAddIns: readonly string[] = []): string {
  const value = snapshot.recovery === 'valid' ? JSON.parse(snapshot.text) : {};
  const effective = pointer !== undefined && snapshot.recovery === 'valid' ? resolveEffectiveMembers(value, pointer, { addIns: selectedAddIns }) : undefined;
  const runtime = new GraphRuntime({ nodes: graph.nodes.map((node) => ({ id: node.id, namespace: node.namespace, label: node.label })), edges: graph.edges.filter((edge) => graph.nodes.some((node) => node.id === edge.from) && graph.nodes.some((node) => node.id === edge.to)).map((edge, index) => ({ id: `${edge.kind}:${index}`, source: edge.from, target: edge.to, label: edge.label })), rootId: graph.nodes.find((node) => node.kind === 'document')?.id });
  const offers = value && typeof value === 'object' && !Array.isArray(value) && value.$offers && typeof value.$offers === 'object' && !Array.isArray(value.$offers) ? Object.keys(value.$offers) : [];
  const addIns = offers.length ? `<fieldset><legend>Offered add-ins</legend>${offers.map((name) => `<label><input type="checkbox" data-addin value="${escapeAttribute(name)}" ${selectedAddIns.includes(name) ? 'checked' : ''}>${escapeHtml(name)}</label>`).join('')}</fieldset>` : '<p class="js-description">This document offers no add-ins.</p>';
  const meta = detectMetaSchemaMode(value);
  const palette = paletteDescriptors(value).flatMap((descriptor) => descriptor.members);
  const impact = pointer ? runtime.analyzeImpact([pointer], { direction: impactDirection }) : [];
  const tuple = effective?.tuple.length ? `<p><strong>Tuple order:</strong> <span class="js-code">${effective.tuple.map(escapeHtml).join(', ')}</span></p>` : '';
  const effectiveDiagnostics = effective?.diagnostics.map((diagnostic) => `<p class="js-problem-warning">${escapeHtml(diagnostic.message)}</p>`).join('') ?? '';
  const unknownUses = meta.capabilities.unknownUses.length ? `<p class="js-problem-warning">Unknown $uses: ${meta.capabilities.unknownUses.map(escapeHtml).join(', ')}</p>` : '';
  const refactoringPreview = refactoringPlan ? `<section><h2>Refactoring preview</h2>${refactoringPlan.impact.map((entry) => `<div class="js-analysis-row"><span>${escapeHtml(entry.kind)}</span><span class="js-code">${escapeHtml(entry.pointer)}</span></div>`).join('')}${refactoringPlan.collisions.map((collision) => `<p class="js-problem-warning">${escapeHtml(collision.message)}</p>`).join('')}${refactoringPlan.provenance.map((entry) => `<p class="js-description">${escapeHtml(entry.reason)}: ${escapeHtml(entry.sourcePointer)} -> ${escapeHtml(entry.targetPointer)}</p>`).join('')}${refactoringPlan.applicable ? '<button data-refactor-apply>Apply refactoring</button>' : ''}</section>` : '';
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Analysis</div><h1>${escapeHtml(pointerLabel(pointer ?? ''))}</h1><p class="js-description">Effective structure, graph impact, and meta-schema capabilities.</p></div><span class="js-chip">${escapeHtml(meta.mode)}</span></header>${unknownUses}<div class="js-analysis-grid"><section><h2>Effective members</h2>${addIns}${tuple}${effective ? effective.members.map((member) => `<div class="js-analysis-row"><span class="js-code">${escapeHtml(member.name)}</span><span>${member.required ? 'required' : 'optional'} | ${member.provenance}${member.addIn ? ` | ${escapeHtml(member.addIn)}` : ''}</span></div>`).join('') || '<p class="js-description">No effective members.</p>' : '<p class="js-description">Select an object or tuple declaration.</p>'}${effective?.conflicts.map((conflict) => `<p class="js-problem-warning">Conflict: ${escapeHtml(conflict.name)} (${escapeHtml(conflict.reason)}; ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)})</p>`).join('') ?? ''}${effectiveDiagnostics}</section><section><div class="js-section-head"><h2>Graph impact</h2><div role="group" aria-label="Impact direction">${(['outgoing', 'incoming', 'both'] as const).map((direction) => `<button data-impact-direction="${direction}" aria-pressed="${direction === impactDirection}">${direction}</button>`).join('')}</div></div><p>${runtime.metrics().nodeCount} nodes | ${runtime.metrics().edgeCount} edges</p><p>${impact.length} ${escapeHtml(impactDirection)} reachable declarations</p><h2>Palette</h2><p class="js-code">${escapeHtml(palette.join(', '))}</p></section></div><section><h2>Refactor document</h2><div class="js-analysis-grid"><label>Operation<select data-refactor-operation><option value="move">Move definition</option><option value="extract">Extract inline property</option><option value="copy">Copy declarations</option><option value="shadow">Create local shadow</option></select></label><label>Source pointer<input data-refactor-source value="${escapeAttribute(pointer ?? '')}" placeholder="/definitions/Type"></label><label>Target namespace<input data-refactor-target value="/definitions"></label><label>Target name<input data-refactor-name placeholder="NewName"></label></div><button data-refactor-preview>Preview refactoring</button><p role="status" aria-live="polite">${escapeHtml(refactoringStatus)}</p></section>${refactoringPreview}</div>`;
}

function instanceView(text: string, result: InstanceValidationResult | undefined): string {
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Instance workspace</div><h1>Validate sample</h1><p class="js-description">Diagnostics link instance locations to exact schema locations.</p></div><span class="js-chip">${result?.status ?? 'not run'}</span></header><label class="js-instance-label">Instance JSON<textarea data-instance-input spellcheck="false">${escapeHtml(text)}</textarea></label><div class="js-section-head"><h2>Diagnostics (${result?.diagnostics.length ?? 0})</h2><button data-instance-validate>Validate</button></div>${result?.diagnostics.map((diagnostic) => `<button class="js-problem" data-instance-schema="${escapeAttribute(diagnostic.schemaPointer)}"><span class="js-problem-${diagnostic.severity}">${diagnostic.severity === 'error' ? 'x' : '!'}</span><span>${escapeHtml(diagnostic.message)}</span><span class="js-location">${escapeHtml(diagnostic.instancePointer)} -> ${escapeHtml(diagnostic.schemaPointer)}</span></button>`).join('') || '<div class="js-empty">Enter an instance and validate it against the focused schema.</div>'}</div>`;
}

function designView(name: string | undefined, type: string | undefined, description: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined): string {
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Focused type</div><h1>${escapeHtml(name ?? 'Document')}</h1><p class="js-description">${escapeHtml(description ?? 'Select a reusable type to inspect and edit its properties.')}</p></div><span class="js-chip">${escapeHtml(type ?? 'unknown')}</span></header><div class="js-section-head"><h2>Properties (${rows.length})</h2><button data-command="add">Add property</button></div><div class="js-grid"><div class="js-row js-header"><div class="js-cell">Name</div><div class="js-cell">Type</div><div class="js-cell">Presence</div><div class="js-cell js-description-cell">Description</div><div class="js-cell">Action</div></div>${rows.map((row) => `<div class="js-row" aria-current="${row.pointer === selectedPointer}"><button class="js-cell js-code" data-select="${escapeAttribute(row.pointer)}">${escapeHtml(row.name)}</button><div class="js-cell js-code">${escapeHtml(row.type)}</div><div class="js-cell ${row.required ? 'js-required' : 'js-optional'}">${row.required ? 'required' : 'optional'}</div><div class="js-cell js-description-cell">${escapeHtml(row.description ?? 'No description')}</div><button class="js-cell" data-select="${escapeAttribute(row.pointer)}">Inspect</button></div>`).join('') || '<div class="js-empty">This type has no properties yet.</div>'}</div></div>`;
}

function graphView(graphOrSnapshot: ReturnType<typeof projectGraph> | DocumentSnapshot, navigationOrSelected: GraphNavigationController | string | undefined, selectedPointerOverride?: string | undefined): string {
  const isSnapshot = 'model' in graphOrSnapshot;
  const graph: ReturnType<typeof projectGraph> = isSnapshot ? projectGraph(graphOrSnapshot as DocumentSnapshot) : graphOrSnapshot as ReturnType<typeof projectGraph>;
  const navigation: GraphNavigationController = isSnapshot ? graphNavigationBySnapshot.get(graphOrSnapshot as DocumentSnapshot) ?? new GraphNavigationController() : navigationOrSelected as GraphNavigationController;
  const selectedPointer = isSnapshot ? navigationOrSelected as string | undefined : selectedPointerOverride;
  const positions = graph.nodes.map((node, index) => ({ ...node, x: 80 + (index % 3) * 210, y: 80 + Math.floor(index / 3) * 130, width: 150, height: 50 }));
  const position = new Map(positions.map((node) => [node.id, node]));
  const width = Math.max(680, 120 + Math.min(3, positions.length) * 210); const height = Math.max(430, 150 + Math.ceil(positions.length / 3) * 130); navigation.setContent({ x: 0, y: 0, width, height }); const state = navigation.snapshot(); const minimap = navigation.minimap(positions); const transform = `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.zoom})`;
  const minimapViewport = clampMinimapViewport(minimap.viewport, width, height);
  const edges = graph.edges.map((edge) => renderGraphEdge(edge, position)).join('');
  const nodes = positions.map((node) => renderGraphNode(node, selectedPointer, state.semanticZoom)).join('') || '<text x="30" y="50">No types to graph.</text>';
  return `<div class="js-graph-toolbar"><button data-graph-fit title="Fit graph">Fit</button><button data-graph-back title="Back" ${state.historyIndex > 0 ? '' : 'disabled'}>Back</button><button data-graph-forward title="Forward" ${state.historyIndex < state.history.length - 1 ? '' : 'disabled'}>Forward</button><span data-semantic-zoom="${state.semanticZoom}">${state.semanticZoom}</span></div><svg class="js-graph-canvas" data-graph-canvas viewBox="0 0 ${width} ${height}" role="img" aria-label="Type relationship graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges"><defs><marker id="js-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="currentColor"></path></marker></defs><g transform="${transform}">${edges}${nodes}</g><g class="js-minimap" transform="translate(12 12)"><rect width="180" height="120" data-minimap></rect>${minimap.nodes.map((node) => `<rect x="${node.x / width * 180}" y="${node.y / height * 120}" width="${Math.max(3, node.width / width * 180)}" height="${Math.max(3, node.height / height * 120)}"></rect>`).join('')}<rect class="js-minimap-viewport" x="${minimapViewport.x}" y="${minimapViewport.y}" width="${minimapViewport.width}" height="${minimapViewport.height}"></rect></g></svg>`;
}

type PositionedGraphNode = ReturnType<typeof projectGraph>['nodes'][number] & { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

function renderGraphEdge(edge: ReturnType<typeof projectGraph>['edges'][number], positions: ReadonlyMap<string, PositionedGraphNode>): string {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return '';
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const description = [edge.label, edge.status, edge.target, edge.documentUri, edge.provenance, edge.reason].filter(Boolean).join(' | ');
  return `<g class="js-edge-group js-edge-${edge.kind} js-status-${edge.status ?? 'resolved'}" role="img" aria-label="${escapeAttribute(description)}"><path class="js-edge" d="M${startX} ${startY} L${endX} ${endY}" marker-end="url(#js-arrow)"><title>${escapeHtml(description)}</title></path><text class="js-edge-label" x="${(startX + endX) / 2}" y="${(startY + endY) / 2 - 5}">${escapeHtml(edge.label)}</text></g>`;
}

function renderGraphNode(node: PositionedGraphNode, selectedPointer: string | undefined, semanticZoom: string): string {
  const status = node.status ?? 'resolved';
  const description = [node.label, node.kind, status, node.documentUri, node.provenance].filter(Boolean).join(' | ');
  const interaction = node.selectable === false
    ? `role="img" aria-label="${escapeAttribute(description)}"`
    : `role="button" tabindex="0" data-graph-select="${escapeAttribute(node.pointer)}" aria-label="${escapeAttribute(description)}" aria-current="${node.pointer === selectedPointer}"`;
  const metadata = status === 'resolved' ? node.namespace : `${status}${node.provenance ? ` | ${node.provenance}` : ''}`;
  return `<g class="js-node js-node-${node.kind} js-status-${status}" ${interaction} transform="translate(${node.x} ${node.y})"><title>${escapeHtml(description)}</title><rect width="150" height="50"></rect><text x="12" y="22">${semanticZoom === 'overview' ? '' : escapeHtml(node.label)}</text><text class="js-node-meta" x="12" y="39">${semanticZoom === 'detail' || status !== 'resolved' ? escapeHtml(metadata) : ''}</text></g>`;
}

function clampMinimapViewport(viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, contentWidth: number, contentHeight: number): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const width = Math.min(180, Math.max(1, viewport.width / contentWidth * 180));
  const height = Math.min(120, Math.max(1, viewport.height / contentHeight * 120));
  return { x: Math.min(180 - width, Math.max(0, viewport.x / contentWidth * 180)), y: Math.min(120 - height, Math.max(0, viewport.y / contentHeight * 120)), width, height };
}

function inspector(property: PropertyRow | undefined, definition: import('../model.js').DefinitionProjection | undefined, diagnostics: readonly Diagnostic[]): string {
  const sections = property ? projectSchemaInspectorSections(property.schema) : projectInspectorSections(definition);
  const heading = property?.name ?? definition?.name ?? 'No selection';
  const kind = property ? 'Property' : definition?.type ?? 'Document';
  const propertyActions = property ? `<div class="js-actions"><button data-command="rename">Rename</button><button data-command="edit">Change type</button><button class="js-danger" data-command="delete">Delete</button></div>` : '';
  return `<section><div class="js-eyebrow">${escapeHtml(kind)}</div><h2>${escapeHtml(heading)}</h2>${property?.description ? `<p class="js-description">${escapeHtml(property.description)}</p>` : ''}${propertyActions}</section>${sections.map(inspectorSection).join('') || '<section><p class="js-description">No normalized fields are available for this selection.</p></section>'}<section><div class="js-eyebrow">Diagnostics</div><p class="js-description">${diagnostics.length} for this selection.</p></section>`;
}

function inspectorSection(section: InspectorSection): string {
  return `<section class="js-inspector-section"><div class="js-eyebrow">${escapeHtml(section.label)}</div><dl>${section.fields.map((field) => `<div class="js-inspector-row"><dt>${escapeHtml(field.keyword)}${field.origin === 'effective' ? '<span class="js-origin">effective</span>' : ''}</dt><dd class="js-code">${escapeHtml(field.value)}</dd></div>`).join('')}</dl></section>`;
}

function problems(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `<button class="js-problem" data-problem="${escapeAttribute(diagnostic.location?.pointer ?? '')}"><span class="js-problem-${diagnostic.severity}">${diagnostic.severity === 'error' ? 'x' : '!'}</span><span>${escapeHtml(diagnostic.message)}</span><span class="js-location">${escapeHtml(diagnostic.location?.pointer ?? '')}</span></button>`).join('') || '<div class="js-empty">No problems detected.</div>';
}


function showActionPalette(root: HTMLElement, pointer: string, session: DocumentSession, catalogs: CatalogRegistry, apply: CommandApply): void {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  root.querySelector('.js-command-palette')?.remove();
  const palette = document.createElement('div');
  palette.className = 'js-command-palette';
  palette.setAttribute('role', 'dialog');
  palette.setAttribute('aria-modal', 'true');
  palette.setAttribute('aria-label', 'Show Commands');
  const groups = [...new Set(commandActions.map((action) => action.group))];
  const options = groups.map((group) => `<optgroup label="${escapeAttribute(group)}">${commandActions.filter((action) => action.group === group).map((action) => {
    const availability = actionAvailability(action, pointer, session.value);
    return `<option value="${escapeAttribute(action.id)}" ${availability.enabled ? '' : 'disabled'} title="${escapeAttribute(availability.reason ?? '')}">${escapeHtml(action.label)}${availability.enabled ? '' : ` - ${escapeHtml(availability.reason ?? 'Unavailable')}`}</option>`;
  }).join('')}</optgroup>`).join('');
  palette.innerHTML = `<form><label class="js-sr-only" for="js-command-select">Command</label><select id="js-command-select" data-action-select size="12">${options}</select></form>`;
  root.append(palette);
  const select = palette.querySelector('[data-action-select]') as HTMLInputElement;
  let releaseTrap = (): void => undefined;
  const close = (restore = true): void => {
    releaseTrap();
    palette.remove();
    if (restore) queueMicrotask(() => invoker?.focus());
  };
  releaseTrap = trapFocus(palette, () => close(true));
  const choose = (): void => { const action = actionById(select.value); if (action) { const availability = actionAvailability(action, pointer, session.value); if (!availability.enabled) return; close(false); showActionEditor(root, action, availability.pointer, session, catalogs, apply, invoker); } };
  select.addEventListener('dblclick', choose);
  select.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') { event.preventDefault(); choose(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  select.focus();
}

async function mountSourceEditor(root: HTMLElement, text: string, existingModel: MonacoEditor.ITextModel | undefined, onChange: (text: string) => void, theme: 'dark' | 'light' | 'contrast', isCurrent: () => boolean): Promise<{ editor: MonacoEditor.IStandaloneCodeEditor; model: MonacoEditor.ITextModel } | undefined> {
  const element = root.querySelector('[data-source]') as HTMLElement | null;
  if (!element) return undefined;
  const { createJsonEditor, createJsonModel } = await import('./monaco.js');
  if (!isCurrent()) return undefined;
  const model = existingModel ?? createJsonModel(text);
  const editor = createJsonEditor(element, model, theme);
  editor.onDidChangeModelContent(() => onChange(model.getValue()));
  return { editor, model };
}

function syncSourceModel(model: MonacoEditor.ITextModel | undefined, text: string): void {
  if (!model || model.getValue() === text) return;
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
}

type CommandApply = (command: { canExecute(context: { session: DocumentSession; documentVersion: number }): boolean; execute(context: { session: DocumentSession; documentVersion: number }): { edits: readonly TextEdit[] } }) => Promise<string | undefined>;

function showActionEditor(root: HTMLElement, action: CommandAction, pointer: string, session: DocumentSession, catalogs: CatalogRegistry, apply: CommandApply, transitionInvoker?: HTMLElement): void {
  const invoker = transitionInvoker ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  root.querySelector('.js-inline-editor')?.remove();
  const panel = document.createElement('form');
  panel.className = 'js-inline-editor';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'action-title');
  const nameField = action.id.endsWith('.add') ? '<label>Name<input name="name" required></label>' : '';
  const valueField = action.requiresValue === false ? '' : actionControlHtml(action, pointer, session);
  panel.innerHTML = `<header><div><div class="js-eyebrow">Edit ${escapeHtml(pointerLabel(pointer))}</div><h2 id="action-title">${escapeHtml(action.label)}</h2></div><button class="js-inline-close" type="button" data-cancel aria-label="Cancel" title="Cancel">&times;</button></header><p id="action-help" class="js-description">${escapeHtml(action.help)}</p>${nameField}${valueField}<p class="js-action-status" data-action-status role="status" aria-live="polite"></p><div class="js-actions"><button type="button" data-cancel>Cancel</button><button>Apply</button></div>`;
  const activeView = [...root.querySelectorAll('.js-view')].find((view) => !(view as HTMLElement).hidden) as HTMLElement | undefined;
  if (!activeView) return;
  activeView.prepend(panel);
  const form = panel as any;
  const name = form.elements.namedItem('name') as HTMLInputElement | null;
  const value = form.elements.namedItem('value') as HTMLInputElement | HTMLTextAreaElement | null;
  const status = panel.querySelector('[data-action-status]') as HTMLElement;
  let releaseTrap = (): void => undefined;
  const close = (): void => {
    releaseTrap();
    panel.remove();
    const focusTarget = invoker?.isConnected ? invoker : root.querySelector('[data-show-commands], [aria-current="true"], [role="tab"][aria-selected="true"]') as HTMLElement | null;
    queueMicrotask(() => focusTarget?.focus());
  };
  releaseTrap = trapFocus(panel, close);
  form.querySelectorAll('[data-cancel]').forEach((button: HTMLElement) => button.addEventListener('click', close));
  const valueList = panel.querySelector('[data-value-list]');
  valueList?.querySelectorAll('input[type="checkbox"]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', () => {
    const selected = [...valueList.querySelectorAll('input[type="checkbox"]')].filter((item) => (item as HTMLInputElement).checked).map((item) => (item as HTMLInputElement).value);
    const hidden = form.elements.namedItem('value') as HTMLInputElement;
    hidden.value = JSON.stringify(selected);
  }));
  const relationEditor = panel.querySelector('[data-relation-editor]');
  const syncRelationValue = (): void => {
    if (!relationEditor) return;
    const targetTypeRef = (form.elements.namedItem('relation-target') as HTMLInputElement).value;
    const cardinality = (form.elements.namedItem('relation-cardinality') as HTMLInputElement).value;
    const qualifierTypeRef = (form.elements.namedItem('relation-qualifier') as HTMLInputElement).value;
    const scopes = [...relationEditor.querySelectorAll('[name="relation-scope"]:checked')].map((item) => (item as HTMLInputElement).value);
    const schema = { targetTypeRef, cardinality, ...(scopes.length === 0 ? {} : { scope: scopes.length === 1 ? scopes[0] : scopes }), ...(qualifierTypeRef ? { qualifierTypeRef } : {}) };
    (form.elements.namedItem('value') as HTMLInputElement).value = JSON.stringify(schema);
  };
  relationEditor?.querySelectorAll('select,input').forEach((control: HTMLElement) => control.addEventListener('change', syncRelationValue));
  syncRelationValue();
  wireCatalogControl(panel, action, session, catalogs, status);
  form.addEventListener('submit', async (event: Event) => {
    event.preventDefault();
    try {
      const raw = value?.value.trim() ?? undefined;
      const parsed = raw === undefined ? undefined : parseActionValue(action, raw, value instanceof HTMLInputElement && value.type === 'checkbox' ? value.checked : false);
      const error = await apply(action.create(pointer, parsed, name?.value.trim()));
      if (error) { status.textContent = error; return; }
      close();
    } catch (error) {
      value?.setCustomValidity(error instanceof Error ? error.message : 'Enter a valid value.');
      value?.reportValidity();
    }
  });
  (name ?? value)?.focus();
}

function createCatalogRegistry(): CatalogRegistry {
  const registry = new CatalogRegistry();
  registry.register(BUNDLED_UCUM_PROVIDER);
  registry.register(BUNDLED_ISO_4217_PROVIDER);
  registry.register(BUNDLED_SEMANTIC_PROVIDER);
  return registry;
}

function wireCatalogControl(panel: HTMLElement, action: CommandAction, session: DocumentSession, catalogs: CatalogRegistry, status: HTMLElement): void {
  const input = panel.querySelector('input[list="action-catalog"]') as HTMLInputElement | null;
  const list = panel.querySelector('#action-catalog') as HTMLElement | null;
  const provenance = panel.querySelector('[data-catalog-provenance]') as HTMLElement | null;
  const family = catalogFamilyForAction(action);
  if (!input || !list || !provenance || !family) return;
  let searchSequence = 0;
  const search = async (): Promise<void> => {
    const sequence = ++searchSequence;
    const documentVersion = session.snapshot().documentVersion;
    const request = catalogs.createRequest(`ui-catalog-${Date.now()}-${sequence}`, documentVersion, family, input.value, 30);
    const manifests = catalogs.listProviders().filter((provider) => provider.families.includes(family));
    const providers: CatalogProvider[] = manifests.map((manifest) => ({ providerId: manifest.id, search: (catalogRequest) => bundledCatalogResult(catalogRequest, manifest.id) }));
    const result = await catalogs.search(request, providers);
    if (sequence !== searchSequence || documentVersion !== session.snapshot().documentVersion || result.stale) return;
    list.innerHTML = result.suggestions.map((suggestion) => `<option value="${escapeAttribute(typeof suggestion.value === 'string' ? suggestion.value : suggestion.emittedJson)}">${escapeHtml(suggestion.label)}</option>`).join('');
    const sources = [...new Map(result.suggestions.flatMap((suggestion) => suggestion.provenance).map((item) => [item.providerId, item])).values()];
    provenance.textContent = sources.map((source) => `${source.providerLabel} ${source.version} | ${source.trusted ? 'trusted' : 'advisory'} | ${source.source}`).join('; ') || 'No bundled suggestions. Custom values are allowed.';
    if (result.providerIssues.length) status.textContent = result.providerIssues.map((issue) => issue.message).join(' ');
  };
  input.addEventListener('input', () => { void search(); });
  void search();
}

function actionControlHtml(action: CommandAction, pointer: string, session: DocumentSession): string {
  const label = escapeHtml(action.valueLabel ?? 'Value');
  const control = action.control;
  if (!control) return `<label>${label}<textarea name="value" required aria-describedby="action-help"></textarea></label>`;
  if (control.kind === 'boolean') return `<label class="js-check"><input name="value" type="checkbox">${label}</label>`;
  if (control.kind === 'number') return `<label>${label}<input name="value" type="number" ${control.integer ? 'step="1"' : 'step="any"'} ${control.minimum === undefined ? '' : `min="${control.minimum}"`} required></label>`;
  if (control.kind === 'select') return `<label>${label}<select name="value">${control.options.map((option) => `<option value="${escapeAttribute(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
  if (control.kind === 'reference-picker') {
    const references = session.snapshot().model?.projections.definitions.filter((definition) => definition.reusable) ?? [];
    return `<label>${label}<select name="value">${references.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}">${escapeHtml(definition.name)}</option>`).join('')}</select></label>`;
  }
  if (control.kind === 'property-multi-select') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const properties = target && typeof target.properties === 'object' && target.properties ? Object.keys(target.properties) : [];
    return `<fieldset data-value-list><legend>${label}</legend>${properties.map((property) => `<label class="js-check"><input type="checkbox" value="${escapeAttribute(property)}">${escapeHtml(property)}</label>`).join('') || '<p class="js-description">No properties are available.</p>'}<input name="value" type="hidden" value="[]"></fieldset>`;
  }
  if (control.kind === 'relation-editor') return relationControlHtml(pointer, session);
  if (control.kind === 'structured-list') return `<label>${label}<textarea name="value" required placeholder='[ ]' aria-describedby="action-help"></textarea></label>`;
  if (control.kind === 'structured-object') return `<label>${label}<textarea name="value" required placeholder='{ }' aria-describedby="action-help"></textarea></label>`;
  if (control.kind === 'catalog') return `<label>${label}<input name="value" type="text" list="action-catalog" autocomplete="off" required></label><datalist id="action-catalog"></datalist><p class="js-description" data-catalog-provenance></p>`;
  return `<details open><summary>Advanced JSON</summary><label>${label}<textarea name="value" required aria-describedby="action-help"></textarea></label></details>`;
}

function relationControlHtml(pointer: string, session: DocumentSession): string {
  const current = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
  const currentTarget = relationReference(current?.targettype);
  const currentQualifier = relationReference(current?.qualifiertype);
  const currentCardinality = current?.cardinality === 'multiple' ? 'multiple' : 'single';
  const currentScopes = typeof current?.scope === 'string' ? [current.scope] : Array.isArray(current?.scope) ? current.scope.filter((entry): entry is string => typeof entry === 'string') : [];
  const definitions = session.snapshot().model?.projections.definitions.filter((definition) => definition.reusable) ?? [];
  const targets = definitions.filter((definition) => definition.identity?.length);
  const scopePointers = collectionPointers(session.value);
  return `<fieldset data-relation-editor><legend>Relation</legend><label>Target type<select name="relation-target" required>${targets.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}" ${currentTarget === `#${definition.pointer}` ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`).join('')}</select></label><label>Cardinality<select name="relation-cardinality"><option value="single" ${currentCardinality === 'single' ? 'selected' : ''}>single</option><option value="multiple" ${currentCardinality === 'multiple' ? 'selected' : ''}>multiple</option></select></label><fieldset><legend>Scope</legend>${scopePointers.map((scope) => `<label class="js-check"><input type="checkbox" name="relation-scope" value="${escapeAttribute(scope)}" ${currentScopes.includes(scope) ? 'checked' : ''}>${escapeHtml(scope)}</label>`).join('') || '<p class="js-description">No collection scopes are available.</p>'}</fieldset><label>Qualifier type<select name="relation-qualifier"><option value="">None</option>${definitions.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}" ${currentQualifier === `#${definition.pointer}` ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`).join('')}</select></label><input name="value" type="hidden"></fieldset>`;
}

function relationReference(value: unknown): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).$ref === 'string' ? String((value as Record<string, unknown>).$ref) : undefined;
}

function collectionPointers(document: unknown): readonly string[] {
  const pointers: string[] = [];
  const visit = (value: unknown, pointer: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (['array', 'set', 'map'].includes(String(record.type))) pointers.push(pointer === '' ? '#' : `#${pointer}`);
    for (const [name, child] of Object.entries(record)) visit(child, `${pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  };
  visit(document, '');
  return pointers;
}

function isObjectSchema(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).type === 'object';
}

function enhanceWorkbenchDom(root: HTMLElement): void {
  const title = root.querySelector('.js-title');
  const outline = root.querySelector('.js-outline') as HTMLElement | null;
  const inspectorPanel = root.querySelector('.js-inspector') as HTMLElement | null;
  if (title && outline && inspectorPanel) {
    outline.id = 'js-outline';
    outline.dataset.drawerPanel = 'types';
    inspectorPanel.id = 'js-inspector';
    inspectorPanel.dataset.drawerPanel = 'inspector';
    for (const [name, label, target] of [['types', 'Types', 'js-outline'], ['inspector', 'Inspector', 'js-inspector']] as const) {
      const button = document.createElement('button');
      button.className = 'js-mobile-toggle';
      button.textContent = label;
      button.dataset.mobileDrawer = name;
      button.setAttribute('aria-controls', target);
      button.setAttribute('aria-expanded', 'false');
      title.insertBefore(button, title.querySelector('.js-file'));
    }
  }
  const graph = root.querySelector('[data-graph-canvas]');
  graph?.setAttribute('role', 'group');
}

function filterTypeButtons(root: HTMLElement, query: string): void {
  const normalized = query.trim().toLocaleLowerCase();
  let visible = 0;
  root.querySelectorAll('.js-tree-item').forEach((button: HTMLElement) => {
    const match = !normalized || (button.textContent ?? '').toLocaleLowerCase().includes(normalized);
    button.hidden = !match;
    if (match) visible += 1;
  });
  const count = root.querySelector('.js-tree-group');
  if (count) count.textContent = `${visible} definitions`;
}

function toggleMobileDrawer(root: HTMLElement, name: string): void {
  root.querySelectorAll('[data-drawer-panel]').forEach((panel: HTMLElement) => panel.classList.toggle('js-drawer-open', panel.dataset.drawerPanel === name && !panel.classList.contains('js-drawer-open')));
  root.querySelectorAll('[data-mobile-drawer]').forEach((button: HTMLButtonElement) => button.setAttribute('aria-expanded', String(root.querySelector(`[data-drawer-panel="${button.dataset.mobileDrawer}"]`)?.classList.contains('js-drawer-open') ?? false)));
}

function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); onEscape(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')] as HTMLElement[];
    const visible = focusable.filter((element) => !element.hidden);
    if (!visible.length) return;
    const first = visible[0]!;
    const last = visible.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keydown, true);
  return () => document.removeEventListener('keydown', keydown, true);
}

function projectRootProperties(value: unknown): readonly PropertyRow[] {
  if (!isObjectSchema(value) || !isRecord(value.properties)) return [];
  const required = new Set(Array.isArray(value.required) ? value.required.flat() : []);
  return Object.entries(value.properties).map(([name, schema]) => ({ name, pointer: `/properties/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, type: typeof schema.type === 'string' ? schema.type : 'unknown', required: required.has(name), description: typeof schema.description === 'string' ? schema.description : undefined, schema }));
}

function isRecord(value: unknown): value is Record<string, Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function applyEdits(text: string, edits: readonly TextEdit[]): string { return [...edits].sort((a, b) => (b.range.startOffset ?? 0) - (a.range.startOffset ?? 0)).reduce((current, edit) => current.slice(0, edit.range.startOffset) + edit.newText + current.slice(edit.range.endOffset), text); }
function selectFallback(snapshot: DocumentSnapshot, current: string | undefined): string | undefined { if (current !== undefined && snapshot.model?.nodes.some((node) => node.pointer === current)) return current; return snapshotHasInlineRoot(snapshot) ? '' : snapshot.model?.projections.definitions.find((definition) => definition.reusable)?.pointer; }
function snapshotHasInlineRoot(snapshot: DocumentSnapshot): boolean { try { return isInlineRootSchema(JSON.parse(snapshot.text)); } catch { return false; } }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, '&#39;'); }