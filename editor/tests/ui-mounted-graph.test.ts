// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;

function mountGraph(): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  handle = mountJsonStructureEditor(container, {
    text: JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      $root: '#/definitions/Source',
      definitions: {
        Source: {
          type: 'object',
          properties: { id: { type: 'string' } },
          identity: ['id'],
          relations: {
            normal: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single' },
            parallel: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'multiple' },
            self: { targettype: { $ref: '#/definitions/Source' }, cardinality: 'single' },
          },
        },
        Target: {
          type: 'object',
          properties: { id: { type: 'string' } },
          identity: ['id'],
          relations: {
            reciprocal: { targettype: { $ref: '#/definitions/Source' }, cardinality: 'single' },
          },
        },
        Context: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
      },
    }),
  });
  (container.querySelector('[data-mode="graph"]') as HTMLButtonElement).click();
  const namespace = container.querySelector('[data-graph-node="graph:namespace:Definitions"]') as SVGElement;
  namespace.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const source = container.querySelector('[data-graph-node="/definitions/Source"]') as SVGElement;
  source.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return container;
}

function pointer(type: string, x: number, y: number, pointerId = 1): Event {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
  });
  return event;
}

async function dragNode(root: HTMLElement, nodeId: string, deltaX: number, deltaY: number): Promise<void> {
  const canvas = root.querySelector('[data-graph-canvas]') as SVGElement;
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 620, width: 900, height: 620, toJSON: () => ({}) }),
  });
  const node = root.querySelector(`[data-graph-node="${nodeId}"]`) as SVGElement & {
    setPointerCapture(pointerId: number): void;
    hasPointerCapture(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
  };
  let captured: number | undefined;
  node.setPointerCapture = (pointerId: number) => { captured = pointerId; };
  node.hasPointerCapture = (pointerId: number) => captured === pointerId;
  node.releasePointerCapture = () => { captured = undefined; };
  node.dispatchEvent(pointer('pointerdown', 300, 250));
  node.dispatchEvent(pointer('pointermove', 300 + deltaX, 250 + deltaY));
  node.dispatchEvent(pointer('pointerup', 300 + deltaX, 250 + deltaY));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function edgeByLabel(root: HTMLElement, label: string): SVGElement {
  const edge = [...root.querySelectorAll('[data-graph-edge]') as unknown as SVGElement[]]
    .find((candidate) => candidate.querySelector('.js-edge-label')?.textContent?.startsWith(label));
  if (!edge) throw new Error(`Missing mounted graph edge ${label}`);
  return edge;
}

function pathData(edge: SVGElement, selector: string): string {
  const value = edge.querySelector(selector)?.getAttribute('d');
  if (!value) throw new Error(`Missing ${selector} path data`);
  return value;
}

function endpoint(path: string): { readonly x: number; readonly y: number } {
  const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return { x: numbers.at(-2)!, y: numbers.at(-1)! };
}

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  document.body.innerHTML = '';
});

describe('mounted graph drag geometry', () => {
  it('keeps visible, hit, arrow, loop, reciprocal, parallel, and label-lane geometry synchronized', async () => {
    const root = mountGraph();
    expect(root.querySelector('[data-graph-reveal]')).not.toBeNull();
    expect(root.querySelector('[data-graph-fit-all]')).not.toBeNull();
    expect(root.querySelector('[data-graph-reset-view]')).not.toBeNull();
    expect(root.querySelector('[data-graph-hop="1"]')).not.toBeNull();
    expect(root.querySelector('[data-graph-hop="2"]')).not.toBeNull();
    expect(root.querySelector('[data-graph-isolate]')).not.toBeNull();
    expect(root.querySelector('[data-graph-layer="everything"]')).not.toBeNull();
    expect(root.querySelector('[data-graph-matrix-sort="source"]')).not.toBeNull();
    expect(root.querySelectorAll('.js-relation-matrix-scroll>[role="row"][data-graph-edge-select]')).toHaveLength(4);
    expect(root.querySelectorAll('[data-minimap-node]')).toHaveLength(4);
    (root.querySelector('[data-graph-isolate]') as HTMLButtonElement).click();
    expect(root.querySelectorAll('[data-graph-node]')).toHaveLength(2);
    expect(root.querySelectorAll('[data-minimap-node]')).toHaveLength(4);
    (root.querySelector('[data-graph-isolate]') as HTMLButtonElement).click();
    const normalMatrixRow = [...root.querySelectorAll('[data-graph-edge-select]') as unknown as HTMLElement[]].find((candidate) => candidate.matches('.js-relation-matrix-scroll>[role="row"]') && candidate.textContent?.includes('normal'));
    normalMatrixRow?.click();
    expect(edgeByLabel(root, 'normal').getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('.js-graph-semantics')?.textContent).toContain('single');
    const labels = ['normal', 'parallel', 'self', 'reciprocal'];
    const before = new Map(labels.map((label) => {
      const edge = edgeByLabel(root, label);
      return [label, {
        visible: pathData(edge, '.js-edge'),
        hit: pathData(edge, '.js-edge-hit-target'),
        lane: edge.getAttribute('data-graph-label-lane'),
        labelY: edge.querySelector('.js-edge-label')?.getAttribute('y'),
      }];
    }));
    expect(before.get('parallel')?.lane).not.toBe(before.get('normal')?.lane);
    expect(before.get('self')?.visible).toContain(' C');

    await dragNode(root, '/definitions/Target', 180, -95);

    for (const label of labels) {
      const edge = edgeByLabel(root, label);
      const visible = pathData(edge, '.js-edge');
      const hit = pathData(edge, '.js-edge-hit-target');
      expect(visible, `${label} visible path follows its hit target`).toBe(hit);
      expect(edge.querySelector('.js-edge')?.getAttribute('marker-end'), `${label} retains its arrowhead`).toBe('url(#js-arrow)');
      expect(edge.getAttribute('data-graph-label-lane'), `${label} retains its collision lane`).toBe(before.get(label)?.lane);
      if (label !== 'self') {
        expect(visible, `${label} no longer exposes the old clickable geometry`).not.toBe(before.get(label)?.hit);
        expect(edge.querySelector('.js-edge-label')?.getAttribute('y'), `${label} label follows the lane`).not.toBe(before.get(label)?.labelY);
      }
    }

    const target = root.querySelector('[data-graph-node="/definitions/Target"]') as SVGElement;
    const transform = target.getAttribute('transform')!;
    const [nodeX, nodeY] = [...transform.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    for (const label of ['normal', 'parallel']) {
      const arrow = endpoint(pathData(edgeByLabel(root, label), '.js-edge'));
      const onTargetBoundary = arrow.x >= nodeX! - 0.01 && arrow.x <= nodeX! + 150.01
        && arrow.y >= nodeY! - 0.01 && arrow.y <= nodeY! + 50.01
        && (Math.abs(arrow.x - nodeX!) < 0.02 || Math.abs(arrow.x - (nodeX! + 150)) < 0.02 || Math.abs(arrow.y - nodeY!) < 0.02 || Math.abs(arrow.y - (nodeY! + 50)) < 0.02);
      expect(onTargetBoundary, `${label} arrow endpoint is on the dragged target`).toBe(true);
    }

    const canvas = root.querySelector('[data-graph-canvas]') as SVGElement;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 620, width: 900, height: 620, toJSON: () => ({}) }),
    });
    const wheel = new window.Event('wheel', { bubbles: true, cancelable: true });
    Object.defineProperties(wheel, { deltaY: { value: 90 }, clientX: { value: 450 }, clientY: { value: 310 } });
    canvas.dispatchEvent(wheel);
    const cameraBeforeHistory = root.querySelector('[data-graph-world]')?.getAttribute('transform');
    const targetBeforeHistory = root.querySelector('[data-graph-node="/definitions/Target"]')?.getAttribute('transform');
    (root.querySelector('[data-graph-back]') as HTMLButtonElement).click();
    (root.querySelector('[data-graph-forward]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-graph-world]')?.getAttribute('transform')).toBe(cameraBeforeHistory);
    expect(root.querySelector('[data-graph-node="/definitions/Target"]')?.getAttribute('transform')).toBe(targetBeforeHistory);
  });
});
