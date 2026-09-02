import { describe, expect, it } from 'vitest';
import { fluentIcon, type FluentIconName } from '../src/ui/fluent-icons.js';
import { jsonStructureLogo } from '../src/ui/brand-logo.js';

describe('embedded Fluent UI icons', () => {
  it('renders the workbench icon set as decorative inline SVG', () => {
    const names: readonly FluentIconName[] = [
      'add', 'arrowLeft', 'arrowRight', 'arrowSwap', 'arrowSync', 'arrowUp',
      'checkmarkCircle', 'chevronRight', 'console', 'cube', 'dismiss', 'document',
      'documentData', 'errorCircle', 'fit', 'home', 'info', 'library', 'subtract', 'warning',
    ];
    for (const name of names) {
      const markup = fluentIcon(name);
      expect(markup).toMatch(/^<svg class="js-icon"/);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('focusable="false"');
      expect(markup).toContain('<path d="');
    }
  });

  it('embeds the JSON Structure product logo', () => {
    const markup = jsonStructureLogo();
    expect(markup).toContain('viewBox="0 0 1218 1138"');
    expect(markup).toContain('fill="#215F9A"');
    expect(markup).toContain('fill="#4E95D9"');
  });
});
