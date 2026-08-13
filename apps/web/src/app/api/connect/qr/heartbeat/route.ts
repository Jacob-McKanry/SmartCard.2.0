import { heartbeatQrSession } from "@/server/connect/connect-service";
import { connectErrorResponse, readAuthenticatedRequest } from "@/server/connect/route-helpers";

/**
 * `POST /api/connect/qr/heartbeat` — §4.2 step 3, and step 2's rotation.
 *
 * While the code is on screen the presenter's app posts a fresh GPS fix here
 * every ~20 seconds, and receives the token to display in return. This one
 * endpoint does both jobs, and that is a deliberate design decision documented
 * in full on `createQrSession` in `connect-service.ts`. The short version: the
 * nonce only rotates when a fresh location arrives, so a presenter cannot keep
 * displaying current codes while their location goes stale — the two freshness
 * properties the GPS gate depends on become one property that cannot be
 * half-satisfied.
 *
 * The presenter's own fix is written straight to `connection_sessions`, where
 * only they can read it back (20260809211200 gives them a SELECT policy on
 * their own sessions and nobody else one). The person who eventually scans
 * never sees it: the row carries the presenter's coordinates, and handing those
 * to a scanner would give away a position the product never promised to share.
 *
 * WHAT HAPPENS IF THIS STOPS BEING CALLED, WHICH IS THE POINT
 * The heartbeat stopping is not an error state to route around — it is the
 * mechanism. A backgrounded app, a denied location permission or a dead signal
 * all mean the presenter's last fix ages past
 * `presenter_location_max_age_seconds` and every scan against the session is
 * rejected as stale (§4.3). That is the direct, necessary consequence of
 * defeating the live-video-relay attack (§4.7 threat 2), and its UX cost is
 * flagged for pilot observation as Q8.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx, body } = await readAuthenticatedRequest(request);
    const response = await heartbeatQrSession(ctx, body);
    return Response.json(response);
  } catch (error) {
    return connectErrorResponse(error, "qr/heartbeat");
  }
}
