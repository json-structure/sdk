import { describe, expect, it } from 'vitest';
import { catalogBrowserView, designView, graphView, instanceView, mobileModeSelect, prefersReducedMotion, problemsView, shouldFitGraphOnEntry, workbenchFocusIdentityAttributes, workbenchTitleChrome } from '../src/ui/index.js';
import { BUNDLED_SEMANTIC_PROVIDER, CatalogRegistry, bundledCatalogResult } from '../src/catalogs.js';
import { DocumentSession } from '../src/session.js';
import { resolveEffectiveMembers } from '../src/phase4/effective-members.js';
import { InstanceWorkspace } from '../src/phase4/instance-workspace.js';
import { editorStyles } from '../src/ui/prototype-styles.js';

type Rgb = readonly [number, number, number];

function themeToken(selector: string, name: string): string {
  const start = editorStyles.indexOf(`${selector} {`);
  const block = editorStyles.slice(start, editorStyles.indexOf('\n}', start));
  const match = block.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([^;]+);`));
  if (!match?.[1]) throw new Error(`Missing ${name} in ${selector}`);
  return match[1];
}

function rgb(value: string): Rgb {
  const match = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) throw new Error(`Expected a hex color, got ${value}`);
  return [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16), Number.parseInt(match[3]!, 16)];
}

function composite(value: string, background: Rgb): Rgb {
  const match = value.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  if (!match) throw new Error(`Expected an rgba color, got ${value}`);
  const alpha = Number(match[4]);
  return [0, 1, 2].map((index) => Number(match[index + 1]) * alpha + background[index]! * (1 - alpha)) as unknown as Rgb;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const luminance = (color: Rgb): number => color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('workbench interaction markup', () => {
  it('renders VS Code-style integrated Electron chrome without duplicate product or theme rows', () => {
    const html = workbenchTitleChrome('example.struct.json', 'integrated');
    expect(html).toContain('class="js-titlebar"');
    expect(html).toContain('role="menubar"');
    expect(html).toContain('class="js-command-center"');
    expect(html).toContain('data-theme-choice="dark"');
    expect(html).not.toContain('class="js-theme"');
    expect(workbenchTitleChrome('example.struct.json', 'embedded')).toBe('');
  });

  it('keeps every representation and workflow reachable from the compact mode selector', () => {
    const html = mobileModeSelect('conversion');
    for (const mode of ['design', 'graph', 'source', 'analysis', 'instance', 'conversion', 'libraries']) expect(html).toContain(`value="${mode}"`);
    expect(html).toContain('value="conversion" selected');
  });

  it('renders native inline property controls inside table cells', () => {
    const html = designView('Person', 'object', undefined, [{ name: 'id', pointer: '/definitions/Person/properties/id', type: 'uuid', required: true, schema: { type: 'uuid' } }], undefined, [], [], 'local', undefined, undefined, [
      { name: 'Address', pointer: '/definitions/Common/Address' },
      { name: 'Person', pointer: '/definitions/Person' },
    ]);
    expect(html).not.toContain('<button class="js-cell js-code" role="cell"');
    expect(html).not.toContain('<button class="js-cell js-row-action" role="cell"');
    expect(html).toContain('data-inline-property="name"');
    expect(html).toContain('data-inline-property="type"');
    expect(html).toContain('data-inline-property="required"');
    expect(html).toContain('data-inline-property="description"');
    expect(html).toContain('<optgroup label="Primitive types">');
    expect(html).toContain('value="type:any"');
    expect(html).toContain('value="type:string"');
    expect(html).not.toContain('value="type:object"');
    expect(html).not.toContain('value="type:array"');
    expect(html).toContain('<optgroup label="Reusable types">');
    expect(html).toContain('value="ref:#/definitions/Common/Address"');
    expect(html).toContain('>Common.Address</option>');
    expect(html).toContain('data-type-drop="/definitions/Person/properties/id"');
    expect(html).toContain('<span class="js-type-drop-zone" aria-hidden="true"></span>');
    expect(html).toContain('<div class="js-cell js-action-cell" role="cell"><button class="js-row-action"');
    expect(html).toContain('data-property-details="/definitions/Person/properties/id"');
  });

  it('renders the annotations panel directly below its property row', () => {
    const pointer = '/definitions/Person/properties/name';
    const html = designView('Person', 'object', undefined, [{
      name: 'name', pointer, type: 'string', required: false,
      schema: { type: 'string', minLength: 2, semanticRole: 'observationValue' },
    }], pointer, [], [], 'local', undefined, pointer, [{ name: 'Person', pointer: '/definitions/Person' }]);
    expect(html).toContain(`data-property-editor="${pointer}" aria-current="true"`);
    expect(html).toContain(`data-property-details="${pointer}" aria-expanded="true"`);
    expect(html).toContain('class="js-property-details"');
    expect(html).toContain('aria-label="Validation and annotations for name"');
    expect(html).toContain('data-inline-keyword="minLength"');
    expect(html).toContain('data-inline-keyword="semanticRole"');
    expect(html).toContain('data-property-detail-add');
    expect(html).toContain('data-inline-keyword-remove');
    expect(html).not.toContain('Advanced property schema');
    expect(html).not.toContain('Apply schema JSON');
    expect(html.indexOf('class="js-property-details"')).toBeLessThan(html.indexOf('</div></div><section class="js-design-section">'));
  });

  it('renders string-backed numeric bounds as text without losing their lexical form', () => {
    const pointer = '/definitions/Limits/properties/huge';
    const html = designView('Limits', 'object', undefined, [{
      name: 'huge', pointer, type: 'int128', required: false,
      schema: { type: 'int128', minimum: '9007199254740993' },
    }], pointer, [], [], 'local', undefined, pointer);
    expect(html).toContain('data-inline-keyword="minimum"');
    expect(html).toContain('type="text" inputmode="decimal" value="9007199254740993"');
    expect(html).toContain('value="units.symbol"');
    expect(html).toContain('value="units.symbols"');
  });

  it('routes alternative required sets to the structured editor', () => {
    const html = designView('Animal', 'object', undefined, [{
      name: 'legs', pointer: '/definitions/Animal/properties/legs', type: 'int8', required: true, requiredAlternatives: true, schema: { type: 'int8' },
    }], undefined);
    expect(html).toContain('data-action-id="property.required-alternatives"');
    expect(html).toContain('data-action-pointer="/definitions/Animal"');
    expect(html).not.toContain('data-inline-property="required"');
  });

  it('renders ordered identity and selectable relation summaries in Design', () => {
    const html = designView('Copy', 'object', undefined, [], '/definitions/Copy/relations/edition', ['barcode', 'shelfmark'], [{
      pointer: '/definitions/Copy/relations/edition', name: 'edition', targetTypeRef: '#/definitions/Edition', cardinality: 'single', scope: '#/definitions/Catalog/properties/editions',
    }]);
    expect(html).toContain('<span class="js-order">1</span><span class="js-code">barcode</span>');
    expect(html).toContain('<span class="js-order">2</span><span class="js-code">shelfmark</span>');
    expect(html).toContain('data-action-id="relation.identity"');
    expect(html).toContain('data-action-id="relation.add"');
    expect(html).toContain('data-select="/definitions/Copy/relations/edition" aria-current="true"');
    expect(html).toContain('#/definitions/Edition');
    expect(html).toContain('single');
    expect(html).toContain('editions');
  });

  it('renders explicit reordering controls for ordered property selections', () => {
    const source = JSON.stringify({ $schema: 'https://json-structure.org/meta/relations/v0/#', $uses: ['JSONStructureRelations'], definitions: { Person: { type: 'object', properties: { tenant: { type: 'string' }, id: { type: 'string' } }, identity: ['tenant', 'id'] } } });
    const snapshot = new DocumentSession('memory://ordered-identity', source).snapshot();
    expect(snapshot.model?.projections.definitions[0]?.identity).toEqual(['tenant', 'id']);
    const html = designView('Person', 'object', undefined, [], undefined, ['tenant', 'id']);
    expect(html.indexOf('<span class="js-code">tenant</span>')).toBeLessThan(html.indexOf('<span class="js-code">id</span>'));
  });

  it('exposes keyboard-operable graph zoom and fit controls', () => {
    const snapshot = new DocumentSession('memory://graph-controls', '{"definitions":{"A":{"type":"object"},"B":{"type":"object","$extends":"#/definitions/A"}}}').snapshot();
    const html = graphView(snapshot, undefined);
    expect(html).toContain('data-graph-zoom-out');
    expect(html).toContain('data-graph-zoom-in');
    expect(html).toContain('data-graph-fit');
    expect(html).toContain('data-graph-canvas');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('class="js-node-hit-target"');
  });

  it('fits Graph on first entry and preserves its camera on later entries', () => {
    expect(shouldFitGraphOnEntry('design', 'graph', false)).toBe(true);
    expect(shouldFitGraphOnEntry('graph', 'graph', true)).toBe(false);
    expect(shouldFitGraphOnEntry('source', 'graph', true)).toBe(false);
    expect(shouldFitGraphOnEntry('design', 'source', false)).toBe(false);
  });

  it('preserves each Problem as a list item owned by the Problems list', () => {
    const diagnostic = { code: 'duplicate', message: 'Same message', severity: 'error' as const, location: { uri: 'memory://problems', pointer: '/definitions/A' } };
    const html = problemsView([diagnostic, diagnostic]);
    expect(html.match(/role="listitem"/g)).toHaveLength(2);
    expect(html.match(/data-problem="\/definitions\/A"/g)).toHaveLength(2);
  });

  it('tracks stable focus identities for graph, instance, conversion, and library rerenders', () => {
    expect(workbenchFocusIdentityAttributes).toEqual(expect.arrayContaining([
      'data-graph-select', 'data-graph-breadcrumb', 'data-graph-search',
      'data-instance-input', 'data-instance-validate', 'data-instance-diagnostic',
      'data-conversion-run', 'data-conversion-open',
      'data-libraries-load', 'data-library-read', 'data-library-publish',
    ]));
  });

  it('detects reduced motion for immediate graph settling', () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });

  it('keeps compact graph search reachable and uses theme-safe surfaces and explicit targets', () => {
    expect(editorStyles).toContain('--js-on-accent:#fff');
    expect(editorStyles).toContain('.js-shell { height:100%; min-height:0;');
    expect(editorStyles).toContain('.js-graph-search { display:block; min-width:0; }');
    expect(editorStyles).not.toContain('.js-graph-search { display:none; }');
    expect(editorStyles).toContain('.js-node-hit-target { fill:transparent; stroke:transparent; stroke-width:44;');
    expect(editorStyles).toContain('.js-command-trigger { width:44px; height:44px;');
    expect(editorStyles).toContain('.js-property-advanced summary { min-height:44px;');
    expect(editorStyles).toContain('.js-integrity-manifest summary { min-height:44px;');
    expect(editorStyles).toContain('.js-provider-remove { width:44px; height:44px;');
    expect(editorStyles).toContain('.js-catalog-head button { width:44px; height:44px;');
    expect(editorStyles).toContain('.js-tree-item>span:not(.js-kind) { min-width:0; overflow:hidden; text-overflow:ellipsis;');
    expect(editorStyles).toContain('@media (prefers-reduced-motion:reduce)');
  });

  it('keeps both compact drawers in the full workbench grid with usable touch targets', () => {
    expect(editorStyles).toContain('.js-outline.js-drawer-open,.js-inspector.js-drawer-open { position:absolute; z-index:12; grid-area:1 / 1 / -1 / -1;');
    expect(editorStyles).toContain('width:min(340px,90%); display:flex;');
    expect(editorStyles).toContain('.js-outline.js-drawer-open { inset-inline-start:0; }');
    expect(editorStyles).toContain('.js-tree-item { width:100%; height:28px;');
    expect(editorStyles).toContain('.js-panel-head button,.js-graph-toolbar button');
    expect(editorStyles).toContain('.js-tree-item { height:44px; }');
  });

  it('keeps quiet and accent text at WCAG AA contrast on plain and selected surfaces', () => {
    const darkSelector = ':host,.json-structure-editor';
    const darkRaised = rgb(themeToken(darkSelector, '--js-raised'));
    const darkQuiet = rgb(themeToken(darkSelector, '--js-quiet'));
    const darkSelected = composite(themeToken(darkSelector, '--js-selected'), darkRaised);
    const lightSelector = '.json-structure-editor[data-theme="light"]';
    const lightRaised = rgb(themeToken(lightSelector, '--js-raised'));
    const lightAccent = rgb(themeToken(lightSelector, '--js-accent'));
    const lightSelected = composite(themeToken(lightSelector, '--js-selected'), lightRaised);

    expect(contrast(darkQuiet, darkRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkQuiet, darkSelected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightAccent, lightRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightAccent, lightSelected)).toBeGreaterThanOrEqual(4.5);
  });

  it('renders effective member origin, inheritance path, add-in, and conflict provenance', () => {
    const document = {
      $offers: { Audited: '#/definitions/Audited' },
      definitions: {
        Base: { type: 'object', properties: { id: { type: 'string' }, shared: { type: 'string' } }, required: ['id'] },
        Target: { type: 'object', $extends: '#/definitions/Base', properties: { shared: { type: 'number' } } },
        Audited: { abstract: true, type: 'object', $extends: '#/definitions/Target', properties: { updatedAt: { type: 'datetime' } } },
      },
    };
    const effective = resolveEffectiveMembers(document, '#/definitions/Target', { addIns: ['Audited'] });
    const html = designView('Target', 'object', undefined, [], undefined, [], [], 'effective', effective);
    expect(html).toContain('data-member-mode="effective" aria-pressed="true"');
    expect(html).toContain('data-member-origin="inherited"');
    expect(html).toContain('data-member-origin="add-in"');
    expect(html).toContain('Base');
    expect(html).toContain('Audited');
    expect(html).toContain('local-redefinition');
    expect(html).toContain('data-effective-source="/definitions/Base/properties/id"');
  });

  it('renders root selection and expandable instance evaluation trace navigation', () => {
    const workspace = new InstanceWorkspace({ $schema: 'https://json-structure.org/meta/validation/v0/#', type: 'object', properties: { age: { type: 'int8' } }, required: ['age'] }, { age: 128 });
    const result = workspace.validate();
    const selection = workspace.selectDiagnostic(0);
    const html = instanceView('{"age":128}', result, [{ pointer: '/definitions/Person', label: 'Person' }], '/definitions/Person', selection);
    expect(html).toContain('data-instance-root');
    expect(html).toContain('data-instance-input type="file"');
    expect(html).not.toContain('{"age":128}');
    expect(html).toContain('value="/definitions/Person" selected');
    expect(html).toContain('class="js-trace js-trace-invalid"');
    expect(html).toContain('data-trace-instance="/age"');
    expect(html).toContain('data-trace-schema="/properties/age/type"');
    expect(html).toContain('data-instance-diagnostic="0"');
  });

  it('renders catalog providers, exact emitted JSON, provenance trust, and custom values', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_SEMANTIC_PROVIDER);
    const request = registry.createRequest('ui-catalog', 1, 'coordinateReferenceSystem', '4326');
    const result = registry.merge(request, [bundledCatalogResult(request, BUNDLED_SEMANTIC_PROVIDER.id)]);
    const html = catalogBrowserView([BUNDLED_SEMANTIC_PROVIDER], result, 'coordinateReferenceSystem', '4326');
    expect(html).toContain('data-catalog-provider="bundled.semantic-annotations"');
    expect(html).toContain('data-catalog-suggestion="0"');
    expect(html).toContain('WGS 84 geographic coordinates');
    expect(html).not.toContain('&quot;reference&quot;');
    expect(html).not.toContain('exact JSON');
    expect(html).not.toContain('Custom value or JSON');
    expect(html).toContain('data-trusted="false"');
    expect(html).toContain('data-catalog-custom-apply');
    expect(html).toContain('data-catalog-close aria-label="Close catalog"');
  });
});