import { Entry } from '@napi-rs/keyring';

/** Read/write secrets (e.g. bank credentials) by an opaque account key. */
export interface SecretVault {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** Test/dev backend. Never persists — secrets vanish with the process. */
export class InMemoryVault implements SecretVault {
  private store = new Map<string, string>();
  async get(account: string) { return this.store.has(account) ? this.store.get(account)! : null; }
  async set(account: string, secret: string) { this.store.set(account, secret); }
  async delete(account: string) { this.store.delete(account); }
}

/**
 * Production backend: OS keychain (macOS Keychain / Windows Credential Manager / libsecret).
 *
 * Verified against @napi-rs/keyring v1.3.0: a missing entry makes getPassword() return null and
 * deletePassword() return false — neither throws for "not found". So we deliberately do NOT catch
 * here: a real failure (keychain locked, permission denied, no secret service) must propagate to the
 * caller, never be masked as "no credential stored" (which would re-prompt and could overwrite a
 * valid-but-temporarily-inaccessible credential).
 */
export class KeyringVault implements SecretVault {
  constructor(private service = 'kesef') {}
  private entry(account: string) { return new Entry(this.service, account); }
  async get(account: string): Promise<string | null> {
    return this.entry(account).getPassword();
  }
  async set(account: string, secret: string): Promise<void> {
    this.entry(account).setPassword(secret);
  }
  async delete(account: string): Promise<void> {
    this.entry(account).deletePassword();
  }
}
