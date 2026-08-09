// packages/core will hold platform-independent business logic shared by
// apps/web and apps/mobile: GPS distance calculation, the connection-
// verification interface (§4.1 of the architecture proposal), feed
// visibility rules, and meeting location-sharing rules. It stays free of
// React, network calls, and database access so it can be unit-tested in
// isolation and imported unchanged by both a server and a phone.
//
// This placeholder only proves the workspace wiring (apps -> packages/core)
// resolves correctly; the next phase replaces it with real logic.
export function placeholder(): string {
  return "@smartcard/core placeholder";
}
