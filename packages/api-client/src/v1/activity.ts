/**
 * Typed HTTP client for `/api/v1/activity`, `/api/v1/cards/claim` and
 * `/api/v1/cards/[cardId]/revoke`, matching
 * `apps/web/src/app/api/v1/activity/route.ts` and
 * `apps/web/src/app/api/v1/cards/**`.
 */
import {
  activityResponseSchema,
  cardCodeSchema,
  type CardPreviewActivityItem,
  type CardRow,
  type CardTapActivityItem,
} from "@smartcard/types";

import { parseOk, requestApiV1, type ApiV1Options } from "./http";

export interface ActivityLists {
  taps: CardTapActivityItem[];
  previews: CardPreviewActivityItem[];
  cards: Pick<CardRow, "id" | "card_code">[];
}

/** `GET /api/v1/activity` — the three lists `(app)/activity/page.tsx` renders together. */
export async function getActivity(opts: ApiV1Options = {}): Promise<ActivityLists> {
  const { taps, previews, cards } = await requestApiV1(
    "GET",
    "/api/v1/activity",
    undefined,
    (json) => activityResponseSchema.parse(json),
    opts,
  );
  return { taps, previews, cards };
}

/**
 * `POST /api/v1/cards/claim`. `claimUnassignedCard`'s own contract is that an
 * unknown code, a revoked one, and one somebody else already owns are all
 * indistinguishable on purpose (`CardClaimResult`'s header in
 * `card-claim-service.ts`) — a refusal here throws `ApiV1Error` with that one
 * shared message, the same as any other mutation in this package, rather
 * than returning a reason a caller could branch on.
 */
export async function claimCard(code: string, opts: ApiV1Options = {}): Promise<void> {
  const parsedCode = cardCodeSchema.parse(code);
  await requestApiV1("POST", "/api/v1/cards/claim", { code: parsedCode }, parseOk, opts);
}

/** `POST /api/v1/cards/[cardId]/revoke` — the lost-or-stolen-card kill switch. */
export async function revokeCard(cardId: string, opts: ApiV1Options = {}): Promise<void> {
  await requestApiV1("POST", `/api/v1/cards/${encodeURIComponent(cardId)}/revoke`, undefined, parseOk, opts);
}
