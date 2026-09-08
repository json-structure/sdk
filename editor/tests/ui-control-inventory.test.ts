import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface InteractiveControl {
  readonly attribute: string;
  readonly occurrences: readonly {
    readonly tag: string;
    readonly opening: string;
    readonly body: string;
    readonly offset: number;
  }[];
}

const sourcePath = resolve(process.cwd(), 'src/ui/index.ts');
const source = readFileSync(sourcePath, 'utf8');
const openingPattern = /<(button|input|select|textarea|summary)\b[^>]*>/g;
const controls = new Map<string, { tag: string; opening: string; body: string; offset: number }[]>();

for (const match of source.matchAll(openingPattern)) {
  const tag = match[1]!;
  const opening = match[0];
  const attributes = [...opening.matchAll(/\b(data-[a-z][a-z0-9-]+)/g)].map((attribute) => attribute[1]!);
  if (!attributes.length) continue;
  const body = tag === 'input'
    ? ''
    : source.slice((match.index ?? 0) + opening.length, source.indexOf(`</${tag}>`, (match.index ?? 0) + opening.length));
  for (const attribute of attributes) {
    const occurrences = controls.get(attribute) ?? [];
    occurrences.push({ tag, opening, body, offset: match.index ?? 0 });
    controls.set(attribute, occurrences);
  }
}

const passiveAttributes = new Map<string, string>([
  ['data-composition-action', 'Consumed through the enclosing data-action-id command editor.'],
  ['data-instance-schema', 'Identifies the schema-side trace target consumed by delegated trace navigation.'],
  ['data-list-options', 'Carries list editor configuration consumed through data-inline-keyword.'],
  ['data-property-owner', 'Scopes nested property commands handled through data-command.'],
  ['data-refactor-destination', 'Read when the enclosing refactoring preview command is activated.'],
  ['data-schema-qualifier-type', 'Carries qualifier type metadata consumed through data-schema-qualifier-apply.'],
  ['data-start-cli-command', 'Provides discoverable command metadata while activation uses data-start-conversion-command.'],
  ['data-typed-schema-type', 'Carries typed-value schema metadata consumed through data-typed-value.'],
]);

function occurrences(value: string): number {
  return [...source.matchAll(new RegExp(`\\b${value}\\b`, 'g'))].length;
}

function hasAccessibleName(tag: string, opening: string, body: string, offset: number): boolean {
  if (/\btype="hidden"|\bhidden(?:\s|>)/.test(opening)) return true;
  if (/\baria-label(?:ledby)?=|\btitle=/.test(opening)) return true;
  if (tag === 'button' || tag === 'summary') {
    const meaningfulBody = body.replace(/\$\{fluentIcon\([^}]*\)\}/g, ' ');
    if (/\$\{/.test(meaningfulBody)) return true;
    const visibleText = meaningfulBody
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return visibleText.length > 0;
  }
  if (/\bid=/.test(opening)) return true;
  const preceding = source.slice(Math.max(0, offset - 640), offset);
  return preceding.lastIndexOf('<label') > preceding.lastIndexOf('</label>');
}

const inventory: InteractiveControl[] = [...controls.entries()]
  .map(([attribute, occurrences]) => ({ attribute, occurrences }))
  .sort((left, right) => left.attribute.localeCompare(right.attribute));

describe('exhaustive interactive UX control inventory', () => {
  it('discovers the expected control-family baseline', () => {
    expect(inventory).toHaveLength(248);
  });

  for (const control of inventory) {
    it(`${control.attribute} has stable, keyboard-native, named, and wired control markup`, () => {
      expect(control.occurrences.every(({ tag }) => ['button', 'input', 'select', 'textarea', 'summary'].includes(tag))).toBe(true);
      expect(control.occurrences.every(({ opening }) => opening.includes(control.attribute))).toBe(true);
      expect(control.occurrences.every(({ tag, opening, body, offset }) => hasAccessibleName(tag, opening, body, offset))).toBe(true);
      const passiveReason = passiveAttributes.get(control.attribute);
      expect(occurrences(control.attribute) >= 2 || passiveReason !== undefined, passiveReason ?? `${control.attribute} is rendered but has no wiring path.`).toBe(true);
    });
  }

  it('keeps passive metadata exceptions explicit and limited', () => {
    expect([...passiveAttributes.keys()].sort()).toEqual([
      'data-composition-action',
      'data-instance-schema',
      'data-list-options',
      'data-property-owner',
      'data-refactor-destination',
      'data-schema-qualifier-type',
      'data-start-cli-command',
      'data-typed-schema-type',
    ]);
  });
});
