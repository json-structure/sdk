/**
 * Type alias for composition array keyword.
 */
export type CompositionArrayKeyword = 'allOf' | 'anyOf' | 'oneOf';
/**
 * Type alias for composition single keyword.
 */
export type CompositionSingleKeyword = 'not';
/**
 * Type alias for conditional branch keyword.
 */
export type ConditionalBranchKeyword = 'if' | 'then' | 'else';
/**
 * Type alias for composition keyword.
 */
export type CompositionKeyword = CompositionArrayKeyword | CompositionSingleKeyword | ConditionalBranchKeyword;
/**
 * Type alias for composition schema.
 */
export type CompositionSchema = Readonly<Record<string, unknown>>;

/**
 * Defines the composition keyword map shape.
 */
export interface CompositionKeywordMap {
  readonly allOf: readonly CompositionSchema[];
  readonly anyOf: readonly CompositionSchema[];
  readonly oneOf: readonly CompositionSchema[];
  readonly not: CompositionSchema;
}

/**
 * Defines the conditional composition group shape.
 */
export interface ConditionalCompositionGroup {
  readonly if: CompositionSchema;
  readonly then?: CompositionSchema;
  readonly else?: CompositionSchema;
}

/**
 * Validates composition array value valid and narrows the value type when applicable.
 */
export function compositionArrayValueValid(value: unknown, schemaValid: (schema: unknown) => boolean): value is readonly CompositionSchema[] {
  return Array.isArray(value) && value.length > 0 && value.every(schemaValid);
}

/**
 * Validates composition schema value valid and narrows the value type when applicable.
 */
export function compositionSchemaValueValid(value: unknown, schemaValid: (schema: unknown) => boolean): value is CompositionSchema {
  return schemaValid(value);
}

/**
 * Validates conditional composition group valid and narrows the value type when applicable.
 */
export function conditionalCompositionGroupValid(value: ConditionalCompositionGroup, schemaValid: (schema: unknown) => boolean): boolean {
  return schemaValid(value.if) && (value.then !== undefined || value.else !== undefined) &&
    (value.then === undefined || schemaValid(value.then)) &&
    (value.else === undefined || schemaValid(value.else));
}