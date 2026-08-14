import Link from "next/link";
import { redirect } from "next/navigation";
import { QrCode } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getOwnProfile } from "@/server/profile/profile-service";
import { listOwnConnections } from "@/server/connections/connections-service";
import { Button } from "@/components/ui/button";

/**
 * The real home screen, replacing the placeholder that shipped with the
 * initial scaffold (see the removed `SmartCard — under construction` copy —
 * that page's whole job was proving the pnpm workspace wired up before any
 * feature existed to prove it, same reason `/auth-check` existed and was
 * retired once Profile landed).
 *
 * WHY THIS STAYS DELIBERATELY SPARSE
 *
 * `/feed`'s header already lays out this product's stance on padding a
 * screen with filler: "the feed is intentionally sparse... do not pad it
 * with suggestions or algorithmic content." Home follows the same rule.
 * There is exactly one action a person opening this app is most often here
 * to take — connect with whoever's in front of them — so that's the one
 * thing given real visual weight. Everything else (the feed, the full
 * connections list) already has its own nav destination one tap away; a
 * feed preview here would just be a second, smaller copy of `/feed`.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const [profile, connections] = await Promise.all([
    getOwnProfile(supabase, userId),
    listOwnConnections(supabase, userId),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 p-6 text-center sm:p-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {profile.first_name ? `Hey, ${profile.first_name}` : "SmartCard"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {connections.length === 0
            ? "No connections yet — tap a card or scan a code to make your first one."
            : `${connections.length} connection${connections.length === 1 ? "" : "s"}, all made in person.`}
        </p>
      </div>

      <Button asChild size="lg" className="h-14 gap-2 px-8 text-base">
        <Link href="/connect">
          <QrCode className="size-5" />
          Connect
        </Link>
      </Button>
    </main>
  );
}
