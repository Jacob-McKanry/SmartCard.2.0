import { handleAuth } from "@kinde-oss/kinde-auth-nextjs/server";

/**
 * Kinde's OAuth endpoints: `/api/auth/login`, `/api/auth/register`,
 * `/api/auth/logout` and `/api/auth/kinde_callback`.
 *
 * This is the whole of §5.1's "web (Next.js) — confidential client" flow. The
 * SDK redirects to Kinde, receives the authorization code on the callback, and
 * exchanges it for tokens **on the server** using `KINDE_CLIENT_SECRET`, then
 * writes the result into `HttpOnly` cookies (plaintext JWTs, not encrypted —
 * the SDK re-validates each against Kinde's JWKS on read). Nothing in that
 * sequence is reachable from browser JavaScript, which is why an XSS bug in
 * this app cannot steal a session.
 *
 * There is deliberately no custom logic here. Everything SmartCard-specific
 * about a login — resolving the Kinde identity to a `public.users` row, minting
 * the Supabase token — happens per request in `@/server/auth/current-user`,
 * not once at callback time. Doing it here would mean a user's database
 * identity was decided at login and then trusted for the life of a cookie.
 */
export const GET = handleAuth();
