// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;
afterEach(() => { handle?.dispose(); handle = undefined; document.body.innerHTML = ''; });
function mount(value: unknown): HTMLElement { const root = document.createElement('div'); document.body.append(root); handle = mountJsonStructureEditor(root, { text: JSON.stringify(value), title: 'recursive.struct.json' }); return root; }
function change(control: HTMLSelectElement, value: string): void { control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); }
function activate(root: HTMLElement, field: 'name' | 'type', pointer: string): void {
  (root.querySelector(`[data-property-field-activate="${field}"][data-property-pointer="${pointer}"]`) as HTMLButtonElement).click();
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('recursive Design schema controls', () => {
  it('drills through collection members and preserves their schemas while changing collection kind', async () => {
    const root = mount({ type: 'map', values: { type: 'array', items: { type: 'set', items: { type: 'uuid' } } } });
    (root.querySelector('[data-schema-child-kind="values"] [data-schema-open]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-schema-location-bar]')?.dataset.schemaPointer).toBe('/values');
    change(root.querySelector('[data-inline-definition-type]') as HTMLSelectElement,'set');await settle();
    (root.querySelector('[data-schema-child-kind="items"] [data-schema-open]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-schema-location-bar]')?.dataset.schemaPointer).toBe('/values/items');
    change(root.querySelector('[data-inline-definition-type]') as HTMLSelectElement,'map');await settle();
    const value = JSON.parse(handle!.getText());
    expect(value.values.type).toBe('set');expect(value.values.items.type).toBe('map');expect(value.values.items.values).toEqual({type:'uuid'});
  });
  it('adds nested types and namespaces without a definitions wrapper', async () => {
    const root = mount({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'urn:ui-nested-additions',
      name: 'UiNestedAdditions',
      definitions: { Domain: {} },
    });
    (root.querySelector('[data-select="/definitions/Domain"]') as HTMLButtonElement).click();
    await settle();
    const namespaceName = root.querySelector('[data-namespace-add-name]') as HTMLInputElement;
    namespaceName.value = 'Child';
    (root.querySelector('[data-namespace-add-child]') as HTMLButtonElement).click();
    await settle();

    (root.querySelector('[data-namespace-add-type="/definitions/Domain"]') as HTMLButtonElement).click();
    await settle();
    const typeName = root.querySelector('[data-type-create-name]') as HTMLInputElement;
    typeName.value = 'Thing';
    (root.querySelector('[data-type-create-primitive]') as HTMLSelectElement).value = 'string';
    (root.querySelector('[data-type-create-primitive-commit]') as HTMLButtonElement).click();
    await settle();

    const value = JSON.parse(handle!.getText());
    expect(value.definitions.Domain).toEqual({ Child: {}, Thing: { type: 'string' } });
    expect(value.definitions.Domain).not.toHaveProperty('definitions');
  });
  it('renders and edits nested object properties', async () => {
    const root = mount({ type: 'object', properties: { address: { type: 'object', properties: { city: { type: 'string' } } } } });
    (root.querySelector('[data-schema-child-key="address"] [data-schema-open]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-schema-location-bar]')?.dataset.schemaPointer).toBe('/properties/address');
    const pointer = '/properties/address/properties/city';
    activate(root, 'name', pointer);
    const name = root.querySelector(`[data-inline-property="name"][data-property-pointer="${pointer}"]`) as HTMLInputElement;
    name.value = 'town'; name.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(JSON.parse(handle!.getText()).properties.address.properties).toHaveProperty('town');
    const renamedPointer = '/properties/address/properties/town';
    (root.querySelector(`[data-property-row-select="${renamedPointer}"]`) as HTMLElement).click();
    expect(root.querySelector(`[data-property-row-select="${renamedPointer}"]`)?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.js-inspector-body')?.textContent).toContain('town');
    (root.querySelector(`[data-property-menu="${renamedPointer}"]`) as HTMLButtonElement).click();
    expect((root.querySelector(`[data-property-actions-menu="${renamedPointer}"]`) as HTMLElement).hidden).toBe(false);
    (root.querySelector(`[data-property-details="${renamedPointer}"]`) as HTMLButtonElement).click();
    expect(root.querySelector(`[data-property-editor="${renamedPointer}"] .js-property-details`)).not.toBeNull();
  });
  it('keeps an inline root in navigation alongside reusable definitions', () => {
    const root = mount({ type: 'tuple', properties: { id: { type: 'string' } }, tuple: ['id'], definitions: { Reusable: { type: 'string' } } });
    expect(root.querySelector('.js-type-creator')).toBeNull();
    expect(root.querySelector('[data-select=""]')).not.toBeNull();
    expect(root.textContent).toContain('Inline root');
    expect(root.querySelector('[data-select="/definitions/Reusable"]')).not.toBeNull();
  });
  it('does not expose the removed composition command surface', () => {
    const root = mount({ $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureConditionalComposition'], definitions: { Ref: { type: 'string' } }, type: 'string' });
    handle!.showCommandPalette();
    const select = root.querySelector('[data-action-select]') as HTMLSelectElement;
    expect([...select.options].some((option) => option.value.startsWith('composition.'))).toBe(false);
  });
  it('offers reusable references for choice alternatives', async () => {
    const root = mount({ definitions: { Value: { type: 'choice', choices: {} }, Ref: { type: 'string' } } });
    (root.querySelector('[data-select="/definitions/Value"]') as HTMLButtonElement).click();
    await settle();
    const type = root.querySelector('[data-choice-add-type]') as HTMLSelectElement;
    expect([...type.options].some((option) => option.value === 'ref:#/definitions/Ref')).toBe(true);
  });
  it('adds definitions without stranding an inline root', async () => {
    const root = mount({ type: 'object', properties: {}, definitions: {} });
    (root.querySelector('[data-command="definition.add"]') as HTMLButtonElement).click();
    const name = root.querySelector('[data-type-create-name]') as HTMLInputElement;
    name.value = 'Reusable';
    const primitive = root.querySelector('[data-type-create-primitive]') as HTMLSelectElement;
    primitive.value = 'string';
    (root.querySelector('[data-type-create-primitive-commit]') as HTMLButtonElement).click();
    await settle();
    const value = JSON.parse(handle!.getText());
    expect(value.type).toBe('object');
    expect(value).not.toHaveProperty('$root');
    expect(value.definitions.Reusable).toEqual({ type: 'string' });
  });
  it('preserves existing composition bytes while rendering Rules in the selected Design surface', () => {
    const value = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $uses: ['JSONStructureConditionalComposition'],
      allOf: [{ type: 'object', properties: { address: { type: 'object', properties: { city: { type: 'string' } } } } }],
      if: { type: 'string' },
      then: { type: 'string', minLength: 1 },
    };
    const root = mount({
      ...value,
    });
    expect(JSON.parse(handle!.getText())).toEqual(value);
    expect(root.querySelector('[data-composition-editor]')).not.toBeNull();
    expect(root.querySelector('[data-rule-pointer="/allOf"]')).not.toBeNull();
    expect(root.querySelector('[data-operand-pointer="/allOf/0"]')).not.toBeNull();
    expect(root.querySelector('[data-mode="composition"]')).toBeNull();
    expect(root.innerHTML).not.toMatch(/composition\.(?:allOf|anyOf|oneOf|not|conditional)/);
  });

  it('keeps nested Design authoring available beyond six levels', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let level = 7; level >= 1; level--) schema = { type: 'object', properties: { ['level' + level]: schema } };
    const root = mount(schema);
    let pointer = '';
    for (let level=1;level<=7;level++) {
      const row=root.querySelector('[data-schema-child-key="level'+level+'"]');expect(row).not.toBeNull();
      (row!.querySelector('[data-schema-open]') as HTMLButtonElement).click();pointer+='/properties/level'+level;
      expect(root.querySelector('[data-schema-location-bar]')?.dataset.schemaPointer).toBe(pointer);
      expect(root.querySelectorAll('[data-schema-sheet]')).toHaveLength(1);
    }
    expect(root.querySelector('[data-schema-declaration]')?.dataset.declarationForm).toBe('explicit-type');
  });

  it('blocks scalar to collection switches until a member schema is explicit', async () => {
    const root = mount({ type: 'object', properties: { value: { type: 'string' } } });
    const pointer = '/properties/value';
    for (const collection of ['array', 'set', 'map']) {
      let select = root.querySelector(`[data-inline-type-replace="type:string"][data-property-pointer="${pointer}"]`) as HTMLSelectElement | null;
      if (!select) {
        activate(root, 'type', pointer);
        select = root.querySelector(`[data-inline-type-replace="type:string"][data-property-pointer="${pointer}"]`) as HTMLSelectElement;
      }
      select.value = `collection:${collection}`; select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
      expect(JSON.parse(handle!.getText()).properties.value).toEqual({ type: 'string' });
      expect(select.value).toBe('type:string');
    }
  });

});
