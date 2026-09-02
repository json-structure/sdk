import type { LibraryDocument } from './contracts.js';

export interface LibraryTrustPolicy {
  readonly trustedProviderIds?: readonly string[];
  readonly trustedUriPrefixes?: readonly string[];
  readonly requireIntegrity?: boolean;
}

export interface LibraryTrustDecision {
  readonly trusted: boolean;
  readonly reasons: readonly string[];
}

export function evaluateLibraryTrust(providerId: string, document: LibraryDocument, policy: LibraryTrustPolicy): LibraryTrustDecision {
  const reasons: string[] = [];
  if (policy.trustedProviderIds && !policy.trustedProviderIds.includes(providerId)) reasons.push(`Provider '${providerId}' is not trusted.`);
  if (policy.trustedUriPrefixes && !policy.trustedUriPrefixes.some((prefix) => isLibraryUriWithin(document.uri, prefix))) reasons.push(`Document origin '${document.uri}' is not trusted.`);
  if (policy.requireIntegrity && !document.integrity) reasons.push('Document integrity metadata is required.');
  return { trusted: reasons.length === 0, reasons };
}

export function canonicalLibraryUri(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Library URI must not be empty.');
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error(`Library URI '${value}' must be absolute.`); }
  if (url.username || url.password) throw new Error('Library URIs must not contain credentials.');
  return url.href;
}

export function canonicalLibraryOrigin(value: string): string {
  const url = new URL(canonicalLibraryUri(value));
  return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
}

export function isSameLibraryUri(left: string, right: string): boolean {
  try { return canonicalLibraryUri(left) === canonicalLibraryUri(right); }
  catch { return false; }
}

export function isLibraryUriWithin(value: string, root: string): boolean {
  try {
    const candidate = new URL(canonicalLibraryUri(value));
    const parent = new URL(canonicalLibraryUri(root));
    if (candidate.protocol !== parent.protocol || candidate.host !== parent.host) return false;
    if (parent.search || parent.hash) return candidate.href === parent.href;
    const parentWithoutTrailingSlash = parent.pathname === '/' ? '/' : parent.pathname.replace(/\/+$/, '');
    const parentPath = parentWithoutTrailingSlash === '/' ? '/' : `${parentWithoutTrailingSlash}/`;
    return candidate.pathname === parent.pathname || candidate.pathname === parentWithoutTrailingSlash || candidate.pathname.startsWith(parentPath);
  } catch {
    return false;
  }
}