/** Typed HTTP client for `/api/v1/feed`, matching `apps/web/src/app/api/v1/feed/route.ts`. */
import { feedResponseSchema, type FeedItem } from "@smartcard/types";

import { requestApiV1, type ApiV1Options } from "./http";

/** `GET /api/v1/feed`. */
export async function getFeed(opts: ApiV1Options = {}): Promise<FeedItem[]> {
  const result = await requestApiV1(
    "GET",
    "/api/v1/feed",
    undefined,
    (json) => feedResponseSchema.parse(json),
    opts,
  );
  return result.items;
}
