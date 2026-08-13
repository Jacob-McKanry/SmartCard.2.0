import { createQrSession } from "@/server/connect/connect-service";
import { connectErrorResponse, readAuthenticatedRequest } from "@/server/connect/route-helpers";

/**
 * `POST /api/connect/qr/session` — §4.2 step 1.
 *
 * Alice opens "Connect". This creates her `connection_sessions` row
 * (`status='active'`, `expires_at = now + session_max_lifetime_seconds`, a
 * random `current_nonce`, her `device_id`) and returns the first signed token
 * for her screen to display.
 *
 * The presenter is the authenticated caller and nothing else. There is no
 * field in the request for a presenter id, and `createQrSession` takes the id
 * from `RequestContext`, which comes from `getAuthenticatedContext()` — so a
 * session can only ever be created for the person who asked for it.
 *
 * There is no GET on this route. A session is a state-changing thing to create
 * and only POST is unambiguously non-cacheable; a GET that mints sessions would
 * also be triggerable by a link or an image tag on someone else's page.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx, body } = await readAuthenticatedRequest(request);
    const response = await createQrSession(ctx, body);
    return Response.json(response, { status: 201 });
  } catch (error) {
    return connectErrorResponse(error, "qr/session");
  }
}
