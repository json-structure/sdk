// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayContextResolver } from '../src/overlay-context.js';
import { resourceSnapshot } from '../src/external-documents.js';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

const meta = 'https://json-structure.org/meta/validation/v0/#';
const rootUri = 'https://example.test/root.struct.json';
const importedUri = 'https://example.test/imported-money.struct.json';
const ref = (name: string) => ({ type: { $ref: '#/definitions/' + name } });
let handle: JsonStructureEditorHandle | undefined;
afterEach(() => { handle?.dispose(); handle = undefined; document.body.replaceChildren(); });

function fixture(transitive = false, maximum = 10, delta: Record<string, unknown> = {}) {
  const imported = { $schema: meta, $id: importedUri, name: 'MoneyLibrary', definitions: { Money: { type: 'int32', name: 'Money', minimum: 20, maximum } } };
  const intermediate = { $schema: meta, $id: 'https://example.test/intermediate.struct.json', name: 'Intermediate', definitions: { common: { $importdefs: importedUri }, Alias: ref('common/Money') } };
  const documents = [{ uri: importedUri, document: imported }, ...(transitive ? [{ uri: intermediate.$id, document: intermediate }] : [])];
  const root = { $schema: meta, $id: rootUri, name: 'Root', ...ref(transitive ? 'shared/Alias' : 'shared/Money'), definitions: { shared: { $importdefs: transitive ? intermediate.$id : importedUri }, Money: { type: 'int32', name: 'Money', maximum: 999 } }, allOf: [delta] };
  return { root, imported, documents };
}

function get(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector(selector); if (!element) throw new Error('Missing mounted control ' + selector); return element;
}
function click(root: HTMLElement, selector: string): void {
  const button = get(root, selector), menu = button.closest('details');
  if (menu && !menu.open && button !== menu.querySelector('summary')) menu.querySelector('summary').click();
  button.focus(); button.click();
}
async function mountImported(input: ReturnType<typeof fixture>): Promise<HTMLElement> {
  const root = document.createElement('div'); document.body.append(root);
  handle = mountJsonStructureEditor(root, {
    uri: rootUri, text: JSON.stringify(input.root), title: 'root.struct.json',
    readResource: async uri => {
      const resource = input.documents.find(candidate => candidate.uri === uri);
      if (!resource) throw new Error('Unexpected test resource ' + uri);
      return resourceSnapshot('diagnostic-origin', uri, JSON.stringify(resource.document));
    }
  });
  click(root, '[data-schema-open="/allOf/0"]');
  await vi.waitFor(() => expect(root.querySelector('.js-overlay-diagnostics [data-overlay-classification="conflict"]')).not.toBeNull(), { timeout: 3000 });
  return root;
}

describe('qualified overlay diagnostic provenance', () => {
  it('keeps nested inherited property bounds at the imported declaration, not at a local homonym', () => {
    const input = fixture(true);
    const root = { ...input.root, type: 'object', properties: { amount: ref('shared/Alias') }, allOf: [{ properties: { amount: {} } }] };
    const resolver = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: input.documents });
    for (const pointer of ['/allOf/0', '/allOf/0/properties/amount']) {
      const conflict = resolver.resolve(pointer)!.diagnostics.find(d => d.classification === 'conflict')!;
      expect(conflict).toMatchObject({ documentUri: importedUri, pointer: '/definitions/Money/maximum' });
      expect(conflict.related).toContainEqual({ documentUri: importedUri, pointer: '/definitions/Money/minimum' });
    }
  });

  it('retains the original propertyNames constraint origin through nested reference evaluation', () => {
    const b = { $schema: meta, $id: importedUri, definitions: { Allowed: { type: 'string', pattern: '^ok$' }, Name: { type: 'string', allOf: [ref('Allowed')] } } };
    const a = { $schema: meta, $id: 'https://example.test/name-owner.struct.json', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'string' }, Bag: { type: 'object', properties: { id: { type: 'string' } }, propertyNames: ref('common/Name') } } };
    const root = { $schema: meta, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id } }, allOf: [{ properties: { bad: { type: 'string' } } }] };
    const resolver = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] });
    const context = resolver.resolve('/allOf/0')!;
    const diagnostic = context.diagnostics.find(d => d.message.includes('propertyNames'))!;
    expect(diagnostic).toMatchObject({ documentUri: rootUri, pointer: '/allOf/0/properties/bad' });
    expect(diagnostic.related).toContainEqual({ documentUri: a.$id, pointer: '/definitions/Bag/propertyNames' });
    const preview = resolver.withDelta(resolver.resolve('/allOf/0/properties/bad')!, { type: 'string', maxLength: 8 });
    expect(preview.diagnostics.find(d => d.message.includes('propertyNames'))?.related).toContainEqual({ documentUri: a.$id, pointer: '/definitions/Bag/propertyNames' });
  });

  it('qualifies malformed pattern-schema origins instead of reusing a root pointer', () => {
    const b = { $schema: meta, $id: importedUri, definitions: { Bag: { type: 'object', properties: { id: { type: 'string' } }, patternProperties: { '^extra_': 7 } } } };
    const a = { $schema: meta, $id: 'https://example.test/pattern-owner.struct.json', definitions: { common: { $importdefs: b.$id }, Alias: ref('common/Bag') } };
    const root = { $schema: meta, ...ref('shared/Alias'), definitions: { shared: { $importdefs: a.$id } }, allOf: [{ properties: { extra_value: {} } }] };
    const context = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] }).resolve('/allOf/0')!;
    const diagnostic = context.diagnostics.find(d => d.message.includes('property-pattern'))!;
    expect(diagnostic).toMatchObject({ documentUri: rootUri, pointer: '/allOf/0/properties/extra_value' });
    expect(diagnostic.related).toContainEqual({ documentUri: importedUri, pointer: '/definitions/Bag/patternProperties/^extra_' });
  });

  it('gives every classification and resolution path document-qualified source locations', () => {
    const root = { $schema: meta, type: 'int32', minimum: 10, maximum: 20, anyOf: [{}, { minimum: 12 }, { minimum: 5 }, { maximum: 9 }, { type: 'any' }, 7, ref('Missing')] };
    const resolver = new OverlayContextResolver(root, { documentUri: rootUri });
    const diagnostics = root.anyOf.flatMap((_, index) => resolver.resolve('/anyOf/' + index)!.diagnostics);
    expect(new Set(diagnostics.map(d => d.classification))).toEqual(new Set(['redundant', 'narrowing', 'conflict', 'expansion', 'indeterminate']));
    for (const diagnostic of diagnostics) {
      expect(diagnostic.documentUri).toBe(rootUri); expect(typeof diagnostic.pointer).toBe('string');
      for (const origin of diagnostic.related) { expect(origin.documentUri).toBe(rootUri); expect(typeof origin.pointer).toBe('string'); }
    }
  });

  for (const transitive of [false, true]) it('retains imported bound origin' + (transitive ? ' through nested imports' : ''), () => {
    const { root, documents } = fixture(transitive);
    const context = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: documents }).resolve('/allOf/0')!;
    const conflict = context.diagnostics.find(d => d.classification === 'conflict')!;
    expect(conflict).toMatchObject({ documentUri: importedUri, pointer: '/definitions/Money/maximum' });
    expect(conflict.related).toContainEqual({ documentUri: importedUri, pointer: '/definitions/Money/minimum' });
    expect(context.documentUri).toBe(rootUri);
  });

  it('does not relabel an inherited conflict as a same-named but uninvolved local facet', () => {
    const { root, documents } = fixture(false, 10, { maximum: 999 });
    const context = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: documents }).resolve('/allOf/0')!;
    expect(context.diagnostics.find(d => d.classification === 'conflict')).toMatchObject({ documentUri: importedUri, pointer: '/definitions/Money/maximum' });
  });

  it('keeps local conflict locations editable while retaining imported related bounds', () => {
    const { root, documents } = fixture(true, 100, { maximum: 10 });
    const context = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: documents }).resolve('/allOf/0')!;
    const conflict = context.diagnostics.find(d => d.classification === 'conflict')!;
    expect(conflict).toMatchObject({ documentUri: rootUri, pointer: '/allOf/0/maximum' });
    expect(conflict.related).toContainEqual({ documentUri: importedUri, pointer: '/definitions/Money/minimum' });
  });

  it('retains imported required/maxProperties origins', () => {
    const imported = { $schema: meta, $id: importedUri, definitions: { Bag: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'], maxProperties: 1 } } };
    const root = { $schema: meta, ...ref('shared/Bag'), definitions: { shared: { $importdefs: importedUri }, Bag: { type: 'object', properties: { a: { type: 'string' } }, maxProperties: 999 } }, allOf: [{}] };
    const context = new OverlayContextResolver(root, { documentUri: rootUri, resolvedDocuments: [{ uri: importedUri, document: imported }] }).resolve('/allOf/0')!;
    const conflict = context.diagnostics.find(d => d.classification === 'conflict')!;
    expect(conflict).toMatchObject({ documentUri: importedUri, pointer: '/definitions/Bag/maxProperties' });
    expect(conflict.related).toContainEqual({ documentUri: importedUri, pointer: '/definitions/Bag/required' });
  });
});

describe('mounted diagnostic Source isolation', () => {
  it('routes imported related bounds to read-only origin navigation too', async () => {
    const root = await mountImported(fixture(false, 100, { maximum: 10 })), before = handle!.getText();
    click(root, '.js-overlay-diagnostics [data-effective-source="/definitions/Money/minimum"]');
    expect(root.querySelector('[data-schema-source-text]')).toBeNull();
    expect(root.textContent).toContain(importedUri); expect(root.textContent).toContain('/definitions/Money/minimum');
    expect(handle!.getText()).toBe(before);
  });

  it('refuses to reinterpret a stale document-qualified Source action after the current URI changes', async () => {
    const root = await mountImported(fixture(false, 100, { maximum: 10 }));
    const action = get(root, '.js-overlay-diagnostics [data-composition-source="/allOf/0/maximum"]');
    expect(action.dataset.effectiveDocument).toBe(rootUri);
    handle!.setUri('https://example.test/another-root.struct.json');
    const before = handle!.getText(); action.click();
    expect(root.querySelector('[data-schema-source-text]')).toBeNull();
    expect(get(root, '[data-panel-mode="analysis"]').hidden).toBe(false);
    expect(root.textContent).toContain(rootUri); expect(root.textContent).toContain('read-only');
    expect(handle!.getText()).toBe(before);
  });

  for (const transitive of [false, true]) it('cannot edit root Money max 999 through an imported Money conflict' + (transitive ? ' behind nested imports' : ''), async () => {
    const input = fixture(transitive), root = await mountImported(input), before = handle!.getText();
    const conflict = get(root, '.js-overlay-diagnostics [data-overlay-classification="conflict"]');
    const button = get(conflict, 'button');
    button.focus(); button.click();
    expect(root.querySelector('[data-schema-source-text]')).toBeNull();
    expect(root.querySelector('[data-schema-source-apply]')).toBeNull();
    expect(get(root, '[data-panel-mode="analysis"]').hidden).toBe(false);
    expect(root.textContent).toContain(importedUri); expect(root.textContent).toContain('/definitions/Money/maximum');
    expect(handle!.getText()).toBe(before);
    expect(JSON.parse(handle!.getText()).definitions.Money.maximum).toBe(999);
    expect(input.imported.definitions.Money.maximum).toBe(10);
  });

  it('renders imported provenance and never assigns a current-document edit action to that origin', async () => {
    const root = await mountImported(fixture());
    const conflict = get(root, '.js-overlay-diagnostics [data-overlay-classification="conflict"]');
    expect(conflict.textContent).toContain(importedUri); expect(conflict.textContent).toContain('/definitions/Money/maximum');
    expect(conflict.querySelector('[data-composition-source="/definitions/Money/maximum"]')).toBeNull();
    const source = get(conflict, '[data-effective-source="/definitions/Money/maximum"]');
    expect(source.dataset.effectiveDocument).toBe(importedUri); expect(source.textContent).toContain('read-only');
  });

  it('still edits an actual local delta without touching the same-named local reusable declaration or import', async () => {
    const input = fixture(false, 100, { maximum: 10 }), root = await mountImported(input);
    click(root, '.js-overlay-diagnostics [data-composition-source="/allOf/0/maximum"]');
    expect(get(root, '[data-schema-source-text]').value).toBe('10');
    get(root, '[data-schema-source-text]').value = '15'; click(root, '[data-schema-source-apply]');
    await vi.waitFor(() => expect(JSON.parse(handle!.getText()).allOf[0].maximum).toBe(15));
    expect(JSON.parse(handle!.getText()).definitions.Money.maximum).toBe(999);
    expect(input.imported.definitions.Money.maximum).toBe(100);
  });
});
