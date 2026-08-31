import { describe, expect, it } from 'vitest';
import { DocumentSession } from '../src/session.js';
import { analysisView, projectGraph } from '../src/ui/index.js';
import { planMoveDefinition } from '../src/phase4/refactoring.js';

describe('analysis workbench view', () => {
  it('shows tuple ordering, conflict provenance, unknown uses, and directional impact', () => {
    const text = JSON.stringify({
      $uses: ['UnknownExtension'],
      definitions: {
        Base: { type: 'tuple', properties: { value: { type: 'string' } }, tuple: ['value'] },
        Derived: { type: 'tuple', $extends: '#/definitions/Base', properties: { value: { type: 'number' }, extra: { type: 'boolean' } }, tuple: ['extra'] }
      }
    });
    const snapshot = new DocumentSession('memory://analysis.struct.json', text).snapshot();
    const html = analysisView(snapshot, '/definitions/Derived', projectGraph(snapshot), 'incoming');

    expect(html).toContain('Tuple order:');
    expect(html).toContain('value, extra');
    expect(html).toContain('local-redefinition');
    expect(html).toContain('/definitions/Derived/properties/value wins over /definitions/Base/properties/value');
    expect(html).toContain('Unknown $uses: UnknownExtension');
    expect(html).toContain('incoming reachable declarations');
    expect(html).toContain('data-impact-direction="incoming" aria-pressed="true"');
    expect(html).toContain('data-refactor-preview');
  });

  it('renders refactoring impact, provenance, and apply action', () => {
    const text = JSON.stringify({ definitions: { A: { type: 'string' }, Target: {} }, type: { $ref: '#/definitions/A' } });
    const snapshot = new DocumentSession('memory://refactor.struct.json', text).snapshot();
    const plan = planMoveDefinition(JSON.parse(text), { sourcePointer: '/definitions/A', targetNamespacePointer: '/definitions/Target' });
    const html = analysisView(snapshot, '/definitions/A', projectGraph(snapshot), 'both', plan, 'Preview ready.');

    expect(html).toContain('Refactoring preview');
    expect(html).toContain('rewrite-reference');
    expect(html).toContain('data-refactor-apply');
  });

  it('renders offered add-ins and includes selected add-in members', () => {
    const text = JSON.stringify({
      $offers: { Audited: '#/definitions/Audited' },
      definitions: {
        Document: { type: 'object', properties: { title: { type: 'string' } } },
        Audited: { abstract: true, type: 'object', $extends: '#/definitions/Document', properties: { createdBy: { type: 'string' } } }
      }
    });
    const snapshot = new DocumentSession('memory://addins.struct.json', text).snapshot();
    const html = analysisView(snapshot, '/definitions/Document', projectGraph(snapshot), 'both', undefined, '', ['Audited']);

    expect(html).toContain('Offered add-ins');
    expect(html).toContain('data-addin value="Audited" checked');
    expect(html).toContain('createdBy');
    expect(html).toContain('add-in | Audited');
  });
});