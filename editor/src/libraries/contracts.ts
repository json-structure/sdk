export type LibraryVersionSelector =
  | { readonly kind: 'pinned'; readonly version: string }
  | { readonly kind: 'floating'; readonly tag?: string };

export interface LibraryVersion {
  readonly version: string;
  readonly documentUri: string;
  readonly integrity?: string;
  readonly epoch?: string;
  readonly isDefault: boolean;
}

export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly versions: readonly LibraryVersion[];
}

export interface LibraryDocument {
  readonly entryId: string;
  readonly version: string;
  readonly uri: string;
  readonly value: unknown;
  readonly integrity?: string;
  readonly epoch?: string;
}

export interface LibraryProvider {
  readonly id: string;
  listEntries(): Promise<readonly LibraryEntry[]>;
  readDocument(entryId: string, version: string): Promise<LibraryDocument>;
}

export interface LibraryManifestEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly versions: readonly LibraryVersion[];
}

export function normalizeLibraryVersion(version: LibraryVersion): LibraryVersion {
  const normalizedVersion = requiredText(version.version, 'Library version');
  const documentUri = requiredText(version.documentUri, 'Library document URI');
  return {
    version: normalizedVersion,
    documentUri,
    ...(optionalText(version.integrity) ? { integrity: version.integrity!.trim() } : {}),
    ...(optionalText(version.epoch) ? { epoch: version.epoch!.trim() } : {}),
    isDefault: version.isDefault === true,
  };
}

export function normalizeLibraryEntry(entry: LibraryManifestEntry): LibraryEntry {
  const id = requiredText(entry.id, 'Library entry id');
  const versions = entry.versions.map(normalizeLibraryVersion);
  const versionIds = new Set<string>();
  let defaultCount = 0;
  for (const version of versions) {
    if (versionIds.has(version.version)) throw new Error(`Duplicate library version '${version.version}' for '${id}'.`);
    versionIds.add(version.version);
    if (version.isDefault) defaultCount += 1;
  }
  if (defaultCount > 1) throw new Error(`Library entry '${id}' has multiple default versions.`);
  return {
    id,
    name: optionalText(entry.name) ? entry.name!.trim() : id,
    ...(optionalText(entry.description) ? { description: entry.description!.trim() } : {}),
    versions: [...versions].sort((left, right) => left.version.localeCompare(right.version)),
  };
}

export function resolveLibraryVersion(entry: LibraryEntry, selector: LibraryVersionSelector): LibraryVersion {
  const selected = selector.kind === 'pinned'
    ? entry.versions.find((version) => version.version === selector.version)
    : entry.versions.find((version) => version.isDefault) ?? entry.versions.at(-1);
  if (!selected) {
    const requested = selector.kind === 'pinned' ? selector.version : selector.tag ?? 'default';
    throw new Error(`Library version '${requested}' was not found for '${entry.id}'.`);
  }
  return selected;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty.`);
  return normalized;
}

function optionalText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}