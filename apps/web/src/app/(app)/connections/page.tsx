import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { QrCode, Users } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { listOwnConnections, type ConnectionListItem } from "@/server/connections/connections-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { displayName, formatOccurredAt, initialsFor, verificationMethodLabel } from "./lib/format";
import { AvatarDisc } from "./lib/avatar-disc";

/**
 * The connections list (README build order item 3): every `active`
 * connection the signed-in user has, per the task doc's "A connections list"
 * section. Each row is a link into `/connections/[connectionId]`, the
 * meeting-record view.
 *
 * WHY THIS IS THE CALLER'S OWN LIST ONLY, WITH NO WAY TO BROWSE ANYONE
 * ELSE'S
 *
 * `listOwnConnections` derives everything from the caller's own RLS-bound
 * client and never takes a `userId` argument for whose graph to read — same
 * posture as `getOwnProfile` in the Profile feature, and for the same
 * reason: CLAUDE.md's non-negotiable product rule forbids anything that
 * looks like a directory, and a "view someone else's connections" route
 * would be exactly that, reachable from nothing but a URL.
 *
 * ---------------------------------------------------------------------------
 * DESIGN PASS (docs/design/DESIGN.md §5 "Rows vs cards", §6 "People", and the
 * `data-screen-label="Connections"` block of `SmartCard 2.0.dc.html`).
 *
 * The data calls above are untouched — this pass only changed how the result
 * is drawn. Three things about the drawing are load-bearing rather than
 * decorative, and should survive future edits:
 *
 *  1. **"No location shown" is the normal case and gets no error styling.**
 *     §7's "Absence is often normal" rule. A row shows who, when and how, and
 *     nothing about where; there is no red text, no warning glyph and no
 *     "turn this on" nudge, because a meeting with no shared location is the
 *     default outcome of the consent mechanic, not a misconfiguration. The
 *     one-line note under the list explains that once, in `--sc-text-muted`
 *     rather than the prototype's `#a4abbb`: it states a rule, and §8 puts
 *     any rule-bearing text at `--text-muted` or darker.
 *
 *  2. **The method chip is a label, not a status.** §8 forbids colour as the
 *     only signal, so the chip reads "NFC" or "QR" in words on a neutral
 *     plate — it never becomes a green/amber "trust level".
 *
 *  3. **Nothing here links anywhere except a record the viewer is party to.**
 *     No avatar-to-profile link, no mutual-connection browsing, no share
 *     affordance. The only destination is `/connections/[id]`.
 */
export const dynamic = "force-dynamic";

/** The prototype's own list container: 24px glass card, rows divided by a hairline. */
const GLASS_PANEL: React.CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  border: "1px solid var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

export default async function ConnectionsPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const connections = await listOwnConnections(supabase, userId);

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-[5px] pt-1.5">
        <h1 className="text-[30px] leading-[34px] font-semibold tracking-[-0.03em]">People</h1>
        <p
          className="max-w-[54ch] text-[14px] leading-5"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Everyone you&rsquo;ve met in person. There&rsquo;s no way to browse anyone else&rsquo;s.
        </p>
      </header>

      {connections.length === 0 ? (
        <EmptyPeople />
      ) : (
        <>
          <ul className="flex flex-col overflow-hidden rounded-[24px]" style={GLASS_PANEL}>
            {connections.map((connection, index) => (
              <ConnectionListRow
                key={connection.connectionId}
                connection={connection}
                supabase={supabase}
                last={index === connections.length - 1}
              />
            ))}
          </ul>
          {/*
           * §7 "Absence is often normal", stated once for the whole list
           * rather than as a per-row placeholder. `--sc-text-muted` and 12px,
           * not the prototype's `#a4abbb` — see point 1 in the header.
           */}
          <p
            className="max-w-[54ch] text-[12px] leading-[17px]"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            No location on most of these — that&rsquo;s normal. A place only appears once both people
            have agreed to share it.
          </p>
        </>
      )}
    </main>
  );
}

/**
 * §5's empty state: a dashed panel, an icon plate, a title naming the
 * context, one sentence saying why empty is expected, and exactly one action.
 * The action is Connect, because it is the *only* way this list can ever gain
 * a row — there is no invite link and no search to offer instead.
 */
function EmptyPeople() {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-[26px] border border-dashed px-6 py-9 text-center"
      style={{ borderColor: "rgba(13,18,32,.16)", background: "rgba(255,255,255,.42)" }}
    >
      <span
        className="flex size-11 items-center justify-center rounded-[14px]"
        style={{ background: "var(--sc-accent-tint)", color: "var(--sc-accent-deep)" }}
        aria-hidden
      >
        <Users size={22} strokeWidth={1.9} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[17px] leading-[22px] font-semibold tracking-[-0.02em]">
          Nobody here yet
        </h2>
        <p
          className="max-w-[40ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          This list only fills up in person. A connection is made by tapping an NFC card or scanning
          someone&rsquo;s code while you&rsquo;re both standing there — nothing else adds to it.
        </p>
      </div>
      <Link
        href="/connect"
        className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] leading-[18px] font-semibold text-white"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
        }}
      >
        <QrCode size={17} strokeWidth={1.9} aria-hidden />
        Connect in person
      </Link>
    </div>
  );
}

async function ConnectionListRow({
  connection,
  supabase,
  last,
}: {
  connection: ConnectionListItem;
  supabase: SupabaseClient;
  last: boolean;
}) {
  const name = displayName(connection.otherUser);
  const photoUrl = await signedProfilePhotoUrl(supabase, connection.otherUser.photo_path);
  const isNfc = connection.verificationMethod === "nfc_card";

  return (
    <li>
      <Link
        href={`/connections/${connection.connectionId}`}
        className="flex min-h-[68px] items-center gap-[13px] px-4 py-[13px] transition-colors duration-200 hover:bg-white/55"
        style={{ borderBottom: last ? undefined : "1px solid rgba(13,18,32,.055)" }}
      >
        <AvatarDisc
          size={42}
          initials={initialsFor(connection.otherUser)}
          photoUrl={photoUrl}
          fontSize={13}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">
            {name}
          </span>
          {/*
           * Decorative meta only (§2's type table): the method is repeated as
           * a worded chip to the right, so nothing a viewer *needs* depends on
           * reading this line.
           */}
          <span
            className="block truncate text-[12px] leading-[17px]"
            style={{ color: "var(--sc-text-subtle)" }}
          >
            {formatOccurredAt(connection.occurredAt)}
          </span>
        </span>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] leading-[14px] font-medium tracking-[0.03em]"
          style={{ background: "rgba(13,18,32,.04)", color: "var(--sc-text-muted)" }}
          // The chip is two letters; the full sentence is what a screen reader
          // should hear, and §8 requires colour never be the only signal.
          aria-label={verificationMethodLabel(connection.verificationMethod)}
        >
          {isNfc ? "NFC" : "QR"}
        </span>
      </Link>
    </li>
  );
}
