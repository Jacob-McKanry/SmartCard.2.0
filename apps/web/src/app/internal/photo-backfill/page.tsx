import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { supabasePublishableKey, supabaseUrl } from "@/server/env";

import { ELIGIBLE_PHOTOS } from "./eligible-photos";
import { PhotoBackfillUploader } from "./photo-backfill-uploader";

/**
 * TEMPORARY. Deleted, along with this whole directory, once the one-time
 * legacy photo backfill (architecture doc §6.5's deferred-photos deviation)
 * is done and verified. Not linked from anywhere — nav, home screen, sign-in
 * flow — reachable only by whoever is told this exact URL.
 *
 * WHY "SIGNED IN AND is_admin", NOT A SEPARATE SECRET TOKEN
 *
 * This needed *some* gate beyond "knows the URL": the previous attempt at
 * this same backfill (20260813180402/20260813180755) had to abandon the
 * upload entirely because this session's own network egress to Supabase is
 * blocked, so this pass runs the upload from the signed-in owner's own
 * browser instead — which means whoever loads this page already has to be
 * signed in as the one account this project's schema marks `is_admin`
 * (confirmed: exactly one such row, the project owner's). That is a real,
 * already-existing, RLS-honest fact about who they are, not a new secret to
 * mint, store in an env var, and remember to rotate — see `current-user.ts`
 * for why this project treats a real credential as strictly better than an
 * invented one wherever a real one is available. Fails the same way as
 * everywhere else in this codebase: no distinguishing error for "not signed
 * in" vs. "signed in but not admin", both just redirect away.
 *
 * WHAT THIS PAGE CAN AND CANNOT DO
 *
 * It cannot, by itself, write anything — `PhotoBackfillUploader` calls the
 * Storage HTTP API directly with the public anon/publishable key, exactly
 * the credential every page already ships to every visitor's browser. What
 * actually authorizes those writes is the temporary, user-id-scoped RLS
 * window opened by `20260814000100_temp_photo_migration_upload_policy_v2.sql`
 * — this page has no more privilege than that migration currently grants,
 * admin gate or not, and once that migration is revoked this page (even
 * left running) can no longer write anything either.
 */
export const dynamic = "force-dynamic";

export default async function PhotoBackfillPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  const { data, error } = await context.supabase
    .from("users")
    .select("is_admin")
    .eq("id", context.userId)
    .single();

  if (error || !data?.is_admin) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Legacy photo backfill</h1>
        <p className="text-sm text-muted-foreground">
          Temporary tool. Select the local <code>profiles</code> folder from the legacy export (or any
          parent folder that contains it) — matching files upload straight to Supabase Storage from your
          browser, then tell Claude when it&rsquo;s done so the database can be updated and this page
          removed.
        </p>
      </header>
      <PhotoBackfillUploader
        rows={ELIGIBLE_PHOTOS}
        supabaseUrl={supabaseUrl()}
        anonKey={supabasePublishableKey()}
      />
    </main>
  );
}
