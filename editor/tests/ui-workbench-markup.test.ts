import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogBrowserView, compositeSchema, designView, graphView, instanceView, mobileModeSelect, prefersReducedMotion, problemsView, projectProperties, shouldFitGraphOnEntry, workbenchFocusIdentityAttributes, workbenchShell, workbenchTitleChrome } from '../src/ui/index.js';
import { BUNDLED_QUDT_QUANTITY_KIND_PROVIDER, BUNDLED_SEMANTIC_PROVIDER, CatalogRegistry, bundledCatalogResult } from '../src/catalogs.js';
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
  it('locks the host shell while containing scroll in intentional panes', () => {
    const shellCss = readFileSync(new URL('../src/ui/electron-shell.css', import.meta.url), 'utf8');
    expect(shellCss).toContain('html, body, #editor');
    expect(shellCss).toContain('overflow: hidden');
    expect(shellCss).toContain('overscroll-behavior: none');
    expect(shellCss).toContain('#editor { position: fixed; inset: 0; }');
    for (const selector of ['.js-tree', '.js-document-metadata', '.js-inspector', '.js-problem-list', '.js-graph-navigator,.js-graph-inspector']) {
      expect(editorStyles).toContain(selector);
    }
    expect(editorStyles).toContain('overscroll-behavior:contain');
    expect(editorStyles).toContain('.js-center>.js-graph,.js-center>.js-source-view { overflow:hidden; overscroll-behavior:none; }');
    expect(editorStyles).toContain('.js-workbench[data-active-mode="graph"]>.js-center>.js-document-metadata { display:none; }');
    expect(editorStyles).toContain('.js-workbench[data-active-mode="source"]>.js-center>.js-document-metadata { display:none; }');
  });

  it('renders VS Code-style integrated Electron chrome without duplicate product or theme rows', () => {
    const html = workbenchTitleChrome('example.struct.json', 'integrated');
    expect(html).toContain('class="js-titlebar"');
    expect(html).toContain('class="js-titlebar-drag"');
    expect(html).toContain('role="menubar"');
    expect(html).toContain('class="js-command-center"');
    expect(html).toContain('data-theme-choice="dark"');
    expect(html).not.toContain('class="js-theme"');
    expect(editorStyles).toContain('-webkit-app-region:drag');
    expect(editorStyles).toContain('-webkit-app-region:no-drag');
    expect(editorStyles).toContain('width:min(520px,72vw)');
    expect(editorStyles).toContain('justify-self:center');
    expect(workbenchTitleChrome('example.struct.json', 'embedded')).toBe('');
  });

  it('uses the compact selector for the five primary editor modes', () => {
    const html = mobileModeSelect('graph');
    for (const mode of ['design', 'graph', 'source', 'instance', 'conversion']) expect(html).toContain(`value="${mode}"`);
    for (const mode of ['analysis', 'libraries']) expect(html).not.toContain(`value="${mode}"`);
    expect(html).toContain('value="graph" selected');
  });

  it('uses the activity rail for modes and groups type actions in the namespace tree', () => {
    const snapshot = new DocumentSession('memory://navigation', JSON.stringify({
      definitions: {
        Domain: {
          Person: { type: 'object' },
          Place: { type: 'object' },
        },
        Shared: {
          Identifier: { type: 'string' },
        },
      },
    })).snapshot();
    const definitions = [
      { name: 'Person', pointer: '/definitions/Domain/Person', namespace: '/definitions/Domain' },
      { name: 'Place', pointer: '/definitions/Domain/Place', namespace: '/definitions/Domain' },
      { name: 'Identifier', pointer: '/definitions/Shared/Identifier', namespace: '/definitions/Shared' },
    ];
    const html = workbenchShell(snapshot, 'navigation.struct.json', definitions, '/definitions/Domain/Person', [], '/definitions/Domain/Person', 'graph', false);

    expect(html).toContain('<nav class="js-activity" aria-label="Editor modes">');
    for (const mode of ['design', 'graph', 'source', 'instance', 'conversion']) expect(html).toContain(`data-mode="${mode}"`);
    expect(html).not.toContain('data-mode="libraries"');
    expect(html).not.toContain('class="js-tabs"');
    expect(html).not.toContain('title="Convert this structure"');
    expect(html).toContain('data-command="definition.add" title="Add type"');
    expect(html).toContain('data-library-open title="Import type library"');
    expect(html).toContain('role="tree" aria-label="Types by namespace"');
    expect(html).toContain('<details class="js-tree-namespace" data-namespace-pointer="/definitions/Domain" open>');
    expect(html).toContain('data-select="/definitions/Domain" aria-current="false">Domain</button><small>2</small>');
    expect(html).toContain('data-select="/definitions/Shared" aria-current="false">Shared</button><small>1</small>');
    expect(html).toContain('data-select="/definitions/Domain/Person"');
    expect(html).toContain('class="js-schema-strip"');
    expect(html).toContain('data-document-member="$schema"');
    expect(html).toContain('data-document-member="$id"');
    expect(html).toContain('data-document-action="core.name"');
    expect(html).toContain('data-document-action="core.description"');
    expect(html).toContain('data-meta-schema-select');
    expect(html).toContain('data-meta-schema-custom');
    expect(html).toContain('class="js-document-uses"');
    expect(html).toContain('class="js-document-offers"');
    expect(html).toContain('data-document-root');
    expect(html).toContain('<option value="" selected>No explicit root</option>');
    expect(html).not.toContain('data-document-import');
    expect(html).toContain('data-select="/definitions"');
    expect(html).toContain('>Domain / Person</option>');
    expect(html).toContain('>Shared / Identifier</option>');
    expect(html).not.toContain('class="js-breadcrumbs"');

    const convertHtml = workbenchShell(snapshot, 'navigation.struct.json', definitions, '/definitions/Domain/Person', [], '/definitions/Domain/Person', 'conversion', false);
    expect(convertHtml).toContain('data-mobile-drawer="types" aria-controls="js-outline" aria-haspopup="dialog" aria-expanded="false" hidden');
    expect(convertHtml).toContain('data-mobile-drawer="inspector" aria-controls="js-inspector" aria-haspopup="dialog" aria-expanded="false" hidden');
    expect(convertHtml).not.toContain('<strong>Person</strong>');

    const inlineSnapshot = new DocumentSession('memory://inline-root', JSON.stringify({
      type: 'object',
      properties: {},
      definitions: { Reusable: { type: 'string' } },
    })).snapshot();
    const inlineHtml = workbenchShell(inlineSnapshot, 'inline.struct.json', [
      { name: 'Reusable', pointer: '/definitions/Reusable', namespace: '/definitions' },
    ], '', [], '', 'design', false);
    expect(inlineHtml).toContain('data-document-root aria-label="Document root type" disabled');
    expect(inlineHtml).toContain('<option selected>Inline root</option>');
  });

  it('starts from composite type choices without opening the generic action editor', () => {
    const html = designView(undefined, undefined, undefined, [], undefined);
    expect(html).toContain('Choose the first type');
    expect(html).toContain('data-type-create-name placeholder="Root"');
    expect(html).not.toContain('data-type-create-name value=');
    for (const type of ['object', 'array', 'set', 'map', 'tuple', 'choice']) {
      expect(html).toContain(`data-type-create="${type}"`);
    }
    expect(html).not.toContain('data-command="definition.add"');
    expect(html).not.toContain('class="js-inline-editor"');
    expect(html).toContain('data-type-create-primitive');
    expect(html).toContain('<option value="int128">int128</option>');
    expect(html).toContain('Start from an existing schema or data source');
    for (const command of ['fbs2s', 'j2s', 'k2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s']) {
      expect(html).toContain(`data-start-cli-command="${command}"`);
    }
    expect(compositeSchema('object')).toEqual({ type: 'object', properties: {} });
    expect(compositeSchema('array')).toEqual({ type: 'array', items: { type: 'string' } });
    expect(compositeSchema('map')).toEqual({ type: 'map', values: { type: 'string' } });
    expect(compositeSchema('tuple')).toEqual({ type: 'tuple', properties: {}, tuple: [] });
    expect(compositeSchema('choice')).toEqual({ type: 'choice', choices: {} });
    expect(compositeSchema('uuid')).toEqual({ type: 'uuid' });
  });

  it('renders dedicated tuple, choice, collection, namespace, and structured facet editors', () => {
    const tuplePointer = '/definitions/Pair';
    const tupleDocument = { definitions: { Pair: { type: 'tuple', properties: { first: { type: 'string' }, second: { type: 'integer' } }, tuple: ['first', 'second'] } } };
    const tupleHtml = designView('Pair', 'tuple', undefined, [
      { name: 'first', pointer: `${tuplePointer}/properties/first`, type: 'string', required: false, schema: { type: 'string' } },
      { name: 'second', pointer: `${tuplePointer}/properties/second`, type: 'integer', required: false, schema: { type: 'integer' } },
    ], tuplePointer, [], [], 'local', undefined, undefined, [], tupleDocument, new Set(), false, false, tuplePointer);
    expect(tupleHtml).toContain('class="js-design-section js-tuple-order"');
    expect(tupleHtml).toContain(`data-tuple-pointer="${tuplePointer}"`);
    expect(tupleHtml).toContain(`data-property-menu="${tuplePointer}/properties/second"`);
    expect(tupleHtml).toContain(`data-property-actions-menu="${tuplePointer}/properties/second" hidden`);

    const choicePointer = '/definitions/Value';
    const choiceDocument = { definitions: { Value: { type: 'choice', choices: { text: { type: 'string' } } } } };
    const choiceHtml = designView('Value', 'choice', undefined, [], choicePointer, [], [], 'local', undefined, undefined, [], choiceDocument, new Set(), false, false, choicePointer);
    expect(choiceHtml).toContain('class="js-design-section js-choice-editor"');
    expect(choiceHtml).toContain(`data-inline-choice-name="${choicePointer}/choices/text"`);
    expect(choiceHtml).toContain(`data-inline-choice-delete="${choicePointer}/choices/text"`);
    expect(choiceHtml).toContain(`data-choice-add="${choicePointer}"`);

    const collectionPointer = '/definitions/Values';
    const collectionDocument = { definitions: { Values: { type: 'array', items: { type: 'uuid' } } } };
    const collectionHtml = designView('Values', 'array', undefined, [], collectionPointer, [], [], 'local', undefined, undefined, [], collectionDocument, new Set(), false, false, collectionPointer);
    expect(collectionHtml).toContain('class="js-design-section js-collection-editor"');
    expect(collectionHtml).toContain(`data-property-pointer="${collectionPointer}/items"`);

    const namespaceDocument = { definitions: { Empty: {} } };
    const namespaceHtml = designView(undefined, undefined, undefined, [], '/definitions/Empty', [], [], 'local', undefined, undefined, [], namespaceDocument);
    expect(namespaceHtml).toContain('data-inline-namespace-name="/definitions/Empty"');
    expect(namespaceHtml).toContain('data-namespace-delete="/definitions/Empty"');
    expect(namespaceHtml).toContain('data-namespace-delete-contents="/definitions/Empty"');

    const facetDocument = {
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: { Record: { type: 'object', properties: {} } },
    };
    const facetHtml = designView('Record', 'object', undefined, [], '/definitions/Record', [], [], 'local', undefined, undefined, [], facetDocument, new Set(), false, false, '/definitions/Record');
    for (const action of ['validation.propertyNames', 'validation.dependentRequired', 'validation.patternProperties', 'composition.allOf', 'composition.conditional', 'semantic.vectorReferenceFrames', 'semantic.tensorReferenceFrames', 'semantic.frameTransforms', 'semantic.linearReferenceSystem', 'semantic.colorSpaces', 'semantic.audioChannels', 'semantic.spectralBands']) {
      expect(facetHtml).toContain(`value="${action}"`);
    }
  });

  it('does not render root designation as a per-type flag', () => {
    const pointer = '/definitions/Root';
    const html = designView('Root', 'object', undefined, [], pointer, [], [], 'local', undefined, undefined, [], undefined, new Set(), false, false, pointer, true);
    expect(html).not.toContain('data-root-toggle');
    expect(html).toContain(`data-inline-definition-name="${pointer}" value="Root"`);
    expect(html).toContain(`data-inline-definition-description="${pointer}" placeholder="No description yet."`);
    expect(html).not.toContain('Document root');
    expect(editorStyles).toContain('.json-structure-editor .js-definition-name');
    expect(editorStyles).toContain('font-size:25px; font-weight:650;');
  });

  it('renders compact property values and the existing editor only for the active field', () => {
    const pointer = '/definitions/Person/properties/id';
    const rows = [{ name: 'id', pointer, type: 'uuid', required: true, description: 'Stable identifier', schema: { type: 'uuid', description: 'Stable identifier' } }];
    const definitions = [
      { name: 'Address', pointer: '/definitions/Common/Address' },
      { name: 'Person', pointer: '/definitions/Person' },
    ];
    const html = designView('Person', 'object', undefined, rows, undefined, [], [], 'local', undefined, undefined, definitions);
    expect(html).not.toContain('<button class="js-cell js-code" role="cell"');
    expect(html).not.toContain('<button class="js-cell js-row-action" role="cell"');
    expect(html).toContain('data-property-field-activate="name"');
    expect(html).toContain('data-property-field-activate="type"');
    expect(html).toContain('data-property-field-activate="description"');
    expect(html).not.toContain('data-inline-type-add');
    expect(html).not.toContain('data-inline-type-replace="type:uuid"');
    expect(html).not.toContain('<textarea class="js-inline-description" rows="1"');
    expect(html).toContain('data-inline-property="nullable"');
    expect(html).toContain('data-inline-property="required"');
    expect(html).toContain('data-inline-property="identity"');
    expect(html).toContain(`data-property-row-select="${pointer}"`);
    expect(html).toContain(`data-property-menu="${pointer}"`);
    expect(html).toContain(`data-property-actions-menu="${pointer}" hidden`);

    const nameHtml = designView('Person', 'object', undefined, rows, pointer, [], [], 'local', undefined, undefined, definitions, undefined, new Set(), false, false, undefined, false, { pointer, field: 'name' });
    expect(nameHtml).toContain('<input class="js-inline-name js-code"');
    expect(nameHtml).not.toContain('data-property-field-activate="name"');

    const typeHtml = designView('Person', 'object', undefined, rows, pointer, [], [], 'local', undefined, undefined, definitions, undefined, new Set(), false, false, undefined, false, { pointer, field: 'type' });
    expect(typeHtml).toContain('data-inline-type-add');
    expect(typeHtml).toContain('data-inline-type-replace="type:uuid"');
    expect(typeHtml).not.toContain('data-inline-type-remove="type:uuid"');
    expect(typeHtml).toContain('<optgroup label="Primitive types">');
    expect(typeHtml).toContain('value="type:any"');
    expect(typeHtml).toContain('value="type:string"');
    expect(typeHtml).not.toContain('value="type:object"');
    expect(typeHtml).not.toContain('value="type:array"');
    expect(typeHtml).toContain('<optgroup label="Collection types">');
    expect(typeHtml).toContain('array&lt;string&gt;');
    expect(typeHtml).toContain('map&lt;string, string&gt;');
    expect(typeHtml).toContain('<optgroup label="Reusable types">');
    expect(typeHtml).toContain('value="ref:#/definitions/Common/Address"');
    expect(typeHtml).toContain('>Common.Address</option>');
    expect(typeHtml).toContain(`data-type-drop="${pointer}"`);
    expect(typeHtml).toContain('<span class="js-type-drop-zone" aria-hidden="true"></span>');
    expect(typeHtml).toContain('data-property-details="/definitions/Person/properties/id"');

    const descriptionHtml = designView('Person', 'object', undefined, rows, pointer, [], [], 'local', undefined, undefined, definitions, undefined, new Set(), false, false, undefined, false, { pointer, field: 'description' });
    expect(descriptionHtml).toContain('<textarea class="js-inline-description" rows="1"');

    const menuHtml = designView('Person', 'object', undefined, rows, pointer, [], [], 'local', undefined, undefined, definitions, undefined, new Set(), false, false, undefined, false, undefined, pointer);
    expect(menuHtml).toContain(`role="menu" data-property-actions-menu="${pointer}"`);
    expect(menuHtml).toContain(`data-inline-property-delete="${pointer}"`);
    expect(menuHtml).toContain('>Delete property</button>');
  });

  it('renders collection schemas as editable expressions instead of opaque type pills', () => {
    const pointer = '/definitions/Route/properties/waypoints';
    const html = designView('Route', 'object', undefined, [{
      name: 'waypoints', pointer, type: 'array', required: false,
      schema: { type: 'array', items: { type: { $ref: '#/definitions/Geo/Point' } } },
    }], pointer, [], [], 'local', undefined, undefined, [
      { name: 'Point', pointer: '/definitions/Geo/Point' },
    ]);
    expect(html).toContain('array&lt;Geo.Point&gt;');
    expect(html).toContain('class="js-cell js-composite-cell"');
    expect(html).toContain('data-inline-collection-kind');
    expect(html).toContain('<option value="array" selected>array</option>');
    expect(html).toContain('>Item type</span>');
    expect(html).toContain(`data-property-pointer="${pointer}/items"`);
    expect(html).toContain(`data-inline-type-replace="ref:#/definitions/Geo/Point"`);
    expect(html).not.toContain(`data-inline-type-remove="ref:#/definitions/Geo/Point"`);
  });

  it('renders structured collection branches inside nullable unions without losing members', () => {
    const pointer = '/definitions/Index/properties/byName';
    const html = designView('Index', 'object', undefined, [{
      name: 'byName', pointer, type: 'map or null', required: false,
      schema: { type: [{ type: 'map', values: { type: 'uuid' } }, 'null'] },
    }], pointer);
    expect(html).toContain('map&lt;string, uuid&gt;');
    expect(html).toContain('data-inline-property="nullable"');
    expect(html).toMatch(/data-inline-property="nullable"[^>]*checked/);
    expect(html).toContain(`data-property-details="${pointer}"`);
  });

  it('preserves nullable unions in local and effective property type displays', () => {
    const pointer = '/definitions/Place/properties/latitude';
    const localHtml = designView('Place', 'object', undefined, [{
      name: 'latitude', pointer, type: 'double or null', required: false, schema: { type: ['double', 'null'] },
    }], pointer, [], [], 'local', undefined, undefined, [], undefined, new Set(), false, false, undefined, false, { pointer, field: 'type' });
    expect(localHtml).toContain('data-inline-type-replace="type:double"');
    expect(localHtml).not.toContain('data-inline-type-remove="type:double"');
    expect(localHtml).toContain('data-inline-property="nullable"');
    expect(localHtml).toContain('checked> nullable');
    expect(localHtml).not.toContain('data-inline-type-remove="type:null"');
    expect(localHtml).not.toContain('<span class="js-type-member"><span>null</span>');

    const document = {
      definitions: {
        Place: { type: 'object', properties: { latitude: { type: ['double', 'null'] } } }
      }
    };
    const effective = resolveEffectiveMembers(document, '#/definitions/Place');
    const effectiveHtml = designView('Place', 'object', undefined, [], pointer, [], [], 'effective', effective);
    expect(effectiveHtml).toContain('>double</div>');
    expect(effectiveHtml).toContain('<div class="js-cell js-nullable-indicator" role="cell">yes</div>');
  });

  it('shows removable members only when a union has more than one non-null type', () => {
    const pointer = '/definitions/Example/properties/value';
    const html = designView('Example', 'object', undefined, [{
      name: 'value', pointer, type: 'string or uint8', required: false,
      schema: { type: ['string', 'uint8'] },
    }], pointer, [], [], 'local', undefined, undefined, [], undefined, new Set(), false, false, undefined, false, { pointer, field: 'type' });
    expect(html).toContain('data-inline-type-remove="type:string"');
    expect(html).toContain('data-inline-type-remove="type:uint8"');
    expect(html).toContain('data-inline-type-replace="type:string"');
    expect(html).toContain('data-inline-type-replace="type:uint8"');
  });

  it('reserves visible space for union remove buttons beside type selectors', () => {
    expect(editorStyles).toContain('.js-inline-property-row .js-type-member-select { width:auto;');
    expect(editorStyles).toContain('grid-template-columns:minmax(0,1fr) auto;');
    expect(editorStyles).toContain('field-sizing:content;');
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
    expect(html).toContain('id="property-details--2Fdefinitions-2FPerson-2Fproperties-2Fname-constraints">Validation constraints</strong><span>1</span>');
    expect(html).toContain('id="property-details--2Fdefinitions-2FPerson-2Fproperties-2Fname-annotations">Annotations</strong><span>1</span>');
    expect(html).not.toContain('No annotations');
    expect(html).toContain('data-property-detail-add');
    expect(html).toContain('data-inline-keyword-remove');
    expect(html).not.toContain('Advanced property schema');
    expect(html).not.toContain('Apply schema JSON');
    expect(html.indexOf('class="js-property-details"')).toBeLessThan(html.indexOf('</div></div><section class="js-design-section">'));
  });

  it('renders newly selected constraints and catalog-backed concept annotations as inline drafts', () => {
    const pointer = '/definitions/Reading/properties/value';
    const pending = new Set([
      `${pointer}\u0000validation.maximum`,
      `${pointer}\u0000semantic.concepts`,
    ]);
    const html = designView('Reading', 'object', undefined, [{
      name: 'value', pointer, type: 'double', required: false, schema: { type: 'double' },
    }], pointer, [], [], 'local', undefined, pointer, [], {}, pending);
    expect(html).toContain('data-inline-field-action="validation.maximum"');
    expect(html).toContain('data-inline-keyword="maximum"');
    expect(html).toContain('data-inline-field-action="semantic.concepts"');
    expect(html).toContain('data-value-kind="json"');
    expect(html).toContain('data-inline-browse="concepts"');
    expect(html).toContain('data-catalog-value');
    expect(html).not.toContain('placeholder="Enter JSON"');
    expect(html).not.toContain('Edit this structured value from its dedicated editor.');
    expect(html).not.toContain('role="dialog"');
  });

  it('keeps add controls visible when the document still needs an extension capability', () => {
    const pointer = '/definitions/Reading/properties/value';
    const document = {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      definitions: { Reading: { type: 'object', properties: { value: { type: 'double' } } } },
    };
    const html = designView('Reading', 'object', undefined, [{
      name: 'value', pointer, type: 'double', required: false, schema: { type: 'double' },
    }], pointer, [], [], 'local', undefined, pointer, [], document);
    expect(html).toContain('Add constraint');
    expect(html).toContain('value="validation.minimum"');
    expect(html).toContain('Add annotation');
    expect(html).toContain('value="units.symbol"');
    expect(html).toContain('value="semantic.semanticRole"');
    expect(html.match(/data-property-detail-add/g)).toHaveLength(2);
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

  it('renders identity checkboxes, inline relation creation, and selectable relation summaries in Design', () => {
    const rows = [
      { name: 'barcode', pointer: '/definitions/Copy/properties/barcode', type: 'string', required: true, schema: { type: 'string' } },
      { name: 'shelfmark', pointer: '/definitions/Copy/properties/shelfmark', type: 'string', required: false, schema: { type: 'string' } },
    ];
    const html = designView('Copy', 'object', undefined, rows, '/definitions/Copy/relations/edition', ['barcode', 'shelfmark'], [{
      pointer: '/definitions/Copy/relations/edition', name: 'edition', targetTypeRef: '#/definitions/Edition', cardinality: 'single', scope: '#/definitions/Catalog/properties/editions',
    }], 'local', undefined, undefined, [{ name: 'Edition', pointer: '/definitions/Edition', identity: ['id'] }], {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
    }, new Set(), true);
    expect(html.match(/data-inline-property="identity"/g)).toHaveLength(2);
    expect(html).toMatch(/data-inline-property="identity"[^>]*checked/);
    expect(html).not.toContain('data-action-id="relation.identity"');
    expect(html).toContain('data-inline-relation-name');
    expect(html).toContain('data-inline-relation-target');
    expect(html).toContain('data-inline-relation-commit');
    expect(html).toContain('data-select="/definitions/Copy/relations/edition" aria-current="true"');
    expect(html).toContain('#/definitions/Edition');
    expect(html).toContain('single');
    expect(html).toContain('editions');
  });

  it('projects ordered identity state onto property-line checkboxes', () => {
    const source = JSON.stringify({ $schema: 'https://json-structure.org/meta/relations/v0/#', $uses: ['JSONStructureRelations'], definitions: { Person: { type: 'object', properties: { tenant: { type: 'string' }, id: { type: 'string' } }, identity: ['tenant', 'id'] } } });
    const snapshot = new DocumentSession('memory://ordered-identity', source).snapshot();
    expect(snapshot.model?.projections.definitions[0]?.identity).toEqual(['tenant', 'id']);
    const person = snapshot.model!.projections.definitions[0]!;
    const html = designView('Person', 'object', undefined, projectProperties(person), undefined, ['tenant', 'id'], [], 'local', undefined, undefined, [], JSON.parse(source));
    expect(html.match(/data-inline-property="identity"[^>]*checked/g)).toHaveLength(2);
  });

  it('exposes keyboard-operable graph zoom and fit controls', () => {
    const snapshot = new DocumentSession('memory://graph-controls', '{"definitions":{"A":{"type":"object"},"B":{"type":"object","$extends":"#/definitions/A"}}}').snapshot();
    const html = graphView(snapshot, undefined);
    expect(html).toContain('data-graph-zoom-out');
    expect(html).toContain('data-graph-zoom-in');
    expect(html).toContain('data-graph-fit');
    expect(html).toContain('data-graph-relayout');
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
    expect(html).toContain('data-instance-text');
    expect(html).toContain('data-instance-reset');
    expect(html).toContain('data-instance-clear');
    expect(html).not.toContain('{"age":128}');
    expect(html).toContain('value="/definitions/Person" selected');
    expect(html).toContain('class="js-trace js-trace-invalid"');
    expect(html).toContain('data-trace-instance="/age"');
    expect(html).toContain('data-trace-schema="/properties/age/type"');
    expect(html).toContain('data-instance-diagnostic="0"');
  });

  it('renders provider navigation, exact application preview, provenance, workspace affordance, and open custom references', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_QUDT_QUANTITY_KIND_PROVIDER);
    const request = registry.createRequest('ui-catalog', 1, 'semanticConcept', 'length');
    const result = registry.merge(request, [bundledCatalogResult(request, BUNDLED_QUDT_QUANTITY_KIND_PROVIDER.id)]);
    const emittedJson = JSON.stringify([result.suggestions[0]!.value]);
    const html = catalogBrowserView([BUNDLED_QUDT_QUANTITY_KIND_PROVIDER], result, 'semanticConcept', 'length', 'all', {
      suggestionIndex: 0, emittedJson, duplicate: false
    });
    expect(html).toContain('data-catalog-provider="bundled.qudt-quantity-kinds"');
    expect(html).toContain('data-catalog-suggestion="0"');
    expect(html).toContain('Length');
    expect(html).toContain('Exact emitted JSON');
    expect(html).toContain('&quot;reference&quot;');
    expect(html).toContain('qudt-quantity-kind');
    expect(html).toContain('http://qudt.org/vocab/quantitykind/');
    expect(html).toContain('prototype-seed-2026-08-31');
    expect(html).toContain('Bundled offline');
    expect(html).toContain('data-trusted="false"');
    expect(html).toContain('data-catalog-custom-reference');
    expect(html).toContain('data-catalog-custom-apply');
    expect(html).toContain('data-catalog-workspace');
    expect(html).toContain('data-catalog-apply');
    expect(html).toContain('data-catalog-close aria-label="Close catalog"');
  });

  it('does not render arbitrary custom-value controls for closed semantic preset families', () => {
    const registry = new CatalogRegistry();
    registry.register(BUNDLED_SEMANTIC_PROVIDER);
    const request = registry.createRequest('closed-catalog', 1, 'semanticRole', 'observation');
    const result = registry.merge(request, [bundledCatalogResult(request, BUNDLED_SEMANTIC_PROVIDER.id)]);
    const html = catalogBrowserView([BUNDLED_SEMANTIC_PROVIDER], result, 'semanticRole', 'observation');
    expect(html).toContain('data-catalog-closed');
    expect(html).not.toContain('data-catalog-custom-apply');
    expect(html).toContain('JSON Structure Semantic Presets');
  });
});