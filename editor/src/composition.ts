export type CompositionArrayKeyword = 'allOf' | 'anyOf' | 'oneOf';
export type CompositionSingleKeyword = 'not';
export type ConditionalBranchKeyword = 'if' | 'then' | 'else';
export type CompositionKeyword = CompositionArrayKeyword | CompositionSingleKeyword | ConditionalBranchKeyword;
export type CompositionSchema = Readonly<Record<string, unknown>>;

export interface CompositionKeywordMap {
  readonly allOf: readonly CompositionSchema[];
  readonly anyOf: readonly CompositionSchema[];
  readonly oneOf: readonly CompositionSchema[];
  readonly not: CompositionSchema;
}

export interface ConditionalCompositionGroup {
  readonly if: CompositionSchema;
  readonly then?: CompositionSchema;
  readonly else?: CompositionSchema;
}

export function compositionArrayValueValid(value: unknown, schemaValid: (schema: unknown) => boolean): value is readonly CompositionSchema[] {
  return Array.isArray(value) && value.length > 0 && value.every(schemaValid);
}

export function compositionSchemaValueValid(value: unknown, schemaValid: (schema: unknown) => boolean): value is CompositionSchema {
  return schemaValid(value);
}

export function conditionalCompositionGroupValid(value: ConditionalCompositionGroup, schemaValid: (schema: unknown) => boolean): boolean {
  return schemaValid(value.if) && (value.then !== undefined || value.else !== undefined) &&
    (value.then === undefined || schemaValid(value.then)) &&
    (value.else === undefined || schemaValid(value.else));
}