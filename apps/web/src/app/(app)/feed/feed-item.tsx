import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import type { FeedItem, MutualFeedItem, ParticipantFeedItem } from "@/server/feed/feed-service";
import { BlurUpPhoto } from "@/components/blur-up-photo";

import { LocalTimestamp } from "@/components/local-timestamp";

import { displayName, initialsFor, verificationMethodLabel } from "./lib/format";

/**
 * One feed card, ported from `docs/design/prototypes/SmartCard 2.0.dc.html`
 * (`data-screen-label="Feed"`) against `docs/design/DESIGN.md` §6.
 *
 * Which of the two shapes appears was already decided server-side by
 * `classifyFeedMeeting` (`./classify.ts`) before this component sees the item —
 * this file only knows how to draw the two shapes, not how to tell them apart.
 *
 * WHY EVERY CARD IS THE EDITORIAL VARIANT
 *
 * §6 describes two: "Photo posts are full-bleed with a glass caption panel
 * floating over the image; meta-only posts are spacious editorial cards with no
 * forced placeholder." Only the second is built, because the first has nothing
 * to be full-bleed *of* — a meeting carries no photo in this schema, and an
 * open photo feed is on CLAUDE.md's explicitly-out-of-scope list. The prototype
 * fills that half of the design with a striped placeholder block; rendering that
 * here would be exactly the "forced placeholder" §6 rules out, and §5's
 * placeholder treatment is for imagery a layout genuinely needs and is missing,
 * not for imagery the product does not have. If meeting photos ever exist, the
 * photo variant belongs in this file, and the shared glass container is already
 * the one §6 asks both variants to sit in.
 *
 * WHY THE PARTICIPANT CARD IS A LINK AND THE MUTUAL CARD IS NOT
 *
 * A participant card links to `/connections/[connectionId]` — the existing
 * meeting-record view — because that page already holds the location controls,
 * the removal control and the full record. A mutual card has nowhere to link
 * to: the viewer is not a party to that edge, has no `connections` row for it,
 * and this feature adds no consent or removal UI for meetings the viewer did
 * not attend. §6 requires that it "link nowhere and say why", so it renders as
 * plain content with a sentence explaining the absence rather than as a dead
 * control.
 *
 * WHY THE WHOLE CARD IS THE TAP TARGET
 *
 * The prototype draws a 32px circular arrow button at the right of a linkable
 * row. 32px is below §8's 44px floor, so here the arrow is decoration
 * (`aria-hidden`) and the card itself is the link: one larger target, one
 * accessible name, and no second focus stop leading to the same place.
 */
export async function FeedItemCard({
  item,
  supabase,
}: {
  item: FeedItem;
  supabase: SupabaseClient;
}) {
  if (item.kind === "participant") {
    return <ParticipantCard item={item} supabase={supabase} />;
  }
  return <MutualCard item={item} supabase={supabase} />;
}

async function ParticipantCard({
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
        className="block overflow-hidden rounded-[26px] border transition-transform duration-300 hover:-translate-y-0.5"
        style={cardSurface}
      >
        <div className="flex items-start gap-3.5 p-[18px]">
          <AvatarDisc initials={initialsFor(item.otherUser)} photoUrl={photoUrl} />
          <div className="min-w-0 flex-1">
            <p
              className="text-[16px] leading-[21px] font-semibold"
              style={{ letterSpacing: "-.01em" }}
            >
              You met {name}
            </p>
            <p
              className="mt-0.5 text-[13px] leading-[18px]"
              style={{ color: "var(--sc-text-muted)" }}
            >
              {verificationMethodLabel(item.verificationMethod)} &middot;{" "}
              <LocalTimestamp iso={item.occurredAt} />
            </p>
            <EventLine event={item.event} />
            <PlaceLine
              label={item.location?.place_label ?? null}
              hasLocation={item.location !== null}
            />
            <span
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] leading-[14px] font-semibold"
              style={{ background: "var(--sc-accent-tint)", color: "var(--sc-accent-deep)" }}
            >
              <ShieldCheck size={12} strokeWidth={2.4} aria-hidden />
              Verified in person
            </span>
          </div>
          <ArrowRight
            size={18}
            strokeWidth={2}
            aria-hidden
            className="mt-0.5 shrink-0"
            style={{ color: "var(--sc-accent)" }}
          />
        </div>
      </Link>
    </li>
  );
}

async function MutualCard({ item, supabase }: { item: MutualFeedItem; supabase: SupabaseClient }) {
  const nameA = displayName(item.userA);
  const nameB = displayName(item.userB);
  const [photoA, photoB] = await Promise.all([
    signedProfilePhotoUrl(supabase, item.userA.photo_path),
    signedProfilePhotoUrl(supabase, item.userB.photo_path),
  ]);

  return (
    <li className="overflow-hidden rounded-[26px] border" style={cardSurface}>
      <div className="flex items-start gap-3.5 p-[18px]">
        <span className="flex shrink-0">
          <AvatarDisc initials={initialsFor(item.userA)} photoUrl={photoA} ringed />
          <AvatarDisc
            initials={initialsFor(item.userB)}
            photoUrl={photoB}
            ringed
            className="-ml-3.5"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[16px] leading-[21px] font-semibold"
            style={{ letterSpacing: "-.01em" }}
          >
            {nameA} met {nameB}
          </p>
          <p className="mt-0.5 text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
            <LocalTimestamp iso={item.occurredAt} />
          </p>
          <EventLine event={item.event} />
          <PlaceLine
            label={item.location?.place_label ?? null}
            hasLocation={item.location !== null}
          />
          {/*
           * §6: a mutual card must "link nowhere and say why". This is the why.
           * At --sc-text-muted rather than --sc-text-subtle because §2 reserves
           * subtle for decoration and this sentence states a rule.
           */}
          <p
            className="mt-2.5 text-[12px] leading-4"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            You&rsquo;re connected to both {nameA} and {nameB}. You weren&rsquo;t at this meeting, so
            there&rsquo;s no record of it for you to open.
          </p>
        </div>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- fragments */

/**
 * "at [event]" when the meeting was tagged to an event the viewer may see.
 *
 * Absent in two entirely ordinary cases that `feed-service.ts` documents and
 * deliberately does not distinguish: the meeting was never tagged to an event,
 * or it was tagged to a private event this viewer cannot see. Both mean "no
 * event line", and neither is an error.
 */
function EventLine({ event }: { event: { title: string } | null }) {
  if (event === null) return null;
  return (
    <p className="mt-1 text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
      at {event.title}
    </p>
  );
}

/**
 * Where the meeting happened, when the viewer is entitled to know.
 *
 * §7: "No location shown" is normal, gets no error styling and no nudge — so the
 * *absence* of a location row renders nothing at all, not a greyed-out
 * placeholder and not a prompt to switch something on. The one case that does
 * get a line is a location row that exists with no `place_label`: reverse
 * geocoding is allowed to fail (see `server/connect/geocode.ts`), and saying
 * "location captured, no place name" is more honest than a blank where a venue
 * name goes.
 */
function PlaceLine({ label, hasLocation }: { label: string | null; hasLocation: boolean }) {
  if (!hasLocation) return null;
  return (
    <p
      className="mt-2 flex items-center gap-1.5 text-[12px] leading-4 font-medium"
      style={{ color: "var(--sc-text-muted)" }}
    >
      <MapPin size={13} strokeWidth={2} aria-hidden className="shrink-0" />
      {label ?? "Location captured, no place name on file"}
    </p>
  );
}

/**
 * A person's disc: their photo blurring up over their initials, or just their
 * initials. No photo is a normal state and not a degraded one — `RingCentre` in
 * `components/ring-diagram.tsx` takes the same position for the same reason.
 */
function AvatarDisc({
  initials,
  photoUrl,
  ringed = false,
  className,
}: {
  initials: string;
  photoUrl: string | null;
  ringed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold ${className ?? ""}`}
      style={{
        background: "linear-gradient(140deg, rgba(11,96,255,.16), rgba(124,58,237,.14))",
        lineHeight: 1,
        boxShadow: ringed ? "0 0 0 2.5px rgba(255,255,255,.9)" : undefined,
      }}
    >
      <span aria-hidden>{initials}</span>
      {photoUrl ? (
        <BlurUpPhoto src={photoUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}

/**
 * §6: "Both share the same rounded glass container so a mixed feed reads as one
 * system." One object used by both card shapes, so they cannot drift apart.
 */
const cardSurface = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  borderColor: "var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
  transitionTimingFunction: "var(--sc-ease-spring)",
} as const;
