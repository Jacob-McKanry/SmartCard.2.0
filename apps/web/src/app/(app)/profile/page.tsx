import Link from "next/link";
import { redirect } from "next/navigation";
import { SquarePen } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getOwnProfile,
  listOwnSocialLinks,
  type OwnProfile,
} from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import { listOwnConnections } from "@/server/connections/connections-service";
import { listAttendingEvents, type AttendingEventItem } from "@/server/events/events-service";
import { RingCentre, RingDiagram, type RingBandData } from "@/components/ring-diagram";

import { LinkTiles } from "./link-tiles";

/**
 * The Profile screen: the signed-in user's own identity, drawn to
 * `docs/design/DESIGN.md` §6 ("ring diagram, name, bio, contact sheet
 * (phone/email in mono), scrolling link tiles, floating Edit pill bottom-right
 * above the dock. Calm: no rotation, one blur-up") and the prototype's
 * `data-screen-label="Profile"`.
 *
 * ONE IDENTITY, SHOWN IDENTICALLY TO EVERYONE — NO PERSONA SPLIT
 *
 * §2.1 / §3 of the product spec: "One profile identity per user, shown
 * identically to everyone. No personal/professional split." There is therefore
 * exactly one render path below, not a "your own view" vs "public view" branch —
 * because there is no second view to branch to. The line at the foot of the page
 * says so to the person reading it, which is the point: it is a promise about
 * the product, not a caption.
 *
 * WHY THIS IS "MY OWN PROFILE" ONLY, WITH NO `/profile/[userId]`
 *
 * Deliberately out of scope, not a shortcut. Viewing *someone else's* profile
 * needs its own access-control work (the graph-gated `users` select policy
 * already allows reading a connection's row — see 20260809211100 — but there is
 * no UI consumer of it yet), and the prototype's "Profile (as a connection sees
 * it)" screen is that feature, not this one. It also needs the provenance card
 * that explains why the page is reachable at all, which needs the meeting record
 * that made it reachable. Building a generic viewer route here would be scope
 * invented ahead of what the product can use it for.
 *
 * WHY EDITING MOVED TO ITS OWN ROUTE
 *
 * This page used to *be* the edit form — three stacked `<form>`s with no view of
 * the profile they were editing. §6 specifies a viewing screen with a floating
 * Edit pill, so the forms moved to `/profile/edit`, unchanged in behaviour. The
 * nav's active-slot matching is prefix-based, so Profile stays lit while you
 * edit.
 *
 * THE RING DIAGRAM HAS TWO BANDS, NOT §3's THREE — SEE DESIGN.md §3
 *
 * §3's outermost band is "cities met people in", and nothing in this schema
 * knows what city a meeting happened in. `meeting_locations` holds a lat/lng and
 * a `place_label`, and that label is a venue name ("Blue Bottle Coffee") or a
 * neighbourhood — `server/connect/geocode.ts` asks Mapbox for
 * `poi,neighborhood,place` and prefers the POI. Counting distinct labels and
 * calling the result "cities" would be a number the app cannot stand behind, and
 * §7's whole point is that a screen never implies more than it knows. The band is
 * omitted rather than approximated, and the deviation is recorded in DESIGN.md
 * §3 alongside the original decision, per CLAUDE.md's documentation standard.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  const [profile, socialLinks, connections, attending] = await Promise.all([
    getOwnProfile(supabase, userId),
    listOwnSocialLinks(supabase, userId),
    listOwnConnections(supabase, userId),
    listAttendingEvents(supabase, userId),
  ]);
  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photo_path);

  const eventsAttended = countEventsAttended(attending);
  const bands: RingBandData[] = [
    {
      key: "connections",
      count: connections.length,
      color: "var(--sc-accent)",
      noun: { one: "connection", many: "connections" },
    },
    {
      key: "events",
      count: eventsAttended,
      color: "var(--sc-text)",
      noun: { one: "event attended", many: "events attended" },
    },
  ];

  const name = fullName(profile);
  const subtitle = roleLine(profile);

  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-3.5 px-5 pt-5 sm:px-7 sm:pt-8"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      {/*
       * §6: Profile is "calm: no rotation, one blur-up". The bands are static —
       * the slow orbit belongs to Connect, which is a moment rather than a page
       * you sit on.
       */}
      <RingDiagram
        preset="profile"
        bands={bands}
        summary={ringSummary(name, connections.length, eventsAttended)}
        centre={<RingCentre photoUrl={photoUrl} initials={initialsFor(profile)} />}
      />

      <div className="flex flex-col gap-3">
        <div>
          <h1
            className="text-[27px] leading-[31px] font-semibold"
            style={{ letterSpacing: "-.035em" }}
          >
            {name}
          </h1>
          {subtitle === null ? null : (
            <p
              className="mt-[3px] text-[13.5px] leading-[19px]"
              style={{ color: "var(--sc-text-muted)" }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {profile.bio?.trim() ? (
          <p className="max-w-[52ch] text-[14.5px] leading-[22px]" style={{ textWrap: "pretty" }}>
            {profile.bio.trim()}
          </p>
        ) : null}

        <ContactSheet profile={profile} />

        <LinkTiles links={socialLinks} />

        {/*
         * Not decoration, and not marketing. This is the product's central
         * promise stated on the one screen where a person would otherwise wonder
         * who can see what — and it is why there is no share button anywhere on
         * this page for them to go looking for.
         */}
        <p
          className="max-w-[52ch] text-[11.5px] leading-4"
          style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
        >
          One identity, shown identically to every connection. No public view, no profile link, and
          no way for a stranger to find this page.
        </p>
      </div>

      <EditPill />
    </main>
  );
}

/* ----------------------------------------------------------------- contact */

/**
 * §6's contact sheet: phone and email in mono, because §2 puts "any value a user
 * would copy (phone, email)" in Geist Mono, then the email-preference row.
 *
 * WHY THE TOGGLE HERE IS NOT A CONTROL
 *
 * The prototype draws `email_opt_in` as a live toggle in this sheet. On a
 * viewing screen it is a *reading* of stored state, and it renders as one: no
 * button, no form, and an explicit "On"/"Off" word beside it so the state is
 * legible without relying on the accent colour (§8: "status colour is never the
 * only signal"). Changing it is an edit, and edits happen on `/profile/edit`,
 * where the checkbox that actually writes the column lives. A toggle that looked
 * interactive and was not would be worse than either option.
 *
 * A missing phone number simply omits its row. §7: absence is normal, and there
 * is no nudge to fill it in.
 */
function ContactSheet({ profile }: { profile: OwnProfile }) {
  const phone = profile.phone_number?.trim();

  return (
    <dl
      className="flex flex-col rounded-[20px] border py-0.5"
      style={{
        background: "var(--sc-glass-bg)",
        backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        borderColor: "var(--sc-glass-bd)",
        boxShadow: "var(--sc-glass-sh)",
      }}
    >
      {phone ? <ContactRow label="Phone" value={phone} /> : null}
      <ContactRow label="Email" value={profile.email} />
      <div className="flex items-center gap-2.5 px-[15px] py-2.5">
        <dt className="flex-1 text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
          Occasional emails
        </dt>
        <dd className="flex items-center gap-2">
          <span className="text-[12px] leading-[17px] font-medium">
            {profile.email_opt_in ? "On" : "Off"}
          </span>
          <span
            aria-hidden
            className="relative block h-6 w-10 shrink-0 rounded-full"
            style={{ background: profile.email_opt_in ? "var(--sc-accent)" : "rgba(13,18,32,.14)" }}
          >
            <span
              className="absolute top-[3px] block size-[18px] rounded-full bg-white"
              style={{ left: profile.email_opt_in ? 19 : 3 }}
            />
          </span>
        </dd>
      </div>
    </dl>
  );
}

function ContactRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center gap-2.5 border-b px-[15px] py-2.5"
      style={{ borderBottomColor: "rgba(13,18,32,.055)" }}
    >
      <dt className="flex-1 text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
        {label}
      </dt>
      <dd
        className="min-w-0 truncate text-[12.5px] leading-[17px] font-medium"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------- edit */

/**
 * §6's "floating Edit pill bottom-right above the dock", in §5's neutral primary
 * (`#0d1220` solid) rather than the accent gradient — §2 reserves a full blue
 * field for the Connect CTA and the connection payoff, and editing your own bio
 * is neither.
 *
 * `sticky` rather than `fixed`, so it travels with the end of the page instead of
 * hovering over a short profile's empty space. `bottom-[86px]` clears the phone
 * dock (14px inset plus a ~60px bar); the desktop bar is at the top, so `sm:`
 * only needs ordinary spacing.
 */
function EditPill() {
  return (
    <div className="pointer-events-none sticky bottom-[86px] flex justify-end pb-2 sm:bottom-6">
      <Link
        href="/profile/edit"
        className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full px-5 text-[13.5px] leading-[18px] font-semibold text-white"
        style={{ background: "var(--sc-text)", boxShadow: "0 14px 30px -10px rgba(13,18,32,.6)" }}
      >
        <SquarePen size={15} strokeWidth={2} aria-hidden />
        Edit profile
      </Link>
    </div>
  );
}

/* --------------------------------------------------------------- derivation */

/**
 * "Events attended" for the middle ring band.
 *
 * Attendance is `status === "going"` on an event that has already started, and
 * both halves matter. `going` is the only status the database itself treats as
 * attendance (`private.shares_event_with()` branches on it, so it carries
 * access-control weight and not merely display weight), and an event that has
 * not happened yet has not been attended however firmly it was answered.
 * Everything else — `interested`, `pending`, `waitlist`, `denied`, `not_going` —
 * is not attendance and is not counted.
 *
 * This counts RSVPs, which is what the app can actually observe: nothing records
 * whether a person physically turned up. The caption noun says "events attended"
 * because that is the closest honest description of the number, and the number
 * is never inflated past what the rows support.
 *
 * Reads the clock, so it lives outside every component — `react-hooks/purity`
 * rightly refuses `Date.now()` inside a render.
 */
function countEventsAttended(attending: AttendingEventItem[]): number {
  const nowMs = Date.now();
  return attending.filter(
    (item) => item.rsvp.status === "going" && new Date(item.event.starts_at).getTime() < nowMs,
  ).length;
}

/** The diagram's accessible description — §8, since the rings themselves are decoration. */
function ringSummary(name: string, connections: number, events: number): string {
  const c = `${connections} ${connections === 1 ? "connection" : "connections"}`;
  const e = `${events} ${events === 1 ? "event attended" : "events attended"}`;
  return `${name}: ${c}, ${e}.`;
}

function fullName(profile: OwnProfile): string {
  const full = `${profile.first_name?.trim() ?? ""} ${profile.last_name?.trim() ?? ""}`.trim();
  // Falls back to the email's local part rather than to a placeholder word: a
  // profile with no name yet still belongs to someone identifiable, and
  // "Someone" as the `<h1>` of your own profile reads as a bug.
  return full !== "" ? full : (profile.email.split("@")[0] ?? profile.email);
}

/**
 * "Founder, SmartCard · @jacob" — with every part optional, because all three
 * columns are nullable and most will be empty on a new account. Returns `null`
 * when there is nothing to say, so the line disappears entirely rather than
 * rendering an orphaned separator.
 */
function roleLine(profile: OwnProfile): string | null {
  const role = profile.company_role?.trim();
  const company = profile.company_name?.trim();
  const username = profile.username?.trim();

  const work = [role, company].filter((part): part is string => Boolean(part)).join(", ");
  const parts = [work, username ? `@${username}` : ""].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function initialsFor(profile: OwnProfile): string {
  const first = profile.first_name?.trim().charAt(0) ?? "";
  const last = profile.last_name?.trim().charAt(0) ?? "";
  const fromName = `${first}${last}`.toUpperCase();
  return fromName !== "" ? fromName : profile.email.slice(0, 2).toUpperCase();
}
