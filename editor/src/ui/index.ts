import { PROTOCOL_VERSION, type NodeId, type ConversionResult, type ConversionSource, type Diagnostic, type DocumentSnapshot, type EditorHost, type ProgressEvent, type TextEdit } from '../contracts.js';
import {
  CatalogRegistry, catalogCustomValueKind, createBundledCatalogProvider, createCatalogRegistry,
  type CatalogFamily, type CatalogJsonValue, type CatalogMergeResult, type CatalogProviderManifest, type CatalogSuggestion
} from '../catalogs.js';
import { DocumentSession } from '../session.js';
import { loadExternalDocuments } from '../external-documents.js';
import { actionById, commandActions, type CommandAction } from './actions.js';
import { actionAvailability, catalogFamilyForAction, parseActionValue, valueAtPointer } from './action-runtime.js';
import { diagnosticsForPointer, displaySchemaTypeValue, isInlineRootSchema, pointerLabel, projectGraph, projectInspectorSections, projectProperties, projectSchemaInspectorSections, type InspectorSection, type PropertyRow } from './helpers.js';
import { GraphNavigationController } from './graph-navigation.js';
import { ForceGraphLayout, graphEdgePath, type ForceGraphLayoutOptions, type ForceGraphPosition } from './force-graph-layout.js';
import { SemanticGraphController, type SemanticGraphView } from './semantic-graph.js';
import { editorStyles } from './prototype-styles.js';
import { InstanceWorkspace, type CrossNavigationSelection, type EvaluationTrace, type InstanceValidationResult } from '../phase4/instance-workspace.js';
import { resolveEffectiveMembers, type EffectiveMembersResult } from '../phase4/effective-members.js';
import { ResolvedSchemaContext, type ResolvedSchemaDocument } from '../phase4/resolved-schema.js';
import { GraphRuntime } from '../phase4/graph-runtime.js';
import { detectMetaSchemaMode, paletteDescriptors } from '../phase4/meta-schema.js';
import { resolveCapabilities, resolveMetaSchemaCapabilityProfile, WELL_KNOWN_META_SCHEMAS } from '../capabilities.js';
import { conversionOptionsForCommand, validateOptionValues, type ConversionCommand, type ConversionCommandsManifest, type ConversionOptionValues } from '../conversion/types.js';
import { BUILTIN_CONVERSION_COMMANDS_MANIFEST } from '../conversion/manifest.js';
import type { LibraryEntry } from '../libraries/contracts.js';
import type { LibraryDocument } from '../libraries/contracts.js';
import type { LibraryCatalogEntry, LibraryHostResolution, LibraryProviderSummary } from '../libraries/host-runtime.js';
import { renderLibraryBrowser } from './library-browser.js';
import { CopyCollisionError, planLibraryCopy, planLibraryMaterialization, type CopyOperation, type LibraryProvenance } from '../libraries/planning.js';
import { planAddImport, planCopyDeclarations, planExtractInlineProperty, planLocalShadow, planMaterializeDeclarations, planMoveDefinition, type RefactoringPlan } from '../phase4/refactoring.js';
import { coreScalarValueValid, rangeFor } from '../parser.js';
import { effectiveValidationTypes, VALIDATION_KEYWORDS, validationIssues } from '../validation.js';
import type { editor as MonacoEditor } from 'monaco-editor';
import { fluentIcon, type FluentIconName } from './fluent-icons.js';
import { jsonStructureLogo } from './brand-logo.js';
import { technologyIcon } from './technology-icons.js';
import { sameSelection, type SelectionIdentity } from '../selection.js';

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
  readonly onChromeCommand?: (command: 'new' | 'open' | 'save' | 'save-as' | 'show-commands' | 'website' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all' | 'reset-zoom' | 'zoom-in' | 'zoom-out' | 'toggle-fullscreen' | 'quit') => void | Promise<void>;
  /** Synchronizes native title-bar colors with the workbench theme. */
  readonly onThemeChange?: (theme: 'dark' | 'light' | 'contrast') => void | Promise<void>;
}

/** Imperative handle returned by {@link mountJsonStructureEditor}. */
export interface JsonStructureEditorHandle {
  /** Replaces the open JSON text and rerenders every synchronized view. */
  setText(text: string, documentVersion?: number): void;
  /** Updates visible document labels without rebuilding the workbench. */
  setTitle(title: string): void;
  /** Advances the host version for already-mirrored bytes without creating Design history. */
  acknowledgeText?(text: string, documentVersion: number): void;

  /** Updates the canonical document URI used for relative resource resolution. */
  setUri(uri: string): void;
  /** Returns the exact current JSON source text. */
  getText(): string;
  /** Whether the current text differs byte-for-byte from the last saved mark. */
  readonly dirty?: boolean;
  /** Whether a Design/Source transition can be undone or redone. */
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  /** Whether Monaco currently owns text focus in the Source view. */
  isSourceEditorFocused?(): boolean;
  undo?(): void;
  redo?(): void;
  /** Marks current bytes clean for host save integration. */
  markSaved?(documentVersion?: number): void;
  markClean?(): void;
  /** Opens the shared command palette. */
  showCommandPalette(): void;
  /** Releases DOM created by this editor instance. */
  dispose(): void;
}

type Mode = 'design' | 'graph' | 'analysis' | 'instance' | 'conversion' | 'libraries' | 'source';
type ImpactDirection = 'outgoing' | 'incoming' | 'both';
type LibraryOperation = 'import' | 'copy' | 'materialize';
type DesignMemberMode = 'local' | 'effective';
type CompositeType = 'object' | 'array' | 'set' | 'map' | 'tuple' | 'choice';
type CreatableType = 'any' | 'null' | 'boolean' | 'string' | 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64' | 'int128' | 'uint128' | 'integer' | 'float8' | 'float' | 'double' | 'decimal' | 'number' | 'date' | 'datetime' | 'time' | 'duration' | 'uuid' | 'uri' | 'binary' | 'jsonpointer' | CompositeType;
type GraphResizeObserver = { observe(target: SVGElement): void; disconnect(): void };
type DialogElement = HTMLElement & { readonly open: boolean; showModal(): void; close(): void };
const graphNavigationBySnapshot = new WeakMap<DocumentSnapshot, GraphNavigationController>();
const forceGraphLayoutBySnapshot = new WeakMap<DocumentSnapshot, ForceGraphLayout>();
const forceGraphMinimapLayoutBySnapshot = new WeakMap<DocumentSnapshot, ForceGraphLayout>();
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
  let selectedIdentity: SelectionIdentity | undefined;
  let mode: Mode = 'design';
  let lastRepresentationMode: Extract<Mode, 'design' | 'graph' | 'source'> = 'design';
  let disposed = false;
  let sourceEditor: MonacoEditor.IStandaloneCodeEditor | undefined;
  let sourceModel: MonacoEditor.ITextModel | undefined;
  let sourceModelIdentity: { readonly uri: string; readonly generation: number } | undefined;
  let sourceMount = 0;
  let documentGeneration = 0;
  let focusSourceAfterMount = false;
  let commandRequest = 0;
  let commandQueue: Promise<void> = Promise.resolve();
  let synchronizedRender: ReturnType<typeof setTimeout> | undefined;
  let themeName: 'dark' | 'light' | 'contrast' = 'dark';
  let pendingDiagnostic: Diagnostic['location'] | undefined;
  let externalLoad = 0;
  let externalLoadKey: string | undefined;
  let graphResizeObserver: GraphResizeObserver | undefined;
  let graphGeometryFrame: number | undefined;
  let designMemberMode: DesignMemberMode = 'local';
  let typeCreatorOpen = false;
  let typeCreatorNamespacePointer = '';
  let expandedPropertyPointer: string | undefined;
  const pendingPropertyFields = new Set<string>();
  let relationDraftOpen = false;
  let instanceText = '{}';
  let instanceResult: InstanceValidationResult | undefined;
  let instanceWorkspace: InstanceWorkspace | undefined;
  let instanceRootPointer: string | undefined;
  let instanceSelection: CrossNavigationSelection | undefined;
  let instanceSourceGeneration = 0;
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
  let conversionGeneration = 0;
  let startConversionDialogOpen = false;
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
  const graphMinimapLayout = new ForceGraphLayout();
  const semanticGraph = new SemanticGraphController();
  const graphCameraByLocation = new Map<string, import('../graph.js').CameraState>();
  let activeGraphLocationKey: string | undefined;
  let graphEventRenderQueued = false;
  const unsubscribeSemanticGraph = semanticGraph.on((event) => {
    if (disposed || event.type === 'source-changed') return;
    graphNavigation.setSelection(event.view.selection);
    selectedIdentity = event.view.selection;
    if (event.origin !== 'graph') return;
    selectedPointer = event.view.selection?.pointer ?? undefined;
    if (graphEventRenderQueued) return;
    graphEventRenderQueued = true;
    queueMicrotask(() => {
      graphEventRenderQueued = false;
      if (!disposed) render();
    });
  });
  let fitGraphAfterRender = false;
  let graphEntered = false;
  let graphLayerPreset: 'relations' | 'inheritance' | 'data-shape' | 'imports' | 'diagnostics' | 'everything' = 'everything';
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

  const disposeSourceModel = (): void => {
    sourceMount += 1;
    sourceEditor?.dispose();
    sourceEditor = undefined;
    sourceModel?.dispose();
    sourceModel = undefined;
    sourceModelIdentity = undefined;
  };
  const replaceDocument = (): void => {
    documentGeneration += 1;
    startConversionDialogOpen = false;
    disposeSourceModel();
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
    const changed = text !== session.snapshot().text;
    replaceDocument();
    session.update(text, documentVersion);
    if (changed || session.canUndo || session.canRedo) session.clearHistory();
    libraryPublishPreviewState = undefined;
    libraryPublishBinding = undefined;
    selectedPointer = selectFallback(session.snapshot(), selectedPointer);
    render();
    options.onChange?.(text, session.snapshot());
  };
  const setSourceText = (text: string): void => {
    // Monaco owns Source undo/redo. Keep the canonical session synchronized without
    // turning every keystroke into a Design history entry.
    session.update(text, options.host ? session.snapshot().documentVersion : session.snapshot().documentVersion + 1);
    libraryPublishPreviewState = undefined;
    libraryPublishBinding = undefined;
    options.onChange?.(text, session.snapshot());
    if (synchronizedRender) clearTimeout(synchronizedRender);
    synchronizedRender = setTimeout(() => { synchronizedRender = undefined; render(); }, 120);
  };
  const acknowledgeText = (text: string, documentVersion: number): void => {
    if (text !== session.snapshot().text) return;
    session.update(text, documentVersion);
  };
  const setTitle = (title: string): void => {
    documentTitle = title;
    root.querySelectorAll('[data-document-title]').forEach((element: HTMLElement) => { element.textContent = title; });
  };
  const setUri = (uri: string): void => {
    if (uri === session.uri) return;
    replaceDocument();
    session.setUri(uri);
    externalLoadKey = undefined;
    externalLoad += 1;
    render();
  };
  const select = (pointer: string | undefined, nextMode?: Mode): void => {
    selectedIdentity = undefined;
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
      const hostChanged = hostSnapshot.uri !== session.uri || hostSnapshot.text !== session.snapshot().text;
      if (hostChanged) replaceDocument();
      if (hostSnapshot.uri !== session.uri) session.setUri(hostSnapshot.uri);
      session.update(hostSnapshot.text, hostSnapshot.documentVersion);
      if (hostChanged) { session.clearHistory(); render(); }
    }
    const snapshot = session.snapshot();
    const context = { session, documentVersion: snapshot.documentVersion };
    if (!command.canExecute(context)) return 'This command cannot be applied to the current selection or document state.';
    let result: { edits: readonly TextEdit[] };
    try { result = command.execute(context); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
    if (options.host) {
      const revalidated = await options.host.readDocument();
      if (revalidated.uri !== session.uri || revalidated.documentVersion !== snapshot.documentVersion || revalidated.text !== snapshot.text) {
        replaceDocument();
        if (revalidated.uri !== session.uri) session.setUri(revalidated.uri);
        session.update(revalidated.text, revalidated.documentVersion);
        session.clearHistory();
        render();
        return 'The preview is stale because the document changed. Preview again before applying.';
      }
      const response = await options.host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `ui-${++commandRequest}`, documentVersion: snapshot.documentVersion, edits: result.edits });
      if (!response.applied) { session.update(snapshot.text, snapshot.documentVersion); return 'The host rejected the edit. Refresh the document and try again.'; }
      const hostSnapshot = await options.host.readDocument();
      session.commitText(hostSnapshot.text, hostSnapshot.documentVersion);
    } else session.applyTextEdits(result.edits, snapshot.documentVersion + 1);
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
    if (activeGraphLocationKey) graphCameraByLocation.set(activeGraphLocationKey, graphNavigation.snapshot().camera);
    if (disposed) return;
    const snapshot = session.snapshot();
    const desiredSourceIdentity = { uri: snapshot.uri, generation: documentGeneration };
    if (sourceModel && (sourceModel.isDisposed() || sourceModelIdentity?.uri !== desiredSourceIdentity.uri || sourceModelIdentity.generation !== desiredSourceIdentity.generation)) disposeSourceModel();
    if (sourceModel) syncSourceModel(sourceModel, snapshot.text);
    const mount = ++sourceMount;
    const preservedSource = sourceEditor ? root.querySelector('[data-source]') as HTMLElement | null : null;
    const preservedView = root.querySelector(`[data-panel-mode="${mode}"]`) as HTMLElement | null;
    const preservedScrollTop = preservedView?.scrollTop;
    const sourceHadFocus = Boolean(preservedSource?.contains(document.activeElement));
    const focusAnchor = sourceHadFocus ? undefined : captureWorkbenchFocus(root, document.activeElement as HTMLElement | null);
    releaseDrawerTrap();
    releaseDrawerTrap = () => undefined;
    setCompactDrawerModal(root);
    preservedSource?.remove();
    const definitions = (snapshot.model?.projections.definitions ?? []).filter((definition) => definition.reusable);
    const localDefinitionPointers = new Set(definitions.map((definition) => definition.pointer));
    const effectiveSchemaContext = session.value && typeof session.value === 'object' && !Array.isArray(session.value)
      ? new ResolvedSchemaContext(session.value as Readonly<Record<string, unknown>>, { documentUri: session.uri, resolvedDocuments: session.resolvedSchemaDocuments })
      : undefined;
    const typeDefinitions = [
      ...definitions.map((definition) => ({ name: definition.name, pointer: definition.pointer, namespace: definition.namespacePointer, identity: effectiveSchemaContext?.effectiveIdentity(`#${definition.pointer}`), imported: false, root: snapshot.model?.rootPointer === definition.pointer })),
      ...session.effectiveDeclarations
        .filter((declaration) => declaration.imports.length > 0 && !localDefinitionPointers.has(declaration.effectivePointer))
        .map((declaration) => ({
          name: definitionTypeLabel(declaration.effectivePointer),
          pointer: declaration.effectivePointer,
          namespace: declaration.effectivePointer.slice(0, declaration.effectivePointer.lastIndexOf('/')),
          identity: effectiveSchemaContext?.effectiveIdentity(`#${declaration.effectivePointer}`),
          imported: true,
          documentUri: declaration.documentUri,
          sourcePointer: declaration.sourcePointer,
          root: snapshot.model?.rootPointer === declaration.effectivePointer,
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
    graphNavigation.reconcileSelection(graph.nodes, graph.edges);
    graphNavigationBySnapshot.set(snapshot, graphNavigation);
    const semanticGraphView = semanticGraph.setSource(graph);
    selectedIdentity = semanticGraphView.selection;
    const identityMatchesDesign = selectedIdentity !== undefined && selectedIdentity.pointer === selectedPointer;
    const designSelection = identityMatchesDesign ? selectedIdentity : graphSelectionForPointer(graph, selectedPointer);
    if ((semanticGraphView.selection !== undefined || designSelection !== undefined) && !sameSelection(semanticGraphView.selection, designSelection)) semanticGraph.setSelection(designSelection, 'design');
    const synchronizedGraphView = semanticGraph.view();
    const nextGraphLocationKey = semanticGraphLocationKey(synchronizedGraphView);
    if (nextGraphLocationKey !== activeGraphLocationKey) {
      const savedCamera = graphCameraByLocation.get(nextGraphLocationKey);
      if (savedCamera) {
        graphNavigation.setCamera(savedCamera);
        fitGraphAfterRender = false;
      }
      activeGraphLocationKey = nextGraphLocationKey;
    }
    graphNavigation.setSelection(synchronizedGraphView.selection);
    graphNavigation.reconcileSelection(synchronizedGraphView.projection.nodes, synchronizedGraphView.projection.edges);
    semanticGraphBySnapshot.set(snapshot, semanticGraph);
    graphLayout.reconcile(synchronizedGraphView.projection.nodes, synchronizedGraphView.projection.edges, forceGraphOptions(synchronizedGraphView));
    forceGraphLayoutBySnapshot.set(snapshot, graphLayout);
    graphMinimapLayout.reconcile(graph.nodes, graph.edges, { cacheKey: 'full-document', mode: 'relations' });
    forceGraphMinimapLayoutBySnapshot.set(snapshot, graphMinimapLayout);
    root.innerHTML = structuredWorkbenchShell(snapshot, documentTitle, typeDefinitions, definitionPointer, rows, selectedPointer, mode, problemsOpen, designMemberMode, effectiveMembers, expandedPropertyPointer, options.chrome ?? 'document', pendingPropertyFields, relationDraftOpen, typeCreatorOpen);
    if (startConversionDialogOpen) {
      root.querySelector('.js-type-creator')?.insertAdjacentHTML('beforeend', startConversionDialog(services, conversionManifest ?? BUILTIN_CONVERSION_COMMANDS_MANIFEST, conversionCommandId, conversionSource, conversionResult, conversionStatus, conversionProgress, conversionRequestId));
    }
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
    wire(definitionPointer, rows, mode === 'graph' ? synchronizedGraphView.projection : graph);
    if (preservedScrollTop !== undefined) {
      const nextView = root.querySelector(`[data-panel-mode="${mode}"]`) as HTMLElement | null;
      if (nextView) nextView.scrollTop = preservedScrollTop;
    }
    if (sourceHadFocus && sourceEditor) sourceEditor.focus();
    else if (focusSourceAfterMount && sourceEditor) {
      sourceEditor.focus();
      focusSourceAfterMount = false;
    }
    else restoreWorkbenchFocus(root, focusAnchor);
    if (sourceEditor) revealPendingDiagnostic();
    else if (mode === 'source') void mountSourceEditor(root, snapshot.text, sourceModel, snapshot.uri, setSourceText, themeName, () => !disposed && mount === sourceMount && session.snapshot().uri === snapshot.uri && documentGeneration === desiredSourceIdentity.generation).then((mounted) => {
      if (!mounted) return;
      sourceEditor = mounted.editor;
      sourceModel = mounted.model;
       sourceModelIdentity = desiredSourceIdentity;
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
          selectedPointer = view.selection?.pointer ?? undefined;
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
    root.querySelectorAll('[data-chrome-command]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => { const command = button.dataset.chromeCommand as Parameters<NonNullable<JsonStructureEditorOptions['onChromeCommand']>>[0]; if (!options.onChromeCommand && command === 'undo') undo(); else if (!options.onChromeCommand && command === 'redo') redo(); else void options.onChromeCommand?.(command); closeApplicationMenus(root); }));
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
    const applyInlineTypes = (pointer: string, members: readonly string[], nullable: boolean): void => {
      const values = [...members.map(decodeInlineTypeMember), ...(nullable ? ['null'] : [])];
      if (values.length === 0) {
        setInlineStatus(root, pointer, 'A property must have at least one type.');
        render();
        return;
      }
      const schema = valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined;
      const propertyAction = pointer !== '' ? actionById('property.edit') : undefined;
      const coreAction = actionById('core.type');
      const action = propertyAction ?? coreAction;
      if (!schema || !action) return;
      selectedPointer = pointer;
      const value = propertyAction
        ? propertySchemaWithTypes(schema, values)
        : values.length === 1 ? values[0] : values;
      void applyCommand(action.create(pointer, value)).then((error) => error && setInlineStatus(root, pointer, error));
    };
    root.querySelectorAll('[data-inline-type-add]').forEach((selectControl: HTMLSelectElement) => selectControl.addEventListener('change', () => {
      const pointer = selectControl.dataset.propertyPointer;
      const schema = pointer ? valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined : undefined;
      if (!pointer || !schema || !selectControl.value) return;
      const members = inlinePropertyTypeMembers(schema);
      const nextMember = encodeInlineTypeMember(decodeInlineTypeMember(selectControl.value));
      if (members.includes(nextMember)) {
        setInlineStatus(root, pointer, `${inlinePropertyTypeLabel(nextMember)} is already part of this property type.`);
        render();
        return;
      }
      applyInlineTypes(pointer, [...members, nextMember], inlinePropertyNullable(schema));
    }));
    root.querySelectorAll('[data-inline-type-replace]').forEach((selectControl: HTMLSelectElement) => selectControl.addEventListener('change', () => {
      const pointer = selectControl.dataset.propertyPointer;
      const currentMember = selectControl.dataset.inlineTypeReplace;
      const schema = pointer ? valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined : undefined;
      if (!pointer || !schema || !currentMember || !selectControl.value) return;
      const members = inlinePropertyTypeMembers(schema);
      const nextMember = replaceInlineTypeMember(currentMember, selectControl.value);
      if (!nextMember) {
        selectControl.value = currentMember;
        setInlineStatus(root, pointer, 'Choose an explicit item or value schema before changing to a collection type.');
        return;
      }
      if (nextMember !== currentMember && members.some((member) => member !== currentMember && member === nextMember)) {
        setInlineStatus(root, pointer, `${inlinePropertyTypeLabel(nextMember)} is already part of this property type.`);
        render();
        return;
      }
      applyInlineTypes(pointer, members.map((member) => member === currentMember ? nextMember : member), inlinePropertyNullable(schema));
    }));
    root.querySelectorAll('[data-inline-type-remove]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.propertyPointer;
      const member = button.dataset.inlineTypeRemove;
      const schema = pointer ? valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined : undefined;
      if (!pointer || !member || !schema) return;
      const members = inlinePropertyTypeMembers(schema);
      if (members.length <= 1) return;
      applyInlineTypes(pointer, members.filter((candidate) => candidate !== member), inlinePropertyNullable(schema));
    }));
    root.querySelectorAll('[data-inline-collection-kind]').forEach((selectControl: HTMLSelectElement) => selectControl.addEventListener('change', () => {
      const pointer = selectControl.dataset.propertyPointer;
      const schema = pointer ? valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined : undefined;
      if (!pointer || !isCollectionSchema(schema) || !isCollectionType(selectControl.value)) return;
      applyInlineTypes(pointer, [encodeInlineTypeMember(collectionSchemaForKind(selectControl.value, schema))], inlinePropertyNullable(schema));
    }));
    root.querySelectorAll('[data-inline-property="nullable"]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', () => {
      const pointer = checkbox.dataset.propertyPointer;
      const schema = pointer ? valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined : undefined;
      if (!pointer || !schema) return;
      applyInlineTypes(pointer, inlinePropertyTypeMembers(schema), checkbox.checked);
    }));
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
      const reference = event.dataTransfer.getData('application/vnd.json-structure.type-ref');
      const selectedValue = `ref:${reference}`;
      const pointer = target.dataset.typeDrop;
      const schema = pointer ? valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined : undefined;
      if (!pointer || !schema || !reference || inlinePropertyTypeMembers(schema).includes(selectedValue)) return;
      event.preventDefault();
      applyInlineTypes(pointer, [...inlinePropertyTypeMembers(schema), selectedValue], inlinePropertyNullable(schema));
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
    root.querySelectorAll('[data-inline-property="identity"]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', () => {
      const pointer = checkbox.dataset.propertyPointer;
      if (!pointer) return;
      const ownerPointer = propertyOwnerPointer(pointer);
      const owner = valueAtPointer(session.value, ownerPointer) as Record<string, unknown> | undefined;
      const propertyName = pointerLabel(pointer);
      const identity = Array.isArray(owner?.identity) ? owner.identity.filter((entry): entry is string => typeof entry === 'string') : [];
      const next = checkbox.checked ? [...identity.filter((name) => name !== propertyName), propertyName] : identity.filter((name) => name !== propertyName);
      const action = actionById(next.length ? 'relation.identity' : 'relation.remove-identity');
      if (!action) return;
      void ensureInlineActionCapability(action, ownerPointer).then((capabilityError) => {
        if (capabilityError) { setInlineStatus(root, pointer, capabilityError); return; }
        void applyCommand(action.create(ownerPointer, next)).then((error) => error && setInlineStatus(root, pointer, error));
      });
    }));
    const commitInlineDescription = async (input: HTMLInputElement | HTMLTextAreaElement): Promise<string | undefined> => {
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
    root.querySelectorAll('[data-inline-property="description"]').forEach((input: HTMLTextAreaElement) => {
      autoGrowTextarea(input);
      input.addEventListener('input', () => autoGrowTextarea(input));
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
      const input = control as HTMLTextAreaElement;
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
        const current = ([...root.querySelectorAll('[data-inline-property="description"]')] as HTMLTextAreaElement[]).find((candidate) => candidate.dataset.propertyPointer === pointer) ?? input;
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
      const fieldKey = inlineFieldKey(pointer, `${inlineKeywordActionId(family, keyword)}`);
      const schema = valueAtPointer(session.value, pointer) as Readonly<Record<string, unknown>> | undefined;
      const authored = schema?.[keyword] !== undefined;
      if (!authored && pendingPropertyFields.has(fieldKey) && control.dataset.valueKind !== 'boolean' && raw === '') return;
      const remove = authored && control.dataset.valueKind !== 'boolean' && raw === '';
      const action = actionById(`${inlineKeywordActionId(family, keyword)}${remove ? '.remove' : ''}`);
      if (!action) { setInlineStatus(root, pointer, `${keyword} is not available in this profile.`); return; }
      let value: unknown;
      try { value = remove ? undefined : parseActionValue(action, raw, control.checked, effectiveSchemaType(session.value, pointer)); }
      catch (error) { setInlineStatus(root, pointer, error instanceof Error ? error.message : String(error)); return; }
      void applyCommand(action.create(pointer, value)).then((error) => {
        if (error) { setInlineStatus(root, pointer, error); return; }
        if (pendingPropertyFields.delete(fieldKey)) render();
      });
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
      pendingPropertyFields.delete(inlineFieldKey(pointer, actionId.replace(/\.remove$/, '')));
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-pending-remove]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const key = button.dataset.inlinePendingRemove;
      if (!key) return;
      pendingPropertyFields.delete(key);
      render();
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
    root.querySelectorAll('[data-command="definition.add"]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const localDefinitions = session.snapshot().model?.projections.definitions.filter((definition) => definition.reusable).map((definition) => definition.pointer) ?? [];
      typeCreatorNamespacePointer = selectedPointer && namespacePointers(session.value, localDefinitions).includes(selectedPointer) ? selectedPointer : '';
      typeCreatorOpen = true;
      mode = 'design';
      render();
      queueMicrotask(() => (root.querySelector('[data-type-create-name]') as HTMLInputElement | null)?.focus());
    }));
    root.querySelectorAll('[data-namespace-add-type]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      typeCreatorNamespacePointer = button.dataset.namespaceAddType ?? '';
      typeCreatorOpen = true;
      render();
    }));
    const createType = (type: CreatableType | undefined): void => {
      const input = root.querySelector('[data-type-create-name]') as HTMLInputElement | null;
      const name = input?.value.trim() ?? '';
      const add = actionById('definition.add');
      if (!name || !type || !add) {
        setTypeCreatorStatus(root, 'Enter a type name.');
        input?.focus();
        return;
      }
      const pointer = typeCreatorNamespacePointer === '' || typeCreatorNamespacePointer === '/definitions'
        ? `/definitions/${escapePointerToken(name)}`
        : `${typeCreatorNamespacePointer}/${escapePointerToken(name)}`;
      const firstType = (session.model?.projections.definitions.filter((definition) => definition.reusable).length ?? 0) === 0 && !isInlineRootSchema(session.value);
      void applyCommand(add.create(typeCreatorNamespacePointer, compositeSchema(type), name)).then(async (error) => {
        if (error) {
          setTypeCreatorStatus(root, error);
          return;
        }
        selectedPointer = pointer;
        typeCreatorOpen = false;
        if (firstType) {
          const setRoot = actionById('root.set');
          if (setRoot) await applyCommand(setRoot.create(pointer, undefined));
        }
        selectedPointer = pointer;
        render();
        queueMicrotask(() => {
          const nameInput = root.querySelector(`[data-inline-definition-name="${cssAttributeValue(pointer)}"]`) as HTMLInputElement | null;
          nameInput?.focus();
          nameInput?.select();
        });
      });
    };
    root.querySelectorAll('[data-type-create]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => createType(button.dataset.typeCreate as CreatableType | undefined)));
    root.querySelector('[data-type-create-primitive-commit]')?.addEventListener('click', () => {
      createType((root.querySelector('[data-type-create-primitive]') as HTMLSelectElement | null)?.value as CreatableType | undefined);
    });
    root.querySelector('[data-type-create-cancel]')?.addEventListener('click', () => { typeCreatorOpen = false; render(); });
    root.querySelectorAll('[data-document-action]').forEach((control: HTMLInputElement | HTMLTextAreaElement) => control.addEventListener('change', () => {
      const baseId = control.dataset.documentAction;
      const member = control.dataset.documentMember ?? '';
      if (!baseId) return;
      const raw = control.value.trim();
      const action = actionById(raw ? baseId : `${baseId}.remove`);
      if (!action) return;
      let value: unknown = raw;
      try {
        if (raw && control.dataset.valueKind === 'lines') value = control.value.split(/\r?\n/).map((entry: string) => entry.trim()).filter(Boolean);
        else if (raw && control.dataset.valueKind === 'json') value = JSON.parse(raw);
        else if (!raw) value = undefined;
      } catch (error) {
        setDocumentMemberStatus(root, member, error instanceof Error ? error.message : String(error));
        return;
      }
      void applyCommand(action.create('', value)).then((error) => error && setDocumentMemberStatus(root, member, error));
    }));
    root.querySelector('[data-meta-schema-select]')?.addEventListener('change', (event: Event) => {
      const select = event.currentTarget as HTMLSelectElement;
      const custom = root.querySelector('[data-meta-schema-custom]') as HTMLInputElement | null;
      if (select.value === '__custom__') {
        if (custom) {
          custom.hidden = false;
          custom.disabled = false;
          custom.focus();
          custom.select();
        }
        return;
      }
      const action = actionById('core.schema');
      if (!action) return;
      void applyCommand(action.create('', select.value)).then((error) => error && setDocumentMemberStatus(root, '$schema', error));
    });
    root.querySelectorAll('[data-document-use]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', () => {
      const checked = new Set([
        ...[...root.querySelectorAll('[data-document-use-persist]')].map((input) => (input as HTMLInputElement).value),
        ...[...root.querySelectorAll('[data-document-use]')].filter((input) => (input as HTMLInputElement).checked).map((input) => (input as HTMLInputElement).value)
      ]);
      const current = isRecord(session.value) && Array.isArray(session.value.$uses) ? session.value.$uses.filter((use): use is string => typeof use === 'string') : [];
      const selected = [...current.filter((use) => checked.delete(use)), ...checked];
      const action = actionById(selected.length ? 'core.uses' : 'core.uses.remove');
      if (!action) return;
      void applyCommand(action.create('', selected.length ? selected : undefined)).then((error) => error && setDocumentMemberStatus(root, '$uses', error));
    }));
    const applyOffers = (offers: Record<string, string | string[]>): void => {
      const action = actionById(Object.keys(offers).length ? 'core.offers' : 'core.offers.remove');
      if (!action) return;
      void applyCommand(action.create('', Object.keys(offers).length ? offers : undefined)).then((error) => error && setDocumentMemberStatus(root, '$offers', error));
    };
    const selectedOfferTargets = (select: HTMLSelectElement): string[] => [...select.selectedOptions].map((option) => option.value);
    root.querySelectorAll('[data-offer-row]').forEach((row: HTMLElement) => {
      const originalName = row.dataset.offerRow ?? '';
      const nameInput = row.querySelector('[data-offer-name]') as HTMLInputElement | null;
      const targetsInput = row.querySelector('[data-offer-targets]') as HTMLSelectElement | null;
      const update = (): void => {
        const nextName = nameInput?.value.trim() ?? '';
        const targets = targetsInput ? selectedOfferTargets(targetsInput) : [];
        const current = documentOfferMap(session.value);
        if (!nextName || targets.length === 0) {
          setDocumentMemberStatus(root, '$offers', 'Each offer requires a name and at least one local type.');
          return;
        }
        if (nextName !== originalName && Object.prototype.hasOwnProperty.call(current, nextName)) {
          setDocumentMemberStatus(root, '$offers', `Offer '${nextName}' already exists.`);
          return;
        }
        const next = { ...current };
        delete next[originalName];
        next[nextName] = targets.length === 1 ? targets[0]! : targets;
        applyOffers(next);
      };
      nameInput?.addEventListener('change', update);
      targetsInput?.addEventListener('change', update);
      row.querySelector('[data-offer-remove]')?.addEventListener('click', () => {
        const current = documentOfferMap(session.value);
        const next = { ...current };
        delete next[originalName];
        applyOffers(next);
      });
    });
    root.querySelector('[data-offer-add]')?.addEventListener('click', () => {
      const name = (root.querySelector('[data-offer-add-name]') as HTMLInputElement | null)?.value.trim() ?? '';
      const targetsInput = root.querySelector('[data-offer-add-targets]') as HTMLSelectElement | null;
      const targets = targetsInput ? selectedOfferTargets(targetsInput) : [];
      const current = documentOfferMap(session.value);
      if (!name || targets.length === 0) {
        setDocumentMemberStatus(root, '$offers', 'Enter a unique offer name and select at least one local type.');
        return;
      }
      if (Object.prototype.hasOwnProperty.call(current, name)) {
        setDocumentMemberStatus(root, '$offers', `Offer '${name}' already exists.`);
        return;
      }
      applyOffers({ ...current, [name]: targets.length === 1 ? targets[0]! : targets });
    });
    root.querySelectorAll('[data-root-toggle]').forEach((checkbox: HTMLInputElement) => checkbox.addEventListener('change', () => {
      const pointer = checkbox.dataset.rootToggle;
      const action = actionById(checkbox.checked ? 'root.set' : 'root.remove');
      if (pointer === undefined || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-definition-name]').forEach((input: HTMLInputElement) => {
      input.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
      input.addEventListener('change', () => {
        const pointer = input.dataset.inlineDefinitionName;
        const nextName = input.value.trim();
        const action = actionById('definition.rename');
        if (!pointer || !nextName || nextName === pointerLabel(pointer) || !action) return;
        const namespacePointer = pointer.slice(0, pointer.lastIndexOf('/'));
        const nextPointer = `${namespacePointer}/${escapePointerToken(nextName)}`;
        void applyCommand(action.create(pointer, nextName)).then((error) => {
          if (error) {
            setInlineStatus(root, pointer, error);
            input.value = pointerLabel(pointer);
            return;
          }
          selectedPointer = nextPointer;
          render();
        });
      });
    });
    root.querySelectorAll('[data-inline-definition-description]').forEach((input: HTMLTextAreaElement) => {
      autoGrowTextarea(input);
      input.addEventListener('input', () => autoGrowTextarea(input));
      input.addEventListener('change', () => {
        const pointer = input.dataset.inlineDefinitionDescription;
        const action = actionById('property.description');
        if (!pointer || !action) return;
        const description = input.value.trim() ? input.value : undefined;
        void applyCommand(action.create(pointer, description)).then((error) => error && setInlineStatus(root, pointer, error));
      });
    });
    root.querySelectorAll('[data-inline-definition-type]').forEach((selectControl: HTMLSelectElement) => selectControl.addEventListener('change', () => {
      const pointer = selectControl.dataset.inlineDefinitionType;
      const action = actionById('core.type');
      if (pointer === undefined || !action) return;
      void applyCommand(action.create(pointer, selectControl.value)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-definition-delete]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.inlineDefinitionDelete;
      const action = actionById('definition.delete');
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-property-delete]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.inlinePropertyDelete;
      const action = actionById('property.delete');
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-tuple-move]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.tuplePointer;
      const index = Number(button.dataset.tupleIndex);
      const declaration = pointer ? valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined : undefined;
      const action = actionById('property.tuple-members');
      if (pointer === undefined || !declaration || !isRecord(declaration.properties) || !Array.isArray(declaration.tuple) || !action) return;
      const order = declaration.tuple.filter((entry): entry is string => typeof entry === 'string');
      const nextIndex = button.dataset.tupleMove === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= order.length) return;
      [order[index], order[nextIndex]] = [order[nextIndex]!, order[index]!];
      void applyCommand(action.create(pointer, { properties: declaration.properties, order })).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-choice-name]').forEach((input: HTMLInputElement) => input.addEventListener('change', () => {
      const pointer = input.dataset.inlineChoiceName;
      const nextName = input.value.trim();
      const action = actionById('choice.rename');
      if (!pointer || !nextName || nextName === pointerLabel(pointer) || !action) return;
      void applyCommand(action.create(pointer, nextName)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-choice-description]').forEach((input: HTMLTextAreaElement) => input.addEventListener('change', () => {
      const pointer = input.dataset.inlineChoiceDescription;
      const action = actionById('property.description');
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, input.value.trim() ? input.value : undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-choice-delete]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.inlineChoiceDelete;
      const action = actionById('choice.delete');
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-choice-add]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.choiceAdd;
      const name = (button.closest('.js-choice-editor')?.querySelector('[data-choice-add-name]') as HTMLInputElement | null)?.value.trim() ?? '';
      const typeValue = (button.closest('.js-choice-editor')?.querySelector('[data-choice-add-type]') as HTMLSelectElement | null)?.value;
      const schema = typeValue?.startsWith('ref:#') ? { type: { $ref: typeValue.slice(4) } } : typeValue && isCreatableType(typeValue) ? compositeSchema(typeValue) : undefined;
      const action = actionById('choice.add');
      if (pointer === undefined || !name || !schema || !action) return;
      void applyCommand(action.create(pointer, schema, name)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-inline-namespace-name]').forEach((input: HTMLInputElement) => input.addEventListener('change', () => {
      const pointer = input.dataset.inlineNamespaceName;
      const nextName = input.value.trim();
      const action = actionById('namespace.rename');
      if (!pointer || !nextName || nextName === pointerLabel(pointer) || !action) return;
      const parent = pointer.slice(0, pointer.lastIndexOf('/'));
      const nextPointer = `${parent}/${escapePointerToken(nextName)}`;
      void applyCommand(action.create(pointer, nextName)).then((error) => {
        if (error) { setInlineStatus(root, pointer, error); return; }
        selectedPointer = nextPointer;
        render();
      });
    }));
    root.querySelectorAll('[data-namespace-add-child]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.namespaceAddChild;
      const name = (button.closest('.js-sheet')?.querySelector('[data-namespace-add-name]') as HTMLInputElement | null)?.value.trim() ?? '';
      const action = actionById('namespace.add');
      if (pointer === undefined || !name || !action) return;
      void applyCommand(action.create(pointer, name)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-namespace-delete],[data-namespace-delete-contents]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.namespaceDelete ?? button.dataset.namespaceDeleteContents;
      const action = actionById(button.dataset.namespaceDeleteContents ? 'namespace.delete-contents' : 'namespace.delete');
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-namespace-import]').forEach((input: HTMLInputElement) => input.addEventListener('change', () => {
      const pointer = input.dataset.namespacePointer;
      const keyword = input.dataset.namespaceImport as '$import' | '$importdefs';
      const source = input.value.trim();
      const action = actionById(source ? 'import.set' : 'import.delete');
      if (pointer === undefined || !action) return;
      void ensureInlineActionCapability(action, pointer).then((capabilityError) => {
        if (capabilityError) { setInlineStatus(root, pointer, capabilityError); return; }
        void applyCommand(action.create(pointer, source ? { keyword, source } : keyword)).then((error) => error && setInlineStatus(root, pointer, error));
      });
    }));
    root.querySelectorAll('[data-command="add"]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const ownerPointer = button.dataset.propertyOwner ?? definitionPointer;
      if (ownerPointer === undefined) return;
      void addInlineProperty(ownerPointer);
    }));
    root.querySelectorAll('[data-action-id]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => openAction(button.dataset.actionId!, button.dataset.actionPointer ?? selectedPointer)));
    const ensureInlineActionCapability = async (action: CommandAction, pointer: string): Promise<string | undefined> => {
      const availability = actionAvailability(action, pointer, session.value);
      if (availability.enabled) return undefined;
      if (!availability.reason?.startsWith('Activate ') || !action.capability || action.capability === 'core') return availability.reason;
      const document = session.value as Record<string, unknown>;
      const currentCapabilities = resolveCapabilities(document);
      const currentSchema = typeof document.$schema === 'string' ? document.$schema : 'https://json-structure.org/meta/core/v0/#';
      const upgradeableSchemas = new Set([
        'https://json-structure.org/meta/core/v0/#',
        'https://json-structure.org/meta/extended/v0/#',
        'https://json-structure.org/meta/validation/v0/#',
        'https://json-structure.org/meta/semantic-annotations/v0/#',
        'https://json-structure.org/meta/semantic/v0/#',
        'https://json-structure.org/meta/relations/v0/#',
      ]);
      if (!upgradeableSchemas.has(currentSchema)) return availability.reason;
      const extended = 'https://json-structure.org/meta/extended/v0/#';
      const validation = 'https://json-structure.org/meta/validation/v0/#';
      const semanticAnnotations = 'https://json-structure.org/meta/semantic-annotations/v0/#';
      const semantic = 'https://json-structure.org/meta/semantic/v0/#';
      const relations = 'https://json-structure.org/meta/relations/v0/#';
      const semanticRequired = currentSchema === semanticAnnotations || currentSchema === semantic ||
        action.capability === 'semantic-annotations' ||
        action.capability === 'relations' && (
          currentCapabilities.validationActive ||
          currentCapabilities.conditionalCompositionActive ||
          currentCapabilities.unitsActive ||
          currentCapabilities.semanticAnnotationsActive ||
          currentCapabilities.alternateNamesActive
        ) ||
        currentCapabilities.relationsActive && !['relations', 'import'].includes(action.capability);
      const targetSchema = currentSchema === semantic
        ? semantic
        : semanticRequired
          ? semanticAnnotations
        : action.capability === 'relations'
          ? relations
          : action.capability === 'validation'
            ? currentSchema === semanticAnnotations || currentSchema === validation ? currentSchema : validation
            : currentSchema === validation || currentSchema === semanticAnnotations || currentSchema === extended
              ? currentSchema
              : currentSchema === relations ? semanticAnnotations : extended;
      if (currentSchema !== targetSchema) {
        const schemaAction = actionById('core.schema');
        if (!schemaAction) return availability.reason;
        const error = await applyCommand(schemaAction.create('', targetSchema));
        if (error) return error;
      }
      const usesByCapability: Partial<Record<NonNullable<CommandAction['capability']>, string>> = {
        validation: 'JSONStructureValidation',
        'conditional-composition': 'JSONStructureConditionalComposition',
        units: 'JSONStructureUnits',
        'alternate-names': 'JSONStructureAlternateNames',
        'semantic-annotations': 'JSONStructureSemanticAnnotations',
        import: 'JSONStructureImport',
        relations: 'JSONStructureRelations',
      };
      const afterSchemaCapabilities = resolveCapabilities(session.value);
      const preservationUses = [
        currentCapabilities.validationActive && !afterSchemaCapabilities.validationActive ? usesByCapability.validation : undefined,
        currentCapabilities.conditionalCompositionActive && !afterSchemaCapabilities.conditionalCompositionActive ? usesByCapability['conditional-composition'] : undefined,
        currentCapabilities.unitsActive && !afterSchemaCapabilities.unitsActive ? usesByCapability.units : undefined,
        currentCapabilities.semanticAnnotationsActive && !afterSchemaCapabilities.semanticAnnotationsActive ? usesByCapability['semantic-annotations'] : undefined,
        currentCapabilities.alternateNamesActive && !afterSchemaCapabilities.alternateNamesActive ? usesByCapability['alternate-names'] : undefined,
        currentCapabilities.importActive && !afterSchemaCapabilities.importActive ? usesByCapability.import : undefined,
        currentCapabilities.relationsActive && !afterSchemaCapabilities.relationsActive ? usesByCapability.relations : undefined,
      ].filter((use): use is string => use !== undefined);
      if (!actionAvailability(action, pointer, session.value).enabled) {
        const use = usesByCapability[action.capability];
        if (use) preservationUses.push(use);
      }
      if (preservationUses.length) {
        const currentDocument = session.value as Record<string, unknown>;
        const uses = Array.isArray(currentDocument.$uses) ? currentDocument.$uses.filter((entry): entry is string => typeof entry === 'string') : [];
        const nextUses = [...new Set([...uses, ...preservationUses])];
        if (nextUses.length !== uses.length) {
          const usesAction = actionById('core.uses');
          if (!usesAction) return availability.reason;
          const error = await applyCommand(usesAction.create('', nextUses));
          if (error) return error;
        }
      }
      return actionAvailability(action, pointer, session.value).enabled ? undefined : actionAvailability(action, pointer, session.value).reason;
    };
    const applyStructuredFacet = async (action: CommandAction, pointer: string, raw: string, checked = false): Promise<void> => {
      const capabilityError = await ensureInlineActionCapability(action, pointer);
      if (capabilityError) { setInlineStatus(root, pointer, capabilityError); return; }
      let value: unknown;
      try { value = parseActionValue(action, raw, checked, effectiveSchemaType(session.value, pointer)); }
      catch (error) { setInlineStatus(root, pointer, error instanceof Error ? error.message : String(error)); return; }
      const error = await applyCommand(action.create(pointer, value));
      if (error) { setInlineStatus(root, pointer, error); return; }
      if (pendingPropertyFields.delete(inlineFieldKey(pointer, action.id))) render();
    };
    root.querySelectorAll('[data-facet-add]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.facetAdd;
      const select = pointer === undefined ? null : root.querySelector(`[data-facet-select="${cssAttributeValue(pointer)}"]`) as HTMLSelectElement | null;
      if (pointer === undefined || !select?.value) return;
      const action = actionById(select.value);
      if (!action) return;
      void ensureInlineActionCapability(action, pointer).then((error) => {
        if (error) { setInlineStatus(root, pointer, error); return; }
        pendingPropertyFields.add(inlineFieldKey(pointer, action.id));
        render();
      });
    }));
    root.querySelectorAll('[data-facet-advanced]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const action = actionById(button.dataset.facetAdvanced ?? '');
      const pointer = button.dataset.facetPointer;
      if (action && pointer !== undefined) showActionEditor(root, action, pointer, session, catalogRegistry, applyCommand, button);
    }));
    root.querySelectorAll('[data-facet-control]').forEach((control: HTMLInputElement | HTMLTextAreaElement) => control.addEventListener('change', () => {
      const pointer = control.dataset.facetPointer;
      const action = actionById(control.dataset.facetAction ?? '');
      if (pointer === undefined || !action) return;
      const raw = control.dataset.valueKind === 'boolean' ? String((control as HTMLInputElement).checked) : control.value.trim();
      if (control.dataset.valueKind !== 'boolean' && raw === '') return;
      void applyStructuredFacet(action, pointer, raw, (control as HTMLInputElement).checked);
    }));
    root.querySelectorAll('[data-facet-catalog]').forEach((field: HTMLElement) => {
      const pointer = field.dataset.facetPointer;
      const action = actionById(field.dataset.facetCatalog ?? '');
      const status = pointer === undefined ? null : root.querySelector(`[data-inline-status="${cssAttributeValue(pointer)}"]`) as HTMLElement | null;
      if (pointer === undefined || !action || !status) return;
      wireCatalogControl(field, action, session, catalogRegistry, status, () => {
        const input = field.querySelector('[data-catalog-value]') as HTMLInputElement | null;
        if (input) void applyStructuredFacet(action, pointer, input.value);
      });
    });
    root.querySelectorAll('[data-facet-remove]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.facetPointer;
      const action = actionById(button.dataset.facetRemove ?? '');
      if (pointer === undefined || !action) return;
      void applyCommand(action.create(pointer, undefined)).then((error) => error && setInlineStatus(root, pointer, error));
    }));
    root.querySelectorAll('[data-facet-cancel]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const key = button.dataset.facetCancel;
      if (!key) return;
      pendingPropertyFields.delete(key);
      render();
    }));
    root.querySelectorAll('[data-property-detail-add]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const select = button.closest('.js-detail-add')?.querySelector('[data-property-detail-select]') as HTMLSelectElement | null;
      const pointer = button.dataset.propertyPointer;
      if (!select?.value || !pointer) return;
      const actionId = select.value;
      const action = actionById(actionId);
      if (!action) return;
      void ensureInlineActionCapability(action, pointer).then((error) => {
        if (error) { setInlineStatus(root, pointer, error); return; }
        pendingPropertyFields.add(inlineFieldKey(pointer, actionId));
        render();
        queueMicrotask(() => {
          const details = root.querySelector(`[data-property-editor="${cssAttributeValue(pointer)}"] .js-property-details`) as HTMLElement | null;
          (details?.querySelector(`[data-inline-field-action="${cssAttributeValue(actionId)}"] input,[data-inline-field-action="${cssAttributeValue(actionId)}"] textarea`) as HTMLElement | null)?.focus();
        });
      });
    }));
    root.querySelector('[data-inline-relation-add]')?.addEventListener('click', () => { relationDraftOpen = true; render(); });
    root.querySelector('[data-inline-relation-cancel]')?.addEventListener('click', () => { relationDraftOpen = false; render(); });
    root.querySelector('[data-inline-relation-commit]')?.addEventListener('click', () => {
      if (definitionPointer === undefined) return;
      const name = (root.querySelector('[data-inline-relation-name]') as HTMLInputElement | null)?.value.trim() ?? '';
      const targetTypeRef = (root.querySelector('[data-inline-relation-target]') as HTMLSelectElement | null)?.value ?? '';
      const cardinality = (root.querySelector('[data-inline-relation-cardinality]') as HTMLSelectElement | null)?.value as 'single' | 'multiple';
      const scope = (root.querySelector('[data-inline-relation-scope]') as HTMLSelectElement | null)?.value;
      const action = actionById('relation.add');
      if (!action || !name || !targetTypeRef) return;
      void ensureInlineActionCapability(action, definitionPointer).then((capabilityError) => {
        if (capabilityError) { const status = root.querySelector('[data-inline-relation-status]'); if (status) status.textContent = capabilityError; return; }
        void applyCommand(action.create(definitionPointer, { targetTypeRef, cardinality, ...(scope ? { scope } : {}) }, name)).then((error) => {
          if (error) { const status = root.querySelector('[data-inline-relation-status]'); if (status) status.textContent = error; return; }
          relationDraftOpen = false;
          render();
        });
      });
    });
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
        const instanceTextControl = root.querySelector('[data-instance-text]') as HTMLTextAreaElement | null;
        instanceTextControl?.addEventListener('input', () => {
          instanceSourceGeneration += 1;
          instanceText = instanceTextControl.value;
          instanceResult = undefined;
          instanceWorkspace = undefined;
          instanceSelection = undefined;
        });
        root.querySelector('[data-instance-reset]')?.addEventListener('click', () => {
          instanceSourceGeneration += 1;
          instanceText = '{}';
          instanceResult = undefined;
          instanceWorkspace = undefined;
          instanceSelection = undefined;
          render();
        });
        root.querySelector('[data-instance-clear]')?.addEventListener('click', () => {
          instanceSourceGeneration += 1;
          instanceText = '';
          instanceResult = undefined;
          instanceWorkspace = undefined;
          instanceSelection = undefined;
          render();
        });
        const instanceInput = root.querySelector('[data-instance-input]') as HTMLInputElement | null;
        instanceInput?.addEventListener('change', () => {
          const generation = ++instanceSourceGeneration;
          const file = instanceInput.files?.[0];
          if (!file) return;
          void file.text().then((text: string) => {
            if (disposed || generation !== instanceSourceGeneration) return;
            JSON.parse(text);
            instanceText = text;
            instanceResult = undefined;
            render();
          }).catch((error: unknown) => {
            if (disposed || generation !== instanceSourceGeneration) return;
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
    root.querySelector('[data-conversion-reset]')?.addEventListener('click', () => {
      const activeRequest = conversionRequestId;
      conversionGeneration += 1;
      conversionRequestId = undefined;
      conversionProgress = undefined;
      conversionSource = undefined;
      conversionResult = undefined;
      conversionStatus = '';
      if (activeRequest && services?.cancelConversion) void services.cancelConversion(activeRequest).catch(() => undefined);
      render();
    });
    root.querySelectorAll('[data-conversion-command]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const activeRequest = conversionRequestId;
      conversionGeneration += 1;
      conversionRequestId = undefined;
      conversionProgress = undefined;
      conversionCommandId = button.dataset.conversionCommand;
      conversionSource = undefined;
      conversionResult = undefined;
      conversionStatus = '';
      if (activeRequest && services?.cancelConversion) void services.cancelConversion(activeRequest).catch(() => undefined);
      render();
      queueMicrotask(() => ([...root.querySelectorAll('[data-conversion-command]')] as HTMLButtonElement[]).find((candidate) => candidate.dataset.conversionCommand === conversionCommandId)?.focus());
    }));
    root.querySelectorAll('[data-start-conversion-command]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const commandId = button.dataset.startConversionCommand;
      if (!commandId) return;
      const activeRequest = conversionRequestId;
      conversionGeneration += 1;
      conversionRequestId = undefined;
      conversionProgress = undefined;
      conversionCommandId = commandId;
      conversionSource = undefined;
      conversionResult = undefined;
      conversionStatus = '';
      startConversionDialogOpen = true;
      if (activeRequest && services?.cancelConversion) void services.cancelConversion(activeRequest).catch(() => undefined);
      if (!conversionManifest) loadConversionCommands();
      else render();
      queueMicrotask(() => (root.querySelector(`[data-start-command="${cssAttributeValue(commandId)}"] [data-conversion-source],[data-start-command="${cssAttributeValue(commandId)}"] [data-conversion-option],[data-start-command="${cssAttributeValue(commandId)}"] [data-start-conversion-close]`) as HTMLElement | null)?.focus());
    }));
    root.querySelector('[data-start-conversion-close]')?.addEventListener('click', () => {
      const activeRequest = conversionRequestId;
      const commandId = conversionCommandId;
      conversionGeneration += 1;
      conversionRequestId = undefined;
      conversionProgress = undefined;
      startConversionDialogOpen = false;
      if (activeRequest && services?.cancelConversion) void services.cancelConversion(activeRequest).catch(() => undefined);
      render();
      queueMicrotask(() => commandId && (root.querySelector(`[data-start-conversion-command="${cssAttributeValue(commandId)}"]`) as HTMLElement | null)?.focus());
    });
    root.querySelector('[data-conversion-source]')?.addEventListener('click', () => {
      const command = conversionManifest?.commands.find((item) => item.id === conversionCommandId);
      if (!command || command.direction !== 'import' || !services?.selectConversionSource) return;
      const generation = ++conversionGeneration;
      const commandId = command.id;
      conversionStatus = 'Choosing source file...'; render();
      void services.selectConversionSource({
        protocolVersion: PROTOCOL_VERSION,
        requestId: `conversion-source-${Date.now()}`,
        kind: 'select-conversion-source',
        formats: [command.sourceFormat],
        ...(command.sourceExtensions ? { extensions: command.sourceExtensions } : {}),
      }).then((source) => {
        if (disposed || generation !== conversionGeneration || conversionCommandId !== commandId) return;
        conversionSource = source;
        conversionResult = undefined;
        conversionStatus = source ? `Selected ${source.name}.` : 'Source selection was cancelled.';
        render();
        queueMicrotask(() => (root.querySelector('[data-conversion-source]') as HTMLElement | null)?.focus());
      }, (error) => {
        if (disposed || generation !== conversionGeneration || conversionCommandId !== commandId) return;
        conversionStatus = error instanceof Error ? error.message : String(error);
        render();
      });
    });
    root.querySelector('[data-conversion-run]')?.addEventListener('click', (event: Event) => {
      const command = conversionManifest?.commands.find((item) => item.id === conversionCommandId);
      if (!command || !services?.convert) return;
      if (command.direction === 'import' && conversionRequiresLocalSource(command) && !conversionSource) { conversionStatus = 'Choose a source file before importing.'; render(); return; }
      const current = session.snapshot();
      let conversionOptions: ConversionOptionValues;
      try {
        const optionScope = (event.currentTarget as HTMLElement).closest('[data-start-conversion-dialog]') as HTMLElement | null;
        const rawOptions = readConversionOptions(optionScope ?? root);
        const converter = conversionManifest?.converters.find((candidate) => candidate.id === command.converterId);
        conversionOptions = converter ? validateOptionValues(converter, rawOptions, command.optionNames) : rawOptions;
        const externalError = externalConversionConfigurationError(command, conversionOptions);
        if (externalError) { conversionStatus = externalError; render(); return; }
      }
      catch (error) { conversionStatus = error instanceof Error ? error.message : String(error); render(); return; }
      const generation = ++conversionGeneration;
      const requestId = `convert-${Date.now()}-${generation}`;
      conversionRequestId = requestId; conversionProgress = undefined; conversionResult = undefined; conversionStatus = 'Converting...'; render();
      const sourceName = command.direction === 'import'
        ? conversionRequiresLocalSource(command) ? conversionSource!.name : `${command.sourceFormat}-external-service`
        : current.uri.replace(/^.*[\\/]/, '') || 'schema.struct.json';
      const sourceText = command.direction === 'import'
        ? conversionRequiresLocalSource(command) ? conversionSource!.text : ''
        : current.text;
      void services.convert({ protocolVersion: PROTOCOL_VERSION, requestId, kind: 'conversion', documentVersion: current.documentVersion, commandId: command.id, sourceName, sourceText, options: conversionOptions }).then(async (result) => {
        if (disposed || generation !== conversionGeneration || conversionRequestId !== requestId) return;
        conversionRequestId = undefined; conversionProgress = undefined;
        conversionResult = result;
        conversionStatus = result.succeeded ? `Generated ${result.outputs.length} output${result.outputs.length === 1 ? '' : 's'}.` : result.diagnostics.map((diagnostic) => diagnostic.message).join(' ');
        if (result.succeeded && command.defaultAutoOpen && services.openGeneratedOutput) {
          try {
            await services.openGeneratedOutput({ protocolVersion: PROTOCOL_VERSION, requestId: `open-${Date.now()}`, kind: 'open-generated-output', outputs: result.outputs });
          } catch (error) {
            if (generation !== conversionGeneration) return;
            conversionStatus = error instanceof Error ? error.message : String(error);
          }
        }
        if (generation !== conversionGeneration) return;
        render();
        queueMicrotask(() => (root.querySelector('[data-conversion-run]') as HTMLElement | null)?.focus());
      }, (error) => {
        if (disposed || generation !== conversionGeneration || conversionRequestId !== requestId) return;
        conversionRequestId = undefined;
        conversionProgress = undefined;
        conversionStatus = error instanceof Error ? error.message : String(error);
        render();
        queueMicrotask(() => (root.querySelector('[data-conversion-run]') as HTMLElement | null)?.focus());
      });
    });
    root.querySelector('[data-conversion-cancel]')?.addEventListener('click', () => {
      if (!conversionRequestId || !services?.cancelConversion) return;
      const requestId = conversionRequestId;
      const generation = conversionGeneration;
      conversionStatus = 'Cancelling...'; render();
      void services.cancelConversion(requestId).catch((error) => {
        if (generation !== conversionGeneration || conversionRequestId !== requestId) return;
        conversionStatus = error instanceof Error ? error.message : String(error);
        render();
      });
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
    if (graphGeometryFrame !== undefined) {
      window.cancelAnimationFrame(graphGeometryFrame);
      graphGeometryFrame = undefined;
    }
    const suppressedGraphClicks = new Set<string>();
    const focusGraphNode = (nodeId: string): void => {
      const view = semanticGraph.selectNode(nodeId);
      selectedPointer = view.selection?.pointer ?? undefined;
      render();
      queueMicrotask(() => (root.querySelector(`[data-graph-node="${cssAttributeValue(nodeId)}"]`) as SVGElement | null)?.focus());
    };
    const adjacentGraphNode = (nodeId: string, direction: 'incoming' | 'outgoing' | 'left' | 'right' | 'up' | 'down'): string | undefined => {
      const edges = graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
      const directional = direction === 'incoming'
        ? edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from)
        : direction === 'outgoing'
          ? edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to)
          : edges.map((edge) => edge.from === nodeId ? edge.to : edge.from);
      const unique = [...new Set(directional)].filter((id) => graphLayout.position(id));
      if (direction === 'incoming' || direction === 'outgoing') return unique.sort()[0];
      const origin = graphLayout.position(nodeId);
      if (!origin) return unique.sort()[0];
      const originCenter = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 };
      return unique.map((id) => {
        const position = graphLayout.position(id)!;
        const delta = { x: position.x + position.width / 2 - originCenter.x, y: position.y + position.height / 2 - originCenter.y };
        const valid = direction === 'left' ? delta.x < 0 : direction === 'right' ? delta.x > 0 : direction === 'up' ? delta.y < 0 : delta.y > 0;
        return { id, valid, distance: Math.hypot(delta.x, delta.y) };
      }).filter((candidate) => candidate.valid).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0]?.id;
    };
    root.querySelectorAll('[data-graph-select]').forEach((target: SVGElement) => {
      const activate = (): void => {
        const nodeId = target.dataset.graphNode;
        if (!nodeId) return;
        const view = semanticGraph.selectNode(nodeId);
        selectedPointer = view.selection?.pointer ?? undefined;
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
        selectedPointer = view.selection?.pointer ?? undefined;
        mode = 'graph';
        lastRepresentationMode = 'graph';
        fitGraphAfterRender = true;
        render();
      });
      target.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const nodeId = target.dataset.graphNode;
          const adjacent = nodeId ? adjacentGraphNode(nodeId, event.key === 'ArrowLeft' ? 'incoming' : 'outgoing') : undefined;
          if (adjacent) focusGraphNode(adjacent);
        } else if (event.key.startsWith('Arrow')) {
          const spatialDirection = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'];
          if (!spatialDirection) return;
          event.preventDefault();
          const nodeId = target.dataset.graphNode;
          const adjacent = nodeId ? adjacentGraphNode(nodeId, spatialDirection) : undefined;
          if (adjacent) focusGraphNode(adjacent);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const nodeId = target.dataset.graphNode;
          if (!nodeId) return;
          semanticGraph.openNode(nodeId);
          fitGraphAfterRender = true;
          render();
        } else if (event.key === ' ') { event.preventDefault(); activate(); }
      });
    });
    root.querySelectorAll('[data-graph-direction]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const direction = button.dataset.graphDirection;
      if (direction !== 'outgoing' && direction !== 'incoming' && direction !== 'both') return;
      semanticGraph.setDirection(direction);
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelectorAll('[data-graph-hop]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const hops = Number(button.dataset.graphHop);
      if (hops !== 1 && hops !== 2) return;
      semanticGraph.setNeighborhoodHops(hops);
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelector('[data-graph-isolate]')?.addEventListener('click', (event: Event) => {
      semanticGraph.setNeighborhoodIsolation((event.currentTarget as HTMLButtonElement).getAttribute('aria-pressed') !== 'true');
      fitGraphAfterRender = true;
      render();
    });
    root.querySelectorAll('[data-graph-edge-select]').forEach((target: SVGElement) => {
      const activate = (): void => {
        const edgeId = target.dataset.graphEdgeSelect;
        if (!edgeId) return;
        const view = semanticGraph.selectEdge(edgeId);
        selectedPointer = view.selection?.pointer ?? undefined;
        render();
      };
      target.addEventListener('click', activate);
      target.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    });
    root.querySelectorAll('[data-graph-lens]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const view = semanticGraph.setLens(button.dataset.graphLens as import('../graph.js').ProjectionId);
      selectedPointer = view.selection?.pointer ?? undefined;
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelectorAll('[data-graph-layer]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const preset = button.dataset.graphLayer;
      if (preset !== 'relations' && preset !== 'inheritance' && preset !== 'data-shape' && preset !== 'imports' && preset !== 'diagnostics' && preset !== 'everything') return;
      graphLayerPreset = preset;
      canvas?.setAttribute('data-layer-preset', preset);
      root.querySelectorAll('[data-graph-layer]').forEach((candidate: HTMLElement) => candidate.setAttribute('aria-pressed', String(candidate.dataset.graphLayer === preset)));
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
    root.querySelectorAll('[data-graph-matrix-sort]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const column = button.dataset.graphMatrixSort as import('./semantic-graph.js').GraphRelationMatrixSort | undefined;
      if (!column) return;
      semanticGraph.sortRelationMatrix(column);
      render();
    }));
    root.querySelectorAll('[data-graph-matrix-page]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const direction = button.dataset.graphMatrixPage;
      if (direction !== 'previous' && direction !== 'next') return;
      const view = semanticGraph.view();
      semanticGraph.moveRelationMatrixWindow(view.relationMatrixOffset + (direction === 'next' ? 200 : -200));
      render();
    }));
    root.querySelectorAll('[data-graph-breadcrumb]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const level = button.dataset.graphBreadcrumb;
      if (level === 'atlas') semanticGraph.home();
      else if (level === 'types' && semanticGraph.view().location.level === 'neighborhood') semanticGraph.drillOut();
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelector('[data-graph-fit]')?.addEventListener('click', () => { graphNavigation.fit(graphFocusBounds(graph, graphLayout)); updateGraphCamera(); });
    root.querySelector('[data-graph-reveal]')?.addEventListener('click', () => {
      const selectionId = semanticGraph.view().selection?.nodeId as string | undefined;
      const node = selectionId ? graphLayout.position(selectionId) : undefined;
      const edge = selectionId ? graph.edges.find((candidate) => candidate.id === selectionId) : undefined;
      if (node) graphNavigation.reveal(node);
      else if (edge) {
        const from = graphLayout.position(edge.from);
        const to = graphLayout.position(edge.to);
        if (from && to) graphNavigation.reveal({
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
          width: Math.max(from.x + from.width, to.x + to.width) - Math.min(from.x, to.x),
          height: Math.max(from.y + from.height, to.y + to.height) - Math.min(from.y, to.y),
        });
      }
      updateGraphCamera();
    });
    root.querySelector('[data-graph-fit-all]')?.addEventListener('click', () => {
      if (semanticGraph.view().location.level !== 'atlas') {
        semanticGraph.home();
        fitGraphAfterRender = true;
        render();
      } else {
        graphNavigation.fit();
        updateGraphCamera();
      }
    });
    root.querySelector('[data-graph-reset-view]')?.addEventListener('click', () => {
      graphNavigation.setCamera({ x: 0, y: 0, zoom: 1 });
      updateGraphCamera();
    });
    root.querySelector('[data-graph-zoom-out]')?.addEventListener('click', () => zoomGraphAtCenter(-0.1));
    root.querySelector('[data-graph-zoom-in]')?.addEventListener('click', () => zoomGraphAtCenter(0.1));
    root.querySelector('[data-graph-relayout]')?.addEventListener('click', () => {
      graphLayout.relayout();
      if (prefersReducedMotion()) graphLayout.settle();
    });
    root.querySelector('[data-graph-back]')?.addEventListener('click', () => { const view = semanticGraph.back(); selectedPointer = view.selection?.pointer ?? undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-forward]')?.addEventListener('click', () => { const view = semanticGraph.forward(); selectedPointer = view.selection?.pointer ?? undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-home]')?.addEventListener('click', () => { const view = semanticGraph.home(); selectedPointer = view.selection?.pointer ?? undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-out]')?.addEventListener('click', () => { const view = semanticGraph.drillOut(); selectedPointer = view.selection?.pointer ?? undefined; fitGraphAfterRender = true; render(); });
    root.querySelector('[data-graph-open-selection]')?.addEventListener('click', () => { const view = semanticGraph.openSelection(); selectedPointer = view.selection?.pointer ?? undefined; fitGraphAfterRender = true; render(); });
    root.querySelectorAll('[data-graph-add-relation]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      selectedPointer = button.dataset.graphAddRelation;
      relationDraftOpen = true;
      mode = 'design';
      lastRepresentationMode = 'design';
      render();
    }));
    root.querySelectorAll('[data-graph-edit-relation]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.graphEditRelation;
      const action = actionById('relation.edit');
      if (!pointer || !action) return;
      showActionEditor(root, action, pointer, session, catalogRegistry, applyCommand);
    }));
    root.querySelectorAll('[data-graph-delete-relation]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.graphDeleteRelation;
      const action = actionById('relation.delete');
      if (!pointer || !action) return;
      void applyCommand(action.create(pointer, undefined));
    }));
    root.querySelectorAll('[data-graph-edit-reference]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const pointer = button.dataset.graphEditReference;
      if (!pointer) return;
      selectedPointer = graphReferenceEditPointer(pointer);
      expandedPropertyPointer = selectedPointer.includes('/properties/') ? selectedPointer : expandedPropertyPointer;
      mode = 'design';
      lastRepresentationMode = 'design';
      render();
    }));
    root.querySelectorAll('[data-graph-history]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      const view = semanticGraph.restore(Number(button.dataset.graphHistory));
      selectedPointer = view.selection?.pointer ?? undefined;
      fitGraphAfterRender = true;
      render();
    }));
    root.querySelector('.js-graph-toolbar')?.addEventListener('wheel', (event: Event) => event.preventDefault(), { passive: false });
    const canvas = root.querySelector('[data-graph-canvas]') as SVGElement | null;
    if (!canvas) return;
    canvas.dataset.layerPreset = graphLayerPreset;
    root.querySelectorAll('[data-graph-layer]').forEach((candidate: HTMLElement) => candidate.setAttribute('aria-pressed', String(candidate.dataset.graphLayer === graphLayerPreset)));
    const graphWorld = canvas.querySelector('[data-graph-world]') as SVGElement | null;
    const updateGraphCamera = (): void => {
      const state = graphNavigation.snapshot();
      graphWorld?.setAttribute('transform', `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.zoom})`);
      const readout = root.querySelector('[data-semantic-zoom]');
      if (readout) {
        readout.textContent = `${Math.round(state.camera.zoom * 100)}%`;
        readout.setAttribute('data-semantic-zoom', state.semanticZoom);
      }
      canvas.dataset.semanticZoom = state.semanticZoom;
      const nodeFontSize = Math.min(18, Math.max(10, 12 / state.camera.zoom));
      const metadataFontSize = Math.min(15, Math.max(8, 9 / state.camera.zoom));
      const edgeFontSize = Math.min(14, Math.max(8, 9 / state.camera.zoom));
      ([...canvas.querySelectorAll('.js-node>text:not(.js-node-meta)')] as SVGElement[]).forEach((label) => label.setAttribute('font-size', String(nodeFontSize)));
      ([...canvas.querySelectorAll('.js-node-meta')] as SVGElement[]).forEach((label) => label.setAttribute('font-size', String(metadataFontSize)));
      ([...canvas.querySelectorAll('.js-edge-label')] as SVGElement[]).forEach((label) => label.setAttribute('font-size', String(edgeFontSize)));
      const bounds = graphLayout.contentBounds();
      const minimap = graphNavigation.minimap();
      const viewport = clampMinimapViewport(minimap.viewport, bounds.width, bounds.height);
      const viewportElement = root.querySelector('.js-minimap-viewport');
      viewportElement?.setAttribute('x', String(viewport.x));
      viewportElement?.setAttribute('y', String(viewport.y));
      viewportElement?.setAttribute('width', String(viewport.width));
      viewportElement?.setAttribute('height', String(viewport.height));
    };
    const updateGraphGeometryNow = (): void => {
      const positions = new Map(graphLayout.positions().map((position) => [position.id, position]));
      ([...canvas.querySelectorAll('[data-graph-node]')] as SVGElement[]).forEach((element) => {
        const id = element.dataset.graphNode;
        const position = id ? positions.get(id) : undefined;
        if (!position) return;
        element.setAttribute('transform', `translate(${position.x} ${position.y})`);
        element.dataset.graphPinned = String(position.pinned);
      });
      const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
      const labelRuntime = new GraphRuntime({
        nodes: [...positions.values()].map((position) => ({ id: position.id, position: { x: position.x + position.width / 2, y: position.y + position.height / 2 }, width: position.width, height: position.height })),
        edges: graph.edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to)).map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label })),
      });
      const labelLanes = new Map(labelRuntime.assignEdgeLabelLanes().map((lane) => [lane.edgeId, lane.lane]));
      ([...canvas.querySelectorAll('[data-graph-edge]')] as SVGElement[]).forEach((element) => {
        const edge = edges.get(element.dataset.graphEdge ?? '');
        const owningRelation = edge?.kind === 'relation-qualifier' && edge.relationPointer
          ? graph.edges.find((candidate) => candidate.kind === 'relation' && candidate.relationPointer === edge.relationPointer)
          : undefined;
        const geometryEdge = owningRelation ?? edge;
        const from = geometryEdge ? positions.get(geometryEdge.from) : undefined;
        const to = geometryEdge ? positions.get(geometryEdge.to) : undefined;
        if (!from || !to) return;
        const lane = edge ? labelLanes.get(edge.id) ?? Number(element.dataset.graphLabelLane ?? '0') : 0;
        element.dataset.graphLabelLane = String(lane);
        const geometry = graphEdgePath(from, to, Number.isFinite(lane) ? lane : 0);
        ([...element.querySelectorAll('.js-edge-hit-target,.js-edge')] as SVGElement[]).forEach((path) => path.setAttribute('d', geometry.path));
        ([...element.querySelectorAll('.js-qualifier-hit-target,.js-qualifier-marker')] as SVGElement[]).forEach((marker) => {
          marker.setAttribute('cx', String(geometry.labelX));
          marker.setAttribute('cy', String(geometry.labelY));
        });
        const label = element.querySelector('text');
        label?.setAttribute('x', String(geometry.labelX));
        label?.setAttribute('y', String(geometry.labelY));
      });
      const minimapPositions = new Map(graphMinimapLayout.positions().map((position) => [position.id, position]));
      const content = graphMinimapLayout.contentBounds();
      ([...root.querySelectorAll('[data-minimap-node]')] as SVGElement[]).forEach((element) => {
        const position = minimapPositions.get(element.dataset.minimapNode ?? '');
        if (!position) return;
        element.setAttribute('x', String(position.x / content.width * 180));
        element.setAttribute('y', String(position.y / content.height * 120));
      });
      updateGraphCamera();
    };
    const requestGraphGeometryUpdate = (): void => {
      if (graphGeometryFrame !== undefined) return;
      graphGeometryFrame = window.requestAnimationFrame(() => {
        graphGeometryFrame = undefined;
        if (!disposed && canvas.isConnected) updateGraphGeometryNow();
      });
    };
    const flushGraphGeometry = (): void => {
      if (graphGeometryFrame !== undefined) {
        window.cancelAnimationFrame(graphGeometryFrame);
        graphGeometryFrame = undefined;
      }
      if (!disposed && canvas.isConnected) updateGraphGeometryNow();
    };
    graphLayout.setTickListener(requestGraphGeometryUpdate);
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
          flushGraphGeometry();
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
      else if (event.key === 'Enter') { event.preventDefault(); const view = semanticGraph.openSelection(); selectedPointer = view.selection?.pointer ?? undefined; fitGraphAfterRender = true; render(); }
      else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const selected = semanticGraph.view().selection?.nodeId as string | undefined;
        const adjacent = selected ? adjacentGraphNode(selected, event.key === 'ArrowLeft' ? 'incoming' : 'outgoing') : undefined;
        if (adjacent) focusGraphNode(adjacent);
      }
      else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); graphNavigation.fit(graphFocusBounds(graph, graphLayout)); updateGraphCamera(); }
      else if (event.key === 'Escape' && semanticGraph.view().canDrillOut) { event.preventDefault(); semanticGraph.drillOut(); fitGraphAfterRender = true; render(); }
    });
    const minimapElement = root.querySelector('[data-minimap]');
    let minimapDragging = false;
    let minimapMoved = false;
    const navigateMinimapPointer = (event: PointerEvent): void => {
      const target = minimapElement as SVGElement;
      const bounds = target.getBoundingClientRect();
      graphNavigation.navigateMinimap({ x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 180, y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 120 }, { x: 0, y: 0, width: 180, height: 120 });
      updateGraphCamera();
    };
    minimapElement?.addEventListener('pointerdown', (event: Event) => {
      const pointer = event as PointerEvent;
      if (!(pointer.target as SVGElement).closest('[data-minimap-viewport]')) return;
      pointer.preventDefault();
      minimapDragging = true;
      minimapMoved = false;
      (minimapElement as SVGElement).setPointerCapture(pointer.pointerId);
    });
    minimapElement?.addEventListener('pointermove', (event: Event) => {
      const pointer = event as PointerEvent;
      if (!minimapDragging || !(minimapElement as SVGElement).hasPointerCapture(pointer.pointerId)) return;
      pointer.preventDefault();
      minimapMoved = true;
      navigateMinimapPointer(pointer);
    });
    const releaseMinimap = (event: Event): void => {
      const pointer = event as PointerEvent;
      minimapDragging = false;
      if ((minimapElement as SVGElement | null)?.hasPointerCapture(pointer.pointerId)) (minimapElement as SVGElement).releasePointerCapture(pointer.pointerId);
    };
    minimapElement?.addEventListener('pointerup', releaseMinimap);
    minimapElement?.addEventListener('pointercancel', releaseMinimap);
    minimapElement?.addEventListener('click', (event: Event) => {
      if (minimapMoved) {
        minimapMoved = false;
        return;
      }
      navigateMinimapPointer(event as PointerEvent);
    });
    minimapElement?.addEventListener('dblclick', (event: Event) => {
      event.preventDefault();
      if (semanticGraph.view().location.level !== 'atlas') {
        semanticGraph.home();
        fitGraphAfterRender = true;
        render();
      } else {
        graphNavigation.fit();
        updateGraphCamera();
      }
    });
    minimapElement?.addEventListener('wheel', (event: Event) => {
      const wheel = event as WheelEvent;
      wheel.preventDefault();
      navigateMinimapPointer(wheel as unknown as PointerEvent);
      const bounds = syncViewport();
      graphNavigation.wheelZoom({ x: bounds.width / 2, y: bounds.height / 2 }, wheel.deltaY);
      if (!transitionSemanticLevel(wheel.deltaY < 0 ? 'in' : 'out')) updateGraphCamera();
    }, { passive: false });
    if (fitGraphAfterRender) {
      fitGraphAfterRender = false;
      graphNavigation.fit(graphFocusBounds(graph, graphLayout));
    }
    flushGraphGeometry();
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
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
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
  const undo = (): void => {
    if (sourceEditor && (mode === 'source' || sourceEditor.hasTextFocus())) {
      sourceEditor.trigger('json-structure', 'undo', null);
      return;
    }
    const before = session.snapshot();
    const after = session.undo();
    if (after === before) return;
    selectedPointer = selectFallback(after, selectedPointer);
    render();
    options.onChange?.(after.text, after);
  };
  const redo = (): void => {
    if (sourceEditor && (mode === 'source' || sourceEditor.hasTextFocus())) {
      sourceEditor.trigger('json-structure', 'redo', null);
      return;
    }
    const before = session.snapshot();
    const after = session.redo();
    if (after === before) return;
    selectedPointer = selectFallback(after, selectedPointer);
    render();
    options.onChange?.(after.text, after);
  };
  const markSaved = (documentVersion = session.snapshot().documentVersion): void => {
    if (documentVersion === session.snapshot().documentVersion) session.markSaved();
  };
  const markClean = (): void => { session.markClean(); };
  const isSourceEditorFocused = (): boolean => mode === 'source' && sourceEditor !== undefined;
  return { setText, acknowledgeText, setTitle, setUri, getText: () => session.snapshot().text, get dirty() { return session.dirty; }, get canUndo() { return session.canUndo; }, get canRedo() { return session.canRedo; }, isSourceEditorFocused, undo, redo, markSaved, markClean, showCommandPalette, dispose: () => { disposed = true; instanceSourceGeneration += 1; conversionGeneration += 1; unsubscribeConversionProgress?.(); unsubscribeSemanticGraph(); if (synchronizedRender) clearTimeout(synchronizedRender); if (pendingGraphActivation) clearTimeout(pendingGraphActivation.timer); if (graphGeometryFrame !== undefined) window.cancelAnimationFrame(graphGeometryFrame); graphResizeObserver?.disconnect(); graphLayout.dispose(); graphMinimapLayout.dispose(); releaseDrawerTrap(); setCompactDrawerModal(root); window.removeEventListener('keydown', onKeyDown); disposeSourceModel(); container.innerHTML = ''; } };
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
  const sourcePicker = selected?.direction === 'import' ? conversionSourceControl(host, selected, source) : '';
  const commandOptions = selected && converter ? conversionOptionsForCommand(converter, selected) : [];
  const configuration = selected ? `<section class="js-conversion-config"><div class="js-conversion-route"><div><span>From</span><strong>${escapeHtml(selected.sourceFormat)}</strong></div><span class="js-conversion-arrow" aria-hidden="true">${fluentIcon('arrowRight')}</span><div><span>To</span><strong>${escapeHtml(selected.targetFormat)}</strong></div></div>${sourcePicker}<fieldset><legend>Options</legend>${commandOptions.map(conversionOptionControl).join('') || '<p class="js-description">This converter has no options.</p>'}</fieldset><button data-conversion-run ${requestId || selected.direction === 'import' && conversionRequiresLocalSource(selected) && !source ? 'disabled' : ''} class="js-primary">${escapeHtml(conversionCommandAction(selected))}</button></section>` : '';
  return `<div class="js-sheet js-conversion-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Toolchain</div><h1>Convert</h1><p class="js-description">Choose an outcome, review its options, and write generated files to a directory you approve.</p></div><div class="js-actions"><button data-conversion-reset>Reset to defaults</button>${manifest ? '<button data-conversion-load title="Refresh conversion tools">Refresh</button>' : ''}</div></header>${manifest ? `<div class="js-conversion-layout"><div class="js-conversion-catalog">${commandGroups || '<p class="js-description">No conversion commands are installed.</p>'}</div>${configuration}</div>` : '<div class="js-conversion-loading" role="status">Loading conversion tools...</div>'}${progressView}<p role="status" aria-live="polite">${escapeHtml(status)}</p>${review}${result ? `<section><div class="js-section-head"><h2>Outputs (${result.outputs.length})</h2>${result.outputs.length && host.openGeneratedOutput ? '<button data-conversion-open>Open outputs</button>' : ''}</div>${outputs || '<p class="js-description">No output files were committed.</p>'}</section><section><h2>Diagnostics (${result.diagnostics.length})</h2>${diagnostics || '<p class="js-description">No conversion warnings or errors.</p>'}</section>` : ''}</div>`;
}

function startConversionDialog(host: EditorServices | undefined, manifest: ConversionCommandsManifest, commandId: string | undefined, source: ConversionSource | undefined, result: ConversionResult | undefined, status: string, progress?: ProgressEvent, requestId?: string): string {
  const selected = directStructurizeImportCommands(manifest).find((command) => command.id === commandId);
  if (!selected) return `<dialog class="js-start-conversion-dialog" data-start-conversion-dialog open><div class="js-start-conversion-dialog-head"><strong>Import existing schema or data</strong><button type="button" data-start-conversion-close aria-label="Close">${fluentIcon('dismiss')}</button></div><p class="js-description">Loading conversion options...</p></dialog>`;
  const converter = manifest.converters.find((candidate) => candidate.id === selected.converterId);
  const options = converter ? conversionOptionsForCommand(converter, selected) : [];
  const progressView = requestId ? `<div class="js-section-head"><progress max="100" value="${progress?.percent ?? 0}" aria-label="Conversion progress"></progress>${host?.cancelConversion ? '<button data-conversion-cancel>Cancel</button>' : ''}</div>` : '';
  const outputs = result?.outputs.map((output) => `<div class="js-analysis-row"><span>${escapeHtml(output.name)}</span><span class="js-code">${escapeHtml(output.uri)}</span></div>`).join('') ?? '';
  const diagnostics = result?.diagnostics.map((diagnostic) => `<div class="js-problem"><span class="js-problem-${diagnostic.severity}">${fluentIcon(diagnostic.severity === 'error' ? 'errorCircle' : 'warning')}</span><span>${escapeHtml(diagnostic.message)}</span></div>`).join('') ?? '';
  return `<dialog class="js-start-conversion-dialog" data-start-conversion-dialog data-start-command="${escapeAttribute(selected.id)}" open><div class="js-start-conversion-dialog-head"><span class="js-format-icon" data-format="${escapeAttribute(selected.sourceFormat)}" aria-hidden="true">${technologyIcon(selected.sourceFormat)}</span><span><strong>${escapeHtml(selected.label)}</strong><small>${escapeHtml(selected.cliCommand ?? selected.sourceFormat)}</small></span><button type="button" data-start-conversion-close aria-label="Close">${fluentIcon('dismiss')}</button></div><div class="js-start-conversion-dialog-body">${conversionSourceControl(host, selected, source)}<fieldset><legend>Import options</legend>${options.map(conversionOptionControl).join('') || '<p class="js-description">This importer has no options.</p>'}</fieldset><button data-conversion-run ${requestId || conversionRequiresLocalSource(selected) && !source ? 'disabled' : ''} class="js-primary">${escapeHtml(conversionCommandAction(selected))}</button>${progressView}<p class="js-action-status" role="status" aria-live="polite">${escapeHtml(status)}</p>${result ? `<section><div class="js-section-head"><h2>Outputs (${result.outputs.length})</h2>${result.outputs.length && host?.openGeneratedOutput ? '<button data-conversion-open>Open outputs</button>' : ''}</div>${outputs}${diagnostics}</section>` : ''}</div></dialog>`;
}

function conversionRequiresLocalSource(command: ConversionCommand): boolean {
  return command.direction === 'import' && command.availability !== 'external-service';
}

function conversionSourceControl(host: EditorServices | undefined, command: ConversionCommand, source: ConversionSource | undefined): string {
  if (command.availability === 'external-service') {
    return `<div class="js-conversion-source js-conversion-external-source"><span>External data source</span><strong>${escapeHtml(conversionFormatName(command.sourceFormat))}</strong><small>${escapeHtml(command.availabilityMessage ?? 'Configure the required connection options below.')}</small></div>`;
  }
  return `<div class="js-conversion-source"><span>Source file</span><strong>${escapeHtml(source?.name ?? 'No file selected')}</strong><button data-conversion-source ${host?.selectConversionSource ? '' : 'disabled'}>${source ? 'Change' : 'Choose file'}</button></div>`;
}

function externalConversionConfigurationError(command: ConversionCommand, options: ConversionOptionValues): string | undefined {
  if (command.cliCommand !== 'k2s') return undefined;
  const cluster = typeof options.kusto_uri === 'string' ? options.kusto_uri.trim() : '';
  const database = typeof options.kusto_database === 'string' ? options.kusto_database.trim() : '';
  const table = typeof options.table_name === 'string' ? options.table_name.trim() : '';
  if (!cluster || !database || !table) return 'Kusto import requires a cluster URI, database, and table.';
  try {
    const uri = new URL(cluster);
    if (uri.protocol !== 'https:') return 'Kusto cluster URI must use HTTPS.';
  } catch {
    return 'Kusto cluster URI must be an absolute HTTPS URI.';
  }
  return undefined;
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
  readonly root?: boolean;
}

interface TypeTreeNamespace {
  readonly label: string;
  readonly path: string;
  pointer?: string;
  readonly children: Map<string, TypeTreeNamespace>;
  readonly types: TypeTreeItem[];
}

function renderTypeTree(definitions: readonly TypeTreeItem[], namespaces: readonly string[], selectedPointer: string | undefined): string {
  const root: TypeTreeNamespace = { label: 'Definitions', path: '', children: new Map(), types: [] };
  const addNamespace = (segments: readonly string[], pointer?: string): TypeTreeNamespace => {
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
    if (pointer) namespace.pointer = pointer;
    return namespace;
  };
  for (const pointer of namespaces) addNamespace(namespaceTreeSegments(pointer), pointer);
  for (const definition of definitions) {
    const namespace = addNamespace(namespaceTreeSegments(definition.namespace));
    namespace.types.push(definition);
  }
  const renderType = (item: TypeTreeItem): string => `<div class="js-tree-type-row"><button role="treeitem" class="js-tree-item${item.imported ? ' js-tree-item-imported' : ''}" ${item.imported ? `data-effective-source="${escapeAttribute(item.sourcePointer ?? '')}" data-effective-document="${escapeAttribute(item.documentUri ?? '')}" title="Imported from ${escapeAttribute(item.documentUri ?? '')}${escapeAttribute(item.sourcePointer ? `#${item.sourcePointer}` : '')}"` : `data-select="${escapeAttribute(item.pointer)}"`} data-type-drag="${escapeAttribute(item.pointer)}" draggable="true" aria-current="${selectedPointer === item.pointer}"><span class="js-kind" aria-hidden="true">${fluentIcon('cube')}</span><span>${escapeHtml(item.name)}</span>${item.imported ? '<small>imported</small>' : ''}</button><label class="js-tree-root-toggle" title="Use as document root"><input type="checkbox" data-root-toggle="${escapeAttribute(item.pointer)}" ${item.root ? 'checked' : ''} aria-label="Use ${escapeAttribute(item.name)} as document root"><span aria-hidden="true">✓</span></label></div>`;
  const renderNamespace = (namespace: TypeTreeNamespace): string => {
    const children = [...namespace.children.values()].sort((left, right) => left.label.localeCompare(right.label)).map(renderNamespace).join('');
    const types = [...namespace.types].sort((left, right) => left.name.localeCompare(right.name)).map(renderType).join('');
    if (!namespace.path) {
      const rootNamespace = namespaces.includes('/definitions')
        ? `<button role="treeitem" class="js-tree-item js-tree-root-namespace" data-select="/definitions" aria-current="${selectedPointer === '/definitions'}"><span class="js-kind" aria-hidden="true">${fluentIcon('collections')}</span><span>Root namespace</span><small>${namespace.types.length + namespace.children.size}</small></button>`
        : '';
      return `${rootNamespace}${types}${children}`;
    }
    const label = namespace.pointer
      ? `<button type="button" class="js-tree-namespace-label" data-select="${escapeAttribute(namespace.pointer)}" aria-current="${selectedPointer === namespace.pointer}">${escapeHtml(namespace.label)}</button>`
      : `<span>${escapeHtml(namespace.label)}</span>`;
    return `<details class="js-tree-namespace" data-namespace-pointer="${escapeAttribute(namespace.pointer ?? '')}" open><summary><span class="js-tree-chevron">${fluentIcon('chevronRight')}</span>${label}<small>${namespace.types.length + namespace.children.size}</small></summary><div role="group">${types}${children}</div></details>`;
  };
  return renderNamespace(root) || '<div class="js-empty js-tree-empty">No definitions yet.</div>';
}

function namespaceTreeSegments(pointer: string): readonly string[] {
  return pointer.split('/').filter(Boolean).map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~')).filter((token) => token !== 'definitions');
}

function structuredWorkbenchShell(snapshot: DocumentSnapshot, title: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly namespace: string; readonly identity?: readonly string[]; readonly imported?: boolean; readonly documentUri?: string; readonly sourcePointer?: string; readonly root?: boolean }[], definitionPointer: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, mode: Mode, problemsOpen: boolean, memberMode: DesignMemberMode, effectiveMembers: EffectiveMembersResult | undefined, expandedPropertyPointer: string | undefined, chrome: NonNullable<JsonStructureEditorOptions['chrome']> = 'document', pendingPropertyFields: ReadonlySet<string> = new Set(), relationDraftOpen = false, typeCreatorOpen = false): string {
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
  const typeTree = renderTypeTree(definitions, namespacePointers(documentValue, definitions.map((definition) => definition.pointer)), selectedPointer);
  const activeDeclaration = definitionPointer !== undefined ? valueAtPointer(documentValue, definitionPointer) : undefined;
  const activeType = definition?.type ?? (isRecord(activeDeclaration) && typeof activeDeclaration.type === 'string' ? activeDeclaration.type : undefined);
  const activeDescription = definition?.description ?? (isRecord(activeDeclaration) && typeof activeDeclaration.description === 'string' ? activeDeclaration.description : undefined);
  const activeName = definition?.name;
  const activeIdentity = definition?.identity ?? [];
  const activeRelations = definition?.relations ?? [];
  const inlineRootEntry = isInlineRootSchema(documentValue)
    ? `<button role="treeitem" class="js-tree-item js-tree-inline-root" data-select="" aria-current="${selectedPointer === ''}"><span class="js-kind" aria-hidden="true">${fluentIcon('document')}</span><span>Inline root</span><small>root</small></button>`
    : '';
  const activities = primaryModes.map((item) => `<button class="js-activity-button" data-mode="${item.mode}" aria-label="${item.label}" title="${item.label}" aria-pressed="${mode === item.mode}">${fluentIcon(item.icon)}</button>`).join('');
  const schemaUri = isSchemaRecord(documentValue) && typeof documentValue.$schema === 'string' ? documentValue.$schema : '';
  const documentId = isSchemaRecord(documentValue) && typeof documentValue.$id === 'string' ? documentValue.$id : '';
  const schemaStrip = documentMetadataView(documentValue, definitions, schemaUri, documentId);
  const titleChrome = workbenchTitleChrome(title, chrome);
  return `<div class="js-shell js-chrome-${chrome}">
    ${titleChrome}
    <div class="js-document-toolbar" role="toolbar" aria-label="Document status"><button class="js-mobile-toggle" data-mobile-drawer="types" aria-controls="js-outline" aria-haspopup="dialog" aria-expanded="false" ${mode === 'design' || mode === 'graph' ? '' : 'hidden'}>Types</button><span class="js-chip">${escapeHtml(profile.mode)}</span>${activeCompanions ? `<span class="js-chip">${activeCompanions} companions</span>` : ''}<span class="js-spacer"></span><button class="js-mobile-toggle" data-mobile-drawer="inspector" aria-controls="js-inspector" aria-haspopup="dialog" aria-expanded="false" ${mode === 'design' ? '' : 'hidden'}>Inspector</button></div>
    <div class="js-workbench" data-problems-open="${problemsOpen}" data-active-mode="${mode}">
      <nav class="js-activity" aria-label="Editor modes">${activities}</nav>
      <aside class="js-outline" id="js-outline" data-drawer-panel="types" aria-label="Types"><div class="js-panel-head"><span>Types</span><span class="js-spacer"></span><button data-command="definition.add" title="Add type" aria-label="Add type">${fluentIcon('add')}</button><button data-library-open title="Import type library" aria-label="Import type library">${fluentIcon('library')}</button><button class="js-drawer-close" data-mobile-drawer-close aria-label="Close Types">${fluentIcon('dismiss')}</button></div><input class="js-filter" type="search" placeholder="Filter types" aria-label="Filter types"><div class="js-tree" role="tree" aria-label="Types by namespace"><div class="js-tree-group">${definitions.length} definitions${inlineRootEntry ? " · inline root" : ""}</div>${inlineRootEntry}${typeTree}</div></aside>
      <section class="js-center"><div class="js-editor-tab"><span class="js-kind" aria-hidden="true">${fluentIcon('document')}</span><span data-document-title>${escapeHtml(title)}</span></div>${schemaStrip}<section class="js-view" data-panel-mode="design" ${mode === 'design' ? '' : 'hidden'}>${designView(activeName, activeType, activeDescription, rows, selectedPointer, activeIdentity, activeRelations, memberMode, effectiveMembers, expandedPropertyPointer, definitions, documentValue, pendingPropertyFields, relationDraftOpen, typeCreatorOpen, definitionPointer, snapshot.model?.rootPointer === definitionPointer)}</section><section class="js-view js-graph" data-panel-mode="graph" ${mode === 'graph' ? '' : 'hidden'}>${graphView(snapshot, selectedPointer)}</section><section class="js-view js-source-view" data-panel-mode="source" ${mode === 'source' ? '' : 'hidden'}><div class="js-source" data-source aria-label="JSON source editor"></div></section></section>
      <aside class="js-inspector" id="js-inspector" data-drawer-panel="inspector" aria-label="Inspector"><div class="js-panel-head"><span>Inspector</span><span class="js-spacer"></span><button class="js-drawer-close" data-mobile-drawer-close aria-label="Close Inspector">${fluentIcon('dismiss')}</button></div>${inspector(selectedProperty, definition, selectedDiagnostics, selectedRelation)}</aside>
      <section class="js-problems" aria-label="Problems panel"><div class="js-problems-head"><button class="js-problems-tab" data-problems-toggle aria-controls="js-problem-list" aria-expanded="${problemsOpen}">Problems <span class="js-count">${snapshot.diagnostics.length}</span></button><span class="js-spacer"></span><button data-problems-toggle aria-controls="js-problem-list" aria-expanded="${problemsOpen}" aria-label="Close Problems">${fluentIcon('dismiss')}</button></div><div class="js-problem-list" id="js-problem-list" role="list">${problems(snapshot.diagnostics)}</div></section>
    </div>
    <footer class="js-status"><button data-problems-toggle aria-controls="js-problem-list" aria-expanded="${problemsOpen}" title="Toggle Problems"><span>${fluentIcon('errorCircle')}${errors}</span><span>${fluentIcon('warning')}${warnings}</span></button><span>JSON Structure ${escapeHtml(profile.mode)}</span><span class="js-spacer"></span><span>${definitions.length} type${definitions.length === 1 ? '' : 's'}</span><span>${documentStatus}</span></footer>
  </div>`;
}

function documentMetadataView(document: unknown, definitions: readonly TypeTreeItem[], schemaUri = '', documentId = ''): string {
  const value = isRecord(document) ? document : {};
  const name = typeof value.name === 'string' ? value.name : '';
  const description = typeof value.description === 'string' ? value.description : '';
  const canonical = WELL_KNOWN_META_SCHEMAS.find((item) => item.uri === schemaUri) ?? (schemaUri ? undefined : WELL_KNOWN_META_SCHEMAS[0]);
  const schemaOptions = WELL_KNOWN_META_SCHEMAS.map((item) => `<option value="${escapeAttribute(item.uri)}" ${item.uri === (canonical?.uri ?? WELL_KNOWN_META_SCHEMAS[0]!.uri) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
  const profile = resolveMetaSchemaCapabilityProfile(value);
  const baseline = resolveMetaSchemaCapabilityProfile({ $schema: canonical?.uri ?? schemaUri });
  const authoredUses = Array.isArray(value.$uses) ? value.$uses.filter((entry): entry is string => typeof entry === 'string') : [];
  const baselineUses = [...baseline.activeUses].sort();
  const editableUses = [...new Set([...profile.offeredUses, ...authoredUses])].filter((use) => !baseline.activeUses.has(use as never)).sort();
  const persistedUses = authoredUses.filter((use) => baseline.activeUses.has(use as never)).map((use) => `<input type="hidden" data-document-use-persist value="${escapeAttribute(use)}">`).join('');
  const includedUses = baselineUses.map((use) => `<span class="js-profile-use">${escapeHtml(use)} <small>included by profile</small></span>`).join('');
  const useChoices = editableUses.map((use) => `<label><input type="checkbox" data-document-use value="${escapeAttribute(use)}" ${authoredUses.includes(use) ? 'checked' : ''}>${escapeHtml(use)}</label>`).join('');
  const localDefinitions = definitions.filter((definition) => !definition.imported);
  const offers = documentOfferMap(value);
  const offerRows = Object.entries(offers).map(([offerName, offered]) => {
    const targets = typeof offered === 'string' ? [offered] : Array.isArray(offered) ? offered.filter((entry): entry is string => typeof entry === 'string') : [];
    const options = offerTargetOptions(localDefinitions, targets);
    return `<div class="js-offer-row" data-offer-row="${escapeAttribute(offerName)}"><input data-offer-name value="${escapeAttribute(offerName)}" aria-label="Offer name"><select data-offer-targets multiple size="${Math.min(4, Math.max(2, localDefinitions.length))}" aria-label="Types offered by ${escapeAttribute(offerName)}">${options}</select><button type="button" data-offer-remove aria-label="Remove offer ${escapeAttribute(offerName)}">${fluentIcon('dismiss')} Remove</button></div>`;
  }).join('');
  const addOfferOptions = offerTargetOptions(localDefinitions, []);
  return `<details class="js-document-metadata" open><summary>Document metadata</summary><div class="js-schema-strip" aria-label="Schema metadata">
    <label><span>Name</span><input data-document-member="name" data-document-action="core.name" value="${escapeAttribute(name)}" aria-label="Document name"></label>
    <div class="js-meta-schema-field"><label><span>Meta-schema</span><select data-meta-schema-select aria-label="Well-known meta-schema">${schemaOptions}<option value="__custom__" ${canonical ? '' : 'selected'}>Custom URI…</option></select></label><input data-meta-schema-custom data-document-member="$schema" data-document-action="core.schema" value="${escapeAttribute(canonical ? '' : schemaUri)}" placeholder="https://example.test/meta/#" aria-label="Custom meta-schema URI" ${canonical ? 'hidden disabled' : ''}></div>
    <label><span>Id</span><input data-document-member="$id" data-document-action="core.id" value="${escapeAttribute(documentId)}" aria-label="Schema id"></label>
    <label class="js-document-description"><span>Description</span><textarea data-document-member="description" data-document-action="core.description" rows="2" aria-label="Document description">${escapeHtml(description)}</textarea></label>
    <fieldset class="js-document-uses"><legend>$uses</legend>${persistedUses}${includedUses || '<span class="js-description">No capabilities are included by this profile.</span>'}${useChoices || '<span class="js-description">No optional capabilities are offered by this profile.</span>'}</fieldset>
    <fieldset class="js-document-offers"><legend>$offers</legend><div class="js-offer-list">${offerRows || '<span class="js-description">No add-ins are offered.</span>'}</div><div class="js-offer-add"><input data-offer-add-name placeholder="Feature name" aria-label="New offer name"><select data-offer-add-targets multiple size="${Math.min(4, Math.max(2, localDefinitions.length))}" aria-label="Types for new offer">${addOfferOptions}</select><button type="button" data-offer-add ${localDefinitions.length ? '' : 'disabled'}>${fluentIcon('add')} Add offer</button></div></fieldset>
    <span class="js-schema-status" data-document-member-status role="status" aria-live="polite"></span>
  </div></details>`;
}

function offerTargetOptions(definitions: readonly TypeTreeItem[], selected: readonly string[]): string {
  const references = new Set(definitions.map((definition) => `#${definition.pointer}`));
  return [
    ...definitions.map((definition) => {
      const reference = `#${definition.pointer}`;
      return `<option value="${escapeAttribute(reference)}" ${selected.includes(reference) ? 'selected' : ''}>${escapeHtml(definitionTypeLabel(definition.pointer))}</option>`;
    }),
    ...selected.filter((reference) => !references.has(reference)).map((reference) => `<option value="${escapeAttribute(reference)}" selected>${escapeHtml(reference)} (unresolved)</option>`)
  ].join('');
}

function documentOfferMap(document: unknown): Record<string, string | string[]> {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return {};
  const offers = (document as Record<string, unknown>).$offers;
  if (!offers || typeof offers !== 'object' || Array.isArray(offers)) return {};
  const result: Record<string, string | string[]> = {};
  for (const [name, offered] of Object.entries(offers)) {
    if (typeof offered === 'string') result[name] = offered;
    else if (Array.isArray(offered) && offered.every((entry) => typeof entry === 'string')) result[name] = offered;
  }
  return result;
}

export function workbenchTitleChrome(title: string, chrome: NonNullable<JsonStructureEditorOptions['chrome']>): string {
  if (chrome === 'embedded') return '';
  if (chrome === 'document') return `<header class="js-title">${jsonStructureLogo()}<strong>JSON Structure</strong><span class="js-file" data-document-title>${escapeHtml(title)}</span><button class="js-command-trigger" data-show-commands title="Show Commands (Ctrl+Shift+P)" aria-label="Show Commands">${fluentIcon('console')}</button><label class="js-theme-label"><span class="js-sr-only">Color theme</span><select class="js-theme" data-theme-select aria-label="Color theme"><option value="dark">Dark</option><option value="light">Light</option><option value="contrast">High contrast</option></select></label></header>`;
  return `<header class="js-titlebar">
    <div class="js-titlebar-drag"><span class="js-titlebar-icon" title="JSON Structure">${jsonStructureLogo()}</span>
      <nav class="js-menubar" role="menubar" aria-label="Application menu">
        ${applicationMenu('File', '<button role="menuitem" data-chrome-command="new">New<kbd>Ctrl+N</kbd></button><button role="menuitem" data-chrome-command="open">Open...<kbd>Ctrl+O</kbd></button><button role="menuitem" data-chrome-command="save">Save<kbd>Ctrl+S</kbd></button><button role="menuitem" data-chrome-command="save-as">Save As...<kbd>Ctrl+Shift+S</kbd></button><hr><button role="menuitem" data-chrome-command="quit">Exit</button>')}
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
  const sampleStatus = text.trim() === '' ? 'Sample is empty.' : text === '{}' ? 'Default empty object sample.' : 'Sample loaded and editable.';
  return `<div class="js-sheet js-instance-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Instance workspace</div><h1>Validate sample</h1><p class="js-description">Validate against the complete schema environment and follow each evaluation to its instance and schema locations.</p></div><span class="js-chip">${result?.status ?? 'not run'}</span></header><div class="js-instance-toolbar"><label>Root type<select data-instance-root><option value="" ${rootPointer === '' ? 'selected' : ''}>Document root</option>${rootOptions}</select></label><label>Replace from file<input data-instance-input type="file" accept=".json,application/json"><span class="js-description">${sampleStatus}</span></label><button data-instance-reset>Reset sample</button><button data-instance-clear>Clear</button><button data-instance-validate>Validate instance</button></div><section class="js-instance-source"><div class="js-section-head"><div><h2>Sample JSON</h2><span class="js-section-meta">Editable</span></div></div><textarea data-instance-text rows="12" spellcheck="false" aria-label="Sample JSON">${escapeHtml(text)}</textarea></section><div class="js-instance-layout"><section class="js-trace-panel"><div class="js-section-head"><div><h2>Evaluation trace</h2><span class="js-section-meta">${result?.status ?? 'not run'}</span></div></div>${result ? renderEvaluationTrace(result.trace, selection) : '<div class="js-empty">Edit or load a sample and run validation to inspect the evaluation trace.</div>'}</section></div><section><div class="js-section-head"><div><h2>Diagnostics</h2><span class="js-section-meta">${result?.diagnostics.length ?? 0}</span></div></div>${diagnostics || '<div class="js-empty">No instance diagnostics.</div>'}</section></div>`;
}

function renderEvaluationTrace(trace: EvaluationTrace, selection: CrossNavigationSelection | undefined, depth = 0): string {
  const selected = selection?.instancePointer === trace.instancePointer && selection.schemaPointer === trace.schemaPointer;
  const children = trace.children.map((child) => renderEvaluationTrace(child, selection, depth + 1)).join('');
  return `<details class="js-trace js-trace-${trace.status}" ${depth < 2 || trace.status !== 'valid' ? 'open' : ''} data-trace-depth="${depth}"><summary><span class="js-trace-status" aria-hidden="true">${trace.status === 'valid' ? '✓' : trace.status === 'invalid' ? '×' : '?'}</span><strong>${escapeHtml(trace.keyword)}</strong><span>${escapeHtml(trace.message ?? trace.status)}</span></summary><div class="js-trace-locations" aria-current="${selected}"><button data-trace-instance="${escapeAttribute(trace.instancePointer)}" data-trace-schema="${escapeAttribute(trace.schemaPointer)}">Instance <span class="js-code">${escapeHtml(trace.instancePointer || '/')}</span></button><button data-trace-schema="${escapeAttribute(trace.schemaPointer)}" data-trace-instance="${escapeAttribute(trace.instancePointer)}">Schema <span class="js-code">${escapeHtml(trace.schemaPointer || '/')}</span></button></div>${children ? `<div class="js-trace-children">${children}</div>` : ''}</details>`;
}

export function designView(name: string | undefined, type: string | undefined, description: string | undefined, rows: readonly PropertyRow[], selectedPointer: string | undefined, identity: readonly string[] = [], relations: readonly import('../model.js').RelationProjection[] = [], memberMode: DesignMemberMode = 'local', effectiveMembers?: EffectiveMembersResult, expandedPropertyPointer?: string, definitions: readonly { readonly name: string; readonly pointer: string; readonly identity?: readonly string[] }[] = [], document?: unknown, pendingPropertyFields: ReadonlySet<string> = new Set(), relationDraftOpen = false, typeCreatorOpen = false, definitionPointer?: string, rootActive = false): string {
  if (typeCreatorOpen) return typeCreatorView(definitions.length === 0);
  const authoredNamespaces = namespacePointers(document, definitions.map((definition) => definition.pointer));
  if (!name && !type && selectedPointer && authoredNamespaces.includes(selectedPointer)) return namespaceDesignView(selectedPointer, document, definitions);
  if (!name && !type && !(definitionPointer === '' && isInlineRootSchema(document))) return typeCreatorView(definitions.length === 0);
  const declarationPointer = definitionPointer ?? '';
  const declaration = valueAtPointer(document, declarationPointer) as Readonly<Record<string, unknown>> | undefined;
  const capabilities = resolveCapabilities(document);
  const localPropertyRows = rows.map((row) => propertyEditorRow(row, row.pointer === selectedPointer, row.pointer === expandedPropertyPointer, identity.includes(row.name), definitions, document, pendingPropertyFields, type === 'tuple')).join('');
  const effectiveRows = effectiveMembers?.members.map((member) => `<div class="js-row js-effective-row" role="row" data-member-origin="${member.provenance}"><div class="js-cell" role="cell"><button class="js-property-link js-code" data-effective-source="${escapeAttribute(member.sourcePointer)}" data-effective-document="${escapeAttribute(member.documentUri)}">${escapeHtml(member.name)}</button></div><div class="js-cell js-code" role="cell">${escapeHtml(displayPropertyValueTypes(member.schema))}</div><div class="js-cell js-nullable-indicator" role="cell">${inlinePropertyNullable(member.schema) ? 'yes' : 'no'}</div><div class="js-cell js-identity-indicator" role="cell">${identity.includes(member.name) ? 'yes' : 'no'}</div><div class="js-cell ${member.required ? 'js-required' : 'js-optional'}" role="cell">${member.required ? 'required' : 'optional'}</div><div class="js-cell js-description-cell" role="cell"><span class="js-origin-chip">${escapeHtml(member.provenance)}</span>${member.addIn ? ` ${escapeHtml(member.addIn)}` : ''}${member.inheritedVia.length ? `<small>${member.inheritedVia.map(pointerLabel).map(escapeHtml).join(' → ')}</small>` : ''}${member.imports.length ? `<small>${member.imports.map((item) => `${item.keyword} ${item.importSource}`).map(escapeHtml).join(' → ')}</small>` : ''}</div><div class="js-cell js-action-cell" role="cell"><button class="js-row-action" data-effective-source="${escapeAttribute(member.sourcePointer)}" data-effective-document="${escapeAttribute(member.documentUri)}" aria-label="Open declaration of ${escapeAttribute(member.name)}">↗</button></div></div>`).join('') ?? '';
  const propertyRows = memberMode === 'effective' ? effectiveRows : localPropertyRows;
  const conflictView = memberMode === 'effective' && effectiveMembers ? `${effectiveMembers.conflicts.map((conflict) => `<div class="js-conflict"><strong>${escapeHtml(conflict.name)}</strong><span>${escapeHtml(conflict.reason)} · ${escapeHtml(conflict.winner)} wins over ${escapeHtml(conflict.loser)}</span></div>`).join('')}${effectiveMembers.diagnostics.map((diagnostic) => `<div class="js-conflict"><strong>${escapeHtml(diagnostic.code)}</strong><span>${escapeHtml(diagnostic.message)}</span></div>`).join('')}` : '';
  const relationRows = relations.map((relation) => `<button class="js-relation-row" data-select="${escapeAttribute(relation.pointer)}" aria-current="${relation.pointer === selectedPointer}"><span><strong>${escapeHtml(relation.name)}</strong><small>${escapeHtml(relation.targetTypeRef ?? 'No target')}</small></span><span class="js-chip">${escapeHtml(relation.cardinality ?? 'single')}</span><span class="js-relation-scope">${escapeHtml(formatRelationScope(relation.scope))}</span><span aria-hidden="true">${fluentIcon('chevronRight', 'js-chevron')}</span></button>`).join('');
  const relationDraft = relationDraftOpen ? inlineRelationDraft(definitions, document) : '';
  const relationCapability = capabilities.relationsActive ? '' : '<p class="js-capability-note">Adding an identity or relation will activate the compatible Relations capability for this document.</p>';
  const relationsView = type === 'object' || type === 'tuple'
    ? `<section class="js-design-section"><div class="js-section-head"><div><h2>Relations</h2><span class="js-section-meta">${relations.length}</span></div><button data-inline-relation-add ${relationDraftOpen ? 'disabled' : ''}>${fluentIcon('add')}<span>Add relation</span></button></div>${relationCapability}<div class="js-relation-list">${relationRows}${relationDraft || (!relationRows ? '<p class="js-description">No relations declared.</p>' : '')}</div></section>`
    : '';
  const memberCount = memberMode === 'effective' ? effectiveMembers?.members.length ?? 0 : rows.length;
  const addProperty = `${fluentIcon('add')}<span>Add property</span>`;
  const rootToggle = definitionPointer && definitionPointer !== '' ? `<label class="js-root-toggle"><input type="checkbox" data-root-toggle="${escapeAttribute(definitionPointer)}" ${rootActive ? 'checked' : ''}> Root</label>` : '';
  const editableName = definitionPointer && definitionPointer !== ''
    ? `<input class="js-definition-name" data-inline-definition-name="${escapeAttribute(definitionPointer)}" value="${escapeAttribute(name ?? '')}" aria-label="Type name" spellcheck="false">`
    : `<h1>${escapeHtml(name ?? 'Inline schema')}</h1>`;
  const editableDescription = definitionPointer && definitionPointer !== ''
    ? `<textarea class="js-definition-description" rows="1" data-inline-definition-description="${escapeAttribute(definitionPointer)}" placeholder="No description yet." aria-label="Type description">${escapeHtml(description ?? '')}</textarea>`
    : `<p class="js-description">${escapeHtml(description ?? 'No description yet.')}</p>`;
  const propertyView = type === 'object' || type === 'tuple'
    ? `${type === 'tuple' ? tupleOrderView(declarationPointer, declaration) : ''}<div class="js-section-head"><div><h2>${type === 'tuple' ? 'Tuple members' : 'Properties'}</h2><span class="js-section-meta">${memberCount} visible</span></div><div class="js-member-mode" role="group" aria-label="Property origin"><button data-member-mode="local" aria-pressed="${memberMode === 'local'}">Local</button><button data-member-mode="effective" aria-pressed="${memberMode === 'effective'}">Effective</button></div>${memberMode === 'local' ? `<button data-command="add">${addProperty}</button>` : ''}</div>${conflictView}<div class="js-grid" role="table" aria-label="${type === 'tuple' ? 'Tuple members' : 'Properties'}"><div class="js-row js-header" role="row"><div class="js-cell" role="columnheader">Name</div><div class="js-cell" role="columnheader">Type</div><div class="js-cell" role="columnheader">Nullable</div><div class="js-cell" role="columnheader">Identity</div><div class="js-cell" role="columnheader">Presence</div><div class="js-cell" role="columnheader"><span class="js-sr-only">Actions</span></div></div>${propertyRows || (memberMode === 'local' ? `<button class="js-add-row" data-command="add">${fluentIcon('add')}<span>Add a ${type === 'tuple' ? 'tuple member' : 'property'}</span></button>` : '<div class="js-empty">No effective members.</div>')}</div>`
    : type === 'choice' ? choicesEditorView(declarationPointer, declaration, definitions)
    : type === 'array' || type === 'set' || type === 'map' ? collectionDeclarationView(declarationPointer, declaration, definitions, document)
    : '<section class="js-design-section"><h2>Primitive declaration</h2><p class="js-description">Use the structured facets below to author constraints and annotations for this primitive.</p></section>';
  const typeEditor = typeof type === 'string' && type !== 'union' ? `<label class="js-definition-type">Type<select data-inline-definition-type="${escapeAttribute(declarationPointer)}">${definitionTypeOptions(type)}</select></label>` : '<span class="js-definition-type js-composition-type">Composition schema</span>';
  const deleteDefinition = definitionPointer && definitionPointer !== '' ? `<button type="button" class="js-danger" data-inline-definition-delete="${escapeAttribute(definitionPointer)}">Delete type</button>` : '';
  const facets = declaration ? structuredFacetEditor(declarationPointer, declaration, document, pendingPropertyFields, new Set(), definitions) : '';
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">${name ? 'Local definition' : 'Inline schema'}</div>${editableName}${editableDescription}<p class="js-inline-status" data-inline-status="${escapeAttribute(definitionPointer ?? '')}" role="status" aria-live="polite"></p></div><div class="js-type-badges">${typeEditor}${rootToggle}${deleteDefinition}</div></header>${propertyView}${relationsView}${facets}</div>`;
}

function namespaceDesignView(pointer: string, document: unknown, definitions: readonly { readonly name: string; readonly pointer: string }[]): string {
  const rootNamespace = pointer === '/definitions';
  const rootValue = isRecord(document) ? document : {};
  const operationPointer = rootNamespace && !isRecord(rootValue.definitions) ? '' : pointer;
  const importPointer = rootNamespace && (typeof rootValue.$import === 'string' || typeof rootValue.$importdefs === 'string') ? '' : operationPointer;
  const importOwner = valueAtPointer(document, importPointer) as Record<string, unknown> | undefined;
  const name = rootNamespace ? 'Root namespace' : pointerLabel(pointer);
  const childDefinitions = definitions.filter((definition) => definition.pointer.startsWith(`${pointer}/`));
  const childNamespaces = namespacePointers(document, definitions.map((definition) => definition.pointer)).filter((candidate) => candidate !== pointer && candidate.startsWith(`${pointer}/`));
  const imports = (['$import', '$importdefs'] as const).map((keyword) => `<label><span>${keyword}</span><input data-namespace-import="${keyword}" data-namespace-pointer="${escapeAttribute(importPointer)}" value="${escapeAttribute(typeof importOwner?.[keyword] === 'string' ? importOwner[keyword] as string : '')}" placeholder="https://example.test/schema.struct.json"><small>${keyword === '$import' ? 'Imports the external root type and its definitions.' : 'Imports only the external definitions section.'}</small></label>`).join('');
  const title = rootNamespace ? `<h1>${name}</h1>` : `<input class="js-definition-name" data-inline-namespace-name="${escapeAttribute(pointer)}" value="${escapeAttribute(name)}" aria-label="Namespace name">`;
  const deletion = rootNamespace ? '' : `<section class="js-design-section"><h2>Safe deletion</h2><p class="js-description">Empty namespaces can be deleted directly. Deleting contents is explicit and remains blocked while external references target this namespace.</p><div class="js-actions"><button class="js-danger" data-namespace-delete="${escapeAttribute(pointer)}">Delete empty namespace</button><button class="js-danger" data-namespace-delete-contents="${escapeAttribute(pointer)}">Delete namespace and contents</button></div></section>`;
  return `<div class="js-sheet"><header class="js-type-head"><div><div class="js-eyebrow">Namespace</div>${title}<p class="js-description">${childDefinitions.length} definitions · ${childNamespaces.length} child namespaces</p><p class="js-inline-status" data-inline-status="${escapeAttribute(pointer)}" role="status" aria-live="polite"></p></div><div class="js-type-badges"><button data-namespace-add-type="${escapeAttribute(operationPointer)}">${fluentIcon('add')} Add type</button></div></header><section class="js-design-section"><h2>Child namespaces</h2><div class="js-choice-add"><input data-namespace-add-name class="js-code" value="Namespace" aria-label="Child namespace name"><button data-namespace-add-child="${escapeAttribute(operationPointer)}">${fluentIcon('add')} Add namespace</button></div></section><section class="js-design-section"><h2>Direct imports</h2><div class="js-namespace-imports">${imports}</div><p class="js-capability-note">Imports belong to the selected namespace. <span class="js-code">$import</span> includes the external root type; <span class="js-code">$importdefs</span> does not.</p></section>${deletion}</div>`;
}

function definitionTypeOptions(current: string | undefined): string {
  const control = actionById('core.type')?.control;
  if (control?.kind !== 'select') return '';
  return control.options.map((option) => `<option value="${escapeAttribute(option.value)}" ${option.value === current ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

function tupleOrderView(pointer: string, declaration: Readonly<Record<string, unknown>> | undefined): string {
  const order = Array.isArray(declaration?.tuple) ? declaration.tuple.filter((entry): entry is string => typeof entry === 'string') : [];
  return `<section class="js-design-section js-tuple-order"><div class="js-section-head"><div><h2>Tuple order</h2><span class="js-section-meta">${order.length} members</span></div></div><ol>${order.map((name, index) => `<li><span class="js-code">${escapeHtml(name)}</span><span class="js-value-actions"><button type="button" data-tuple-move="up" data-tuple-index="${index}" data-tuple-pointer="${escapeAttribute(pointer)}" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escapeAttribute(name)} earlier">${fluentIcon('arrowUp')}</button><button type="button" data-tuple-move="down" data-tuple-index="${index}" data-tuple-pointer="${escapeAttribute(pointer)}" ${index === order.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeAttribute(name)} later">${fluentIcon('arrowUp', 'js-icon-down')}</button></span></li>`).join('') || '<li>No tuple members yet.</li>'}</ol></section>`;
}

function collectionDeclarationView(pointer: string, declaration: Readonly<Record<string, unknown>> | undefined, definitions: readonly { readonly name: string; readonly pointer: string }[], document?: unknown): string {
  if (!declaration) return '';
  const keyword = declaration.type === 'map' ? 'values' : 'items';
  const member = isRecord(declaration[keyword]) ? declaration[keyword] as Readonly<Record<string, unknown>> : {};
  const memberPointer = `${pointer}/${keyword}`;
  return `<section class="js-design-section js-collection-editor"><div class="js-section-head"><div><h2>${declaration.type === 'map' ? 'Map values' : `${String(declaration.type)[0]!.toLocaleUpperCase()}${String(declaration.type).slice(1)} items`}</h2><span class="js-section-meta">Directly editable</span></div></div><div class="js-collection-member" data-type-drop="${escapeAttribute(memberPointer)}"><span>${keyword === 'values' ? 'Value type' : 'Item type'}</span>${inlineTypeComposer(member, memberPointer, keyword, definitions, true)}<span class="js-type-drop-zone" aria-hidden="true"></span>${inlineCollectionEditors(member, memberPointer, definitions, document)}${nestedSchemaEditor(member, memberPointer, definitions, document)}</div></section>`;
}

function choicesEditorView(pointer: string, declaration: Readonly<Record<string, unknown>> | undefined, definitions: readonly { readonly name: string; readonly pointer: string }[], ancestors: ReadonlySet<string> = new Set()): string {
  const choices = isRecord(declaration?.choices) ? declaration.choices as Record<string, unknown> : {};
  const rows = Object.entries(choices).map(([name, schema]) => {
    const choicePointer = `${pointer}/choices/${escapePointerToken(name)}`;
    const typed: Readonly<Record<string, unknown>> = isSchemaRecord(schema) ? schema : { type: 'string' };
    return `<div class="js-choice-row" data-choice-row="${escapeAttribute(choicePointer)}"><input class="js-code" data-inline-choice-name="${escapeAttribute(choicePointer)}" value="${escapeAttribute(name)}" aria-label="Choice alternative name">${inlineTypeComposer(typed, choicePointer, name, definitions, true)}${nestedSchemaEditor(typed, choicePointer, definitions, undefined, new Set(), ancestors)}<textarea rows="1" data-inline-choice-description="${escapeAttribute(choicePointer)}" placeholder="Alternative description">${escapeHtml(typeof typed.description === 'string' ? typed.description : '')}</textarea><button class="js-danger" data-inline-choice-delete="${escapeAttribute(choicePointer)}" aria-label="Delete ${escapeAttribute(name)}">Delete</button><p class="js-inline-status" data-inline-status="${escapeAttribute(choicePointer)}" role="status"></p></div>`;
  }).join('');
  return `<section class="js-design-section js-choice-editor"><div class="js-section-head"><div><h2>Choices</h2><span class="js-section-meta">${Object.keys(choices).length} alternatives</span></div></div><div class="js-choice-list">${rows || '<p class="js-description">No alternatives declared.</p>'}</div><div class="js-choice-add"><input data-choice-add-name class="js-code" placeholder="alternative_name" aria-label="New choice name"><select data-choice-add-type aria-label="New choice type">${definitionTypeOptions('string')}${definitions.map((definition) => `<option value="ref:#${escapeAttribute(definition.pointer)}">${escapeHtml(definitionTypeLabel(definition.pointer))} (reusable)</option>`).join('')}</select><button data-choice-add="${escapeAttribute(pointer)}">Add alternative</button></div></section>`;
}

const STRUCTURED_FACET_GROUPS = new Set(['Validation', 'Composition', 'Units', 'Alternate names', 'Semantic annotations']);
const STRUCTURED_CORE_FACETS = new Set(['core.enum', 'core.const', 'core.abstract', 'core.extends', 'core.additional-properties', 'core.precision', 'core.scale', 'core.max-length', 'core.selector']);

function structuredFacetEditor(pointer: string, schema: Readonly<Record<string, unknown>>, document: unknown, pendingFields: ReadonlySet<string>, excludedActions: ReadonlySet<string> = new Set(), definitions: readonly { readonly name: string; readonly pointer: string }[] = []): string {
  const actions = commandActions.filter((action) => !excludedActions.has(action.id) && action.operation === 'set' && action.keyword &&
    (STRUCTURED_FACET_GROUPS.has(action.group) || STRUCTURED_CORE_FACETS.has(action.id) || action.id.startsWith('binary.')));
  const conditional = actionById('composition.conditional');
  const candidates = conditional ? [...actions, conditional] : actions;
  const effective = effectiveValidationTypes(document, schema);
  const schemaType = effective.determinate && effective.types.length === 1 ? effective.types[0] : undefined;
  const rows = candidates.flatMap((action) => {
    const current = action.id === 'composition.conditional'
      ? ['if', 'then', 'else'].some((keyword) => Object.prototype.hasOwnProperty.call(schema, keyword))
        ? Object.fromEntries(['if', 'then', 'else'].filter((keyword) => schema[keyword] !== undefined).map((keyword) => [keyword, schema[keyword]]))
        : undefined
      : action.keyword ? schema[action.keyword] : undefined;
    const pending = pendingFields.has(inlineFieldKey(pointer, action.id));
    if (current !== undefined && isCompositionArrayAction(action) && Array.isArray(current)) return [structuredCompositionFacetRow(pointer, action, current, definitions, document)];
    if (current !== undefined && action.id === 'composition.not' && isSchemaRecord(current)) return [structuredCompositionSingleFacetRow(pointer, action, 'not', current, definitions, document)];
    if (current !== undefined && action.id === 'composition.conditional' && isSchemaRecord(current)) return [structuredConditionalFacetRow(pointer, action, current, definitions, document)];
    return current === undefined && !pending ? [] : [structuredFacetRow(pointer, action, current, pending, schemaType)];
  }).join('');
  const options = candidates.filter((action) => {
    const current = action.id === 'composition.conditional'
      ? ['if', 'then', 'else'].some((keyword) => schema[keyword] !== undefined)
      : action.keyword && schema[action.keyword] !== undefined;
    if (current || pendingFields.has(inlineFieldKey(pointer, action.id))) return false;
    const availability = actionAvailability(action, pointer, document);
    return availability.enabled || availability.reason?.startsWith('Activate ');
  }).map((action) => `<option value="${escapeAttribute(action.id)}">${escapeHtml(action.group)} · ${escapeHtml(action.label.replace(/^Set /, ''))}</option>`).join('');
  return `<details class="js-structured-facets" open><summary>Validation, composition, and annotations</summary><div class="js-structured-facet-list">${rows || '<p class="js-description">No structured facets are authored.</p>'}</div>${options ? `<div class="js-detail-add"><label>Add structured facet<select data-facet-select="${escapeAttribute(pointer)}"><option value="">Choose facet</option>${options}</select></label><button type="button" data-facet-add="${escapeAttribute(pointer)}">Add</button></div>` : ''}</details>`;
}

function isCompositionArrayAction(action: CommandAction): boolean {
  return action.id === 'composition.allOf' || action.id === 'composition.anyOf' || action.id === 'composition.oneOf';
}

function structuredCompositionFacetRow(pointer: string, action: CommandAction, value: readonly unknown[], definitions: readonly { readonly name: string; readonly pointer: string }[], document: unknown): string {
  const keyword = action.keyword ?? action.id.slice('composition.'.length);
  const branches = value.map((branch, index) => {
    const branchPointer = `${pointer}/${keyword}/${index}`;
    if (!isSchemaRecord(branch)) return `<article class="js-composition-branch" data-composition-branch="${escapeAttribute(branchPointer)}"><strong>Branch ${index + 1}</strong><p class="js-description">This branch is not a structured schema. Use Advanced to repair it.</p></article>`;
    return `<article class="js-composition-branch" data-composition-branch="${escapeAttribute(branchPointer)}"><header><strong>Branch ${index + 1}</strong><span class="js-code">${escapeHtml(schemaExpressionLabel(branch.type))}</span></header>${inlineTypeComposer(branch, branchPointer, `Branch ${index + 1}`, definitions, true)}${nestedSchemaEditor(branch, branchPointer, definitions, document, new Set(), new Set())}</article>`;
  }).join('');
  const remove = action.removesActionId
    ? `<button type="button" class="js-detail-remove" data-facet-remove="${escapeAttribute(action.removesActionId)}" data-facet-pointer="${escapeAttribute(pointer)}" aria-label="Remove ${escapeAttribute(keyword)}">Remove</button>`
    : '';
  return `<div class="js-structured-facet-row js-composition-facet-row" data-facet-row="${escapeAttribute(action.id)}"><div><span>${escapeHtml(action.group)} · ${escapeHtml(action.label.replace(/^Set /, ''))}</span><div class="js-composition-branches" data-composition-keyword="${escapeAttribute(keyword)}">${branches || '<p class="js-description">No branches are authored.</p>'}</div></div><button type="button" data-facet-advanced="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}">Advanced</button>${remove}</div>`;
}
function structuredCompositionSingleFacetRow(pointer: string, action: CommandAction, keyword: string, branch: Readonly<Record<string, unknown>>, definitions: readonly { readonly name: string; readonly pointer: string }[], document: unknown): string {
  const branchPointer = `${pointer}/${keyword}`;
  const editor = `<article class="js-composition-branch" data-composition-branch="${escapeAttribute(branchPointer)}"><header><strong>${escapeHtml(keyword)}</strong><span class="js-code">${escapeHtml(schemaExpressionLabel(branch.type))}</span></header>${inlineTypeComposer(branch, branchPointer, keyword, definitions, true)}${nestedSchemaEditor(branch, branchPointer, definitions, document, new Set(), new Set())}</article>`;
  const remove = action.removesActionId
    ? `<button type="button" class="js-detail-remove" data-facet-remove="${escapeAttribute(action.removesActionId)}" data-facet-pointer="${escapeAttribute(pointer)}" aria-label="Remove ${escapeAttribute(keyword)}">Remove</button>`
    : '';
  return `<div class="js-structured-facet-row js-composition-facet-row" data-facet-row="${escapeAttribute(action.id)}"><div><span>${escapeHtml(action.group)} · ${escapeHtml(action.label.replace(/^Set /, ''))}</span><div class="js-composition-branches">${editor}</div></div><button type="button" data-facet-advanced="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}">Advanced</button>${remove}</div>`;
}

function structuredConditionalFacetRow(pointer: string, action: CommandAction, value: Readonly<Record<string, unknown>>, definitions: readonly { readonly name: string; readonly pointer: string }[], document: unknown): string {
  const branches = (['if', 'then', 'else'] as const).flatMap((keyword) => {
    const branch = value[keyword];
    return isSchemaRecord(branch)
      ? [`<article class="js-composition-branch" data-composition-branch="${escapeAttribute(`${pointer}/${keyword}`)}"><header><strong>${keyword}</strong><span class="js-code">${escapeHtml(schemaExpressionLabel(branch.type))}</span></header>${inlineTypeComposer(branch, `${pointer}/${keyword}`, keyword, definitions, true)}${nestedSchemaEditor(branch, `${pointer}/${keyword}`, definitions, document, new Set(), new Set())}</article>`]
      : [];
  }).join('');
  const remove = action.removesActionId
    ? `<button type="button" class="js-detail-remove" data-facet-remove="${escapeAttribute(action.removesActionId)}" data-facet-pointer="${escapeAttribute(pointer)}" aria-label="Remove conditional composition">Remove</button>`
    : '';
  return `<div class="js-structured-facet-row js-composition-facet-row" data-facet-row="${escapeAttribute(action.id)}"><div><span>${escapeHtml(action.group)} · ${escapeHtml(action.label.replace(/^Set /, ''))}</span><div class="js-composition-branches">${branches || '<p class="js-description">No conditional branches are authored.</p>'}</div></div><button type="button" data-facet-advanced="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}">Advanced</button>${remove}</div>`;
}

function structuredFacetRow(pointer: string, action: CommandAction, value: unknown, pending: boolean, schemaType: string | undefined): string {
  const raw = value === undefined ? '' : typeof value === 'string' && action.control?.kind !== 'advanced-json' ? value : JSON.stringify(value, null, 2);
  const kind = action.control?.kind === 'boolean' ? 'boolean' :
    action.control?.kind === 'number' ? 'number' :
    action.control?.kind === 'text' || action.control?.kind === 'catalog' ? 'text' : 'json';
  const control = kind === 'boolean'
    ? `<input type="checkbox" data-facet-control data-facet-action="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}" data-value-kind="boolean" ${value === true ? 'checked' : ''}>`
    : kind === 'json'
      ? `<textarea rows="4" data-facet-control data-facet-action="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}" data-value-kind="json" placeholder="Enter structured JSON">${escapeHtml(raw)}</textarea>`
      : `<input type="${kind === 'number' && !(action.control?.kind === 'number' && action.control.schemaNumeric && stringBackedNumericType(schemaType)) ? 'number' : 'text'}" data-facet-control data-facet-action="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}" data-value-kind="${kind}" value="${escapeAttribute(raw)}">`;
  const catalog = action.control?.kind === 'catalog'
    ? `<span class="js-catalog-field" data-facet-catalog="${escapeAttribute(action.id)}" data-facet-pointer="${escapeAttribute(pointer)}"><input type="hidden" data-catalog-value value="${escapeAttribute(raw)}"><input data-catalog-display value="${escapeAttribute(structuredValueLabel(value))}" readonly><button type="button" data-catalog-open>Browse catalog</button><small data-catalog-provenance>Catalog suggestions are advisory.</small></span>`
    : control;
  const remove = pending
    ? `<button type="button" data-facet-cancel="${escapeAttribute(inlineFieldKey(pointer, action.id))}">Cancel</button>`
    : `<button type="button" class="js-detail-remove" data-facet-remove="${escapeAttribute(action.removesActionId ?? `${action.id}.remove`)}" data-facet-pointer="${escapeAttribute(pointer)}">Remove</button>`;
  return `<div class="js-structured-facet-row" data-facet-row="${escapeAttribute(action.id)}"><label><span>${escapeHtml(action.group)} · ${escapeHtml(action.label.replace(/^Set /, ''))}</span>${catalog}</label>${remove}</div>`;
}

function typeCreatorView(firstType: boolean): string {
  const choices: readonly { readonly type: CompositeType; readonly icon: import('./fluent-icons.js').FluentIconName; readonly label: string; readonly detail: string }[] = [
    { type: 'object', icon: 'braces', label: 'Object', detail: 'Named properties and relations' },
    { type: 'array', icon: 'textBulletListSquare', label: 'Array', detail: 'Ordered values of one schema' },
    { type: 'set', icon: 'collections', label: 'Set', detail: 'Unique values of one schema' },
    { type: 'map', icon: 'tableSimple', label: 'Map', detail: 'String keys and typed values' },
    { type: 'tuple', icon: 'numberRow', label: 'Tuple', detail: 'Ordered named members' },
    { type: 'choice', icon: 'branch', label: 'Choice', detail: 'Named alternatives' },
  ];
  const cards = choices.map((choice) => `<button class="js-composite-choice" type="button" data-type-create="${choice.type}">${fluentIcon(choice.icon)}<span><strong>${choice.label}</strong><small>${choice.detail}</small></span></button>`).join('');
  const primitiveTypes: readonly CreatableType[] = ['any', 'null', 'boolean', 'string', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'integer', 'float8', 'float', 'double', 'decimal', 'number', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer'];
  const primitiveOptions = primitiveTypes.map((primitive) => `<option value="${primitive}">${primitive}</option>`).join('');
  const conversionStarts = firstType ? startConversionChoices(BUILTIN_CONVERSION_COMMANDS_MANIFEST) : '';
  return `<section class="js-type-creator" aria-labelledby="type-creator-title"><div class="js-eyebrow">${firstType ? 'Start the schema' : 'Add a type'}</div><h1 id="type-creator-title">${firstType ? 'Choose the first type' : 'Choose a type'}</h1><p class="js-description">${firstType ? 'The first type becomes the document root. You can change the root flag at any time.' : 'Create a reusable primitive or composite schema type in this document.'}</p><label class="js-type-name">Type name<input class="js-code" data-type-create-name value="${firstType ? 'Root' : 'NewType'}" autocomplete="off" spellcheck="false"></label><div class="js-composite-choices">${cards}</div><div class="js-primitive-create"><label>Core primitive<select data-type-create-primitive>${primitiveOptions}</select></label><button type="button" data-type-create-primitive-commit>Create primitive</button></div>${conversionStarts}<p class="js-action-status" data-type-create-status role="status" aria-live="polite"></p>${firstType ? '' : '<button class="js-type-create-cancel" type="button" data-type-create-cancel>Cancel</button>'}</section>`;
}

function directStructurizeImportCommands(manifest: ConversionCommandsManifest): readonly ConversionCommand[] {
  return manifest.commands.filter((command) => command.direction === 'import' && command.converterId === 'structurize-cli' && command.cliCommand?.endsWith('2s'));
}

function startConversionChoices(manifest: ConversionCommandsManifest): string {
  const commands = directStructurizeImportCommands(manifest);
  return `<section class="js-start-conversion" aria-labelledby="start-conversion-title"><div class="js-section-head"><div><h2 id="start-conversion-title">Start from an existing schema or data source</h2><span class="js-section-meta">Import with Structurize</span></div></div><div class="js-start-conversion-grid">${commands.map((command) => `<button type="button" class="js-start-conversion-choice" data-start-conversion-command="${escapeAttribute(command.id)}" data-start-cli-command="${escapeAttribute(command.cliCommand ?? '')}"><span class="js-format-icon" data-format="${escapeAttribute(command.sourceFormat)}" aria-hidden="true">${technologyIcon(command.sourceFormat)}</span><span><strong>${escapeHtml(conversionFormatName(command.sourceFormat))}</strong><small>${escapeHtml(command.availability === 'external-service' ? command.availabilityMessage ?? 'External source configuration required.' : `Open ${command.sourceExtensions?.join(', ') ?? 'a source file'}`)}</small></span></button>`).join('')}</div></section>`;
}

function isCreatableType(value: string): value is CreatableType {
  const action = actionById('core.type');
  return action?.control?.kind === 'select' && action.control.options.some((option) => option.value === value);
}

export function compositeSchema(type: CreatableType): Readonly<Record<string, unknown>> {
  if (type === 'object') return { type, properties: {} };
  if (type === 'array' || type === 'set') return { type, items: { type: 'string' } };
  if (type === 'map') return { type, values: { type: 'string' } };
  if (type === 'tuple') return { type, properties: {}, tuple: [] };
  if (type === 'choice') return { type, choices: {} };
  return { type };
}

function propertyEditorRow(row: PropertyRow, selected: boolean, expanded: boolean, identity: boolean, definitions: readonly { readonly name: string; readonly pointer: string }[], document?: unknown, pendingPropertyFields: ReadonlySet<string> = new Set(), tupleMember = false, ancestors: ReadonlySet<string> = new Set()): string {
  const schema = row.schema ?? {};
  const typeComposer = inlineTypeComposer(schema, row.pointer, row.name, definitions, true);
  const collectionEditors = inlineCollectionEditors(schema, row.pointer, definitions, document);
  const detailsId = `property-details-${encodeURIComponent(row.pointer).replace(/%/g, '-')}`;
  const requiredControl = tupleMember
    ? '<span class="js-implicit-required" aria-label="Required because tuple members are implicit">required (tuple)</span>'
    : row.requiredAlternatives
    ? `<button class="js-required-sets" data-action-id="property.required-alternatives" data-action-pointer="${escapeAttribute(propertyOwnerPointer(row.pointer))}" title="This type uses alternative required sets">Edit sets</button>`
    : `<label><input type="checkbox" data-inline-property="required" data-property-pointer="${escapeAttribute(row.pointer)}" ${row.required ? 'checked' : ''}> required</label>`;
  return `<div class="js-property-editor" data-property-editor="${escapeAttribute(row.pointer)}" aria-current="${selected}"><div class="js-row js-inline-property-row" role="row"><div class="js-cell" role="cell"><input class="js-inline-name js-code" data-inline-property="name" data-property-pointer="${escapeAttribute(row.pointer)}" value="${escapeAttribute(row.name)}" aria-label="Property name"></div><div class="js-cell js-inline-type-cell" role="cell" data-type-drop="${escapeAttribute(row.pointer)}">${typeComposer}<span class="js-type-drop-zone" aria-hidden="true"></span></div><div class="js-cell js-inline-nullable-cell" role="cell"><label><input type="checkbox" data-inline-property="nullable" data-property-pointer="${escapeAttribute(row.pointer)}" ${inlinePropertyNullable(schema) ? 'checked' : ''}> nullable</label></div><div class="js-cell js-inline-identity-cell" role="cell"><label title="If needed, checking this activates the compatible Relations capability."><input type="checkbox" data-inline-property="identity" data-property-pointer="${escapeAttribute(row.pointer)}" ${identity ? 'checked' : ''}> identity</label></div><div class="js-cell js-inline-required-cell" role="cell">${requiredControl}</div><div class="js-cell js-description-cell" role="cell"><textarea class="js-inline-description" rows="1" data-inline-property="description" data-property-pointer="${escapeAttribute(row.pointer)}" placeholder="Add description" aria-label="Description for ${escapeAttribute(row.name)}">${escapeHtml(row.description ?? '')}</textarea></div><div class="js-cell js-action-cell" role="cell"><button class="js-row-action" data-property-details="${escapeAttribute(row.pointer)}" aria-expanded="${expanded}" aria-controls="${detailsId}" aria-label="${expanded ? 'Collapse' : 'Expand'} validation and annotations for ${escapeAttribute(row.name)}">${fluentIcon('chevronRight', `js-property-chevron${expanded ? ' js-expanded' : ''}`)}</button><button class="js-row-action js-danger" data-inline-property-delete="${escapeAttribute(row.pointer)}" aria-label="Delete ${escapeAttribute(row.name)}">${fluentIcon('dismiss')}</button></div>${collectionEditors}</div><p class="js-inline-status" data-inline-status="${escapeAttribute(row.pointer)}" role="status" aria-live="polite"></p>${expanded ? propertyDetailsPanel(row, detailsId, document, pendingPropertyFields, definitions) : ''}${nestedSchemaEditor(schema, row.pointer, definitions, document, pendingPropertyFields, ancestors)}</div>`;
}

function nestedSchemaEditor(schema: Readonly<Record<string, unknown>>, pointer: string, definitions: readonly { readonly name: string; readonly pointer: string }[], document?: unknown, pendingPropertyFields: ReadonlySet<string> = new Set(), ancestors: ReadonlySet<string> = new Set()): string {
  if (ancestors.has(pointer)) return '<p class="js-cycle-guard">Cycle reference; open the referenced declaration to continue.</p>';
  const path = new Set(ancestors).add(pointer);
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'object' || type === 'tuple') {
    const properties = isSchemaRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.flat().filter((entry): entry is string => typeof entry === 'string') : []);
    const identity = new Set(Array.isArray(schema.identity) ? schema.identity.filter((entry): entry is string => typeof entry === 'string') : []);
    const rows = Object.entries(properties).map(([name, child]) => {
      const childPointer = `${pointer}/properties/${escapePointerToken(name)}`;
      const childSchema = isSchemaRecord(child) ? child : { type: 'string' };
      return propertyEditorRow({ name, pointer: childPointer, type: typeof childSchema.type === 'string' ? childSchema.type : 'unknown', required: required.has(name), description: typeof childSchema.description === 'string' ? childSchema.description : undefined, schema: childSchema }, childPointer === pointer, false, identity.has(name), definitions, document, pendingPropertyFields, type === 'tuple', path);
    }).join('');
    const order = type === 'tuple' ? tupleOrderView(pointer, schema) : '';
    return `<section class="js-nested-schema js-nested-${type}" data-nested-schema="${escapeAttribute(pointer)}"><div class="js-section-head"><div><h3>${type === 'tuple' ? 'Nested tuple members' : 'Nested object properties'}</h3><span class="js-section-meta">${Object.keys(properties).length} members</span></div><button type="button" data-command="add" data-property-owner="${escapeAttribute(pointer)}">${fluentIcon('add')} Add</button></div>${order}<div class="js-grid js-nested-grid" role="table" aria-label="${type === 'tuple' ? 'Nested tuple members' : 'Nested object properties'}">${rows || '<div class="js-empty">No nested members yet.</div>'}</div></section>`;
  }
  if (type === 'choice') return `<section class="js-nested-schema js-nested-choice" data-nested-schema="${escapeAttribute(pointer)}">${choicesEditorView(pointer, schema, definitions, path)}</section>`;
  return '';
}
function inlinePropertyTypeMembers(schema: Readonly<Record<string, unknown>>): readonly string[] {
  if (isCollectionSchema(schema)) return [`json:${JSON.stringify(collectionTypeBranch(schema))}`];
  const values = Array.isArray(schema.type) ? schema.type : [schema.type];
  return values.flatMap((value) => {
    if (value === 'null') return [];
    if (typeof value === 'string' && value !== 'null') return [`type:${value}`];
    const reference = relationReference(value);
    if (reference) return [`ref:${reference}`];
    return value === undefined ? [] : [`json:${JSON.stringify(value)}`];
  });
}

function inlinePropertyNullable(schema: Readonly<Record<string, unknown>>): boolean {
  return schema.type === 'null' || Array.isArray(schema.type) && schema.type.includes('null');
}

function decodeInlineTypeMember(value: string): unknown {
  const separator = value.indexOf(':');
  const kind = separator < 0 ? 'type' : value.slice(0, separator);
  const member = separator < 0 ? value : value.slice(separator + 1);
  if (kind === 'json') return JSON.parse(member);
  if (kind === 'collection' && isCollectionType(member)) return collectionSchemaForKind(member);
  return kind === 'ref' ? { $ref: member } : member;
}

function encodeInlineTypeMember(value: unknown): string {
  if (typeof value === 'string') return `type:${value}`;
  const reference = relationReference(value);
  if (reference) return `ref:${reference}`;
  return `json:${JSON.stringify(value)}`;
}

function replaceInlineTypeMember(currentMember: string, selectedValue: string): string | undefined {
  if (!selectedValue.startsWith('collection:')) return selectedValue;
  const nextKind = selectedValue.slice('collection:'.length);
  if (!isCollectionType(nextKind)) return selectedValue;
  const current = decodeInlineTypeMember(currentMember);
  if (!isCollectionSchema(current)) return undefined;
  return encodeInlineTypeMember(collectionSchemaForKind(nextKind, current));
}

function isCollectionType(value: string): value is 'array' | 'set' | 'map' {
  return value === 'array' || value === 'set' || value === 'map';
}

function collectionSchemaForKind(type: 'array' | 'set' | 'map', current?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const member = current && isCollectionSchema(current)
    ? current[current.type === 'map' ? 'values' : 'items']
    : undefined;
  const shared = current ? schemaWithoutTypeStructure(current) : {};
  const structure = member === undefined ? {} : type === 'map' ? { values: member } : { items: member };
  return { ...shared, type, ...structure };
}

function definitionTypeLabel(pointer: string): string {
  return pointer.split('/').slice(2).map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~')).join('.');
}

function inlinePropertyTypeLabel(value: string): string {
  if (value.startsWith('json:')) return schemaExpressionLabel(JSON.parse(value.slice('json:'.length)));
  return value.startsWith('ref:#/') ? definitionTypeLabel(value.slice('ref:#'.length)) : value.replace(/^(?:type|ref):/, '');
}

function inlinePropertyTypes(): readonly string[] {
  const control = actionById('core.type')?.control;
  const compound = new Set(['object', 'array', 'map', 'set', 'tuple', 'choice']);
  return control?.kind === 'select' ? control.options.map((option) => option.value).filter((value) => value !== 'null' && !compound.has(value)) : [];
}

function inlineTypeComposer(schema: Readonly<Record<string, unknown>>, pointer: string, label: string, definitions: readonly { readonly name: string; readonly pointer: string }[], allowCollections: boolean): string {
  const members = inlinePropertyTypeMembers(schema);
  const memberChips = members.map((member) => {
    const replacementOptions = inlineTypeOptions(members, member, definitions, allowCollections);
    const remove = members.length > 1
      ? `<button type="button" data-inline-type-remove="${escapeAttribute(member)}" data-property-pointer="${escapeAttribute(pointer)}" aria-label="Remove ${escapeAttribute(inlinePropertyTypeLabel(member))} from ${escapeAttribute(label)}">${fluentIcon('dismiss')}</button>`
      : '';
    return `<span class="js-type-member"><select class="js-type-member-select js-code" data-inline-type-replace="${escapeAttribute(member)}" data-property-pointer="${escapeAttribute(pointer)}" aria-label="Change ${escapeAttribute(inlinePropertyTypeLabel(member))} type for ${escapeAttribute(label)}">${replacementOptions}</select>${remove}</span>`;
  }).join('');
  const primitiveOptions = inlinePropertyTypes().filter((value) => !members.includes(`type:${value}`)).map((value) => `<option value="type:${escapeAttribute(value)}">${escapeHtml(value)}</option>`).join('');
  const collectionOptions = allowCollections ? (['array', 'set', 'map'] as const).map((type) => {
    const optionLabel = type === 'map' ? 'map<string, string>' : `${type}<string>`;
    return members.some((member) => inlineTypeMemberCollectionKind(member) === type) ? '' : `<option value="collection:${type}">${escapeHtml(optionLabel)}</option>`;
  }).join('') : '';
  const referenceOptions = definitions.filter((definition) => !members.includes(`ref:#${definition.pointer}`)).map((definition) => `<option value="ref:#${escapeAttribute(definition.pointer)}">${escapeHtml(definitionTypeLabel(definition.pointer))}</option>`).join('');
  return `<div class="js-type-composer">${memberChips || '<span class="js-type-empty">No value type</span>'}<select class="js-inline-type-add js-code" data-inline-type-add data-property-pointer="${escapeAttribute(pointer)}" aria-label="Add a type to ${escapeAttribute(label)}"><option value="">+ type</option>${primitiveOptions ? `<optgroup label="Primitive types">${primitiveOptions}</optgroup>` : ''}${collectionOptions ? `<optgroup label="Collection types">${collectionOptions}</optgroup>` : ''}${referenceOptions ? `<optgroup label="Reusable types">${referenceOptions}</optgroup>` : ''}</select></div>`;
}

function inlineTypeOptions(members: readonly string[], current: string, definitions: readonly { readonly name: string; readonly pointer: string }[], allowCollections: boolean): string {
  const currentLabel = inlinePropertyTypeLabel(current);
  const primitiveOptions = inlinePropertyTypes()
    .filter((value) => current === `type:${value}` || !members.includes(`type:${value}`))
    .map((value) => `<option value="type:${escapeAttribute(value)}" ${current === `type:${value}` ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  const currentCollection = inlineTypeMemberCollectionKind(current);
  const collectionOptions = allowCollections ? (['array', 'set', 'map'] as const)
    .filter((type) => type === currentCollection || !members.some((member) => inlineTypeMemberCollectionKind(member) === type))
    .map((type) => {
      const label = type === currentCollection ? currentLabel : type === 'map' ? 'map<string, string>' : `${type}<string>`;
      return `<option value="collection:${type}" ${type === currentCollection ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('') : '';
  const referenceOptions = definitions
    .filter((definition) => current === `ref:#${definition.pointer}` || !members.includes(`ref:#${definition.pointer}`))
    .map((definition) => `<option value="ref:#${escapeAttribute(definition.pointer)}" ${current === `ref:#${definition.pointer}` ? 'selected' : ''}>${escapeHtml(definitionTypeLabel(definition.pointer))}</option>`).join('');
  const unknownCurrent = !current.startsWith('type:') && !current.startsWith('ref:') && !currentCollection
    ? `<option value="${escapeAttribute(current)}" selected>${escapeHtml(currentLabel)}</option>`
    : '';
  return `${unknownCurrent}${primitiveOptions ? `<optgroup label="Primitive types">${primitiveOptions}</optgroup>` : ''}${collectionOptions ? `<optgroup label="Collection types">${collectionOptions}</optgroup>` : ''}${referenceOptions ? `<optgroup label="Reusable types">${referenceOptions}</optgroup>` : ''}`;
}

function inlineTypeMemberCollectionKind(member: string): 'array' | 'set' | 'map' | undefined {
  if (!member.startsWith('json:')) return undefined;
  const value = JSON.parse(member.slice('json:'.length));
  return isCollectionSchema(value) ? value.type : undefined;
}

function inlineCollectionEditors(schema: Readonly<Record<string, unknown>>, pointer: string, definitions: readonly { readonly name: string; readonly pointer: string }[], document?: unknown): string {
  const collections: Array<{ readonly schema: Readonly<Record<string, unknown>>; readonly pointer: string }> = [];
  if (isCollectionSchema(schema)) collections.push({ schema, pointer });
  if (Array.isArray(schema.type)) {
    schema.type.forEach((member, index) => {
      if (isCollectionSchema(member)) collections.push({ schema: member, pointer: `${pointer}/type/${index}` });
    });
  }
  if (!collections.length) return '';
  const editors = collections.map(({ schema: collection, pointer: collectionPointer }) => {
    const keyword = collection.type === 'map' ? 'values' : 'items';
    const member = collection[keyword];
    const memberSchema = isSchemaRecord(member) ? member : {};
    const memberPointer = `${collectionPointer}/${keyword}`;
    const label = collection.type === 'map' ? 'Value type' : 'Item type';
    const nestedCollections = inlineCollectionEditors(memberSchema, memberPointer, definitions, document);
    const memberFacets = structuredFacetEditor(memberPointer, memberSchema, document, new Set(), new Set(), definitions);
    return `<div class="js-collection-expression"><select class="js-collection-kind js-code" data-inline-collection-kind data-property-pointer="${escapeAttribute(collectionPointer)}" aria-label="Change collection kind">${(['array', 'set', 'map'] as const).map((type) => `<option value="${type}" ${type === collection.type ? 'selected' : ''}>${type}</option>`).join('')}</select><span class="js-collection-angle">&lt;</span><div class="js-collection-member"><span>${label}</span>${inlineTypeComposer(memberSchema, memberPointer, label, definitions, false)}${nestedCollections}${memberFacets}</div><span class="js-collection-angle">&gt;</span></div>`;
  }).join('');
  return `<div class="js-cell js-composite-cell" role="cell" aria-label="Collection member schemas">${editors}</div>`;
}

function isCollectionSchema(value: unknown): value is Readonly<Record<string, unknown>> & { readonly type: 'array' | 'set' | 'map' } {
  return isSchemaRecord(value) && (value.type === 'array' || value.type === 'set' || value.type === 'map');
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collectionTypeBranch(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { description: _description, ...branch } = schema;
  return branch;
}

function schemaExpressionLabel(value: unknown): string {
  if (!isSchemaRecord(value)) return displaySchemaTypeValue(value);
  const reference = relationReference(value);
  if (reference) return definitionTypeLabel(reference.replace(/^#/, ''));
  if (!isCollectionSchema(value)) return displaySchemaTypeValue(value);
  const member = value[value.type === 'map' ? 'values' : 'items'];
  const memberLabel = isSchemaRecord(member) ? schemaExpressionLabel(member.type) : 'untyped';
  return value.type === 'map' ? `map<string, ${memberLabel}>` : `${value.type}<${memberLabel}>`;
}

export function propertySchemaWithTypes(schema: Readonly<Record<string, unknown>>, values: readonly unknown[]): Readonly<Record<string, unknown>> {
  const nonNull = values.filter((value) => value !== 'null');
  const nullable = nonNull.length !== values.length;
  const sharedDescription = typeof schema.description === 'string' ? { description: schema.description } : {};
  let candidate: Record<string, unknown>;
  if (values.length === 1 && isCollectionSchema(nonNull[0])) {
    candidate = { ...schemaWithoutTypeStructure(schema), ...nonNull[0], ...sharedDescription };
  } else {
    const nextType = values.length === 1 ? values[0] : values;
    candidate = isCollectionSchema(schema) ? { ...sharedDescription, type: nextType } : { ...schema, type: nextType };
    if (nullable || nonNull.some(isCollectionSchema)) {
      delete candidate.items;
      delete candidate.values;
    }
  }
  if (JSON.stringify(schema.type) !== JSON.stringify(candidate.type)) delete candidate.$extends;
  return normalizeInlineTypeSchema(candidate);
}

function schemaWithoutTypeStructure(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...schema };
  delete result.type;
  delete result.items;
  delete result.values;
  return result;
}

function normalizeInlineTypeSchema(candidate: Record<string, unknown>): Record<string, unknown> {
  const next = { ...candidate };
  const type = typeof next.type === 'string' ? next.type : undefined;
  for (const keyword of ['properties', 'required', 'additionalProperties', 'items', 'values', 'tuple', 'choices', 'selector']) delete next[keyword];
  if (type === 'object' || type === 'tuple') {
    next.properties = isSchemaRecord(candidate.properties) ? candidate.properties : {};
    if (type === 'object') {
      if (candidate.required !== undefined) next.required = candidate.required;
      if (candidate.additionalProperties !== undefined) next.additionalProperties = candidate.additionalProperties;
    } else {
      const order = Array.isArray(candidate.tuple) ? candidate.tuple.filter((entry): entry is string => typeof entry === 'string') : Object.keys(next.properties as object);
      next.tuple = order.filter((name) => Object.prototype.hasOwnProperty.call(next.properties, name));
    }
  } else if (type === 'array' || type === 'set') {
    if (isSchemaRecord(candidate.items)) next.items = candidate.items;
  } else if (type === 'map') {
    if (isSchemaRecord(candidate.values)) next.values = candidate.values;
  }
  else if (type === 'choice') {
    next.choices = isSchemaRecord(candidate.choices) ? candidate.choices : {};
    if (typeof candidate.selector === 'string') next.selector = candidate.selector;
  }
  if (type !== 'object' && type !== 'tuple') {
    delete next.identity;
    delete next.relations;
    delete next.abstract;
    for (const keyword of ['coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands']) delete next[keyword];
  }
  if (type !== 'number' && type !== 'decimal') {
    delete next.precision;
    delete next.scale;
  }
  if (type !== 'string') delete next.maxLength;
  if (!type || !['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'].includes(type)) {
    delete next.unit;
    delete next.ucumUnit;
  }
  if (type !== 'binary') {
    delete next.contentEncoding;
    delete next.contentCompression;
    delete next.contentMediaType;
  }
  if (type === undefined) {
    for (const keyword of VALIDATION_KEYWORDS) if (keyword !== 'default') delete next[keyword];
    delete next.enum;
    delete next.const;
  } else {
    for (const issue of validationIssues(next, { types: [type], determinate: true })) delete next[issue.keyword];
    if (Array.isArray(next.enum) && !next.enum.every((value) => coreScalarValueValid(type, value, next))) delete next.enum;
    if (Object.prototype.hasOwnProperty.call(next, 'const') && !coreScalarValueValid(type, next.const, next)) delete next.const;
  }
  if (!Array.isArray(next.enum)) delete next.altenums;
  return next;
}

function propertyDetailsPanel(row: PropertyRow, id: string, document?: unknown, pendingPropertyFields: ReadonlySet<string> = new Set(), definitions: readonly { readonly name: string; readonly pointer: string }[] = []): string {
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
  const validation = propertyDetailFields(schema, validationFields, row.pointer, 'validation', pendingPropertyFields);
  const annotations = propertyDetailFields(schema, annotationFields, row.pointer, 'annotation', pendingPropertyFields);
  const structured = structuredFields.filter(([keyword]) => schema[keyword] !== undefined || pendingPropertyFields.has(inlineFieldKey(row.pointer, inlineKeywordActionId('annotation', keyword)))).map(([keyword, label]) => propertyJsonField(row.pointer, keyword, label, schema[keyword], pendingPropertyFields.has(inlineFieldKey(row.pointer, inlineKeywordActionId('annotation', keyword))))).join('');
  const validationCount = validationFields.filter(([keyword]) => schema[keyword] !== undefined).length;
  const annotationCount = annotationFields.filter(([keyword]) => schema[keyword] !== undefined).length + structuredFields.filter(([keyword]) => schema[keyword] !== undefined).length;
  const validationAdd = propertyDetailAddControl(schema, row.pointer, validationFields.map(([keyword, label]) => [inlineKeywordActionId('validation', keyword), keyword, label] as const), 'constraint', document, pendingPropertyFields);
  const annotationOptions = [
    ...annotationFields.map(([keyword, label]) => [inlineKeywordActionId('annotation', keyword), keyword, label] as const),
    ...structuredFields.map(([keyword, label]) => [inlineKeywordActionId('annotation', keyword), keyword, label] as const),
  ];
  const annotationAdd = propertyDetailAddControl(schema, row.pointer, annotationOptions, 'annotation', document, pendingPropertyFields);
  const represented = new Set([
    ...validationFields.map(([keyword]) => inlineKeywordActionId('validation', keyword)),
    ...annotationFields.map(([keyword]) => inlineKeywordActionId('annotation', keyword)),
    ...structuredFields.map(([keyword]) => inlineKeywordActionId('annotation', keyword)),
  ]);
  const advanced = structuredFacetEditor(row.pointer, schema, document, pendingPropertyFields, represented, definitions);
  return `<section class="js-property-details" id="${id}" aria-label="Validation and annotations for ${escapeAttribute(row.name)}"><div class="js-property-detail-columns"><section class="js-property-detail-group" aria-labelledby="${id}-constraints"><header><strong id="${id}-constraints">Validation constraints</strong><span>${validationCount}</span></header><div class="js-property-detail-fields">${validation || '<p class="js-detail-empty">No constraints</p>'}</div>${validationAdd}</section><section class="js-property-detail-group" aria-labelledby="${id}-annotations"><header><strong id="${id}-annotations">Annotations</strong><span>${annotationCount}</span></header><div class="js-property-detail-fields">${annotations}${structured || (!annotations ? '<p class="js-detail-empty">No annotations</p>' : '')}</div>${annotationAdd}</section></div>${advanced}<p class="js-inline-status" data-inline-status="${escapeAttribute(row.pointer)}" role="status" aria-live="polite"></p></section>`;
}

function propertyDetailFields(schema: Readonly<Record<string, unknown>>, fields: readonly (readonly [string, string, 'text' | 'number' | 'integer' | 'boolean'])[], pointer: string, family: string, pendingPropertyFields: ReadonlySet<string>): string {
  return fields.filter(([keyword]) => schema[keyword] !== undefined || pendingPropertyFields.has(inlineFieldKey(pointer, inlineKeywordActionId(family, keyword)))).map(([keyword, label, kind]) => {
    const value = schema[keyword];
    const actionId = inlineKeywordActionId(family, keyword);
    const pending = value === undefined && pendingPropertyFields.has(inlineFieldKey(pointer, actionId));
    const removeAction = `${inlineKeywordActionId(family, keyword)}.remove`;
    const removeButton = pending ? pendingPropertyFieldRemoveButton(pointer, actionId, label) : propertyDetailRemoveButton(pointer, removeAction, label);
    if (kind === 'boolean') return `<div class="js-detail-field" data-inline-field-action="${escapeAttribute(actionId)}"><label class="js-detail-check"><input type="checkbox" data-inline-keyword="${keyword}" data-inline-family="${family}" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="boolean" ${value === true ? 'checked' : ''}> ${label}</label>${removeButton}</div>`;
    const action = actionById(actionId);
    const catalog = action && catalogFamilyForAction(action);
    const stringBacked = action?.control?.kind === 'number' && action.control.schemaNumeric && stringBackedNumericType(typeof schema.type === 'string' ? schema.type : undefined);
    const numericInput = kind === 'number' || kind === 'integer';
    const input = `<input data-inline-keyword="${keyword}" data-inline-family="${family}" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="${kind}" ${catalog ? 'data-catalog-value ' : ''}type="${numericInput && !stringBacked ? 'number' : 'text'}" ${kind === 'integer' ? 'step="1" min="0"' : kind === 'number' && !stringBacked ? 'step="any"' : stringBacked ? 'inputmode="decimal"' : ''} value="${escapeAttribute(value === undefined ? '' : String(value))}">`;
    const field = catalog ? `<label data-inline-catalog="${escapeAttribute(action.id)}" data-property-pointer="${escapeAttribute(pointer)}">${label}<span class="js-detail-json">${input}<button type="button" data-inline-browse="${keyword}" data-catalog-open aria-label="Browse ${escapeAttribute(label.toLocaleLowerCase())} catalog">Browse</button></span><small class="js-detail-provenance" data-catalog-provenance>Catalog suggestions are advisory.</small></label>` : `<label>${label}${input}</label>`;
    return `<div class="js-detail-field" data-inline-field-action="${escapeAttribute(actionId)}">${field}${removeButton}</div>`;
  }).join('');
}

function propertyJsonField(pointer: string, keyword: string, label: string, value: unknown, pending: boolean): string {
  const action = actionById(inlineKeywordActionId('annotation', keyword));
  const catalog = action && catalogFamilyForAction(action);
  const raw = value === undefined ? '' : JSON.stringify(value);
  const summary = structuredValueLabel(value);
  const remove = propertyDetailRemoveButton(pointer, `${inlineKeywordActionId('annotation', keyword)}.remove`, label);
  const actionId = inlineKeywordActionId('annotation', keyword);
  const removeButton = pending ? pendingPropertyFieldRemoveButton(pointer, actionId, label) : remove;
  if (!catalog) return `<div class="js-detail-field" data-inline-field-action="${escapeAttribute(actionId)}"><label>${escapeHtml(label)}<textarea data-inline-keyword="${escapeAttribute(keyword)}" data-inline-family="annotation" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="json" rows="3" placeholder="Enter JSON">${escapeHtml(raw)}</textarea></label>${removeButton}</div>`;
  const input = `<input type="hidden" data-inline-keyword="${keyword}" data-inline-family="annotation" data-property-pointer="${escapeAttribute(pointer)}" data-value-kind="json" data-catalog-value value="${escapeAttribute(raw)}"><input data-catalog-display value="${escapeAttribute(summary)}" readonly aria-label="${escapeAttribute(label)}">`;
  return `<div class="js-detail-field" data-inline-field-action="${escapeAttribute(actionId)}"><label data-inline-catalog="${escapeAttribute(action.id)}" data-property-pointer="${escapeAttribute(pointer)}">${label}<span class="js-detail-json">${input}<button type="button" data-inline-browse="${keyword}" data-catalog-open aria-label="Browse ${escapeAttribute(label.toLocaleLowerCase())} catalog">Browse</button></span><small class="js-detail-provenance" data-catalog-provenance>Catalog suggestions are advisory.</small></label>${removeButton}</div>`;
}

function propertyDetailAddControl(schema: Readonly<Record<string, unknown>>, pointer: string, fields: readonly (readonly [string, string, string])[], kind: string, document: unknown, pendingPropertyFields: ReadonlySet<string>): string {
  const options = fields.filter(([actionId, keyword]) => {
    const action = actionById(actionId);
    if (schema[keyword] !== undefined || pendingPropertyFields.has(inlineFieldKey(pointer, actionId)) || !action) return false;
    if (document === undefined) return true;
    const availability = actionAvailability(action, pointer, document);
    return availability.enabled || availability.reason?.startsWith('Activate ') === true;
  }).map(([actionId, , label]) => `<option value="${escapeAttribute(actionId)}">${escapeHtml(label)}</option>`).join('');
  if (!options) return '';
  return `<div class="js-detail-add"><label>Add ${escapeHtml(kind)}<select data-property-detail-select><option value="">Choose ${escapeHtml(kind)}</option>${options}</select></label><button type="button" data-property-detail-add data-property-pointer="${escapeAttribute(pointer)}">Add</button></div>`;
}

function propertyDetailRemoveButton(pointer: string, actionId: string, label: string): string {
  return `<button class="js-detail-remove" type="button" data-inline-keyword-remove="${escapeAttribute(actionId)}" data-property-pointer="${escapeAttribute(pointer)}" aria-label="Remove ${escapeAttribute(label.toLocaleLowerCase())}">Remove</button>`;
}

function pendingPropertyFieldRemoveButton(pointer: string, actionId: string, label: string): string {
  return `<button class="js-detail-remove" type="button" data-inline-pending-remove="${escapeAttribute(inlineFieldKey(pointer, actionId))}" aria-label="Cancel adding ${escapeAttribute(label.toLocaleLowerCase())}">Cancel</button>`;
}

function inlineFieldKey(pointer: string, actionId: string): string {
  return `${pointer}\u0000${actionId}`;
}

function autoGrowTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function inlineRelationDraft(definitions: readonly { readonly name: string; readonly pointer: string; readonly identity?: readonly string[] }[], document: unknown): string {
  const targets = definitions.filter((definition) => definition.identity?.length);
  const scopes = collectionPointers(document);
  return `<div class="js-inline-relation-draft">
    <input data-inline-relation-name class="js-code" placeholder="relation_name" aria-label="Relation name">
    <select data-inline-relation-target aria-label="Target type"><option value="">Choose target type</option>${targets.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}">${escapeHtml(definition.name)}</option>`).join('')}</select>
    <select data-inline-relation-cardinality aria-label="Cardinality"><option value="single">single</option><option value="multiple">multiple</option></select>
    <select data-inline-relation-scope aria-label="Scope"><option value="">Context scope</option>${scopes.map((scope) => `<option value="${escapeAttribute(scope)}">${escapeHtml(scope)}</option>`).join('')}</select>
    <span class="js-inline-relation-actions"><button type="button" data-inline-relation-cancel>Cancel</button><button type="button" data-inline-relation-commit ${targets.length ? '' : 'disabled'}>Add</button></span>
    <span class="js-inline-status" data-inline-relation-status role="status" aria-live="polite">${targets.length ? '' : 'Create an identity on a target type before adding a relation.'}</span>
  </div>`;
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

function displayPropertyValueTypes(schema: Readonly<Record<string, unknown>>): string {
  if (isCollectionSchema(schema)) return schemaExpressionLabel(schema);
  const values = Array.isArray(schema.type) ? schema.type.filter((value) => value !== 'null') : schema.type === 'null' ? [] : [schema.type];
  return values.length ? values.map(schemaExpressionLabel).join(' or ') : 'null only';
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

function setTypeCreatorStatus(root: HTMLElement, message: string): void {
  const status = root.querySelector('[data-type-create-status]');
  if (status) status.textContent = message;
}

function setDocumentMemberStatus(root: HTMLElement, member: string, message: string): void {
  const status = root.querySelector('[data-document-member-status]');
  if (status) status.textContent = `${member}: ${message}`;
}

export function graphView(graphOrSnapshot: ReturnType<typeof projectGraph> | DocumentSnapshot, navigationOrSelected: GraphNavigationController | string | undefined, selectedPointerOverride?: string | undefined): string {
  const isSnapshot = 'model' in graphOrSnapshot;
  const sourceGraph: ReturnType<typeof projectGraph> = isSnapshot ? projectGraph(graphOrSnapshot as DocumentSnapshot) : graphOrSnapshot as ReturnType<typeof projectGraph>;
  const semanticView: SemanticGraphView | undefined = isSnapshot ? semanticGraphBySnapshot.get(graphOrSnapshot as DocumentSnapshot)?.view() : undefined;
  const graph = semanticView?.projection ?? sourceGraph;
  const navigation: GraphNavigationController = isSnapshot ? graphNavigationBySnapshot.get(graphOrSnapshot as DocumentSnapshot) ?? new GraphNavigationController() : navigationOrSelected as GraphNavigationController;
  const layout = isSnapshot ? forceGraphLayoutBySnapshot.get(graphOrSnapshot as DocumentSnapshot) ?? new ForceGraphLayout() : new ForceGraphLayout();
  const minimapLayout = isSnapshot ? forceGraphMinimapLayoutBySnapshot.get(graphOrSnapshot as DocumentSnapshot) ?? new ForceGraphLayout() : layout;
  const selectedPointer = semanticView?.selection?.pointer ?? (isSnapshot ? navigationOrSelected as string | undefined : selectedPointerOverride);
  const layoutPositions = layout.reconcile(graph.nodes, graph.edges, semanticView ? forceGraphOptions(semanticView) : undefined);
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const positions = layoutPositions.map((position) => ({ ...graphNodes.get(position.id)!, ...position }));
  const position = new Map(positions.map((node) => [node.id, node]));
  const bounds = layout.contentBounds();
  const width = bounds.width; const height = bounds.height; navigation.setContent({ x: 0, y: 0, width, height }); const state = navigation.snapshot();
  const minimapPositions = minimapLayout.reconcile(sourceGraph.nodes, sourceGraph.edges, { cacheKey: 'full-document', mode: 'relations' });
  const minimapBounds = minimapLayout.contentBounds();
  const minimap = navigation.minimap(minimapPositions);
  const transform = `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.zoom})`;
  const minimapViewport = clampMinimapViewport(minimap.viewport, width, height);
  const labelRuntime = new GraphRuntime({
    nodes: positions.map((node) => ({ id: node.id, position: { x: node.x + node.width / 2, y: node.y + node.height / 2 }, width: node.width, height: node.height })),
    edges: graph.edges.filter((edge) => position.has(edge.from) && position.has(edge.to)).map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label })),
  });
  const labelLanes = new Map(labelRuntime.assignEdgeLabelLanes().map((lane) => [lane.edgeId, lane.lane]));
  const selectedNodeId = semanticView?.selection?.kind !== 'relation' ? semanticView?.selection?.nodeId as string | undefined : undefined;
  const selectedEdgeId = semanticView?.selection?.kind === 'relation' || semanticView?.selection?.kind === 'source' ? semanticView.selection.nodeId as string | undefined : undefined;
  const searchMatches = new Set(semanticView?.searchMatches ?? []);
  const nodeLimit = state.semanticZoom === 'overview' ? 350 : state.semanticZoom === 'labels' ? 700 : 1_000;
  const viewportGraph = labelRuntime.queryViewport(navigation.minimap().viewport, { semanticLevel: state.semanticZoom, padding: 260, maxNodes: nodeLimit });
  const visibleNodeIds = graph.nodes.length <= nodeLimit ? new Set(graph.nodes.map((node) => node.id)) : new Set(viewportGraph.nodes.map((node) => node.id));
  if (selectedNodeId) visibleNodeIds.add(selectedNodeId);
  for (const id of searchMatches) visibleNodeIds.add(id);
  const renderPositions = positions.filter((node) => visibleNodeIds.has(node.id));
  const edgeLimit = state.semanticZoom === 'overview' ? 800 : state.semanticZoom === 'labels' ? 2_500 : 5_000;
  const renderEdges = graph.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .sort((left, right) => graphRenderPriority(right, selectedEdgeId, searchMatches) - graphRenderPriority(left, selectedEdgeId, searchMatches) || left.id.localeCompare(right.id))
    .slice(0, edgeLimit);
  const relationByPointer = new Map(renderEdges.filter((edge) => edge.kind === 'relation' && edge.relationPointer).map((edge) => [edge.relationPointer!, edge]));
  const edges = renderEdges.map((edge) => renderGraphEdge(edge, position, labelLanes.get(edge.id) ?? 0, edge.id === selectedEdgeId, edge.relationPointer ? relationByPointer.get(edge.relationPointer) : undefined, searchMatches.has(edge.from) || searchMatches.has(edge.to))).join('');
  const rovingNodeId = selectedNodeId ?? renderPositions.find((node) => !node.contextDimmed && node.selectable !== false)?.id;
  const nodes = renderPositions.map((node) => renderGraphNode(node, selectedPointer, state.semanticZoom, node.id === selectedNodeId, searchMatches.has(node.id), node.id === rovingNodeId)).join('') || '<text x="30" y="50">No types in the current viewport.</text>';
  const namespaceFrames = semanticView && (semanticView.location.lens === 'namespaces' || semanticView.location.level === 'types') ? renderNamespaceFrames(renderPositions) : '';
  if (!isSnapshot) layout.dispose();
  const semanticToolbar = semanticView
    ? renderSemanticGraphToolbar(semanticView, state.camera.zoom, isSnapshot ? documentNameFromUri((graphOrSnapshot as DocumentSnapshot).uri) : 'Schema')
    : `<div class="js-graph-toolbar"><button data-graph-fit title="Fit level">Fit level</button><button data-graph-relayout title="Release pinned nodes and arrange automatically" aria-label="Auto arrange">${fluentIcon('arrowSync')}</button><span class="js-spacer"></span><button data-graph-zoom-out aria-label="Zoom out">${fluentIcon('subtract')}</button><span data-semantic-zoom>${Math.round(state.camera.zoom * 100)}%</span><button data-graph-zoom-in aria-label="Zoom in">${fluentIcon('add')}</button></div>`;
  const graphLabel = semanticView ? `${semanticView.title}. ${semanticView.description}` : `Type relationship graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`;
  const selectedNode = selectedNodeId ? graph.nodes.find((node) => node.id === selectedNodeId) : undefined;
  const selectedEdge = selectedEdgeId ? graph.edges.find((edge) => edge.id === selectedEdgeId) : undefined;
  const graphDocument = isSnapshot && (graphOrSnapshot as DocumentSnapshot).recovery === 'valid' ? JSON.parse((graphOrSnapshot as DocumentSnapshot).text) : undefined;
  const graphInspector = semanticView ? renderGraphInspector(semanticView, selectedNode, selectedEdge, graphDocument) : '';
  const sourceNodes = new Map(sourceGraph.nodes.map((node) => [node.id, node]));
  const minimapMarkup = `<aside class="js-minimap-wrap" aria-label="Graph minimap"><div class="js-minimap-head"><span>Whole document</span><span>${escapeHtml(semanticView?.location.level ?? 'Graph')}</span></div><svg class="js-minimap" viewBox="0 0 180 120" data-minimap><rect width="180" height="120"></rect><g data-minimap-nodes>${minimap.nodes.map((node, index) => {
    const position = minimapPositions[index]!;
    const sourceNode = sourceNodes.get(position.id);
    const stateClass = sourceNode?.kind === 'document' ? ' js-minimap-root' : sourceNode?.status === 'external' ? ' js-minimap-external' : '';
    const selectedClass = sourceNode?.id === selectedNodeId ? ' js-minimap-selected' : '';
    return `<rect class="js-minimap-node${stateClass}${selectedClass}" data-minimap-node="${escapeAttribute(position.id)}" x="${node.x / minimapBounds.width * 180}" y="${node.y / minimapBounds.height * 120}" width="${Math.max(3, node.width / minimapBounds.width * 180)}" height="${Math.max(3, node.height / minimapBounds.height * 120)}"></rect>`;
  }).join('')}</g><rect class="js-minimap-viewport" data-minimap-viewport x="${minimapViewport.x}" y="${minimapViewport.y}" width="${minimapViewport.width}" height="${minimapViewport.height}"></rect></svg></aside>`;
  const levelBanner = semanticView ? `<div class="js-graph-level-banner"><span>Level ${semanticView.location.level === 'atlas' ? '1' : semanticView.location.level === 'types' ? '2' : '3'} · ${escapeHtml(semanticView.location.level)}</span><strong>${escapeHtml(semanticView.title)}</strong><small>${escapeHtml(semanticView.description)}</small></div>` : '';
  const hint = semanticView ? `<div class="js-graph-hint">${escapeHtml(graphHint(semanticView))}</div>` : '';
  return `${semanticToolbar}<div class="js-graph-workspace"><section class="js-graph-viewport">${levelBanner}<svg class="js-graph-canvas" data-graph-canvas data-search-active="${Boolean(semanticView?.searchQuery.trim())}" data-semantic-zoom="${state.semanticZoom}" viewBox="0 0 ${width} ${height}" tabindex="0" role="group" aria-label="${escapeAttribute(graphLabel)}. Press Enter to drill in, Escape to drill out, wheel or pinch to zoom, and drag to pan."><defs><marker id="js-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="currentColor"></path></marker></defs><g data-graph-world transform="${transform}"><g data-namespace-frames>${namespaceFrames}</g><g data-graph-edges>${edges}</g><g data-graph-nodes>${nodes}</g></g></svg>${hint}${minimapMarkup}</section>${graphInspector}</div>`;
}

function renderSemanticGraphToolbar(view: SemanticGraphView, zoom: number, documentTitle: string): string {
  const breadcrumbs = [{ label: documentTitle, level: 'atlas' as const }, ...view.breadcrumbs.slice(1)].map((crumb, index, values) => `<button data-graph-breadcrumb="${crumb.level}" ${index === values.length - 1 ? 'aria-current="page"' : ''}>${escapeHtml(crumb.label)}</button>${index < values.length - 1 ? `<span aria-hidden="true">${fluentIcon('chevronRight', 'js-chevron')}</span>` : ''}`).join('');
  const history = `<details class="js-graph-history-menu"><summary>History</summary><div class="js-graph-history">${view.recentPath.map((entry) => `<button data-graph-history="${entry.index}" aria-current="${entry.current}"><span class="js-history-dot"></span><span>${escapeHtml(entry.label)}</span>${entry.current ? '<small>current</small>' : ''}</button>`).join('')}</div></details>`;
  const legend = `<details class="js-graph-legend"><summary>Layers</summary><div role="group" aria-label="Graph layer presets">${(['relations', 'inheritance', 'data-shape', 'imports', 'diagnostics', 'everything'] as const).map((preset) => `<button data-graph-layer="${preset}" aria-pressed="${preset === 'everything'}">${preset === 'data-shape' ? 'Data shape' : preset[0]!.toLocaleUpperCase() + preset.slice(1)}</button>`).join('')}</div></details>`;
  return `<div class="js-graph-toolbar"><button data-graph-back title="Back" aria-label="Back" ${view.canBack ? '' : 'disabled'}>${fluentIcon('arrowLeft')}</button><button data-graph-forward title="Forward" aria-label="Forward" ${view.canForward ? '' : 'disabled'}>${fluentIcon('arrowRight')}</button><button data-graph-home title="Schema atlas" aria-label="Schema atlas">${fluentIcon('home')}</button>${history}${legend}<span class="js-graph-divider"></span><nav class="js-graph-crumbs" aria-label="Graph location">${breadcrumbs}</nav>${renderGraphLensBar(view)}<span class="js-spacer"></span><label class="js-graph-search"><span class="js-sr-only">Find type or relation</span><input type="search" data-graph-search value="${escapeAttribute(view.searchQuery)}" placeholder="Find type or relation"></label><span class="js-graph-divider"></span><button data-graph-reveal title="Reveal selection">Reveal</button><button data-graph-relayout title="Release pinned nodes and arrange automatically" aria-label="Auto arrange">${fluentIcon('arrowSync')}</button><button data-graph-reset-view title="Reset camera to 100%">Reset</button><button data-graph-zoom-out title="Zoom out" aria-label="Zoom out">${fluentIcon('subtract')}</button><span data-semantic-zoom>${Math.round(zoom * 100)}%</span><button data-graph-zoom-in title="Zoom in" aria-label="Zoom in">${fluentIcon('add')}</button><button data-graph-fit title="Fit current level" aria-label="Fit current level">Fit level</button><button data-graph-fit-all title="Fit all at schema atlas">Fit all</button></div>`;
}

function renderGraphLensBar(view: SemanticGraphView): string {
  const lenses: readonly { readonly id: import('../graph.js').ProjectionId; readonly label: string }[] = [
    { id: 'namespaces', label: 'Namespaces' }, { id: 'relations', label: 'Relations' }, { id: 'extends', label: 'Extends' }, { id: 'imports', label: 'Imports' },
  ];
  const lensMarkup = lenses.map((lens) => `<button data-graph-lens="${lens.id}" aria-pressed="${view.location.lens === lens.id}">${lens.label}</button>`).join('');
  const directionMarkup = view.location.lens === 'relations'
    ? `<span class="js-graph-direction-label">Direction</span><div class="js-graph-directions" role="group" aria-label="Relation direction">${(['outgoing', 'incoming', 'both'] as const).map((direction) => `<button data-graph-direction="${direction}" aria-pressed="${view.direction === direction}" title="Show ${direction} relation links">${direction === 'outgoing' ? 'Outgoing' : direction === 'incoming' ? 'Incoming' : 'Both'}</button>`).join('')}</div>`
    : '';
  const neighborhood = view.location.level === 'neighborhood'
    ? `<div class="js-graph-hops" role="group" aria-label="Neighborhood depth">${([1, 2] as const).map((hops) => `<button data-graph-hop="${hops}" aria-pressed="${(view.location.hops ?? 1) === hops}">${hops}-hop</button>`).join('')}<button data-graph-isolate aria-pressed="${Boolean(view.location.isolate)}">Isolate</button></div>`
    : '';
  return `<div class="js-graph-lenses" role="group" aria-label="Graph lens">${lensMarkup}${directionMarkup}${neighborhood}</div>`;
}

function renderGraphInspector(view: SemanticGraphView, node: ReturnType<typeof projectGraph>['nodes'][number] | undefined, edge: ReturnType<typeof projectGraph>['edges'][number] | undefined, document?: unknown): string {
  const selectionKind = edge ? edge.kind === 'relation' ? 'Relation' : 'Graph link' : node?.kind === 'namespace' ? 'Namespace' : node?.kind === 'document' ? 'Document root' : node ? 'Type' : 'Graph';
  const title = edge?.label ?? node?.label ?? view.title;
  const description = edge
    ? `${pointerLabel(edge.from)} → ${pointerLabel(edge.to)}${edge.target ? ` · ${edge.target}` : ''}`
    : node ? `${node.namespace || 'Document'} · ${node.status ?? 'resolved'}` : view.description;
  const related = view.projection.edges.filter((candidate) => candidate.from === node?.id || candidate.to === node?.id).slice(0, 12);
  const selectedEdges = view.selectedEdges ?? [];
  const selectedEdgeDetails = selectedEdges.length > 1
    ? `<div class="js-graph-selected-edges" aria-label="Links represented by this bundle">${selectedEdges.map((candidate) => `<div><strong>${escapeHtml(candidate.relationName ?? candidate.label)}${candidate.cardinality ? ` · ${candidate.cardinality}` : ''}</strong><small>${escapeHtml([candidate.pointer, candidate.targetIdentity?.reference, candidate.documentUri, candidate.provenance].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>`
    : '';
  const relationSemantics = edge && (edge.kind === 'relation' || edge.kind === 'relation-qualifier')
    ? `<dl class="js-graph-semantics"><dt>Declaring source</dt><dd>${escapeHtml(edge.declaringSource ?? edge.from)}</dd><dt>Relation pointer</dt><dd>${escapeHtml(edge.relationPointer ?? edge.pointer ?? 'bundle')}</dd><dt>Target reference</dt><dd>${escapeHtml(edge.targetIdentity?.reference ?? edge.target ?? edge.to)}</dd><dt>Target identity</dt><dd>${escapeHtml(edge.targetIdentityProperties?.join(', ') ?? 'unresolved')}</dd><dt>Cardinality</dt><dd>${escapeHtml(edge.cardinality ?? 'unknown')}</dd><dt>Scopes</dt><dd>${escapeHtml(edge.normalizedScopes?.map((scope) => scope || '#').join(', ') ?? 'unscoped')} (${escapeHtml(edge.scopeForm ?? 'none')})</dd><dt>Qualifier</dt><dd>${escapeHtml(edge.qualifierReference ?? 'none')}</dd><dt>Status</dt><dd>${escapeHtml(edge.reason ?? edge.status ?? 'resolved')}</dd></dl>`
    : '';
  const relationList = related.length
    ? related.map((candidate) => `<button data-graph-edge-select="${escapeAttribute(candidate.id)}"><span><strong>${escapeHtml(candidate.label)}</strong><small>${escapeHtml(pointerLabel(candidate.to === node?.id ? candidate.from : candidate.to))}</small></span><em>${candidate.kind}</em></button>`).join('')
    : '<p>No related links in this view.</p>';
  const authoring = (edge?.kind === 'relation' || edge?.kind === 'relation-qualifier') && edge.pointer
    ? `<button data-graph-edit-relation="${escapeAttribute(edge.pointer)}">Edit relation</button><button class="js-danger" data-graph-delete-relation="${escapeAttribute(edge.pointer)}">Delete relation</button>`
    : edge?.kind === 'reference' && edge.pointer
      ? `<button data-graph-edit-reference="${escapeAttribute(edge.pointer)}">Edit reference type</button>`
      : node?.kind === 'type' && node.pointer && ['object', 'tuple'].includes(String((valueAtPointer(document, node.pointer) as Record<string, unknown> | undefined)?.type))
        ? `<button data-graph-add-relation="${escapeAttribute(node.pointer)}">Add relation</button>`
        : '';
  const matrixColumns: readonly { readonly id: import('./semantic-graph.js').GraphRelationMatrixSort; readonly label: string }[] = [
    { id: 'source', label: 'Source' }, { id: 'relation', label: 'Relation' }, { id: 'target', label: 'Target' }, { id: 'identity', label: 'Identity' },
    { id: 'cardinality', label: 'Cardinality' }, { id: 'scope', label: 'Scope' }, { id: 'qualifier', label: 'Qualifier' }, { id: 'diagnostic', label: 'Diagnostic' },
  ];
  const matrixWindowSize = 200;
  const matrixOffset = Math.min(view.relationMatrixOffset, Math.max(0, view.relationMatrix.length - 1));
  const matrixRows = view.relationMatrix.slice(matrixOffset, matrixOffset + matrixWindowSize).map((candidate) => `<button role="row" data-graph-edge-select="${escapeAttribute(candidate.id)}" aria-selected="${candidate.id === edge?.id}"><span role="cell">${escapeHtml(pointerLabel(candidate.declaringSource ?? candidate.from))}</span><span role="cell">${escapeHtml(candidate.relationName ?? candidate.label)}</span><span role="cell">${escapeHtml(pointerLabel(candidate.targetIdentity?.pointer ?? candidate.to))}</span><span role="cell">${escapeHtml(candidate.targetIdentityProperties?.join(', ') ?? 'unresolved')}</span><span role="cell">${escapeHtml(candidate.cardinality ?? 'unknown')}</span><span role="cell">${escapeHtml(candidate.normalizedScopes?.map((scope) => scope || '#').join(', ') ?? 'unscoped')}</span><span role="cell">${escapeHtml(candidate.qualifierReference ?? 'none')}</span><span role="cell">${escapeHtml(candidate.reason ?? candidate.status ?? 'resolved')}</span></button>`).join('');
  const matrixWindow = view.relationMatrix.length > matrixWindowSize
    ? `<div class="js-relation-matrix-window"><button data-graph-matrix-page="previous" ${matrixOffset === 0 ? 'disabled' : ''}>Previous</button><span>${matrixOffset + 1}–${Math.min(view.relationMatrix.length, matrixOffset + matrixWindowSize)} of ${view.relationMatrix.length}</span><button data-graph-matrix-page="next" ${matrixOffset + matrixWindowSize >= view.relationMatrix.length ? 'disabled' : ''}>Next</button></div>`
    : '';
  const matrix = view.location.lens === 'relations'
    ? `<details class="js-relation-matrix" open><summary>Relation matrix <span>${view.relationMatrix.length}</span></summary>${matrixWindow}<div class="js-relation-matrix-scroll" role="table" aria-rowcount="${view.relationMatrix.length}" aria-colcount="${matrixColumns.length}" data-virtual-offset="${matrixOffset}"><div class="js-relation-matrix-head" role="row">${matrixColumns.map((column) => `<button role="columnheader" data-graph-matrix-sort="${column.id}" aria-sort="${view.relationMatrixSort === column.id ? view.relationMatrixAscending ? 'ascending' : 'descending' : 'none'}">${column.label}</button>`).join('')}</div>${matrixRows || '<p>No authored relations.</p>'}</div></details>`
    : '';
  return `<aside class="js-graph-inspector" aria-label="Graph selection details"><div class="js-graph-panel-title">Details <span>${selectionKind}</span></div><header><span>${escapeHtml(view.location.lens)} · ${escapeHtml(view.location.level)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></header>${selectedEdgeDetails}${relationSemantics}<div class="js-graph-panel-section"><div class="js-graph-metrics"><div><strong>${view.projection.nodes.length}</strong><span>visible nodes</span></div><div><strong>${view.projection.edges.length}</strong><span>visible links</span></div></div></div><div class="js-graph-panel-title">Related in view</div><div class="js-graph-panel-section js-graph-related">${relationList}</div><div class="js-graph-panel-section js-graph-inspector-actions">${authoring}<button data-graph-open-selection ${view.location.lens === 'relations' && view.location.level !== 'neighborhood' ? '' : 'disabled'}>Drill into selection</button></div>${matrix}</aside>`;
}

function graphReferenceEditPointer(pointer: string): string {
  const typeIndex = pointer.lastIndexOf('/type');
  if (typeIndex >= 0 && /\/type(?:\/\d+)?\/\$ref$/.test(pointer)) return pointer.slice(0, typeIndex);
  return pointer.replace(/\/\$ref$/, '');
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

function semanticGraphLocationKey(view: SemanticGraphView): string {
  const location = view.location;
  return [location.lens, location.level, location.namespace ?? '', location.focusNodeId ?? '', location.direction ?? 'outgoing', location.hops ?? 1, Boolean(location.isolate)].join('\u0000');
}

function forceGraphOptions(view: SemanticGraphView): ForceGraphLayoutOptions {
  const location = view.location;
  return {
    cacheKey: semanticGraphLocationKey(view),
    mode: location.level === 'neighborhood'
      ? 'neighborhood'
      : location.lens === 'extends'
        ? 'extends'
        : location.lens === 'namespaces'
          ? 'namespaces'
          : location.lens === 'imports'
            ? 'imports'
            : 'relations',
    focusNodeId: location.focusNodeId,
    direction: view.direction,
  };
}

type PositionedGraphNode = ReturnType<typeof projectGraph>['nodes'][number] & ForceGraphPosition;

function graphSelectionForPointer(graph: ReturnType<typeof projectGraph>, pointer: string | undefined): SelectionIdentity | undefined {
  if (pointer === undefined) return undefined;
  const node = graph.nodes.find((candidate) => candidate.pointer === pointer && candidate.selectable !== false);
  if (node) {
    const kind = node.kind === 'namespace' ? 'namespace' : node.kind === 'document' ? 'document' : 'type';
    return { kind, nodeId: node.id as NodeId, pointer: node.pointer };
  }
  const edge = graph.edges.find((candidate) => candidate.pointer === pointer && candidate.selectable !== false);
  if (!edge) return undefined;
  return { kind: edge.kind === 'relation' || edge.kind === 'relation-qualifier' ? 'relation' : 'source', nodeId: edge.id as NodeId, pointer };
}

function renderGraphEdge(edge: ReturnType<typeof projectGraph>['edges'][number], positions: ReadonlyMap<string, PositionedGraphNode>, labelLane = 0, selected = false, owningRelation?: ReturnType<typeof projectGraph>['edges'][number], searchMatch = false): string {
  const geometryEdge = edge.kind === 'relation-qualifier' && owningRelation ? owningRelation : edge;
  const from = positions.get(geometryEdge.from);
  const to = positions.get(geometryEdge.to);
  if (!from || !to) return '';
  const geometry = graphEdgePath(from, to, labelLane);
  const description = [edge.label, edge.cardinality, edge.status, edge.target, edge.documentUri, edge.provenance, edge.reason].filter(Boolean).join(' | ');
  const selectable = edge.selectable !== false;
  const interaction = selectable ? `role="button" tabindex="0" data-graph-edge-select="${escapeAttribute(edge.id)}"` : 'role="img"';
  const context = edge.contextDimmed ? ' data-graph-context="dimmed"' : '';
  if (edge.kind === 'relation-qualifier') {
    return `<g class="js-edge-group js-edge-relation-qualifier js-status-${edge.status ?? 'resolved'}" data-graph-edge="${escapeAttribute(edge.id)}" data-graph-label-lane="${labelLane}" data-search-match="${searchMatch}"${context} ${interaction} aria-current="${selected}" aria-label="${escapeAttribute(description)}"><circle class="js-qualifier-hit-target" cx="${geometry.labelX}" cy="${geometry.labelY}" r="14" aria-hidden="true"></circle><circle class="js-qualifier-marker" cx="${geometry.labelX}" cy="${geometry.labelY}" r="6"><title>${escapeHtml(`Qualified by ${edge.qualifierReference ?? edge.target ?? edge.label}`)}</title></circle></g>`;
  }
  const hitTarget = selectable ? `<path class="js-edge-hit-target" d="${geometry.path}" aria-hidden="true"></path>` : '';
  const cardinality = edge.kind === 'relation' && edge.cardinality ? `<tspan class="js-edge-cardinality"> · ${escapeHtml(edge.cardinality)}</tspan>` : '';
  const clippedLabel = clipGraphLabel(edge.label);
  return `<g class="js-edge-group js-edge-${edge.kind} js-status-${edge.status ?? 'resolved'}${edge.cardinality === 'multiple' ? ' js-edge-multiple' : ''}" data-graph-edge="${escapeAttribute(edge.id)}" data-graph-from="${escapeAttribute(edge.from)}" data-graph-to="${escapeAttribute(edge.to)}" data-graph-label-lane="${labelLane}" data-search-match="${searchMatch}" data-graph-bundle="${Boolean(edge.memberEdgeIds?.length)}"${context} ${interaction} aria-current="${selected}" aria-label="${escapeAttribute(description)}">${hitTarget}<path class="js-edge" d="${geometry.path}" marker-end="url(#js-arrow)"><title>${escapeHtml(description)}</title></path><text class="js-edge-label" x="${geometry.labelX}" y="${geometry.labelY}">${escapeHtml(clippedLabel)}${cardinality}<title>${escapeHtml(edge.label)}</title></text></g>`;
}

function renderGraphNode(node: PositionedGraphNode, selectedPointer: string | undefined, semanticZoom: string, selectedById = false, searchMatch = false, roving = false): string {
  const status = node.status ?? 'resolved';
  const description = [node.label, node.kind, status, node.documentUri, node.provenance].filter(Boolean).join(' | ');
  const interaction = node.selectable === false
    ? `role="img" aria-label="${escapeAttribute(description)}"`
    : `role="button" tabindex="${roving ? '0' : '-1'}" data-graph-select="${escapeAttribute(node.pointer)}" aria-label="${escapeAttribute(description)}" aria-current="${node.pointer === selectedPointer}"`;
  const metadata = status === 'resolved'
    ? node.kind === 'namespace' && node.memberCount !== undefined ? `${node.memberCount} types` : node.namespace
    : `${status}${node.provenance ? ` | ${node.provenance}` : ''}`;
  const selected = selectedById || (!selectedById && node.pointer === selectedPointer);
  return `<g class="js-node js-node-${node.kind} js-status-${status}" data-graph-node="${escapeAttribute(node.id)}" data-graph-pinned="${node.pinned}" data-search-match="${searchMatch}" data-rendered-semantic-zoom="${semanticZoom}"${node.contextDimmed ? ' data-graph-context="dimmed"' : ''} ${interaction} aria-current="${selected}" transform="translate(${node.x} ${node.y})"><title>${escapeHtml(description)}</title>${selected ? '<rect class="js-selected-halo" x="-6" y="-6" width="162" height="62"></rect>' : ''}<rect class="js-node-hit-target" width="150" height="50"></rect><rect class="js-node-shape" width="150" height="50"></rect><text x="12" y="22">${escapeHtml(clipGraphLabel(node.label, 24))}</text><text class="js-node-meta" x="12" y="39">${escapeHtml(metadata)}</text></g>`;
}

function clipGraphLabel(label: string, maximum = 34): string {
  return label.length <= maximum ? label : `${label.slice(0, Math.max(1, maximum - 1))}…`;
}

function renderNamespaceFrames(nodes: readonly PositionedGraphNode[]): string {
  const groups = new Map<string, PositionedGraphNode[]>();
  for (const node of nodes) {
    if (node.kind === 'document' || node.kind === 'namespace') continue;
    groups.set(node.namespace || 'Definitions', [...(groups.get(node.namespace || 'Definitions') ?? []), node]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([namespace, members]) => {
    const x = Math.min(...members.map((node) => node.x)) - 22;
    const y = Math.min(...members.map((node) => node.y)) - 34;
    const right = Math.max(...members.map((node) => node.x + node.width)) + 22;
    const bottom = Math.max(...members.map((node) => node.y + node.height)) + 22;
    return `<g class="js-namespace-frame" aria-label="${escapeAttribute(`${namespace}, ${members.length} types`)}"><rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}"></rect><text x="${x + 8}" y="${y + 18}">${escapeHtml(clipGraphLabel(namespace, 28))} · ${members.length}</text></g>`;
  }).join('');
}

function graphRenderPriority(edge: ReturnType<typeof projectGraph>['edges'][number], selectedEdgeId: string | undefined, searchMatches: ReadonlySet<string>): number {
  if (edge.id === selectedEdgeId) return 5;
  if (searchMatches.has(edge.from) || searchMatches.has(edge.to)) return 4;
  if (edge.kind === 'root') return 3;
  if (!edge.contextDimmed) return 2;
  return 1;
}

function graphFocusBounds(graph: ReturnType<typeof projectGraph>, layout: ForceGraphLayout): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const activeIds = new Set(graph.nodes.filter((node) => !node.contextDimmed).map((node) => node.id));
  const positions = layout.positions().filter((position) => activeIds.has(position.id));
  if (positions.length === 0) return { x: 0, y: 0, ...layout.contentBounds() };
  const padding = 36;
  const left = Math.min(...positions.map((position) => position.x)) - padding;
  const top = Math.min(...positions.map((position) => position.y)) - padding;
  const right = Math.max(...positions.map((position) => position.x + position.width)) + padding;
  const bottom = Math.max(...positions.map((position) => position.y + position.height)) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
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

async function mountSourceEditor(root: HTMLElement, text: string, existingModel: MonacoEditor.ITextModel | undefined, uri: string, onChange: (text: string) => void, theme: 'dark' | 'light' | 'contrast', isCurrent: () => boolean): Promise<{ editor: MonacoEditor.IStandaloneCodeEditor; model: MonacoEditor.ITextModel } | undefined> {
  const element = root.querySelector('[data-source]') as HTMLElement | null;
  if (!element) return undefined;
  const { createJsonEditor, createJsonModel } = await import('./monaco.js');
  if (!isCurrent()) return undefined;
  const model = existingModel && !existingModel.isDisposed() ? existingModel : createJsonModel(text, uri);
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
  const sourceOnly = action.control?.kind === 'source-only' || !action.control && action.requiresValue !== false;
  panel.innerHTML = `<header><div><div class="js-eyebrow">Edit ${escapeHtml(pointerLabel(pointer))}</div><h2 id="action-title">${escapeHtml(action.label)}</h2></div><button class="js-inline-close" type="button" data-cancel aria-label="Cancel" title="Cancel">${fluentIcon('dismiss')}</button></header><p id="action-help" class="js-description">${escapeHtml(action.help)}</p>${sourceOnly ? '' : nameField}${valueField}<p class="js-action-status" data-action-status role="status" aria-live="polite"></p><div class="js-actions"><button type="button" data-cancel>${sourceOnly ? 'Close' : 'Cancel'}</button>${sourceOnly ? '<button type="button" data-open-source>Open Source</button>' : '<button>Apply</button>'}</div>`;
  const activeView = [...root.querySelectorAll('.js-view')].find((view) => !(view as HTMLElement).hidden) as HTMLElement | undefined;
  if (!activeView) return;
  activeView.prepend(panel);
  const form = panel;
  const name = form.elements.namedItem('name') as HTMLInputElement | null;
  const value = form.elements.namedItem('value') as HTMLInputElement | HTMLTextAreaElement | null;
  const status = panel.querySelector('[data-action-status]') as HTMLElement;
  const clearValueCustomValidity = (): void => value?.setCustomValidity('');
  value?.addEventListener('input', clearValueCustomValidity);
  value?.addEventListener('change', clearValueCustomValidity);
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
      ? lineInput.value.split(/\r?\n/).map((entry: string) => entry.trim()).filter(Boolean).map((entry: string) => {
        if (action.keyword !== 'concepts') return entry;
        try { return JSON.parse(entry); } catch { return entry; }
      })
      : [...structuredList.querySelectorAll('option:checked')].map((entry: HTMLElement) => (entry as HTMLInputElement).value);
    hidden.value = JSON.stringify(values);
  };
  structuredList?.querySelectorAll('textarea,select').forEach((control: HTMLElement) => control.addEventListener('input', syncStructuredList));
  structuredList?.querySelectorAll('select').forEach((control: HTMLElement) => control.addEventListener('change', syncStructuredList));
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
  const typedValue = panel.querySelector('[data-typed-value]') as HTMLInputElement | null;
  const syncTypedValue = (): void => {
    if (!typedValue) return;
    const hidden = form.elements.namedItem('value') as HTMLInputElement | null;
    if (!hidden) return;
    if (typedValue.dataset.typedKind === 'boolean') hidden.value = JSON.stringify(typedValue.checked);
    else if (typedValue.dataset.typedKind === 'number' && !['int64', 'uint64', 'int128', 'uint128', 'decimal'].includes(typedValue.dataset.typedSchemaType ?? '')) hidden.value = JSON.stringify(Number(typedValue.value));
    else hidden.value = JSON.stringify(typedValue.value);
  };
  typedValue?.addEventListener('input', syncTypedValue);
  typedValue?.addEventListener('change', syncTypedValue);
  syncTypedValue();
  const schemaBranches = panel.querySelector('[data-schema-branches]');
  const syncSchemaBranches = (): void => {
    if (!schemaBranches) return;
    const values = [...schemaBranches.querySelectorAll('[data-schema-branch-value]')].map((entry) => {
      try { return JSON.parse((entry as HTMLSelectElement).value); } catch { return undefined; }
    }).filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry));
    const hidden = form.elements.namedItem('value') as HTMLInputElement | null;
    if (hidden) hidden.value = JSON.stringify(values);
  };
  schemaBranches?.querySelectorAll('[data-schema-branch-value]').forEach((control: HTMLElement) => control.addEventListener('change', syncSchemaBranches));
  schemaBranches?.querySelector('[data-schema-branch-add]')?.addEventListener('click', () => {
    if (!schemaBranches) return;
    const template = schemaBranches.querySelector('[data-schema-branch-template]') as HTMLSelectElement | null;
    if (!template || template.options.length === 0) return;
    const select = template.cloneNode(true) as HTMLSelectElement;
    select.hidden = false;
    select.removeAttribute('data-schema-branch-template');
    select.setAttribute('data-schema-branch-value', '');
    const row = document.createElement('div');
    row.setAttribute('data-schema-branch', '');
    row.innerHTML = `<label>${schemaBranches.querySelectorAll('[data-schema-branch]').length + 1}${select.outerHTML}</label>`;
    schemaBranches.insertBefore(row, template);
    row.querySelector('[data-schema-branch-value]')?.addEventListener('change', syncSchemaBranches);
    syncSchemaBranches();
  });
  syncSchemaBranches();
  const conditionalBuilder = panel.querySelector('[data-conditional-builder]');
  const syncConditionalBuilder = (): void => {
    if (!conditionalBuilder) return;
    const value: Record<string, unknown> = {};
    conditionalBuilder.querySelectorAll('[data-conditional-value]').forEach((entry: HTMLElement) => {
      const keyword = entry.getAttribute('data-conditional-value');
      const raw = (entry as HTMLSelectElement).value;
      if (!keyword || !raw) return;
      try { value[keyword] = JSON.parse(raw); } catch { /* Keep the row unset until a valid option is chosen. */ }
    });
    const hidden = form.elements.namedItem('value') as HTMLInputElement | null;
    if (hidden) hidden.value = JSON.stringify(value);
  };
  conditionalBuilder?.querySelectorAll('[data-conditional-value]').forEach((control: HTMLElement) => control.addEventListener('change', syncConditionalBuilder));
  syncConditionalBuilder();
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
    clearValueCustomValidity();
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
  let lastQuery = '';
  let selectedSuggestionIndex: number | undefined;
  let releaseTrap = (): void => undefined;
  const close = (): void => {
    if (activeRequest) catalogs.cancel(activeRequest);
    activeRequest = undefined;
    releaseTrap();
    drawer?.remove();
    drawer = undefined;
    open.focus();
  };
  const applicationValue = (value: CatalogJsonValue): { readonly value: CatalogJsonValue; readonly duplicate: boolean } => {
    if (family !== 'semanticConcept') return { value, duplicate: false };
    let current: CatalogJsonValue[] = [];
    try {
      const parsed = JSON.parse(input.value);
      if (Array.isArray(parsed)) current = parsed as CatalogJsonValue[];
    } catch {
      current = [];
    }
    const encoded = JSON.stringify(value);
    const duplicate = current.some((entry) => JSON.stringify(entry) === encoded);
    return { value: duplicate ? current : [...current, value], duplicate };
  };
  const applyValue = (value: CatalogJsonValue, label: string, source: string): void => {
    const application = applicationValue(value);
    if (application.duplicate) {
      status.textContent = 'That exact concept is already selected.';
      return;
    }
    input.value = typeof application.value === 'string' ? application.value : JSON.stringify(application.value);
    if (display) display.value = family === 'semanticConcept' && Array.isArray(application.value)
      ? `${application.value.length} concept${application.value.length === 1 ? '' : 's'}`
      : label;
    provenance.textContent = source;
    close();
    onValueSelected?.();
  };
  const selectionPreview = (): CatalogSelectionPreview | undefined => {
    const suggestion = selectedSuggestionIndex === undefined ? undefined : lastResult?.suggestions[selectedSuggestionIndex];
    if (!suggestion || selectedSuggestionIndex === undefined) return undefined;
    const application = applicationValue(suggestion.value);
    return { suggestionIndex: selectedSuggestionIndex, emittedJson: JSON.stringify(application.value), duplicate: application.duplicate };
  };
  const renderDrawer = (): void => {
    if (!drawer || !lastResult) return;
    const manifests = catalogs.listProviders().filter((provider) => provider.families.includes(family));
    const query = (drawer.querySelector('[data-catalog-query]') as HTMLInputElement | null)?.value ?? lastQuery;
    drawer.innerHTML = catalogBrowserView(manifests, lastResult, family, query, activeProviderId, selectionPreview());
    wireDrawer();
  };
  const wireDrawer = (): void => {
    if (!drawer) return;
    drawer.querySelector('[data-catalog-close]')?.addEventListener('click', close);
    drawer.querySelectorAll('[data-catalog-provider]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      activeProviderId = button.dataset.catalogProvider ?? 'all';
      selectedSuggestionIndex = undefined;
      const query = (drawer?.querySelector('[data-catalog-query]') as HTMLInputElement | null)?.value ?? '';
      void search(query);
    }));
    const queryInput = drawer.querySelector('[data-catalog-query]') as HTMLInputElement | null;
    queryInput?.addEventListener('input', () => {
      selectedSuggestionIndex = undefined;
      void search(queryInput.value);
    });
    drawer.querySelectorAll('[data-catalog-suggestion]').forEach((button: HTMLButtonElement) => button.addEventListener('click', () => {
      selectedSuggestionIndex = Number(button.dataset.catalogSuggestion);
      renderDrawer();
    }));
    drawer.querySelector('[data-catalog-apply]')?.addEventListener('click', () => {
      const suggestion = selectedSuggestionIndex === undefined ? undefined : lastResult?.suggestions[selectedSuggestionIndex];
      if (!suggestion) return;
      applyValue(
        suggestion.value,
        suggestion.label,
        suggestion.provenance.map((item) => `${item.providerLabel} ${item.version} | bundled offline | ${item.trusted ? 'trusted' : 'advisory'} | ${item.source}`).join('; ')
      );
    });
    drawer.querySelector('[data-catalog-custom-apply]')?.addEventListener('click', () => {
      const policy = catalogCustomValueKind(family);
      if (policy === 'string') {
        const custom = (drawer?.querySelector('[data-catalog-custom]') as HTMLInputElement | null)?.value.trim() ?? '';
        if (custom) applyValue(custom, custom, 'Custom authored value | document | trusted');
        return;
      }
      if (policy === 'reference') {
        const reference = (drawer?.querySelector('[data-catalog-custom-reference]') as HTMLInputElement | null)?.value.trim() ?? '';
        const kind = (drawer?.querySelector('[data-catalog-custom-kind]') as HTMLInputElement | null)?.value.trim() ?? '';
        if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) || !kind) {
          status.textContent = 'Enter an absolute reference URI and a non-empty kind.';
          return;
        }
        applyValue({ reference, kind }, reference, 'Custom authored reference | document | trusted');
      }
    });
    const updateCustomPreview = (): void => {
      const preview = drawer?.querySelector('[data-catalog-custom-preview]');
      if (!preview) return;
      if (catalogCustomValueKind(family) === 'string') {
        const custom = (drawer?.querySelector('[data-catalog-custom]') as HTMLInputElement | null)?.value ?? '';
        preview.textContent = JSON.stringify(custom);
        return;
      }
      const reference = (drawer?.querySelector('[data-catalog-custom-reference]') as HTMLInputElement | null)?.value ?? '';
      const kind = (drawer?.querySelector('[data-catalog-custom-kind]') as HTMLInputElement | null)?.value ?? '';
      const application = applicationValue({ reference, kind });
      preview.textContent = JSON.stringify(application.value);
    };
    drawer.querySelector('[data-catalog-custom]')?.addEventListener('input', updateCustomPreview);
    drawer.querySelector('[data-catalog-custom-reference]')?.addEventListener('input', updateCustomPreview);
    drawer.querySelector('[data-catalog-custom-kind]')?.addEventListener('input', updateCustomPreview);
    drawer.querySelector('[data-catalog-workspace]')?.addEventListener('click', () => {
      status.textContent = 'No workspace catalog provider is configured. Workspace providers are supplied by the editor host.';
    });
    queryInput?.focus();
  };
  const search = async (query: string): Promise<void> => {
    const sequence = ++searchSequence;
    lastQuery = query;
    const documentVersion = session.snapshot().documentVersion;
    if (activeRequest) catalogs.cancel(activeRequest);
    const request = catalogs.createRequest(`ui-catalog-${Date.now()}-${sequence}`, documentVersion, family, query, 60);
    activeRequest = request;
    const manifests = catalogs.listProviders().filter((provider) => provider.families.includes(family));
    const selected = activeProviderId === 'all' ? manifests : manifests.filter((provider) => provider.id === activeProviderId);
    const providers = selected.map((manifest) => createBundledCatalogProvider(manifest.id));
    const result = await catalogs.search(request, providers);
    if (activeRequest?.invocationId === request.invocationId) activeRequest = undefined;
    if (sequence !== searchSequence || documentVersion !== session.snapshot().documentVersion || result.stale) return;
    lastResult = result;
    if (!drawer) return;
    renderDrawer();
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
    void search('');
  });
}

interface CatalogSelectionPreview {
  readonly suggestionIndex: number;
  readonly emittedJson: string;
  readonly duplicate: boolean;
}

function catalogRecord(value: CatalogJsonValue): Readonly<Record<string, CatalogJsonValue>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, CatalogJsonValue>>
    : undefined;
}

function catalogValueKind(family: CatalogFamily, suggestion: CatalogSuggestion): string {
  const value = catalogRecord(suggestion.value);
  if (value && typeof value.kind === 'string') return value.kind;
  if (family === 'unit') return 'unit string';
  if (family === 'ucumUnit') return 'UCUM expression';
  if (family === 'currency') return 'currency code';
  return humanizeIdentifier(family);
}

export function catalogBrowserView(
  providers: readonly CatalogProviderManifest[],
  result: CatalogMergeResult,
  family: CatalogFamily,
  query: string,
  activeProviderId = 'all',
  selection?: CatalogSelectionPreview
): string {
  const providerButtons = [
    `<button class="js-catalog-provider" data-catalog-provider="all" aria-pressed="${activeProviderId === 'all'}"><strong>All providers</strong><small>${providers.length} offline built-ins</small></button>`,
    ...providers.map((provider) => `<button class="js-catalog-provider" data-catalog-provider="${escapeAttribute(provider.id)}" aria-pressed="${provider.id === activeProviderId}"><strong>${escapeHtml(provider.label)}</strong><small>offline · ${provider.entryCount ?? 'host'} entries · ${escapeHtml(provider.version)}</small></button>`),
    '<button class="js-catalog-provider js-catalog-workspace" type="button" data-catalog-workspace title="Workspace providers are supplied by the editor host."><strong>＋ Workspace catalog</strong><small>Host integration affordance</small></button>'
  ].join('');
  const suggestions = result.suggestions.map((suggestion, index) => `<button class="js-catalog-result" data-catalog-suggestion="${index}" aria-pressed="${selection?.suggestionIndex === index}"><span><strong>${escapeHtml(suggestion.label)}</strong>${suggestion.description ? `<small>${escapeHtml(suggestion.description)}</small>` : ''}<code>${escapeHtml(suggestion.emittedJson)}</code><small>${escapeHtml(catalogValueKind(family, suggestion))}</small></span><span class="js-catalog-sources">${suggestion.provenance.map((source) => `<span class="js-origin-chip" data-trusted="${source.trusted}" title="${escapeAttribute(`${source.source} · ${source.version} · bundled offline · ${source.trusted ? 'trusted' : 'advisory'}${source.stale ? ' · stale' : ''}`)}">${escapeHtml(source.providerLabel)}${source.stale ? ' · stale' : ''}</span>`).join('')}</span></button>`).join('') || `<div class="js-empty">No catalog matches.${catalogCustomValueKind(family) === 'closed' ? '' : ' Custom values remain available.'}</div>`;
  const issues = result.providerIssues.map((issue) => `<p class="js-problem-warning">${escapeHtml(issue.providerId)}: ${escapeHtml(issue.message)}</p>`).join('');
  const selected = selection === undefined ? undefined : result.suggestions[selection.suggestionIndex];
  const selectedValue = selected ? catalogRecord(selected.value) : undefined;
  const selectedReference = typeof selectedValue?.reference === 'string' ? selectedValue.reference : undefined;
  const selectedKind = selected ? catalogValueKind(family, selected) : undefined;
  const selectionHtml = selected && selection
    ? `<aside class="js-catalog-preview" data-catalog-selection-preview><strong>Selection preview</strong><dl><dt>Exact emitted JSON</dt><dd><code>${escapeHtml(selection.emittedJson)}</code></dd>${selectedReference ? `<dt>Reference</dt><dd><code>${escapeHtml(selectedReference)}</code></dd>` : ''}<dt>Kind</dt><dd>${escapeHtml(selectedKind ?? '')}</dd>${selected.provenance.map((source) => `<dt>Source authority</dt><dd><code>${escapeHtml(source.source)}</code></dd><dt>Version</dt><dd>${escapeHtml(source.version)}</dd><dt>Availability</dt><dd>Bundled offline${source.stale ? ' · stale' : ''}</dd><dt>Trust</dt><dd>${source.trusted ? 'Trusted built-in' : 'Advisory seed'}</dd>`).join('')}</dl><button data-catalog-apply ${selection.duplicate ? 'disabled' : ''}>${selection.duplicate ? 'Already selected' : family === 'semanticConcept' ? 'Add concept' : 'Apply value'}</button></aside>`
    : '<aside class="js-catalog-preview"><p>Select a result to review its exact JSON, reference, kind, source, version, availability, and trust before applying it.</p></aside>';
  const customPolicy = catalogCustomValueKind(family);
  const custom = customPolicy === 'string'
    ? `<div class="js-catalog-custom"><p>This family is open. Enter a domain-specific value when no catalog entry applies.</p><div><input data-catalog-custom placeholder="Custom value"><button data-catalog-custom-apply>Apply custom</button></div><code data-catalog-custom-preview>""</code></div>`
    : customPolicy === 'reference'
      ? `<div class="js-catalog-custom"><p>This family is open. Custom semantic values require a complete reference object.</p><label>Reference URI<input data-catalog-custom-reference placeholder="urn:example:concept"></label><label>Kind<input data-catalog-custom-kind placeholder="custom-concept"></label><code data-catalog-custom-preview>${escapeHtml(family === 'semanticConcept' ? '[]' : '{"reference":"","kind":""}')}</code><button data-catalog-custom-apply>${family === 'semanticConcept' ? 'Add custom concept' : 'Apply custom reference'}</button></div>`
      : '<div class="js-catalog-closed" data-catalog-closed>Only JSON Structure preset values can be applied in this closed family.</div>';
  const vocabulary = customPolicy === 'closed' ? 'Closed JSON Structure preset family' : 'Advisory open vocabulary';
  return `<div class="js-catalog-provider-list"><div class="js-panel-head">Providers</div>${providerButtons}</div><section class="js-catalog-content"><header class="js-catalog-head"><div><strong>${escapeHtml(humanizeIdentifier(family))}</strong><small>${vocabulary} · offline source preservation</small></div><button data-catalog-close aria-label="Close catalog">${fluentIcon('dismiss')}</button></header><input class="js-catalog-search" data-catalog-query type="search" value="${escapeAttribute(query)}" placeholder="Search values, labels, aliases, and exact JSON" aria-label="Search catalog"><div class="js-catalog-results">${issues}${suggestions}</div>${selectionHtml}${custom}</section>`;
}

function typedValueEditor(schemaType: string | undefined, current: unknown, label: string): string | undefined {
  if (schemaType === 'boolean') {
    return `<label class="js-check"><input data-typed-value type="checkbox" data-typed-kind="boolean" ${current === true ? 'checked' : ''}>${label}</label><input name="value" type="hidden" value="${escapeAttribute(JSON.stringify(current === undefined ? false : current))}">`;
  }
  if (schemaType === 'null') return `<input name="value" type="hidden" value="null"><p class="js-description">This value is always null.</p>`;
  const stringType = schemaType === 'string' || schemaType === 'date' || schemaType === 'datetime' || schemaType === 'time' || schemaType === 'duration' || schemaType === 'uuid' || schemaType === 'uri' || schemaType === 'jsonpointer';
  const numericType = ['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'].includes(schemaType ?? '');
  if (!stringType && !numericType) return undefined;
  const value = current === undefined ? '' : String(current);
  const inputType = numericType && !['int64', 'uint64', 'int128', 'uint128', 'decimal'].includes(schemaType ?? '') ? 'number' : 'text';
  return `<label>${label}<input data-typed-value type="${inputType}" data-typed-kind="${numericType ? 'number' : 'string'}" data-typed-schema-type="${escapeAttribute(schemaType ?? '')}" value="${escapeAttribute(value)}" required></label><input name="value" type="hidden" value="${escapeAttribute(JSON.stringify(current === undefined ? (numericType ? 0 : '') : current))}">`;
}

function conditionalBranchEditor(target: Readonly<Record<string, unknown>> | undefined, session: DocumentSession, label: string): string {
  const references = effectiveReferenceChoices(session);
  const options = (current: unknown): string => {
    const encoded = JSON.stringify(current);
    const reference = relationReference(current);
const choices = [{ value: JSON.stringify({ type: 'string' }), label: 'Inline string' }, ...references.map((choice) => ({ value: JSON.stringify({ $ref: `#${choice.pointer}` }), label: choice.name }))];
    if (current !== undefined && (!reference || !choices.some((choice) => choice.value === encoded))) choices.unshift({ value: encoded, label: reference ? definitionTypeLabel(reference.slice(1)) : 'Inline branch' });
    return `<option value="">Not set</option>${choices.map((choice) => `<option value="${escapeAttribute(choice.value)}" ${choice.value === encoded ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`).join('')}`;
  };
  const fields = (['if', 'then', 'else'] as const).map((keyword) => `<label>${keyword}<select data-conditional-value="${keyword}">${options(target?.[keyword])}</select></label>`).join('');
  return `<fieldset data-conditional-builder><legend>${label}</legend>${fields}<input name="value" type="hidden"></fieldset>`;
}
function schemaBranchEditor(current: unknown, session: DocumentSession, label: string): string {
  const branches = Array.isArray(current) ? current : [];
  const references = effectiveReferenceChoices(session);
  const rows = branches.map((branch, index) => {
    const reference = relationReference(branch);
    const encoded = JSON.stringify(branch);
    const options = [
      ...references.map((choice) => ({ value: JSON.stringify({ $ref: `#${choice.pointer}` }), label: choice.name })),
      ...(reference && references.some((choice) => `#${choice.pointer}` === reference) ? [] : [{ value: encoded, label: reference ? definitionTypeLabel(reference.slice(1)) : `Inline branch ${index + 1}` }])
    ];
    return `<div data-schema-branch><label>${index + 1}<select data-schema-branch-value>${options.map((option) => `<option value="${escapeAttribute(option.value)}" ${option.value === encoded ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label></div>`;
  }).join('');
  const templateOptions = `<option value="${escapeAttribute(JSON.stringify({ type: 'string' }))}">Inline string</option>` + references.map((choice) => `<option value="${escapeAttribute(JSON.stringify({ $ref: `#${choice.pointer}` }))}">${escapeHtml(choice.name)}</option>`).join('');
  return `<fieldset data-schema-branches><legend>${label}</legend>${rows || '<p class="js-description">No branches yet.</p>'}<button type="button" data-schema-branch-add>Add branch</button><select data-schema-branch-template hidden>${templateOptions}</select><input name="value" type="hidden" value="${escapeAttribute(JSON.stringify(branches))}"></fieldset>`;
}
function actionControlHtml(action: CommandAction, pointer: string, session: DocumentSession): string {
  const label = escapeHtml(action.valueLabel ?? 'Value');
  const control = action.control;
  if (!control || control.kind === 'source-only') {
    return '<div class="js-empty">This shape is edited in Source so the complete structure remains visible and reviewable.</div>';
  }
  if (control.kind === 'advanced-json' && (action.id === 'core.const' || action.id === 'validation.default')) {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const current = action.id === 'core.const' ? target?.const : target?.default;
    const schemaType = effectiveSchemaType(session.value, pointer);
    const typed = typedValueEditor(schemaType, current, label);
    if (typed) return typed;
  }
  if (action.id === 'composition.conditional') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    return conditionalBranchEditor(target, session, label);
  }
  if (control.kind === 'advanced-json' && ['composition.allOf', 'composition.anyOf', 'composition.oneOf'].includes(action.id)) {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    return schemaBranchEditor(target?.[action.keyword ?? ''], session, label);
  }
  if (control.kind === 'advanced-json' || control.kind === 'structured-object') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const current = action.id === 'composition.conditional'
      ? Object.fromEntries(['if', 'then', 'else'].filter((keyword) => target?.[keyword] !== undefined).map((keyword) => [keyword, target?.[keyword]]))
      : action.id === 'property.required-alternatives' ? target?.required
      : action.id === 'property.tuple-members' ? { properties: target?.properties ?? {}, order: target?.tuple ?? [] }
      : action.id === 'import.set'
        ? typeof target?.$import === 'string' ? { keyword: '$import', source: target.$import } : typeof target?.$importdefs === 'string' ? { keyword: '$importdefs', source: target.$importdefs } : { keyword: '$importdefs', source: '' }
      : action.keyword ? target?.[action.keyword] : undefined;
    return `<label>${label}<textarea name="value" rows="10" required aria-describedby="action-help" placeholder="Enter structured JSON">${escapeHtml(current === undefined ? '' : JSON.stringify(current, null, 2))}</textarea></label>`;
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
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const currentReference = action.id === 'relation.qualifier'
      ? relationReference(target?.qualifiertype)
      : relationReference(target?.type);
    const references = withCurrentReference(effectiveReferenceChoices(session), currentReference);
    return `<label>${label}<select name="value">${references.map((definition) => {
      const reference = `#${definition.pointer}`;
      return `<option value="${escapeAttribute(reference)}" ${reference === currentReference ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`;
    }).join('')}</select></label>`;
  }
  if (control.kind === 'property-multi-select') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const properties = target && typeof target.properties === 'object' && target.properties ? Object.keys(target.properties) : [];
    const current = action.id === 'relation.identity' ? target?.identity : action.id === 'core.tuple' ? target?.tuple : target?.required;
     const selected = action.keyword === 'concepts' && Array.isArray(current) ? current.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)) : Array.isArray(current) ? current.filter((entry): entry is string => typeof entry === 'string') : typeof current === 'string' ? [current] : [];
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
      const references = action.keyword === 'scope' ? collectionPointers(session.value).map((pointer) => ({ name: pointer, pointer: pointer.replace(/^#/, '') })) : effectiveReferenceChoices(session);
      return `<fieldset data-structured-list><legend>${label}</legend><select data-list-options multiple size="${Math.min(8, Math.max(3, references.length))}" aria-describedby="action-help">${references.map((definition) => { const value = action.keyword === 'scope' ? `#${definition.pointer}` : `#${definition.pointer}`; return `<option value="${escapeAttribute(value)}" ${selected.includes(value) ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`; }).join('')}</select><input name="value" type="hidden"></fieldset>`;
    }
    const placeholder = action.keyword === 'concepts' ? '{"reference":"urn:concept:example"}' : 'One value per line';
    const lines = action.keyword === 'concepts' ? selected.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)) : selected;
    return `<label data-structured-list>${label}<textarea data-list-lines rows="5" aria-describedby="action-help" placeholder="${escapeAttribute(placeholder)}">${escapeHtml(lines.join('\n'))}</textarea><input name="value" type="hidden"></label>`;
  }
  if (control.kind === 'catalog') {
    const target = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
    const current = action.keyword && target ? target[action.keyword] : undefined;
    const value = current === undefined ? '' : typeof current === 'string' ? current : JSON.stringify(current);
    const family = catalogFamilyForAction(action);
    const emptyGuidance = family && catalogCustomValueKind(family) === 'closed'
      ? 'No value selected. Choose a JSON Structure preset.'
      : 'No value selected. Catalog suggestions are advisory; this family accepts custom values.';
    return `<label>${label}<span class="js-catalog-field"><input name="value" data-catalog-value type="hidden" value="${escapeAttribute(value)}"><input data-catalog-display type="text" value="${escapeAttribute(structuredValueLabel(current))}" readonly><button type="button" data-catalog-open>Browse catalog</button></span></label><p class="js-description" data-catalog-provenance>${current === undefined ? emptyGuidance : 'Current authored value.'}</p>`;
  }
  return '<div class="js-empty">Open Source to edit this value.</div>';
}

function relationControlHtml(pointer: string, session: DocumentSession): string {
  const current = valueAtPointer(session.value, pointer) as Record<string, unknown> | undefined;
  const currentTarget = relationReference(current?.targettype);
  const currentQualifier = relationReference(current?.qualifiertype);
  const currentCardinality = current?.cardinality === 'multiple' ? 'multiple' : 'single';
  const currentScopes = typeof current?.scope === 'string' ? [current.scope] : Array.isArray(current?.scope) ? current.scope.filter((entry): entry is string => typeof entry === 'string') : [];
  const definitions = effectiveReferenceChoices(session);
  const targets = withCurrentReference(definitions.filter((definition) => definition.identity?.length), currentTarget);
  const qualifiers = withCurrentReference(definitions, currentQualifier);
  const scopePointers = [...new Set([...collectionPointers(session.value), ...currentScopes])];
  return `<fieldset data-relation-editor><legend>Relation</legend><label>Target type<select name="relation-target" required>${targets.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}" ${currentTarget === `#${definition.pointer}` ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`).join('')}</select></label><label>Cardinality<select name="relation-cardinality"><option value="single" ${currentCardinality === 'single' ? 'selected' : ''}>single</option><option value="multiple" ${currentCardinality === 'multiple' ? 'selected' : ''}>multiple</option></select></label><fieldset><legend>Scope</legend>${scopePointers.map((scope) => `<label class="js-check"><input type="checkbox" name="relation-scope" value="${escapeAttribute(scope)}" ${currentScopes.includes(scope) ? 'checked' : ''}>${escapeHtml(scope)}</label>`).join('') || '<p class="js-description">No collection scopes are available.</p>'}</fieldset><label>Qualifier type<select name="relation-qualifier"><option value="">None</option>${qualifiers.map((definition) => `<option value="#${escapeAttribute(definition.pointer)}" ${currentQualifier === `#${definition.pointer}` ? 'selected' : ''}>${escapeHtml(definition.name)}</option>`).join('')}</select></label><input name="value" type="hidden"></fieldset>`;
}

interface EffectiveReferenceChoice {
  readonly name: string;
  readonly pointer: string;
  readonly identity?: readonly string[];
}

function effectiveReferenceChoices(session: DocumentSession): readonly EffectiveReferenceChoice[] {
  const root = session.value;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  const context = new ResolvedSchemaContext(root as Readonly<Record<string, unknown>>, {
    documentUri: session.uri,
    resolvedDocuments: session.resolvedSchemaDocuments,
  });
  const choices = new Map<string, EffectiveReferenceChoice>();
  for (const declaration of session.effectiveDeclarations) {
    if (choices.has(declaration.effectivePointer)) continue;
    choices.set(declaration.effectivePointer, {
      name: definitionTypeLabel(declaration.effectivePointer),
      pointer: declaration.effectivePointer,
      identity: context.effectiveIdentity(`#${declaration.effectivePointer}`),
    });
  }
  return [...choices.values()];
}

function withCurrentReference(choices: readonly EffectiveReferenceChoice[], currentReference: string | undefined): readonly EffectiveReferenceChoice[] {
  const pointer = currentReference?.replace(/^#/, '');
  return !pointer || choices.some((choice) => choice.pointer === pointer)
    ? choices
    : [...choices, { name: definitionTypeLabel(pointer), pointer }];
}

function relationReference(value: unknown): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).$ref === 'string' ? String((value as Record<string, unknown>).$ref) : undefined;
}

export function collectionPointers(document: unknown): readonly string[] {
  const pointers: string[] = [];
  if (document && typeof document === 'object' && !Array.isArray(document)) {
    const root = document as Record<string, unknown>;
    const rootReference = typeof root.$root === 'string' ? root.$root : undefined;
    if (!Object.prototype.hasOwnProperty.call(root, 'type') && rootReference?.startsWith('#/')) {
      try {
        const rootTarget = valueAtPointer(document, decodeURIComponent(rootReference.slice(1)));
        if (rootTarget && typeof rootTarget === 'object' && !Array.isArray(rootTarget)) {
          const type = (rootTarget as Record<string, unknown>).type;
          if (typeof type === 'string' && ['array', 'set', 'map'].includes(type)) pointers.push('#');
        }
      } catch {
        // Invalid pointer escapes are diagnosed by the parser and are not scope choices.
      }
    }
  }
  const visit = (value: unknown, pointer: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string' && ['array', 'set', 'map'].includes(record.type)) pointers.push(pointer === '' ? '#' : `#${pointer}`);
    for (const [name, child] of Object.entries(record)) visit(child, `${pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  };
  visit(document, '');
  return [...new Set(pointers)];
}

/** Returns every authored namespace, including empty namespaces. */
export function namespacePointers(document: unknown, definitionPointers: readonly string[] = []): readonly string[] {
  if (!isRecord(document)) return [];
  if (!isRecord(document.definitions)) return ['/definitions'];
  const definitions = new Set(definitionPointers);
  const pointers: string[] = ['/definitions'];
  const visit = (value: Record<string, unknown>, pointer: string): void => {
    for (const [name, child] of Object.entries(value)) {
      if (name === '$import' || name === '$importdefs' || !isRecord(child)) continue;
      const childPointer = `${pointer}/${escapePointerToken(name)}`;
      if (definitions.has(childPointer) || Object.prototype.hasOwnProperty.call(child, 'type')) continue;
      pointers.push(childPointer);
      for (const [nestedName, nested] of Object.entries(child)) {
        if (nestedName === '$import' || nestedName === '$importdefs' || nestedName === 'definitions' || !isRecord(nested)) continue;
        visit({ [nestedName]: nested }, childPointer);
      }
      if (isRecord(child.definitions)) visit(child.definitions, `${childPointer}/definitions`);
    }
  };
  visit(document.definitions, '/definitions');
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
  root.querySelectorAll('.js-tree-item:not(.js-tree-root-namespace)').forEach((button: HTMLElement) => {
    const match = !normalized || (button.textContent ?? '').toLocaleLowerCase().includes(normalized);
    button.hidden = !match;
    const row = button.closest('.js-tree-type-row') as HTMLElement | null;
    if (row) row.hidden = !match;
    if (match) visible += 1;
  });
  const namespaces = [...root.querySelectorAll('.js-tree-namespace')] as HTMLElement[];
  namespaces.reverse().forEach((namespace) => {
    const hasVisibleType = [...namespace.querySelectorAll('.js-tree-item')].some((item) => !(item as HTMLElement).hidden);
    const hasVisibleNamespace = [...namespace.querySelectorAll(':scope > [role="group"] > .js-tree-namespace')].some((item) => !(item as HTMLElement).hidden);
    namespace.hidden = normalized ? !hasVisibleType && !hasVisibleNamespace && !(namespace.textContent ?? '').toLocaleLowerCase().includes(normalized) : false;
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
  'data-graph-search', 'data-graph-lens', 'data-graph-direction', 'data-graph-edge-select', 'data-graph-breadcrumb', 'data-graph-back', 'data-graph-forward', 'data-graph-home', 'data-graph-out', 'data-graph-fit', 'data-graph-relayout', 'data-graph-zoom-out', 'data-graph-zoom-in',
  'data-instance-input', 'data-instance-text', 'data-instance-root', 'data-instance-reset', 'data-instance-clear', 'data-instance-validate', 'data-instance-diagnostic', 'data-trace-instance', 'data-trace-schema',
  'data-start-conversion-command', 'data-start-conversion-close', 'data-conversion-command', 'data-conversion-option', 'data-conversion-load', 'data-conversion-reset', 'data-conversion-source', 'data-conversion-run', 'data-conversion-cancel', 'data-conversion-open',
  'data-addin', 'data-impact-direction', 'data-command', 'data-show-commands', 'data-theme-select', 'data-action-select', 'data-action-id',
  'data-libraries-load', 'data-library-read', 'data-library-operation', 'data-library-selector', 'data-library-declaration', 'data-library-provider-filter', 'data-library-search', 'data-library-preview', 'data-library-apply',
  'data-provider-configure', 'data-local-provider-configure', 'data-provider-remove', 'data-library-publish-preview', 'data-library-publish', 'data-publish-provider', 'data-publish-entry', 'data-publish-version', 'data-publish-source', 'data-publish-epoch', 'data-publish-default',
  'data-inline-property', 'data-inline-keyword', 'data-inline-type-add', 'data-inline-type-remove', 'data-inline-collection-kind', 'data-property-details', 'data-inline-property-delete', 'data-inline-property-apply', 'data-catalog-open',
  'data-property-detail-select', 'data-property-detail-add', 'data-inline-relation-add', 'data-inline-relation-name', 'data-inline-relation-target', 'data-inline-relation-cardinality', 'data-inline-relation-scope', 'data-inline-relation-cancel', 'data-inline-relation-commit',
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
function selectFallback(snapshot: DocumentSnapshot, current: string | undefined): string | undefined { if (current === '/definitions' && snapshot.recovery === 'valid') return current; if (current !== undefined && snapshot.model?.nodes.some((node) => node.pointer === current)) return current; return snapshotHasInlineRoot(snapshot) ? '' : snapshot.model?.projections.definitions.find((definition) => definition.reusable)?.pointer; }
function snapshotHasInlineRoot(snapshot: DocumentSnapshot): boolean { try { return isInlineRootSchema(JSON.parse(snapshot.text)); } catch { return false; } }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttribute(value: string): string { return escapeHtml(value).replace(/'/g, '&#39;'); }
