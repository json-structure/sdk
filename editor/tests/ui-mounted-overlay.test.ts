// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';
const meta = 'https://json-structure.org/meta/validation/v0/#';
let handle: JsonStructureEditorHandle | undefined;
afterEach(() => { handle?.dispose(); handle = undefined; document.body.replaceChildren(); });
function mount(value: unknown): HTMLElement { const root = document.createElement('div'); document.body.append(root); handle = mountJsonStructureEditor(root, { text: typeof value === 'string' ? value : JSON.stringify(value), title: 'overlay.struct.json' }); return root; }
function get(root: HTMLElement, selector: string): HTMLElement { const result = root.querySelector(selector); if (!result) throw new Error('Missing mounted control ' + selector); return result; }
function click(root: HTMLElement, selector: string): void { const button = get(root, selector); if (button.disabled) throw new Error('Disabled mounted control ' + selector); const menu = button.closest('details'); if (menu && !menu.open && button !== menu.querySelector('summary')) menu.querySelector('summary').click(); button.focus(); button.click(); }
function change(root: HTMLElement, selector: string, value: string): void { const control = get(root, selector); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); }
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const value = () => JSON.parse(handle!.getText());
const pointer = (root: HTMLElement) => get(root, '[data-schema-location-bar]').dataset.schemaPointer;
const base = (extra: Record<string, unknown> = {}) => ({ $schema: meta, type: 'object', name: 'Account', properties: { id: { type: 'uuid' }, age: { type: 'int32', minimum: 0, maximum: 120 }, title: { type: 'string', maxLength: 40 } }, required: ['id'], additionalProperties: true, allOf: [{}], ...extra });
async function facet(root: HTMLElement, id: string, raw: string): Promise<void> { change(root, '[data-facet-select]', id); click(root, '[data-facet-add]'); await settle(); change(root, '[data-facet-action="' + id + '"]', raw); await settle(); }

describe('mounted contextual Conditional Composition authoring', () => {
  it('can remove an authored required-only additional member without materializing its schema', async () => {
    const root = mount(base({ additionalProperties: { type: 'string' }, allOf: [{ required: ['extra'] }] }));
    click(root, '[data-schema-open="/allOf/0"]'); click(root, '[data-overlay-member-mode="local"]');
    const required = get(root, '[data-overlay-required="extra"]');
    expect(required.checked).toBe(true);
    required.checked = false; required.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(value().allOf[0]).toEqual({}); expect(value().allOf[0]).not.toHaveProperty('properties');
    expect(value().required).toEqual(['id']); expect(value().additionalProperties).toEqual({ type: 'string' });
  });

  it('keeps locally required inherited members editable in Local view without creating property deltas', async () => {
    const root = mount(base({ allOf: [{ required: ['title'] }] }));
    const before = handle!.getText();
    click(root, '[data-schema-open="/allOf/0"]'); click(root, '[data-overlay-member-mode="local"]');
    const required = get(root, '[data-overlay-required="title"]');
    expect(required.checked).toBe(true); expect(required.disabled).toBe(false);
    expect(root.querySelector('[data-overlay-member="age"]')).toBeNull();
    expect(value().allOf[0]).toEqual({ required: ['title'] }); expect(handle!.getText()).toBe(before);
    required.checked = false; required.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(value().allOf[0]).toEqual({}); expect(root.querySelector('[data-overlay-member="title"]')).toBeNull();
    get(root, '[data-schema-heading]').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await settle();
    expect(get(root, '[data-overlay-required="title"]').checked).toBe(true);
    expect(value().allOf[0]).toEqual({ required: ['title'] });
    click(root, '[data-overlay-member-mode="effective"]');
    expect(get(root, '[data-overlay-base-required-property="id"]').disabled).toBe(true);
    expect(value().required).toEqual(['id']); expect(value().allOf[0]).not.toHaveProperty('properties');
  });

  it('normal Add operand creates an empty constraint set and opens fixed effective object members, not a seed/type picker', async () => {
    const root = mount(base());
    expect(root.textContent).not.toContain('Complete seed'); expect(root.textContent).toContain('Constraint set');
    expect(root.querySelector('[data-composition-seed-kind]')).toBeNull();
    click(root, '[data-composition-add-operand]'); await settle();
    expect(value().allOf[1]).toEqual({}); expect(pointer(root)).toBe('/allOf/1');
    expect(get(root, '[data-declaration-label]').textContent).toBe('Constraint set');
    expect(get(root, '[data-overlay-base-pointer]').textContent).toContain('root');
    expect([...root.querySelectorAll('[data-overlay-member]')].map(row => row.dataset.overlayMember)).toEqual(['id', 'age', 'title']);
    expect(get(root, '[data-overlay-base-required-property="id"]').disabled).toBe(true);
    expect(root.querySelector('[data-inline-definition-type]')).toBeNull(); expect(root.querySelector('[data-property-field-activate]')).toBeNull();
    expect(root.textContent).not.toContain('Empty schema'); expect(root.textContent).toContain('No local constraints yet');
    const nullableRow = get(root, '[data-overlay-member="title"]');
    expect(nullableRow.querySelector('.js-property-type-value')?.textContent).toBe('string');
    expect(nullableRow.querySelector('.js-nullable-indicator')?.textContent).toBe('no');
    const nullableStringRow = get(root, '[data-overlay-member="age"]');
    expect(nullableStringRow.querySelector('[data-overlay-property-open]')?.textContent).toBe('Add constraints');
    expect(root.querySelector('[data-overlay-full-schema]')).not.toBeNull(); expect(root.querySelector('[data-overlay-reference]')).not.toBeNull();
  });
  it('renders nullable inherited types like the main property view and exposes a direct constraint action', async () => {
    const root = mount(base({ properties: { ...base().properties, alias: { type: ['null', 'string'] } } }));
    click(root, '[data-schema-open="/allOf/0"]');
    const row = get(root, '[data-overlay-member="alias"]');
    expect(row.querySelector('.js-property-type-value')?.textContent).toBe('string');
    expect(row.querySelector('.js-nullable-indicator')?.textContent).toBe('yes');
    expect(row.textContent).not.toContain('["null","string"]');
    click(root, '[data-overlay-member="alias"] [data-overlay-property-open]'); await settle();
    expect(pointer(root)).toBe('/allOf/0/properties/alias');
    expect(value().allOf[0].properties.alias).toEqual({});
    expect([...get(root, '[data-facet-select]').querySelectorAll('option')].map(option => option.value)).toContain('validation.minLength');
  });
  it('opens inherited properties recursively and edits only compatible local facets; undo/redo preserves exact pointers', async () => {
    const root = mount(base()); click(root, '[data-schema-open="/allOf/0"]'); click(root, '[data-overlay-property-open="age"]'); await settle();
    expect(pointer(root)).toBe('/allOf/0/properties/age');
    const choices = [...get(root, '[data-facet-select]').querySelectorAll('option')].map(option => option.value);
    expect(choices).toContain('validation.minimum'); expect(choices).not.toContain('validation.pattern'); expect(choices).not.toContain('validation.minLength'); expect(choices).not.toContain('core.max-length');
    await facet(root, 'validation.minimum', '18');
    expect(value().allOf[0]).toEqual({ properties: { age: { minimum: 18 } } }); expect(value().properties.age.minimum).toBe(0);
    expect(root.querySelector('[data-overlay-classification="narrowing"]')).not.toBeNull();
    get(root, '[data-schema-heading]').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await settle();
    expect(value().allOf[0].properties.age).toEqual({}); expect(pointer(root)).toBe('/allOf/0/properties/age');
    get(root, '[data-schema-heading]').dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); await settle();
    expect(value().allOf[0].properties.age).toEqual({ minimum: 18 });
    click(root, '[data-schema-back]'); expect(document.activeElement.dataset.schemaOpen).toBe('/allOf/0/properties/age');
  });
  it('authors additional-properties policies without exposing a raw JSON facet field', async () => {
    const root = mount(base()); click(root, '[data-schema-open="/allOf/0"]');
    change(root, '[data-facet-select]', 'core.additional-properties'); click(root, '[data-facet-add]'); await settle();
    expect(root.querySelector('[data-facet-row="core.additional-properties"] textarea')).toBeNull();
    expect(get(root, '[data-additional-properties-policy="unspecified"]').textContent).toBe('Inherit base');

    click(root, '[data-additional-properties-policy="false"]'); await settle();
    expect(value().allOf[0].additionalProperties).toBe(false);
    const remove = get(root, '[data-facet-row="core.additional-properties"] [data-facet-remove]');
    expect(remove.getAttribute('aria-label')).toContain('Remove Core additional properties');
    expect(remove.textContent).not.toContain('Remove');

    click(root, '[data-additional-properties-policy="schema"]');
    change(root, '[data-additional-properties-schema]', JSON.stringify({ type: 'string' })); await settle();
    expect(value().allOf[0].additionalProperties).toEqual({ type: 'string' });
    expect(root.querySelector('[data-schema-open="/allOf/0/additionalProperties"]')).not.toBeNull();

    click(root, '[data-additional-properties-policy="unspecified"]'); await settle();
    expect(value().allOf[0]).not.toHaveProperty('additionalProperties');
    expect(value().additionalProperties).toBe(true);
  });
  it('adds a local property and required addition on an open object without restating base required names', async () => {
    const root = mount(base()); click(root, '[data-schema-open="/allOf/0"]');
    click(root, '.js-overlay-property-add summary'); change(root, '[data-overlay-new-name]', 'note'); click(root, '[data-overlay-property-add]'); await settle();
    expect(pointer(root)).toBe('/allOf/0/properties/note'); expect(value().allOf[0].properties.note).toEqual({ type: 'string' });
    await facet(root, 'validation.minLength', '1'); click(root, '[data-schema-back]');
    const checkbox = get(root, '[data-overlay-required="note"]'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(value().allOf[0].required).toEqual(['note']); expect(value().required).toEqual(['id']);
    const fixed = get(root, '[data-overlay-base-required-property="id"]'); expect(fixed.disabled).toBe(true); expect(fixed.checked).toBe(true);
    click(root, '[data-overlay-member-mode="local"]'); expect(root.querySelector('[data-overlay-member="id"]')).toBeNull();
    click(root, '[data-overlay-member-mode="effective"]'); expect(root.querySelector('[data-overlay-member="id"]')).not.toBeNull();
  });
  it('warns about closed-shape expansion and other incompatible deltas without changing source', () => {
    const document = base({ additionalProperties: false, allOf: [{ properties: { extra: { type: 'string' }, age: { maximum: -1 }, title: { maxLength: 80 } }, 'x-retain': 7 }] });
    const source = JSON.stringify(document, null, 2), root = mount(source); click(root, '[data-schema-open="/allOf/0"]');
    expect(root.querySelector('[data-overlay-property-add]')).not.toBeNull(); expect(root.textContent).toContain('closed');
    expect(get(root, '[data-overlay-add-warning]').textContent).toContain('diagnosed, not prohibited');
    for (const classification of ['expansion', 'conflict', 'redundant']) expect(root.querySelector('[data-overlay-classification="' + classification + '"]')).not.toBeNull();
    expect(root.querySelector('[data-schema-member="x-retain"]')).not.toBeNull();
    expect(handle!.getText()).toBe(source);
  });
  it('normal IF/THEN/ELSE add opens the correct contextual branch', async () => {
    const root = mount(base({ then: {} }));
    click(root, '[data-composition-add-branch="if"]'); await settle(); expect(pointer(root)).toBe('/if'); expect(value().if).toEqual({});
    click(root, '[data-schema-back]'); click(root, '[data-composition-add-branch="else"]'); await settle(); expect(pointer(root)).toBe('/else'); expect(value().else).toEqual({});
    expect(get(root, '[data-overlay-base-required]').textContent).toBe('id');
  });
  it('Advanced full-schema, canonical reference, and exact Source paths remain explicit and lossless', async () => {
    const source = '{ "$schema": "' + meta + '", "allOf": [ {"description":"keep","x-extra":[1,2]} ], "definitions": {"Text":{"type":"string","maxLength":20}}, "keep" : "verbatim" }';
    const root = mount(source); click(root, '[data-schema-open="/allOf/0"]');
    expect(root.querySelector('[data-inline-definition-type]')).toBeNull(); expect(handle!.getText()).toBe(source);
    click(root, '[data-overlay-full-schema]'); expect(root.querySelector('[data-inline-definition-type]')).not.toBeNull(); expect(handle!.getText()).toBe(source);
    change(root, '[data-inline-definition-type]', 'string'); await settle();
    expect(value().allOf[0]).toEqual({ type: 'string', description: 'keep', 'x-extra': [1, 2] }); expect(handle!.getText()).toContain('"keep" : "verbatim"');
    click(root, '[data-overlay-reference]'); click(root, '[data-overlay-reference-apply]'); await settle();
    expect(value().allOf[0].type).toEqual({ $ref: '#/definitions/Text' }); expect(value().allOf[0]['x-extra']).toEqual([1, 2]);
    click(root, '.js-overlay-advanced [data-composition-source]'); get(root, '[data-schema-source-text]').value = '{ "$ref" : "#/definitions/Text", "not": 7, "x-extra" : [1,2] }';
    click(root, '[data-schema-source-apply]'); await settle();
    expect(value().allOf[0].$ref).toBe('#/definitions/Text'); expect(value().allOf[0].not).toBe(7); expect(handle!.getText()).toContain('"keep" : "verbatim"');
    click(root, '[data-overlay-contextual]'); expect(get(root, '[data-schema-declaration]').dataset.declarationForm).toBe('legacy-reference-rules'); expect(root.querySelector('[data-schema-open="/allOf/0/not"]')).not.toBeNull();
  });
  it('keeps unhandled full-schema annotations and indeterminate facets visible in the source inventory', () => {
    const root = mount({ $schema: meta, type: 'decimal', allOf: [{ precision: 12, scale: 2, currency: 'USD', 'x-note': 'keep' }] });
    click(root, '[data-schema-open="/allOf/0"]');
    expect(root.querySelector('[data-facet-row="core.precision"]')).not.toBeNull();
    expect(root.querySelector('[data-schema-member="precision"]')).toBeNull();
    expect(root.querySelector('[data-schema-member="currency"]')).not.toBeNull();
    expect(root.querySelector('[data-schema-member="x-note"]')).not.toBeNull();
    expect(value().allOf[0].currency).toBe('USD');
  });
  it('allows source-neutral round trips through Advanced for malformed operands', () => {
    const root = mount({ $schema: meta, type: 'string', allOf: [7] }), before = handle!.getText();
    click(root, '[data-schema-open="/allOf/0"]'); click(root, '[data-overlay-full-schema]');
    expect(root.querySelector('[data-schema-opaque]')).not.toBeNull(); click(root, '[data-overlay-contextual]');
    expect(root.querySelector('[data-overlay-context]')).not.toBeNull(); expect(handle!.getText()).toBe(before);
  });

  it('labels NOT correctly and permits a contradictory excluded predicate with visible diagnostics', async () => {
    const root = mount({ $schema: meta, type: 'int32', minimum: 10, maximum: 20, not: {} });
    click(root, '[data-schema-open="/not"]');
    const semantic = get(root, '[data-overlay-effective-operator="and-not"]');
    expect(semantic.textContent).toContain('Base AND NOT Delta'); expect(semantic.textContent).toContain('empty Delta');
    await facet(root, 'validation.maximum', '9');
    expect(value().not).toEqual({ maximum: 9 }); expect(value().minimum).toBe(10);
    expect(root.querySelector('[data-overlay-classification="conflict"]')).not.toBeNull();
    expect(get(root, '[data-overlay-diagnostic-scope]').textContent).toContain('not a schema-validity');
    expect(root.querySelector('[data-inline-definition-type]')).toBeNull();
  });
  it('labels IF as a predicate and THEN/ELSE as selected paths while retaining identical base context', () => {
    const root = mount(base({ if: {}, then: {}, else: {} }));
    click(root, '[data-schema-open="/if"]'); expect(get(root, '[data-overlay-effective-operator="predicate"]').textContent).toContain('predicate, not an asserted constraint');
    click(root, '[data-schema-back]'); click(root, '[data-schema-open="/then"]');
    expect(get(root, '[data-overlay-effective-operator="conditional-path"]').textContent).toContain('THEN Delta on the selected path');
    click(root, '[data-schema-back]'); click(root, '[data-schema-open="/else"]');
    expect(get(root, '[data-overlay-effective-operator="conditional-path"]').textContent).toContain('does not match');
    expect(get(root, '[data-overlay-base-required]').textContent).toBe('id');
  });
  it('keeps closed-base additions editable with a warning rather than a spec-level prohibition', async () => {
    const root = mount(base({ additionalProperties: false })); click(root, '[data-schema-open="/allOf/0"]');
    expect(get(root, '[data-overlay-add-warning]').textContent).toContain('diagnosed, not prohibited');
    click(root, '.js-overlay-property-add summary'); change(root, '[data-overlay-new-name]', 'extra'); click(root, '[data-overlay-property-add]'); await settle();
    expect(value().allOf[0].properties.extra).toEqual({ type: 'string' }); expect(value().additionalProperties).toBe(false);
    expect(root.querySelector('[data-overlay-classification="expansion"]')).not.toBeNull();
    await facet(root, 'validation.minLength', '1'); expect(value().allOf[0].properties.extra).toEqual({ type: 'string', minLength: 1 });
  });

});
