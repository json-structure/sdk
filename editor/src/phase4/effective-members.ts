import { ResolvedSchemaContext, referencePointer, type ImportProvenance, type ResolvedSchemaDocument, type ResolvedSchemaLocation } from './resolved-schema.js';

export type EffectiveMemberStatus = 'resolved' | 'indeterminate';

export interface EffectiveMember {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly required: boolean;
  readonly provenance: 'local' | 'inherited' | 'add-in';
  readonly declaredAt: string;
  readonly documentUri: string;
  readonly sourcePointer: string;
  readonly imports: readonly ImportProvenance[];
  readonly inheritedVia: readonly string[];
  readonly addIn?: string;
}

export interface EffectiveMemberConflict {
  readonly name: string;
  readonly winner: string;
  readonly loser: string;
  readonly reason: 'base-precedence' | 'local-redefinition' | 'addin-conflict';
}

export interface EffectiveMemberDiagnostic {
  readonly code: 'effective-members.target-missing' | 'effective-members.cycle' | 'effective-members.unsupported-type' | 'effective-members.addin-missing' | 'effective-members.addin-invalid';
  readonly severity: 'indeterminate';
  readonly pointer: string;
  readonly message: string;
}

export interface EffectiveMembersResult {
  readonly status: EffectiveMemberStatus;
  readonly target: string;
  readonly members: readonly EffectiveMember[];
  readonly required: readonly string[];
  readonly tuple: readonly string[];
  readonly conflicts: readonly EffectiveMemberConflict[];
  readonly diagnostics: readonly EffectiveMemberDiagnostic[];
}

export interface EffectiveMemberOptions {
  readonly documentUri?: string;
  readonly resolvedDocuments?: readonly ResolvedSchemaDocument[];
  readonly addIns?: readonly string[];
}

interface MutableResult {
  status: EffectiveMemberStatus;
  readonly target: string;
  readonly members: Map<string, EffectiveMember>;
  readonly required: Set<string>;
  readonly tuple: string[];
  readonly conflicts: EffectiveMemberConflict[];
  readonly diagnostics: EffectiveMemberDiagnostic[];
}

/** Resolves effective object or tuple members after imports, inheritance, and selected add-ins. */
export function resolveEffectiveMembers(
  document: Readonly<Record<string, unknown>>,
  target: string,
  options: EffectiveMemberOptions = {}
): EffectiveMembersResult {
  const context = new ResolvedSchemaContext(document, options);
  const normalizedTarget = normalizeTarget(target);
  const location = context.resolve(`#${normalizedTarget}`);
  const resolved = location ? resolveDeclaration(context, location, []) : missingResult(normalizedTarget);
  if (context.indeterminate) resolved.status = 'indeterminate';
  applyAddIns(context, document, resolved, options.addIns ?? []);
  return freezeResult(resolved);
}

function resolveDeclaration(
  context: ResolvedSchemaContext,
  location: ResolvedSchemaLocation,
  stack: readonly string[]
): MutableResult {
  const target = location.effectivePointer;
  const identity = `${location.documentUri}#${location.sourcePointer}`;
  const result = emptyResult(target);
  if (stack.includes(identity)) {
    result.status = 'indeterminate';
    result.diagnostics.push({
      code: 'effective-members.cycle',
      severity: 'indeterminate',
      pointer: target,
      message: `Inheritance cycle detected at ${identity}.`
    });
    return result;
  }

  const declaration = location.schema;
  if (declaration.type !== 'object' && declaration.type !== 'tuple') {
    result.status = 'indeterminate';
    result.diagnostics.push({
      code: 'effective-members.unsupported-type',
      severity: 'indeterminate',
      pointer: target,
      message: `Effective members are only defined for object and tuple schemas; ${target} has type ${JSON.stringify(declaration.type)}.`
    });
    return result;
  }

  const bases = typeof declaration.$extends === 'string'
    ? [declaration.$extends]
    : Array.isArray(declaration.$extends) && declaration.$extends.every((entry) => typeof entry === 'string')
      ? declaration.$extends
      : [];
  for (const authoredBase of bases) {
    const resolvedBase = context.resolve(authoredBase, location.documentUri);
    if (!resolvedBase) {
      result.status = 'indeterminate';
      result.diagnostics.push({
        code: 'effective-members.target-missing',
        severity: 'indeterminate',
        pointer: referencePointer(authoredBase) ?? `${target}/$extends`,
        message: `The inheritance reference ${JSON.stringify(authoredBase)} cannot be resolved.`
      });
      continue;
    }
    const base = location.imports.length === 0 ? resolvedBase : {
      ...resolvedBase,
      effectivePointer: effectiveBasePointer(location, resolvedBase),
      imports: location.imports
    };
    const inherited = resolveDeclaration(context, base, [...stack, identity]);
    mergeInherited(result, inherited, base.effectivePointer);
  }

  mergeLocalMembers(result, location, 'local');
  return result;
}

function applyAddIns(context: ResolvedSchemaContext, document: Readonly<Record<string, unknown>>, target: MutableResult, addIns: readonly string[]): void {
  const offers = isRecord(document.$offers) ? document.$offers : {};
  for (const addInName of addIns) {
    const offered = offers[addInName];
    const references = typeof offered === 'string' ? [offered] : stringArray(offered);
    if (references.length === 0) {
      target.status = 'indeterminate';
      target.diagnostics.push({ code: 'effective-members.addin-missing', severity: 'indeterminate', pointer: '/$offers', message: `Selected add-in ${JSON.stringify(addInName)} is not offered.` });
      continue;
    }
    for (const reference of references) {
      const location = context.resolve(reference);
      const bases = location && (typeof location.schema.$extends === 'string' ? [location.schema.$extends] : stringArray(location.schema.$extends));
      const applies = location !== undefined && bases?.some((base) => context.resolve(base, location.documentUri)?.effectivePointer === target.target);
      if (!location || location.schema.abstract !== true || !applies) {
        target.status = 'indeterminate';
        target.diagnostics.push({ code: 'effective-members.addin-invalid', severity: 'indeterminate', pointer: '/$offers', message: `Offered add-in ${JSON.stringify(addInName)} is not an abstract extension of ${target.target}.` });
        continue;
      }
      const addIn = emptyResult(location.effectivePointer);
      mergeLocalMembers(addIn, location, 'add-in', addInName);
      for (const member of addIn.members.values()) {
        const winner = target.members.get(member.name);
        if (winner && winner.declaredAt !== member.declaredAt) target.conflicts.push({ name: member.name, winner: winner.declaredAt, loser: member.declaredAt, reason: 'addin-conflict' });
        else target.members.set(member.name, member);
      }
      for (const name of addIn.required) target.required.add(name);
      for (const name of addIn.tuple) appendUnique(target.tuple, name);
    }
  }
}

function mergeLocalMembers(result: MutableResult, location: ResolvedSchemaLocation, provenance: 'local' | 'add-in', addIn?: string): void {
  const properties = isRecord(location.schema.properties) ? location.schema.properties : {};
  for (const [name, schema] of Object.entries(properties)) {
    if (!isRecord(schema)) continue;
    const sourcePointer = `${location.sourcePointer}/properties/${escapePointerPart(name)}`;
    const declaredAt = `${location.effectivePointer}/properties/${escapePointerPart(name)}`;
    const inherited = result.members.get(name);
    if (inherited && inherited.declaredAt !== declaredAt) result.conflicts.push({ name, winner: declaredAt, loser: inherited.declaredAt, reason: 'local-redefinition' });
    result.members.set(name, { name, schema, required: false, provenance, declaredAt, documentUri: location.documentUri, sourcePointer, imports: location.imports, inheritedVia: [], ...(addIn === undefined ? {} : { addIn }) });
  }
  for (const name of stringArray(location.schema.required)) result.required.add(name);
  for (const name of stringArray(location.schema.tuple)) appendUnique(result.tuple, name);
}

function mergeInherited(target: MutableResult, source: MutableResult, base: string): void {
  if (source.status === 'indeterminate') target.status = 'indeterminate';
  target.diagnostics.push(...source.diagnostics);
  target.conflicts.push(...source.conflicts);
  for (const member of source.members.values()) {
    const inherited: EffectiveMember = {
      ...member,
      provenance: 'inherited',
      inheritedVia: [base, ...member.inheritedVia]
    };
    const winner = target.members.get(member.name);
    if (!winner) {
      target.members.set(member.name, inherited);
    } else if (winner.declaredAt !== inherited.declaredAt) {
      target.conflicts.push({
        name: member.name,
        winner: winner.declaredAt,
        loser: inherited.declaredAt,
        reason: 'base-precedence'
      });
    }
  }
  for (const name of source.required) target.required.add(name);
  for (const name of source.tuple) appendUnique(target.tuple, name);
}

function freezeResult(result: MutableResult): EffectiveMembersResult {
  const members = [...result.members.values()].map((member) => ({ ...member, required: result.required.has(member.name) }));
  return {
    status: result.status,
    target: result.target,
    members,
    required: members.filter((member) => member.required).map((member) => member.name),
    tuple: result.tuple.filter((name) => result.members.has(name)),
    conflicts: result.conflicts,
    diagnostics: deduplicateDiagnostics(result.diagnostics)
  };
}

function emptyResult(target: string): MutableResult {
  return {
    status: 'resolved',
    target,
    members: new Map(),
    required: new Set(),
    tuple: [],
    conflicts: [],
    diagnostics: []
  };
}

function missingResult(target: string): MutableResult {
  const result = emptyResult(target);
  result.status = 'indeterminate';
  result.diagnostics.push({ code: 'effective-members.target-missing', severity: 'indeterminate', pointer: target, message: `The effective declaration ${target} does not exist or is ambiguous.` });
  return result;
}

function effectiveBasePointer(owner: ResolvedSchemaLocation, base: ResolvedSchemaLocation): string {
  if (owner.imports.length === 0 || !base.effectivePointer.startsWith('/definitions/')) return base.effectivePointer;
  if (owner.sourcePointer.startsWith('/definitions/')) {
    const ownerSuffix = owner.sourcePointer.slice('/definitions'.length);
    if (owner.effectivePointer.endsWith(ownerSuffix)) {
      return `${owner.effectivePointer.slice(0, -ownerSuffix.length)}${base.effectivePointer.slice('/definitions'.length)}`;
    }
    return base.effectivePointer;
  }
  if (owner.sourcePointer === '') {
    const separator = owner.effectivePointer.lastIndexOf('/');
    if (separator >= '/definitions'.length) {
      return `${owner.effectivePointer.slice(0, separator)}${base.effectivePointer.slice('/definitions'.length)}`;
    }
  }
  return base.effectivePointer;
}

function normalizeTarget(target: string): string {
  return normalizeLocalReference(target) ?? target;
}

function normalizeLocalReference(reference: string): string | undefined {
  return referencePointer(reference);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function deduplicateDiagnostics(diagnostics: readonly EffectiveMemberDiagnostic[]): EffectiveMemberDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.pointer}|${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapePointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}