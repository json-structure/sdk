import { describe, expect, it } from 'vitest';
import { SemanticGraphController } from '../src/ui/semantic-graph.js';
import type { GraphProjection } from '../src/ui/helpers.js';

function projection(): GraphProjection {
  return {
    nodes: [
      { id: '/definitions/Domain/A', pointer: '/definitions/Domain/A', label: 'A', namespace: 'Domain', kind: 'type', selectable: true },
      { id: '/definitions/Domain/B', pointer: '/definitions/Domain/B', label: 'B', namespace: 'Domain', kind: 'type', selectable: true },
      { id: '/definitions/Common/C', pointer: '/definitions/Common/C', label: 'C', namespace: 'Common', kind: 'type', selectable: true },
      { id: '/definitions/Remote/D', pointer: '/definitions/Remote/D', label: 'D', namespace: 'Remote', kind: 'type', selectable: false, provenance: 'importdefs' },
    ],
    edges: [
      { id: 'relation-a-b', from: '/definitions/Domain/A', to: '/definitions/Domain/B', pointer: '/definitions/Domain/A/relations/related', label: 'related', kind: 'relation' },
      { id: 'extends-b-a', from: '/definitions/Domain/B', to: '/definitions/Domain/A', pointer: '/definitions/Domain/B/$extends/0/$ref', label: 'extends', kind: 'inheritance' },
      { id: 'import-common-remote', from: '/definitions/Common/C', to: '/definitions/Remote/D', pointer: '/definitions/Remote/$importdefs', label: '$importdefs', kind: 'import', provenance: 'importdefs' },
      { id: 'reference-a-c', from: '/definitions/Domain/A', to: '/definitions/Common/C', pointer: '/definitions/Domain/A/properties/c/type/$ref', label: 'c', kind: 'reference' },
    ],
  };
}

describe('semantic graph controller', () => {
  it('aggregates namespaces in the atlas and filters by graph lens', () => {
    const controller = new SemanticGraphController();
    const atlas = controller.setSource(projection());
    expect(atlas.location).toMatchObject({ level: 'atlas', lens: 'relations' });
    expect(atlas.projection.nodes.map((node) => node.label)).toEqual(['Common', 'Domain', 'Remote']);
    expect(atlas.projection.edges).toEqual([]);

    const imports = controller.setLens('imports');
    expect(imports.projection.edges).toHaveLength(1);
    expect(imports.projection.edges[0]).toMatchObject({ from: 'graph:namespace:Common', to: 'graph:namespace:Remote', label: '1 link' });
  });

  it('drills from atlas to type topology and a one-hop neighborhood with semantic history', () => {
    const controller = new SemanticGraphController();
    controller.setSource(projection());
    const types = controller.openNode('graph:namespace:Domain');
    expect(types.location).toEqual({ level: 'types', lens: 'relations', namespace: 'Domain' });
    expect(types.projection.nodes.map((node) => node.label)).toEqual(['A', 'B']);
    expect(types.breadcrumbs.map((crumb) => crumb.label)).toEqual(['Atlas', 'Domain']);

    const neighborhood = controller.openNode('/definitions/Domain/A');
    expect(neighborhood.location).toEqual({ level: 'neighborhood', lens: 'relations', namespace: 'Domain', focusNodeId: '/definitions/Domain/A' });
    expect(neighborhood.projection.nodes.map((node) => node.label)).toEqual(['A', 'B']);
    expect(neighborhood.breadcrumbs.map((crumb) => crumb.label)).toEqual(['Atlas', 'Domain', 'A']);
    expect(controller.back().location.level).toBe('types');
    expect(controller.forward().location.level).toBe('neighborhood');
    expect(controller.home().location.level).toBe('atlas');
  });

  it('retains a normalized semantic namespace when source nodes use the raw root namespace', () => {
    const controller = new SemanticGraphController();
    controller.setSource({
      nodes: [
        { id: '/definitions/A', pointer: '/definitions/A', label: 'A', namespace: 'root', kind: 'type', selectable: true },
        { id: '/definitions/B', pointer: '/definitions/B', label: 'B', namespace: 'root', kind: 'type', selectable: true },
      ],
      edges: [{ id: 'a-b', from: '/definitions/A', to: '/definitions/B', pointer: '/definitions/A/relations/b', label: 'b', kind: 'relation' }],
    });
    controller.openNode('graph:namespace:Definitions');
    const neighborhood = controller.openNode('/definitions/A');
    expect(neighborhood.location.namespace).toBe('Definitions');
    expect(neighborhood.projection.nodes.map((node) => node.label)).toEqual(['A', 'B']);
  });

  it('selects relation edges with their authored relation pointer and searches the current level', () => {
    const controller = new SemanticGraphController();
    controller.setSource(projection());
    controller.openNode('graph:namespace:Domain');
    const selected = controller.selectEdge('relation-a-b');
    expect(selected.selection).toMatchObject({ kind: 'relation', nodeId: 'relation-a-b', pointer: '/definitions/Domain/A/relations/related' });
    expect(controller.setSource(projection()).selection).toMatchObject({ kind: 'relation', nodeId: 'relation-a-b', pointer: '/definitions/Domain/A/relations/related' });
    expect(controller.setSearch(' b ').searchMatches).toEqual(['/definitions/Domain/B']);
  });

  it('projects namespace containment independently of relation edges', () => {
    const controller = new SemanticGraphController();
    controller.setSource(projection());
    controller.setLens('namespaces');
    const domain = controller.openNode('graph:namespace:Domain');
    expect(domain.projection.nodes.map((node) => node.id)).toEqual(['graph:namespace:Domain', '/definitions/Domain/A', '/definitions/Domain/B']);
    expect(domain.projection.edges.every((edge) => edge.label === 'contains')).toBe(true);
  });

  it('builds relation neighborhoods from outgoing declarations and bundles common targets', () => {
    const controller = new SemanticGraphController();
    const source = projection();
    controller.setSource({
      nodes: source.nodes,
      edges: [
        ...source.edges,
        { id: 'relation-a-b-2', from: '/definitions/Domain/A', to: '/definitions/Domain/B', pointer: '/definitions/Domain/A/relations/also-related', label: 'also related', kind: 'relation' },
        { id: 'relation-c-a', from: '/definitions/Common/C', to: '/definitions/Domain/A', pointer: '/definitions/Common/C/relations/a', label: 'incoming', kind: 'relation' },
      ],
    });
    controller.openNode('graph:namespace:Domain');
    const neighborhood = controller.openNode('/definitions/Domain/A');
    expect(neighborhood.projection.nodes.map((node) => node.label)).toEqual(['A', 'B']);
    expect(neighborhood.projection.edges).toHaveLength(1);
    expect(neighborhood.projection.edges[0]?.label).toBe('2 relations');
  });

  it('keeps non-relation lenses out of the generic neighborhood flow', () => {
    const controller = new SemanticGraphController();
    controller.setSource(projection());
    controller.setLens('extends');
    const before = controller.view().location;
    controller.openNode('/definitions/Domain/B');
    expect(controller.view().location).toEqual(before);
    expect(controller.view().selection?.nodeId).toBe('/definitions/Domain/B');
  });
});
