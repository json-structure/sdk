import { describe, expect, it } from 'vitest';
import {
  GraphRuntime,
  type GraphEdgeInput,
  type GraphNodeInput,
  type GraphRuntimeInput
} from '../src/phase4/graph-runtime.js';

function fixture(): GraphRuntimeInput {
  return {
    rootId: 'root',
    nodes: [
      { id: 'gamma', namespace: 'zeta' },
      { id: 'root', namespace: 'alpha' },
      { id: 'beta', namespace: 'alpha' },
      { id: 'delta', namespace: 'zeta' },
      { id: 'alpha', namespace: 'alpha' }
    ],
    edges: [
      { id: 'e4', source: 'gamma', target: 'delta', label: 'uses' },
      { id: 'e2', source: 'alpha', target: 'beta', label: 'extends' },
      { id: 'e1', source: 'root', target: 'alpha', label: 'contains' },
      { id: 'e3', source: 'beta', target: 'gamma', label: 'imports' }
    ]
  };
}

function shuffled(input: GraphRuntimeInput): GraphRuntimeInput {
  return {
    ...input,
    nodes: [...input.nodes].reverse(),
    edges: [...input.edges].reverse()
  };
}

describe('phase 4 graph runtime', () => {
  it('lays out namespaces deterministically and pins the root at the origin', () => {
    const first = new GraphRuntime(fixture());
    const second = new GraphRuntime(shuffled(fixture()));

    expect(first.nodes()).toEqual(second.nodes());
    expect(first.edges()).toEqual(second.edges());
    expect(first.node('root')).toMatchObject({ position: { x: 0, y: 0 }, pinned: true });
    expect(first.node('alpha')!.position.x).toBeLessThan(first.node('delta')!.position.x);
    expect(first.nodes().filter((node) => node.id !== 'root').every((node) => node.position.x > 0)).toBe(true);
  });

  it('preserves unchanged positions across incremental updates while placing new nodes', () => {
    const initial = new GraphRuntime(fixture());
    const before = new Map(initial.nodes().map((node) => [node.id, node.position]));
    const updated = initial.update({
      ...fixture(),
      nodes: [...fixture().nodes.filter((node) => node.id !== 'delta'), { id: 'epsilon', namespace: 'zeta' }],
      edges: fixture().edges.filter((edge) => edge.target !== 'delta')
    });

    for (const id of ['root', 'alpha', 'beta', 'gamma']) {
      expect(updated.node(id)!.position).toEqual(before.get(id));
    }
    expect(updated.node('epsilon')).toBeDefined();
    expect(updated.node('delta')).toBeUndefined();
  });

  it('finds deterministic shortest paths and computes directed impact', () => {
    const runtime = new GraphRuntime(fixture());

    expect(runtime.findPath('root', 'delta')).toEqual(['root', 'alpha', 'beta', 'gamma', 'delta']);
    expect(runtime.findPath('delta', 'root')).toBeUndefined();
    expect(runtime.findPath('delta', 'root', { direction: 'both' })).toEqual(['delta', 'gamma', 'beta', 'alpha', 'root']);
    expect(runtime.findPath('root', 'gamma', { maxDepth: 2 })).toBeUndefined();
    expect(runtime.analyzeImpact(['alpha'])).toEqual([
      { id: 'beta', distance: 1 },
      { id: 'gamma', distance: 2 },
      { id: 'delta', distance: 3 }
    ]);
  });

  it('isolates bounded neighborhoods without leaking unrelated nodes', () => {
    const runtime = new GraphRuntime({
      nodes: [...fixture().nodes, { id: 'isolated', namespace: 'other' }],
      edges: fixture().edges,
      rootId: 'root'
    });

    expect(runtime.isolateNeighborhood(['beta'], { maxDepth: 1 }).map((node) => node.id))
      .toEqual(['beta', 'alpha', 'gamma']);
    expect(runtime.isolateNeighborhood(['missing'])).toEqual([]);
  });

  it('virtualizes by viewport, semantic level, padding, and a deterministic cap', () => {
    const runtime = new GraphRuntime({
      nodes: [
        { id: 'a', position: { x: 50, y: 50 } },
        { id: 'b', position: { x: 170, y: 50 } },
        { id: 'c', position: { x: 900, y: 900 } }
      ],
      edges: [
        { id: 'ab', source: 'a', target: 'b', label: 'near' },
        { id: 'bc', source: 'b', target: 'c', label: 'far' }
      ]
    });

    const detail = runtime.queryViewport(
      { x: 0, y: 0, width: 250, height: 120 },
      { semanticLevel: 'detail' }
    );
    expect(detail.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(detail.nodes.every((node) => node.showLabel && node.showDetails)).toBe(true);
    expect(detail.edges).toEqual([{ id: 'ab', source: 'a', target: 'b', label: 'near', showLabel: true }]);
    expect(detail).toMatchObject({ totalNodeCount: 3, totalEdgeCount: 2, truncated: false });

    const capped = runtime.queryViewport(
      { x: 0, y: 0, width: 250, height: 120 },
      { semanticLevel: 'overview', maxNodes: 1 }
    );
    expect(capped.nodes.map((node) => node.id)).toEqual(['a']);
    expect(capped.nodes[0]).toMatchObject({ showLabel: false, showDetails: false });
    expect(capped.edges).toEqual([]);
    expect(capped.truncated).toBe(true);
  });

  it('assigns stable collision lanes to overlapping edge labels', () => {
    const runtime = new GraphRuntime({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 } },
        { id: 'b', position: { x: 100, y: 0 } },
        { id: 'c', position: { x: 10, y: 0 } },
        { id: 'd', position: { x: 110, y: 0 } },
        { id: 'e', position: { x: 500, y: 0 } },
        { id: 'f', position: { x: 600, y: 0 } }
      ],
      edges: [
        { id: 'second', source: 'c', target: 'd', label: 'overlap' },
        { id: 'first', source: 'a', target: 'b', label: 'overlap' },
        { id: 'clear', source: 'e', target: 'f', label: 'clear' }
      ]
    });

    const lanes = runtime.assignEdgeLabelLanes();
    expect(lanes.map(({ edgeId, lane }) => ({ edgeId, lane }))).toEqual([
      { edgeId: 'clear', lane: 0 },
      { edgeId: 'first', lane: 0 },
      { edgeId: 'second', lane: 1 }
    ]);
    expect(runtime.assignEdgeLabelLanes()).toEqual(lanes);
  });

  it('keeps adjacent vertical label bands collision-free', () => {
    const runtime = new GraphRuntime({
      nodes: [
        { id: 'a', position: { x: 0, y: 15 } },
        { id: 'b', position: { x: 100, y: 15 } },
        { id: 'c', position: { x: 0, y: 16 } },
        { id: 'd', position: { x: 100, y: 16 } },
      ],
      edges: [
        { id: 'lower', source: 'a', target: 'b', label: 'overlap' },
        { id: 'upper', source: 'c', target: 'd', label: 'overlap' },
      ],
    });
    const lanes = runtime.assignEdgeLabelLanes();
    expect(lanes.map(({ edgeId, lane }) => ({ edgeId, lane }))).toEqual([
      { edgeId: 'lower', lane: 0 },
      { edgeId: 'upper', lane: 1 },
    ]);
  });
  it('validates malformed graphs and reports explicit performance budget violations', () => {
    expect(() => new GraphRuntime({ nodes: [{ id: 'a' }, { id: 'a' }], edges: [] })).toThrow(/unique/);
    expect(() => new GraphRuntime({ nodes: [{ id: 'a' }], edges: [{ id: 'bad', source: 'a', target: 'b' }] }))
      .toThrow(/missing endpoint/);
    const runtime = new GraphRuntime(fixture());
    expect(() => runtime.assignEdgeLabelLanes(7, 16, { operationBudget: 0 })).toThrow(/operation budget/);
    expect(runtime.evaluateBudget({ maxNodes: 4, maxEdges: 3 })).toEqual({
      withinBudget: false,
      violations: ['nodeCount', 'edgeCount']
    });
    expect(runtime.evaluateBudget({ maxNodes: 5, maxEdges: 4, maxEstimatedBytes: 10_000 })).toEqual({
      withinBudget: true,
      violations: []
    });
  });

  it('indexes and queries 2,000 nodes and 20,000 edges within a non-flaky budget', () => {
    const nodes: GraphNodeInput[] = Array.from({ length: 2_000 }, (_, index) => ({
      id: `node-${index.toString().padStart(4, '0')}`,
      namespace: `namespace-${index % 20}`
    }));
    const edges: GraphEdgeInput[] = Array.from({ length: 20_000 }, (_, index) => ({
      id: `edge-${index.toString().padStart(5, '0')}`,
      source: nodes[index % nodes.length].id,
      target: nodes[(index * 17 + 31) % nodes.length].id,
      label: `relation-${index % 8}`
    }));

    const runtime = new GraphRuntime({ nodes, edges, rootId: nodes[0].id });
    const metrics = runtime.metrics();
    expect(metrics).toMatchObject({ nodeCount: 2_000, edgeCount: 20_000 });
    expect(metrics.indexedCellCount).toBeGreaterThan(0);
    expect(runtime.evaluateBudget({
      maxNodes: 2_000,
      maxEdges: 20_000,
      maxBuildDurationMs: 5_000,
      maxEstimatedBytes: 10_000_000
    })).toEqual({ withinBudget: true, violations: [] });
    expect(runtime.queryViewport({ x: 0, y: 0, width: 1_000, height: 800 }, { maxNodes: 100 }).nodes.length)
      .toBeLessThanOrEqual(100);
    const laneStarted = Date.now();
    const lanes = runtime.assignEdgeLabelLanes(7, 16, { operationBudget: 50_000_000 });
    const laneElapsed = Date.now() - laneStarted;
    expect(lanes).toHaveLength(20_000);
    expect(runtime.labelLaneMetrics()).toMatchObject({ labelCount: 20_000, operationBudget: 50_000_000 });
    expect(runtime.labelLaneMetrics().operationCount).toBeLessThan(50_000_000);
    expect(laneElapsed).toBeLessThan(10_000);
  }, 30_000);
  it('retains relation provenance metadata while exposing deterministic neighbors by direction', () => {
    const runtime = new GraphRuntime({
      nodes: [{ id: 'source' }, { id: 'target' }, { id: 'qualifier' }, { id: 'incoming' }],
      edges: [
        { id: 'relation', source: 'source', target: 'target', kind: 'relation', cardinality: 'multiple', scope: ['#/definitions/Items'], semanticBinding: 'hasTarget', targetIdentity: { reference: '#/definitions/Target', status: 'resolved' }, relation: { name: 'target', target: { status: 'resolved', value: '/definitions/Target' }, cardinality: { status: 'resolved', value: 'multiple' }, scope: { status: 'resolved', value: ['/definitions/Items'] } } },
        { id: 'qualifier', source: 'source', target: 'qualifier', kind: 'relation-qualifier', status: 'external', documentUri: 'https://example.test/qualifier.json' },
        { id: 'back', source: 'incoming', target: 'source', kind: 'relation' },
      ],
    });
    expect(runtime.edge('relation')).toMatchObject({ cardinality: 'multiple', scope: ['#/definitions/Items'], semanticBinding: 'hasTarget', targetIdentity: { status: 'resolved' }, relation: { name: 'target' } });
    expect(runtime.neighbors('source', 'outgoing')).toEqual(['qualifier', 'target']);
    expect(runtime.neighbors('source', 'incoming')).toEqual(['incoming']);
    expect(runtime.neighbors('source', 'both')).toEqual(['incoming', 'qualifier', 'target']);
  });
});
