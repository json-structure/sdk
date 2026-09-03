import { describe, expect, it } from 'vitest';
import { SemanticGraphController } from '../src/ui/semantic-graph.js';
import { nodeId } from '../src/model.js';
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
    expect(atlas.projection.edges).toEqual([
      expect.objectContaining({ from: 'graph:namespace:Domain', to: 'graph:namespace:Common', label: '1 link', selectable: true, memberEdgeIds: ['reference-a-c'] }),
    ]);

    const imports = controller.setLens('imports');
    expect(imports.projection.edges).toHaveLength(1);
    expect(imports.projection.edges[0]).toMatchObject({ from: 'graph:namespace:Common', to: 'graph:namespace:Remote', label: '1 link' });
  });

  it('supports two-hop and isolated neighborhoods without losing global context by default', () => {
    const controller = new SemanticGraphController();
    const source = projection();
    controller.setSource({
      nodes: source.nodes,
      edges: [
        ...source.edges,
        { id: 'relation-b-c', from: '/definitions/Domain/B', to: '/definitions/Common/C', pointer: '/definitions/Domain/B/relations/c', label: 'c', kind: 'relation' },
        { id: 'relation-c-d', from: '/definitions/Common/C', to: '/definitions/Remote/D', pointer: '/definitions/Common/C/relations/d', label: 'd', kind: 'relation' },
      ],
    });
    controller.openNode('graph:namespace:Domain');
    controller.openNode('/definitions/Domain/A');
    expect(controller.view().projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.label)).toEqual(['A', 'B']);
    const twoHop = controller.setNeighborhoodHops(2);
    expect(twoHop.projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.label)).toEqual(['A', 'B', 'C']);
    const isolated = controller.setNeighborhoodIsolation(true);
    expect(isolated.projection.nodes.map((node) => node.label)).toEqual(['A', 'B', 'C']);
    expect(isolated.projection.edges.every((edge) => !edge.contextDimmed)).toBe(true);
    expect(controller.back().location.isolate).toBeUndefined();
  });

  it('sorts the full authored relation matrix independently of spatial bundles', () => {
    const controller = new SemanticGraphController();
    const source = projection();
    controller.setSource({
      nodes: source.nodes,
      edges: [
        ...source.edges,
        { id: 'relation-c-a', from: '/definitions/Common/C', to: '/definitions/Domain/A', pointer: '/definitions/Common/C/relations/alpha', label: 'alpha', kind: 'relation', relationName: 'alpha', cardinality: 'multiple' },
      ],
    });
    expect(controller.view().relationMatrix.map((edge) => edge.id)).toEqual(['relation-c-a', 'relation-a-b']);
    expect(controller.sortRelationMatrix('relation').relationMatrix.map((edge) => edge.id)).toEqual(['relation-c-a', 'relation-a-b']);
    const descending = controller.sortRelationMatrix('relation');
    expect(descending.relationMatrix.map((edge) => edge.id)).toEqual(['relation-a-b', 'relation-c-a']);
    expect(descending.relationMatrixAscending).toBe(false);
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
    expect(neighborhood.projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.label)).toEqual(['A', 'B']);
    expect(neighborhood.projection.nodes.filter((node) => node.contextDimmed).map((node) => node.label)).toEqual(['C', 'D']);
    expect(neighborhood.breadcrumbs.map((crumb) => crumb.label)).toEqual(['Atlas', 'Domain', 'A']);
    expect(controller.back().location.level).toBe('types');
    expect(controller.forward().location.level).toBe('neighborhood');
    expect(controller.home().location.level).toBe('atlas');
  });

  it('reveals a type in its namespace topology without entering its relation neighborhood', () => {
    const controller = new SemanticGraphController();
    controller.setSource(projection());

    const revealed = controller.revealNode('/definitions/Domain/A');
    expect(revealed.location).toEqual({ level: 'types', lens: 'relations', namespace: 'Domain' });
    expect(revealed.selection).toMatchObject({ kind: 'type', nodeId: '/definitions/Domain/A', pointer: '/definitions/Domain/A' });
    expect(revealed.projection.nodes.map((node) => node.label)).toEqual(['A', 'B']);

    controller.openNode('/definitions/Domain/A');
    const moved = controller.revealNode('/definitions/Common/C');
    expect(moved.location).toEqual({ level: 'types', lens: 'relations', namespace: 'Common' });
    expect(moved.selection?.nodeId).toBe('/definitions/Common/C');
    expect(moved.projection.nodes.map((node) => node.label)).toEqual(['C']);
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

  it('bundles parallel type-overview relations and fans out authored edges in a global-context neighborhood', () => {
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
    const types = controller.openNode('graph:namespace:Domain');
    const bundle = types.projection.edges.find((edge) => edge.memberEdgeIds?.length === 2);
    expect(bundle).toMatchObject({ label: '2 relations', selectable: true });
    const selected = controller.selectEdge(bundle!.id);
    expect(selected.selection).toMatchObject({ kind: 'relation', nodeId: bundle!.id });
    expect(selected.selection?.pointer).toBeUndefined();
    expect(selected.selectedEdges?.map((edge) => edge.id)).toEqual(['relation-a-b', 'relation-a-b-2']);

    const neighborhood = controller.openNode('/definitions/Domain/A');
    expect(neighborhood.projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.label)).toEqual(['A', 'B']);
    expect(neighborhood.projection.nodes.filter((node) => node.contextDimmed).map((node) => node.label)).toEqual(['C', 'D']);
    expect(neighborhood.projection.edges.filter((edge) => !edge.contextDimmed).map((edge) => edge.id)).toEqual(['relation-a-b', 'relation-a-b-2']);
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
  it('supports outgoing, incoming, and both relation neighborhoods including qualifier links', () => {
    const controller = new SemanticGraphController();
    const source = projection();
    controller.setSource({
      nodes: source.nodes,
      edges: [
        ...source.edges,
        { id: 'qualifier-a-c', from: '/definitions/Domain/A', to: '/definitions/Common/C', pointer: '/definitions/Domain/A/relations/related', targetPointer: '/definitions/Common/C', label: 'related qualifier', kind: 'relation-qualifier' },
        { id: 'relation-c-a', from: '/definitions/Common/C', to: '/definitions/Domain/A', pointer: '/definitions/Common/C/relations/a', label: 'incoming', kind: 'relation' },
      ],
    });
    controller.openNode('graph:namespace:Domain');
    controller.openNode('/definitions/Domain/A');
    expect(controller.view().projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.id)).toEqual(['/definitions/Domain/A', '/definitions/Domain/B', '/definitions/Common/C']);
    expect(controller.setRelationDirection('incoming').projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.id)).toEqual(['/definitions/Domain/A', '/definitions/Common/C']);
    expect(controller.setDirection('both').projection.nodes.filter((node) => !node.contextDimmed).map((node) => node.id)).toEqual(['/definitions/Domain/A', '/definitions/Domain/B', '/definitions/Common/C']);
    expect(controller.view().projection.edges.some((edge) => edge.kind === 'relation-qualifier')).toBe(true);
    const events: string[] = [];
    const unsubscribe = controller.on((event) => events.push(`${event.type}:${event.origin}`));
    controller.selectEdge('qualifier-a-c');
    expect(controller.view().selection).toMatchObject({ kind: 'relation', nodeId: 'qualifier-a-c', pointer: '/definitions/Domain/A/relations/related' });
    expect(controller.view().projection.edges.some((edge) => edge.id === 'qualifier-a-c')).toBe(true);
    expect(controller.view().selectedEdge?.id).toBe('qualifier-a-c');
    expect(events).toContain('selection-changed:graph');
    unsubscribe();
  });

  it('keeps reciprocal relation identities directional and preserves exact bundle selection', () => {
    const controller = new SemanticGraphController();
    const source: GraphProjection = {
      nodes: [
        { id: '/definitions/Domain/A', pointer: '/definitions/Domain/A', label: 'A', namespace: 'Domain', kind: 'type', selectable: true },
        { id: '/definitions/Domain/B', pointer: '/definitions/Domain/B', label: 'B', namespace: 'Domain', kind: 'type', selectable: true },
      ],
      edges: [
        { id: 'a-b-1', from: '/definitions/Domain/A', to: '/definitions/Domain/B', pointer: '/definitions/Domain/A/relations/one', label: 'one', kind: 'relation' },
        { id: 'a-b-2', from: '/definitions/Domain/A', to: '/definitions/Domain/B', pointer: '/definitions/Domain/A/relations/two', label: 'two', kind: 'relation' },
        { id: 'b-a-1', from: '/definitions/Domain/B', to: '/definitions/Domain/A', pointer: '/definitions/Domain/B/relations/one', label: 'one back', kind: 'relation' },
        { id: 'b-a-2', from: '/definitions/Domain/B', to: '/definitions/Domain/A', pointer: '/definitions/Domain/B/relations/two', label: 'two back', kind: 'relation' },
      ],
    };
    controller.setSource(source);
    const types = controller.openNode('graph:namespace:Domain');
    const bundles = types.projection.edges.filter((edge) => edge.memberEdgeIds?.length === 2);
    const outgoing = bundles.find((edge) => edge.from === '/definitions/Domain/A' && edge.to === '/definitions/Domain/B');
    const incoming = bundles.find((edge) => edge.from === '/definitions/Domain/B' && edge.to === '/definitions/Domain/A');
    expect(bundles).toHaveLength(2);
    expect(new Set(bundles.map((edge) => edge.id)).size).toBe(2);
    expect(outgoing).toMatchObject({ memberEdgeIds: ['a-b-1', 'a-b-2'] });
    expect(incoming).toMatchObject({ memberEdgeIds: ['b-a-1', 'b-a-2'] });
    expect(outgoing?.id).toContain(encodeURIComponent('/definitions/Domain/A\u0000/definitions/Domain/B'));
    expect(incoming?.id).toContain(encodeURIComponent('/definitions/Domain/B\u0000/definitions/Domain/A'));

    const selectedBundle = controller.selectEdge(incoming!.id);
    expect(selectedBundle.selectedEdges?.map((edge) => edge.id)).toEqual(['b-a-1', 'b-a-2']);
    const selectedAuthored = controller.selectEdge('b-a-1');
    expect(selectedAuthored.selectedEdge?.id).toBe('b-a-1');
    expect(selectedAuthored.projection.edges.find((edge) => edge.from === '/definitions/Domain/B' && edge.to === '/definitions/Domain/A')?.id).toBe('b-a-1');

    controller.openNode('/definitions/Domain/A');
    const both = controller.setRelationDirection('both');
    const relationEdges = both.projection.edges.filter((edge) => edge.kind === 'relation');
    expect(new Set(relationEdges.map((edge) => edge.id)).size).toBe(relationEdges.length);
    expect(relationEdges.map((edge) => ({ from: edge.from, to: edge.to, id: edge.id }))).toEqual([
      { from: '/definitions/Domain/A', to: '/definitions/Domain/B', id: 'a-b-1' },
      { from: '/definitions/Domain/A', to: '/definitions/Domain/B', id: 'a-b-2' },
      { from: '/definitions/Domain/B', to: '/definitions/Domain/A', id: 'b-a-1' },
      { from: '/definitions/Domain/B', to: '/definitions/Domain/A', id: 'b-a-2' },
    ]);
  });
  it('preserves direction in history and accepts design-owned selection events', () => {
    const controller = new SemanticGraphController();
    controller.setSource(projection());
    controller.openNode('graph:namespace:Domain');
    controller.openNode('/definitions/Domain/A');
    controller.setRelationDirection('incoming');
    expect(controller.back().location.direction).toBeUndefined();
    expect(controller.forward().relationDirection).toBe('incoming');
    const events: string[] = [];
    controller.on((event) => events.push(`${event.type}:${event.origin}`));
    controller.setSelection({ kind: 'type', nodeId: nodeId('/definitions/Domain/B'), pointer: '/definitions/Domain/B' }, 'design');
    expect(events).toContain('selection-changed:design');
  });
  it('preserves document, namespace, and bundled relation identities across source refreshes', () => {
    const controller = new SemanticGraphController();
    const source = projection();
    controller.setSource(source);
    controller.setLens('namespaces');
    const namespace = controller.selectNode('graph:namespace:Domain');
    expect(namespace.selection).toMatchObject({ kind: 'namespace', nodeId: 'graph:namespace:Domain', pointer: '' });
    expect(controller.setSource(source).selection).toEqual(namespace.selection);

    controller.setLens('relations');
    controller.openNode('graph:namespace:Domain');
    const bundled = controller.setSource({ ...source, edges: [
      ...source.edges,
      { id: 'relation-a-b-2', from: '/definitions/Domain/A', to: '/definitions/Domain/B', pointer: '/definitions/Domain/A/relations/also-related', label: 'also related', kind: 'relation' },
    ] });
    const bundleId = bundled.projection.edges.find((edge) => edge.memberEdgeIds?.length === 2)?.id;
    expect(bundleId).toContain('graph:type-bundle:');
    const selected = controller.selectEdge(bundleId!);
    expect(controller.setSource({ ...source, edges: [
      ...source.edges,
      { id: 'relation-a-b-2', from: '/definitions/Domain/A', to: '/definitions/Domain/B', pointer: '/definitions/Domain/A/relations/also-related', label: 'also related', kind: 'relation' },
    ] }).selection).toEqual(selected.selection);
  });

  it('keeps the inline document identity while drilling into definitions topology', () => {
    const controller = new SemanticGraphController();
    controller.setSource({
      nodes: [
        { id: 'graph:document-root', pointer: '', label: 'Inline schema', namespace: 'document', kind: 'document', selectable: true },
        { id: '/definitions/Thing', pointer: '/definitions/Thing', label: 'Thing', namespace: 'root', kind: 'type', selectable: true },
      ],
      edges: [{ id: 'root-thing', from: 'graph:document-root', to: '/definitions/Thing', pointer: '/$root', label: '$root', kind: 'root' }],
    });

    const atlas = controller.view();
    expect(atlas.projection.nodes.map((node) => node.id)).toEqual(['graph:document-root', 'graph:namespace:Definitions']);
    const opened = controller.openNode('graph:document-root');
    expect(opened.location).toEqual({ level: 'types', lens: 'relations', namespace: 'Definitions' });
    expect(opened.selection).toMatchObject({ kind: 'document', nodeId: 'graph:document-root', pointer: '' });
    expect(opened.projection.nodes.map((node) => node.id)).toContain('/definitions/Thing');
    expect(opened.projection.nodes.map((node) => node.id)).not.toContain('graph:namespace:Document');
    expect(controller.openNode('graph:document-root').location).toEqual(opened.location);

    controller.setLens('namespaces');
    const namespaceAtlas = controller.home();
    expect(namespaceAtlas.projection.nodes.map((node) => node.id)).toEqual(['graph:document-root', 'graph:namespace:Definitions']);
    const namespaceTopology = controller.openNode('graph:document-root');
    expect(namespaceTopology.selection?.nodeId).toBe('graph:document-root');
    expect(namespaceTopology.projection.nodes.map((node) => node.id)).not.toContain('graph:namespace:Document');
  });
});
