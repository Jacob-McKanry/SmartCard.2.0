/**
 * A stable, client-generated identifier used only to bind a QR session to the
 * device that created it (§4.7 threat 3) and, optionally, the device that
 * redeems one — `deviceId` in `qrSessionCreateRequestSchema` /
 * `qrRedeemRequestSchema` (`packages/types`), both optional and both bounded
 * to 128 characters server-side.
 *
 * NOT an identity, and not sensitive: it names a browser installation, never
 * a person, and the server never trusts it for anything beyond binding — it
 * plays no role in any of the nine checks in §4.2 step 5.
 *
 * `storage` is a minimal interface rather than `window.localStorage` directly
 * so this is testable without a DOM, and so a caller can substitute
 * `sessionStorage` or an in-memory stand-in if `localStorage` is unavailable
 * (private browsing in some browsers throws on access).
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "smartcard.connect.deviceId";

export function getOrCreateDeviceId(
  storage: KeyValueStorage,
  generateId: () => string = () => crypto.randomUUID(),
): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing !== null && existing.trim() !== "") {
    return existing;
  }

  const created = generateId();
  storage.setItem(STORAGE_KEY, created);
  return created;
}
