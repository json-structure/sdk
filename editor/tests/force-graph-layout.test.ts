import { describe, expect, it } from 'vitest';
import { ForceGraphLayout, graphEdgeDistance, graphEdgePath, hitTestGraphEdge, hitTestGraphNodes } from '../src/ui/force-graph-layout.js';
import type { GraphEdge, GraphNode } from '../src/ui/helpers.js';

const nodes: GraphNode[] = [
  { id: '/definitions/A', pointer: '/definitions/A', label: 'A', namespace: 'root', kind: 'type' },
  { id: '/definitions/B', pointer: '/definitions/B', label: 'B', namespace: 'root', kind: 'type' },
  { id: '/definitions/C', pointer: '/definitions/C', label: 'C', namespace: 'root', kind: 'type' },
  { id: '/definitions/D', pointer: '/definitions/D', label: 'D', namespace: 'root', kind: 'type' },
];
const edges: GraphEdge[] = [
  { id: 'a-b', from: nodes[0]!.id, to: nodes[1]!.id, label: 'b', kind: 'reference' },
  { id: 'a-c', from: nodes[0]!.id, to: nodes[2]!.id, label: 'c', kind: 'reference' },
  { id: 'c-d', from: nodes[2]!.id, to: nodes[3]!.id, label: 'extends', kind: 'inheritance' },
];

describe('force graph layout', () => {
  it('settles deterministically without a rigid three-column lattice or node overlap', () => {
    const first = new ForceGraphLayout();
    const second = new ForceGraphLayout();
    const firstPositions = first.reconcile(nodes, edges);
    const secondPositions = second.reconcile([...nodes].reverse(), [...edges].reverse());

    expect(firstPositions).toEqual(secondPositions);
    expect(new Set(firstPositions.map((node) => Math.round(node.x))).size).toBeGreaterThan(2);
    for (let left = 0; left < firstPositions.length; left += 1) {
      for (let right = left + 1; right < firstPositions.length; right += 1) {
        const one = firstPositions[left]!;
        const two = firstPositions[right]!;
        const overlaps = one.x < two.x + two.width + 12 && one.x + one.width + 12 > two.x && one.y < two.y + two.height + 12 && one.y + one.height + 12 > two.y;
        expect(overlaps, `${one.id} overlaps ${two.id}`).toBe(false);
      }
    }
    first.dispose();
    second.dispose();
  });

  it('pins a dragged node, preserves it across reconciliation, and releases it for relayout', () => {
    const layout = new ForceGraphLayout();
    layout.reconcile(nodes, edges);
    layout.startDrag(nodes[0]!.id);
    layout.drag(nodes[0]!.id, { x: 120, y: 160 });
    layout.endDrag(nodes[0]!.id);

    expect(layout.position(nodes[0]!.id)).toMatchObject({ x: 120, y: 160, pinned: true });
    layout.reconcile(nodes, edges);
    expect(layout.position(nodes[0]!.id)).toMatchObject({ x: 120, y: 160, pinned: true });

    layout.relayout();
    layout.settle();
    expect(layout.position(nodes[0]!.id)?.pinned).toBe(false);
    layout.dispose();
  });

  it('moves only the dragged node and restores cached projection layouts exactly', () => {
    const layout = new ForceGraphLayout();
    const before = layout.reconcile(nodes, edges, { cacheKey: 'relations:types', mode: 'relations' });
    const unrelated = new Map(before.slice(1).map((position) => [position.id, { x: position.x, y: position.y }]));
    layout.startDrag(nodes[0]!.id);
    layout.drag(nodes[0]!.id, { x: 140, y: 180 });
    layout.endDrag(nodes[0]!.id);
    for (const [id, position] of unrelated) expect(layout.position(id)).toMatchObject(position);

    const firstProjection = layout.positions();
    layout.reconcile(nodes.slice(0, 3), edges.slice(0, 2), { cacheKey: 'relations:neighborhood:a', mode: 'neighborhood', focusNodeId: nodes[0]!.id });
    expect(layout.position(nodes[0]!.id)).toMatchObject({ x: 140, y: 180, pinned: true });
    expect(layout.reconcile(nodes, edges, { cacheKey: 'relations:types', mode: 'relations' })).toEqual(firstProjection);
    layout.dispose();
  });

  it('uses deterministic lens-specific orientation and real content bounds', () => {
    const relations = new ForceGraphLayout();
    const relationPositions = relations.reconcile(nodes, edges, { cacheKey: 'relations', mode: 'relations' });
    expect(relationPositions.find((node) => node.id === nodes[1]!.id)!.x).toBeGreaterThan(relationPositions.find((node) => node.id === nodes[0]!.id)!.x);
    const relationBounds = relations.contentBounds();
    expect(relationBounds.width).toBe(Math.ceil(Math.max(...relationPositions.map((node) => node.x + node.width)) + 40));
    expect(relationBounds.height).toBe(Math.ceil(Math.max(...relationPositions.map((node) => node.y + node.height)) + 40));

    const hierarchy = new ForceGraphLayout();
    const hierarchyPositions = hierarchy.reconcile(nodes, edges, { cacheKey: 'extends', mode: 'extends' });
    expect(hierarchyPositions.find((node) => node.id === nodes[3]!.id)!.y).toBeGreaterThan(hierarchyPositions.find((node) => node.id === nodes[2]!.id)!.y);

    const neighborhood = new ForceGraphLayout();
    const neighborhoodPositions = neighborhood.reconcile(nodes, edges, { cacheKey: 'neighborhood', mode: 'neighborhood', focusNodeId: nodes[0]!.id });
    const focus = neighborhoodPositions.find((node) => node.id === nodes[0]!.id)!;
    expect(neighborhoodPositions.find((node) => node.id === nodes[1]!.id)!.x).toBeGreaterThan(focus.x);
    relations.dispose();
    hierarchy.dispose();
    neighborhood.dispose();
  });

  it('updates connected edge geometry and renders self-references as loops', () => {
    const from = { id: 'a', x: 100, y: 120, width: 150, height: 50, pinned: false };
    const before = graphEdgePath(from, { id: 'b', x: 400, y: 210, width: 150, height: 50, pinned: false });
    const after = graphEdgePath(from, { id: 'b', x: 520, y: 90, width: 150, height: 50, pinned: true });
    expect(after.path).not.toBe(before.path);
    expect(graphEdgePath(from, from).path).toContain(' C');
  });

  it('uses the same force-directed auto-arrangement for graph subsets', () => {
    const layout = new ForceGraphLayout();
    const positions = layout.reconcile(nodes.slice(0, 3), edges.slice(0, 2));
    expect(new Set(positions.map((node) => Math.round(node.x))).size).toBeGreaterThan(2);
    expect(new Set(positions.map((node) => Math.round(node.y))).size).toBeGreaterThan(1);
    layout.dispose();
  });
  it('keeps a 40-node layout bounded and separated, with deterministic node and edge hit testing', () => {
    const manyNodes: GraphNode[] = Array.from({ length: 40 }, (_, index) => ({
      id: `/definitions/Node${index.toString().padStart(2, '0')}`,
      pointer: `/definitions/Node${index.toString().padStart(2, '0')}`,
      label: `Node ${index}`,
      namespace: 'root',
      kind: 'type'
    }));
    const manyEdges: GraphEdge[] = manyNodes.slice(1).map((node, index) => ({ id: `edge-${index}`, from: manyNodes[index]!.id, to: node.id, label: 'next', kind: 'reference' }));
    const layout = new ForceGraphLayout();
    const positions = layout.reconcile(manyNodes, manyEdges);
    const bounds = layout.contentBounds();
    expect(positions).toHaveLength(40);
    for (const position of positions) {
      expect(position.x).toBeGreaterThanOrEqual(40);
      expect(position.y).toBeGreaterThanOrEqual(40);
      expect(position.x + position.width).toBeLessThanOrEqual(bounds.width - 40);
      expect(position.y + position.height).toBeLessThanOrEqual(bounds.height - 40);
    }
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const one = positions[left]!;
        const two = positions[right]!;
        expect(one.x >= two.x + two.width + 12 || two.x >= one.x + one.width + 12 || one.y >= two.y + two.height + 12 || two.y >= one.y + one.height + 12).toBe(true);
      }
    }
    const target = positions.find((position) => position.id === manyNodes[17]!.id)!;
    expect(layout.hitTest({ x: target.x + target.width / 2, y: target.y + target.height / 2 })?.id).toBe(target.id);
    const nodeHits = hitTestGraphNodes(positions, { x: target.x + target.width / 2, y: target.y + target.height / 2 });
    expect(nodeHits[0]?.id).toBe(target.id);
    const edgePositions = new Map(positions.map((position) => [position.id, position]));
    const edge = manyEdges[17]!;
    const from = edgePositions.get(edge.from)!;
    const to = edgePositions.get(edge.to)!;
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    expect(graphEdgeDistance(midpoint, from, to)).toBeLessThan(100);
    expect(hitTestGraphEdge(midpoint, [edge], edgePositions, 100)?.id).toBe(edge.id);
    layout.dispose();
  });
  it('keeps large graph overlap work bounded and deterministic', () => {
    const largeNodes: GraphNode[] = Array.from({ length: 2_000 }, (_, index) => ({
      id: `/definitions/Large${index.toString().padStart(4, '0')}`,
      pointer: `/definitions/Large${index.toString().padStart(4, '0')}`,
      label: `Large ${index}`,
      namespace: 'root',
      kind: 'type'
    }));
    const first = new ForceGraphLayout();
    const second = new ForceGraphLayout();
    const firstPositions = first.reconcile(largeNodes, []);
    const secondPositions = second.reconcile([...largeNodes].reverse(), []);
    expect(firstPositions).toEqual(secondPositions);
    expect(firstPositions).toHaveLength(2_000);
    expect(firstPositions.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    expect(first.overlapStats()).toEqual(second.overlapStats());
    expect(first.overlapStats().passes).toBeLessThanOrEqual(8);
    expect(first.overlapStats().candidatePairs).toBeLessThan(2_000 * 80);
    first.dispose();
    second.dispose();
  }, 20_000);
});
