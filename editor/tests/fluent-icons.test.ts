import { describe, expect, it } from 'vitest';
import { fluentIcon, type FluentIconName } from '../src/ui/fluent-icons.js';

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
});
