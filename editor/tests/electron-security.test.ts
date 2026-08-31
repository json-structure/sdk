import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deniedWindowOpen, isAllowedRendererNavigation, isTrustedIpcSender, selectDevelopmentUrl } from '../src/electron/security';

describe('Electron renderer security boundary', () => {
  it('ignores the development environment URL in packaged builds', () => {
    expect(selectDevelopmentUrl(true, 'http://127.0.0.1:5173/')).toBeUndefined();
  });

  it('accepts only the exact loopback development origin, port, and path', () => {
    expect(selectDevelopmentUrl(false, 'http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/');
    for (const url of [
      'http://example.test:5173/',
      'http://localhost:5173/',
      'http://user:password@127.0.0.1:5173/',
      'http://127.0.0.1:5174/',
      'http://127.0.0.1:5173/other',
      'http://127.0.0.1:5173/?redirect=https://example.test',
    ]) expect(selectDevelopmentUrl(false, url)).toBeUndefined();
  });

  it('allows only navigation to the exact recorded renderer URL', () => {
    const expected = 'file:///C:/app/dist/renderer/index.html';
    expect(isAllowedRendererNavigation(expected, expected)).toBe(true);
    expect(isAllowedRendererNavigation('https://example.test/', expected)).toBe(false);
    expect(isAllowedRendererNavigation(`${expected}#other`, expected)).toBe(false);
  });

  it('denies every renderer window-open request', () => {
    expect(deniedWindowOpen).toEqual({ action: 'deny' });
  });

  it('uses a restrictive renderer CSP without unsafe-eval', async () => {
    const html = await readFile(join(import.meta.dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).not.toContain('unsafe-eval');
  });

  it('rejects subframes, stale senders, different senders, and changed frame URLs', () => {
    const trusted = { senderId: 7, expectedSenderId: 7, senderDestroyed: false, isMainFrame: true, frameUrl: 'file:///app/index.html', expectedUrl: 'file:///app/index.html' };
    expect(isTrustedIpcSender(trusted)).toBe(true);
    expect(isTrustedIpcSender({ ...trusted, isMainFrame: false })).toBe(false);
    expect(isTrustedIpcSender({ ...trusted, senderDestroyed: true })).toBe(false);
    expect(isTrustedIpcSender({ ...trusted, senderId: 8 })).toBe(false);
    expect(isTrustedIpcSender({ ...trusted, frameUrl: 'https://example.test/' })).toBe(false);
  });
});