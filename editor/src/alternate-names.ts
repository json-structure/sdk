export interface AlternateNamesKeywordMap {
  readonly altnames: Readonly<Record<string, string>>;
  readonly altenums: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly descriptions: Readonly<Record<string, string>>;
}
export type AlternateNamesKeyword = keyof AlternateNamesKeywordMap;
export interface AlternateNamesIssue { readonly keyword: AlternateNamesKeyword; readonly path: readonly string[]; readonly message: string; }

export const ALTERNATE_NAMES_KEYWORDS = ['altnames', 'altenums', 'descriptions'] as const satisfies readonly AlternateNamesKeyword[];

const GRANDFATHERED_LANGUAGE_TAGS = new Set([
  'art-lojban', 'cel-gaulish', 'en-gb-oed', 'i-ami', 'i-bnn', 'i-default', 'i-enochian', 'i-hak', 'i-klingon',
  'i-lux', 'i-mingo', 'i-navajo', 'i-pwn', 'i-tao', 'i-tay', 'i-tsu', 'no-bok', 'no-nyn', 'sgn-be-fr',
  'sgn-be-nl', 'sgn-ch-de', 'zh-guoyu', 'zh-hakka', 'zh-min', 'zh-min-nan', 'zh-xiang'
]);
const LANGUAGE_TAG = /^(?:(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4}|[A-Za-z]{5,8})(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*(?:-x(?:-[A-Za-z0-9]{1,8})+)?|x(?:-[A-Za-z0-9]{1,8})+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validLanguageTag(value: string): boolean {
  const normalized = value.toLowerCase();
  if (GRANDFATHERED_LANGUAGE_TAGS.has(normalized)) return true;
  if (!LANGUAGE_TAG.test(value)) return false;
  const subtags = normalized.split('-');
  if (subtags[0] === 'x') return true;
  const variants = new Set<string>();
  const singletons = new Set<string>();
  let index = 1;
  if (/^[a-z]{2,3}$/.test(subtags[0])) {
    let extlangCount = 0;
    while (extlangCount < 3 && /^[a-z]{3}$/.test(subtags[index] ?? '')) { index++; extlangCount++; }
  }
  if (/^[a-z]{4}$/.test(subtags[index] ?? '')) index++;
  if (/^(?:[a-z]{2}|[0-9]{3})$/.test(subtags[index] ?? '')) index++;
  while (index < subtags.length && subtags[index] !== 'x' && subtags[index].length !== 1) {
    const variant = subtags[index];
    if (/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/.test(variant)) {
      if (variants.has(variant)) return false;
      variants.add(variant);
    }
    index++;
  }
  while (index < subtags.length && subtags[index] !== 'x') {
    const singleton = subtags[index];
    if (singletons.has(singleton)) return false;
    singletons.add(singleton);
    index++;
    while (index < subtags.length && subtags[index] !== 'x' && subtags[index].length !== 1) index++;
  }
  return true;
}
function validPurpose(purpose: string): boolean {
  return !purpose.startsWith('lang:') || validLanguageTag(purpose.slice(5));
}
function validStringMap(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.entries(value).every(([purpose, alternate]) =>
    validPurpose(purpose) && typeof alternate === 'string');
}
function validAlternateEnumMap(value: unknown, enumValues: unknown): value is Readonly<Record<string, Readonly<Record<string, string>>>> {
  if (!isRecord(value) || !Array.isArray(enumValues) || enumValues.length === 0 ||
      !enumValues.every((entry) => typeof entry === 'string') || new Set(enumValues).size !== enumValues.length) return false;
  const required = new Set(enumValues as string[]);
  return Object.entries(value).every(([purpose, symbols]) => validPurpose(purpose) && isRecord(symbols) &&
    Object.keys(symbols).length === required.size && Object.keys(symbols).every((key) => required.has(key)) &&
    Object.values(symbols).every((symbol) => typeof symbol === 'string'));
}

export function alternateNamesPlacementValid(declaration: Readonly<Record<string, unknown>>, keyword: AlternateNamesKeyword, namedElement: boolean): boolean {
  if (keyword === 'altenums') return Array.isArray(declaration.enum);
  if (keyword === 'descriptions') return true;
  return namedElement;
}
export function alternateNamesIssues(declaration: Readonly<Record<string, unknown>>, namedElement: boolean): readonly AlternateNamesIssue[] {
  const issues: AlternateNamesIssue[] = [];
  for (const keyword of ALTERNATE_NAMES_KEYWORDS) {
    if (!Object.prototype.hasOwnProperty.call(declaration, keyword)) continue;
    if (!alternateNamesPlacementValid(declaration, keyword, namedElement)) {
      issues.push({ keyword, path: [], message: `${keyword} is not permitted at this schema position.` });
      continue;
    }
    const authored = declaration[keyword];
    if (!isRecord(authored)) {
      issues.push({ keyword, path: [], message: `${keyword} must be a purpose map.` });
      continue;
    }
    for (const [purpose, purposeValue] of Object.entries(authored)) {
      if (!validPurpose(purpose)) {
        issues.push({ keyword, path: [purpose], message: `${keyword} purpose '${purpose}' must contain an RFC 5646 language tag after lang:.` });
      } else if (keyword === 'altenums' ? !isRecord(purposeValue) : typeof purposeValue !== 'string') {
        issues.push({ keyword, path: [purpose], message: keyword === 'altenums' ? 'Each altenums purpose value must be an object map.' : `Each ${keyword} purpose value must be a string.` });
      } else if (keyword === 'altenums' && isRecord(purposeValue)) {
        for (const [enumValue, alternate] of Object.entries(purposeValue)) {
          if (typeof alternate !== 'string') issues.push({ keyword, path: [purpose, enumValue], message: 'Each alternate enum representation must be a string.' });
        }
      }
    }
    if (keyword === 'altenums' && !validAlternateEnumMap(authored, declaration.enum)) {
      issues.push({
        keyword,
        path: [],
        message: 'altenums requires a non-empty distinct string enum, and each purpose map must cover every enum value exactly.'
      });
    } else if (keyword !== 'altenums' && !validStringMap(authored) && issues.every((issue) => issue.keyword !== keyword)) {
      issues.push({ keyword, path: [], message: `${keyword} must be a string map; lang: keys must contain an RFC 5646 language tag.` });
    }
  }
  return issues;
}
export function alternateNamesValueValid(
  declaration: Readonly<Record<string, unknown>>,
  keyword: AlternateNamesKeyword,
  value: unknown,
  namedElement: boolean
): boolean {
  const candidate = { ...declaration, [keyword]: value };
  return alternateNamesIssues(candidate, namedElement).every((issue) => issue.keyword !== keyword);
}