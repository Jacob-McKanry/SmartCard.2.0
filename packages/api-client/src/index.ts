// packages/api-client holds typed functions for calling our API (§1.7 of the
// architecture proposal): mobile calls these over HTTP against Next.js Route
// Handlers, web calls them directly from Client Components where the loop is
// inherently client-side (camera, geolocation, polling — see `connect.ts`'s
// header for why that is not a Server Action). Depends on packages/types so
// every request/response is validated against the same Zod schemas that
// mirror the routes themselves.
import { userStatusSchema } from "@smartcard/types";

export {
  ConnectApiError,
  createQrSession,
  heartbeatQrSession,
  redeemQr,
  type ConnectApiOptions,
} from "./connect";

// Placeholder only, to prove the workspace wiring
// (apps -> packages/api-client -> packages/types) resolves correctly. It parses
// against a real schema now that packages/types mirrors the database, rather
// than against a stand-in object shape.
export function placeholder(): string {
  return userStatusSchema.parse("active");
}
