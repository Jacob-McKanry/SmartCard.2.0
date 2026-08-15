import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";

import { LinkTiles } from "@/components/link-tiles";
import { RingCentre, RingDiagram, type RingBandData } from "@/components/ring-diagram";
import type { CardPreview } from "@/server/cards/card-preview-service";

/**
 * The two screens the non-user preview can render, in one file so they cannot
 * drift apart.
 *
 * WHY `PreviewNotFound` IS A COMPONENT AND NOT A STRING IN EACH ROUTE
 *
 * `card-preview-service.ts` goes to some trouble to make every refusal the same
 * `null`: an unknown card code, a revoked card, a suspended owner, a forged QR
 * token, an exhausted rate limit and an unhandled exception are deliberately
 * indistinguishable to the caller. That property is only worth anything if the
 * bytes that come back are also the same. Two hand-written "nothing here"
 * blocks in two routes is exactly how one of them ends up with a slightly
 * different heading, and a slightly different heading is an oracle.
 *
 * So there is one component, it takes no props, and it renders the same markup
 * from both routes and for every reason. If you find yourself wanting to pass
 * it a reason, that is the change this comment exists to stop.
 *
 * WHAT THE PREVIEW MAY CONTAIN
 *
 * Whatever `CardPreview` holds and nothing else — the service decides what is
 * disclosed, and this file only lays it out. In particular there is no
 * "connect" affordance anywhere below, and there must never be one:
 * CLAUDE.md's non-negotiable rule forbids "any 'connect' action reachable from
 * a shareable profile URL", and a card URL is permanent and forwardable. The
 * only two things a visitor can do here are save the contact and sign in.
 *
 * WHY THIS NOW LOOKS LIKE PROFILE (2026-08-15)
 *
 * DESIGN.md §6, "Profile as a visitor sees it": "identical fields (one identity,
 * shown the same to everyone), no edit affordance anywhere". This screen shipped
 * as a cut-down version of that — an avatar, a name, two contact rows — and the
 * owner asked for the rest. So it draws the same three things Profile draws, out
 * of the same components rather than lookalikes of them: §3's ring diagram
 * (`RingDiagram` + `RingCentre`, same `profile` preset, same two bands), §5's
 * link tiles (`LinkTiles`, the component Profile itself renders), and the
 * contact sheet.
 *
 * Two of Profile's parts are deliberately still absent, and both are absences
 * §6 asks for rather than gaps:
 *
 *   * The Edit pill. "No edit affordance anywhere" — a visitor has no account.
 *   * The `email_opt_in` row. It is a setting, not an identity field: whether
 *     somebody wants occasional email from SmartCard is between them and
 *     SmartCard, and nothing a stranger holding their card has any business
 *     reading.
 *
 * §6 also names a "provenance card" that explains why the page is reachable.
 * The sign-in blurb each route passes is that explanation for this surface —
 * "somebody handed you a card" — and it is per-route because the honest answer
 * differs between a permanent card and a live QR code.
 *
 * EVERY PART DEGRADES TO ABSENT. `counts === null` draws the medallion with no
 * rings; no links renders no link block at all. Neither is an error state and
 * neither gets error styling: the service returns those values both when the
 * person genuinely has none and when the read failed, deliberately, so that the
 * page cannot become a signal for which of the two happened.
 */

/** Everything a visitor can do, as data, so the two routes state it rather than restyle it. */
export interface PreviewActions {
  /** Where the `text/vcard` download lives for this route. */
  vcardHref: string;
  /** Where Kinde sends them after signing in. */
  postLoginRedirectUrl: string;
  /** One sentence under the sign-in button explaining what signing in is for on THIS route. */
  signInBlurb: string;
}

export function NonUserPreview({
  preview,
  actions,
}: {
  preview: CardPreview;
  actions: PreviewActions;
}) {
  const name = previewDisplayName(preview);
  const subtitle = previewSubtitle(preview);
  const bands = previewBands(preview);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center gap-6 px-5 py-10">
      <section
        className="flex flex-col items-center gap-4 rounded-[28px] border p-7 text-center"
        style={glassSurface}
      >
        {/*
         * §6: Profile is "calm: no rotation, one blur-up", and this is Profile
         * as a visitor sees it, so the bands are static here too. `bands` is
         * empty when the counts could not be computed, which `RingDiagram`
         * renders as the medallion alone — the same picture this screen showed
         * before the rings existed.
         */}
        <RingDiagram
          preset="profile"
          bands={bands}
          summary={ringSummary(name, preview.counts)}
          centre={<RingCentre photoUrl={preview.photoUrl} initials={previewInitials(preview)} />}
        />

        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] leading-[30px] font-semibold" style={{ letterSpacing: "-.02em" }}>
            {name}
          </h1>
          {subtitle !== null && (
            <p className="text-[15px] leading-[21px]" style={{ color: "var(--sc-text-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>

        {preview.bio !== null && preview.bio.trim() !== "" && (
          <p
            className="max-w-[38ch] text-[14px] leading-[20px]"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            {preview.bio}
          </p>
        )}

        {/*
         * Phone and email are rendered in the mono face, which DESIGN.md §2
         * reserves for "any value a user would actually copy". These are the
         * two values on this page somebody transcribes by eye.
         */}
        {(preview.phoneNumber !== null || preview.email !== "") && (
          <dl className="flex w-full flex-col gap-2 pt-1 text-left">
            {preview.phoneNumber !== null && preview.phoneNumber.trim() !== "" && (
              <ContactRow label="Phone" value={preview.phoneNumber} href={`tel:${preview.phoneNumber}`} />
            )}
            {preview.email.trim() !== "" && (
              <ContactRow label="Email" value={preview.email} href={`mailto:${preview.email}`} />
            )}
          </dl>
        )}

        {/*
         * §5's link tiles, from the component Profile renders — see
         * `link-tiles.tsx` for why it moved out of the profile route folder.
         * `emptyState="omit"` because a visitor has nowhere to add a link and a
         * heading over empty space would remark on an absence §7 calls normal.
         *
         * `text-left` because the tiles are a list of rows inside a card that is
         * otherwise centred; a centred handle under a left-aligned brand plate
         * reads as a layout bug.
         */}
        <div className="w-full text-left">
          <LinkTiles links={preview.socialLinks} emptyState="omit" />
        </div>

        <a
          href={actions.vcardHref}
          className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-[15px] font-semibold text-white"
          style={{
            background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
            boxShadow: "0 12px 28px -12px rgba(11,96,255,.55)",
          }}
        >
          Save contact
        </a>
      </section>

      <section className="flex flex-col items-center gap-3 text-center">
        <p
          className="max-w-[38ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {actions.signInBlurb}
        </p>
        <LoginLink postLoginRedirectURL={actions.postLoginRedirectUrl}>
          <span
            className="inline-flex min-h-11 items-center justify-center rounded-full border px-5 text-[14px] font-semibold"
            style={{
              background: "rgba(255,255,255,.72)",
              borderColor: "rgba(13,18,32,.12)",
              color: "var(--sc-text)",
            }}
          >
            Sign in to SmartCard
          </span>
        </LoginLink>
      </section>
    </main>
  );
}

/**
 * The single refusal screen. No props, by design — see the file header.
 *
 * The copy says nothing about why. Not "this card was revoked", not "expired",
 * not "no longer available": every one of those confirms that something real
 * exists at the other end, which is what an enumerator is trying to learn.
 */
export function PreviewNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[22px] leading-[26px] font-semibold" style={{ letterSpacing: "-.02em" }}>
        Nothing here
      </h1>
      <p
        className="max-w-[34ch] text-[14px] leading-[20px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        This link doesn&rsquo;t point at anything. If somebody just handed you a card, ask them to
        show you their code again.
      </p>
    </main>
  );
}

function ContactRow({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5"
      style={{ background: "rgba(255,255,255,.6)", borderColor: "rgba(13,18,32,.08)" }}
    >
      <dt className="text-[11px] font-semibold tracking-[.06em] uppercase" style={{ color: "var(--sc-text-subtle)" }}>
        {label}
      </dt>
      <dd className="min-w-0">
        <a
          href={href}
          className="block truncate font-mono text-[13px] font-medium"
          style={{ color: "var(--sc-accent-deep)" }}
        >
          {value}
        </a>
      </dd>
    </div>
  );
}

const glassSurface = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  borderColor: "var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
} as const;

/**
 * Same fallback chain as the vCard's `FN`, deliberately: the name on screen and
 * the name in the downloaded file should never disagree, and both columns are
 * nullable with real null rows in the migrated data.
 */
function previewDisplayName(preview: CardPreview): string {
  const full = `${preview.firstName?.trim() ?? ""} ${preview.lastName?.trim() ?? ""}`.trim();
  if (full !== "") return full;
  const company = preview.companyName?.trim();
  return company !== undefined && company !== "" ? company : "SmartCard contact";
}

function previewSubtitle(preview: CardPreview): string | null {
  const role = preview.companyRole?.trim();
  const company = preview.companyName?.trim();
  if (role && company) return `${role} at ${company}`;
  return role || company || null;
}

function previewInitials(preview: CardPreview): string {
  const first = preview.firstName?.trim().charAt(0) ?? "";
  const last = preview.lastName?.trim().charAt(0) ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined !== "" ? combined : "•";
}

/**
 * The ring diagram's bands — the same two, in the same order, in the same
 * colours, with the same nouns as `/profile`. Copying those four facts rather
 * than importing them is a deliberate small duplication: the alternative is a
 * shared "profile bands" helper that both screens depend on, which is more
 * coupling than two literals are worth, and `ring-geometry.test.ts` asserts the
 * layout is legal for every band list the app ships.
 *
 * DESIGN.md §3's third band ("cities met people in") is absent here because it
 * is absent from Profile: the schema has no city on a meeting, and §3's
 * implementation notes record why approximating one would be a number the app
 * cannot stand behind. A preview showing a band the owner's own profile does
 * not show would be inventing a fact about somebody for strangers.
 *
 * An empty array when the counts are unknown, which draws the medallion and no
 * rings — never zeroes, which would be a claim rather than an absence (§7).
 */
function previewBands(preview: CardPreview): RingBandData[] {
  const counts = preview.counts;
  if (counts === null) return [];

  return [
    {
      key: "connections",
      count: counts.connections,
      color: "var(--sc-accent)",
      noun: { one: "connection", many: "connections" },
    },
    {
      key: "events",
      count: counts.eventsAttended,
      color: "var(--sc-text)",
      noun: { one: "event attended", many: "events attended" },
    },
  ];
}

/**
 * §8: the rings are decoration and are hidden from assistive tech, so the
 * diagram's `aria-label` is where its content actually lives. Matches
 * `/profile`'s `ringSummary` wording, and falls back to the bare name when there
 * are no counts — a screen reader should hear "Sam Rivera" rather than a
 * sentence about numbers that are not on the screen.
 */
function ringSummary(name: string, counts: CardPreview["counts"]): string {
  if (counts === null) return name;
  const c = `${counts.connections} ${counts.connections === 1 ? "connection" : "connections"}`;
  const e = `${counts.eventsAttended} ${
    counts.eventsAttended === 1 ? "event attended" : "events attended"
  }`;
  return `${name}: ${c}, ${e}.`;
}
