import { describe, expect, it } from 'vitest';
import type { NodeId } from '../src/contracts.js';
import { GraphNavigationController, semanticZoomForScale } from '../src/ui/graph-navigation.js';

describe('graph navigation controller', () => {
  it('keeps the world point under the pointer fixed while zooming', () => {
    const navigation = new GraphNavigationController({ camera: { x: 20, y: 30, zoom: 1 } });
    const pointer = { x: 220, y: 130 };
    const before = navigation.screenToWorld(pointer);
    navigation.wheelZoom(pointer, -240);
    expect(navigation.screenToWorld(pointer).x).toBeCloseTo(before.x);
    expect(navigation.screenToWorld(pointer).y).toBeCloseTo(before.y);
  });

  it('supports pan, fit, reveal, and semantic zoom thresholds deterministically', () => {
    const navigation = new GraphNavigationController({ viewport: { x: 0, y: 0, width: 500, height: 300 }, content: { x: 0, y: 0, width: 1000, height: 600 } });
    navigation.pan({ x: 10, y: -5 });
    expect(navigation.snapshot().camera).toEqual({ x: 10, y: -5, zoom: 1 });
    navigation.fit();
    expect(navigation.snapshot().camera.zoom).toBeCloseTo(0.3933, 3);
    navigation.reveal({ x: 400, y: 200, width: 100, height: 100 });
    const revealed = navigation.worldToScreen({ x: 400, y: 200, width: 100, height: 100 });
    expect(revealed.x).toBeGreaterThanOrEqual(48);
    expect(revealed.y).toBeGreaterThanOrEqual(48);
    expect(semanticZoomForScale(0.59)).toBe('overview');
    expect(semanticZoomForScale(1)).toBe('labels');
    expect(semanticZoomForScale(1.61)).toBe('detail');
  });

  it('maintains selection continuity and browser-like navigation history', () => {
    const navigation = new GraphNavigationController();
    const first = { kind: 'type' as const, nodeId: '/a' as NodeId, pointer: '/a' };
    const second = { kind: 'type' as const, nodeId: '/b' as NodeId, pointer: '/b' };
    navigation.navigate(first);
    navigation.navigate(second);
    expect(navigation.back().selection).toEqual(first);
    expect(navigation.forward().selection).toEqual(second);
    navigation.setSelection(first);
    expect(navigation.reconcileSelection([{ id: '/a', pointer: '/a' }]).selection).toEqual(first);
    expect(navigation.reconcileSelection([{ id: '/c', pointer: '/c' }]).selection).toBeUndefined();
  });

  it('sorts hit targets by shared precedence and then distance', () => {
    const navigation = new GraphNavigationController();
    const hits = navigation.sortHits([
      { kind: 'node', id: 'node' },
      { kind: 'label', id: 'far-label', distance: 3 },
      { kind: 'handle', id: 'handle' },
      { kind: 'label', id: 'near-label', distance: 1 }
    ]);
    expect(hits.map((hit) => hit.id)).toEqual(['handle', 'near-label', 'far-label', 'node']);
  });

  it('maps minimap clicks to a centered camera and exposes viewport data', () => {
    const navigation = new GraphNavigationController({ viewport: { x: 0, y: 0, width: 200, height: 100 }, content: { x: 0, y: 0, width: 1000, height: 500 } });
    const data = navigation.minimap([{ x: 100, y: 50, width: 20, height: 10 }]);
    expect(data.viewport).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(data.nodes).toHaveLength(1);
    navigation.navigateMinimap({ x: 500, y: 250 }, { x: 0, y: 0, width: 1000, height: 500 });
    expect(navigation.screenToWorld({ x: 100, y: 50 })).toEqual({ x: 500, y: 250 });
  });
});