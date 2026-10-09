import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Real, user-facing blocking (owner decision 4,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`) — the
 * service-layer half of `public.block_user` / `public.unblock_user` /
 * `public.list_my_blocks`
 * (`supabase/migrations/20261009130000_blocks_rpc_only_write_path.sql`).
 *
 * Before this, `blocks` had direct client INSERT/DELETE grants and no UI at
 * all. Writing a block is now RPC-only — this is the single TypeScript file
 * allowed to call `block_user`/`unblock_user`, asserted by
 * `no-second-write-path.test.ts`, matching every other security-relevant RPC
 * in this codebase.
 *
 * The caller's own RLS-bound client, never the service role: all three RPCs
 * are `security definer`, derive the caller from the JWT, and act only on
 * the caller's own blocks.
 *
 * NOT WIRED INTO THE LIVE APP YET. The Block button and blocked-users list
 * are built only under the admin-gated `/MapTest` route — see the amendment's §9.
 */

export interface BlockedPerson {
  blockedUserId: string;
  /** Null for a deleted account — see `list_my_blocks`'s own comment. */
  firstName: string | null;
  photoPath: string | null;
  blockedAt: string;
}

export type BlockRefusal = "not_authenticated" | "invalid_reason";

export class BlockRefusedError extends Error {
  constructor(readonly reason: BlockRefusal | string) {
    super(`The block could not be recorded (${reason}).`);
    this.name = "BlockRefusedError";
  }
}

/**
 * Blocks `targetUserId`. Returns normally (not an error) when the caller has
 * no real relationship with the target — see `block_user`'s own comment on
 * why that is `{ok:true}` rather than a refusal: the response must not be an
 * existence oracle. The only refusal a well-formed caller can see is
 * `invalid_reason` (over 500 characters), which depends only on their own input.
 */
export async function blockUser(
  supabase: SupabaseClient,
  targetUserId: string,
  reason?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("block_user", {
    p_target_user_id: targetUserId,
    p_reason: reason ?? null,
  });

  if (error) {
    throw new Error(`Failed to block: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error("block_user returned an answer this app does not recognise.");
  }

  if (!result.ok) {
    throw new BlockRefusedError(typeof result.reason === "string" ? result.reason : "unknown");
  }
}

/**
 * Removes the caller's own block on `targetUserId`. Does NOT restore any
 * connection the block removed — see `unblock_user`'s own comment.
 * `{ok:true}` whether or not a block existed, so this never throws for an
 * authenticated caller unblocking a stranger.
 */
export async function unblockUser(supabase: SupabaseClient, targetUserId: string): Promise<void> {
  const { data, error } = await supabase.rpc("unblock_user", { p_target_user_id: targetUserId });

  if (error) {
    throw new Error(`Failed to unblock: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error("unblock_user returned an answer this app does not recognise.");
  }

  if (!result.ok) {
    throw new BlockRefusedError(typeof result.reason === "string" ? result.reason : "unknown");
  }
}

/** The caller's own blocks, newest first. */
export async function listMyBlocks(supabase: SupabaseClient): Promise<BlockedPerson[]> {
  const { data, error } = await supabase.rpc("list_my_blocks");

  if (error) {
    throw new Error(`Failed to list blocked people: ${error.message}`, { cause: error });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    blockedUserId: String(row.blocked_user_id),
    firstName: typeof row.first_name === "string" ? row.first_name : null,
    photoPath: typeof row.photo_path === "string" ? row.photo_path : null,
    blockedAt: String(row.blocked_at),
  }));
}
