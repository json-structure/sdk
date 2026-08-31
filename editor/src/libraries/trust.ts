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
  if (policy.trustedUriPrefixes && !policy.trustedUriPrefixes.some((prefix) => document.uri.startsWith(prefix))) reasons.push(`Document origin '${document.uri}' is not trusted.`);
  if (policy.requireIntegrity && !document.integrity) reasons.push('Document integrity metadata is required.');
  return { trusted: reasons.length === 0, reasons };
}