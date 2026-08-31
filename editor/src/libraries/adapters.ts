import { type SecretCredential } from './providers.js';

export interface CredentialSecretStore {
  getSecret(key: string): Promise<string | undefined>;
}

export interface TrustedProviderStore {
  isTrustedProvider(providerId: string): Promise<boolean>;
  isTrustedOrigin?(origin: string): Promise<boolean>;
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
    if (!await this.trust.isTrustedProvider(providerId)) return false;
    if (!this.trust.isTrustedOrigin) return true;
    return this.trust.isTrustedOrigin(originFromUrl(url));
  }
}

function originFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}