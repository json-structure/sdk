import { schemaRecord, schemaForm, schemaSummary, schemaPointerToken } from '../schema-locations.js';
import { OVERLAY_EDITABLE_FACETS, type OverlayContext, type OverlayClassification, type OverlaySourceLocation } from '../overlay-context.js';
import { compositionEditorView, schemaEvaluationResult, type CompositionEditorOptions } from './composition-workspace.js';
import { displayPropertyValueTypes, propertyValueIsNullable } from './property-type-label.js';
import { schemaChildLocations, schemaLocationBar, schemaMemberInventory, type SchemaSheetOptions } from './schema-sheet.js';
const e = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const labels: Record<OverlayClassification, string> = { narrowing: 'Match-set narrowing', redundant: 'Redundant match constraint', conflict: 'Conflicting match constraints', expansion: 'Attempted expansion', indeterminate: 'Analysis incomplete' };
export function overlayAdvancedMenu(pointer: string, fullSchema = false): string {
  return '<details class="js-rule-menu js-overlay-advanced"><summary class="js-schema-action">Advanced</summary><div>' + (fullSchema ? '<button type="button" data-overlay-contextual="' + e(pointer) + '">Return to contextual constraints</button>' : '<button type="button" data-overlay-full-schema="' + e(pointer) + '">Edit as full schema</button>') + '<button type="button" data-overlay-reference="' + e(pointer) + '">Use reusable constraint schema/reference</button><button type="button" data-composition-source="' + e(pointer) + '">Edit Source</button></div></details>';
}
function overlaySemanticsView(context: OverlayContext): string {
  const effective = context.effective;
  let formula: string, explanation: string;
  switch (effective.operator) {
    case 'and-not':
      formula = 'Base AND NOT Delta';
      explanation = 'Edit the excluded predicate, not an asserted result constraint. If Delta matches no base-admissible instance, NOT excludes nothing.';
      if (schemaRecord(context.delta) && Object.keys(context.delta).length === 0) explanation += ' An empty Delta matches the entire base, so NOT excludes the entire base.';
      break;
    case 'predicate':
      formula = 'IF Delta in the base context';
      explanation = 'This is a predicate, not an asserted constraint. A match selects THEN; a non-match selects ELSE. Only the selected authored path applies its constraints.';
      break;
    case 'conditional-path':
      formula = 'Base AND ' + effective.path.toUpperCase() + ' Delta on the selected path';
      explanation = effective.predicate ? 'Applied when ' + effective.predicate.pointer + (effective.selectedWhen === 'matches' ? ' matches.' : ' does not match.') : 'No IF is authored. Validate keeps this standalone path indeterminate; no condition is synthesized.';
      break;
    default:
      formula = 'Base AND Delta';
      explanation = 'The owning schema is inherited and fixed; this operand does not replace it.';
  }
  return '<p class="js-description" data-overlay-effective-operator="' + effective.operator + '"><strong>' + e(formula) + '</strong> · ' + e(explanation) + '</p>';
}

function diagnosticSourceView(origin: OverlaySourceLocation, currentDocumentUri: string): string {
  const label = (origin.documentUri || 'Origin unavailable') + '#' + (origin.pointer || '"" (document root)');
  const indicator = '<code class="js-code" data-overlay-diagnostic-origin>' + e(label) + '</code>';
  if (!origin.documentUri || !currentDocumentUri) return indicator + '<span>Source unavailable (read-only)</span>';
  if (origin.documentUri !== currentDocumentUri) return indicator + '<button type="button" class="js-schema-action" data-effective-source="' + e(origin.pointer) + '" data-effective-document="' + e(origin.documentUri) + '">Imported source (read-only)</button>';
  return '<button type="button" class="js-schema-action" data-composition-source="' + e(origin.pointer) + '" data-effective-document="' + e(origin.documentUri) + '" title="' + e(label) + '">Source</button>';
}

/** The standard Schema Sheet, not a recursively nested or reduced branch editor. */
export function overlayEditorView(context: OverlayContext, sheet: SchemaSheetOptions, facets: string, composition?: CompositionEditorOptions, localOnly = false): string {
  const location = sheet.navigation.current!;
  const delta = schemaRecord(context.delta) ? context.delta : undefined;
  const localProperties = schemaRecord(delta?.properties) ? delta.properties : {};
  const effective = context.authoringProjection;
  const ownType = delta && Object.hasOwn(delta, 'type') ? '<span class="js-origin-chip" data-overlay-authored-type="' + e(typeof delta.type === 'string' ? delta.type : JSON.stringify(delta.type)) + '">Authored type · ' + e(typeof delta.type === 'string' ? delta.type : JSON.stringify(delta.type)) + ' (preserved)</span>' : '';
  const ref = delta && (typeof delta.$ref === 'string' ? delta.$ref : schemaRecord(delta.type) && typeof delta.type.$ref === 'string' ? delta.type.$ref : undefined);
  const reference = ref ? '<div class="js-schema-reference"><code dir="ltr" data-schema-reference="' + e(ref) + '">' + e(ref) + '</code><button type="button" class="js-schema-action" data-schema-reference-go="' + e(ref) + '">Go to referenced type</button></div>' : '';
  const heading = '<section class="js-design-section js-schema-declaration" data-schema-declaration data-declaration-form="' + schemaForm(context.delta) + '"><div class="js-section-head"><div><div class="js-eyebrow">Contextual constraints</div><h1 data-schema-heading tabindex="-1">' + e(location.label) + '</h1></div>' + overlayAdvancedMenu(context.pointer) + '</div><p data-declaration-label>Constraint set</p>' + overlaySemanticsView(context) + ownType + reference + (delta && typeof delta.name === 'string' ? '<p data-schema-authored-name>' + e(delta.name) + '</p>' : '') + (delta && typeof delta.description === 'string' ? '<p data-schema-authored-description>' + e(delta.description) + '</p>' : '') + (composition ? schemaEvaluationResult(composition, context.pointer, 'schema') : '') + '</section>';
  const inheritedConstraints = context.base.constraints.filter(c => c.keyword !== 'properties' && (c.keyword !== 'required' || Array.isArray(c.value) && c.value.some(Array.isArray)));
  const baseView = '<section class="js-design-section js-overlay-base" aria-label="Immutable base"><div class="js-section-head"><h2>Inherited base</h2><span class="js-origin-chip">Read-only</span></div><p><code dir="ltr" data-overlay-base-pointer>' + e(context.basePointer || '"" (root)') + '</code> · <span data-overlay-base-type>' + e(context.base.types.types.join(' | ') || 'Indeterminate') + '</span></p>' + (context.base.required.length ? '<p>Required by base: <span data-overlay-base-required>' + context.base.required.map(e).join(', ') + '</span> (implicit; not restated)</p>' : '') + (inheritedConstraints.length ? '<dl class="js-overlay-base-facets">' + inheritedConstraints.map(c => '<div><dt>' + e(c.keyword) + '</dt><dd><code>' + e(JSON.stringify(c.value).length > 180 ? JSON.stringify(c.value).slice(0, 180) + "…" : JSON.stringify(c.value)) + '</code></dd></div>').join('') + '</dl>' : '') + '</section>';
  const object = effective.types.types.includes('object');
  const required = Array.isArray(delta?.required) ? delta.required : [];
  const names = [...new Set([...Object.keys(effective.properties), ...Object.keys(localProperties), ...required.filter((name): name is string => typeof name === 'string')])];
  const handled = new Set<string>();
  const properties = (object ? names : []).filter(name => !localOnly || Object.hasOwn(localProperties, name) || required.includes(name)).map(name => {
    const base = Object.hasOwn(context.base.properties, name) ? context.base.properties[name] : undefined;
    const member = Object.hasOwn(effective.properties, name) ? effective.properties[name] : undefined;
    const pointer = context.pointer + '/properties/' + schemaPointerToken(name);
    const authored = Object.hasOwn(localProperties, name);
    if (authored) handled.add(pointer);
    const actionLabel = authored ? 'Edit constraints' : 'Add constraints';
    const open = authored
      ? '<button type="button" class="js-schema-action js-overlay-constrain-action" data-schema-open="' + e(pointer) + '" aria-label="Edit constraints for ' + e(name) + '">' + actionLabel + '</button>'
      : '<button type="button" class="js-schema-action js-overlay-constrain-action" data-overlay-property-open="' + e(name) + '" data-overlay-owner="' + e(context.pointer) + '" aria-label="Add constraints for inherited property ' + e(name) + '" ' + (!context.authorable ? 'disabled title="' + e(context.reason ?? '') + '"' : '') + '>' + actionLabel + '</button>';
    const presence = base?.required ? '<label title="Base requirements are immutable"><input type="checkbox" checked disabled data-overlay-base-required-property="' + e(name) + '"> required (base)</label>' : '<label><input type="checkbox" data-overlay-required="' + e(name) + '" data-overlay-owner="' + e(context.pointer) + '" ' + (required.includes(name) ? 'checked ' : '') + (!context.operations.addRequired.enabled ? 'disabled ' : '') + '> required' + (required.includes(name) ? ' (local)' : '') + '</label>';
    const source = base?.schema ?? member?.schema ?? {};
    const type = displayPropertyValueTypes(source);
    return '<div class="js-property-editor" data-schema-child-kind="' + (delta?.type === 'tuple' ? 'tuple-member' : 'property') + '" data-schema-child-key="' + e(name) + '" data-property-editor="' + e(pointer) + '" data-overlay-member="' + e(name) + '" data-member-origin="' + (base ? 'inherited' : 'local') + '" role="rowgroup"><div class="js-row js-effective-row js-overlay-member-row" role="row"><div class="js-cell js-code" role="cell">' + e(name) + '</div><div class="js-cell js-code js-property-type-value" role="cell">' + e(type) + '</div><div class="js-cell js-nullable-indicator" role="cell">' + (propertyValueIsNullable(source) ? 'yes' : 'no') + '</div><div class="js-cell" role="cell"><span class="js-origin-chip">' + (base ? 'Inherited · fixed' : 'Branch-local') + '</span></div><div class="js-cell" role="cell">' + presence + '</div><div class="js-cell" role="cell">' + (authored ? schemaRecord(localProperties[name]) && !Object.keys(localProperties[name]).length ? 'No local constraints yet' : e(schemaSummary(localProperties[name], true)) : 'No local constraints yet') + '</div><div class="js-cell js-action-cell" role="cell">' + open + '</div></div></div>';
  }).join('');
  const add = context.operations.addProperty;
  const unrestricted = context.base.additionalProperties.layers.length === 0;
  const propertyAdder = object ? '<details class="js-overlay-property-add"><summary class="js-schema-action"' + (!add.enabled ? ' aria-disabled="true"' : '') + '>Add property constraint</summary>' + (add.enabled ? (add.warning ? '<p class="js-capability-note" data-overlay-add-warning>' + e(add.warning) + '</p>' : '') + '<div class="js-detail-add"><label>New property name<input data-overlay-new-name aria-label="New property name"></label>' + (unrestricted ? '<label>Narrow value type<select data-overlay-new-type aria-label="New property value type">' + ['string', 'boolean', 'int32', 'int64', 'double', 'decimal', 'datetime', 'date', 'uuid'].map(t => '<option value="' + t + '">' + t + '</option>').join('') + '</select></label>' : '<span>Inherits the base additional-property value constraints.</span>') + '<button type="button" data-overlay-property-add="' + e(context.pointer) + '">Add property</button></div>' : '<p class="js-capability-note">' + e(add.reason ?? 'Additional properties are not permitted.') + '</p>') + '</details>' : '';
  const structure = '<section class="js-design-section js-schema-structure"><div class="js-section-head"><h2>' + (object ? 'Properties' : 'Structure') + '</h2>' + (object ? '<div class="js-member-mode" role="group" aria-label="Property origin"><button data-overlay-member-mode="local" aria-pressed="' + localOnly + '">Local</button><button data-overlay-member-mode="effective" aria-pressed="' + !localOnly + '">Effective</button></div>' : '') + '</div>' + (object ? '<div class="js-grid js-overlay-grid" role="table" aria-label="Contextual properties"><div class="js-row js-header js-overlay-member-row" role="row">' + ['Name', 'Type', 'Nullable', 'Origin', 'Presence', 'Local constraints', 'Action'].map(label => '<div class="js-cell" role="columnheader">' + label + '</div>').join('') + '</div>' + properties + '</div>' + propertyAdder : '<p class="js-description">' + (['array', 'set', 'map', 'tuple', 'choice'].some(t => effective.types.types.includes(t)) ? 'Context is resolved. Collection, tuple and choice overlay controls are a later phase; authored children and Advanced remain available.' : 'Constrain the inherited value below.') + '</p>') + schemaChildLocations(sheet, handled) + '</section>';
  const diagnosticView = '<section class="js-design-section js-overlay-diagnostics"><h2>Delta analysis</h2><p class="js-description" data-overlay-diagnostic-scope="operand-match">Compatibility guidance for the operand match set, not a schema-validity or enclosing-rule verdict. The operator determines how matches affect the result.</p><ul>' + context.diagnostics.map(d => '<li data-overlay-classification="' + d.classification + '" data-overlay-diagnostic-document="' + e(d.documentUri) + '" data-overlay-diagnostic-pointer="' + e(d.pointer) + '"><strong>' + labels[d.classification] + '</strong> · ' + e(d.message) + diagnosticSourceView(d, context.documentUri) + (d.related.length ? '<details class="js-overlay-related-origins"><summary>Related origins</summary><ul>' + d.related.map(origin => '<li>' + diagnosticSourceView(origin, context.documentUri) + '</li>').join('') + '</ul></details>' : '') + '</li>').join('') + '</ul></section>';
  const constraints = '<section class="js-design-section"><h2>Local constraints</h2>' + (context.reason ? '<p class="js-capability-note">' + e(context.reason) + '</p>' : '') + (delta && context.authorable ? facets : '') + (!delta ? '<pre data-schema-opaque>' + e(location.range?.startOffset !== undefined ? sheet.source.slice(location.range.startOffset, location.range.endOffset) : JSON.stringify(context.delta)) + '</pre>' : '') + '<p class="js-inline-status" data-inline-status="' + e(context.pointer) + '" role="status"></p></section>';
  const renderedMembers = new Set(['name', 'description', ...(context.authorable ? OVERLAY_EDITABLE_FACETS : []), ...(object && Array.isArray(delta?.required) && delta.required.every(v => typeof v === 'string') ? ['required'] : [])]);
  return schemaLocationBar(sheet) + '<div class="js-sheet js-schema-sheet" data-schema-sheet="' + e(context.pointer) + '" data-overlay-context="' + e(context.pointer) + '" data-overlay-owner="' + e(context.ownerPointer) + '">' + heading + baseView + structure + constraints + (composition && delta ? compositionEditorView(composition) : '') + diagnosticView + schemaMemberInventory(location, renderedMembers) + '</div>';
}
