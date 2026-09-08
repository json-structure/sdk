import type { WindowCommand } from './contracts';

export interface WindowShortcutInput {
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

const zoomFactors = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export function windowCommandForShortcut(input: WindowShortcutInput, platform: NodeJS.Platform): WindowCommand | undefined {
  const key = input.key.toLowerCase();
  if (key === 'f11' && !input.control && !input.meta && !input.alt && !input.shift) return 'toggle-fullscreen';
  if (platform === 'darwin' && key === 'f' && input.control && input.meta && !input.alt && !input.shift) return 'toggle-fullscreen';

  const commandModifier = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  if (!commandModifier || input.alt) return undefined;
  if (key === '0' && !input.shift) return 'reset-zoom';
  if (key === '-' && !input.shift) return 'zoom-out';
  if (key === '=' || key === '+') return 'zoom-in';
  return undefined;
}

export function nextZoomFactor(current: number, direction: 'in' | 'out'): number {
  const epsilon = 0.001;
  if (direction === 'in') return zoomFactors.find((factor) => factor > current + epsilon) ?? zoomFactors[zoomFactors.length - 1];
  return [...zoomFactors].reverse().find((factor) => factor < current - epsilon) ?? zoomFactors[0];
}
