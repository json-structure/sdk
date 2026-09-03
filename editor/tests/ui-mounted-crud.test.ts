// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversionResult, ProgressEvent } from '../src/contracts.js';
import type { ConversionCommandsManifest } from '../src/conversion/types.js';
import { resourceSnapshot } from '../src/external-documents.js';
import { mountJsonStructureEditor, type JsonStructureEditorHandle, type JsonStructureEditorOptions } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  document.body.innerHTML = '';
});

function mount(
  value: unknown,
  services?: Parameters<typeof mountJsonStructureEditor>[1]['services'],
  editorOptions: Pick<JsonStructureEditorOptions, 'readResource' | 'uri'> = {},
): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  handle = mountJsonStructureEditor(container, {
    text: JSON.stringify(value),
    title: 'crud.struct.json',
    services,
    ...editorOptions,
  });
  return container;
}

function element<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
  const value = root.querySelector(selector);
  if (!value) throw new Error(`Missing mounted control: ${selector}`);
  return value as T;
}

function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function input(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function selectFile(control: HTMLInputElement, text: Promise<string>): void {
  Object.defineProperty(control, 'files', { configurable: true, value: [{ text: () => text }] });
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('mounted structured CRUD workbench', () => {
  it('creates primitive types, mutates declaration shapes, and edits document metadata', async () => {
    const root = mount({});
    change(element(root, '[data-type-create-name]'), 'RootText');
    change(element(root, '[data-type-create-primitive]'), 'string');
    element<HTMLButtonElement>(root, '[data-type-create-primitive-commit]').click();
    await settle();

    let value = JSON.parse(handle!.getText());
    expect(value.definitions.RootText).toEqual({ type: 'string' });
    expect(value.$root).toBe('#/definitions/RootText');

    change(element(root, '[data-inline-definition-type]'), 'array');
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.definitions.RootText).toEqual({ type: 'string' });

    change(element(root, '[data-meta-schema-select]'), 'https://json-structure.org/meta/extended/v0/#');
    await settle();
    change(element(root, '[data-document-action="core.name"]'), 'CatalogDocument');
    await settle();
    change(element(root, '[data-document-action="core.description"]'), 'Mounted metadata description');
    await settle();
    change(element(root, '[data-document-action="core.id"]'), 'https://example.test/catalog');
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value).toMatchObject({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'https://example.test/catalog',
      name: 'CatalogDocument',
      description: 'Mounted metadata description',
      $root: '#/definitions/RootText',
    });

    change(element(root, '[data-document-action="core.id"]'), '');
    await settle();
    expect(JSON.parse(handle!.getText()).$id).toBe('https://example.test/catalog');
  });

  it('mounts structured metadata controls with profile choices and namespace-owned imports', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureSemanticAnnotations'],
      $offers: { Existing: '#/definitions/Feature' },
      $root: '#/definitions/Root',
      definitions: {
        Root: { type: 'object', properties: {} },
        Feature: { type: 'string' },
        Imported: { $import: 'https://example.test/existing.struct.json' },
      },
    });

    const metaSchema = element<HTMLSelectElement>(root, '[data-meta-schema-select]');
    expect([...metaSchema.options].map((option) => option.value)).toEqual(expect.arrayContaining([
      'https://json-structure.org/meta/core/v0/#',
      'https://json-structure.org/meta/extended/v0/#',
      'https://json-structure.org/meta/validation/v0/#',
      'https://json-structure.org/meta/semantic-annotations/v0/#',
      'https://json-structure.org/meta/semantic/v0/#',
      'https://json-structure.org/meta/relations/v0/#',
      '__custom__',
    ]));
    expect(element<HTMLInputElement>(root, '[data-meta-schema-custom]').hidden).toBe(true);
    change(metaSchema, '__custom__');
    const custom = element<HTMLInputElement>(root, '[data-meta-schema-custom]');
    expect(custom.hidden).toBe(false);
    change(custom, 'https://example.test/custom-meta/#');
    await settle();
    expect(JSON.parse(handle!.getText()).$schema).toBe('https://example.test/custom-meta/#');
    change(element(root, '[data-meta-schema-select]'), 'https://json-structure.org/meta/semantic-annotations/v0/#');
    await settle();

    const useChoices = [...root.querySelectorAll('[data-document-use]')] as HTMLInputElement[];
    expect(useChoices.map((input) => input.value)).toEqual(expect.arrayContaining([
      'JSONStructureAlternateNames',
      'JSONStructureRelations',
      'JSONStructureSemanticAnnotations',
    ]));
    const relationsUse = useChoices.find((input) => input.value === 'JSONStructureRelations')!;
    relationsUse.checked = true;
    relationsUse.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(JSON.parse(handle!.getText()).$uses).toEqual(['JSONStructureSemanticAnnotations', 'JSONStructureRelations']);

    expect(root.querySelector('textarea[data-document-member="$offers"]')).toBeNull();
    expect(root.querySelector('[data-document-action="core.offers"]')).toBeNull();
    expect(root.textContent).not.toContain('{"Existing"');
    input(element(root, '.js-filter'), 'Root');
    expect(element(root, '[data-root-toggle="/definitions/Feature"]').closest('.js-tree-type-row')?.hidden).toBe(true);
    input(element(root, '.js-filter'), '');
    change(element(root, '[data-offer-name]'), 'Renamed');
    await settle();
    let value = JSON.parse(handle!.getText());
    expect(value.$offers).toEqual({ Renamed: '#/definitions/Feature' });

    change(element(root, '[data-offer-add-name]'), 'RootFeature');
    const targets = element<HTMLSelectElement>(root, '[data-offer-add-targets]');
    [...targets.options].find((option) => option.value === '#/definitions/Root')!.selected = true;
    element<HTMLButtonElement>(root, '[data-offer-add]').click();
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.$offers).toEqual({
      Renamed: '#/definitions/Feature',
      RootFeature: '#/definitions/Root',
    });

    expect(root.querySelector('[data-document-root]')).toBeNull();
    element<HTMLButtonElement>(root, '[data-select="/definitions/Feature"]').click();
    await settle();
    const rootToggle = element<HTMLInputElement>(root, '[data-root-toggle="/definitions/Feature"]');
    rootToggle.checked = true;
    rootToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(JSON.parse(handle!.getText()).$root).toBe('#/definitions/Feature');

    expect(root.querySelector('[data-document-import]')).toBeNull();
    element<HTMLButtonElement>(root, '[data-select="/definitions"]').click();
    await settle();
    change(element(root, '[data-namespace-import="$importdefs"]'), 'https://example.test/library.struct.json');
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.definitions.$importdefs).toBe('https://example.test/library.struct.json');

    element<HTMLButtonElement>(root, '[data-select="/definitions/Imported"]').click();
    await settle();
    expect(element<HTMLInputElement>(root, '[data-namespace-import="$import"]').value).toBe('https://example.test/existing.struct.json');
    expect(root.textContent).toContain('Imports the external root type and its definitions.');
    expect(root.textContent).toContain('Imports only the external definitions section.');
  });

  it('keeps tuple member creation, order, rename, identity, and deletion synchronized', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Pair: {
          type: 'tuple',
          properties: { first: { type: 'string' }, second: { type: 'integer' } },
          tuple: ['first', 'second'],
          identity: ['first'],
        },
      },
    });
    expect(root.querySelectorAll('.js-implicit-required')).toHaveLength(2);
    expect(root.querySelector('[data-property-pointer="/definitions/Pair/properties/first"][data-inline-property="required"]')).toBeNull();
    element<HTMLButtonElement>(root, '[data-command="add"]').click();
    await settle();
    let value = JSON.parse(handle!.getText());
    expect(value.definitions.Pair.tuple).toEqual(['first', 'second', 'field']);

    change(element(root, '[data-property-pointer="/definitions/Pair/properties/field"][data-inline-property="name"]'), 'third');
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.definitions.Pair.tuple).toEqual(['first', 'second', 'third']);

    element<HTMLButtonElement>(root, '[data-tuple-index="2"][data-tuple-move="up"]').click();
    await settle();
    expect(JSON.parse(handle!.getText()).definitions.Pair.tuple).toEqual(['first', 'third', 'second']);

    const identity = element<HTMLInputElement>(root, '[data-property-pointer="/definitions/Pair/properties/first"][data-inline-property="identity"]');
    identity.checked = false;
    identity.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(JSON.parse(handle!.getText()).definitions.Pair).not.toHaveProperty('identity');

    element<HTMLButtonElement>(root, '[data-inline-property-delete="/definitions/Pair/properties/second"]').click();
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.definitions.Pair.properties).not.toHaveProperty('second');
    expect(value.definitions.Pair.tuple).toEqual(['first', 'third']);
  });

  it('normalizes inline property and choice type changes without dropping legal concepts', async () => {
    const annotatedNumber = {
      type: 'number',
      description: 'Measured value',
      minimum: 0,
      unit: 'm',
      concepts: [{ reference: 'urn:concept:length', kind: 'custom-concept' }],
    };
    const root = mount({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: {
        Holder: { type: 'object', properties: { measure: annotatedNumber } },
        Variant: { type: 'choice', choices: { measure: annotatedNumber } },
      },
    });
    element<HTMLButtonElement>(root, '[data-select="/definitions/Holder"]').click();
    await settle();
    change(element(root, '[data-property-pointer="/definitions/Holder/properties/measure"][data-inline-type-replace]'), 'type:string');
    await settle();
    element<HTMLButtonElement>(root, '[data-select="/definitions/Variant"]').click();
    await settle();
    change(element(root, '[data-property-pointer="/definitions/Variant/choices/measure"][data-inline-type-replace]'), 'type:string');
    await settle();

    const value = JSON.parse(handle!.getText());
    const expected = {
      type: 'string',
      description: 'Measured value',
      concepts: [{ reference: 'urn:concept:length', kind: 'custom-concept' }],
    };
    expect(value.definitions.Holder.properties.measure).toEqual(expected);
    expect(value.definitions.Variant.choices.measure).toEqual(expected);
  });

  it('creates, renames, type-edits, describes, and deletes choice alternatives', async () => {
    const root = mount({
      definitions: {
        Value: { type: 'choice', choices: { text: { type: 'string' } } },
      },
    });
    change(element(root, '[data-choice-add-name]'), 'count');
    change(element(root, '[data-choice-add-type]'), 'integer');
    element<HTMLButtonElement>(root, '[data-choice-add]').click();
    await settle();

    change(element(root, '[data-inline-choice-name="/definitions/Value/choices/count"]'), 'quantity');
    await settle();
    change(element(root, '[data-property-pointer="/definitions/Value/choices/quantity"][data-inline-type-replace]'), 'collection:array');
    await settle();
    change(element(root, '[data-inline-choice-description="/definitions/Value/choices/quantity"]'), 'Number of items');
    await settle();

    let value = JSON.parse(handle!.getText());
    expect(value.definitions.Value.choices.quantity).toEqual({ type: 'integer', description: 'Number of items' });

    element<HTMLButtonElement>(root, '[data-inline-choice-delete="/definitions/Value/choices/text"]').click();
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.definitions.Value.choices).not.toHaveProperty('text');
  });

  it('authors and removes validation and semantic annotations inline', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: {
        Reading: { type: 'object', properties: { code: { type: 'string' } } },
      },
    });
    element<HTMLButtonElement>(root, '[data-property-details="/definitions/Reading/properties/code"]').click();
    await settle();

    const addSelectors = [...root.querySelectorAll('[data-property-detail-select]')] as HTMLSelectElement[];
    const constraintSelect = addSelectors.find((select) => [...select.options].some((option) => option.value === 'validation.pattern'))!;
    constraintSelect.value = 'validation.pattern';
    (constraintSelect.closest('.js-detail-add')!.querySelector('[data-property-detail-add]') as HTMLButtonElement).click();
    await settle();
    change(element(root, '[data-inline-field-action="validation.pattern"] [data-inline-keyword="pattern"]'), '^CODE-[0-9]+$');
    await settle();

    const annotationSelect = ([...root.querySelectorAll('[data-property-detail-select]')] as HTMLSelectElement[])
      .find((select) => [...select.options].some((option) => option.value === 'semantic.concepts'))!;
    annotationSelect.value = 'semantic.concepts';
    (annotationSelect.closest('.js-detail-add')!.querySelector('[data-property-detail-add]') as HTMLButtonElement).click();
    await settle();
    change(element(root, '[data-inline-field-action="semantic.concepts"] [data-inline-keyword="concepts"]'), '[{"reference":"urn:concept:code","kind":"custom-concept"}]');
    await settle();

    let property = JSON.parse(handle!.getText()).definitions.Reading.properties.code;
    expect(property.pattern).toBe('^CODE-[0-9]+$');
    expect(property.concepts).toEqual([{ reference: 'urn:concept:code', kind: 'custom-concept' }]);

    element<HTMLButtonElement>(root, '[data-inline-keyword-remove="semantic.concepts.remove"]').click();
    await settle();
    property = JSON.parse(handle!.getText()).definitions.Reading.properties.code;
    expect(property).not.toHaveProperty('concepts');
  });

  it('browses every catalog annotation control with exact previews, provider switching, open/closed policy, and additive concepts', async () => {
    const existingConcept = { reference: 'https://schema.org/name', kind: 'rdf-property' };
    const root = mount({
      $schema: 'https://json-structure.org/meta/semantic/v0/#',
      definitions: {
        Reading: {
          type: 'object',
          properties: {
            value: {
              type: 'decimal',
              description: 'Measured reading',
              symbol: 'r',
              symbols: { default: 'r', 'lang:en': 'reading' },
              altnames: { json: 'readingValue' },
              descriptions: { 'lang:en': 'Measured reading' },
              unit: 'm',
              ucumUnit: 'm',
              currency: 'USD',
              concepts: [existingConcept],
              observedProperty: {
                reference: 'https://cfconventions.org/Data/cf-standard-names/current/build/cf-standard-name-table.html#sea_water_temperature',
                kind: 'cf-standard-name'
              },
              semanticRole: 'observationValue'
            }
          }
        }
      }
    });
    element<HTMLButtonElement>(root, '[data-select="/definitions/Reading"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-property-details="/definitions/Reading/properties/value"]').click();
    await settle();

    for (const keyword of ['unit', 'ucumUnit', 'currency', 'concepts', 'observedProperty']) {
      expect(element<HTMLButtonElement>(root, `[data-inline-browse="${keyword}"]`).textContent).toContain('Browse');
    }

    const openCatalog = async (keyword: string): Promise<HTMLElement> => {
      element<HTMLButtonElement>(root, `[data-inline-browse="${keyword}"]`).click();
      await settle();
      return element(root, '.js-catalog-drawer');
    };
    const searchCatalog = async (query: string): Promise<HTMLElement> => {
      const drawer = element(root, '.js-catalog-drawer');
      input(element<HTMLInputElement>(drawer, '[data-catalog-query]'), query);
      await settle();
      return element(root, '.js-catalog-drawer');
    };

    let drawer = await openCatalog('unit');
    expect(drawer.innerHTML).toContain('bundled.json-structure-units');
    expect(drawer.querySelector('[data-catalog-custom]')).not.toBeNull();
    expect(drawer.querySelector('[data-catalog-workspace]')).not.toBeNull();
    drawer = await searchCatalog('kilometre');
    element<HTMLButtonElement>(drawer, '[data-catalog-suggestion="0"]').click();
    expect(element(drawer, '[data-catalog-selection-preview]').textContent).toContain('"km"');
    expect(JSON.parse(handle!.getText()).definitions.Reading.properties.value.unit).toBe('m');
    element<HTMLButtonElement>(drawer, '[data-catalog-apply]').click();
    await settle();
    expect(JSON.parse(handle!.getText()).definitions.Reading.properties.value.unit).toBe('km');

    drawer = await openCatalog('ucumUnit');
    expect(drawer.innerHTML).toContain('bundled.ucum');
    element<HTMLButtonElement>(drawer, '[data-catalog-close]').click();

    drawer = await openCatalog('currency');
    expect(drawer.innerHTML).toContain('bundled.iso-4217');
    input(element<HTMLInputElement>(drawer, '[data-catalog-custom]'), 'ZZZ');
    expect(element(drawer, '[data-catalog-custom-preview]').textContent).toBe('"ZZZ"');
    element<HTMLButtonElement>(drawer, '[data-catalog-custom-apply]').click();
    await settle();
    expect(JSON.parse(handle!.getText()).definitions.Reading.properties.value.currency).toBe('ZZZ');

    drawer = await openCatalog('concepts');
    expect(drawer.innerHTML).toContain('bundled.qudt-quantity-kinds');
    expect(drawer.innerHTML).toContain('bundled.sosa');
    expect(drawer.innerHTML).not.toContain('SOSA / SSN');
    element<HTMLButtonElement>(drawer, '[data-catalog-provider="bundled.qudt-quantity-kinds"]').click();
    await settle();
    drawer = await searchCatalog('Length');
    element<HTMLButtonElement>(drawer, '[data-catalog-suggestion="0"]').click();
    const conceptPreview = element(drawer, '[data-catalog-selection-preview]');
    expect(conceptPreview.textContent).toContain('qudt-quantity-kind');
    expect(conceptPreview.textContent).toContain('http://qudt.org/vocab/quantitykind/Length');
    expect(conceptPreview.textContent).toContain('prototype-seed-2026-08-31');
    expect(conceptPreview.textContent).toContain('Bundled offline');
    expect(drawer.querySelector('.js-origin-chip')).not.toBeNull();
    expect(JSON.parse(handle!.getText()).definitions.Reading.properties.value.concepts).toEqual([existingConcept]);
    element<HTMLButtonElement>(drawer, '[data-catalog-apply]').click();
    await settle();

    let value = JSON.parse(handle!.getText()).definitions.Reading.properties.value;
    expect(value.concepts).toEqual([
      existingConcept,
      { reference: 'http://qudt.org/vocab/quantitykind/Length', kind: 'qudt-quantity-kind' }
    ]);
    expect(value).toMatchObject({
      description: 'Measured reading',
      symbol: 'r',
      symbols: { default: 'r', 'lang:en': 'reading' },
      altnames: { json: 'readingValue' },
      descriptions: { 'lang:en': 'Measured reading' }
    });

    drawer = await openCatalog('concepts');
    element<HTMLButtonElement>(drawer, '[data-catalog-provider="bundled.qudt-quantity-kinds"]').click();
    await settle();
    drawer = await searchCatalog('Length');
    element<HTMLButtonElement>(drawer, '[data-catalog-suggestion="0"]').click();
    expect(element<HTMLButtonElement>(drawer, '[data-catalog-apply]').disabled).toBe(true);
    expect(element<HTMLButtonElement>(drawer, '[data-catalog-apply]').textContent).toContain('Already selected');
    element<HTMLButtonElement>(drawer, '[data-catalog-close]').click();
    expect(JSON.parse(handle!.getText()).definitions.Reading.properties.value.concepts).toHaveLength(2);

    drawer = await openCatalog('observedProperty');
    expect(drawer.innerHTML).toContain('bundled.cf-standard-names');
    drawer = await searchCatalog('Air pressure');
    element<HTMLButtonElement>(drawer, '[data-catalog-suggestion="0"]').click();
    expect(element(drawer, '[data-catalog-selection-preview]').textContent).toContain('cf-standard-name');
    element<HTMLButtonElement>(drawer, '[data-catalog-apply]').click();
    await settle();
    value = JSON.parse(handle!.getText()).definitions.Reading.properties.value;
    expect(value.observedProperty).toEqual({
      reference: 'https://cfconventions.org/Data/cf-standard-names/current/build/cf-standard-name-table.html#air_pressure',
      kind: 'cf-standard-name'
    });
    expect(value.concepts).toHaveLength(2);

    drawer = await openCatalog('semanticRole');
    expect(drawer.querySelector('[data-catalog-closed]')).not.toBeNull();
    expect(drawer.querySelector('[data-catalog-custom-apply]')).toBeNull();
    expect(drawer.innerHTML).toContain('bundled.semantic-annotations');
    element<HTMLButtonElement>(drawer, '[data-catalog-close]').click();
  });

  it('upgrades Relations documents to a capability-preserving profile before adding validation', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Source: {
          type: 'object',
          properties: { code: { type: 'string' } },
          relations: { target: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single' } },
        },
      },
    });
    element<HTMLButtonElement>(root, '[data-select="/definitions/Source"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-property-details="/definitions/Source/properties/code"]').click();
    await settle();
    const constraintSelect = ([...root.querySelectorAll('[data-property-detail-select]')] as HTMLSelectElement[])
      .find((select) => [...select.options].some((option) => option.value === 'validation.pattern'))!;
    constraintSelect.value = 'validation.pattern';
    (constraintSelect.closest('.js-detail-add')!.querySelector('[data-property-detail-add]') as HTMLButtonElement).click();
    await settle();
    change(element(root, '[data-inline-field-action="validation.pattern"] [data-inline-keyword="pattern"]'), '^CODE$');
    await settle();

    let value = JSON.parse(handle!.getText());
    expect(value.$schema).toBe('https://json-structure.org/meta/semantic-annotations/v0/#');
    expect(value.$uses).toContain('JSONStructureRelations');
    expect(value.definitions.Source.relations.target.targettype.$ref).toBe('#/definitions/Target');
    expect(value.definitions.Source.properties.code.pattern).toBe('^CODE$');

    element<HTMLButtonElement>(root, '[data-select="/definitions/Source/relations/target"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-relation-cardinality="multiple"]').click();
    await settle();
    value = JSON.parse(handle!.getText());
    expect(value.definitions.Source.relations.target.cardinality).toBe('multiple');
  });

  it('creates, updates, and deletes relations with the safe Design controls', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Source: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
      },
    });
    element<HTMLButtonElement>(root, '[data-select="/definitions/Source"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-inline-relation-add]').click();
    await settle();
    change(element(root, '[data-inline-relation-name]'), 'target');
    change(element(root, '[data-inline-relation-target]'), '#/definitions/Target');
    element<HTMLButtonElement>(root, '[data-inline-relation-commit]').click();
    await settle();

    element<HTMLButtonElement>(root, '[data-select="/definitions/Source/relations/target"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-relation-cardinality="multiple"]').click();
    await settle();
    expect(JSON.parse(handle!.getText()).definitions.Source.relations.target.cardinality).toBe('multiple');

    element<HTMLButtonElement>(root, '[data-action-id="relation.delete"]').click();
    const dialog = element(root, '.js-inline-editor');
    (dialog.querySelector('.js-actions button:last-child') as HTMLButtonElement).click();
    await settle();
    expect(JSON.parse(handle!.getText()).definitions.Source).not.toHaveProperty('relations');
  });

  it('preserves authored relation scopes when applying an unrelated relation change', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      $root: '#/definitions/Owners',
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Owners: { type: 'array', items: { type: { $ref: '#/definitions/Target' } } },
        AliasOwners: { type: { $ref: '#/definitions/Owners' } },
        Source: {
          type: 'object',
          properties: {},
          relations: {
            target: {
              targettype: { $ref: '#/definitions/Target' },
              cardinality: 'single',
              scope: ['#', '#/definitions/AliasOwners'],
            },
          },
        },
      },
    });
    element<HTMLButtonElement>(root, '[data-select="/definitions/Source"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-select="/definitions/Source/relations/target"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-action-id="relation.edit"]').click();
    const dialog = element(root, '.js-inline-editor');
    const scopes = [...dialog.querySelectorAll('[name="relation-scope"]')] as HTMLInputElement[];
    expect(scopes.find((scope) => scope.value === '#')?.checked).toBe(true);
    expect(scopes.find((scope) => scope.value === '#/definitions/AliasOwners')?.checked).toBe(true);
    change(element(dialog, '[name="relation-cardinality"]'), 'multiple');
    (dialog.querySelector('.js-actions button:last-child') as HTMLButtonElement).click();
    await settle();

    expect(JSON.parse(handle!.getText()).definitions.Source.relations.target).toMatchObject({
      cardinality: 'multiple',
      scope: ['#', '#/definitions/AliasOwners'],
    });
  });

  it('resets samples and conversion configuration and result state', async () => {
    const manifest: ConversionCommandsManifest = {
      schemaVersion: 1,
      converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['json-structure'], targetFormats: ['json'], options: [
        { name: 'strict', type: 'boolean', default: true },
      ] }],
      commands: [{ id: 'convert.fixture', converterId: 'fixture', direction: 'export', label: 'Convert fixture', sourceFormat: 'json-structure', targetFormat: 'json', defaultAutoOpen: false }],
    };
    const root = mount({ type: 'string' }, {
      listConversionCommands: async () => manifest,
      convert: async (request) => ({
        protocolVersion: 1,
        requestId: request.requestId,
        documentVersion: request.documentVersion,
        succeeded: true,
        outputs: [{ name: 'result.json', uri: 'file:///result.json' }],
        diagnostics: [],
      }),
    });

    element<HTMLButtonElement>(root, '[data-mode="instance"]').click();
    await settle();
    input(element(root, '[data-instance-text]'), '"sample"');
    element<HTMLButtonElement>(root, '[data-instance-validate]').click();
    await settle();
    expect(root.textContent).toContain('valid');
    element<HTMLButtonElement>(root, '[data-instance-reset]').click();
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('{}');
    element<HTMLButtonElement>(root, '[data-instance-clear]').click();
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('');

    element<HTMLButtonElement>(root, '[data-mode="conversion"]').click();
    await settle();
    const strict = element<HTMLInputElement>(root, '[data-conversion-option="strict"]');
    strict.checked = false;
    element<HTMLButtonElement>(root, '[data-conversion-run]').click();
    await settle();
    expect(root.textContent).toContain('result.json');
    element<HTMLButtonElement>(root, '[data-conversion-reset]').click();
    await settle();
    expect(root.textContent).not.toContain('result.json');
    expect(element<HTMLInputElement>(root, '[data-conversion-option="strict"]').checked).toBe(true);
  });

  it('ignores deferred instance file fulfillment after newer edits, resets, clears, selections, and disposal', async () => {
    const root = mount({ type: 'string' });
    element<HTMLButtonElement>(root, '[data-mode="instance"]').click();
    await settle();

    const afterEdit = deferred<string>();
    selectFile(element(root, '[data-instance-input]'), afterEdit.promise);
    input(element(root, '[data-instance-text]'), '"typed"');
    afterEdit.resolve('"stale edit"');
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('"typed"');

    const afterReset = deferred<string>();
    selectFile(element(root, '[data-instance-input]'), afterReset.promise);
    element<HTMLButtonElement>(root, '[data-instance-reset]').click();
    afterReset.resolve('"stale reset"');
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('{}');

    const afterClear = deferred<string>();
    selectFile(element(root, '[data-instance-input]'), afterClear.promise);
    element<HTMLButtonElement>(root, '[data-instance-clear]').click();
    afterClear.resolve('"stale clear"');
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('');

    const firstSelection = deferred<string>();
    const secondSelection = deferred<string>();
    const fileInput = element<HTMLInputElement>(root, '[data-instance-input]');
    selectFile(fileInput, firstSelection.promise);
    selectFile(fileInput, secondSelection.promise);
    firstSelection.resolve('"stale first"');
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('');
    secondSelection.resolve('"latest"');
    await settle();
    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('"latest"');

    const afterDispose = deferred<string>();
    selectFile(element(root, '[data-instance-input]'), afterDispose.promise);
    handle!.dispose();
    handle = undefined;
    afterDispose.resolve('"stale disposal"');
    await settle();
    expect(root.innerHTML).toBe('');
  });

  it('ignores a deferred instance file rejection after a newer textarea edit', async () => {
    const root = mount({ type: 'string' });
    element<HTMLButtonElement>(root, '[data-mode="instance"]').click();
    await settle();
    const pending = deferred<string>();
    selectFile(element(root, '[data-instance-input]'), pending.promise);
    input(element(root, '[data-instance-text]'), '"current"');
    pending.reject(new Error('stale file failure'));
    await settle();

    expect(element<HTMLTextAreaElement>(root, '[data-instance-text]').value).toBe('"current"');
    expect(root.textContent).not.toContain('stale file failure');
  });

  it('clears action JSON validity so corrected input submits without reopening', async () => {
    const root = mount({ type: 'object', properties: {} });
    element<HTMLButtonElement>(root, '[data-show-commands]').click();
    const command = element<HTMLSelectElement>(root, '[data-action-select]');
    command.value = 'core.properties';
    command.dispatchEvent(new Event('dblclick', { bubbles: true }));
    const dialog = element(root, '.js-inline-editor');
    const value = element<HTMLTextAreaElement>(dialog, '[name="value"]');
    input(value, '{');
    (dialog.querySelector('.js-actions button:last-child') as HTMLButtonElement).click();
    await settle();
    expect(value.validationMessage).not.toBe('');

    input(value, '{}');
    expect(value.validationMessage).toBe('');
    (dialog.querySelector('.js-actions button:last-child') as HTMLButtonElement).click();
    await settle();

    expect(root.querySelector('.js-inline-editor')).toBeNull();
    expect(JSON.parse(handle!.getText()).properties).toEqual({});
  });

  it('ignores stale conversion progress, completion, failure, and auto-open after reset or a newer run', async () => {
    const manifest: ConversionCommandsManifest = {
      schemaVersion: 1,
      converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['json-structure'], targetFormats: ['json'], options: [] }],
      commands: [{ id: 'convert.fixture', converterId: 'fixture', direction: 'export', label: 'Convert fixture', sourceFormat: 'json-structure', targetFormat: 'json', defaultAutoOpen: true }],
    };
    const pending: Array<{
      requestId: string;
      resolve: (value: ConversionResult) => void;
      reject: (reason: unknown) => void;
    }> = [];
    let progressListener: ((event: ProgressEvent) => void) | undefined;
    const openGeneratedOutput = vi.fn(async () => ({ protocolVersion: 1 as const, requestId: 'open', opened: true }));
    const root = mount({ type: 'string' }, {
      listConversionCommands: async () => manifest,
      onConversionProgress: (listener) => { progressListener = listener; return () => { progressListener = undefined; }; },
      cancelConversion: async () => undefined,
      openGeneratedOutput,
      convert: (request) => new Promise((resolve, reject) => pending.push({ requestId: request.requestId, resolve, reject })),
    });
    element<HTMLButtonElement>(root, '[data-mode="conversion"]').click();
    await settle();

    element<HTMLButtonElement>(root, '[data-conversion-run]').click();
    await settle();
    const first = pending[0]!;
    element<HTMLButtonElement>(root, '[data-conversion-reset]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-conversion-run]').click();
    await settle();
    const second = pending[1]!;

    progressListener?.({ protocolVersion: 1, requestId: first.requestId, documentVersion: 1, phase: 'writing', message: 'stale progress', percent: 90 });
    first.resolve({
      protocolVersion: 1,
      requestId: first.requestId,
      documentVersion: 1,
      succeeded: true,
      outputs: [{ name: 'stale.json', uri: 'file:///stale.json' }],
      diagnostics: [],
    });
    await settle();
    expect(root.textContent).not.toContain('stale progress');
    expect(root.textContent).not.toContain('stale.json');
    expect(openGeneratedOutput).not.toHaveBeenCalled();

    element<HTMLButtonElement>(root, '[data-conversion-reset]').click();
    second.reject(new Error('stale failure'));
    await settle();
    expect(root.textContent).not.toContain('stale failure');
    expect(root.textContent).not.toContain('stale.json');
  });

  it('ignores a deferred conversion source selection completed after reset', async () => {
    const manifest: ConversionCommandsManifest = {
      schemaVersion: 1,
      converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['avro'], targetFormats: ['json-structure'], options: [] }],
      commands: [{ id: 'import.fixture', converterId: 'fixture', direction: 'import', label: 'Import fixture', sourceFormat: 'avro', targetFormat: 'json-structure', defaultAutoOpen: false }],
    };
    let resolveSource: ((source: { uri: string; name: string; text: string }) => void) | undefined;
    const root = mount({ type: 'string' }, {
      listConversionCommands: async () => manifest,
      selectConversionSource: () => new Promise((resolve) => { resolveSource = resolve; }),
      convert: async () => { throw new Error('not called'); },
    });
    element<HTMLButtonElement>(root, '[data-mode="conversion"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-conversion-source]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-conversion-reset]').click();
    resolveSource?.({ uri: 'file:///stale.avsc', name: 'stale.avsc', text: '{}' });
    await settle();

    expect(root.textContent).not.toContain('stale.avsc');
    expect(root.textContent).not.toContain('Selected stale.avsc.');
    expect(root.textContent).toContain('No file selected');
  });

  it('ignores a deferred conversion source failure after switching commands', async () => {
    const manifest: ConversionCommandsManifest = {
      schemaVersion: 1,
      converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['avro', 'proto'], targetFormats: ['json-structure'], options: [] }],
      commands: [
        { id: 'import.avro', converterId: 'fixture', direction: 'import', label: 'Import Avro', sourceFormat: 'avro', targetFormat: 'json-structure', defaultAutoOpen: false },
        { id: 'import.proto', converterId: 'fixture', direction: 'import', label: 'Import Proto', sourceFormat: 'proto', targetFormat: 'json-structure', defaultAutoOpen: false },
      ],
    };
    let rejectSource: ((reason: unknown) => void) | undefined;
    const root = mount({ type: 'string' }, {
      listConversionCommands: async () => manifest,
      selectConversionSource: () => new Promise((_resolve, reject) => { rejectSource = reject; }),
      convert: async () => { throw new Error('not called'); },
    });
    element<HTMLButtonElement>(root, '[data-mode="conversion"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-conversion-source]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-conversion-command="import.proto"]').click();
    rejectSource?.(new Error('stale picker failure'));
    await settle();

    expect(root.textContent).not.toContain('stale picker failure');
    expect(element<HTMLButtonElement>(root, '[data-conversion-command="import.proto"]').getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('No file selected');
  });

  it('includes imported declarations in root and relation pickers and preserves imported relation refs', async () => {
    const externalUri = 'https://example.test/remote.struct.json';
    const external = JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $id: externalUri,
      name: 'RemoteTypes',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Qualifier: { type: 'string' },
      },
    });
    const root = mount({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $id: 'https://example.test/main.struct.json',
      name: 'Main',
      $uses: ['JSONStructureRelations'],
      definitions: {
        Imported: { $importdefs: externalUri },
        Source: {
          type: 'object',
          properties: {},
          relations: {
            target: {
              targettype: { $ref: '#/definitions/Imported/Target' },
              cardinality: 'single',
              qualifiertype: { $ref: '#/definitions/Imported/Qualifier' },
            },
          },
        },
      },
    }, undefined, {
      uri: 'https://example.test/main.struct.json',
      readResource: async (uri) => resourceSnapshot('imported-picker', uri, uri === externalUri ? external : '{}'),
    });
    await settle();
    await settle();

    const importedRoot = element<HTMLInputElement>(root, '[data-root-toggle="/definitions/Imported/Target"]');
    importedRoot.checked = true;
    importedRoot.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(JSON.parse(handle!.getText()).$root).toBe('#/definitions/Imported/Target');

    element<HTMLButtonElement>(root, '[data-select="/definitions/Source/relations/target"]').click();
    await settle();
    element<HTMLButtonElement>(root, '[data-action-id="relation.edit"]').click();
    const dialog = element(root, '.js-inline-editor');
    expect(element<HTMLSelectElement>(dialog, '[name="relation-target"]').value).toBe('#/definitions/Imported/Target');
    expect(element<HTMLSelectElement>(dialog, '[name="relation-qualifier"]').value).toBe('#/definitions/Imported/Qualifier');
    change(element(dialog, '[name="relation-cardinality"]'), 'multiple');
    (dialog.querySelector('.js-actions button:last-child') as HTMLButtonElement).click();
    await settle();

    const relation = JSON.parse(handle!.getText()).definitions.Source.relations.target;
    expect(relation).toMatchObject({
      targettype: { $ref: '#/definitions/Imported/Target' },
      cardinality: 'multiple',
      qualifiertype: { $ref: '#/definitions/Imported/Qualifier' },
    });
  });
});
