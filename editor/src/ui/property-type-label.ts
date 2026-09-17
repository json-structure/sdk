import { displaySchemaTypeValue } from './helpers.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCollectionSchema(value: unknown): value is Readonly<Record<string, unknown>> & { readonly type: 'array' | 'set' | 'map' } {
  return isRecord(value) && (value.type === 'array' || value.type === 'set' || value.type === 'map');
}

function definitionTypeLabel(reference: string): string {
  return reference.replace(/^#/, '').split('/').slice(2).map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~')).join('.');
}

function schemaExpressionLabel(value: unknown): string {
  if (!isRecord(value)) return displaySchemaTypeValue(value);
  if (typeof value.$ref === 'string') return definitionTypeLabel(value.$ref);
  if (!isCollectionSchema(value)) return displaySchemaTypeValue(value);
  const member = value[value.type === 'map' ? 'values' : 'items'];
  const memberLabel = isRecord(member) ? schemaExpressionLabel(member.type) : 'untyped';
  return value.type === 'map' ? `map<string, ${memberLabel}>` : `${value.type}<${memberLabel}>`;
}

/** Uses the same concise property type label in main and contextual property tables. */
export function displayPropertyValueTypes(schema: Readonly<Record<string, unknown>>): string {
  if (typeof schema.$ref === 'string') return 'Legacy reference · ' + schema.$ref;
  if (!Object.hasOwn(schema, 'type')) return 'No declared type';
  if (isCollectionSchema(schema)) return schemaExpressionLabel(schema);
  const values = Array.isArray(schema.type) ? schema.type.filter((value) => value !== 'null') : schema.type === 'null' ? [] : [schema.type];
  return values.length ? values.map(schemaExpressionLabel).join(' or ') : 'null only';
}

export function propertyValueIsNullable(schema: Readonly<Record<string, unknown>>): boolean {
  return schema.type === 'null' || Array.isArray(schema.type) && schema.type.includes('null');
}
