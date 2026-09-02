import { PROTOCOL_VERSION, type ConversionResult, type ConversionSource, type Diagnostic, type DocumentSnapshot, type EditorHost, type ProgressEvent, type TextEdit } from '../contracts.js';
import { BUNDLED_ISO_4217_PROVIDER, BUNDLED_SEMANTIC_PROVIDER, BUNDLED_UCUM_PROVIDER, CatalogRegistry, bundledCatalogResult, type CatalogMergeResult, type CatalogProvider, type CatalogProviderManifest } from '../catalogs.js';
import { DocumentSession } from '../session.js';
import { loadExternalDocuments } from '../external-documents.js';
import { actionById, commandActions, type CommandAction } from './actions.js';
import { actionAvailability, catalogFamilyForAction, parseActionValue, valueAtPointer } from './action-runtime.js';
import { diagnosticsForPointer, displaySchemaTypeValue, isInlineRootSchema, pointerLabel, projectGraph, projectInspectorSections, projectProperties, projectSchemaInspectorSections, type InspectorSection, type PropertyRow } from './helpers.js';
import { GraphNavigationController } from './graph-navigation.js';
import { ForceGraphLayout, graphEdgePath, type ForceGraphPosition } from './force-graph-layout.js';
import { SemanticGraphController, type SemanticGraphView } from './semantic-graph.js';
import { editorStyles } from './prototype-styles.js';
import { InstanceWorkspace, type CrossNavigationSelection, type EvaluationTrace, type InstanceValidationResult } from '../phase4/instance-workspace.js';
import { resolveEffectiveMembers, type EffectiveMembersResult } from '../phase4/effective-members.js';
import type { ResolvedSchemaDocument } from '../phase4/resolved-schema.js';
import { GraphRuntime } from '../phase4/graph-runtime.js';
import { detectMetaSchemaMode, paletteDescriptors } from '../phase4/meta-schema.js';
import { conversionOptionsForCommand, type ConversionCommandsManifest, type ConversionOptionValues } from '../conversion/types.js';
import type { LibraryEntry } from '../libraries/contracts.js';
import type { LibraryDocument } from '../libraries/contracts.js';
import type { LibraryCatalogEntry, LibraryHostResolution, LibraryProviderSummary } from '../libraries/host-runtime.js';
import { renderLibraryBrowser } from './library-browser.js';
import { CopyCollisionError, planLibraryCopy, planLibraryMaterialization, type CopyOperation, type LibraryProvenance } from '../libraries/planning.js';
import { planAddImport, planCopyDeclarations, planExtractInlineProperty, planLocalShadow, planMaterializeDeclarations, planMoveDefinition, type RefactoringPlan } from '../phase4/refactoring.js';
import { rangeFor } from '../parser.js';
import { effectiveValidationTypes } from '../validation.js';
import type { editor as MonacoEditor } from 'monaco-editor';
import { fluentIcon, type FluentIconName } from './fluent-icons.js';
import { jsonStructureLogo } from './brand-logo.js';
import { technologyIcon } from './technology-icons.js';

export { diagnosticsForPointer, pointerLabel, projectGraph, projectProperties } from './helpers.js';

type EditorServices = Pick<EditorHost, 'listConversionCommands' | 'selectConversionSource' | 'convert' | 'onConversionProgress' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument'>;

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

export function documentCanPublish(snapshot: Pick<DocumentSnapshot, 'recovery' | 'diagnostics' | 'model'>): boolean {
  return snapshot.recovery === 'valid' && snapshot.model !== undefined && !snapshot.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function libraryPublishPreview(draft: LibraryPublishDraft, providers: readonly LibraryProviderSummary[], catalog: readonly LibraryCatalogEntry[], documentValid: boolean): LibraryPublishPreview {
  const provider = providers.find((candidate) => candidate.id === draft.providerId);
  const versionExists = catalog.some((entry) => entry.providerId === draft.providerId && entry.id === draft.entryId && entry.versions.some((candidate) => candidate.version === draft.version));
  const collisionRisks = [
    ...(versionExists ? [`${draft.providerId}:${draft.entryId}@${draft.version} already exists and cannot be overwritten.`] : []),
    ...(draft.promoteDefault ? [`Default version will move to ${draft.version}.`] : []),
  ];
  const valid = documentValid && !versionExists && Boolean(draft.entryId.trim() && draft.version.trim() && validLibrarySourceUri(draft.sourceUri) && provider?.publishSupported);
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
  /** Window chrome rendered by the shared workbench. Embedded hosts provide their own chrome. */
  readonly chrome?: 'integrated' | 'document' | 'embedded';
  /** Executes Electron window and file commands exposed by integrated chrome. */
  readonly onChromeCommand?: (command: 'open' | 'save' | 'save-as' | 'show-commands' | 'website' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all' | 'reset-zoom' | 'zoom-in' | 'zoom-out' | 'toggle-fullscreen' | 'quit') => void | Promise<void>;
  /** Synchronizes native title-bar colors with the workbench theme. */
  readonly onThemeChange?: (theme: 'dark' | 'light' | 'contrast') => void | Promise<void>;
}

/** Imperative handle returned by {@link mountJsonStructureEditor}. */
export interface JsonStructureEditorHandle {
  /** Replaces the open JSON text and rerenders every synchronized view. */
  setText(text: string, documentVersion?: number): void;
  /** Updates visible document labels without rebuilding the workbench. */
  setTitle(title: string): void;
  /** Updates the canonical document URI used for relative resource resolution. */
  setUri(uri: string): void;
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
type DesignMemberMode = 'local' | 'effective';
type GraphResizeObserver = { observe(target: SVGElement): void; disconnect(): void };
type DialogElement = HTMLElement & { readonly open: boolean; showModal(): void; close(): void };
const graphNavigationBySnapshot = new WeakMap<DocumentSnapshot, GraphNavigationController>();
const forceGraphLayoutBySnapshot = new WeakMap<DocumentSnapshot, ForceGraphLayout>();
const semanticGraphBySnapshot = new WeakMap<DocumentSnapshot, SemanticGraphController>();

/**
 * Mounts the ALPHA JSON Structure workbench into a browser container.
 *
 * The UI consumes the foundation's normalized document model and property
 * commands, while remaining host-neutral: a host is optional for browser demos.
 */
export function mountJsonStructureEditor(container: HTMLElement, options: JsonStructureEditorOptions): JsonStructureEditorHandle {
  const session = new DocumentSession(options.uri ?? 'memory://json-structure-editor/untitled.struct.json', options.text, options.documentVersion);
  let documentTitle = options.title ?? 'Untitled JSON Structure';
  let selectedPointer: string | undefined;
  let mode: Mode = 'design';
  let lastRepresentationMode: Extract<Mode, 'design' | 'graph' | 'source'> = 'design';
  let disposed = false;
  let sourceEditor: MonacoEditor.IStandaloneCodeEditor | undefined;
  let sourceModel: MonacoEditor.ITextModel | undefined;
  let sourceMount = 0;
  let focusSourceAfterMount = false;
  let commandRequest = 0;
  let commandQueue: Promise<void> = Promise.resolve();
  let synchronizedRender: ReturnType<typeof setTimeout> | undefined;
  let themeName: 'dark' | 'light' | 'contrast' = 'dark';
  let pendingDiagnostic: Diagnostic['location'] | undefined;
  let externalLoad = 0;
  let externalLoadKey: string | undefined;
  let graphResizeObserver: GraphResizeObserver | undefined;
  let designMemberMode: DesignMemberMode = 'local';
  let expandedPropertyPointer: string | undefined;
  let instanceText = '{}';
  let instanceResult: InstanceValidationResult | undefined;
  let instanceWorkspace: InstanceWorkspace | undefined;
  let instanceRootPointer: string | undefined;
  let instanceSelection: CrossNavigationSelection | undefined;
  let impactDirection: ImpactDirection = 'both';
  let selectedAddIns: readonly string[] = [];
  let refactoringPlan: RefactoringPlan | undefined;
  let refactoringBinding: PreviewBinding | undefined;
  let refactoringStatus = '';
  let conversionManifest: ConversionCommandsManifest | undefined;
  let conversionLoading = false;
  let conversionCommandId: string | undefined;
  let conversionSource: ConversionSource | undefined;
  let conversionResult: ConversionResult | undefined;
  let conversionStatus = '';
  let conversionProgress: ProgressEvent | undefined;
  let conversionRequestId: string | undefined;
  let libraryEntries: readonly LibraryEntry[] | undefined;
  let libraryProviders: readonly LibraryProviderSummary[] | undefined;
  let libraryCatalog: readonly LibraryCatalogEntry[] | undefined;
  let libraryResolution: LibraryHostResolution | undefined;
  let libraryResolveSequence = 0;
  let libraryOffline = false;
  let libraryPublishDraft: LibraryPublishDraft | undefined;
  let libraryPublishPreviewState: LibraryPublishPreview | undefined;
  let libraryPublishBinding: PreviewBinding | undefined;
  let libraryPublishedEpoch: string | undefined;
  let libraryProviderFilter = 'all';
  let librarySearch = '';
  let librarySelector: 'pinned' | 'floating' = 'floating';
  let libraryDocument: LibraryDocument | undefined;
  let librarySelection: readonly string[] = [];
  let libraryOperation: LibraryOperation = 'import';
  let libraryPlan: RefactoringPlan | undefined;
  let libraryBinding: PreviewBinding | undefined;
  let libraryStatus = '';
  let libraryModalOpen = false;
  let problemsOpen = false;
  let drawerReturnFocus: HTMLElement | undefined;
  let releaseDrawerTrap = (): void => undefined;
  const graphNavigation = new GraphNavigationController();
  const graphLayout = new ForceGraphLayout();
  const semanticGraph = new SemanticGraphController();
  let fitGraphAfterRender = false;
  let graphEntered = false;
  let pendingGraphActivation: { readonly nodeId: string; readonly timer: ReturnType<typeof setTimeout> } | undefined;
  const catalogRegistry = createCatalogRegistry();
  const services = options.services ?? options.host;
  const unsubscribeConversionProgress = services?.onConversionProgress?.((progress) => {
    if (!disposed && progress.requestId === conversionRequestId) { conversionProgress = progress; conversionStatus = progress.message ?? progress.phase; render(); }
  });
  const styleNonce = options.styleNonce ? ` nonce="${escapeAttribute(options.styleNonce)}"` : '';
  container.innerHTML = `<style${styleNonce}>${editorStyles}</style><main class="json-structure-editor" data-theme="dark"></main>`;
  const root = container.querySelector('.json-structure-editor') as HTMLElement;
  const closeCompactDrawer = (): void => {
    releaseDrawerTrap();
    releaseDrawerTrap = () => undefined;
    setCompactDrawerModal(root);
    closeMobileDrawers(root);
    const returnFocus = drawerReturnFocus;
    drawerReturnFocus = undefined;
    queueMicrotask(() => returnFocus?.isConnected && returnFocus.focus());
  };

  const loadConversionCommands = (): void => {
    if (!services?.listConversionCommands || conversionLoading) return;
    conversionLoading = true;
    conversionStatus = 'Loading conversion tools...';
    render();
    void services.listConversionCommands().then((manifest) => {
      conversionManifest = manifest;
      conversionCommandId = manifest.commands.some((command) => command.id === conversionCommandId)
        ? conversionCommandId
        : manifest.commands.find((command) => command.direction === 'export')?.id ?? manifest.commands[0]?.id;
      conversionResult = undefined;
      conversionStatus = manifest.commands.length ? '' : 'No conversion commands are installed.';
    }, (error) => {
      conversionStatus = error instanceof Error ? error.message : String(error);
    }).finally(() => {
      conversionLoading = false;
      render();
    });
  };

  const setText = (text: string, documentVersion = session.snapshot().documentVersion + 1): void => {
    session.update(text, documentVersion);
    libraryPublishPreviewState = undefined;
    libraryPublishBinding = undefined;
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(text, session.snapshot());
  };
  const setSourceText = (text: string): void => {
    session.update(text, options.host ? session.snapshot().documentVersion : session.snapshot().documentVersion + 1);
    libraryPublishPreviewState = undefined;
    libraryPublishBinding = undefined;
    options.onChange?.(text, session.snapshot());
    if (synchronizedRender) clearTimeout(synchronizedRender);
    synchronizedRender = setTimeout(() => { synchronizedRender = undefined; render(); }, 120);
  };
  const setTitle = (title: string): void => {
    documentTitle = title;
    root.querySelectorAll('[data-document-title]').forEach((element: HTMLElement) => { element.textContent = title; });
  };
  const setUri = (uri: string): void => {
    if (uri === session.uri) return;
    session.setUri(uri);
    externalLoadKey = undefined;
    externalLoad += 1;
    render();
  };
  const select = (pointer: string | undefined, nextMode?: Mode): void => {
    selectedPointer = pointer;
    if (nextMode) {
      if (shouldFitGraphOnEntry(mode, nextMode, graphEntered)) {
        graphEntered = true;
        fitGraphAfterRender = true;
      }
      mode = nextMode;
      if (nextMode === 'design' || nextMode === 'graph' || nextMode === 'source') lastRepresentationMode = nextMode;
    }
    render();
    if (nextMode === 'conversion' && !conversionManifest) loadConversionCommands();
  };
  const openSourceView = (pointer: string | undefined): void => {
    focusSourceAfterMount = true;
    select(pointer, 'source');
    setTimeout(() => {
      if (sourceEditor) {
        sourceEditor.focus();
        focusSourceAfterMount = false;
      }
    }, 0);
  };
  const applyCommandNow = async (command: { canExecute(context: { session: DocumentSession; documentVersion: number }): boolean; execute(context: { session: DocumentSession; documentVersion: number }): { edits: readonly TextEdit[] } }): Promise<string | undefined> => {
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
      const response = await options.host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `ui-${++commandRequest}`, documentVersion: snapshot.documentVersion, edits: result.edits });
      if (!response.applied) { session.update(snapshot.text, snapshot.documentVersion); return 'The host rejected the edit. Refresh the document and try again.'; }
      const hostSnapshot = await options.host.readDocument();
      session.update(hostSnapshot.text, hostSnapshot.documentVersion);
    } else session.update(applyEdits(snapshot.text, result.edits), snapshot.documentVersion + 1);
    libraryPublishPreviewState = undefined;
    libraryPublishBinding = undefined;
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(session.snapshot().text, session.snapshot());
    return undefined;
  };
  const applyCommand = (command: { canExecute(context: { session: DocumentSession; documentVersion: number }): boolean; execute(context: { session: DocumentSession; documentVersion: number }): { edits: readonly TextEdit[] } }): Promise<string | undefined> => {
    const result = commandQueue.then(() => applyCommandNow(command), () => applyCommandNow(command));
    commandQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const render = (): void => {
    if (disposed) return;
    syncSourceModel(sourceModel, session.snapshot().text);
    const mount = ++sourceMount;
    const preservedSource = sourceEditor ? root.querySelector('[data-source]') as HTMLElement | null : null;
    const sourceHadFocus = Boolean(preservedSource?.contains(document.activeElement));
    const focusAnchor = sourceHadFocus ? undefined : captureWorkbenchFocus(root, document.activeElement as HTMLElement | null);
    releaseDrawerTrap();
    releaseDrawerTrap = () => undefined;
    setCompactDrawerModal(root);
    preservedSource?.remove();
    const snapshot = session.snapshot();
    const definitions = (snapshot.model?.projections.definitions ?? []).filter((definition) => definition.reusable);
    const localDefinitionPointers = new Set(definitions.map((definition) => definition.pointer));
    const typeDefinitions = [
      ...definitions.map((definition) => ({ name: definition.name, pointer: definition.pointer, namespace: definition.namespacePointer, imported: false })),
      ...session.effectiveDeclarations
        .filter((declaration) => declaration.imports.length > 0 && !localDefinitionPointers.has(declaration.effectivePointer))
        .map((declaration) => ({
          name: definitionTypeLabel(declaration.effectivePointer),
          pointer: declaration.effectivePointer,
          namespace: declaration.effectivePointer.slice(0, declaration.effectivePointer.lastIndexOf('/')),
          imported: true,
          documentUri: declaration.documentUri,
          sourcePointer: declaration.sourcePointer,
        })),
    ];
    selectedPointer = selectFallback(snapshot, selectedPointer);
    const selectedDefinition = selectedPointer === '' ? undefined : definitions.find((definition) => definition.pointer === selectedPointer) ?? definitions.find((definition) => selectedPointer?.startsWith(`${definition.pointer}/`));
    const definitionPointer = selectedDefinition?.pointer ?? (isInlineRootSchema(session.value) ? '' : undefined);
    const rows = definitionPointer === '' ? projectRootProperties(session.value) : projectProperties(selectedDefinition);
    const effectiveMembers = definitionPointer !== undefined && session.value && typeof session.value === 'object' && !Array.isArray(session.value)
      ? resolveEffectiveMembers(session.value as Record<string, unknown>, definitionPointer, { documentUri: session.uri, resolvedDocuments: session.resolvedSchemaDocuments, addIns: selectedAddIns })
      : undefined;
    const instanceRoots = definitions.filter((definition) => definition.type !== undefined).map((definition) => ({ pointer: definition.pointer, label: definition.name }));
    const defaultInstanceRoot = snapshot.model?.rootPointer ?? (isInlineRootSchema(session.value) ? '' : instanceRoots[0]?.pointer);
    if (instanceRootPointer === undefined || instanceRootPointer !== '' && !instanceRoots.some((root) => root.pointer === instanceRootPointer)) instanceRootPointer = defaultInstanceRoot;
    const graph = projectGraph(snapshot);
    graphNavigation.reconcileSelection(graph.nodes);
    graphNavigationBySnapshot.set(snapshot, graphNavigation);
    const semanticGraphView = semanticGraph.setSource(graph);
    semanticGraphBySnapshot.set(snapshot, semanticGraph);
    graphLayout.reconcile(semanticGraphView.projection.nodes, semanticGraphView.projection.edges);
    forceGraphLayoutBySnapshot.set(snapshot, graphLayout);
    root.innerHTML = structuredWorkbenchShell(snapshot, documentTitle, typeDefinitions, definitionPointer, rows, selectedPointer, mode, problemsOpen, designMemberMode, effectiveMembers, expandedPropertyPointer, options.chrome ?? 'document');
    mountAdvancedViews(root, snapshot, definitionPointer, graph, mode, instanceText, instanceResult, impactDirection, selectedAddIns, refactoringPlan, refactoringStatus, services, conversionManifest, conversionCommandId, conversionSource, conversionResult, conversionStatus, conversionProgress, conversionRequestId, libraryEntries, librarySelector, libraryDocument, librarySelection, libraryOperation, libraryPlan, libraryStatus, { providers: libraryProviders, catalog: libraryCatalog, resolution: libraryResolution, offline: libraryOffline, publishDraft: libraryPublishDraft, publishPreview: libraryPublishPreviewState, publishedEpoch: libraryPublishedEpoch, documentValid: documentCanPublish(snapshot), providerFilter: libraryProviderFilter, search: librarySearch, currentDocumentUri: snapshot.uri }, libraryModalOpen, instanceRoots, instanceRootPointer, instanceSelection, session.resolvedSchemaDocuments, typeDefinitions.map((definition) => definition.namespace));
    root.dataset.theme = themeName;
    const libraryDialog = root.querySelector('[data-library-dialog]') as DialogElement | null;
    if (libraryModalOpen && libraryDialog && !libraryDialog.open) queueMicrotask(() => libraryDialog.isConnected && libraryDialog.showModal());
    const nextSource = root.querySelector('[data-source]');
    if (preservedSource && nextSource) nextSource.replaceWith(preservedSource);
    (['design', 'graph', 'analysis', 'instance', 'conversion', 'source'] as const).forEach((item) => {
      const tab = root.querySelector(`[data-mode="${item}"]`);
      const panel = root.querySelector(`[data-panel-mode="${item}"]`);
      tab?.setAttribute('id', `js-tab-${item}`);
      tab?.setAttribute('aria-controls', `js-panel-${item}`);
      panel?.setAttribute('id', `js-panel-${item}`);
      panel?.setAttribute('role', 'tabpanel');
      panel?.setAttribute('aria-labelledby', `js-tab-${item}`);
    });
    wire(definitionPointer, rows, mode === 'graph' ? semanticGraphView.projection : graph);
    if (sourceHadFocus && sourceEditor) sourceEditor.focus();
    else if (focusSourceAfterMount && sourceEditor) {
      sourceEditor.focus();
      focusSourceAfterMount = false;
    }
    else restoreWorkbenchFocus(root, focusAnchor);
    if (sourceEditor) revealPendingDiagnostic();
    else if (mode === 'source') void mountSourceEditor(root, snapshot.text, sourceModel, setSourceText, themeName, () => !disposed && mount === sourceMount).then((mounted) => {
      if (!mounted) return;
      sourceEditor = mounted.editor;
      sourceModel = mounted.model;
      revealPendingDiagnostic();
      if (focusSourceAfterMount) {
        sourceEditor.focus();
        focusSourceAfterMount = false;
      }
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
    modeButtons.forEach((button) => {
      button.addEventListener('click', () => select(selectedPointer, button.dataset.mode as Mode));
    });
    const representationButtons = [...root.querySelectorAll('.js-tabs [data-mode]')] as HTMLButtonElement[];
    representationButtons.forEach((button, index) => {
      button.tabIndex = button.dataset.mode === lastRepresentationMode ? 0 : -1;
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -index : event.key === 'End' ? representationButtons.length - index - 1 : 0;
        if (!offset && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = representationButtons[(index + offset + representationButtons.length) % representationButtons.length]!;
        select(selectedPointer, next.dataset.mode as Mode);
        (root.querySelector(`[data-mode="${next.dataset.mode}"]`) as HTMLButtonElement | null)?.focus();
      });
    });
    root.querySelectorAll('[data-select]').forEach((target: HTMLButtonElement) => {
      const selectType = (): void => {
        const pointer = target.dataset.select;
        if (mode === 'graph' && pointer) {
          const view = semanticGraph.revealNode(pointer);
          selectedPointer = view.selection?.pointer || undefined;
          fitGraphAfterRender = true;
          render();
          return;
        }
        select(pointer);
      };
      target.addEventListener('click', selectType);
      target.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectType();
        }
      });
    });
    enhanceWorkbenchDom(root, mode);
    root.querySelector('[data-mobile-mode]')?.addEventListener('change', (event: Event) => {
      const nextMode = (event.currentTarget as HTMLInputElement).value as Mode;
      if (nextMode) select(selectedPointer, nextMode);
    });
    const theme = root.querySelector('[data-theme-select]') as HTMLInputElement | null;
    if (theme) theme.value = themeName;
    theme?.addEventListener('change', () => {
      themeName = theme.value as typeof themeName;
      root.dataset.theme = themeName;
      void import('./monaco.js').then(({ setJsonEditorTheme }) => setJsonEditorTheme(themeName));
      void options.onThemeChange?.(themeName);
    });
    root.querySelectorAll('[data-theme-choice]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      themeName = button.dataset.themeChoice as typeof themeName;
      root.dataset.theme = themeName;
      void import('./monaco.js').then(({ setJsonEditorTheme }) => setJsonEditorTheme(themeName));
      void options.onThemeChange?.(themeName);
      closeApplicationMenus(root);
    }));
    root.querySelectorAll('[data-chrome-command]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      void options.onChromeCommand?.(button.dataset.chromeCommand as Parameters<NonNullable<JsonStructureEditorOptions['onChromeCommand']>>[0]);
      closeApplicationMenus(root);
    }));
    wireApplicationMenus(root);
    const filter = root.querySelector('.js-filter') as HTMLInputElement | null;
    filter?.addEventListener('input', () => filterTypeButtons(root, filter.value));
    root.querySelectorAll('[data-mobile-drawer]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const name = button.dataset.mobileDrawer!;
      const opening = !root.querySelector(`[data-drawer-panel="${name}"]`)?.classList.contains('js-drawer-open');
      if (!opening) { closeCompactDrawer(); return; }
      toggleMobileDrawer(root, name);
      drawerReturnFocus = button;
      const panel = root.querySelector(`[data-drawer-panel="${name}"]`) as HTMLElement | null;
      if (panel && compactDrawerMode()) {
        setCompactDrawerModal(root, panel);
        releaseDrawerTrap = trapFocus(panel, closeCompactDrawer);
      }
      queueMicrotask(() => (panel?.querySelector('[data-mobile-drawer-close]') as HTMLElement | null)?.focus());
    }));
    root.querySelectorAll('[data-mobile-drawer-close]').forEach((button: HTMLButtonElement) => button.addEventListener('click', closeCompactDrawer));
    root.querySelectorAll('[data-problems-toggle]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => { problemsOpen = !problemsOpen; render(); }));
    root.querySelector('[data-show-commands]')?.addEventListener('click', () => showCommandPalette());
    root.querySelector('[data-library-open]')?.addEventListener('click', () => {
      libraryOperation = 'import';
      libraryModalOpen = true;
      render();
    });
    const libraryDialog = root.querySelector('[data-library-dialog]') as DialogElement | null;
    const closeLibraryDialog = (): void => {
      libraryModalOpen = false;
      libraryDialog?.close();
      render();
    };
    root.querySelector('[data-library-close]')?.addEventListener('click', closeLibraryDialog);
    libraryDialog?.addEventListener('cancel', (event: Event) => { event.preventDefault(); closeLibraryDialog(); });
    root.querySelectorAll('[data-member-mode]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      designMemberMode = button.dataset.memberMode as DesignMemberMode;
      render();
    }));
    root.querySelectorAll('[data-property-details]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.propertyDetails;
      if (!pointer) return;
      expandedPropertyPointer = expandedPropertyPointer === pointer ? undefined : pointer;
      selectedPointer = pointer;
      render();
    }));
    root.querySelectorAll('[data-inline-property="name"]').forEach((input: HTMLInputElement) => {
      input.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
      input.addEventListener('change', () => {
        const pointer = input.dataset.propertyPointer;
        const nextName = input.value.trim();
        if (!pointer || !nextName || nextName === pointerLabel(pointer)) return;
        const action = actionById('property.rename');
        if (!action) return;
        const ownerPointer = propertyOwnerPointer(pointer);
        const nextPointer = `${ownerPointer}/properties/${escapePointerToken(nextName)}`;
        void applyCommand(action.create(pointer, nextName)).then((error) => {
          if (error) { setInlineStatus(root, pointer, error); return; }
          if (expandedPropertyPointer === pointer) expandedPropertyPointer = nextPointer;
          selectedPointer = nextPointer;
          render();
          queueMicrotask(() => (root.querySelector(`[data-inline-property="name"][data-property-pointer="${cssAttributeValue(nextPointer)}"]`) as HTMLElement | null)?.focus());
        });
      });
    });
    const applyInlineType = (selectControl: HTMLSelectElement, selectedValue = selectControl.value): void => {
      const pointer = selectControl.dataset.propertyPointer;
      if (!pointer) return;
      const [kind, ...parts] = selectedValue.split(':');
      const value = parts.join(':');
      const action = actionById(kind === 'ref' ? 'reference.type' : 'core.type');
      if (!action) return;
      selectedPointer = pointer;
      void applyCommand(action.create(pointer, value)).then((error) => error && setInlineStatus(root, pointer, error));
    };
    root.querySelectorAll('[data-inline-property="type"]').forEach((selectControl: HTMLSelectElement) => selectControl.addEventListener('change', () => applyInlineType(selectControl)));
    root.querySelectorAll('[data-type-drag]').forEach((source: HTMLElement) => {
      source.addEventListener('dragstart', (event: DragEvent) => {
        const pointer = source.dataset.typeDrag;
        if (!pointer || !event.dataTransfer) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'link';
        event.dataTransfer.setData('application/vnd.json-structure.type-ref', `#${pointer}`);
        event.dataTransfer.setData('text/plain', `#${pointer}`);
        source.classList.add('js-type-dragging');
        root.classList.add('js-type-drag-active');
      });
      source.addEventListener('dragend', () => {
        source.classList.remove('js-type-dragging');
        root.classList.remove('js-type-drag-active');
        root.querySelectorAll('.js-type-drop-active').forEach((target: HTMLElement) => target.classList.remove('js-type-drop-active'));
      });
    });
    const typeDropTargets = [...root.querySelectorAll('[data-type-drop]')] as HTMLElement[];
    const clearTypeDropTarget = (): void => typeDropTargets.forEach((target) => target.classList.remove('js-type-drop-active'));
    const typeDropTargetAt = (event: DragEvent): HTMLElement | undefined => {
      const direct = event.target?.closest?.('[data-type-drop]') as HTMLElement | null;
      if (direct) return direct;
      return typeDropTargets.find((target) => {
        const bounds = target.getBoundingClientRect();
        return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
    };
    const designPanel = root.querySelector('#js-panel-design') as HTMLElement | null;
    designPanel?.addEventListener('dragover', (event: DragEvent) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('application/vnd.json-structure.type-ref')) return;
      const target = typeDropTargetAt(event);
      clearTypeDropTarget();
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'link';
      target.classList.add('js-type-drop-active');
    });
    designPanel?.addEventListener('dragleave', (event: DragEvent) => {
      if (!event.relatedTarget || !designPanel.contains(event.relatedTarget)) clearTypeDropTarget();
    });
    designPanel?.addEventListener('drop', (event: DragEvent) => {
      const target = typeDropTargetAt(event);
      clearTypeDropTarget();
      if (!target || !event.dataTransfer) return;
      const selectControl = target.querySelector('[data-inline-property="type"]') as HTMLSelectElement | null;
      const reference = event.dataTransfer.getData('application/vnd.json-structure.type-ref');
      const selectedValue = `ref:${reference}`;
      if (!selectControl || !reference || !(Array.from(selectControl.options) as Array<{ readonly value: string }>).some((option) => option.value === selectedValue)) return;
      event.preventDefault();
      selectControl.value = selectedValue;
      applyInlineType(selectControl, selectedValue);
    });
    root.querySelectorAll('[data-inline-property="required"]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', () => {
      const pointer = checkbox.dataset.propertyPointer;
      if (!pointer) return;
      const ownerPointer = propertyOwnerPointer(pointer);
      const owner = valueAtPointer(session.value, ownerPointer) as Record<string, unknown> | undefined;
      const propertyName = pointerLabel(pointer);
      const required = Array.isArray(owner?.required) && owner.required.every((entry) => typeof entry === 'string') ? [...owner.required] as string[] : [];
      const next = checkbox.checked ? [...required.filter((name) => name !== propertyName), propertyName] : required.filter((name) => name !== propertyName);
      const action = actionById('property.required');
      if (!action) return;
      void applyCommand(action.create(ownerPointer, next)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    const commitInlineDescription = async (input: HTMLInputElement): Promise<string | undefined> => {
      const pointer = input.dataset.propertyPointer;
      const action = actionById('property.description');
      if (!pointer || !action) return 'The description editor is no longer available.';
      const schema = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
      const nextDescription = input.value.trim() === '' ? undefined : input.value;
      if (schema?.description === nextDescription || schema?.description === undefined && nextDescription === undefined) return undefined;
      return applyCommand(action.create(pointer, nextDescription));
    };
    const addInlineProperty = async (ownerPointer: string): Promise<string | undefined> => {
      const action = actionById('property.add');
      const owner = valueAtPointer(session.value, ownerPointer);
      if (!action || !isRecord(owner)) return 'A property cannot be added at this location.';
      const propertyName = availablePropertyName(owner);
      const nextPointer = `${ownerPointer}/properties/${escapePointerToken(propertyName)}`;
      const previousPointer = selectedPointer;
      selectedPointer = nextPointer;
      const error = await applyCommand(action.create(ownerPointer, { type: 'string' }, propertyName));
      if (error) { selectedPointer = previousPointer; return error; }
      const nameControl = ([...root.querySelectorAll('[data-inline-property="name"]')] as HTMLInputElement[]).find((control) => control.dataset.propertyPointer === nextPointer);
      nameControl?.focus();
      nameControl?.select();
      return undefined;
    };
    root.querySelectorAll('[data-inline-property="description"]').forEach((input: HTMLInputElement) => {
      input.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
      input.addEventListener('change', () => {
        if (input.dataset.skipDescriptionChange === 'true') { delete input.dataset.skipDescriptionChange; return; }
        input.setCustomValidity('');
        void commitInlineDescription(input).then((error) => {
          if (!error) return;
          input.setCustomValidity(error);
          input.reportValidity();
        });
      });
    });
    root.querySelectorAll('.js-inline-property-row [data-inline-property]').forEach((control: HTMLElement) => control.addEventListener('keydown', (event: KeyboardEvent) => {
      const pointer = control.dataset.propertyPointer;
      const column = control.dataset.inlineProperty;
      if (!pointer || !column) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowDown') {
        event.preventDefault();
        selectedPointer = pointer;
        const focusDetails = (): void => {
          const editor = ([...root.querySelectorAll('[data-property-editor]')] as HTMLElement[]).find((candidate) => candidate.dataset.propertyEditor === pointer);
          (editor?.querySelector('.js-property-details input,.js-property-details select,.js-property-details textarea,.js-property-details button') as HTMLElement | null)?.focus();
        };
        if (expandedPropertyPointer !== pointer) { expandedPropertyPointer = pointer; render(); }
        queueMicrotask(focusDetails);
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        const controls = [...root.querySelectorAll(`.js-inline-property-row [data-inline-property="${column}"]`)] as HTMLElement[];
        const adjacent = controls[controls.indexOf(control) + (event.key === 'ArrowDown' ? 1 : -1)];
        event.preventDefault();
        adjacent?.focus();
        return;
      }
      if (column !== 'description' || event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const editors = [...root.querySelectorAll('[data-property-editor]')] as HTMLElement[];
      const currentEditor = control.closest('[data-property-editor]') as HTMLElement | null;
      if (!currentEditor) return;
      event.preventDefault();
      const input = control as HTMLInputElement;
      input.dataset.skipDescriptionChange = 'true';
      input.blur();
      delete input.dataset.skipDescriptionChange;
      void commitInlineDescription(input).then(async (descriptionError) => {
        if (!descriptionError && editors.at(-1) !== currentEditor) {
          const currentIndex = editors.indexOf(currentEditor);
          const nextPointer = editors[currentIndex + 1]?.dataset.propertyEditor;
          const nextName = nextPointer ? ([...root.querySelectorAll('[data-inline-property="name"]')] as HTMLInputElement[]).find((candidate) => candidate.dataset.propertyPointer === nextPointer) : undefined;
          nextName?.focus();
          nextName?.select();
          return;
        }
        const error = descriptionError ?? await addInlineProperty(propertyOwnerPointer(pointer));
        if (!error) return;
        const current = ([...root.querySelectorAll('[data-inline-property="description"]')] as HTMLInputElement[]).find((candidate) => candidate.dataset.propertyPointer === pointer) ?? input;
        current.setCustomValidity(error);
        current.reportValidity();
        current.focus();
      });
    }));
    root.querySelectorAll('[data-inline-keyword]').forEach((control: HTMLInputElement) => control.addEventListener('change', () => {
      const pointer = control.dataset.propertyPointer;
      const keyword = control.dataset.inlineKeyword;
      const family = control.dataset.inlineFamily;
      if (!pointer || !keyword || !family) return;
      const raw = control.dataset.valueKind === 'boolean' ? String(control.checked) : control.value.trim();
      const remove = control.dataset.valueKind !== 'boolean' && raw === '';
      const action = actionById(`${inlineKeywordActionId(family, keyword)}${remove ? '.remove' : ''}`);
      if (!action) { setInlineStatus(root, pointer, `${keyword} is not available in this profile.`); return; }
      let value: unknown;
      try { value = remove ? undefined : parseActionValue(action, raw, control.checked, effectiveSchemaType(session.value, pointer)); }
      catch (error) { setInlineStatus(root, pointer, error instanceof Error ? error.message : String(error)); return; }
      void applyCommand(action.create(pointer, value)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-catalog]').forEach((field: HTMLElement) => {
      const actionId = field.dataset.inlineCatalog;
      const pointer = field.dataset.propertyPointer;
      const action = actionId ? actionById(actionId) : undefined;
      const status = pointer ? root.querySelector(`[data-inline-status="${cssAttributeValue(pointer)}"]`) as HTMLElement | null : null;
      if (!action || !pointer || !status) return;
      wireCatalogControl(field, action, session, catalogRegistry, status, () => {
        const input = field.querySelector('[data-inline-keyword]') as HTMLInputElement | null;
        input?.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    root.querySelectorAll('[data-inline-keyword-remove]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.propertyPointer;
      const actionId = button.dataset.inlineKeywordRemove;
      const action = actionId ? actionById(actionId) : undefined;
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-effective-source]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const sourcePointer = button.dataset.effectiveSource;
      const sourceDocument = button.dataset.effectiveDocument;
      if (!sourcePointer) return;
      if (!sourceDocument || sourceDocument === session.uri) {
        pendingDiagnostic = { uri: session.uri, pointer: sourcePointer, range: session.model?.nodes.find((node) => node.pointer === sourcePointer)?.range };
        select(sourcePointer, 'source');
      } else {
        selectedPointer = definitionPointer;
        mode = 'analysis';
        refactoringStatus = `Declared in ${sourceDocument} at ${sourcePointer}. Open the import source from the Imports lens or Libraries.`;
        render();
      }
    }));
    root.querySelectorAll('[data-command="definition.add"]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => openAction('definition.add', '')));
    root.querySelector('[data-command="add"]')?.addEventListener('click', () => openAction('property.add', definitionPointer));
    root.querySelectorAll('[data-action-id]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => openAction(button.dataset.actionId!, button.dataset.actionPointer ?? selectedPointer)));
    root.querySelectorAll('[data-property-detail-add]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const select = button.closest('.js-detail-add')?.querySelector('[data-property-detail-select]') as HTMLSelectElement | null;
      const pointer = button.dataset.propertyPointer;
      if (select?.value && pointer) openAction(select.value, pointer);
    }));
    root.querySelectorAll('[data-relation-cardinality]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const action = actionById('relation.cardinality');
      const pointer = button.dataset.actionPointer;
      if (!action || !pointer) return;
      void applyCommand(action.create(pointer, button.dataset.relationCardinality));
    }));
    root.querySelector('[data-action-apply]')?.addEventListener('click', () => {
      const select = root.querySelector('[data-action-select]') as HTMLInputElement;
      const action = actionById(select.value);
      const pointer = selectedPointer ?? definitionPointer;
      if (action && pointer !== undefined) showActionEditor(root, action, pointer, session, catalogRegistry, applyCommand, undefined, () => openSourceView(pointer));
    });
    function openAction(id: string, pointer: string | undefined): void {
      const action = actionById(id);
      if (action && pointer !== undefined) showActionEditor(root, action, pointer, session, catalogRegistry, applyCommand, undefined, () => openSourceView(pointer));
    }
    root.querySelectorAll('[data-problem]').forEach((button: HTMLButtonElement, index: number) => button.addEventListener('click', () => {
      pendingDiagnostic = session.snapshot().diagnostics[index]?.location;
      select(button.dataset.problem, 'source');
    }));
        const instanceInput = root.querySelector('[data-instance-input]') as HTMLInputElement | null;
        instanceInput?.addEventListener('change', () => {
          const file = instanceInput.files?.[0];
          if (!file) return;
          void file.text().then((text: string) => {
            JSON.parse(text);
            instanceText = text;
            instanceResult = undefined;
            render();
          }).catch((error: unknown) => {
            instanceWorkspace = undefined;
            instanceResult = { status: 'invalid', diagnostics: [{ code: 'instance.parse', message: error instanceof Error ? error.message : String(error), severity: 'error', instancePointer: '', schemaPointer: instanceRootPointer ?? '' }], trace: { keyword: 'parse', status: 'invalid', instancePointer: '', schemaPointer: instanceRootPointer ?? '', children: [] } };
            instanceSelection = { source: 'diagnostic', instancePointer: '', schemaPointer: instanceRootPointer ?? '', diagnosticIndex: 0 };
            render();
          });
        });
        root.querySelector('[data-instance-root]')?.addEventListener('change', (event: Event) => {
          instanceRootPointer = (event.currentTarget as HTMLInputElement).value;
          instanceResult = undefined;
          instanceWorkspace = undefined;
          instanceSelection = undefined;
          render();
        });
        root.querySelector('[data-instance-validate]')?.addEventListener('click', () => {
          try {
            if (!session.value || typeof session.value !== 'object' || Array.isArray(session.value)) throw new Error('The schema document is unavailable.');
            const rootPointer = instanceRootPointer ?? '';
            const rootSchema = rootPointer === '' ? session.value as Record<string, unknown> : { ...(session.value as Record<string, unknown>), $root: `#${rootPointer}` };
            instanceWorkspace = new InstanceWorkspace(rootSchema, JSON.parse(instanceText), { documentUri: session.uri, resolvedDocuments: session.resolvedSchemaDocuments });
            instanceResult = instanceWorkspace.validate();
            instanceSelection = instanceWorkspace.selection;
          } catch (error) {
            instanceWorkspace = undefined;
            instanceResult = { status: 'invalid', diagnostics: [{ code: 'instance.parse', message: error instanceof Error ? error.message : String(error), severity: 'error', instancePointer: '', schemaPointer: instanceRootPointer ?? '' }], trace: { keyword: 'parse', status: 'invalid', instancePointer: '', schemaPointer: instanceRootPointer ?? '', children: [] } };
            instanceSelection = { source: 'diagnostic', instancePointer: '', schemaPointer: instanceRootPointer ?? '', diagnosticIndex: 0 };
          }
          render();
        });
        root.querySelectorAll('[data-instance-diagnostic]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
          const index = Number(button.dataset.instanceDiagnostic);
          instanceSelection = instanceWorkspace?.selectDiagnostic(index) ?? { source: 'diagnostic', instancePointer: instanceResult?.diagnostics[index]?.instancePointer ?? '', schemaPointer: instanceResult?.diagnostics[index]?.schemaPointer ?? '', diagnosticIndex: index };
          const schemaPointer = instanceSelection.schemaPointer;
          const currentSnapshot = session.snapshot();
          pendingDiagnostic = { uri: currentSnapshot.uri, pointer: schemaPointer, range: currentSnapshot.model?.nodes.find((node) => node.pointer === schemaPointer)?.range };
          select(schemaPointer, 'source');
        }));
        root.querySelectorAll('[data-trace-instance]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
          instanceSelection = instanceWorkspace?.selectInstance(button.dataset.traceInstance ?? '', button.dataset.traceSchema ?? '') ?? { source: 'instance', instancePointer: button.dataset.traceInstance ?? '', schemaPointer: button.dataset.traceSchema ?? '' };
          render();
        }));
        root.querySelectorAll('[data-trace-schema]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
          const schemaPointer = button.dataset.traceSchema ?? '';
          instanceSelection = instanceWorkspace?.selectSchema(schemaPointer, button.dataset.traceInstance ?? '') ?? { source: 'schema', instancePointer: button.dataset.traceInstance ?? '', schemaPointer };
          const currentSnapshot = session.snapshot();
          pendingDiagnostic = { uri: currentSnapshot.uri, pointer: schemaPointer, range: currentSnapshot.model?.nodes.find((node) => node.pointer === schemaPointer)?.range };
          select(schemaPointer, 'source');
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
    root.querySelector('[data-conversion-load]')?.addEventListener('click', loadConversionCommands);
    root.querySelectorAll('[data-conversion-command]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      conversionCommandId = button.dataset.conversionCommand;
      conversionSource = undefined;
      conversionResult = undefined;
      conversionStatus = '';
      render();
      queueMicrotask(() => ([...root.querySelectorAll('[data-conversion-command]')] as HTMLButtonElement[]).find((candidate) => candidate.dataset.conversionCommand === conversionCommandId)?.focus());
    }));
    root.querySelector('[data-conversion-source]')?.addEventListener('click', () => {
      const command = conversionManifest?.commands.find((item) => item.id === conversionCommandId);
      if (!command || command.direction !== 'import' || !services?.selectConversionSource) return;
      conversionStatus = 'Choosing source file...'; render();
      void services.selectConversionSource({ protocolVersion: PROTOCOL_VERSION, requestId: `conversion-source-${Date.now()}`, kind: 'select-conversion-source', formats: [command.sourceFormat] }).then((source) => {
        conversionSource = source;
        conversionResult = undefined;
        conversionStatus = source ? `Selected ${source.name}.` : 'Source selection was cancelled.';
        render();
        queueMicrotask(() => (root.querySelector('[data-conversion-source]') as HTMLElement | null)?.focus());
      }, (error) => { conversionStatus = error instanceof Error ? error.message : String(error); render(); });
    });
    root.querySelector('[data-conversion-run]')?.addEventListener('click', () => {
      const command = conversionManifest?.commands.find((item) => item.id === conversionCommandId);
      if (!command || !services?.convert) return;
      if (command.direction === 'import' && !conversionSource) { conversionStatus = 'Choose a source file before importing.'; render(); return; }
      const current = session.snapshot();
      let conversionOptions: ConversionOptionValues;
      try { conversionOptions = readConversionOptions(root); }
      catch (error) { conversionStatus = error instanceof Error ? error.message : String(error); render(); return; }
      conversionRequestId = `convert-${Date.now()}`; conversionProgress = undefined; conversionResult = undefined; conversionStatus = 'Converting...'; render();
      const sourceName = command.direction === 'import' ? conversionSource!.name : current.uri.replace(/^.*[\\/]/, '') || 'schema.struct.json';
      const sourceText = command.direction === 'import' ? conversionSource!.text : current.text;
      void services.convert({ protocolVersion: PROTOCOL_VERSION, requestId: conversionRequestId, kind: 'conversion', documentVersion: current.documentVersion, commandId: command.id, sourceName, sourceText, options: conversionOptions }).then(async (result) => {
        conversionRequestId = undefined; conversionProgress = undefined;
        conversionResult = result;
        conversionStatus = result.succeeded ? `Generated ${result.outputs.length} output${result.outputs.length === 1 ? '' : 's'}.` : result.diagnostics.map((diagnostic) => diagnostic.message).join(' ');
        if (result.succeeded && command.defaultAutoOpen && services.openGeneratedOutput) await services.openGeneratedOutput({ protocolVersion: PROTOCOL_VERSION, requestId: `open-${Date.now()}`, kind: 'open-generated-output', outputs: result.outputs });
        render();
        queueMicrotask(() => (root.querySelector('[data-conversion-run]') as HTMLElement | null)?.focus());
      }, (error) => { conversionRequestId = undefined; conversionProgress = undefined; conversionStatus = error instanceof Error ? error.message : String(error); render(); queueMicrotask(() => (root.querySelector('[data-conversion-run]') as HTMLElement | null)?.focus()); });
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
    const filterLibraryCatalog = (): void => {
      const query = librarySearch.trim().toLocaleLowerCase();
      let visible = 0;
      let total = 0;
      root.querySelectorAll('[data-library-provider-filter]').forEach((button: HTMLButtonElement) => button.setAttribute('aria-pressed', String((button.dataset.libraryProviderFilter ?? '') === libraryProviderFilter)));
      root.querySelectorAll('[data-library-provider-id]').forEach((entry: HTMLElement) => {
        total += 1;
        const providerMatches = libraryProviderFilter === 'all' || (entry.dataset.libraryProviderId ?? '') === libraryProviderFilter;
        const searchMatches = !query || (entry.dataset.librarySearchText ?? '').includes(query);
        entry.hidden = !(providerMatches && searchMatches);
        if (!entry.hidden) visible += 1;
      });
      const count = root.querySelector('[data-library-catalog-count]');
      if (count) count.textContent = `${visible} of ${total} entries`;
    };
    root.querySelectorAll('[data-library-provider-filter]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      libraryProviderFilter = button.dataset.libraryProviderFilter ?? '';
      filterLibraryCatalog();
    }));
    root.querySelector('[data-library-search]')?.addEventListener('input', (event: Event) => {
      librarySearch = (event.currentTarget as HTMLInputElement).value;
      filterLibraryCatalog();
    });
    root.querySelector('[data-libraries-load]')?.addEventListener('click', () => {
      libraryResolveSequence += 1;
      if (services?.libraryRequest) {
        libraryStatus = 'Refreshing library providers and catalog...'; render();
        void Promise.all([services.libraryRequest<readonly LibraryProviderSummary[]>('listProviders'), loadLibraryCatalog(services.libraryRequest)])
          .then(([providers, catalog]) => { libraryProviders = providers; libraryCatalog = catalog; libraryResolution = undefined; libraryDocument = undefined; librarySelection = []; libraryPlan = undefined; libraryStatus = `Loaded ${catalog.length} catalog entries from ${providers.length} providers.`; render(); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); });
      } else void services?.listLibraryEntries?.().then((entries) => { libraryEntries = entries; libraryDocument = undefined; librarySelection = []; libraryPlan = undefined; libraryStatus = ''; render(); }, (error) => { libraryStatus = error instanceof Error ? error.message : String(error); render(); });
    });
    root.querySelector('[data-library-offline]')?.addEventListener('change', (event: Event) => { libraryResolveSequence += 1; libraryOffline = (event.currentTarget as HTMLInputElement).checked; libraryResolution = undefined; libraryDocument = undefined; libraryPlan = undefined; render(); });
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
    root.querySelector('[data-local-provider-configure]')?.addEventListener('click', () => {
      if (!services?.libraryRequest) return;
      const id = (root.querySelector('[data-local-provider-id]') as HTMLInputElement | null)?.value.trim() ?? '';
      if (!id) return;
      libraryStatus = 'Configuring local publisher...';
      void services.libraryRequest<LibraryProviderSummary>('configureProvider', { config: { id, kind: 'local', location: `memory://published/${encodeURIComponent(id)}/`, entries: [], trusted: true } })
        .then(() => Promise.all([services.libraryRequest!<readonly LibraryProviderSummary[]>('listProviders'), loadLibraryCatalog(services.libraryRequest!)]))
        .then(([providers, catalog]) => { libraryProviders = providers; libraryCatalog = catalog; libraryStatus = `Configured local publisher '${id}'.`; render(); queueMicrotask(() => (root.querySelector(`[data-library-provider-filter="${cssAttributeValue(id)}"]`) as HTMLElement | null)?.focus()); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); queueMicrotask(() => (root.querySelector('[data-library-status]') as HTMLElement | null)?.focus()); });
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
      libraryResolveSequence += 1;
      librarySelector = input.value as typeof librarySelector;
      libraryDocument = undefined;
      librarySelection = [];
      libraryPlan = undefined;
      render();
    }));
    root.querySelectorAll('[data-library-read]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const resolveSequence = ++libraryResolveSequence;
      const explicitProviderId = button.dataset.libraryProvider;
      const explicitEntryId = button.dataset.libraryEntry;
      const explicitVersion = button.dataset.libraryVersion;
      const [legacyProviderOrEntryId, legacyEntryOrVersion, legacyRequestedVersion] = (button.dataset.libraryRead ?? '').split('\u0000');
      const providerOrEntryId = explicitProviderId ?? explicitEntryId ?? legacyProviderOrEntryId;
      const entryOrVersion = explicitProviderId ? explicitEntryId : explicitVersion ?? legacyEntryOrVersion;
      const requestedVersion = explicitProviderId ? explicitVersion : legacyRequestedVersion;
      const catalogEntry = libraryCatalog?.find((candidate) => candidate.providerId === providerOrEntryId && candidate.id === entryOrVersion);
      const entryId = catalogEntry ? entryOrVersion : providerOrEntryId;
      const entry = catalogEntry ?? libraryEntries?.find((candidate) => candidate.id === entryId);
      const pinnedVersion = catalogEntry ? requestedVersion : entryOrVersion;
      const version = librarySelector === 'floating' ? entry?.versions.find((candidate) => candidate.isDefault)?.version ?? entry?.versions.at(-1)?.version : pinnedVersion;
      if (services?.libraryRequest && catalogEntry && providerOrEntryId && entryId) {
        const selector = librarySelector === 'floating' ? { kind: 'floating' as const } : { kind: 'pinned' as const, version: requestedVersion ?? '' };
        libraryStatus = 'Resolving...'; render();
        void resolveLibrarySelection<LibraryHostResolution>(services.libraryRequest, { providerId: providerOrEntryId, entryId, selector, offline: libraryOffline }).then((resolution) => {
          if (resolveSequence !== libraryResolveSequence) return;
          libraryResolution = resolution; libraryDocument = { entryId: resolution.provenance.entryId, version: resolution.provenance.version, uri: resolution.provenance.sourceUri, value: resolution.document }; librarySelection = []; libraryPlan = undefined; libraryStatus = `Resolved ${resolution.provenance.entryId} ${resolution.provenance.version}: ${resolution.resolution.label}.`; render();
        }, (error) => { if (resolveSequence !== libraryResolveSequence) return; libraryStatus = libraryConflictMessage(error); render(); });
        return;
      }
      if (!entryId || !version || !services?.readLibraryDocument) return;
      libraryStatus = 'Loading...'; render();
      void services.readLibraryDocument(entryId, version).then((document) => { if (resolveSequence !== libraryResolveSequence) return; libraryDocument = document; librarySelection = []; libraryPlan = undefined; libraryStatus = `Resolved ${document.entryId} ${document.version}.`; render(); }, (error) => { if (resolveSequence !== libraryResolveSequence) return; libraryStatus = error instanceof Error ? error.message : String(error); render(); });
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
      queueMicrotask(() => ((root.querySelector('[data-library-apply]') ?? root.querySelector('[data-library-status]')) as HTMLElement | null)?.focus());
    });
    root.querySelector('[data-library-apply]')?.addEventListener('click', () => {
      if (!libraryPlan?.applicable || !libraryBinding) return;
      void applyCommand(refactoringPlanCommand(libraryPlan, libraryBinding)).then((error) => {
        libraryStatus = error ?? `Applied ${libraryOperation} with ${libraryPlan?.provenance.length ?? 0} provenance records.`;
        if (!error) { libraryPlan = undefined; librarySelection = []; libraryModalOpen = false; }
        render();
        queueMicrotask(() => (root.querySelector('[data-library-status]') as HTMLElement | null)?.focus());
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
      libraryPublishPreviewState = libraryPublishPreview(libraryPublishDraft, libraryProviders ?? [], libraryCatalog ?? [], documentCanPublish(session.snapshot()));
      libraryPublishBinding = libraryPublishPreviewState.valid ? bindPreview(session.snapshot()) : undefined;
      libraryPublishedEpoch = undefined;
      libraryStatus = libraryPublishPreviewState.valid ? 'Publish preview ready. Review publication details, then publish explicitly.' : 'Publish preview is invalid. Resolve schema errors and version collisions, then verify provider, entry, version, and source URI.';
      render();
      queueMicrotask(() => ((root.querySelector('[data-library-publish]') ?? root.querySelector('[data-library-publish-preview]')) as HTMLElement | null)?.focus());
    });
    root.querySelector('[data-library-publish]')?.addEventListener('click', () => {
      const snapshot = session.snapshot();
      if (!services?.libraryRequest || !libraryPublishPreviewState?.valid || !libraryPublishDraft || !libraryPublishBinding || !documentCanPublish(snapshot)) return;
      if (libraryPublishBinding.documentVersion !== snapshot.documentVersion || libraryPublishBinding.sourceText !== snapshot.text) {
        libraryPublishPreviewState = undefined;
        libraryPublishBinding = undefined;
        libraryStatus = 'The document changed after this publish preview. Preview again before publishing.';
        render();
        return;
      }
      const reviewedDocument = JSON.parse(libraryPublishBinding.sourceText) as unknown;
      libraryStatus = 'Publishing...'; render();
      void services.libraryRequest<{ epoch: string }>('publish', { ...libraryPublishDraft, document: reviewedDocument })
        .then((result) => Promise.all([services.libraryRequest!<readonly LibraryProviderSummary[]>('listProviders'), loadLibraryCatalog(services.libraryRequest!)]).then(([providers, catalog]) => ({ result, providers, catalog })))
        .then(({ result, providers, catalog }) => { libraryProviders = providers; libraryCatalog = catalog; libraryPublishedEpoch = result.epoch; libraryPublishPreviewState = undefined; libraryPublishBinding = undefined; libraryStatus = `Published ${libraryPublishDraft?.entryId}@${libraryPublishDraft?.version}; resulting epoch ${result.epoch}.`; render(); queueMicrotask(() => (root.querySelector('[data-library-status]') as HTMLElement | null)?.focus()); }, (error) => { libraryStatus = libraryConflictMessage(error); render(); queueMicrotask(() => (root.querySelector('[data-library-status]') as HTMLElement | null)?.focus()); });
    });
    wireGraph(graph);
  };
  const wireGraph = (graph: ReturnType<typeof projectGraph>): void => {
    graphResizeObserver?.disconnect();
    graphLayout.setTickListener(undefined);
    const suppressedGraphClicks = new Set<string>();
    root.querySelectorAll('[data-graph-select]').forEach((target: SVGElement) => {
      const activate = (): void => {
        const nodeId = target.dataset.graphNode;
        if (!nodeId) return;
        const view = semanticGraph.selectNode(nodeId);
        selectedPointer = view.selection?.pointer || undefined;
        render();
      };
      target.addEventListener('click', () => {
        const nodeId = target.dataset.graphNode;
        if (!nodeId) return;
        if (suppressedGraphClicks.delete(nodeId)) return;
        const pending = pendingGraphActivation;
        if (pending?.nodeId === nodeId) return;
        if (pendingGraphActivation) clearTimeout(pendingGraphActivation.timer);
        const timer = setTimeout(() => {
          if (disposed || pendingGraphActivation?.timer !== timer) return;
          pendingGraphActivation = undefined;
          activate();
        }, 240);
        pendingGraphActivation = { nodeId, timer };
      });
      target.addEventListener('dblclick', (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        const nodeId = target.dataset.graphNode;
        if (!nodeId) return;
        if (pendingGraphActivation) clearTimeout(pendingGraphActivation.timer);
        pendingGraphActivation = undefined;
        const view = semanticGraph.openNode(nodeId);
        selectedPointer = view.selection?.pointer || undefined;
        mode = 'graph';
        lastRepresentationMode = 'graph';
        fitGraphAfterRender = true;
        render();
      });
      target.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const nodeId = target.dataset.graphNode;
          if (!nodeId) return;
          semanticGraph.openNode(nodeId);
          fitGraphAfterRender = true;
          render();
        } else if (event.key === ' ') { event.preventDefault(); activate(); }
      });
    });
    root.querySelectorAll('[data-graph-edge-select]').forEach((target: SVGElement) => {
      const activate = (): void => {
        const edgeId = target.dataset.graphEdgeSelect;
        if (!edgeId) return;
        const view = semanticGraph.selectEdge(edgeId);
        selectedPointer = view.selection?.pointer || undefined;
        render();
      };
      target.addEventListener('click', activate);
      target.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    });
    root.querySelectorAll('[data-graph-lens]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const view = semanticGraph.setLens(button.dataset.graphLens as import('../graph.js').ProjectionId);
      selectedPointer = view.selection?.pointer || undefined;
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelector('[data-graph-search]')?.addEventListener('input', (event: Event) => {
      semanticGraph.setSearch((event.currentTarget as HTMLInputElement).value);
      render();
      queueMicrotask(() => {
        const search = root.querySelector('[data-graph-search]') as HTMLInputElement | null;
        search?.focus();
        search?.setSelectionRange(search.value.length, search.value.length);
      });
    });
    root.querySelectorAll('[data-graph-breadcrumb]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const level = button.dataset.graphBreadcrumb;
      if (level === 'atlas') semanticGraph.home();
      else if (level === 'types' && semanticGraph.view().location.level === 'neighborhood') semanticGraph.drillOut();
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelector('[data-graph-fit]')?.addEventListener('click', () => { graphNavigation.fit(); updateGraphCamera(); });
    root.querySelector('[data-graph-zoom-out]')?.addEventListener('click', () => zoomGraphAtCenter(-0.1));
    root.querySelector('[data-graph-zoom-in]')?.addEventListener('click', () => zoomGraphAtCenter(0.1));
    root.querySelector('[data-graph-relayout]')?.addEventListener('click', () => {
      graphLayout.relayout();
      if (prefersReducedMotion()) graphLayout.settle();
    });
    root.querySelector('[data-graph-back]')?.addEventListener('click', () => { const view = semanticGraph.back(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-forward]')?.addEventListener('click', () => { const view = semanticGraph.forward(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-home]')?.addEventListener('click', () => { const view = semanticGraph.home(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-out]')?.addEventListener('click', () => { const view = semanticGraph.drillOut(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-open-selection]')?.addEventListener('click', () => { const view = semanticGraph.openSelection(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); });
    root.querySelectorAll('[data-graph-history]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const view = semanticGraph.restore(Number(button.dataset.graphHistory));
      selectedPointer = view.selection?.pointer || undefined;
      fitGraphAfterRender = true;
      render();
    }));
    const canvas = root.querySelector('[data-graph-canvas]') as SVGElement | null;
    if (!canvas) return;
    const graphWorld = canvas.querySelector('[data-graph-world]') as SVGElement | null;
    const updateGraphCamera = (): void => {
      const state = graphNavigation.snapshot();
      graphWorld?.setAttribute('transform', `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.zoom})`);
      const readout = root.querySelector('[data-semantic-zoom]');
      if (readout) {
        readout.textContent = `${Math.round(state.camera.zoom * 100)}%`;
        readout.setAttribute('data-semantic-zoom', state.semanticZoom);
      }
      const bounds = graphLayout.contentBounds();
      const minimap = graphNavigation.minimap();
      const viewport = clampMinimapViewport(minimap.viewport, bounds.width, bounds.height);
      const viewportElement = root.querySelector('.js-minimap-viewport');
      viewportElement?.setAttribute('x', String(viewport.x));
      viewportElement?.setAttribute('y', String(viewport.y));
      viewportElement?.setAttribute('width', String(viewport.width));
      viewportElement?.setAttribute('height', String(viewport.height));
    };
    const updateGraphGeometry = (): void => {
      const positions = new Map(graphLayout.positions().map((position) => [position.id, position]));
      ([...canvas.querySelectorAll('[data-graph-node]')] as SVGElement[]).forEach((element) => {
        const id = element.dataset.graphNode;
        const position = id ? positions.get(id) : undefined;
        if (!position) return;
        element.setAttribute('transform', `translate(${position.x} ${position.y})`);
        element.dataset.graphPinned = String(position.pinned);
      });
      const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
      ([...canvas.querySelectorAll('[data-graph-edge]')] as SVGElement[]).forEach((element) => {
        const edge = edges.get(element.dataset.graphEdge ?? '');
        const from = edge ? positions.get(edge.from) : undefined;
        const to = edge ? positions.get(edge.to) : undefined;
        if (!from || !to) return;
        const geometry = graphEdgePath(from, to);
        element.querySelector('path')?.setAttribute('d', geometry.path);
        const label = element.querySelector('text');
        label?.setAttribute('x', String(geometry.labelX));
        label?.setAttribute('y', String(geometry.labelY));
      });
      const content = graphLayout.contentBounds();
      ([...root.querySelectorAll('[data-minimap-node]')] as SVGElement[]).forEach((element) => {
        const position = positions.get(element.dataset.minimapNode ?? '');
        if (!position) return;
        element.setAttribute('x', String(position.x / content.width * 180));
        element.setAttribute('y', String(position.y / content.height * 120));
      });
      updateGraphCamera();
    };
    graphLayout.setTickListener(updateGraphGeometry);
    const syncViewport = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      canvas.setAttribute('viewBox', `0 0 ${width} ${height}`);
      graphNavigation.setViewport({ x: 0, y: 0, width, height });
      return bounds;
    };
    const zoomGraphAtCenter = (delta: number): void => {
      const bounds = syncViewport();
      graphNavigation.zoomBy({ x: bounds.width / 2, y: bounds.height / 2 }, delta);
      if (!transitionSemanticLevel(delta > 0 ? 'in' : 'out')) updateGraphCamera();
    };
    const transitionSemanticLevel = (direction: 'in' | 'out'): boolean => {
      const camera = graphNavigation.snapshot().camera;
      const semantic = semanticGraph.view();
      if (semantic.location.lens !== 'relations') return false;
      if (direction === 'in' && camera.zoom > 1.6 && semantic.location.level !== 'neighborhood' && semantic.selection?.nodeId) {
        semanticGraph.openSelection();
        fitGraphAfterRender = true;
        render();
        return true;
      }
      if (direction === 'out' && camera.zoom < 0.6 && semantic.location.level !== 'atlas') {
        semanticGraph.drillOut();
        fitGraphAfterRender = true;
        render();
        return true;
      }
      return false;
    };
    syncViewport();
    root.querySelectorAll('[data-graph-select]').forEach((target: SVGElement) => {
      const nodeId = target.dataset.graphNode;
      if (!nodeId) return;
      let start: { readonly x: number; readonly y: number } | undefined;
      let offset: { readonly x: number; readonly y: number } | undefined;
      let moved = false;
      target.addEventListener('pointerdown', (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const bounds = syncViewport();
        const world = graphNavigation.screenToWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        const position = graphLayout.position(nodeId);
        if (!position) return;
        if (pendingGraphActivation) clearTimeout(pendingGraphActivation.timer);
        pendingGraphActivation = undefined;
        start = { x: event.clientX, y: event.clientY };
        offset = { x: world.x - position.x, y: world.y - position.y };
        moved = false;
        target.setPointerCapture(event.pointerId);
      });
      target.addEventListener('pointermove', (event: PointerEvent) => {
        if (!start || !offset || !target.hasPointerCapture(event.pointerId)) return;
        if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
        if (!moved) graphLayout.startDrag(nodeId);
        moved = true;
        event.preventDefault();
        const bounds = syncViewport();
        const world = graphNavigation.screenToWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        graphLayout.drag(nodeId, { x: world.x - offset.x, y: world.y - offset.y });
        canvas.classList.add('js-node-dragging');
      });
      const releaseNode = (event: PointerEvent): void => {
        if (!start) return;
        if (moved) {
          graphLayout.endDrag(nodeId, true);
          suppressedGraphClicks.add(nodeId);
        }
        start = undefined;
        offset = undefined;
        moved = false;
        canvas.classList.remove('js-node-dragging');
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      };
      target.addEventListener('pointerup', releaseNode);
      target.addEventListener('pointercancel', releaseNode);
    });
    const ResizeObserverConstructor = (globalThis as unknown as { ResizeObserver?: new (callback: () => void) => GraphResizeObserver }).ResizeObserver;
    if (ResizeObserverConstructor) {
      graphResizeObserver = new ResizeObserverConstructor(() => { if (!disposed && canvas.isConnected) syncViewport(); });
      graphResizeObserver.observe(canvas);
    }
    canvas.addEventListener('wheel', (event: WheelEvent) => { event.preventDefault(); const bounds = syncViewport(); graphNavigation.wheelZoom({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, event.deltaY); if (!transitionSemanticLevel(event.deltaY < 0 ? 'in' : 'out')) updateGraphCamera(); }, { passive: false });
    let lastPoint: { x: number; y: number } | undefined;
    const activePointers = new Map<number, { readonly x: number; readonly y: number }>();
    let pinchDistance: number | undefined;
    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if ((event.target as SVGElement).closest('[data-graph-node],[data-graph-edge-select],[data-minimap]')) return;
      if (event.pointerType !== 'mouse') {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        canvas.setPointerCapture(event.pointerId);
        if (activePointers.size === 2) {
          const [first, second] = [...activePointers.values()];
          pinchDistance = Math.hypot(second!.x - first!.x, second!.y - first!.y);
          lastPoint = undefined;
          return;
        }
      }
      lastPoint = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('js-panning');
    });
    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (activePointers.has(event.pointerId)) {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activePointers.size === 2 && pinchDistance !== undefined) {
          event.preventDefault();
          const bounds = syncViewport();
          const [first, second] = [...activePointers.values()];
          const nextDistance = Math.max(1, Math.hypot(second!.x - first!.x, second!.y - first!.y));
          const direction = nextDistance > pinchDistance ? 'in' : 'out';
          const midpoint = { x: (first!.x + second!.x) / 2 - bounds.left, y: (first!.y + second!.y) / 2 - bounds.top };
          graphNavigation.wheelZoom(midpoint, -Math.log(nextDistance / Math.max(1, pinchDistance)) / 0.0015);
          pinchDistance = nextDistance;
          if (!transitionSemanticLevel(direction)) updateGraphCamera();
          return;
        }
      }
      if (!lastPoint) return;
      graphNavigation.pan({ x: event.clientX - lastPoint.x, y: event.clientY - lastPoint.y });
      lastPoint = { x: event.clientX, y: event.clientY };
      updateGraphCamera();
    });
    const releasePointer = (event: PointerEvent): void => {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) pinchDistance = undefined;
      lastPoint = undefined;
      canvas.classList.remove('js-node-dragging', 'js-panning');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
    canvas.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomGraphAtCenter(0.1); }
      else if (event.key === '-') { event.preventDefault(); zoomGraphAtCenter(-0.1); }
      else if (event.key === 'Enter') { event.preventDefault(); const view = semanticGraph.openSelection(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); }
      else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); const view = semanticGraph.openSelection(); selectedPointer = view.selection?.pointer || undefined; fitGraphAfterRender = true; render(); }
      else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); graphNavigation.fit(); updateGraphCamera(); }
      else if (event.key === 'Escape' && semanticGraph.view().canDrillOut) { event.preventDefault(); semanticGraph.drillOut(); fitGraphAfterRender = true; render(); }
    });
    const minimapElement = root.querySelector('[data-minimap]');
    minimapElement?.addEventListener('click', (event: Event) => { const target = event.currentTarget as SVGElement; const bounds = target.getBoundingClientRect(); const pointer = event as PointerEvent; graphNavigation.navigateMinimap({ x: ((pointer.clientX - bounds.left) / Math.max(1, bounds.width)) * 180, y: ((pointer.clientY - bounds.top) / Math.max(1, bounds.height)) * 120 }, { x: 0, y: 0, width: 180, height: 120 }); updateGraphCamera(); });
    minimapElement?.addEventListener('dblclick', (event: Event) => { event.preventDefault(); graphNavigation.fit(); updateGraphCamera(); });
    minimapElement?.addEventListener('wheel', (event: Event) => { const wheel = event as WheelEvent; wheel.preventDefault(); zoomGraphAtCenter(wheel.deltaY < 0 ? 0.1 : -0.1); }, { passive: false });
    if (fitGraphAfterRender) {
      fitGraphAfterRender = false;
      graphNavigation.fit();
    }
    updateGraphGeometry();
  };
  const showCommandPalette = (): void => {
    const pointer = selectedPointer ?? selectFallback(session.snapshot(), selectedPointer);
    if (pointer === undefined) return;
    showActionPalette(root, pointer, session, catalogRegistry, applyCommand, () => openSourceView(pointer));
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && root.querySelector('.js-drawer-open')) {
      event.preventDefault();
      closeCompactDrawer();
      return;
    }
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
  return { setText, setTitle, setUri, getText: () => session.snapshot().text, showCommandPalette, dispose: () => { disposed = true; unsubscribeConversionProgress?.(); if (synchronizedRender) clearTimeout(synchronizedRender); if (pendingGraphActivation) clearTimeout(pendingGraphActivation.timer); graphResizeObserver?.disconnect(); graphLayout.dispose(); releaseDrawerTrap(); setCompactDrawerModal(root); window.removeEventListener('keydown', onKeyDown); sourceEditor?.dispose(); sourceModel?.dispose(); container.innerHTML = ''; } };
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
  readonly providerFilter?: string;
  readonly search?: string;
  readonly currentDocumentUri?: string;
}

function mountAdvancedViews(root: HTMLElement, snapshot: DocumentSnapshot, definitionPointer: string | undefined, graph: ReturnType<typeof projectGraph>, mode: Mode, instanceText: string, instanceResult: InstanceValidationResult | undefined, impactDirection: ImpactDirection, selectedAddIns: readonly string[], refactoringPlan: RefactoringPlan | undefined, refactoringStatus: string, host: EditorServices | undefined, conversionManifest: ConversionCommandsManifest | undefined, conversionCommandId: string | undefined, conversionSource: ConversionSource | undefined, conversionResult: ConversionResult | undefined, conversionStatus: string, conversionProgress: ProgressEvent | undefined, conversionRequestId: string | undefined, libraryEntries: readonly LibraryEntry[] | undefined, librarySelector: 'pinned' | 'floating', libraryDocument: LibraryDocument | undefined, librarySelection: readonly string[], libraryOperation: LibraryOperation, libraryPlan: RefactoringPlan | undefined, libraryStatus: string, libraryState: LibraryWorkbenchState, libraryModalOpen: boolean, instanceRoots: readonly { readonly pointer: string; readonly label: string }[], instanceRootPointer: string | undefined, instanceSelection: CrossNavigationSelection | undefined, resolvedDocuments: readonly ResolvedSchemaDocument[] = [], targetNamespaces: readonly string[] = []): void {
  const sourcePanel = root.querySelector('.js-source-view');
  sourcePanel?.insertAdjacentHTML('beforebegin', `<section class="js-view" data-panel-mode="analysis" ${mode === 'analysis' ? '' : 'hidden'}>${analysisView(snapshot, definitionPointer, graph, impactDirection, refactoringPlan, refactoringStatus, selectedAddIns, resolvedDocuments)}</section><section class="js-view" data-panel-mode="instance" ${mode === 'instance' ? '' : 'hidden'}>${instanceView(instanceText, instanceResult, instanceRoots, instanceRootPointer, instanceSelection)}</section><section class="js-view" data-panel-mode="conversion" ${mode === 'conversion' ? '' : 'hidden'}>${conversionView(host, conversionManifest, conversionCommandId, conversionSource, conversionResult, conversionStatus, conversionProgress, conversionRequestId)}</section>`);
  root.querySelector('.js-shell')?.insertAdjacentHTML('beforeend', `<dialog class="js-library-dialog" data-library-dialog aria-label="Import from library"><div class="js-library-dialog-head"><strong>Import type library</strong><button data-library-close aria-label="Close library browser">${fluentIcon('dismiss')}</button></div>${renderLibraryBrowser({ requestBacked: Boolean(host?.libraryRequest), fallbackAvailable: Boolean(host?.listLibraryEntries && host.readLibraryDocument) }, libraryEntries, librarySelector, libraryDocument, librarySelection, libraryOperation, libraryPlan, libraryStatus, libraryState, { purpose: 'import', targetNamespaces })}</dialog>`);
  if (!libraryModalOpen) (root.querySelector('[data-library-dialog]') as DialogElement | null)?.removeAttribute('open');
}

export function conversionView(host: EditorServices | undefined, manifest: ConversionCommandsManifest | undefined, commandId: string | undefined, source: ConversionSource | undefined, result: ConversionResult | undefined, status: string, progress?: ProgressEvent, requestId?: string): string {
  if (!host?.listConversionCommands || !host.convert) return '<div class="js-sheet"><h1>Conversion</h1><p class="js-description">This host does not provide conversion tools.</p></div>';
  const selected = manifest?.commands.find((command) => command.id === commandId)
    ?? manifest?.commands.find((command) => command.direction === 'export')
    ?? manifest?.commands[0];
  const converter = manifest?.converters.find((item) => item.id === selected?.converterId);
  const diagnostics = result?.diagnostics.map((diagnostic) => `<div class="js-problem"><span class="js-problem-${diagnostic.severity}">${fluentIcon(diagnostic.severity === 'error' ? 'errorCircle' : 'warning')}</span><span><span class="js-code">${escapeHtml(diagnostic.code)}</span> ${escapeHtml(diagnostic.message)}</span></div>`).join('') ?? '';
  const outputs = result?.outputs.map((output) => `<div class="js-analysis-row"><span>${escapeHtml(output.name)}</span><span class="js-code">${escapeHtml(output.uri)}</span></div>`).join('') ?? '';
  const progressView = requestId ? `<div class="js-section-head"><progress max="100" value="${progress?.percent ?? 0}" aria-label="Conversion progress"></progress>${host.cancelConversion ? '<button data-conversion-cancel>Cancel</button>' : ''}</div>` : '';
  const review = result?.review ? conversionReviewView(result.review) : '';
  const commandGroups = manifest ? (['export', 'import'] as const).map((direction) => {
    const commands = manifest.commands.filter((command) => command.direction === direction);
    if (!commands.length) return '';
    return `<section class="js-conversion-group"><h2>${direction === 'export' ? 'Export from JSON Structure' : 'Import into JSON Structure'}</h2><div class="js-conversion-tiles">${commands.map((command) => {
      const format = command.direction === 'export' ? command.targetFormat : command.sourceFormat;
      return `<button class="js-conversion-tile" data-conversion-command="${escapeAttribute(command.id)}" aria-pressed="${command.id === selected?.id}"><span class="js-format-icon" data-format="${escapeAttribute(format)}" aria-hidden="true">${technologyIcon(format)}</span><span class="js-conversion-tile-copy"><strong>${escapeHtml(command.label)}</strong><span>${escapeHtml(conversionCommandDescription(command))}</span><small>${command.cliCommand ? `<code>${escapeHtml(command.cliCommand)}</code><span aria-hidden="true"> · </span>` : ''}${escapeHtml(conversionFormatName(command.sourceFormat))} <span aria-hidden="true">${fluentIcon('arrowRight', 'js-chevron')}</span> ${escapeHtml(conversionFormatName(command.targetFormat))}</small></span></button>`;
    }).join('')}</div></section>`;
  }).join('') : '';
  const sourcePicker = selected?.direction === 'import' ? `<div class="js-conversion-source"><span>Source file</span><strong>${escapeHtml(source?.name ?? 'No file selected')}</strong><button data-conversion-source ${host.selectConversionSource ? '' : 'disabled'}>${source ? 'Change' : 'Choose file'}</button></div>` : '';
  const commandOptions = selected && converter ? conversionOptionsForCommand(converter, selected) : [];
  const configuration = selected ? `<section class="js-conversion-config"><div class="js-conversion-route"><div><span>From</span><strong>${escapeHtml(selected.sourceFormat)}</strong></div><span class="js-conversion-arrow" aria-hidden="true">${fluentIcon('arrowRight')}</span><div><span>To</span><strong>${escapeHtml(selected.targetFormat)}</strong></div></div>${sourcePicker}<fieldset><legend>Options</legend>${commandOptions.map(conversionOptionControl).join('') || '<p class="js-description">This converter has no options.</p>'}</fieldset><button data-conversion-run ${requestId || selected.direction === 'import' && !source ? 'disabled' : ''} class="js-primary">${escapeHtml(conversionCommandAction(selected))}</button></section>` : '';
  return `<div class="js-sheet js-conversion-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Toolchain</div><h1>Convert</h1><p class="js-description">Choose an outcome, review its options, and write generated files to a directory you approve.</p></div>${manifest ? '<button data-conversion-load title="Refresh conversion tools">Refresh</button>' : ''}</header>${manifest ? `<div class="js-conversion-layout"><div class="js-conversion-catalog">${commandGroups || '<p class="js-description">No conversion commands are installed.</p>'}</div>${configuration}</div>` : '<div class="js-conversion-loading" role="status">Loading conversion tools...</div>'}${progressView}<p role="status" aria-live="polite">${escapeHtml(status)}</p>${review}${result ? `<section><div class="js-section-head"><h2>Outputs (${result.outputs.length})</h2>${result.outputs.length && host.openGeneratedOutput ? '<button data-conversion-open>Open outputs</button>' : ''}</div>${outputs || '<p class="js-description">No output files were committed.</p>'}</section><section><h2>Diagnostics (${result.diagnostics.length})</h2>${diagnostics || '<p class="js-description">No conversion warnings or errors.</p>'}</section>` : ''}</div>`;
}

function conversionReviewView(review: NonNullable<ConversionResult['review']>): string {
  const warnings = review.warnings.map((warning) => `<article class="js-conversion-warning" data-lossiness="${escapeAttribute(warning.lossiness)}"><header><strong>${escapeHtml(warning.code)}</strong><span>${escapeHtml(humanizeIdentifier(warning.lossiness))}</span></header><p>${escapeHtml(warning.message)}</p>${warning.sourceLocation || warning.targetPath ? `<dl>${warning.sourceLocation ? `<dt>Source</dt><dd class="js-code">${escapeHtml(warning.sourceLocation)}</dd>` : ''}${warning.targetPath ? `<dt>Target</dt><dd class="js-code">${escapeHtml(warning.targetPath)}</dd>` : ''}</dl>` : ''}${warning.details ? `<p class="js-description">${escapeHtml(structuredValueLabel(warning.details))}</p>` : ''}</article>`).join('');
  const files = review.manifest?.files.map((file) => `<div class="js-integrity-row"><span><strong>${escapeHtml(file.path)}</strong><small>${formatBytes(file.bytes)}</small></span><code title="SHA-256 ${escapeAttribute(file.sha256)}">${escapeHtml(file.sha256)}</code></div>`).join('') ?? '';
  const lifecycle = review.lifecycle.map((state) => `<li data-state="${escapeAttribute(state)}">${escapeHtml(state)}</li>`).join('');
  return `<section class="js-conversion-review" aria-label="Conversion review"><div class="js-section-head"><div><h2>Conversion review</h2><span class="js-section-meta">${review.warnings.length} warning${review.warnings.length === 1 ? '' : 's'}</span></div><span class="js-lossiness" data-lossiness="${escapeAttribute(review.lossiness)}">${escapeHtml(humanizeIdentifier(review.lossiness))}</span></div><div class="js-review-summary"><dl><dt>Converter</dt><dd>${escapeHtml(review.converter.displayName)} <span class="js-code">${escapeHtml(review.converter.version)}</span></dd><dt>Route</dt><dd>${escapeHtml(review.sourceFormat)} <span aria-hidden="true">${fluentIcon('arrowRight', 'js-chevron')}</span> ${escapeHtml(review.targetFormat)}</dd><dt>Publication</dt><dd>${review.published ? 'Committed atomically' : 'Not published'}</dd><dt>Integrity</dt><dd>${review.manifest ? `${review.manifest.algorithm.toUpperCase()} · ${review.manifest.files.length} file${review.manifest.files.length === 1 ? '' : 's'}` : 'Unavailable'}</dd></dl><ol class="js-conversion-lifecycle" aria-label="Conversion lifecycle">${lifecycle}</ol></div>${warnings ? `<div class="js-conversion-warnings">${warnings}</div>` : '<p class="js-review-clean">No lossy mappings or conversion warnings were reported.</p>'}${review.manifest ? `<details class="js-integrity-manifest" open><summary>Output integrity manifest</summary>${files || '<p class="js-description">The manifest contains no generated files.</p>'}</details>` : ''}</section>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function conversionCommandDescription(command: import('../conversion/types.js').ConversionCommand): string {
  return command.direction === 'export'
    ? `Create ${conversionFormatName(command.targetFormat)} files from the current structure.`
    : `Create a JSON Structure document from ${conversionFormatName(command.sourceFormat)}.`;
}

function conversionCommandAction(command: import('../conversion/types.js').ConversionCommand): string {
  return command.direction === 'export' ? `Convert to ${conversionFormatName(command.targetFormat)}` : `Import ${conversionFormatName(command.sourceFormat)}`;
}

function conversionFormatName(format: string): string {
  const known: Readonly<Record<string, string>> = {
    asn1: 'ASN.1',
    avro: 'Apache Avro',
    capnp: "Cap'n Proto",
    cassandra: 'Apache Cassandra',
    cddl: 'CDDL',
    cpp: 'C++',
    csharp: 'C#',
    'csv-schema': 'CSV schema',
    cue: 'CUE',
    'data-package': 'Data Package',
    flatbuffers: 'FlatBuffers',
    go: 'Go',
    graphql: 'GraphQL',
    iceberg: 'Apache Iceberg',
    java: 'Java',
    javascript: 'JavaScript',
    'json-schema': 'JSON Schema',
    'json-structure': 'JSON Structure',
    jtd: 'JSON Type Definition',
    kusto: 'Kusto',
    markdown: 'Markdown',
    parquet: 'Apache Parquet',
    protobuf: 'Protocol Buffers',
    python: 'Python',
    raml: 'RAML',
    rust: 'Rust',
    smithy: 'Smithy',
    sql: 'SQL',
    thrift: 'Apache Thrift',
    tmsl: 'TMSL',
    typescript: 'TypeScript',
    xsd: 'XML Schema',
  };
  return known[format.toLocaleLowerCase()] ?? format;
}

function conversionOptionControl(option: import('../conversion/types.js').ConversionOption): string {
  const description = option.description ? `<span class="js-description">${escapeHtml(option.description)}</span>` : '';
  const label = `<span class="js-option-name">${escapeHtml(humanizeIdentifier(option.name))}</span>`;
  if (option.type === 'boolean') return `<label><input type="checkbox" data-conversion-option="${escapeAttribute(option.name)}" data-option-type="boolean" ${option.default ? 'checked' : ''}>${label}${description}</label>`;
  if (option.type === 'string' && option.allowedValues) return `<label>${label}<select data-conversion-option="${escapeAttribute(option.name)}" data-option-type="string">${option.allowedValues.map((value) => `<option value="${escapeAttribute(value)}" ${value === option.default ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>${description}</label>`;
  if (option.type === 'string-list') return `<label>${label}<input data-conversion-option="${escapeAttribute(option.name)}" data-option-type="string-list" type="text" value="${escapeAttribute((option.default ?? []).join(', '))}">${description}</label>`;
  const constraints = option.type === 'number' ? `${option.minimum === undefined ? '' : ` min="${option.minimum}"`}${option.maximum === undefined ? '' : ` max="${option.maximum}"`}` : '';
  return `<label>${label}<input data-conversion-option="${escapeAttribute(option.name)}" data-option-type="${option.type}" type="${option.type === 'number' ? 'number' : 'text'}" value="${escapeAttribute(String(option.default ?? ''))}"${constraints}>${description}</label>`;
}

function humanizeIdentifier(value: string): string {
  const words = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toLocaleUpperCase() + words.slice(1) : value;
}

function readConversionOptions(root: HTMLElement): ConversionOptionValues {
  const result: Record<string, import('../conversion/types.js').ConversionOptionValue> = {};
  root.querySelectorAll('[data-conversion-option]').forEach((control: HTMLInputElement) => {
    const name = control.dataset.conversionOption;
    if (!name) return;
    if (control.dataset.optionType === 'boolean') result[name] = (control as HTMLInputElement).checked;
    else if (control.dataset.optionType === 'string-list') result[name] = control.value.split(/[\r\n,]+/).map((value: string) => value.trim()).filter(Boolean);
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
  const removals = new Map<string, TextEdit[]>();
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
      const parentPointer = formatPointer(tokens.slice(0, -1));
      const edit = removeMemberEdit(source, nodes.find((candidate) => candidate.pointer === parentPointer)?.range, node.keyRange, node.range);
      edits.push(edit);
      removals.set(parentPointer, [...(removals.get(parentPointer) ?? []), edit]);
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
    const bodyStart = parent.startOffset + 1;
    const localRemovals = (removals.get(parentPointer) ?? []).map((edit) => {
      const { startOffset, endOffset } = edit.range;
      if (startOffset === undefined || endOffset === undefined) throw new Error(`Removal range is unavailable for ${parentPointer}.`);
      return { range: rangeFor(body, startOffset - bodyStart, endOffset - bodyStart), newText: edit.newText };
    });
    const remainingBody = applyEdits(body, localRemovals);
    const multiline = body.includes('\n');
    const indent = multiline ? (body.match(/\n([ \t]*)\S/)?.[1] ?? '  ') : '';
    const separator = remainingBody.trim() ? (multiline ? `,\n${indent}` : ',') : '';
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

interface TypeTreeItem {
  readonly name: string;
  readonly pointer: string;
  readonly namespace: string;
  readonly imported?: boolean;
  readonly documentUri?: string;
  readonly sourcePointer?: string;
}

interface TypeTreeNamespace {
  readonly label: string;
  readonly path: string;
  readonly children: Map<string, TypeTreeNamespace>;
  readonly types: TypeTreeItem[];
}

function renderTypeTree(definitions: readonly TypeTreeItem[], selectedPointer: string | undefined): string {
  const root: TypeTreeNamespace = { label: 'Definitions', path: '', children: new Map(), types: [] };
  for (const definition of definitions) {
    const segments = definition.namespace.split('/').filter(Boolean).slice(1);
    let namespace = root;
    for (const segment of segments) {
      const path = namespace.path ? `${namespace.path}/${segment}` : segment;
      let child = namespace.children.get(segment);
      if (!child) {
        child = { label: segment, path, children: new Map(), types: [] };
        namespace.children.set(segment, child);
      }
      namespace = child;
    }
    namespace.types.push(definition);
  }
  const renderType = (item: TypeTreeItem): string => `<button role="treeitem" class="js-tree-item${item.imported ? ' js-tree-item-imported' : ''}" ${item.imported ? `data-effective-source="${escapeAttribute(item.sourcePointer ?? '')}" data-effective-document="${escapeAttribute(item.documentUri ?? '')}" title="Imported from ${escapeAttribute(item.documentUri ?? '')}${escapeAttribute(item.sourcePointer ? `#${item.sourcePointer}` : '')}"` : `data-select="${escapeAttribute(item.pointer)}"`} data-type-drag="${escapeAttribute(item.pointer)}" draggable="true" aria-current="${selectedPointer === item.pointer}"><span class="js-kind" aria-hidden="true">${fluentIcon('cube')}</span><span>${escapeHtml(item.name)}</span>${item.imported ? '<small>imported</small>' : ''}</button>`;
  const renderNamespace = (namespace: TypeTreeNamespace): string => {
    const children = [...namespace.children.values()].sort((left, right) => left.label.localeCompare(right.label)).map(renderNamespace).join('');
    const types = [...namespace.types].sort((left, right) => left.name.localeCompare(right.name)).map(renderType).join('');
    if (!namespace.path) return `${types}${children}`;
    return `<details class="js-tree-namespace" open><summary><span class="js-tree-chevron">${fluentIcon('chevronRight')}</span><span>${escapeHtml(namespace.label)}</span><small>${namespace.types.length + namespace.children.size}</small></summary><div role="group">${types}${children}</div></details>`;
  };
  return renderNamespace(root) || '<div class="js-empty js-tree-empty">No definitions yet.</div>';
}

function structuredWorkbenchShell(snapshot: DocumentSnapshot, title: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly namespace: string; readonly imported?: boolean; readonly documentUri?: string; readonly sourcePointer?: string }[], definitionPointer: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, mode: Mode, problemsOpen: boolean, memberMode: DesignMemberMode, effectiveMembers: EffectiveMembersResult | undefined, expandedPropertyPointer: string | undefined, chrome: NonNullable<JsonStructureEditorOptions['chrome']> = 'document'): string {
  const definition = snapshot.model?.projections.definitions.find((item) => item.pointer === definitionPointer);
  const selectedProperty = rows.find((row) => row.pointer === selectedPointer);
  const selectedRelation = definition?.relations.find((relation) => relation.pointer === selectedPointer);
  const selectedDiagnostics = diagnosticsForPointer(snapshot.diagnostics, selectedPointer);
  const errors = snapshot.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = snapshot.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const documentStatus = snapshot.recovery !== 'valid' || errors ? 'invalid' : warnings ? 'warnings' : 'valid';
  const documentValue = snapshot.recovery === 'valid' ? JSON.parse(snapshot.text) : {};
  const profile = detectMetaSchemaMode(documentValue);
  const activeCompanions = Object.entries(profile.capabilities).filter(([name, active]) => name !== 'core' && name !== 'unknownUses' && active === true).length;
  const primaryModes: readonly { readonly mode: Extract<Mode, 'design' | 'graph' | 'source' | 'instance' | 'conversion'>; readonly icon: FluentIconName; readonly label: string }[] = [
    { mode: 'design', icon: 'documentData', label: 'Document' },
    { mode: 'graph', icon: 'cube', label: 'Graph' },
    { mode: 'source', icon: 'document', label: 'Source' },
    { mode: 'instance', icon: 'checkmarkCircle', label: 'Validate' },
    { mode: 'conversion', icon: 'arrowSwap', label: 'Convert' },
  ];
  const typeTree = renderTypeTree(definitions, definitionPointer);
  const activities = primaryModes.map((item) => `<button class="js-activity-button" data-mode="${item.mode}" aria-label="${item.label}" title="${item.label}" aria-pressed="${mode === item.mode}">${fluentIcon(item.icon)}</button>`).join('');
  const breadcrumbSeparator = fluentIcon('chevronRight', 'js-chevron');
  const showSelectionBreadcrumb = mode === 'design' || mode === 'graph';
  const breadcrumbs = `<span data-document-title>${escapeHtml(title)}</span>${showSelectionBreadcrumb && definition ? `<span aria-hidden="true">${breadcrumbSeparator}</span><strong>${escapeHtml(definition.name)}</strong>` : ''}${showSelectionBreadcrumb && selectedProperty ? `<span aria-hidden="true">${breadcrumbSeparator}</span><strong>${escapeHtml(selectedProperty.name)}</strong>` : ''}${showSelectionBreadcrumb && selectedRelation ? `<span aria-hidden="true">${breadcrumbSeparator}</span><strong>${escapeHtml(selectedRelation.name)}</strong>` : ''}`;
  const titleChrome = workbenchTitleChrome(title, chrome);
  return `<div class="js-shell js-chrome-${chrome}">
    ${titleChrome}
    <div class="js-document-toolbar" role="toolbar" aria-label="Document status"><button class="js-mobile-toggle" data-mobile-drawer="types" aria-controls="js-outline" aria-haspopup="dialog" aria-expanded="false" ${mode === 'design' || mode === 'graph' ? '' : 'hidden'}>Types</button><span class="js-chip">${escapeHtml(profile.mode)}</span>${activeCompanions ? `<span class="js-chip">${activeCompanions} companions</span>` : ''}<span class="js-spacer"></span><button class="js-mobile-toggle" data-mobile-drawer="inspector" aria-controls="js-inspector" aria-haspopup="dialog" aria-expanded="false" ${mode === 'design' ? '' : 'hidden'}>Inspector</button></div>
    <div class="js-workbench" data-problems-open="${problemsOpen}" data-active-mode="${mode}">
      <nav class="js-activity" aria-label="Editor modes">${activities}</nav>
      <aside class="js-outline" id="js-outline" data-drawer-panel="types" aria-label="Types"><div class="js-panel-head"><span>Types</span><span class="js-spacer"></span><button data-command="definition.add" title="Add type" aria-label="Add type">${fluentIcon('add')}</button><button data-library-open title="Import type library" aria-label="Import type library">${fluentIcon('library')}</button><button class="js-drawer-close" data-mobile-drawer-close aria-label="Close Types">${fluentIcon('dismiss')}</button></div><input class="js-filter" type="search" placeholder="Filter types" aria-label="Filter types"><div class="js-tree" role="tree" aria-label="Types by namespace"><div class="js-tree-group">${definitions.length} definitions</div>${typeTree}</div></aside>
      <section class="js-center"><div class="js-editor-tab"><span class="js-kind" aria-hidden="true">${fluentIcon('document')}</span><span data-document-title>${escapeHtml(title)}</span></div><div class="js-breadcrumbs">${breadcrumbs}</div><section class="js-view" data-panel-mode="design" ${mode === 'design' ? '' : 'hidden'}>${designView(definition?.name, definition?.type, definition?.description, rows, selectedPointer, definition?.identity, definition?.relations, memberMode, effectiveMembers, expandedPropertyPointer, definitions, documentValue)}</section><section class="js-view js-graph" data-panel-mode="graph" ${mode === 'graph' ? '' : 'hidden'}>${graphView(snapshot, selectedPointer)}</section><section class="js-view js-source-view" data-panel-mode="source" ${mode === 'source' ? '' : 'hidden'}><div class="js-source" data-source aria-label="JSON source editor"></div></section></section>
      <aside class="js-inspector" id="js-inspector" data-drawer-panel="inspector" aria-label="Inspector"><div class="js-panel-head"><span>Inspector</span><span class="js-spacer"></span><button class="js-drawer-close" data-mobile-drawer-close aria-label="Close Inspector">${fluentIcon('dismiss')}</button></div>${inspector(selectedProperty, definition, selectedDiagnostics, selectedRelation)}</aside>
      <section class="js-problems" aria-label="Problems panel"><div class="js-problems-head"><button class="js-problems-tab" data-problems-toggle aria-controls="js-problem-list" aria-expanded="${problemsOpen}">Problems <span class="js-count">${snapshot.diagnostics.length}</span></button><span class="js-spacer"></span><button data-problems-toggle aria-controls="js-problem-list" aria-expanded="${problemsOpen}" aria-label="Close Problems">${fluentIcon('dismiss')}</button></div><div class="js-problem-list" id="js-problem-list" role="list">${problems(snapshot.diagnostics)}</div></section>
    </div>
    <footer class="js-status"><button data-problems-toggle aria-controls="js-problem-list" aria-expanded="${problemsOpen}" title="Toggle Problems"><span>${fluentIcon('errorCircle')}${errors}</span><span>${fluentIcon('warning')}${warnings}</span></button><span>JSON Structure ${escapeHtml(profile.mode)}</span><span class="js-spacer"></span><span>${definitions.length} type${definitions.length === 1 ? '' : 's'}</span><span>${documentStatus}</span></footer>
  </div>`;
}

export function workbenchTitleChrome(title: string, chrome: NonNullable<JsonStructureEditorOptions['chrome']>): string {
  if (chrome === 'embedded') return '';
  if (chrome === 'document') return `<header class="js-title">${jsonStructureLogo()}<strong>JSON Structure</strong><span class="js-file" data-document-title>${escapeHtml(title)}</span><button class="js-command-trigger" data-show-commands title="Show Commands (Ctrl+Shift+P)" aria-label="Show Commands">${fluentIcon('console')}</button><label class="js-theme-label"><span class="js-sr-only">Color theme</span><select class="js-theme" data-theme-select aria-label="Color theme"><option value="dark">Dark</option><option value="light">Light</option><option value="contrast">High contrast</option></select></label></header>`;
  return `<header class="js-titlebar">
    <div class="js-titlebar-drag"><span class="js-titlebar-icon" title="JSON Structure">${jsonStructureLogo()}</span>
      <nav class="js-menubar" role="menubar" aria-label="Application menu">
        ${applicationMenu('File', '<button role="menuitem" data-chrome-command="open">Open...<kbd>Ctrl+O</kbd></button><button role="menuitem" data-chrome-command="save">Save<kbd>Ctrl+S</kbd></button><button role="menuitem" data-chrome-command="save-as">Save As...<kbd>Ctrl+Shift+S</kbd></button><hr><button role="menuitem" data-chrome-command="quit">Exit</button>')}
        ${applicationMenu('Edit', '<button role="menuitem" data-chrome-command="undo">Undo<kbd>Ctrl+Z</kbd></button><button role="menuitem" data-chrome-command="redo">Redo<kbd>Ctrl+Y</kbd></button><hr><button role="menuitem" data-chrome-command="cut">Cut<kbd>Ctrl+X</kbd></button><button role="menuitem" data-chrome-command="copy">Copy<kbd>Ctrl+C</kbd></button><button role="menuitem" data-chrome-command="paste">Paste<kbd>Ctrl+V</kbd></button><button role="menuitem" data-chrome-command="select-all">Select All<kbd>Ctrl+A</kbd></button>')}
        ${applicationMenu('View', '<button role="menuitem" data-chrome-command="show-commands">Command Palette...<kbd>Ctrl+Shift+P</kbd></button><hr><button role="menuitem" data-theme-choice="dark">Dark Theme</button><button role="menuitem" data-theme-choice="light">Light Theme</button><button role="menuitem" data-theme-choice="contrast">High Contrast Theme</button><hr><button role="menuitem" data-chrome-command="reset-zoom">Reset Zoom</button><button role="menuitem" data-chrome-command="zoom-in">Zoom In</button><button role="menuitem" data-chrome-command="zoom-out">Zoom Out</button><button role="menuitem" data-chrome-command="toggle-fullscreen">Toggle Full Screen<kbd>F11</kbd></button>')}
        ${applicationMenu('Help', '<button role="menuitem" data-chrome-command="website">JSON Structure Website</button>')}
      </nav>
      <button class="js-command-center" data-show-commands title="Search files and run commands (Ctrl+Shift+P)" aria-label="Search files and run commands">${fluentIcon('console')}<span data-document-title>${escapeHtml(title)}</span></button>
    </div>
  </header>`;
}

function applicationMenu(label: string, content: string): string {
  return `<details class="js-app-menu"><summary role="menuitem" aria-haspopup="menu">${label}</summary><div class="js-app-menu-popup" role="menu" aria-label="${label} menu">${content}</div></details>`;
}

function closeApplicationMenus(root: HTMLElement): void {
  root.querySelectorAll('.js-app-menu[open]').forEach((menu: HTMLElement) => menu.removeAttribute('open'));
}

function wireApplicationMenus(root: HTMLElement): void {
  const menus = [...root.querySelectorAll('.js-app-menu')] as HTMLElement[];
  menus.forEach((menu, index) => {
    menu.addEventListener('toggle', () => {
      if (!menu.hasAttribute('open')) return;
      menus.forEach((other) => { if (other !== menu) other.removeAttribute('open'); });
      queueMicrotask(() => (menu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus());
    });
    menu.querySelector('summary')?.addEventListener('keydown', (event: KeyboardEvent) => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset) return;
      event.preventDefault();
      menu.removeAttribute('open');
      (menus[(index + offset + menus.length) % menus.length]?.querySelector('summary') as HTMLElement | null)?.focus();
    });
    menu.querySelector('.js-app-menu-popup')?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      menu.removeAttribute('open');
      (menu.querySelector('summary') as HTMLElement | null)?.focus();
    });
  });
}

export function workbenchShell(snapshot: DocumentSnapshot, title: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly namespace: string }[], definitionPointer: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, mode: Mode, problemsOpen: boolean): string {
  return structuredWorkbenchShell(snapshot, title, definitions, definitionPointer, rows, selectedPointer, mode, problemsOpen, 'local', undefined, undefined);
}

export function legacyShell(snapshot: DocumentSnapshot, title: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly namespace: string }[], definitionPointer: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, mode: Mode, graphNavigation: GraphNavigationController, graph: ReturnType<typeof projectGraph>): string {
  void graphNavigation;
  void graph;
  return structuredWorkbenchShell(snapshot, title, definitions, definitionPointer, rows, selectedPointer, mode, false, 'local', undefined, undefined);
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
export function analysisView(snapshot: DocumentSnapshot, pointer: string | undefined, graph: ReturnType<typeof projectGraph>, impactDirection: ImpactDirection = 'both', refactoringPlan?: RefactoringPlan, refactoringStatus = '', selectedAddIns: readonly string[] = [], resolvedDocuments: readonly ResolvedSchemaDocument[] = []): string {
  const value = snapshot.recovery === 'valid' ? JSON.parse(snapshot.text) : {};
  const effective = pointer !== undefined && snapshot.recovery === 'valid' ? resolveEffectiveMembers(value, pointer, { documentUri: snapshot.uri, resolvedDocuments, addIns: selectedAddIns }) : undefined;
  const runtime = new GraphRuntime({ nodes: graph.nodes.map((node) => ({ id: node.id, namespace: node.namespace, label: node.label })), edges: graph.edges.filter((edge) => graph.nodes.some((node) => node.id === edge.from) && graph.nodes.some((node) => node.id === edge.to)).map((edge, index) => ({ id: `${edge.kind}:${index}`, source: edge.from, target: edge.to, label: edge.label })), rootId: graph.nodes.find((node) => node.kind === 'document')?.id });
  const offers = value && typeof value === 'object' && !Array.isArray(value) && value.$offers && typeof value.$offers === 'object' && !Array.isArray(value.$offers) ? Object.keys(value.$offers) : [];
  const addIns = offers.length ? `<fieldset><legend>Offered add-ins (<span class="js-code">$offers</span> keys)</legend>${offers.map((name) => `<label><input type="checkbox" data-addin value="${escapeAttribute(name)}" ${selectedAddIns.includes(name) ? 'checked' : ''}>${escapeHtml(name)}</label>`).join('')}</fieldset>` : '<p class="js-description">This document has no <span class="js-code">$offers</span> keys.</p>';
  const meta = detectMetaSchemaMode(value);
  const palette = paletteDescriptors(value).flatMap((descriptor) => descriptor.members);
  const impact = pointer ? runtime.analyzeImpact([pointer], { direction: impactDirection }) : [];
  const tuple = effective?.tuple.length ? `<p><strong>Tuple order:</strong> <span class="js-code">${effective.tuple.map(escapeHtml).join(', ')}</span></p>` : '';
  const effectiveDiagnostics = effective?.diagnostics.map((diagnostic) => `<p class="js-problem-warning">${escapeHtml(diagnostic.message)}</p>`).join('') ?? '';
  const unknownUses = meta.capabilities.unknownUses.length ? `<p class="js-problem-warning">Unknown $uses: ${meta.capabilities.unknownUses.map(escapeHtml).join(', ')}</p>` : '';
  const refactoringPreview = refactoringPlan ? `<section><h2>Refactoring preview</h2>${refactoringPlan.impact.map((entry) => `<div class="js-analysis-row"><span>${escapeHtml(entry.kind)}</span><span class="js-code">${escapeHtml(entry.pointer)}</span></div>`).join('')}${refactoringPlan.collisions.map((collision) => `<p class="js-problem-warning">${escapeHtml(collision.message)}</p>`).join('')}${refactoringPlan.provenance.map((entry) => `<p class="js-description">${escapeHtml(entry.reason)}: ${escapeHtml(entry.sourcePointer)} -> ${escapeHtml(entry.targetPointer)}</p>`).join('')}${refactoringPlan.applicable ? '<button data-refactor-apply>Apply refactoring</button>' : ''}</section>` : '';
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Analysis</div><h1>${escapeHtml(pointerLabel(pointer ?? ''))}</h1><p class="js-description">Effective structure, graph impact, and meta-schema capabilities.</p></div><span class="js-chip">${escapeHtml(meta.mode)}</span></header>${unknownUses}<div class="js-analysis-grid"><section><h2>Effective members</h2>${addIns}${tuple}${effective ? effective.members.map((member) => `<div class="js-analysis-row"><span class="js-code">${escapeHtml(member.name)}</span><span>${member.required ? 'required' : 'optional'} | ${member.provenance}${member.addIn ? ` | ${escapeHtml(member.addIn)}` : ''}</span></div>`).join('') || '<p class="js-description">No effective members.</p>' : '<p class="js-description">Select an object or tuple declaration.</p>'}${effective?.conflicts.map((conflict) => `<p class="js-problem-warning">Conflict: ${escapeHtml(conflict.name)} (${escapeHtml(conflict.reason)}; ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)})</p>`).join('') ?? ''}${effectiveDiagnostics}</section><section><div class="js-section-head"><h2>Graph impact</h2><div role="group" aria-label="Impact direction">${(['outgoing', 'incoming', 'both'] as const).map((direction) => `<button data-impact-direction="${direction}" aria-pressed="${direction === impactDirection}">${direction}</button>`).join('')}</div></div><p>${runtime.metrics().nodeCount} nodes | ${runtime.metrics().edgeCount} edges</p><p>${impact.length} ${escapeHtml(impactDirection)} reachable declarations</p><h2>Palette</h2><p class="js-code">${escapeHtml(palette.join(', '))}</p></section></div><section><h2>Refactor document</h2><div class="js-analysis-grid"><label>Operation<select data-refactor-operation><option value="move">Move definition</option><option value="extract">Extract inline property</option><option value="copy">Copy declarations</option><option value="shadow">Create local shadow</option></select></label><label>Source pointer<input data-refactor-source value="${escapeAttribute(pointer ?? '')}" placeholder="/definitions/Type"></label><label>Target namespace<input data-refactor-target value="/definitions"></label><label>Target name<input data-refactor-name placeholder="NewName"></label></div><button data-refactor-preview>Preview refactoring</button><p role="status" aria-live="polite">${escapeHtml(refactoringStatus)}</p></section>${refactoringPreview}</div>`;
}

export function instanceView(text: string, result: InstanceValidationResult | undefined, roots: readonly { readonly pointer: string; readonly label: string }[] = [], rootPointer?: string, selection?: CrossNavigationSelection): string {
  const rootOptions = roots.map((root) => `<option value="${escapeAttribute(root.pointer)}" ${root.pointer === rootPointer ? 'selected' : ''}>${escapeHtml(root.label)}</option>`).join('');
  const diagnostics = result?.diagnostics.map((diagnostic, index) => `<button class="js-problem" data-instance-diagnostic="${index}" data-instance-schema="${escapeAttribute(diagnostic.schemaPointer)}"><span class="js-problem-${diagnostic.severity}">${fluentIcon(diagnostic.severity === 'error' ? 'errorCircle' : 'warning')}</span><span>${escapeHtml(diagnostic.message)}</span><span class="js-location">${escapeHtml(diagnostic.instancePointer)} → ${escapeHtml(diagnostic.schemaPointer)}</span></button>`).join('') ?? '';
  const sampleStatus = text === '{}' ? 'No sample file loaded.' : 'Sample file loaded.';
  return `<div class="js-sheet js-instance-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Instance workspace</div><h1>Validate sample</h1><p class="js-description">Validate against the complete schema environment and follow each evaluation to its instance and schema locations.</p></div><span class="js-chip">${result?.status ?? 'not run'}</span></header><div class="js-instance-toolbar"><label>Root type<select data-instance-root><option value="" ${rootPointer === '' ? 'selected' : ''}>Document root</option>${rootOptions}</select></label><label>Sample file<input data-instance-input type="file" accept=".json,application/json"><span class="js-description">${sampleStatus}</span></label><button data-instance-validate>Validate instance</button></div><div class="js-instance-layout"><section class="js-trace-panel"><div class="js-section-head"><div><h2>Evaluation trace</h2><span class="js-section-meta">${result?.status ?? 'not run'}</span></div></div>${result ? renderEvaluationTrace(result.trace, selection) : '<div class="js-empty">Load a sample file and run validation to inspect the evaluation trace.</div>'}</section></div><section><div class="js-section-head"><div><h2>Diagnostics</h2><span class="js-section-meta">${result?.diagnostics.length ?? 0}</span></div></div>${diagnostics || '<div class="js-empty">No instance diagnostics.</div>'}</section></div>`;
}

function renderEvaluationTrace(trace: EvaluationTrace, selection: CrossNavigationSelection | undefined, depth = 0): string {
  const selected = selection?.instancePointer === trace.instancePointer && selection.schemaPointer === trace.schemaPointer;
  const children = trace.children.map((child) => renderEvaluationTrace(child, selection, depth + 1)).join('');
  return `<details class="js-trace js-trace-${trace.status}" ${depth < 2 || trace.status !== 'valid' ? 'open' : ''} data-trace-depth="${depth}"><summary><span class="js-trace-status" aria-hidden="true">${trace.status === 'valid' ? '✓' : trace.status === 'invalid' ? '×' : '?'}</span><strong>${escapeHtml(trace.keyword)}</strong><span>${escapeHtml(trace.message ?? trace.status)}</span></summary><div class="js-trace-locations" aria-current="${selected}"><button data-trace-instance="${escapeAttribute(trace.instancePointer)}" data-trace-schema="${escapeAttribute(trace.schemaPointer)}">Instance <span class="js-code">${escapeHtml(trace.instancePointer || '/')}</span></button><button data-trace-schema="${escapeAttribute(trace.schemaPointer)}" data-trace-instance="${escapeAttribute(trace.instancePointer)}">Schema <span class="js-code">${escapeHtml(trace.schemaPointer || '/')}</span></button></div>${children ? `<div class="js-trace-children">${children}</div>` : ''}</details>`;
}

export function designView(name: string | undefined, type: string | undefined, description: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, identity: readonly string[] = [], relations: readonly import('../model.js').RelationProjection[] = [], memberMode: DesignMemberMode = 'local', effectiveMembers?: EffectiveMembersResult, expandedPropertyPointer?: string, definitions: readonly { readonly name: string; readonly pointer: string }[] = [], document?: unknown): string {
  if (!name && !type) return `<div class="js-empty-state">${jsonStructureLogo('js-empty-logo')}<div class="js-eyebrow">Untitled structure</div><h1>Create your first type</h1><p>Start with a reusable declaration, or switch to Source to author the document directly.</p><div class="js-empty-actions"><button class="js-primary" data-command="definition.add">${fluentIcon('add')}<span>New type</span></button><button data-mode="source">Open Source</button></div></div>`;
  const localPropertyRows = rows.map((row) => propertyEditorRow(row, row.pointer === selectedPointer, row.pointer === expandedPropertyPointer, definitions, document)).join('');
  const effectiveRows = effectiveMembers?.members.map((member) => `<div class="js-row js-effective-row" role="row" data-member-origin="${member.provenance}"><div class="js-cell" role="cell"><button class="js-property-link js-code" data-effective-source="${escapeAttribute(member.sourcePointer)}" data-effective-document="${escapeAttribute(member.documentUri)}">${escapeHtml(member.name)}</button></div><div class="js-cell js-code" role="cell">${escapeHtml(displaySchemaType(member.schema))}</div><div class="js-cell ${member.required ? 'js-required' : 'js-optional'}" role="cell">${member.required ? 'required' : 'optional'}</div><div class="js-cell js-description-cell" role="cell"><span class="js-origin-chip">${escapeHtml(member.provenance)}</span>${member.addIn ? ` ${escapeHtml(member.addIn)}` : ''}${member.inheritedVia.length ? `<small>${member.inheritedVia.map(pointerLabel).map(escapeHtml).join(' → ')}</small>` : ''}${member.imports.length ? `<small>${member.imports.map((item) => `${item.keyword} ${item.importSource}`).map(escapeHtml).join(' → ')}</small>` : ''}</div><div class="js-cell js-action-cell" role="cell"><button class="js-row-action" data-effective-source="${escapeAttribute(member.sourcePointer)}" data-effective-document="${escapeAttribute(member.documentUri)}" aria-label="Open declaration of ${escapeAttribute(member.name)}">↗</button></div></div>`).join('') ?? '';
  const propertyRows = memberMode === 'effective' ? effectiveRows : localPropertyRows;
  const conflictView = memberMode === 'effective' && effectiveMembers ? `${effectiveMembers.conflicts.map((conflict) => `<div class="js-conflict"><strong>${escapeHtml(conflict.name)}</strong><span>${escapeHtml(conflict.reason)} · ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)}</span></div>`).join('')}${effectiveMembers.diagnostics.map((diagnostic) => `<div class="js-conflict"><strong>${escapeHtml(diagnostic.code)}</strong><span>${escapeHtml(diagnostic.message)}</span></div>`).join('')}` : '';
  const definitionPointer = relations[0]?.pointer.replace(/\/relations\/[^/]+$/, '') ?? selectedPointer?.replace(/\/(?:properties|relations)\/[^/]+$/, '') ?? '';
  const identityView = `<section class="js-design-section"><div class="js-section-head"><div><h2>Identity</h2><span class="js-section-meta">ordered key</span></div><button data-action-id="relation.identity" data-action-pointer="${escapeAttribute(definitionPointer)}">Edit identity</button></div>${identity.length ? `<ol class="js-identity-list">${identity.map((property, index) => `<li><span class="js-order">${index + 1}</span><span class="js-code">${escapeHtml(property)}</span></li>`).join('')}</ol>` : '<p class="js-description">No identity is declared. Relations cannot target this type until it has an identity.</p>'}</section>`;
  const relationRows = relations.map((relation) => `<button class="js-relation-row" data-select="${escapeAttribute(relation.pointer)}" aria-current="${relation.pointer === selectedPointer}"><span><strong>${escapeHtml(relation.name)}</strong><small>${escapeHtml(relation.targetTypeRef ?? 'No target')}</small></span><span class="js-chip">${escapeHtml(relation.cardinality ?? 'single')}</span><span class="js-relation-scope">${escapeHtml(formatRelationScope(relation.scope))}</span><span aria-hidden="true">${fluentIcon('chevronRight', 'js-chevron')}</span></button>`).join('');
  const relationsView = `<section class="js-design-section"><div class="js-section-head"><div><h2>Relations</h2><span class="js-section-meta">${relations.length}</span></div><button data-action-id="relation.add" data-action-pointer="${escapeAttribute(definitionPointer)}">${fluentIcon('add')}<span>Add relation</span></button></div><div class="js-relation-list">${relationRows || '<p class="js-description">No relations declared.</p>'}</div></section>`;
  const memberCount = memberMode === 'effective' ? effectiveMembers?.members.length ?? 0 : rows.length;
  const addProperty = `${fluentIcon('add')}<span>Add property</span>`;
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">${name ? 'Local definition' : 'Document root'}</div><h1>${escapeHtml(name ?? 'Document root')}</h1><p class="js-description">${escapeHtml(description ?? 'No description yet.')}</p></div><span class="js-chip">${escapeHtml(type ?? 'untyped')}</span></header><div class="js-section-head"><div><h2>Properties</h2><span class="js-section-meta">${memberCount} visible</span></div><div class="js-member-mode" role="group" aria-label="Property origin"><button data-member-mode="local" aria-pressed="${memberMode === 'local'}">Local</button><button data-member-mode="effective" aria-pressed="${memberMode === 'effective'}">Effective</button></div>${memberMode === 'local' ? `<button data-command="add">${addProperty}</button>` : ''}</div>${conflictView}<div class="js-grid" role="table" aria-label="Properties"><div class="js-row js-header" role="row"><div class="js-cell" role="columnheader">Name</div><div class="js-cell" role="columnheader">Type</div><div class="js-cell" role="columnheader">Presence</div><div class="js-cell js-description-cell" role="columnheader">${memberMode === 'effective' ? 'Origin' : 'Description'}</div><div class="js-cell" role="columnheader"><span class="js-sr-only">Actions</span></div></div>${propertyRows || (memberMode === 'local' ? `<button class="js-add-row" data-command="add">${fluentIcon('add')}<span>Add a property</span></button>` : '<div class="js-empty">No effective members.</div>')}</div>${identityView}${relationsView}</div>`;
}

function propertyEditorRow(row: PropertyRow, selected: boolean, expanded: boolean, definitions: readonly { readonly name: string; readonly pointer: string }[], document?: unknown): string {
  const schema = row.schema ?? {};
  const authoredType = inlinePropertyTypeValue(schema);
  const primitiveOptions = inlinePropertyTypes().map((value) => `<option value="type:${escapeAttribute(value)}" ${authoredType === `type:${value}` ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  const referenceOptions = definitions.map((definition) => `<option value="ref:#${escapeAttribute(definition.pointer)}" ${authoredType === `ref:#${definition.pointer}` ? 'selected' : ''}>${escapeHtml(definitionTypeLabel(definition.pointer))}</option>`).join('');
  const availableTypes = new Set([...inlinePropertyTypes().map((value) => `type:${value}`), ...definitions.map((definition) => `ref:#${definition.pointer}`)]);
  const preservedType = authoredType && !availableTypes.has(authoredType) ? `<option value="${escapeAttribute(authoredType)}" selected>${escapeHtml(inlinePropertyTypeLabel(authoredType))}</option>` : '';
  const detailsId = `property-details-${encodeURIComponent(row.pointer).replace(/%/g, '-')}`;
  const requiredControl = row.requiredAlternatives
    ? `<button class="js-required-sets" data-action-id="property.required-alternatives" data-action-pointer="${escapeAttribute(propertyOwnerPointer(row.pointer))}" title="This type uses alternative required sets">Edit sets</button>`
    : `<label><input type="checkbox" data-inline-property="required" data-property-pointer="${escapeAttribute(row.pointer)}" ${row.required ? 'checked' : ''}> required</label>`;
  return `<div class="js-property-editor" data-property-editor="${escapeAttribute(row.pointer)}" aria-current="${selected}"><div class="js-row js-inline-property-row" role="row"><div class="js-cell" role="cell"><input class="js-inline-name js-code" data-inline-property="name" data-property-pointer="${escapeAttribute(row.pointer)}" value="${escapeAttribute(row.name)}" aria-label="Property name"></div><div class="js-cell js-inline-type-cell" role="cell" data-type-drop="${escapeAttribute(row.pointer)}"><select class="js-inline-type js-code" data-inline-property="type" data-property-pointer="${escapeAttribute(row.pointer)}" aria-label="Type for ${escapeAttribute(row.name)}" aria-keyshortcuts="Alt+ArrowDown">${preservedType}<optgroup label="Primitive types">${primitiveOptions}</optgroup>${referenceOptions ? `<optgroup label="Reusable types">${referenceOptions}</optgroup>` : ''}</select><span class="js-type-drop-zone" aria-hidden="true"></span></div><div class="js-cell js-inline-required-cell" role="cell">${requiredControl}</div><div class="js-cell js-description-cell" role="cell"><input class="js-inline-description" data-inline-property="description" data-property-pointer="${escapeAttribute(row.pointer)}" value="${escapeAttribute(row.description ?? '')}" placeholder="Add description" aria-label="Description for ${escapeAttribute(row.name)}"></div><div class="js-cell js-action-cell" role="cell"><button class="js-row-action" data-property-details="${escapeAttribute(row.pointer)}" aria-expanded="${expanded}" aria-controls="${detailsId}" aria-label="${expanded ? 'Collapse' : 'Expand'} validation and annotations for ${escapeAttribute(row.name)}">${fluentIcon('chevronRight', `js-property-chevron${expanded ? ' js-expanded' : ''}`)}</button></div></div>${expanded ? propertyDetailsPanel(row, detailsId, document) : ''}</div>`;
}

function inlinePropertyTypeValue(schema: Readonly<Record<string, unknown>>): string {
  if (typeof schema.type === 'string') return `type:${schema.type}`;
  const reference = relationReference(schema.type);
  if (reference) return `ref:${reference}`;
  return Array.isArray(schema.type) ? `union:${JSON.stringify(schema.type)}` : '';
}

function definitionTypeLabel(pointer: string): string {
  return pointer.split('/').slice(2).map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~')).join('.');
}

function inlinePropertyTypeLabel(value: string): string {
  if (value.startsWith('union:')) {
    try {
      return displaySchemaTypeValue(JSON.parse(value.slice('union:'.length)));
    } catch {
      return 'union';
    }
  }
  return value.startsWith('ref:#/') ? definitionTypeLabel(value.slice('ref:#'.length)) : value.replace(/^(?:type|ref):/, '');
}

function inlinePropertyTypes(): readonly string[] {
  const control = actionById('core.type')?.control;
  const compound = new Set(['object', 'array', 'map', 'set', 'tuple', 'choice']);
  return control?.kind === 'select' ? control.options.map((option) => option.value).filter((value) => !compound.has(value)) : [];
}

function propertyDetailsPanel(row: PropertyRow, id: string, document?: unknown): string {
  const schema = row.schema ?? {};
  const validationFields = [
    ['minimum', 'Minimum', 'number'], ['maximum', 'Maximum', 'number'], ['exclusiveMinimum', 'Exclusive minimum', 'number'], ['exclusiveMaximum', 'Exclusive maximum', 'number'], ['multipleOf', 'Multiple of', 'number'],
    ['minLength', 'Minimum length', 'integer'], ['maxLength', 'Maximum length', 'integer'], ['pattern', 'Pattern', 'text'], ['format', 'Format', 'text'],
    ['minItems', 'Minimum items', 'integer'], ['maxItems', 'Maximum items', 'integer'], ['uniqueItems', 'Unique items', 'boolean'], ['minProperties', 'Minimum properties', 'integer'], ['maxProperties', 'Maximum properties', 'integer'], ['minEntries', 'Minimum entries', 'integer'], ['maxEntries', 'Maximum entries', 'integer'],
  ] as const;
  const annotationFields = [
    ['symbol', 'Display symbol', 'text'], ['unit', 'Display unit', 'text'], ['ucumUnit', 'UCUM unit', 'text'], ['currency', 'Currency', 'text'], ['semanticRole', 'Semantic role', 'text'], ['derivation', 'Derivation', 'text'], ['referenceRole', 'Reference role', 'text'], ['phenomenonTimeRelation', 'Time relation', 'text'],
  ] as const;
  const structuredFields = [
    ['symbols', 'Localized symbols'], ['observedProperty', 'Observed property'], ['concepts', 'Concepts'], ['statistic', 'Statistic'], ['codedValues', 'Coded values'], ['measurementConditioning', 'Measurement conditioning'], ['temporalReferenceSystem', 'Temporal reference system'], ['cadence', 'Cadence'], ['coordinateReferenceSystem', 'Coordinate reference system'], ['altnames', 'Alternate names'],
  ] as const;
  const validation = propertyDetailFields(schema, validationFields, row.pointer, 'validation');
  const annotations = propertyDetailFields(schema, annotationFields, row.pointer, 'annotation');
  const structured = structuredFields.filter(([keyword]) => schema[keyword] !== undefined).map(([keyword, label]) => propertyJsonField(row.pointer, keyword, label, schema[keyword])).join('');
  const validationCount = validationFields.filter(([keyword]) => schema[keyword] !== undefined).length;
  const annotationCount = annotationFields.filter(([keyword]) => schema[keyword] !== undefined).length + structuredFields.filter(([keyword]) => schema[keyword] !== undefined).length;
  const validationAdd = propertyDetailAddControl(schema, row.pointer, validationFields.map(([keyword, label]) => [inlineKeywordActionId('validation', keyword), keyword, label] as const), 'constraint', document);
  const annotationOptions = [
    ...annotationFields.map(([keyword, label]) => [inlineKeywordActionId('annotation', keyword), keyword, label] as const),
    ...structuredFields.map(([keyword, label]) => [inlineKeywordActionId('annotation', keyword), keyword, label] as const),
  ];
  const annotationAdd = propertyDetailAddControl(schema, row.pointer, annotationOptions, 'annotation', document);
  return `<section class="js-property-details" id="${id}" aria-label="Validation and annotations for ${escapeAttribute(row.name)}"><div class="js-property-detail-columns"><section class="js-property-detail-group" aria-labelledby="${id}-constraints"><header><strong id="${id}-constraints">Validation constraints</strong><span>${validationCount}</span></header><div class="js-property-detail-fields">${validation || '<p class="js-detail-empty">No constraints</p>'}</div>${validationAdd}</section><section class="js-property-detail-group" aria-labelledby="${id}-annotations"><header><strong id="${id}-annotations">Annotations</strong><span>${annotationCount}</span></header><div class="js-property-detail-fields">${annotations}${structured || (!annotations ? '<p class="js-detail-empty">No annotations</p>' : '')}</div>${annotationAdd}</section></div><p class="js-inline-status" data-inline-status="${escapeAttribute(row.pointer)}" role="status" aria-live="polite"></p></section>`;
}

function propertyDetailFields(schema: Readonly<Record<string, unknown>>, fields: readonly (readonly [string, string, 'text' | 'number' | 'integer' | 'boolean'])[], pointer: string, family: string): string {
  return fields.filter(([keyword]) => schema[keyword] !== undefined).map(([keyword, label, kind]) => {
    const value = schema[keyword];
    const removeAction = `${inlineKeywordActionId(family, keyword)}.remove`;
    if (kind === 'boolean') return `<div class="js-detail-field"><label class="js-detail-check"><input type="checkbox" data-inline-keyword="${keyword}" data-inline-family="${family}" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="boolean" ${value === true ? 'checked' : ''}> ${label}</label>${propertyDetailRemoveButton(pointer, removeAction, label)}</div>`;
    const action = actionById(inlineKeywordActionId(family, keyword));
    const catalog = action && catalogFamilyForAction(action);
    const stringBacked = action?.control?.kind === 'number' && action.control.schemaNumeric && stringBackedNumericType(typeof schema.type === 'string' ? schema.type : undefined);
    const numericInput = kind === 'number' || kind === 'integer';
    const input = `<input data-inline-keyword="${keyword}" data-inline-family="${family}" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="${kind}" ${catalog ? 'data-catalog-value ' : ''}type="${numericInput && !stringBacked ? 'number' : 'text'}" ${kind === 'integer' ? 'step="1" min="0"' : kind === 'number' && !stringBacked ? 'step="any"' : stringBacked ? 'inputmode="decimal"' : ''} value="${escapeAttribute(value === undefined ? '' : String(value))}">`;
    const field = catalog ? `<label data-inline-catalog="${escapeAttribute(action.id)}" data-property-pointer="${escapeAttribute(pointer)}">${label}<span class="js-detail-json">${input}<button type="button" data-inline-browse="${keyword}" data-catalog-open aria-label="Browse ${escapeAttribute(label.toLocaleLowerCase())} catalog">Browse</button></span><small class="js-detail-provenance" data-catalog-provenance>Catalog suggestions are advisory.</small></label>` : `<label>${label}${input}</label>`;
    return `<div class="js-detail-field">${field}${propertyDetailRemoveButton(pointer, removeAction, label)}</div>`;
  }).join('');
}

function propertyJsonField(pointer: string, keyword: string, label: string, value: unknown): string {
  const action = actionById(inlineKeywordActionId('annotation', keyword));
  const catalog = action && catalogFamilyForAction(action);
  const raw = value === undefined ? '' : JSON.stringify(value);
  const summary = structuredValueLabel(value);
  const remove = propertyDetailRemoveButton(pointer, `${inlineKeywordActionId('annotation', keyword)}.remove`, label);
  if (!catalog) return `<div class="js-detail-field"><div><span class="js-detail-label">${escapeHtml(label)}</span><span class="js-structured-summary">${escapeHtml(summary)}</span><small>Edit this structured value from its dedicated editor.</small></div>${remove}</div>`;
  const input = `<input type="hidden" data-inline-keyword="${keyword}" data-inline-family="annotation" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="json" data-catalog-value value="${escapeAttribute(raw)}"><input data-catalog-display value="${escapeAttribute(summary)}" readonly aria-label="${escapeAttribute(label)}">`;
  return `<div class="js-detail-field"><label data-inline-catalog="${escapeAttribute(action.id)}" data-property-pointer="${escapeAttribute(pointer)}">${label}<span class="js-detail-json">${input}<button type="button" data-inline-browse="${keyword}" data-catalog-open aria-label="Browse ${escapeAttribute(label.toLocaleLowerCase())} catalog">Browse</button></span><small class="js-detail-provenance" data-catalog-provenance>Catalog suggestions are advisory.</small></label>${remove}</div>`;
}

function propertyDetailAddControl(schema: Readonly<Record<string, unknown>>, pointer: string, fields: readonly (readonly [string, string, string])[], kind: string, document?: unknown): string {
  const options = fields.filter(([actionId, keyword]) => {
    const action = actionById(actionId);
    return schema[keyword] === undefined && action !== undefined && (document === undefined || actionAvailability(action, pointer, document).enabled);
  }).map(([actionId, , label]) => `<option value="${escapeAttribute(actionId)}">${escapeHtml(label)}</option>`).join('');
  if (!options) return '';
  return `<div class="js-detail-add"><label>Add ${escapeHtml(kind)}<select data-property-detail-select><option value="">Choose ${escapeHtml(kind)}</option>${options}</select></label><button type="button" data-property-detail-add data-property-pointer="${escapeAttribute(pointer)}">Add</button></div>`;
}

function propertyDetailRemoveButton(pointer: string, actionId: string, label: string): string {
  return `<button class="js-detail-remove" type="button" data-inline-keyword-remove="${escapeAttribute(actionId)}" data-property-pointer="${escapeAttribute(pointer)}" aria-label="Remove ${escapeAttribute(label.toLocaleLowerCase())}">Remove</button>`;
}

function structuredValueLabel(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(structuredValueLabel).filter(Boolean).join(', ') || 'Configured list';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['label', 'name', 'reference', '$ref', 'code', 'id']) if (typeof record[key] === 'string') return record[key];
    const scalarEntries = Object.entries(record).filter(([, entry]) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry));
    if (scalarEntries.length) return scalarEntries.map(([key, entry]) => `${humanizeIdentifier(key)}: ${String(entry)}`).join('; ');
    return 'Configured value';
  }
  return 'Not configured';
}

function inlineKeywordActionId(family: string, keyword: string): string {
  if (keyword === 'maxLength') return 'core.max-length';
  const prefix = family === 'validation' ? 'validation' : ['symbol', 'symbols', 'unit', 'ucumUnit', 'currency'].includes(keyword) ? 'units' : keyword === 'altnames' ? 'alternate-names' : 'semantic';
  return `${prefix}.${keyword}`;
}

function stringBackedNumericType(type: string | undefined): boolean {
  return type !== undefined && ['int64', 'uint64', 'int128', 'uint128', 'decimal'].includes(type);
}

function effectiveSchemaType(document: unknown, pointer: string): string | undefined {
  const schema = valueAtPointer(document, pointer);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const effective = effectiveValidationTypes(document, schema as Readonly<Record<string, unknown>>);
  return effective.determinate && effective.types.length === 1 ? effective.types[0] : undefined;
}

function displaySchemaType(schema: Readonly<Record<string, unknown>>): string {
  return displaySchemaTypeValue(schema.type);
}

function formatRelationScope(scope: string | readonly string[] | undefined): string {
  if (scope === undefined) return 'unscoped';
  return typeof scope === 'string' ? pointerLabel(scope) : `${scope.length} scopes`;
}

function propertyOwnerPointer(pointer: string): string {
  return pointer.replace(/\/properties\/[^/]+$/, '');
}

function escapePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function setInlineStatus(root: HTMLElement, pointer: string, message: string): void {
  const status = root.querySelector(`[data-inline-status="${cssAttributeValue(pointer)}"]`);
  if (status) status.textContent = message;
}

export function graphView(graphOrSnapshot: ReturnType<typeof projectGraph> | DocumentSnapshot, navigationOrSelected: GraphNavigationController | string | undefined, selectedPointerOverride?: string | undefined): string {
  const isSnapshot = 'model' in graphOrSnapshot;
  const sourceGraph: ReturnType<typeof projectGraph> = isSnapshot ? projectGraph(graphOrSnapshot as DocumentSnapshot) : graphOrSnapshot as ReturnType<typeof projectGraph>;
  const semanticView: SemanticGraphView | undefined = isSnapshot ? semanticGraphBySnapshot.get(graphOrSnapshot as DocumentSnapshot)?.view() : undefined;
  const graph = semanticView?.projection ?? sourceGraph;
  const navigation: GraphNavigationController = isSnapshot ? graphNavigationBySnapshot.get(graphOrSnapshot as DocumentSnapshot) ?? new GraphNavigationController() : navigationOrSelected as GraphNavigationController;
  const layout = isSnapshot ? forceGraphLayoutBySnapshot.get(graphOrSnapshot as DocumentSnapshot) ?? new ForceGraphLayout() : new ForceGraphLayout();
  const selectedPointer = semanticView?.selection?.pointer ?? (isSnapshot ? navigationOrSelected as string | undefined : selectedPointerOverride);
  const layoutPositions = layout.reconcile(graph.nodes, graph.edges);
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const positions = layoutPositions.map((position) => ({ ...graphNodes.get(position.id)!, ...position }));
  const position = new Map(positions.map((node) => [node.id, node]));
  const bounds = layout.contentBounds();
  const width = bounds.width; const height = bounds.height; navigation.setContent({ x: 0, y: 0, width, height }); const state = navigation.snapshot(); const minimap = navigation.minimap(positions); const transform = `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.zoom})`;
  const minimapViewport = clampMinimapViewport(minimap.viewport, width, height);
  const labelRuntime = new GraphRuntime({
    nodes: positions.map((node) => ({ id: node.id, position: { x: node.x + node.width / 2, y: node.y + node.height / 2 }, width: node.width, height: node.height })),
    edges: graph.edges.filter((edge) => position.has(edge.from) && position.has(edge.to)).map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label })),
  });
  const labelLanes = new Map(labelRuntime.assignEdgeLabelLanes().map((lane) => [lane.edgeId, lane.lane]));
  const selectedNodeId = semanticView?.selection?.kind !== 'relation' ? semanticView?.selection?.nodeId as string | undefined : undefined;
  const selectedEdgeId = semanticView?.selection?.kind === 'relation' || semanticView?.selection?.kind === 'source' ? semanticView.selection.nodeId as string | undefined : undefined;
  const searchMatches = new Set(semanticView?.searchMatches ?? []);
  const edges = graph.edges.map((edge) => renderGraphEdge(edge, position, labelLanes.get(edge.id) ?? 0, edge.id === selectedEdgeId)).join('');
  const nodes = positions.map((node) => renderGraphNode(node, selectedPointer, state.semanticZoom, node.id === selectedNodeId, searchMatches.has(node.id))).join('') || '<text x="30" y="50">No types to graph.</text>';
  if (!isSnapshot) layout.dispose();
  const semanticToolbar = semanticView
    ? renderSemanticGraphToolbar(semanticView, state.camera.zoom, isSnapshot ? documentNameFromUri((graphOrSnapshot as DocumentSnapshot).uri) : 'Schema')
    : `<div class="js-graph-toolbar"><button data-graph-fit title="Fit level">Fit level</button><button data-graph-relayout title="Release pinned nodes and arrange automatically" aria-label="Auto arrange">${fluentIcon('arrowSync')}</button><span class="js-spacer"></span><button data-graph-zoom-out aria-label="Zoom out">${fluentIcon('subtract')}</button><span data-semantic-zoom>${Math.round(state.camera.zoom * 100)}%</span><button data-graph-zoom-in aria-label="Zoom in">${fluentIcon('add')}</button></div>`;
  const graphLabel = semanticView ? `${semanticView.title}. ${semanticView.description}` : `Type relationship graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`;
  const selectedNode = selectedNodeId ? graph.nodes.find((node) => node.id === selectedNodeId) : undefined;
  const selectedEdge = selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) : undefined;
  const graphInspector = semanticView ? renderGraphInspector(semanticView, selectedNode, selectedEdge) : '';
  const minimapMarkup = `<aside class="js-minimap-wrap" aria-label="Graph minimap"><div class="js-minimap-head"><span>Whole document</span><span>${escapeHtml(semanticView?.location.level ?? 'Graph')}</span></div><svg class="js-minimap" viewBox="0 0 180 120" data-minimap><rect width="180" height="120"></rect><g data-minimap-nodes>${minimap.nodes.map((node, index) => `<rect data-minimap-node="${escapeAttribute(positions[index]?.id ?? '')}" x="${node.x / width * 180}" y="${node.y / height * 120}" width="${Math.max(3, node.width / width * 180)}" height="${Math.max(3, node.height / height * 120)}"></rect>`).join('')}</g><rect class="js-minimap-viewport" x="${minimapViewport.x}" y="${minimapViewport.y}" width="${minimapViewport.width}" height="${minimapViewport.height}"></rect></svg></aside>`;
  const levelBanner = semanticView ? `<div class="js-graph-level-banner"><span>Level ${semanticView.location.level === 'atlas' ? '1' : semanticView.location.level === 'types' ? '2' : '3'} · ${escapeHtml(semanticView.location.level)}</span><strong>${escapeHtml(semanticView.title)}</strong><small>${escapeHtml(semanticView.description)}</small></div>` : '';
  const hint = semanticView ? `<div class="js-graph-hint">${escapeHtml(graphHint(semanticView))}</div>` : '';
  return `${semanticToolbar}<div class="js-graph-workspace"><section class="js-graph-viewport">${levelBanner}<svg class="js-graph-canvas" data-graph-canvas data-search-active="${Boolean(semanticView?.searchQuery.trim())}" viewBox="0 0 ${width} ${height}" tabindex="0" role="group" aria-label="${escapeAttribute(graphLabel)}. Press Enter to drill in, Escape to drill out, wheel or pinch to zoom, and drag to pan."><defs><marker id="js-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="currentColor"></path></marker></defs><g data-graph-world transform="${transform}"><g data-graph-edges>${edges}</g><g data-graph-nodes>${nodes}</g></g></svg>${hint}${minimapMarkup}</section>${graphInspector}</div>`;
}

function renderSemanticGraphToolbar(view: SemanticGraphView, zoom: number, documentTitle: string): string {
  const breadcrumbs = [{ label: documentTitle, level: 'atlas' as const }, ...view.breadcrumbs.slice(1)].map((crumb, index, values) => `<button data-graph-breadcrumb="${crumb.level}" ${index === values.length - 1 ? 'aria-current="page"' : ''}>${escapeHtml(crumb.label)}</button>${index < values.length - 1 ? `<span aria-hidden="true">${fluentIcon('chevronRight', 'js-chevron')}</span>` : ''}`).join('');
  return `<div class="js-graph-toolbar"><button data-graph-back title="Back" aria-label="Back" ${view.canBack ? '' : 'disabled'}>${fluentIcon('arrowLeft')}</button><button data-graph-forward title="Forward" aria-label="Forward" ${view.canForward ? '' : 'disabled'}>${fluentIcon('arrowRight')}</button><button data-graph-home title="Schema atlas" aria-label="Schema atlas">${fluentIcon('home')}</button><span class="js-graph-divider"></span><nav class="js-graph-crumbs" aria-label="Graph location">${breadcrumbs}</nav>${renderGraphLensBar(view)}<span class="js-spacer"></span><label class="js-graph-search"><span class="js-sr-only">Find type or relation</span><input type="search" data-graph-search value="${escapeAttribute(view.searchQuery)}" placeholder="Find type or relation"></label><span class="js-graph-divider"></span><button data-graph-relayout title="Release pinned nodes and arrange automatically" aria-label="Auto arrange">${fluentIcon('arrowSync')}</button><button data-graph-zoom-out title="Zoom out" aria-label="Zoom out">${fluentIcon('subtract')}</button><span data-semantic-zoom>${Math.round(zoom * 100)}%</span><button data-graph-zoom-in title="Zoom in" aria-label="Zoom in">${fluentIcon('add')}</button><button data-graph-fit title="Fit level" aria-label="Fit level">Fit level</button></div>`;
}

function renderGraphLensBar(view: SemanticGraphView): string {
  const lenses: readonly { readonly id: import('../graph.js').ProjectionId; readonly label: string }[] = [
    { id: 'namespaces', label: 'Namespaces' }, { id: 'relations', label: 'Relations' }, { id: 'extends', label: 'Extends' }, { id: 'imports', label: 'Imports' },
  ];
  return `<div class="js-graph-lenses" role="group" aria-label="Graph lens">${lenses.map((lens) => `<button data-graph-lens="${lens.id}" aria-pressed="${view.location.lens === lens.id}">${lens.label}</button>`).join('')}</div>`;
}

function renderGraphInspector(view: SemanticGraphView, node: ReturnType<typeof projectGraph>['nodes'][number] | undefined, edge: ReturnType<typeof projectGraph>['edges'][number] | undefined): string {
  const selectionKind = edge ? edge.kind === 'relation' ? 'Relation' : 'Graph link' : node?.kind === 'namespace' ? 'Namespace' : node?.kind === 'document' ? 'Document root' : node ? 'Type' : 'Graph';
  const title = edge?.label ?? node?.label ?? view.title;
  const description = edge
    ? `${pointerLabel(edge.from)} → ${pointerLabel(edge.to)}${edge.target ? ` · ${edge.target}` : ''}`
    : node ? `${node.namespace || 'Document'} · ${node.status ?? 'resolved'}` : view.description;
  const related = view.projection.edges.filter((candidate) => candidate.from === node?.id || candidate.to === node?.id).slice(0, 12);
  const relationList = related.length
    ? related.map((candidate) => `<button data-graph-edge-select="${escapeAttribute(candidate.id)}"><span><strong>${escapeHtml(candidate.label)}</strong><small>${escapeHtml(pointerLabel(candidate.to === node?.id ? candidate.from : candidate.to))}</small></span><em>${candidate.kind}</em></button>`).join('')
    : '<p>No related links in this view.</p>';
  return `<aside class="js-graph-inspector" aria-label="Graph selection details"><div class="js-graph-panel-title">Details <span>${selectionKind}</span></div><header><span>${escapeHtml(view.location.lens)} · ${escapeHtml(view.location.level)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></header><div class="js-graph-panel-section"><div class="js-graph-metrics"><div><strong>${view.projection.nodes.length}</strong><span>visible nodes</span></div><div><strong>${view.projection.edges.length}</strong><span>visible links</span></div></div></div><div class="js-graph-panel-title">Related in view</div><div class="js-graph-panel-section js-graph-related">${relationList}</div><div class="js-graph-panel-section js-graph-inspector-actions"><button data-graph-open-selection ${view.location.lens === 'relations' && view.location.level !== 'neighborhood' ? '' : 'disabled'}>Drill into selection</button></div></aside>`;
}

function graphHint(view: SemanticGraphView): string {
  if (view.location.lens !== 'relations') return 'Select an item to inspect it; use the lens controls to change the graph perspective.';
  if (view.location.level === 'atlas') return 'Double-click a namespace to reveal its type topology; wheel or pinch crosses semantic levels.';
  if (view.location.level === 'types') return 'Double-click a type to open its outgoing relationship neighborhood.';
  return 'Select a relationship to inspect it; Back preserves the navigation path.';
}

function documentNameFromUri(uri: string): string {
  const value = uri.replace(/[?#].*$/, '').split(/[\\/]/).pop();
  return value ? decodeURIComponent(value) : 'Schema';
}

type PositionedGraphNode = ReturnType<typeof projectGraph>['nodes'][number] & ForceGraphPosition;

function renderGraphEdge(edge: ReturnType<typeof projectGraph>['edges'][number], positions: ReadonlyMap<string, PositionedGraphNode>, labelLane = 0, selected = false): string {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return '';
  const geometry = graphEdgePath(from, to);
  const description = [edge.label, edge.status, edge.target, edge.documentUri, edge.provenance, edge.reason].filter(Boolean).join(' | ');
  const interaction = edge.pointer && edge.selectable !== false ? `role="button" tabindex="0" data-graph-edge-select="${escapeAttribute(edge.id)}"` : 'role="img"';
  return `<g class="js-edge-group js-edge-${edge.kind} js-status-${edge.status ?? 'resolved'}" data-graph-edge="${escapeAttribute(edge.id)}" data-graph-from="${escapeAttribute(edge.from)}" data-graph-to="${escapeAttribute(edge.to)}" ${interaction} aria-current="${selected}" aria-label="${escapeAttribute(description)}"><path class="js-edge" d="${geometry.path}" marker-end="url(#js-arrow)"><title>${escapeHtml(description)}</title></path><text class="js-edge-label" x="${geometry.labelX}" y="${geometry.labelY + labelLane * 14}">${escapeHtml(edge.label)}</text></g>`;
}

function renderGraphNode(node: PositionedGraphNode, selectedPointer: string | undefined, semanticZoom: string, selectedById = false, searchMatch = false): string {
  const status = node.status ?? 'resolved';
  const description = [node.label, node.kind, status, node.documentUri, node.provenance].filter(Boolean).join(' | ');
  const interaction = node.selectable === false
    ? `role="img" aria-label="${escapeAttribute(description)}"`
    : `role="button" tabindex="0" data-graph-select="${escapeAttribute(node.pointer)}" aria-label="${escapeAttribute(description)}" aria-current="${node.pointer === selectedPointer}"`;
  const metadata = status === 'resolved' ? node.namespace : `${status}${node.provenance ? ` | ${node.provenance}` : ''}`;
  return `<g class="js-node js-node-${node.kind} js-status-${status}" data-graph-node="${escapeAttribute(node.id)}" data-graph-pinned="${node.pinned}" data-search-match="${searchMatch}" ${interaction} aria-current="${selectedById || (!selectedById && node.pointer === selectedPointer)}" transform="translate(${node.x} ${node.y})"><title>${escapeHtml(description)}</title><rect class="js-node-hit-target" width="150" height="50"></rect><rect class="js-node-shape" width="150" height="50"></rect><text x="12" y="22">${escapeHtml(node.label)}</text><text class="js-node-meta" x="12" y="39">${semanticZoom === 'detail' || status !== 'resolved' ? escapeHtml(metadata) : ''}</text></g>`;
}

function clampMinimapViewport(viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, contentWidth: number, contentHeight: number): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const width = Math.min(180, Math.max(1, viewport.width / contentWidth * 180));
  const height = Math.min(120, Math.max(1, viewport.height / contentHeight * 120));
  return { x: Math.min(180 - width, Math.max(0, viewport.x / contentWidth * 180)), y: Math.min(120 - height, Math.max(0, viewport.y / contentHeight * 120)), width, height };
}

function inspector(property: PropertyRow | undefined, definition: import('../model.js').DefinitionProjection | undefined, diagnostics: readonly Diagnostic[], relation?: import('../model.js').RelationProjection): string {
  if (relation) return relationInspector(relation, diagnostics);
  const sections = property ? projectSchemaInspectorSections(property.schema) : projectInspectorSections(definition);
  const heading = property?.name ?? definition?.name ?? 'No selection';
  const kind = property ? 'Property' : definition?.type ?? 'Document';
  const propertyActions = property ? `<div class="js-actions"><button data-action-id="property.rename">Rename</button><button data-action-id="property.edit">Change type</button><button class="js-danger" data-action-id="property.delete">Delete</button></div>` : '';
  return `<section><div class="js-eyebrow">${escapeHtml(kind)}</div><h2>${escapeHtml(heading)}</h2>${property?.description ? `<p class="js-description">${escapeHtml(property.description)}</p>` : ''}${propertyActions}</section>${sections.map(inspectorSection).join('') || '<section><p class="js-description">No normalized fields are available for this selection.</p></section>'}<section><div class="js-eyebrow">Diagnostics</div><p class="js-description">${diagnostics.length} for this selection.</p></section>`;
}

function relationInspector(relation: import('../model.js').RelationProjection, diagnostics: readonly Diagnostic[]): string {
  const pointer = escapeAttribute(relation.pointer);
  const cardinality = relation.cardinality ?? 'single';
  const scope = typeof relation.scope === 'string' ? [relation.scope] : relation.scope ?? [];
  return `<section><div class="js-eyebrow">Relation</div><h2>${escapeHtml(relation.name)}</h2><p class="js-description">${escapeHtml(pointerLabel(relation.targetTypeRef ?? 'Unresolved target'))}</p><div class="js-actions"><button data-action-id="relation.rename" data-action-pointer="${pointer}">Rename</button><button data-action-id="relation.edit" data-action-pointer="${pointer}">Edit</button><button class="js-danger" data-action-id="relation.delete" data-action-pointer="${pointer}">Delete</button></div></section><section class="js-inspector-section"><div class="js-eyebrow">Target</div><dl><div class="js-inspector-row"><dt>Type</dt><dd class="js-code">${escapeHtml(relation.targetTypeRef ?? 'not set')}</dd></div><div class="js-inspector-row"><dt>Qualifier</dt><dd class="js-code">${escapeHtml(relation.qualifierTypeRef ?? 'none')}</dd></div></dl><button class="js-inspector-action" data-action-id="relation.qualifier" data-action-pointer="${pointer}">Change qualifier</button></section><section class="js-inspector-section"><div class="js-eyebrow">Cardinality</div><div class="js-cardinality" role="group" aria-label="Relation cardinality"><button data-relation-cardinality="single" data-action-pointer="${pointer}" aria-pressed="${cardinality === 'single'}">single</button><button data-relation-cardinality="multiple" data-action-pointer="${pointer}" aria-pressed="${cardinality === 'multiple'}">multiple</button></div></section><section class="js-inspector-section"><div class="js-section-head"><h2>Scope</h2><button data-action-id="relation.scope" data-action-pointer="${pointer}">Edit</button></div>${scope.length ? `<ul class="js-scope-list">${scope.map((entry) => `<li class="js-code">${escapeHtml(entry)}</li>`).join('')}</ul>` : '<p class="js-description">No scope. Resolution uses the surrounding instance context.</p>'}</section><section><div class="js-eyebrow">Diagnostics</div><p class="js-description">${diagnostics.length} for this relation.</p></section>`;
}

function inspectorSection(section: InspectorSection): string {
  return `<section class="js-inspector-section"><div class="js-eyebrow">${escapeHtml(section.label)}</div><dl>${section.fields.map((field) => `<div class="js-inspector-row"><dt>${escapeHtml(field.keyword)}${field.origin === 'effective' ? '<span class="js-origin">effective</span>' : ''}</dt><dd class="js-code">${escapeHtml(field.value)}</dd></div>`).join('')}</dl></section>`;
}

export function problemsView(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((diagnostic) => `<div class="js-problem-item" role="listitem"><button class="js-problem" data-problem="${escapeAttribute(diagnostic.location?.pointer ?? '')}"><span class="js-problem-${diagnostic.severity}">${fluentIcon(diagnostic.severity === 'error' ? 'errorCircle' : 'warning')}</span><span>${escapeHtml(diagnostic.message)}</span><span class="js-location">${escapeHtml(diagnostic.location?.pointer ?? '')}</span></button></div>`).join('') || '<div class="js-empty" role="listitem">No problems detected.</div>';
}

function problems(diagnostics: readonly Diagnostic[]): string { return problemsView(diagnostics); }


function showActionPalette(root: HTMLElement, pointer: string, session: DocumentSession, catalogs: CatalogRegistry, apply: CommandApply, openSource: () => void): void {
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
  const choose = (): void => { const action = actionById(select.value); if (action) { const availability = actionAvailability(action, pointer, session.value); if (!availability.enabled) return; close(false); showActionEditor(root, action, availability.pointer, session, catalogs, apply, invoker, openSource); } };
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

function showActionEditor(root: HTMLElement, action: CommandAction, pointer: string, session: DocumentSession, catalogs: CatalogRegistry, apply: CommandApply, transitionInvoker?: HTMLElement, openSource?: () => void): void {
  const invoker = transitionInvoker ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  root.querySelector('.js-inline-editor')?.remove();
  const panel = document.createElement('form');
  panel.className = 'js-inline-editor';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'action-title');
  const nameField = action.id.endsWith('.add') ? '<label>Name<input name="name" required></label>' : '';
  const valueField = action.requiresValue === false ? '' : actionControlHtml(action, pointer, session);
  const sourceOnly = action.control?.kind === 'source-only' || action.control?.kind === 'advanced-json' || action.control?.kind === 'structured-object' ||
    action.control?.kind === 'structured-list' && action.control.item === 'schema' || !action.control && action.requiresValue !== false;
  panel.innerHTML = `<header><div><div class="js-eyebrow">Edit ${escapeHtml(pointerLabel(pointer))}</div><h2 id="action-title">${escapeHtml(action.label)}</h2></div><button class="js-inline-close" type="button" data-cancel aria-label="Cancel" title="Cancel">${fluentIcon('dismiss')}</button></header><p id="action-help" class="js-description">${escapeHtml(action.help)}</p>${sourceOnly ? '' : nameField}${valueField}<p class="js-action-status" data-action-status role="status" aria-live="polite"></p><div class="js-actions"><button type="button" data-cancel>${sourceOnly ? 'Close' : 'Cancel'}</button>${sourceOnly ? '<button type="button" data-open-source>Open Source</button>' : '<button>Apply</button>'}</div>`;
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
  form.querySelector('[data-open-source]')?.addEventListener('click', () => {
    close();
    openSource?.();
  });
  const structuredList = panel.querySelector('[data-structured-list]');
  const syncStructuredList = (): void => {
    if (!structuredList) return;
    const hidden = form.elements.namedItem('value') as HTMLInputElement;
    const lineInput = structuredList.querySelector('[data-list-lines]') as HTMLTextAreaElement | null;
    const values = lineInput
      ? lineInput.value.split(/\r?\n/).map((entry: string) => entry.trim()).filter(Boolean)
      : [...structuredList.querySelectorAll('option:checked')].map((entry: HTMLElement) => (entry as HTMLInputElement).value);
    hidden.value = JSON.stringify(values);
  };
  structuredList.querySelectorAll('textarea,select').forEach((control: HTMLElement) => control.addEventListener('input', syncStructuredList));
  structuredList.querySelectorAll('select').forEach((control: HTMLElement) => control.addEventListener('change', syncStructuredList));
  syncStructuredList();
  const valueList = panel.querySelector('[data-value-list]');
  const syncValueList = (): void => {
    if (!valueList) return;
    const selected = [...valueList.querySelectorAll('[data-value-item] input[type="checkbox"]')].filter((item) => (item as HTMLInputElement).checked).map((item) => (item as HTMLInputElement).value);
    const hidden = form.elements.namedItem('value') as HTMLInputElement;
    hidden.value = JSON.stringify(selected);
    valueList.querySelectorAll('[data-value-item]').forEach((item: HTMLElement, index: number) => {
      const selectedIndex = selected.indexOf((item.querySelector('input') as HTMLInputElement).value);
      const order = item.querySelector('[data-value-order]');
      if (order) order.textContent = selectedIndex >= 0 ? String(selectedIndex + 1) : '';
      item.classList.toggle('js-value-selected', selectedIndex >= 0);
      void index;
    });
  };
  valueList?.querySelectorAll('input[type="checkbox"]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', syncValueList));
  valueList?.querySelectorAll('[data-value-move]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
    const item = button.closest('[data-value-item]') as HTMLElement | null;
    const direction = button.dataset.valueMove === 'up' ? -1 : 1;
    const sibling = direction < 0 ? item?.previousElementSibling : item?.nextElementSibling;
    if (!item || !sibling?.hasAttribute('data-value-item')) return;
    if (direction < 0) item.parentElement?.insertBefore(item, sibling);
    else item.parentElement?.insertBefore(sibling, item);
    syncValueList();
    button.focus();
  }));
  syncValueList();
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
    if (sourceOnly) return;
    try {
      const raw = value?.value.trim() ?? undefined;
      const parsed = raw === undefined ? undefined : parseActionValue(action, raw, value instanceof HTMLInputElement && value.type === 'checkbox' ? value.checked : false, effectiveSchemaType(session.value, pointer));
      const error = await apply(action.create(pointer, parsed, name?.value.trim()));
      if (error) { status.textContent = error; return; }
      close();
    } catch (error) {
      value?.setCustomValidity(error instanceof Error ? error.message : 'Enter a valid value.');
      value?.reportValidity();
    }
  });
  (sourceOnly ? panel.querySelector('[data-open-source]') as HTMLElement | null : name ?? value)?.focus();
}

function createCatalogRegistry(): CatalogRegistry {
  const registry = new CatalogRegistry();
  registry.register(BUNDLED_UCUM_PROVIDER);
  registry.register(BUNDLED_ISO_4217_PROVIDER);
  registry.register(BUNDLED_SEMANTIC_PROVIDER);
  return registry;
}

function wireCatalogControl(panel: HTMLElement, action: CommandAction, session: DocumentSession, catalogs: CatalogRegistry, status: HTMLElement, onValueSelected?: () => void): void {
  const input = panel.querySelector('[data-catalog-value]') as HTMLInputElement | null;
  const display = panel.querySelector('[data-catalog-display]') as HTMLInputElement | null;
  const open = panel.querySelector('[data-catalog-open]') as HTMLButtonElement | null;
  const provenance = panel.querySelector('[data-catalog-provenance]') as HTMLElement | null;
  const family = catalogFamilyForAction(action);
  const root = panel.closest('.json-structure-editor') as HTMLElement | null;
  if (!input || !open || !provenance || !family || !root) return;
  let searchSequence = 0;
  let activeProviderId = 'all';
  let drawer: HTMLElement | undefined;
  let activeRequest: ReturnType<CatalogRegistry['createRequest']> | undefined;
  let lastResult: CatalogMergeResult | undefined;
  let releaseTrap = (): void => undefined;
  const close = (): void => {
    if (activeRequest) catalogs.cancel(activeRequest);
    activeRequest = undefined;
    releaseTrap();
    drawer?.remove();
    drawer = undefined;
    open.focus();
  };
  const applySuggestion = (index: number): void => {
    const suggestion = lastResult?.suggestions[index];
    if (!suggestion) return;
    input.value = typeof suggestion.value === 'string' ? suggestion.value : suggestion.emittedJson;
    if (display) display.value = suggestion.label;
    provenance.textContent = suggestion.provenance.map((source) => `${source.providerLabel} ${source.version} | ${source.trusted ? 'trusted' : 'advisory'} | ${source.source}`).join('; ');
    close();
    onValueSelected?.();
  };
  const wireDrawer = (): void => {
    if (!drawer) return;
    drawer.querySelector('[data-catalog-close]')?.addEventListener('click', close);
    drawer.querySelectorAll('[data-catalog-provider]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      activeProviderId = button.dataset.catalogProvider ?? 'all';
      const query = (drawer?.querySelector('[data-catalog-query]') as HTMLInputElement | null)?.value ?? '';
      void search(query);
    }));
    const queryInput = drawer.querySelector('[data-catalog-query]') as HTMLInputElement | null;
    queryInput?.addEventListener('input', () => { void search(queryInput.value); });
    drawer.querySelectorAll('[data-catalog-suggestion]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => applySuggestion(Number(button.dataset.catalogSuggestion))));
    drawer.querySelector('[data-catalog-custom-apply]')?.addEventListener('click', () => {
      const custom = (drawer?.querySelector('[data-catalog-custom]') as HTMLInputElement | null)?.value.trim() ?? '';
      if (!custom) return;
      input.value = custom;
      if (display) display.value = custom;
      provenance.textContent = 'Custom authored value | document | trusted';
      close();
      onValueSelected?.();
    });
    queryInput?.focus();
  };
  const search = async (query: string): Promise<void> => {
    const sequence = ++searchSequence;
    const documentVersion = session.snapshot().documentVersion;
    if (activeRequest) catalogs.cancel(activeRequest);
    const request = catalogs.createRequest(`ui-catalog-${Date.now()}-${sequence}`, documentVersion, family, query, 60);
    activeRequest = request;
    const manifests = catalogs.listProviders().filter((provider) => provider.families.includes(family));
    const selected = activeProviderId === 'all' ? manifests : manifests.filter((provider) => provider.id === activeProviderId);
    const providers: CatalogProvider[] = selected.map((manifest) => ({ providerId: manifest.id, search: (catalogRequest) => bundledCatalogResult(catalogRequest, manifest.id) }));
    const result = await catalogs.search(request, providers);
    if (activeRequest?.invocationId === request.invocationId) activeRequest = undefined;
    if (sequence !== searchSequence || documentVersion !== session.snapshot().documentVersion || result.stale) return;
    lastResult = result;
    if (!drawer) return;
    drawer.innerHTML = catalogBrowserView(manifests, result, family, query, activeProviderId);
    wireDrawer();
    if (result.providerIssues.length) status.textContent = result.providerIssues.map((issue) => issue.message).join(' ');
  };
  open.addEventListener('click', () => {
    if (drawer) return;
    drawer = document.createElement('aside');
    drawer.className = 'js-catalog-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', `${family} catalog`);
    root.append(drawer);
    releaseTrap = trapFocus(drawer, close);
    void search(display?.value ?? input.value);
  });
}

export function catalogBrowserView(providers: readonly CatalogProviderManifest[], result: CatalogMergeResult, family: string, query: string, activeProviderId = 'all'): string {
  const providerButtons = [{ id: 'all', label: 'All providers', kind: 'host', version: `${providers.length}` }, ...providers.map((provider) => ({ id: provider.id, label: provider.label, kind: provider.kind, version: provider.version }))]
    .map((provider) => `<button class="js-catalog-provider" data-catalog-provider="${escapeAttribute(provider.id)}" aria-pressed="${provider.id === activeProviderId}"><strong>${escapeHtml(provider.label)}</strong><small>${escapeHtml(provider.kind)} · ${escapeHtml(provider.version)}</small></button>`).join('');
  const suggestions = result.suggestions.map((suggestion, index) => `<button class="js-catalog-result" data-catalog-suggestion="${index}"><span><strong>${escapeHtml(suggestion.label)}</strong>${suggestion.description ? `<small>${escapeHtml(suggestion.description)}</small>` : ''}</span><span class="js-catalog-sources">${suggestion.provenance.map((source) => `<span class="js-origin-chip" data-trusted="${source.trusted}" title="${escapeAttribute(`${source.source} · ${source.version}${source.stale ? ' · stale' : ''}`)}">${escapeHtml(source.providerLabel)}${source.stale ? ' · stale' : ''}</span>`).join('')}</span></button>`).join('') || '<div class="js-empty">No catalog matches. Custom values remain available.</div>';
  const issues = result.providerIssues.map((issue) => `<p class="js-problem-warning">${escapeHtml(issue.providerId)}: ${escapeHtml(issue.message)}</p>`).join('');
  return `<div class="js-catalog-provider-list"><div class="js-panel-head">Providers</div>${providerButtons}</div><section class="js-catalog-content"><header class="js-catalog-head"><div><strong>${escapeHtml(humanizeIdentifier(family))}</strong><small>Advisory open vocabulary with canonical source preservation</small></div><button data-catalog-close aria-label="Close catalog">${fluentIcon('dismiss')}</button></header><input class="js-catalog-search" data-catalog-query type="search" value="${escapeAttribute(query)}" placeholder="Search values, labels, and aliases" aria-label="Search catalog"><div class="js-catalog-results">${issues}${suggestions}</div><div class="js-catalog-custom"><p>Enter a domain-specific value when no catalog entry applies.</p><div><input data-catalog-custom placeholder="Custom value"><button data-catalog-custom-apply>Apply custom</button></div></div></section>`;
}

function actionControlHtml(action: CommandAction, pointer: string, session: DocumentSession): string {
  const label = escapeHtml(action.valueLabel ?? 'Value');
  const control = action.control;
  if (!control || control.kind === 'source-only' || control.kind === 'advanced-json' || control.kind === 'structured-object') {
    return '<div class="js-empty">This shape is edited in Source so the complete structure remains visible and reviewable.</div>';
  }
  if (control.kind === 'text') return `<label>${label}${control.multiline ? '<textarea name="value" required aria-describedby="action-help"></textarea>' : '<input name="value" required aria-describedby="action-help">'}</label>`;
  if (control.kind === 'boolean') return `<label class="js-check"><input name="value" type="checkbox">${label}</label>`;
  if (control.kind === 'number') {
    const stringBacked = control.schemaNumeric && stringBackedNumericType(effectiveSchemaType(session.value, pointer));
    return `<label>${label}<input name="value" type="${stringBacked ? 'text' : 'number'}" ${stringBacked ? 'inputmode="decimal"' : control.integer ? 'step="1"' : 'step="any"'} ${control.minimum === undefined || stringBacked ? '' : `min="${control.minimum}"`} required></label>`;
  }
  if (control.kind === 'select') return `<label>${label}<select name="value">${control.options.map((option) => `<option value="${escapeAttribute(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
  if (control.kind === 'schema-type') {
    const types = ['any', 'null', 'boolean', 'string', 'integer', 'number', 'decimal', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer', 'object', 'array', 'set', 'map', 'tuple', 'choice'];
    return `<label>${label}<select name="value">${types.map((type) => `<option value="${type}">${type}</option>`).join('')}</select></label>`;
  }
  if (control.kind === 'reference-picker') {
    const references = session.snapshot().model?.projections.definitions.filter((definition) => definition.reusable) ?? [];
    return `<label>${label}<select name="value">${references.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}">${escapeHtml(definition.name)}</option>`).join('')}</select></label>`;
  }
  if (control.kind === 'property-multi-select') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const properties = target && typeof target.properties === 'object' && target.properties ? Object.keys(target.properties) : [];
    const current = action.id === 'relation.identity' ? target?.identity : action.id === 'core.tuple' ? target?.tuple : target?.required;
    const selected = Array.isArray(current) ? current.flat().filter((entry): entry is string => typeof entry === 'string' && properties.includes(entry)) : [];
    const orderedProperties = [...selected, ...properties.filter((property) => !selected.includes(property))];
    return `<fieldset data-value-list><legend>${label}</legend>${orderedProperties.map((property) => `<div class="js-value-item" data-value-item><span class="js-value-order" data-value-order></span><label class="js-check"><input type="checkbox" value="${escapeAttribute(property)}" ${selected.includes(property) ? 'checked' : ''}>${escapeHtml(property)}</label><span class="js-value-actions"><button type="button" data-value-move="up" aria-label="Move ${escapeAttribute(property)} up">${fluentIcon('arrowUp')}</button><button type="button" data-value-move="down" aria-label="Move ${escapeAttribute(property)} down">${fluentIcon('arrowUp', 'js-icon-down')}</button></span></div>`).join('') || '<p class="js-description">No properties are available.</p>'}<input name="value" type="hidden" value="${escapeAttribute(JSON.stringify(selected))}"></fieldset>`;
  }
  if (control.kind === 'relation-editor') return relationControlHtml(pointer, session);
  if (control.kind === 'structured-list') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const current = action.keyword && target ? target[action.keyword] : action.id === 'core.uses' ? (session.value as Record<string, unknown>).$uses : undefined;
    const selected = Array.isArray(current) ? current.filter((entry): entry is string => typeof entry === 'string') : typeof current === 'string' ? [current] : [];
    if (control.item === 'schema') return '<div class="js-empty">Schema branches are edited in Source so each branch remains explicit.</div>';
    if (control.item === 'reference') {
      const references = session.snapshot().model?.projections.definitions.filter((definition) => definition.reusable) ?? [];
      return `<fieldset data-structured-list><legend>${label}</legend><select data-list-options multiple size="${Math.min(8, Math.max(3, references.length))}" aria-describedby="action-help">${references.map((definition) => { const value = `#${definition.pointer}`; return `<option value="${escapeAttribute(value)}" ${selected.includes(value) ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`; }).join('')}</select><input name="value" type="hidden"></fieldset>`;
    }
    return `<label data-structured-list>${label}<textarea data-list-lines rows="5" aria-describedby="action-help" placeholder="One value per line">${escapeHtml(selected.join('\n'))}</textarea><input name="value" type="hidden"></label>`;
  }
  if (control.kind === 'catalog') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const current = action.keyword && target ? target[action.keyword] : undefined;
    const value = current === undefined ? '' : typeof current === 'string' ? current : JSON.stringify(current);
    return `<label>${label}<span class="js-catalog-field"><input name="value" data-catalog-value type="hidden" value="${escapeAttribute(value)}"><input data-catalog-display type="text" value="${escapeAttribute(structuredValueLabel(current))}" readonly><button type="button" data-catalog-open>Browse catalog</button></span></label><p class="js-description" data-catalog-provenance>${current === undefined ? 'No value selected. Catalog suggestions are advisory; custom values are allowed.' : 'Current authored value.'}</p>`;
  }
  return '<div class="js-empty">Open Source to edit this value.</div>';
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

export function collectionPointers(document: unknown): readonly string[] {
  const pointers: string[] = [];
  const visit = (value: unknown, pointer: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string' && ['array', 'set', 'map'].includes(record.type)) pointers.push(pointer === '' ? '#' : `#${pointer}`);
    for (const [name, child] of Object.entries(record)) visit(child, `${pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  };
  visit(document, '');
  return pointers;
}

function isObjectSchema(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).type === 'object';
}

export function mobileModeSelect(mode: Mode): string {
  const modes: readonly { readonly value: Mode; readonly label: string }[] = [
    { value: 'design', label: 'Document' }, { value: 'graph', label: 'Graph' }, { value: 'source', label: 'Source' }, { value: 'instance', label: 'Validate' }, { value: 'conversion', label: 'Convert' },
  ];
  const options = (items: readonly { readonly value: Mode; readonly label: string }[]): string => items.map((item) => `<option value="${item.value}" ${item.value === mode ? 'selected' : ''}>${item.label}</option>`).join('');
  return `<label class="js-mobile-mode"><span class="js-sr-only">Editor mode</span><select data-mobile-mode aria-label="Editor mode">${options(modes)}</select></label>`;
}

export function shouldFitGraphOnEntry(currentMode: Mode, nextMode: Mode, graphEntered: boolean): boolean {
  return nextMode === 'graph' && currentMode !== 'graph' && !graphEntered;
}

function enhanceWorkbenchDom(root: HTMLElement, mode: Mode): void {
  const toolbarSpacer = root.querySelector('.js-document-toolbar .js-spacer');
  toolbarSpacer?.insertAdjacentHTML('afterend', mobileModeSelect(mode));
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
  const namespaces = [...root.querySelectorAll('.js-tree-namespace')] as HTMLElement[];
  namespaces.reverse().forEach((namespace) => {
    const hasVisibleType = [...namespace.querySelectorAll('.js-tree-item')].some((item) => !(item as HTMLElement).hidden);
    namespace.hidden = !hasVisibleType;
    if (normalized && hasVisibleType) namespace.setAttribute('open', '');
  });
  const count = root.querySelector('.js-tree-group');
  if (count) count.textContent = `${visible} definitions`;
}

function toggleMobileDrawer(root: HTMLElement, name: string): void {
  root.querySelectorAll('[data-drawer-panel]').forEach((panel: HTMLElement) => panel.classList.toggle('js-drawer-open', panel.dataset.drawerPanel === name && !panel.classList.contains('js-drawer-open')));
  root.querySelectorAll('[data-mobile-drawer]').forEach((button: HTMLButtonElement) => button.setAttribute('aria-expanded', String(root.querySelector(`[data-drawer-panel="${button.dataset.mobileDrawer}"]`)?.classList.contains('js-drawer-open') ?? false)));
}

function closeMobileDrawers(root: HTMLElement): void {
  root.querySelectorAll('[data-drawer-panel]').forEach((panel: HTMLElement) => panel.classList.remove('js-drawer-open'));
  root.querySelectorAll('[data-mobile-drawer]').forEach((button: HTMLButtonElement) => button.setAttribute('aria-expanded', 'false'));
}

function compactDrawerMode(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1120px)').matches;
}

export function prefersReducedMotion(matchMedia?: (query: string) => { readonly matches: boolean }): boolean {
  const query = matchMedia ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined);
  return query?.('(prefers-reduced-motion: reduce)').matches === true;
}

function setCompactDrawerModal(root: HTMLElement, panel?: HTMLElement): void {
  root.querySelectorAll('[data-drawer-inert]').forEach((element: HTMLElement) => {
    element.removeAttribute('inert');
    element.removeAttribute('data-drawer-inert');
  });
  root.querySelectorAll('[data-drawer-panel]').forEach((element: HTMLElement) => {
    element.removeAttribute('role');
    element.removeAttribute('aria-modal');
  });
  if (!panel) return;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const workbench = panel.closest('.js-workbench');
  const shell = workbench?.parentElement;
  [...(shell?.children ?? [])].forEach((element) => {
    if (element !== workbench) markDrawerSiblingInert(element as HTMLElement);
  });
  [...(workbench?.children ?? [])].forEach((element) => {
    if (element !== panel) markDrawerSiblingInert(element as HTMLElement);
  });
}

function markDrawerSiblingInert(element: HTMLElement): void {
  element.setAttribute('inert', '');
  element.setAttribute('data-drawer-inert', '');
}

interface WorkbenchFocusAnchor {
  readonly attribute: string;
  readonly value: string;
  readonly ordinal: number;
}

export const workbenchFocusIdentityAttributes = [
  'data-select', 'data-mode', 'data-graph-select', 'data-problem', 'data-problems-toggle',
  'data-mobile-mode', 'data-mobile-drawer', 'data-mobile-drawer-close', 'data-member-mode', 'data-effective-source',
  'data-graph-search', 'data-graph-lens', 'data-graph-edge-select', 'data-graph-breadcrumb', 'data-graph-back', 'data-graph-forward', 'data-graph-home', 'data-graph-out', 'data-graph-fit', 'data-graph-relayout', 'data-graph-zoom-out', 'data-graph-zoom-in',
  'data-instance-input', 'data-instance-root', 'data-instance-validate', 'data-instance-diagnostic', 'data-trace-instance', 'data-trace-schema',
  'data-conversion-command', 'data-conversion-option', 'data-conversion-load', 'data-conversion-source', 'data-conversion-run', 'data-conversion-cancel', 'data-conversion-open',
  'data-addin', 'data-impact-direction', 'data-command', 'data-show-commands', 'data-theme-select', 'data-action-select', 'data-action-id',
  'data-libraries-load', 'data-library-read', 'data-library-operation', 'data-library-selector', 'data-library-declaration', 'data-library-provider-filter', 'data-library-search', 'data-library-preview', 'data-library-apply',
  'data-provider-configure', 'data-local-provider-configure', 'data-provider-remove', 'data-library-publish-preview', 'data-library-publish', 'data-publish-provider', 'data-publish-entry', 'data-publish-version', 'data-publish-source', 'data-publish-epoch', 'data-publish-default',
  'data-inline-property', 'data-inline-keyword', 'data-property-details', 'data-inline-property-apply', 'data-catalog-open',
] as const;

function availablePropertyName(owner: Readonly<Record<string, unknown>>): string {
  const properties = isRecord(owner.properties) ? owner.properties : {};
  const relations = isRecord(owner.relations) ? owner.relations : {};
  const used = new Set([...Object.keys(properties), ...Object.keys(relations)]);
  if (!used.has('field')) return 'field';
  let suffix = 2;
  while (used.has(`field${suffix}`)) suffix += 1;
  return `field${suffix}`;
}

function captureWorkbenchFocus(root: HTMLElement, active: HTMLElement | null): WorkbenchFocusAnchor | undefined {
  if (!active || !root.contains(active)) return undefined;
  for (const attribute of workbenchFocusIdentityAttributes) {
    const owner = active.closest?.(`[${attribute}]`) as HTMLElement | null;
    if (!owner || !root.contains(owner)) continue;
    const value = owner.getAttribute(attribute) ?? '';
    const peers = ([...root.querySelectorAll(`[${attribute}]`)] as HTMLElement[]).filter((candidate) => (candidate.getAttribute(attribute) ?? '') === value);
    const ordinal = peers.indexOf(owner);
    if (ordinal >= 0) return { attribute, value, ordinal };
  }
  return undefined;
}

function restoreWorkbenchFocus(root: HTMLElement, anchor: WorkbenchFocusAnchor | undefined): void {
  if (!anchor) return;
  const peers = ([...root.querySelectorAll(`[${anchor.attribute}]`)] as HTMLElement[]).filter((candidate) => (candidate.getAttribute(anchor.attribute) ?? '') === anchor.value);
  const target = peers[anchor.ordinal] ?? peers[0];
  if (target && !target.matches(':disabled') && !target.closest('[inert]')) { target.focus(); return; }
  if (anchor.attribute.startsWith('data-graph-')) (root.querySelector('[data-graph-canvas]') as HTMLElement | null)?.focus();
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
  const requiredAlternatives = Array.isArray(value.required) && value.required.length > 0 && value.required.every(Array.isArray);
  return Object.entries(value.properties).map(([name, schema]) => ({ name, pointer: `/properties/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, type: typeof schema.type === 'string' ? schema.type : 'unknown', required: required.has(name), ...(requiredAlternatives ? { requiredAlternatives: true } : {}), description: typeof schema.description === 'string' ? schema.description : undefined, schema }));
}

function isRecord(value: unknown): value is Record<string, Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function applyEdits(text: string, edits: readonly TextEdit[]): string { return [...edits].sort((a, b) => (b.range.startOffset ?? 0) - (a.range.startOffset ?? 0)).reduce((current, edit) => current.slice(0, edit.range.startOffset) + edit.newText + current.slice(edit.range.endOffset), text); }
function selectFallback(snapshot: DocumentSnapshot, current: string | undefined): string | undefined { if (current !== undefined && snapshot.model?.nodes.some((node) => node.pointer === current)) return current; return snapshotHasInlineRoot(snapshot) ? '' : snapshot.model?.projections.definitions.find((definition) => definition.reusable)?.pointer; }
function snapshotHasInlineRoot(snapshot: DocumentSnapshot): boolean { try { return isInlineRootSchema(JSON.parse(snapshot.text)); } catch { return false; } }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, '&#39;'); }