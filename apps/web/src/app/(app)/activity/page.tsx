import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  listCardTapActivity,
  listOwnAssignedCards,
  type CardTapActivityItem,
} from "@/server/activity/activity-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { displayName, formatOccurredAt, initialsFor } from "../connections/lib/format";
import { RemoveConnectionInline } from "./remove-connection-inline";
import { RevokeCard } from "./revoke-card";

/**
 * The Activity page — Q28's in-app "tapped your card" record (architecture
 * §9, §4.5's amendment).
 *
 * WHY THIS EXISTS ON TOP OF THE PUSH NOTIFICATION
 *
 * Q17 made a card tap connect instantly, with no confirmation step, because
 * requiring one breaks the one thing a physical card is good at. §4.7 threat
 * 7 is explicit about what that trade costs: the last preventive control on
 * the NFC path is gone, so detection is the only thing left, and it has to
 * work even for someone who missed or disabled the push. This page is that
 * second, always-available path — the same information the push carries,
 * plus the same revoke-card / remove-connection actions the push deep-links
 * to, but reachable any time by opening the app.
 *
 * Deliberately not "Events UI": nothing here is an Events screen, so this
 * doesn't fall under the project owner's standing "no Events screens without
 * being asked" instruction — Connect/Connections have always been fair game.
 */
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const [activity, cards] = await Promise.all([
    listCardTapActivity(supabase, userId),
    listOwnAssignedCards(supabase, userId),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Every time one of your cards was tapped, in case you missed the push notification.
        </p>
      </header>

      {cards.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Your cards</h2>
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <span className="truncate text-sm font-medium">{card.card_code}</span>
                <RevokeCard cardId={card.id} cardCode={card.card_code} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent taps</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has tapped your card yet — when they do, it&rsquo;ll show up here even if you miss
            the push notification.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activity.map((item) => (
              <ActivityRow key={item.sessionId} item={item} supabase={supabase} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

async function ActivityRow({
  item,
  supabase,
}: {
  item: CardTapActivityItem;
  supabase: SupabaseClient;
}) {
  const name = displayName(item.tapper);
  const photoUrl = await signedProfilePhotoUrl(supabase, item.tapper.photo_path);

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={photoUrl ?? undefined} alt="" />
          <AvatarFallback>{initialsFor(item.tapper)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{name} tapped your card</div>
          <div className="truncate text-sm text-muted-foreground">{formatOccurredAt(item.consumedAt)}</div>
        </div>
      </div>
      {item.connectionId !== null && (
        <RemoveConnectionInline connectionId={item.connectionId} otherName={name} />
      )}
    </li>
  );
}
