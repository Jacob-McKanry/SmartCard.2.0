import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getOwnProfile } from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { initialsFor } from "../connections/lib/format";
import { ConnectToggle } from "./connect-toggle";

/**
 * `/connect` — the single entry point for the QR half of Connect Flow.
 * Used to be two pages (`/connect/present`, `/connect/scan`); see
 * `connect-toggle.tsx` for why this is now one screen with an in-place
 * toggle instead. The auth gate for this whole group lives in
 * `(app)/layout.tsx`; this page re-derives the caller's context anyway,
 * because it needs their own `supabase`/`userId` for the query below (that
 * call is `cache()`-memoized per request, so this is not a second
 * verify-and-mint).
 *
 * NFC has no equivalent screen here on purpose — a tapped card redeems
 * itself via `/card/[code]`, which needs no UI of its own to get to.
 *
 * WHY THIS SERVER COMPONENT NOW READS THE CALLER'S OWN PROFILE
 *
 * `docs/design/DESIGN.md` §6 makes the success payoff a two-sided flourish:
 * the two people's rings slide in from opposite sides and settle. One of
 * those sides is the signed-in person, and the client half of Connect has no
 * way to know their own initials or photo — every screen that has needed them
 * so far was a Server Component. Reading them here and passing them down
 * keeps that a server-side, RLS-bound read of the caller's *own* row
 * (`getOwnProfile` takes no "whose profile" argument; see its header) rather
 * than something the browser asks for later.
 *
 * The photo URL is minted here for the same reason it is everywhere else:
 * `signedProfilePhotoUrl` is the only sanctioned way a `photo_path` becomes
 * loadable, and it signs through the caller's own client so the Storage
 * policy is still what decides.
 */
export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const profile = await getOwnProfile(supabase, userId);
  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photo_path);

  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-col items-center px-[22px] pt-4 pb-6 sm:px-7">
      {/*
       * §6's Connect screen opens straight onto the segmented toggle — there
       * is no visible page title, because the dock already says where you
       * are and the screen is a single task. The heading still exists for
       * anyone navigating by landmark or headings list (§8).
       */}
      <h1 className="sr-only">Connect</h1>
      <div style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }} className="w-full">
        <ConnectToggle
          viewer={{ initials: initialsFor(profile), photoUrl }}
        />
      </div>
    </main>
  );
}
