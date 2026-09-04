import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, SquarePen } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getOwnProfile,
  listOwnSocialLinks,
  type OwnProfile,
} from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import { listOwnConnections } from "@/server/connections/connections-service";
import { countCitiesMetIn } from "@/server/connections/cities-count";
import { countEventsAttended } from "@/server/events/attendance-count";
import { LinkTiles } from "@/components/link-tiles";
import { RingCentre, RingDiagram, type RingBandData } from "@/components/ring-diagram";
import { EmailOptInToggle } from "./email-opt-in-toggle";
import { RosterVisibilityToggle } from "./roster-visibility-toggle";

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
 * "EVENTS ATTENDED" IS COUNTED IN SQL, AND USED TO BE COUNTED IN TYPESCRIPT
 *
 * This page derived the number from `listAttendingEvents`, filtering its rows
 * in a helper here. That list is capped at the 50 most recent RSVPs — correct
 * for a browse list, wrong as the input to a count — so a person with 51
 * qualifying RSVPs was shown 50 on their own profile while `/card/<code>`, which
 * counted in SQL, showed the true figure to strangers. The count now comes from
 * `countEventsAttended`, the one function both surfaces call; see its header for
 * the rule and for why the fix is a shared function rather than a second correct
 * implementation.
 *
 * THE RING DIAGRAM DRAWS ALL THREE OF §3's BANDS AS OF 2026-08-28
 *
 * It shipped with two, and the reason is worth keeping rather than deleting,
 * because it is the reason the third one can now be trusted. §3's outermost
 * band is "cities met people in", and nothing in this schema knew what city a
 * meeting happened in: `meeting_locations` held a lat/lng and a `place_label`,
 * and that label is a venue name ("Blue Bottle Coffee") or a neighbourhood —
 * `server/connect/geocode.ts` asks Mapbox for `poi,neighborhood,place` and
 * prefers the POI. Counting distinct labels and calling the result "cities"
 * would have been a number the app could not stand behind, so the band was
 * omitted rather than approximated.
 *
 * What changed is the data, not the standard. `meeting_locations.city_label`
 * (20260828170000) is written from the geocoder's own `place` feature — the
 * city as Mapbox named it, never parsed back out of `place_label` — and
 * `own_cities_met_in()` (20260828180000) counts distinct values of it over the
 * caller's own meetings. The band is now a fact somebody asserted rather than
 * one this screen inferred, which is what §7 was asking for all along.
 *
 * ONE HONEST LIMITATION, STATED HERE BECAUSE IT IS VISIBLE TO USERS: nothing
 * was backfilled, so meetings recorded before 2026-08-28 have no city and are
 * invisible to this count. An established member's band reads LOW until they
 * meet somebody new. Low is the acceptable direction to be wrong in; the
 * alternative, guessing a city for an old meeting from a venue name, is the
 * approximation this band spent months not making.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  const [profile, socialLinks, connections, eventsAttended, citiesMetIn] = await Promise.all([
    getOwnProfile(supabase, userId),
    listOwnSocialLinks(supabase, userId),
    listOwnConnections(supabase, userId),
    eventsAttendedOrNull(supabase, userId),
    citiesMetInOrNull(supabase),
  ]);
  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photo_path);

  const bands: RingBandData[] = [
    {
      key: "connections",
      count: connections.length,
      color: "var(--sc-accent)",
      noun: { one: "connection", many: "connections" },
    },
    // Omitted entirely when the count could not be read — see
    // `eventsAttendedOrNull`. A band drawn from a fabricated zero would say
    // "you have attended no events", which is a claim rather than an absence.
    ...(eventsAttended === null
      ? []
      : [
          {
            key: "events",
            count: eventsAttended,
            color: "var(--sc-text)",
            noun: { one: "event attended", many: "events attended" },
          },
        ]),
    /*
     * §3's third band, drawn for the first time on 2026-08-28. It was omitted
     * from this file's original build for a stated reason — `place_label` is a
     * venue or neighbourhood name, so a count of distinct labels would not be
     * a count of cities — and that reason is now gone rather than overruled:
     * `own_cities_met_in()` counts `meeting_locations.city_label`, which the
     * geocoder writes from its own `place` feature (20260828170000/180000).
     *
     * Omitted on a failed read, exactly like the events band above and for the
     * identical reason: a fabricated zero would read "you have met people in
     * no cities", which is a claim about somebody's life rather than an
     * absence of data. `RING_PRESETS.profile` has had three band slots
     * (r 62/88/112) since it was written, so this needs no geometry change —
     * `ring-geometry.test.ts` already asserts every preset's clearance rule.
     */
    ...(citiesMetIn === null
      ? []
      : [
          {
            key: "cities",
            count: citiesMetIn,
            color: "var(--sc-accent-deep)",
            noun: { one: "city", many: "cities" },
          },
        ]),
  ];

  const name = fullName(profile);
  const subtitle = roleLine(profile);

  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-3.5 px-5 pt-5 sm:px-7 sm:pt-8"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <SettingsButton />

      {/*
       * §6: Profile is "calm: no rotation, one blur-up". The bands are static —
       * the slow orbit belongs to Connect, which is a moment rather than a page
       * you sit on.
       */}
      <RingDiagram
        preset="profile"
        bands={bands}
        summary={ringSummary(name, connections.length, eventsAttended, citiesMetIn)}
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
 * THE TOGGLE IS NOW A CONTROL, AND THE REASON IT WAS NOT IS WORTH KEEPING
 *
 * The prototype draws `email_opt_in` as a live toggle in this sheet. It shipped
 * as a *reading* — a word and a painted pill, no form — because the only action
 * that wrote the column was `updateProfileAction`, which submits the whole
 * profile form: a lone toggle posting to it would have sent seven absent fields
 * and blanked a person's name, bio and phone number to turn off an email
 * preference. A control that destroys data is worse than no control, so it was
 * left as a reading and the constraint was written down rather than worked
 * around.
 *
 * `updateEmailOptInAction` removes the constraint instead of dodging it: one
 * action, one column, over the same service function and the same column-level
 * UPDATE grant (20260809211100) that already permitted this write. Nothing
 * widened.
 *
 * WHAT SURVIVES FROM THE READING-ONLY VERSION. The state is still *worded*
 * "On"/"Off" beside the pill, not signalled by the accent colour alone — §8:
 * "status colour is never the only signal". The word is the switch's own label
 * now rather than a caption next to a decoration, and the control announces
 * itself as a switch with its state, so the colour is the third signal rather
 * than the only one.
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
      <div className="flex items-center gap-2.5 px-[15px] py-0.5">
        <dt
          id="email-opt-in-label"
          className="flex-1 text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-subtle)" }}
        >
          Occasional emails
        </dt>
        <dd>
          <EmailOptInToggle optIn={profile.email_opt_in} labelledBy="email-opt-in-label" />
        </dd>
      </div>
      {/*
       * The event-roster opt-in (20260904100000) — same row shape as the
       * email preference above, one more line in the same contact sheet
       * rather than a separate settings screen, since both are "who can see
       * what about me" questions a person is likely to check together.
       * `roster_visibility === 'visible'` is the only state this switch ever
       * shows "On" for; null (never chosen) reads as "Off", matching every
       * gate that treats an unanswered choice as hidden.
       */}
      <div className="flex items-center gap-2.5 px-[15px] py-0.5">
        <dt
          id="roster-visibility-label"
          className="flex-1 text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-subtle)" }}
        >
          Visible on event guest lists
        </dt>
        <dd>
          <RosterVisibilityToggle
            visible={profile.roster_visibility === "visible"}
            labelledBy="roster-visibility-label"
          />
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

/* ---------------------------------------------------------------- settings */

/**
 * The way into `/settings`, and the reason it is a quiet icon at the top rather
 * than a second floating pill at the bottom.
 *
 * §6 gives this screen exactly one floating affordance — the Edit pill — and
 * calls Profile "the calm, static anchor of the app". A second pill beside it
 * would double the screen's only piece of chrome and force a person to read two
 * labels to work out which one they want, on the one screen the design asks to
 * stay still.
 *
 * WHY IT IS ON PROFILE AT ALL, AND WHY IT IS NOT PART OF EDIT
 *
 * Editing your profile and managing your account are different kinds of
 * destination, even though both are "your stuff". Edit changes what other
 * people see; Settings is about the session, the sign-in behind it and the
 * cards tied to it — nothing on it is visible to anyone else. Folding Settings
 * into `/profile/edit` would bury the app's only sign-out inside a form, where
 * somebody on a borrowed phone would never think to look. Profile is the right
 * parent because it is the "you" slot in the nav, and this placement keeps that
 * slot lit while you are in Settings (see `nav.tsx`).
 *
 * §8: an icon-only control carries a label, so it has one; and the target is
 * 44px even though the glyph is 19px.
 */
function SettingsButton() {
  return (
    <div className="-mb-2 flex justify-end sm:-mb-1">
      <Link
        href="/settings"
        aria-label="Settings"
        className="flex size-11 items-center justify-center rounded-full"
        style={{
          border: "1px solid rgba(13,18,32,.1)",
          background: "rgba(255,255,255,.7)",
          color: "var(--sc-text-muted)",
        }}
      >
        <Settings size={19} strokeWidth={1.9} aria-hidden />
      </Link>
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
 * The middle ring band's number, or `null` if it could not be read.
 *
 * `countEventsAttended` throws rather than defaulting, deliberately — see its
 * header: zero is a claim, not an absence. This page is the caller that has to
 * decide what a failure means, and the answer is "draw one fewer band", not
 * "draw a zero" and not "500 the whole profile". A person's name, bio, contact
 * sheet and link tiles have nothing to do with an aggregate over their RSVPs,
 * and taking the page down over one would be a worse outcome than a diagram
 * with one ring.
 *
 * This is the same shape the card preview uses for the same numbers
 * (`degradeOnFailure` in `card-preview-service.ts`): the decision of *whether*
 * to show somebody their profile is already made by the time this runs, so a
 * failure here can only show less, never refuse. Logged loudly, because a
 * systematically failing count should be visible in the server log rather than
 * silently costing every profile its second band.
 *
 * Reads the clock, so — like the helper it replaces — it lives outside every
 * component: `react-hooks/purity` rightly refuses `new Date()` inside a render.
 * The page is `force-dynamic`, so that is one clock reading per request, and
 * "events attended" is the only time-dependent fact on this screen. (The shared
 * counter takes `now` as an argument rather than reading it, because the card
 * preview computes several time-dependent facts per request and needs them all
 * answered against one instant.)
 */
async function eventsAttendedOrNull(
  supabase: SupabaseClient,
  userId: string,
): Promise<number | null> {
  try {
    return await countEventsAttended(supabase, userId, new Date());
  } catch (error) {
    console.error("[profile] omitting the events band after a failed count", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The cities band's number, or `null` if it could not be read.
 *
 * The exact shape of `eventsAttendedOrNull` above, for the exact reason its
 * header gives: `countCitiesMetIn` throws rather than defaulting because zero
 * is a claim, and this page is the caller that decides a failure means "draw
 * one fewer band" — never a zero, and never a 500 over a decorative ring.
 *
 * Takes no `userId`: `own_cities_met_in()` has no parameter and reads the
 * caller from the JWT, so there is no version of this that could ask about
 * somebody else.
 */
async function citiesMetInOrNull(supabase: SupabaseClient): Promise<number | null> {
  try {
    return await countCitiesMetIn(supabase);
  } catch (error) {
    console.error("[profile] omitting the cities band after a failed count", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The diagram's accessible description — §8, since the rings themselves are
 * decoration.
 *
 * A `null` count drops its clause rather than reading "0 events attended" or
 * "0 cities". The sentence has to say the same thing the chips do, and the
 * chips omit a band they could not compute — so this is assembled from
 * whichever clauses survived rather than from a fixed template.
 */
function ringSummary(
  name: string,
  connections: number,
  events: number | null,
  cities: number | null,
): string {
  const clauses = [`${connections} ${connections === 1 ? "connection" : "connections"}`];
  if (events !== null) {
    clauses.push(`${events} ${events === 1 ? "event attended" : "events attended"}`);
  }
  if (cities !== null) {
    clauses.push(`${cities} ${cities === 1 ? "city" : "cities"} met people in`);
  }
  return `${name}: ${clauses.join(", ")}.`;
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
