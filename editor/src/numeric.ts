/** Exact wire-number comparison shared by Validate and contextual constraint analysis. */
function numericParts(value: number | string): { coefficient: bigint; scale: number } | undefined {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  let scale = fraction.length - Number(match[4] ?? 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 100_000 || text.length > 100_000) return undefined;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

export function compareNumeric(left: number | string, right: number | string): number | undefined {
  const a = numericParts(left);
  const b = numericParts(right);
  if (!a || !b) return undefined;
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * 10n ** BigInt(scale - a.scale);
  const bv = b.coefficient * 10n ** BigInt(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function multipleOf(value: number | string, divisor: number | string): boolean | undefined {
  const a = numericParts(value);
  const b = numericParts(divisor);
  if (!a || !b || b.coefficient === 0n) return undefined;
  const scale = Math.max(a.scale, b.scale);
  return (a.coefficient * 10n ** BigInt(scale - a.scale)) % (b.coefficient * 10n ** BigInt(scale - b.scale)) === 0n;
}

