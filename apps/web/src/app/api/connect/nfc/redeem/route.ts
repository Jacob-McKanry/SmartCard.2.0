import { redeemNfc } from "@/server/connect/connect-service";
import { connectErrorResponse, readAuthenticatedRequest } from "@/server/connect/route-helpers";

/**
 * `POST /api/connect/nfc/redeem` — §4.5 step 3. The card-tap endpoint.
 *
 * The phone reads `https://smartcard.tech/card/<code>` off the tag, opens it
 * through a universal/app link (§7.3 — note it must be `smartcard.tech`, the
 * domain physically baked into 7,142 pieces of existing inventory), and the app
 * posts the code here with the tapper's auth.
 *
 * THE CLIENT'S CLAIMED OWNER IS NEVER TRUSTED. The request carries one field.
 * The owner is resolved server-side from `cards.card_code`, and the request
 * schema has no slot for an owner id at all.
 *
 * NO GPS GATE, AND THAT IS NOT A WEAKER RULE. NFC's read range is a few
 * centimetres, so physical range IS the proximity proof — and a better one than
 * GPS, because it cannot be spoofed from another city by a rooted phone.
 *
 * A TAP MAY STILL PRODUCE A `meeting_locations` ROW, SINCE 2026-08-28 — SEE
 * `nfc-verifier.ts`'S HEADER FOR WHY THAT IS NOT THE SAME THING AS A GATE.
 * `nfcRedeemRequestSchema.location` is optional, never checked against
 * anything, and never able to change whether this endpoint accepts or refuses
 * a tap — it exists purely so a connection made by tapping can carry the same
 * kind of cosmetic "met at ___" label a QR-verified one already does. Absence
 * (no fix offered, denied, or the client's short best-effort window elapsing)
 * still produces no row, exactly as every tap did before this field existed.
 *
 * WHAT DEFENDS A STOLEN CARD, STATED PLAINLY (§4.7 threat 7). Nothing on this
 * path prevents it. Whoever holds the card can connect to its owner, and Q17
 * decided against a confirmation step because an owner glancing at a prompt
 * cannot tell a legitimate tap from a stolen-card tap any better in the moment
 * than afterwards — while the prompt would break the one thing a card is good
 * at (working when handed over, or left on a table). The defence is detection
 * latency: the owner is pushed a notification the instant the tap commits, with
 * revoke-card one tap away, plus the per-card rate limit capping the damage
 * before they react. Connections created between the theft and the revocation
 * are real connections and stay until the owner removes them — a consciously
 * accepted residual.
 *
 * THE NOTIFICATION IS FIRED SERVER-SIDE, AFTER THE COMMIT, AND CANNOT FAIL IT.
 * Server-side because a client-triggered notification lets the tapper suppress
 * the owner's alert by dropping the call. After the commit because §4.5's
 * amendment is explicit that a failed or delayed push must never block, delay
 * or reverse the connection — the one place in this flow that deliberately does
 * not fail closed, because physical possession is the proof and there is
 * nothing left to verify.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx, body } = await readAuthenticatedRequest(request);
    const response = await redeemNfc(ctx, body);
    return Response.json(response);
  } catch (error) {
    return connectErrorResponse(error, "nfc/redeem");
  }
}
