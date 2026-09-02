import type { LibraryDocument, LibraryEntry } from '../libraries/contracts.js';
import { jsonStructureLogo } from './brand-logo.js';
import type { LibraryCatalogEntry, LibraryHostResolution, LibraryProviderSummary } from '../libraries/host-runtime.js';
import type { RefactoringPlan } from '../phase4/refactoring.js';

export type LibraryBrowserOperation = 'import' | 'copy' | 'materialize';

export interface LibraryBrowserPublishDraft {
  readonly providerId: string;
  readonly entryId: string;
  readonly version: string;
  readonly sourceUri: string;
  readonly promoteDefault: boolean;
  readonly expectedEpoch?: string;
}

export interface LibraryBrowserPublishPreview {
  readonly summary: string;
  readonly collisionRisks: readonly string[];
  readonly valid: boolean;
}

export interface LibraryBrowserState {
  readonly providers?: readonly LibraryProviderSummary[];
  readonly catalog?: readonly LibraryCatalogEntry[];
  readonly resolution?: LibraryHostResolution;
  readonly offline: boolean;
  readonly publishDraft?: LibraryBrowserPublishDraft;
  readonly publishPreview?: LibraryBrowserPublishPreview;
  readonly publishedEpoch?: string;
  readonly documentValid: boolean;
  readonly providerFilter?: string;
  readonly search?: string;
  readonly currentDocumentUri?: string;
}

export interface LibraryBrowserCapabilities {
  readonly requestBacked: boolean;
  readonly fallbackAvailable: boolean;
}

export function renderLibraryBrowser(
  capabilities: LibraryBrowserCapabilities,
  entries: readonly LibraryEntry[] | undefined,
  selector: 'pinned' | 'floating',
  document: LibraryDocument | undefined,
  selection: readonly string[],
  operation: LibraryBrowserOperation = 'materialize',
  plan?: RefactoringPlan,
  status = '',
  state?: LibraryBrowserState,
): string {
  if (!capabilities.requestBacked && !capabilities.fallbackAvailable) {
    return '<div class="js-sheet"><h1>Libraries</h1><p class="js-description">This host does not provide library catalogs.</p></div>';
  }

  const requestBacked = capabilities.requestBacked;
  const providers = state?.providers ?? [];
  const catalog = requestBacked ? state?.catalog : entries?.map((entry) => ({ providerId: '', ...entry }));
  const resolution = state?.resolution;
  const definitions = record(document?.value)?.definitions;
  const definitionRecord = record(definitions);
  const declarationPointers = definitionRecord ? collectDeclarationPointers(definitionRecord) : [];
  const providerFilter = state?.providerFilter ?? (requestBacked ? 'all' : '');
  const search = state?.search ?? '';
  const providerPane = providerBrowser(providers, requestBacked, providerFilter);
  const catalogPane = catalogBrowser(catalog, selector, requestBacked, providerFilter, search);
  const consumePane = consumeBrowser(document, resolution, selector, selection, operation, plan, declarationPointers);
  const publishPane = requestBacked ? publishBrowser(providers, state) : '';

  return `<div class="js-library-workbench">
    <header class="js-library-header">
      <div><div class="js-eyebrow">Catalogs</div><h1>Libraries</h1><p>Resolve a version, inspect its provenance, then import or copy declarations deliberately.</p></div>
      <button data-libraries-load>${catalog ? 'Refresh' : 'Load libraries'}</button>
    </header>
    <div class="js-library-policy" role="group" aria-label="Resolution policy">
      <span>Resolution</span>
      <label><input type="radio" name="library-selector" value="floating" data-library-selector ${selector === 'floating' ? 'checked' : ''}> Floating default</label>
      <label><input type="radio" name="library-selector" value="pinned" data-library-selector ${selector === 'pinned' ? 'checked' : ''}> Pinned version</label>
      ${requestBacked ? `<label class="js-library-offline"><input type="checkbox" data-library-offline ${state?.offline ? 'checked' : ''}> Offline</label>` : ''}
    </div>
    <div class="js-library-browser">${providerPane}${catalogPane}<aside class="js-library-detail">${consumePane}${publishPane}</aside></div>
    <p class="js-library-status" data-library-status tabindex="-1" role="status" aria-live="polite">${escapeHtml(status)}</p>
  </div>`;
}

function providerBrowser(providers: readonly LibraryProviderSummary[], requestBacked: boolean, providerFilter: string): string {
  if (!requestBacked) {
    return `<nav class="js-library-providers" aria-label="Library providers"><div class="js-panel-head">Providers</div><button class="js-library-provider" data-library-provider-filter="" aria-pressed="${providerFilter === ''}"><strong>Bundled static provider</strong><small>trusted | local</small></button></nav>`;
  }
  const items = providers.map((provider) => `<div class="js-library-provider-row"><button class="js-library-provider" data-library-provider-filter="${escapeAttribute(provider.id)}" aria-pressed="${providerFilter === provider.id}"><strong>${escapeHtml(provider.id)}</strong><small>${escapeHtml(provider.kind)} | ${provider.trusted ? 'trusted' : 'untrusted'}</small><span>${provider.credentialConfigured ? 'credential configured' : 'no credential'} | publishing ${provider.publishSupported ? 'supported' : 'unsupported'}</span></button>${provider.kind === 'bundled' ? '<span class="js-provider-required">required</span>' : `<button class="js-provider-remove" data-provider-remove="${escapeAttribute(provider.id)}" aria-label="Remove ${escapeAttribute(provider.id)}">x</button>`}</div>`).join('');
  return `<nav class="js-library-providers" aria-label="Library providers"><div class="js-panel-head">Providers</div><button class="js-library-provider" data-library-provider-filter="all" aria-pressed="${providerFilter === 'all'}"><strong>All providers</strong><small>${providers.length} configured</small></button>${items || '<div class="js-empty">Load providers to manage them.</div>'}<details class="js-provider-add"><summary>Add local publisher</summary><div class="js-provider-form"><label>Provider id<input data-local-provider-id autocomplete="off" placeholder="team-schemas"></label><p class="js-description">Stores immutable versions in this host profile.</p><button data-local-provider-configure>Configure local publisher</button></div></details><details class="js-provider-add"><summary>Add read-only xRegistry</summary><div class="js-provider-form"><label>Provider id<input data-provider-id autocomplete="off"></label><label>Base URL<input data-provider-url type="url" inputmode="url" placeholder="https://registry.example"></label><label>Credential id<input data-provider-credential-id autocomplete="off"></label><label>Credential scheme<select data-provider-credential-scheme><option value="">Bearer (default)</option><option value="Bearer">Bearer</option><option value="Basic">Basic</option><option value="API-Key">API-Key</option></select></label><label>Credential secret<input data-provider-secret type="password" autocomplete="new-password"></label><label class="js-check"><input data-provider-trusted type="checkbox"> Trust this provider and HTTPS origin</label><button data-provider-configure>Configure read-only provider</button></div></details></nav>`;
}

function catalogBrowser(catalog: readonly LibraryCatalogEntry[] | undefined, selector: 'pinned' | 'floating', requestBacked: boolean, providerFilter: string, search: string): string {
  const cards = catalog?.map((entry) => {
    const defaultVersion = entry.versions.find((version) => version.isDefault) ?? entry.versions.at(-1);
    const buttons = selector === 'floating'
      ? defaultVersion ? `<button class="js-library-resolve" ${readAttributes(entry.providerId, entry.id, defaultVersion.version, requestBacked)}>Resolve default <strong>${escapeHtml(defaultVersion.version)}</strong></button>` : ''
      : entry.versions.map((version) => `<button class="js-library-resolve" ${readAttributes(entry.providerId, entry.id, version.version, requestBacked)}>Resolve <strong>${escapeHtml(version.version)}</strong>${version.integrity ? '<span>integrity</span>' : ''}${version.epoch ? `<span>epoch ${escapeHtml(version.epoch)}</span>` : ''}</button>`).join('');
    const versions = entry.versions.map((version) => `<span class="js-version-chip" data-default="${version.isDefault}">${escapeHtml(version.version)}${version.isDefault ? ' default' : ''}</span>`).join('');
    const visible = (providerFilter === 'all' || entry.providerId === providerFilter) && `${entry.name} ${entry.id} ${entry.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return `<article class="js-library-catalog-entry" data-library-provider-id="${escapeAttribute(entry.providerId)}" data-library-search-text="${escapeAttribute(`${entry.name} ${entry.id} ${entry.description ?? ''}`.toLocaleLowerCase())}" ${visible ? '' : 'hidden'}><div class="js-library-entry-head"><div><span>${escapeHtml(entry.providerId || 'Bundled static provider')}</span><h2>${escapeHtml(entry.name)}</h2></div><code>${escapeHtml(entry.id)}</code></div><p>${escapeHtml(entry.description ?? 'Versioned JSON Structure declarations.')}</p><div class="js-version-list">${versions}</div><div class="js-library-resolve-actions">${buttons || '<span>No versions available.</span>'}</div></article>`;
  }).join('') ?? '';
  const visibleCount = catalog?.filter((entry) => (providerFilter === 'all' || entry.providerId === providerFilter) && `${entry.name} ${entry.id} ${entry.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).length ?? 0;
  return `<section class="js-library-catalog"><div class="js-library-catalog-toolbar"><div><strong>Catalog</strong><span data-library-catalog-count>${visibleCount} of ${catalog?.length ?? 0} entries</span></div><input type="search" data-library-search value="${escapeAttribute(search)}" placeholder="Search libraries" aria-label="Search libraries"></div><div class="js-library-catalog-results">${cards || '<div class="js-empty">Load the catalog to browse libraries.</div>'}</div></section>`;
}

function consumeBrowser(
  document: LibraryDocument | undefined,
  resolution: LibraryHostResolution | undefined,
  selector: 'pinned' | 'floating',
  selection: readonly string[],
  operation: LibraryBrowserOperation,
  plan: RefactoringPlan | undefined,
  declarationPointers: readonly string[],
): string {
  if (!document) return `<section class="js-library-empty-detail">${jsonStructureLogo('js-library-logo')}<h2>Select a library version</h2><p>Its trust, source, declarations, and available consume operations will appear here.</p></section>`;

  const provenance = resolution?.provenance;
  const guarantee = resolution?.resolution.label ?? 'pinned-reproducible';
  const trust = resolution?.trust ?? { trusted: true, reasons: [] };
  const sourceLabel = resolution ? `${resolution.resolution.state.connectivity} | ${resolution.resolution.state.verification} | ${resolution.resolution.source}` : `Bundled static provider | trusted | ${selector}`;
  const declarations = declarationPointers.map((pointer) => `<label class="js-library-declaration"><input type="checkbox" value="${escapeAttribute(pointer)}" data-library-declaration ${selection.includes(pointer) ? 'checked' : ''}><span class="js-code">${escapeHtml(pointerLabel(pointer))}</span><small>${escapeHtml(pointer)}</small></label>`).join('');
  const operationOptions = `<option value="import" ${operation === 'import' ? 'selected' : ''}>Import reference</option><option value="copy" ${operation === 'copy' ? 'selected' : ''}>Copy declarations</option><option value="materialize" ${operation === 'materialize' ? 'selected' : ''}>Materialize declarations</option>`;
  const operationFields = operation === 'import'
    ? '<label>Import keyword<select data-library-import-keyword><option value="$importdefs">$importdefs</option><option value="$import">$import</option></select></label>'
    : operation === 'materialize' ? '<label>Authored import pointer<input data-library-materialize-import placeholder="/definitions/shared/$importdefs"></label>' : '';
  const preview = plan ? `<section class="js-library-preview"><div class="js-section-head"><div><h2>${capitalize(operation)} preview</h2><span class="js-section-meta">${plan.impact.length} changes</span></div></div>${plan.impact.map((impact) => `<div class="js-analysis-row"><span>${escapeHtml(impact.kind)}</span><span class="js-code">${escapeHtml(impact.pointer)}</span></div>`).join('')}${plan.collisions.map((collision) => `<p class="js-problem-warning">${escapeHtml(collision.message)}</p>`).join('')}${plan.provenance.map((entry) => `<p class="js-library-provenance">${escapeHtml(entry.reason)}: <code>${escapeHtml(entry.sourcePointer)}</code> -&gt; <code>${escapeHtml(entry.targetPointer)}</code></p>`).join('')}${plan.applicable ? `<button data-library-apply>Apply ${escapeHtml(operation)}</button>` : ''}</section>` : '';

  return `<section class="js-library-consume"><header><div><span class="js-library-guarantee" data-guarantee="${escapeAttribute(guarantee)}">${escapeHtml(guarantee)}</span><h2>${escapeHtml(document.entryId)} <small>${escapeHtml(document.version)}</small></h2></div><span class="js-trust-badge" data-trusted="${trust.trusted}">${trust.trusted ? 'trusted' : 'untrusted'}</span></header><p class="js-library-source">${escapeHtml(sourceLabel)}</p>${trust.reasons.map((reason) => `<p class="js-problem-warning">${escapeHtml(reason)}</p>`).join('')}<dl><dt>Provider</dt><dd>${escapeHtml(provenance?.providerId ?? 'bundled')}</dd><dt>Source</dt><dd class="js-code">${escapeHtml(provenance?.sourceUri ?? document.uri)}</dd><dt>Entry</dt><dd>${escapeHtml(provenance?.entryId ?? document.entryId)}</dd><dt>Version</dt><dd>${escapeHtml(provenance?.version ?? document.version)}</dd></dl><div class="js-library-declarations"><div class="js-section-head"><div><h2>Declarations</h2><span class="js-section-meta">${declarationPointers.length}</span></div></div>${declarations || '<p class="js-description">No reusable declarations.</p>'}</div><div class="js-library-operation"><label>Operation<select data-library-operation>${operationOptions}</select></label><label>Destination pointer<input data-library-destination value="/definitions"></label>${operationFields}<button data-library-preview>Preview ${escapeHtml(operation)}</button></div>${preview}</section>`;
}

function publishBrowser(providers: readonly LibraryProviderSummary[], state: LibraryBrowserState | undefined): string {
  const publishable = providers.filter((provider) => provider.publishSupported);
  const draft = state?.publishDraft;
  const preview = state?.publishPreview;
  return `<details class="js-library-publish" ${preview || state?.publishedEpoch ? 'open' : ''}><summary>Publish current document</summary><div class="js-library-publish-body"><label>Provider<select data-publish-provider><option value="">Select provider</option>${publishable.map((provider) => `<option value="${escapeAttribute(provider.id)}" ${draft?.providerId === provider.id ? 'selected' : ''}>${escapeHtml(provider.id)}</option>`).join('')}</select></label><label>Entry id<input data-publish-entry value="${escapeAttribute(draft?.entryId ?? '')}"></label><label>Version<input data-publish-version value="${escapeAttribute(draft?.version ?? '')}"></label><label>Source URI<input data-publish-source type="url" value="${escapeAttribute(draft?.sourceUri ?? state?.currentDocumentUri ?? '')}"></label><label>Expected epoch<input data-publish-epoch value="${escapeAttribute(draft?.expectedEpoch ?? '')}" placeholder="optional"></label><label class="js-check"><input data-publish-default type="checkbox" ${draft?.promoteDefault ? 'checked' : ''}> Promote as default version</label><button data-library-publish-preview ${state?.documentValid ? '' : 'disabled'}>Preview publish</button>${preview ? `<div class="js-publish-preview"><code>${escapeHtml(preview.summary)}</code>${preview.collisionRisks.map((risk) => `<p class="js-problem-warning">${escapeHtml(risk)}</p>`).join('') || '<p>No catalog collision detected.</p>'}<button data-library-publish ${preview.valid ? '' : 'disabled'}>Publish version</button></div>` : ''}${state?.publishedEpoch ? `<p>Resulting epoch: <strong>${escapeHtml(state.publishedEpoch)}</strong></p>` : ''}</div></details>`;
}

function readAttributes(providerId: string, entryId: string, version: string, requestBacked: boolean): string {
  return `data-library-read data-library-entry="${escapeAttribute(entryId)}" data-library-version="${escapeAttribute(version)}"${requestBacked ? ` data-library-provider="${escapeAttribute(providerId)}"` : ''}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function pointerLabel(pointer: string): string {
  const part = pointer.slice(pointer.lastIndexOf('/') + 1);
  return part.replace(/~1/g, '/').replace(/~0/g, '~') || 'Document';
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function collectDeclarationPointers(definitions: Readonly<Record<string, unknown>>, parent = '/definitions'): string[] {
  const pointers: string[] = [];
  for (const [name, value] of Object.entries(definitions)) {
    const pointer = `${parent}/${escapePointer(name)}`;
    const object = record(value);
    if (!object) continue;
    if (Object.prototype.hasOwnProperty.call(object, 'type')) pointers.push(pointer);
    else pointers.push(...collectDeclarationPointers(object, pointer));
  }
  return pointers;
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
