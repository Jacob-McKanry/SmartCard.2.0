import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import type { FeedItem, MutualFeedItem, ParticipantFeedItem } from "@/server/feed/feed-service";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { displayName, formatOccurredAt, initialsFor, verificationMethodLabel } from "./lib/format";

/**
 * Renders one feed row. Which of the two shapes appears was already decided
 * server-side by `classifyFeedMeeting` (`../feed/classify.ts`) before this
 * component ever sees the item — this file only knows how to draw the two
 * shapes, not how to tell them apart.
 *
 * WHY THE PARTICIPANT ROW IS A LINK AND THE MUTUAL ROW IS NOT
 *
 * A participant row links to `/connections/[connectionId]` — the existing
 * meeting-record view (README build order item 3) — because that page
 * already has the location-sharing controls, the removal control, and the
 * full record; duplicating any of that here was explicitly out of scope. A
 * mutual row has nowhere to link to: the viewer isn't a party to that edge,
 * has no `connections` row for it, and the task brief is explicit that this
 * feature adds no consent/removal UI for meetings the viewer didn't attend.
 * So it renders as plain content, not a dead or misleading link.
 */
export async function FeedItemCard({
  item,
  supabase,
}: {
  item: FeedItem;
  supabase: SupabaseClient;
}) {
  if (item.kind === "participant") {
    return <ParticipantRow item={item} supabase={supabase} />;
  }
  return <MutualRow item={item} supabase={supabase} />;
}

async function ParticipantRow({
  item,
  supabase,
}: {
  item: ParticipantFeedItem;
  supabase: SupabaseClient;
}) {
  const name = displayName(item.otherUser);
  const photoUrl = await signedProfilePhotoUrl(supabase, item.otherUser.photo_path);

  return (
    <li>
      <Link
        href={`/connections/${item.connectionId}`}
        className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-accent"
      >
        <Avatar>
          <AvatarImage src={photoUrl ?? undefined} alt="" />
          <AvatarFallback>{initialsFor(item.otherUser)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">You met {name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {verificationMethodLabel(item.verificationMethod)} &middot; {formatOccurredAt(item.occurredAt)}
          </p>
          {item.location ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {item.location.place_label ?? "Location captured, no place name on file."}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

async function MutualRow({ item, supabase }: { item: MutualFeedItem; supabase: SupabaseClient }) {
  const nameA = displayName(item.userA);
  const nameB = displayName(item.userB);
  const [photoA, photoB] = await Promise.all([
    signedProfilePhotoUrl(supabase, item.userA.photo_path),
    signedProfilePhotoUrl(supabase, item.userB.photo_path),
  ]);

  return (
    <li className="flex items-start gap-3 rounded-md border border-border p-3">
      <div className="flex -space-x-3">
        <Avatar className="ring-2 ring-background">
          <AvatarImage src={photoA ?? undefined} alt="" />
          <AvatarFallback>{initialsFor(item.userA)}</AvatarFallback>
        </Avatar>
        <Avatar className="ring-2 ring-background">
          <AvatarImage src={photoB ?? undefined} alt="" />
          <AvatarFallback>{initialsFor(item.userB)}</AvatarFallback>
        </Avatar>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {nameA} met {nameB}
        </p>
        <p className="truncate text-sm text-muted-foreground">{formatOccurredAt(item.occurredAt)}</p>
        {item.location ? (
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {item.location.place_label ?? "Location shared, no place name on file."}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          You&rsquo;re connected to both {nameA} and {nameB}
        </p>
      </div>
    </li>
  );
}
