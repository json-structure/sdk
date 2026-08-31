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