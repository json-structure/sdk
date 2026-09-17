import { type SecretCredential } from './providers.js';
import { canonicalLibraryOrigin, canonicalLibraryUri } from './trust.js';

export interface CredentialSecretStore {
  getSecret(key: string): Promise<string | undefined>;
}

export interface TrustedProviderStore {
  isTrustedProvider(providerId: string): Promise<boolean>;
  isTrustedOrigin?(origin: string): Promise<boolean>;
  isTrustedUri?(providerId: string, uri: string): Promise<boolean>;
}

export interface CredentialStoreEntry {
  readonly credentialId: string;
  readonly scheme: string;
  readonly secretRef: string;
}

export interface CredentialAdapter {
  get(credentialId: string): Promise<SecretCredential | undefined>;
}

export class SecretStorageCredentialAdapter implements CredentialAdapter {
  private readonly entries: ReadonlyMap<string, CredentialStoreEntry>;

  constructor(entries: readonly CredentialStoreEntry[], private readonly secrets: CredentialSecretStore) {
    this.entries = new Map(entries.map((entry) => [entry.credentialId, entry]));
  }

  async get(credentialId: string): Promise<SecretCredential | undefined> {
    const entry = this.entries.get(credentialId);
    if (!entry) return undefined;
    const secret = await this.secrets.getSecret(entry.secretRef);
    if (!secret || !secret.trim()) return undefined;
    return { scheme: entry.scheme, secret };
  }
}

export interface TrustAdapter {
  isTrusted(providerId: string, url: string): Promise<boolean>;
}

export class PolicyTrustAdapter implements TrustAdapter {
  constructor(private readonly trust: TrustedProviderStore) {}

  async isTrusted(providerId: string, url: string): Promise<boolean> {
    let uri: string;
    try { uri = canonicalLibraryUri(url); }
    catch { return false; }
    if (!await this.trust.isTrustedProvider(providerId)) return false;
    if (this.trust.isTrustedOrigin && !await this.trust.isTrustedOrigin(canonicalLibraryOrigin(uri))) return false;
    return !this.trust.isTrustedUri || this.trust.isTrustedUri(providerId, uri);
  }
}
