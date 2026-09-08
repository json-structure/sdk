import { describe, expect, it } from 'vitest';
import { nextZoomFactor, windowCommandForShortcut, type WindowShortcutInput } from '../src/electron/window-controls';

function shortcut(key: string, overrides: Partial<WindowShortcutInput> = {}): WindowShortcutInput {
  return { key, control: false, meta: false, alt: false, shift: false, ...overrides };
}

describe('Electron window controls', () => {
  it('maps standard Windows and Linux zoom shortcuts', () => {
    expect(windowCommandForShortcut(shortcut('0', { control: true }), 'win32')).toBe('reset-zoom');
    expect(windowCommandForShortcut(shortcut('=', { control: true }), 'win32')).toBe('zoom-in');
    expect(windowCommandForShortcut(shortcut('+', { control: true, shift: true }), 'linux')).toBe('zoom-in');
    expect(windowCommandForShortcut(shortcut('-', { control: true }), 'linux')).toBe('zoom-out');
  });

  it('maps standard fullscreen shortcuts in both directions', () => {
    expect(windowCommandForShortcut(shortcut('F11'), 'win32')).toBe('toggle-fullscreen');
    expect(windowCommandForShortcut(shortcut('f', { control: true, meta: true }), 'darwin')).toBe('toggle-fullscreen');
  });

  it('does not consume unrelated or modified shortcuts', () => {
    expect(windowCommandForShortcut(shortcut('0'), 'win32')).toBeUndefined();
    expect(windowCommandForShortcut(shortcut('-', { control: true, alt: true }), 'win32')).toBeUndefined();
    expect(windowCommandForShortcut(shortcut('f', { meta: true }), 'darwin')).toBeUndefined();
  });

  it('uses stable browser-style zoom levels around 100 percent', () => {
    expect(nextZoomFactor(1, 'in')).toBe(1.1);
    expect(nextZoomFactor(1.1, 'in')).toBe(1.25);
    expect(nextZoomFactor(1.25, 'out')).toBe(1.1);
    expect(nextZoomFactor(1, 'out')).toBe(0.9);
    expect(nextZoomFactor(3, 'in')).toBe(3);
    expect(nextZoomFactor(0.5, 'out')).toBe(0.5);
  });
});
