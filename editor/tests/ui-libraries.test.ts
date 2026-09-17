import { describe, expect, it } from 'vitest';
import { bindPreview, clearCredentialSecret, documentCanPublish, librariesView, libraryConflictMessage, libraryPublishPreview, loadLibraryCatalog, refactoringPlanCommand, resolveLibrarySelection } from '../src/ui/index.js';
import { planCopyDeclarations, planMaterializeDeclarations, planMoveDefinition } from '../src/phase4/refactoring.js';
import { DocumentSession } from '../src/session.js';
import { renderLibraryBrowser } from '../src/ui/library-browser.js';

describe('library workbench view', () => {
  it('filters provider catalogs and exposes nested reusable declarations', () => {
    const html = renderLibraryBrowser({ requestBacked: true, fallbackAvailable: false }, undefined, 'floating', {
      entryId: 'domain', version: '1', uri: 'memory:domain', value: { definitions: { Domain: { Address: { type: 'object' } }, Code: { type: 'string' } } },
    }, ['/definitions/Domain/Address'], 'copy', undefined, '', {
      providers: [{ id: 'team', kind: 'xregistry', location: 'https://registry.test', trusted: true, credentialConfigured: true, publishSupported: false }],
      catalog: [
        { providerId: 'team', id: 'domain', name: 'Domain', versions: [{ version: '1', documentUri: 'memory:domain', isDefault: true }] },
        { providerId: 'other', id: 'other', name: 'Other', versions: [{ version: '1', documentUri: 'memory:other', isDefault: true }] },
      ],
      offline: false, documentValid: true, providerFilter: 'team', search: 'domain',
    });

    expect(html).toContain('data-library-provider-filter="team" aria-pressed="true"');
    expect(html).toContain('data-library-catalog-count>1 of 2 entries');
    expect(html).toContain('data-library-provider-id="other" data-library-search-text="other other " hidden');
    expect(html).toContain('data-library-read data-library-entry="domain" data-library-version="1" data-library-provider="team"');
    expect(html).not.toContain('\u0000');
    expect(html).toContain('value="/definitions/Domain/Address" data-library-declaration checked');
    expect(html).toContain('value="/definitions/Code" data-library-declaration');
  });

  it('maps catalog and offline resolve operations through libraryRequest', async () => {
    const catalog = [{ providerId: 'team', id: 'common', name: 'Common', versions: [] }];
    const calls: Array<{ operation: string; payload: unknown }> = [];
    const libraryRequest = async <T>(operation: 'listProviders' | 'configureProvider' | 'removeProvider' | 'listCatalog' | 'resolve' | 'publish', payload?: unknown): Promise<T> => {
      calls.push({ operation, payload });
      return (operation === 'listCatalog' ? catalog : { document: { entryId: 'common', version: '1.0.0' } }) as T;
    };

    await expect(loadLibraryCatalog(libraryRequest)).resolves.toEqual(catalog);
    await resolveLibrarySelection(libraryRequest, { providerId: 'team', entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: true });
    expect(calls).toEqual([
      { operation: 'listCatalog', payload: undefined },
      { operation: 'resolve', payload: { providerId: 'team', entryId: 'common', selector: { kind: 'pinned', version: '1.0.0' }, offline: true } },
    ]);
  });

  it('keeps same-id catalog entries distinct across providers', () => {
    const html = renderLibraryBrowser({ requestBacked: true, fallbackAvailable: false }, undefined, 'pinned', undefined, [], 'copy', undefined, '', {
      providers: [
        { id: 'one', kind: 'xregistry', location: 'https://one.test', trusted: true, credentialConfigured: false, publishSupported: false },
        { id: 'two', kind: 'xregistry', location: 'https://two.test', trusted: true, credentialConfigured: false, publishSupported: false },
      ],
      catalog: [
        { providerId: 'one', id: 'common', name: 'Common one', versions: [{ version: '1', documentUri: 'https://one.test/common/1', isDefault: true }] },
        { providerId: 'two', id: 'common', name: 'Common two', versions: [{ version: '1', documentUri: 'https://two.test/common/1', isDefault: true }] },
      ],
      offline: false, documentValid: true, providerFilter: 'all',
    });

    expect(html).toContain('data-library-catalog-count>2 of 2 entries');
    expect(html.match(/data-library-entry="common"/g)).toHaveLength(2);
    expect(html).toContain('data-library-provider="one"');
    expect(html).toContain('data-library-provider="two"');
  });

  it('keeps the modal workflow focused on discovery and namespace import', () => {
    const html = renderLibraryBrowser({ requestBacked: true, fallbackAvailable: false }, undefined, 'pinned', {
      entryId: 'common', version: '1', uri: 'memory:common', value: { definitions: { A: { type: 'string' } } },
    }, [], 'import', undefined, '', {
      providers: [{ id: 'team', kind: 'xregistry', location: 'https://registry.test', trusted: true, credentialConfigured: true, publishSupported: true }],
      catalog: [],
      offline: false,
      documentValid: true,
      providerFilter: 'all',
    }, {
      purpose: 'import',
      targetNamespaces: ['/definitions/Domain', '/definitions/Shared'],
    });

    expect(html).toContain('<h1>Import library</h1>');
    expect(html).toContain('associate it with a namespace');
    expect(html).toContain('<select data-library-destination>');
    expect(html).toContain('<option value="/definitions/Domain">Domain</option>');
    expect(html).toContain('<option value="/definitions/Shared">Shared</option>');
    expect(html).not.toContain('data-provider-configure');
    expect(html).not.toContain('data-provider-remove');
    expect(html).not.toContain('data-library-publish-preview');
    expect(html).not.toContain('data-library-operation');
  });

  it('renders version policy, trusted provenance, declarations, and materialization preview', () => {
    const entry = { id: 'common', name: 'Common', versions: [{ version: '1.0.0', documentUri: 'memory:common', integrity: 'sha256:value', isDefault: true }] };
    const document = { entryId: 'common', version: '1.0.0', uri: 'memory:common', value: { definitions: { A: { type: 'string' }, B: { type: 'object', properties: { a: { type: { $ref: '#/definitions/A' } } } } } } };
    const plan = planMaterializeDeclarations({ sourceDocument: document.value, selectedPointers: ['/definitions/B'], targetDocument: { definitions: { $importdefs: 'memory:common' } }, targetNamespacePointer: '/definitions', importPointer: '/definitions/$importdefs', importSource: 'memory:common' });
    const host = { listLibraryEntries: async () => [entry], readLibraryDocument: async () => document };
    const html = librariesView(host, [entry], 'pinned', document, ['/definitions/B'], 'materialize', plan, 'Preview ready.');

    expect(html).toContain('value="pinned" data-library-selector checked');
    expect(html).toContain('Bundled static provider | trusted | pinned');
    expect(html).toContain('value="/definitions/B" checked');
    expect(html).toContain('/definitions/A');
    expect(html).toContain('data-library-apply');
  });

  it('renders import and copy workflows with preview controls', () => {
    const entry = { id: 'common', name: 'Common', versions: [{ version: '1.0.0', documentUri: 'memory:common', isDefault: true }] };
    const document = { entryId: 'common', version: '1.0.0', uri: 'memory:common', value: { definitions: { A: { type: 'string' } } } };
    const host = { listLibraryEntries: async () => [entry], readLibraryDocument: async () => document };
    const imported = librariesView(host, [entry], 'floating', document, [], 'import');
    const copied = librariesView(host, [entry], 'floating', document, ['/definitions/A'], 'copy');
    expect(imported).toContain('data-library-import-keyword');
    expect(imported).toContain('Preview import');
    expect(copied).toContain('value="copy" selected');
    expect(copied).toContain('Preview copy');
  });

  it('renders request-backed provider trust, credential, resolution, provenance, and publish controls', () => {
    const host = { libraryRequest: async <T>(): Promise<T> => undefined as T };
    const catalog = [{ providerId: 'local', id: 'common', name: 'Common', versions: [{ version: '2', documentUri: 'file:///workspace/library/common-2.json', isDefault: true }] }];
    const providers = [
      { id: 'core', kind: 'bundled' as const, location: 'bundle:///core/', trusted: true, credentialConfigured: false, publishSupported: false },
      { id: 'team', kind: 'xregistry' as const, location: 'https://registry.test', trusted: true, credentialConfigured: true, publishSupported: false },
    ];
    const resolution = {
      documentUri: 'https://registry.test/common/2',
      document: { definitions: { A: { type: 'string' } } },
      resolution: { source: 'provider' as const, label: 'online-verified' as const, state: { selector: 'pinned' as const, connectivity: 'online' as const, verification: 'verified' as const } },
      trust: { trusted: true, reasons: [] },
      provenance: { providerId: 'team', entryId: 'common', version: '2', sourceUri: 'https://registry.test/common/2' },
    };
    const document = { entryId: 'common', version: '2', uri: resolution.provenance.sourceUri, value: resolution.document };
    const html = librariesView(host, undefined, 'pinned', document, [], 'copy', undefined, '', { providers, catalog, resolution, offline: true, documentValid: true });

    expect(html).toContain('credential configured');
    expect(html).toContain('data-provider-remove="team"');
    expect(html).not.toContain('data-provider-remove="core"');
    expect(html).toContain('data-library-offline checked');
    expect(html).toContain('online-verified');
    expect(html).toContain('https://registry.test/common/2');
    expect(html).toContain('data-library-publish-preview');
    expect(html).not.toContain('value="core"');
    expect(html).not.toContain('value="team"');
    expect(html).toContain('publishing unsupported');
  });

  it('builds deterministic publish previews and rejects bundled, colliding, or invalid sources', () => {
    const providers = [
      { id: 'core', kind: 'bundled' as const, location: 'bundle:///core/', trusted: true, credentialConfigured: false, publishSupported: false },
      { id: 'team', kind: 'xregistry' as const, location: 'https://registry.test', trusted: true, credentialConfigured: true, publishSupported: false },
      { id: 'local', kind: 'local' as const, location: 'file:///workspace/library/', trusted: true, credentialConfigured: false, publishSupported: true },
    ];
    const catalog = [{ providerId: 'team', id: 'common', name: 'Common', versions: [{ version: '2', documentUri: 'https://registry.test/common/2', isDefault: true }] }];
    const draft = { providerId: 'local', entryId: 'common', version: '2', sourceUri: 'memory://current', promoteDefault: true, expectedEpoch: '7' };
    const preview = libraryPublishPreview(draft, providers, catalog, true);
    expect(preview.summary).toBe('local:common@2 from memory://current; promoteDefault=true; expectedEpoch=7');
    expect(preview.collisionRisks).toEqual(['Default version will move to 2.']);
    expect(preview.valid).toBe(true);
    const collision = libraryPublishPreview(draft, providers, [...catalog, { ...catalog[0]!, providerId: 'local' }], true);
    expect(collision.collisionRisks).toContain('local:common@2 already exists and cannot be overwritten.');
    expect(collision.valid).toBe(false);
    expect(libraryPublishPreview({ ...draft, providerId: 'core' }, providers, catalog, true).valid).toBe(false);
    expect(libraryPublishPreview({ ...draft, providerId: 'team' }, providers, catalog, true).valid).toBe(false);
    expect(libraryPublishPreview({ ...draft, sourceUri: 'not a uri' }, providers, catalog, true).valid).toBe(false);
    expect(libraryPublishPreview(draft, providers, catalog, false).valid).toBe(false);
  });

  it('requires a parsed schema model with zero error diagnostics before publishing', () => {
    const snapshot = new DocumentSession('memory://publishable', '{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"memory://publishable","name":"Publishable","type":"string"}').snapshot();
    expect(documentCanPublish(snapshot)).toBe(true);
    expect(documentCanPublish({ ...snapshot, diagnostics: [{ code: 'schema.error', message: 'Invalid schema.', severity: 'error' }] })).toBe(false);
    expect(documentCanPublish({ ...snapshot, model: undefined })).toBe(false);
  });

  it('disables publish preview for invalid documents and publish for collision previews', () => {
    const host = { libraryRequest: async <T>(): Promise<T> => undefined as T };
    const providers = [{ id: 'local', kind: 'local' as const, location: 'memory://published/', trusted: true, credentialConfigured: false, publishSupported: true }];
    const draft = { providerId: 'local', entryId: 'common', version: '1', sourceUri: 'memory://current', promoteDefault: false };
    const invalidDocument = librariesView(host, undefined, 'pinned', undefined, [], 'copy', undefined, '', { providers, catalog: [], offline: false, documentValid: false, publishDraft: draft });
    const collision = librariesView(host, undefined, 'pinned', undefined, [], 'copy', undefined, '', {
      providers, catalog: [], offline: false, documentValid: true, publishDraft: draft,
      publishPreview: libraryPublishPreview(draft, providers, [{ providerId: 'local', id: 'common', name: 'Common', versions: [{ version: '1', documentUri: 'memory://published/common/1', isDefault: true }] }], true),
    });

    expect(invalidDocument).toContain('data-library-publish-preview disabled');
    expect(collision).toContain('data-library-publish disabled');
  });

  it('keeps epoch conflicts actionable and clears write-only credentials', () => {
    expect(libraryConflictMessage(new Error("Library entry 'common' changed since it was read."))).toContain('update Expected epoch');
    const secret = { value: 'never-reflect-this' } as HTMLInputElement;
    clearCredentialSecret(secret);
    expect(secret.value).toBe('');
  });

  it('rejects stale previews by exact text and version', () => {
    const source = '{\n  "definitions": {}\n}\n';
    const session = new DocumentSession('memory:target', source, 7);
    const plan = planCopyDeclarations({ sourceDocument: { definitions: { A: { type: 'string' } } }, targetDocument: session.value as Record<string, unknown>, selectedPointers: ['/definitions/A'] });
    const command = refactoringPlanCommand(plan, bindPreview(session.snapshot()));
    expect(command.canExecute({ session, documentVersion: 7 })).toBe(true);
    session.update('{\n  "definitions": { }\n}\n', 7);
    expect(command.canExecute({ session, documentVersion: 7 })).toBe(false);
    session.update(source, 8);
    expect(command.canExecute({ session, documentVersion: 8 })).toBe(false);
  });

  it('emits pointer-scoped edits without replacing unrelated source text and preserves provenance', () => {
    const source = '{\n\t"name": "keep exact spacing",\n\t"definitions": {\n\t\t"Local": { "type": "boolean" }\n\t}\n}\n';
    const session = new DocumentSession('memory:target', source, 3);
    const plan = planCopyDeclarations({ sourceDocument: { definitions: { A: { type: 'string' } } }, targetDocument: session.value as Record<string, unknown>, selectedPointers: ['/definitions/A'] });
    const command = refactoringPlanCommand(plan, bindPreview(session.snapshot()));
    const result = command.execute({ session, documentVersion: 3 });
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]!.range.startOffset).toBeGreaterThan(source.indexOf('"definitions"'));
    expect(result.edits[0]!.range.endOffset).toBe(result.edits[0]!.range.startOffset);
    expect(source.slice(0, result.edits[0]!.range.startOffset)).toContain('\t"name": "keep exact spacing"');
    expect(plan.provenance).toEqual([{ sourcePointer: '/definitions/A', targetPointer: '/definitions/A', reason: 'selected' }]);
  });

  it('folds rewrites inside a moved declaration into its pointer-scoped add edit', () => {
    const source = '{"definitions":{"A":{"type":{"$ref":"#/definitions/A"}},"Target":{}}}';
    const session = new DocumentSession('memory:target', source, 4);
    const plan = planMoveDefinition(session.value as Record<string, unknown>, { sourcePointer: '/definitions/A', targetNamespacePointer: '/definitions/Target' });
    const result = refactoringPlanCommand(plan, bindPreview(session.snapshot())).execute({ session, documentVersion: 4 });
    expect(result.edits).toHaveLength(2);
    expect(result.edits.some((edit) => edit.newText.includes('#/definitions/Target/A'))).toBe(true);
  });

  it('does not insert a leading comma when moving the only member within a container', () => {
    const source = '{"definitions":{"OldName":{"type":"string"}}}';
    const session = new DocumentSession('memory:move-only-member', source, 5);
    const plan = planMoveDefinition(session.value as Record<string, unknown>, {
      sourcePointer: '/definitions/OldName',
      targetNamespacePointer: '/definitions',
      targetName: 'Name',
    });
    const result = refactoringPlanCommand(plan, bindPreview(session.snapshot())).execute({ session, documentVersion: 5 });
    const updated = [...result.edits]
      .sort((left, right) => (right.range.startOffset ?? 0) - (left.range.startOffset ?? 0))
      .reduce((text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset), source);

    expect(updated).not.toContain('{,');
    expect(JSON.parse(updated)).toEqual({ definitions: { Name: { type: 'string' } } });
  });

  it('does not insert a leading comma after materializing the only container member', () => {
    const source = '{"definitions":{"$importdefs":"memory:common"}}';
    const session = new DocumentSession('memory:target', source, 5);
    const plan = planMaterializeDeclarations({
      sourceDocument: { definitions: { Name: { type: 'string' } } },
      selectedPointers: ['/definitions/Name'],
      targetDocument: session.value as Record<string, unknown>,
      targetNamespacePointer: '/definitions',
      importPointer: '/definitions/$importdefs',
      importSource: 'memory:common',
    });
    const result = refactoringPlanCommand(plan, bindPreview(session.snapshot())).execute({ session, documentVersion: 5 });
    const updated = [...result.edits]
      .sort((left, right) => (right.range.startOffset ?? 0) - (left.range.startOffset ?? 0))
      .reduce((text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset), source);

    expect(updated).not.toContain('{,');
    expect(JSON.parse(updated)).toEqual({ definitions: { Name: { type: 'string' } } });
  });
});