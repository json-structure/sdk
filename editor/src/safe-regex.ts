import { RE2JS } from 're2js';

export const MAX_SAFE_REGEX_PATTERN_LENGTH = 1024;
export const MAX_SAFE_REGEX_INPUT_LENGTH = 16_384;

export type SafeRegexMatchResult =
  | { readonly status: 'matched' | 'not-matched' }
  | { readonly status: 'indeterminate'; readonly reason: 'input-too-long' | 'engine-error' };

export type SafeRegexCompilation =
  | { readonly status: 'ready'; readonly test: (input: string, fullMatch?: boolean) => SafeRegexMatchResult }
  | { readonly status: 'invalid' | 'unsupported' | 'pattern-too-long' };

export function compileSafeRegex(pattern: string): SafeRegexCompilation {
  if (pattern.length > MAX_SAFE_REGEX_PATTERN_LENGTH) return { status: 'pattern-too-long' };
  try {
    new RegExp(pattern, 'u');
  } catch {
    return { status: 'invalid' };
  }
  try {
    const expression = RE2JS.compile(pattern);
    return {
      status: 'ready',
      test: (input, fullMatch = false) => {
        if (input.length > MAX_SAFE_REGEX_INPUT_LENGTH) return { status: 'indeterminate', reason: 'input-too-long' };
        try {
          const matched = fullMatch ? expression.testExact(input) : expression.test(input);
          return { status: matched ? 'matched' : 'not-matched' };
        } catch {
          return { status: 'indeterminate', reason: 'engine-error' };
        }
      }
    };
  } catch {
    return { status: 'unsupported' };
  }
}