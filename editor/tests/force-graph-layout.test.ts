import { describe, expect, it } from 'vitest';
import { ForceGraphLayout, graphEdgePath } from '../src/ui/force-graph-layout.js';
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
    const secondPositions = second.reconcile(nodes, edges);

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

  it('updates connected edge geometry and renders self-references as loops', () => {
    const from = { id: 'a', x: 100, y: 120, width: 150, height: 50, pinned: false };
    const before = graphEdgePath(from, { id: 'b', x: 400, y: 210, width: 150, height: 50, pinned: false });
    const after = graphEdgePath(from, { id: 'b', x: 520, y: 90, width: 150, height: 50, pinned: true });
    expect(after.path).not.toBe(before.path);
    expect(graphEdgePath(from, from).path).toContain(' C');
  });

  it('centers the focus type in prototype neighborhood layouts', () => {
    const layout = new ForceGraphLayout();
    const positions = layout.reconcile(nodes, edges, `neighborhood:${nodes[0]!.id}`);
    const focus = positions.find((position) => position.id === nodes[0]!.id)!;
    const bounds = layout.contentBounds();
    expect(focus.x + focus.width / 2).toBeCloseTo(bounds.width / 2);
    expect(focus.y + focus.height / 2).toBeCloseTo(bounds.height / 2);
    layout.dispose();
  });
});
