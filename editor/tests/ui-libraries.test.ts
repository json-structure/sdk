import { describe, expect, it } from 'vitest';
import { bindPreview, clearCredentialSecret, librariesView, libraryConflictMessage, libraryPublishPreview, loadLibraryCatalog, refactoringPlanCommand, resolveLibrarySelection } from '../src/ui/index.js';
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
    expect(preview.collisionRisks).toEqual(['common@2 already exists.', 'Default version will move to 2.']);
    expect(preview.valid).toBe(true);
    expect(libraryPublishPreview({ ...draft, providerId: 'core' }, providers, catalog, true).valid).toBe(false);
    expect(libraryPublishPreview({ ...draft, providerId: 'team' }, providers, catalog, true).valid).toBe(false);
    expect(libraryPublishPreview({ ...draft, sourceUri: 'not a uri' }, providers, catalog, true).valid).toBe(false);
    expect(libraryPublishPreview(draft, providers, catalog, false).valid).toBe(false);
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
});