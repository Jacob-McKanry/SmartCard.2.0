import { redeemQr } from "@/server/connect/connect-service";
import { connectErrorResponse, readAuthenticatedRequest } from "@/server/connect/route-helpers";

/**
 * `POST /api/connect/qr/redeem` — §4.2 steps 4 to 7. The scan endpoint.
 *
 * Bob scans Alice's code, takes a fresh high-accuracy fix, and posts
 * `{ token, scannerLocation, deviceId }` with his auth. The nine validation
 * steps of §4.2 step 5 run inside `createQrVerifier`, in that exact order, with
 * nothing skipped and nothing reordered — see `qr-verifier.ts`, which repeats
 * the list as a checklist so a reader can confirm it without reading the whole
 * function.
 *
 * TWO PROPERTIES OF THIS ENDPOINT THAT A READER SHOULD NOT HAVE TO INFER
 *
 *  1. **The scanner is the authenticated caller, always.** There is no field in
 *     `qrRedeemRequestSchema` for a user id, and the presenter is resolved from
 *     the session the token names — never from anything Bob sent. That is what
 *     makes "connect me to whoever I say" unrepresentable at the API surface,
 *     one layer above the type-level guarantee in §4.1 that makes it
 *     unrepresentable in code.
 *
 *  2. **Every response is the same shape and says almost nothing.** A success
 *     returns two ids. A failure returns one sentence and no reason code, no
 *     distance, no radius, and nothing about where Alice is (§4.2 step 7). The
 *     real reason and the real numbers go to `connection_attempts`, which has
 *     no read policy for anyone (§3.5). This matters more than it looks: if a
 *     rejection returned the computed distance, anyone holding a valid token
 *     could stand in three places and trilaterate Alice's position to within
 *     metres — a people-finder inside a product whose entire premise is that it
 *     has none.
 *
 * A refusal is HTTP 200 with `{ ok: false }`, not a 4xx. The request was
 * well-formed and was processed; the answer is no. Reserving status codes for
 * transport-level problems keeps a rejection from being distinguishable by
 * status alone, which is the same reasoning as (2) applied to the response
 * envelope. Rate limiting is the exception — it returns 429 from
 * `ConnectRefusedError`, because that one genuinely is "try again later" and a
 * client needs to be able to tell.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx, body } = await readAuthenticatedRequest(request);
    const response = await redeemQr(ctx, body);
    return Response.json(response);
  } catch (error) {
    return connectErrorResponse(error, "qr/redeem");
  }
}
