import { describe, expect, it } from 'vitest';
import { designView, graphView, mobileModeSelect } from '../src/ui/index.js';
import { DocumentSession } from '../src/session.js';

describe('workbench interaction markup', () => {
  it('keeps every representation and workflow reachable from the compact mode selector', () => {
    const html = mobileModeSelect('conversion');
    for (const mode of ['design', 'graph', 'source', 'analysis', 'instance', 'conversion', 'libraries']) expect(html).toContain(`value="${mode}"`);
    expect(html).toContain('value="conversion" selected');
  });

  it('preserves native button semantics inside property table cells', () => {
    const html = designView('Person', 'object', undefined, [{ name: 'id', pointer: '/definitions/Person/properties/id', type: 'uuid', required: true, schema: { type: 'uuid' } }], undefined);
    expect(html).not.toContain('<button class="js-cell js-code" role="cell"');
    expect(html).not.toContain('<button class="js-cell js-row-action" role="cell"');
    expect(html).toContain('<div class="js-cell" role="cell"><button class="js-property-link js-code"');
    expect(html).toContain('<div class="js-cell js-action-cell" role="cell"><button class="js-row-action"');
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
    const source = JSON.stringify({ $schema: 'https://json-structure.org/meta/relations/v0/#', definitions: { Person: { type: 'object', properties: { tenant: { type: 'string' }, id: { type: 'string' } }, identity: ['tenant', 'id'] } } });
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
  });
});