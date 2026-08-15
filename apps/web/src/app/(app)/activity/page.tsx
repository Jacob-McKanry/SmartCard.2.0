import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bell } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  listCardPreviewActivity,
  listCardTapActivity,
  listOwnAssignedCards,
  type CardPreviewActivityItem,
  type CardTapActivityItem,
} from "@/server/activity/activity-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { LocalTimestamp } from "@/components/local-timestamp";

import { displayName, initialsFor } from "../connections/lib/format";
import { AvatarDisc } from "../connections/lib/avatar-disc";
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
 *
 * ---------------------------------------------------------------------------
 * DESIGN PASS — WHY THIS SCREEN IS THE PLAIN ONE
 *
 * `docs/design/DESIGN.md` §2 singles Activity out: opaque
 * `rgba(255,255,255,.82)`, `14px` radius, a hairline border, and **no blur**,
 * because "it must read as a security log, not a celebration". That is a
 * functional requirement rather than a taste one, and it is why this file
 * does not use the glass panel style the rest of this pass uses.
 *
 * The point of the page is that someone scanning it can tell, quickly and
 * without ceremony, whether something happened that they did not expect —
 * §4.7 threat 7's detection control. Rows that shimmer, float and celebrate
 * are the wrong affordance for that: they make an unexpected tap feel like
 * good news. Every entry here is dense, flat, timestamped in mono, and
 * carries its remedy (revoke the card, remove the connection) in the row
 * itself. A future pass that "brings Activity in line" with the rest of the
 * app will have quietly removed the design's only cue that this screen is for
 * noticing trouble.
 *
 * WHAT THE PROTOTYPE SHOWS THAT THE DATA CANNOT SUPPORT
 *
 * The prototype's tap rows read "{name} tapped {card code}", and its card
 * rows carry a descriptive label ("Metal card · assigned to you") and a
 * "Revoked" badge. None of the three is available:
 *   - `CardTapActivityItem` carries no card id — `listCardTapActivity` reads
 *     `connection_sessions`, which records the presenter and the tapper but
 *     not which of that presenter's cards was tapped. So the row says "tapped
 *     your card", which is what is actually known.
 *   - `cards` has no descriptive-label column, so there is nothing to print
 *     beside the code.
 *   - `listOwnAssignedCards` filters to `status = 'assigned'`, so a revoked
 *     card leaves this list rather than staying with a badge. The revoke
 *     confirmation says so, rather than letting it vanish unexplained.
 * All three are stated rather than approximated: an invented card code beside
 * somebody's name would be a fabricated security record, which is worse than
 * a vaguer true one.
 */
export const dynamic = "force-dynamic";

/**
 * §2's Activity surface. Deliberately opaque and blur-free — see the header.
 * Defined once so no row in this file can drift back into glass.
 */
const FLAT_ROW: React.CSSProperties = {
  background: "rgba(255,255,255,.82)",
  border: "1px solid rgba(13,18,32,.08)",
  borderRadius: 14,
};

export default async function ActivityPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const [activity, cards, previews] = await Promise.all([
    listCardTapActivity(supabase, userId),
    listOwnAssignedCards(supabase, userId),
    listCardPreviewActivity(supabase, userId),
  ]);

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-[22px] pt-6 sm:px-7"
      style={{ animation: "sc-rise .45s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-[5px] pt-1.5">
        <h1 className="text-[30px] leading-[34px] font-semibold tracking-[-0.03em]">Activity</h1>
        {/*
         * Copy merged rather than chosen: the restyle wrote this line when taps
         * were the only thing logged, and the preview feature added a second
         * section beneath it. Describing only taps would leave the "Preview
         * views" section unexplained on the one screen whose whole job is to
         * make disclosures legible — and a preview, unlike a tap, sends no push,
         * so this page is the only place it ever surfaces.
         */}
        <p
          className="max-w-[54ch] text-[14px] leading-5"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          A log of every tap of your cards, and every time somebody without a SmartCard account
          opened your card link — in case you missed the push, or never got one. Deliberately
          plainer than the rest of the app.
        </p>
      </header>

      {cards.length > 0 && (
        <section aria-labelledby="cards-heading" className="flex flex-col gap-2">
          <SectionLabel id="cards-heading">YOUR CARDS</SectionLabel>
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 px-[15px] py-[13px]"
                style={FLAT_ROW}
              >
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[13px] leading-[18px] font-medium tracking-[0.02em]"
                  style={{ color: "var(--sc-text)" }}
                >
                  {card.card_code}
                </span>
                <RevokeCard cardId={card.id} cardCode={card.card_code} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="taps-heading" className="flex flex-col gap-2 pb-2">
        <SectionLabel id="taps-heading">RECENT TAPS</SectionLabel>
        {activity.length === 0 ? (
          <NoTapsYet />
        ) : (
          <ul className="flex flex-col gap-2">
            {activity.map((item) => (
              <ActivityRow key={item.sessionId} item={item} supabase={supabase} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Preview views</h2>
        {/*
         * WHY THIS SECTION EXISTS AT ALL, IN ONE SENTENCE A USER COULD READ:
         * somebody without a SmartCard account can now open your card link and
         * see your contact details without connecting to you, which produces
         * no tap and therefore no notification — so this is the only place it
         * shows up.
         *
         * There is no name on any of these rows and there never will be: the
         * viewer has no account, so the app genuinely does not know who they
         * are. Saying "someone" is the honest answer rather than a placeholder.
         */}
        {previews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody without a SmartCard account has opened your card link yet. When somebody does,
            it shows up here — there&rsquo;s no name to show, because they don&rsquo;t have an
            account.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {previews.map((item) => (
              <PreviewRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-mono text-[11px] leading-[15px] font-medium tracking-[0.06em]"
      style={{ color: "var(--sc-text-muted)" }}
    >
      {children}
    </h2>
  );
}

/**
 * Restyled to match the tap rows rather than kept in its original shadcn form.
 * Both sections of this page list the same kind of fact — somebody reached your
 * details — so rendering them in two different visual languages would imply a
 * distinction that isn't there. Flat and opaque like its sibling, per §6:
 * Activity reads as a security log, not a celebration.
 */
function PreviewRow({ item }: { item: CardPreviewActivityItem }) {
  return (
    <li
      className="flex flex-col gap-0.5 rounded-[14px] border p-3"
      style={{
        background: "rgba(255,255,255,.82)",
        borderColor: "rgba(13,18,32,.08)",
      }}
    >
      <div className="text-[14px] leading-5 font-medium">{previewHeadline(item)}</div>
      <div
        className="font-mono text-[11px] leading-[15px]"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <LocalTimestamp iso={item.viewedAt} />
      </div>
    </li>
  );
}

/**
 * A total switch over both columns, not a lookup with a fallback. Both are
 * CHECK-constrained closed sets in the database (20260815120100), so adding a
 * third value to either becomes a type error here rather than a row that
 * silently renders as something generic.
 *
 * The `vcard` wording is deliberately the stronger of the two. Opening the page
 * is ambient; saving the contact file is the moment the details left in a form
 * the person keeps, and it is the one an owner might actually act on.
 */
function previewHeadline(item: CardPreviewActivityItem): string {
  const what = item.source === "card_code" ? "your card link" : "your QR code";
  switch (item.surface) {
    case "preview":
      return `Someone without an account opened ${what}`;
    case "vcard":
      return `Someone without an account saved your contact details from ${what}`;
  }
}

/**
 * §5's empty state, in Activity's flat idiom rather than the app's glass one
 * (14px radius, no blur — same reasoning as every other row here).
 *
 * It has no action button, a deliberate departure from §5's "one action". The
 * state being explained is "nobody has tapped your card", and there is no
 * honest action that changes it: you cannot make someone tap, and offering
 * Connect would imply this list tracks QR connections too, which it does not
 * — `listCardTapActivity` filters to `method = 'nfc_card'`. An action that
 * does not lead anywhere is worse than none.
 */
function NoTapsYet() {
  return (
    <div
      className="flex flex-col items-center gap-2.5 px-6 py-8 text-center"
      style={{ ...FLAT_ROW, borderStyle: "dashed", borderColor: "rgba(13,18,32,.14)" }}
    >
      <span
        className="flex size-11 items-center justify-center rounded-[12px]"
        style={{ background: "rgba(13,18,32,.05)", color: "var(--sc-text-muted)" }}
        aria-hidden
      >
        <Bell size={21} strokeWidth={1.9} />
      </span>
      <h3 className="text-[15px] leading-5 font-semibold">No taps yet</h3>
      <p
        className="max-w-[44ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Every tap of one of your cards is logged here, whether or not the push notification reaches
        you. An empty log means nobody has tapped one.
      </p>
    </div>
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
    <li className="flex flex-wrap items-center gap-3 px-[15px] py-3" style={FLAT_ROW}>
      <AvatarDisc
        size={34}
        fontSize={11}
        initials={initialsFor(item.tapper)}
        photoUrl={photoUrl}
        tone="flat"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] font-medium">
          {name} tapped your card
        </span>
        {/*
         * Mono, because §2 reserves it for "timestamps in record contexts" —
         * and a security log is that context. "Was this while the card was in
         * my pocket?" is the question this line exists to answer, so it is
         * the one piece of every row that must be scannable at a glance.
         */}
        <span
          className="block truncate font-mono text-[11px] leading-[15px]"
          style={{ color: "var(--sc-text-muted)" }}
        >
          <LocalTimestamp iso={item.consumedAt} />
        </span>
      </span>
      {/*
       * `connectionId` is null when the connection this tap created is
       * already gone. The tap itself still renders — it happened, and this is
       * the log of what happened — but there is nothing left to remove. See
       * `CardTapActivityItem`'s doc comment.
       */}
      {item.connectionId !== null && (
        <RemoveConnectionInline connectionId={item.connectionId} otherName={name} />
      )}
    </li>
  );
}
