import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutLink, PortalLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { ChevronRight, CreditCard, Mail, ShieldCheck, type LucideIcon } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getOwnProfile, type OwnProfile } from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import { kindeSiteUrl } from "@/server/env";

import { AvatarDisc } from "../connections/lib/avatar-disc";
import { DeleteAccount } from "./delete-account";
import { SignOutSheet } from "./sign-out-sheet";

/**
 * Settings — `showSettings` in `docs/design/prototypes/Auth flow.dc.html`.
 *
 * WHY THIS SCREEN EXISTS AT ALL: THERE WAS NO WAY TO SIGN OUT
 *
 * `/api/auth/logout` has worked since the auth bridge landed and the SDK ships
 * a `LogoutLink`, but nothing in the app rendered one. A person signed in on a
 * shared or borrowed phone had no way to end the session short of clearing
 * cookies, and a suspended account had no way out of its own error page. That
 * is the single thing this screen is for; everything else on it is context
 * around the one control.
 *
 * ---------------------------------------------------------------------------
 * AMENDMENT (2026-08-15) — "DELETE YOUR ACCOUNT" IS NOW REAL AND IS ON THIS
 * SCREEN. THE LIST BELOW USED TO NAME IT AS THE SECOND OF FOUR LIES.
 *
 * The original reasoning was right and is left in place below in spirit: a row
 * that opens a confirmation and then cannot delete anything is worse than no
 * row, and until this pass `users.status` had a `'deleted'` value with no
 * policy, no action and no service function behind it.
 *
 * What changed is the backend, not the standard.
 * `public.soft_delete_own_account()` (20260815130300) marks the account
 * deleted, revokes its cards, cancels the events it hosts and burns its live
 * presentation sessions in ONE transaction; 20260815130200 makes a deleted row
 * unreadable through the graph. The row below therefore describes something
 * that happens. `settings-honesty.test.tsx`'s ban on this phrase was lifted in
 * the same change rather than worked around, and replaced with an assertion
 * that the copy does not overstate the delete as permanent — because it is not.
 *
 * 20260809211100's line that deletion "must never be one client request away"
 * is honoured rather than overridden: this is not one client request. It is two
 * taps behind the app's shared confirmation panel, and at the database it is a
 * `security definer` function that takes no arguments — `authenticated` still
 * holds no UPDATE grant on `users.status`, so there is no request a client can
 * make that sets that column directly. What that sentence forbids is a writable
 * `status`, and `status` is still not writable.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PROTOTYPE DRAWS THAT IS NOT BUILT HERE, AND WHY EACH ONE IS A LIE
 *
 * §7's "never invent a capability. Copy must not imply otherwise" is the whole
 * argument. Three rows are still dropped, not deferred:
 *
 *  - **"Change your password."** This product is Kinde *passwordless*: sign-in
 *    emails a one-time code and there is no password field anywhere. See the
 *    §5.1 amendment in `docs/architecture/2026-08-09-initial-architecture-proposal.md`,
 *    which records the decision and why switching is a user migration rather
 *    than a settings change. A row offering to change a password that does not
 *    exist is the most direct lie on the screen, so the group instead says
 *    plainly that there is no password — which is the thing a person hunting
 *    for that row actually needs to know.
 *
 *  - **"Download your connections."** No export path exists anywhere in this
 *    codebase, and — asked directly on 2026-08-15 — the project owner declined
 *    to build one in this pass. Still a lie, therefore still absent.
 *
 *  - **Three of the four "what people see" toggles.** "Profile visible to
 *    people you meet", "City visible to mutual connections" and "Event
 *    invitations" have no column behind them, and the first two would be
 *    security controls — a switch that claims to hide your profile and does
 *    nothing is the worst possible thing to ship. `email_opt_in` is the one
 *    real field and it is the one that appears.
 *
 * The cards group is different: it is real, and it is deliberately *elsewhere*.
 * `/activity` already lists your assigned cards with a working two-step revoke
 * and the tap log that gives a revoke decision its context. A second revoke
 * button on a second screen is a second place to keep correct, on the one
 * action in the app that cannot be undone. This screen points at it instead.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;
  const profile = await getOwnProfile(supabase, userId);
  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photo_path);

  /*
   * The portal handler requires an ABSOLUTE return URL: it hands the value to
   * the SDK's `generatePortalUrl`, which throws on anything `new URL()` cannot
   * parse, and the handler's catch then redirects home without a word. A
   * relative "/settings" would therefore look like the portal silently
   * bouncing you to Home. Built from `KINDE_SITE_URL`, the same variable the
   * SDK builds its own redirect URI from.
   */
  const portalReturnUrl = `${kindeSiteUrl()}/settings`;

  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-5 pt-5 sm:px-7 sm:pt-8"
      style={{ animation: "sc-rise .45s var(--sc-ease-glide) both" }}
    >
      <h1 className="text-[30px] leading-[34px] font-semibold" style={{ letterSpacing: "-.035em" }}>
        Settings
      </h1>

      <IdentityCard profile={profile} photoUrl={photoUrl} />

      <Group label="SIGNING IN">
        <Panel>
          {/*
           * The honest home for "manage my account", and the reason it is
           * labelled this vaguely rather than promising a specific control:
           * what the portal offers is decided by the sign-in service, not by
           * SmartCard, so naming any one thing it contains would be a claim
           * this app cannot keep true.
           */}
          <RowShell>
            <PortalLink returnUrl={portalReturnUrl} className={ROW_CLASS}>
              <RowBody
                icon={ShieldCheck}
                title="Manage your account"
                detail="Opens the secure sign-in service that holds your account, then sends you back here."
              />
              <Chevron />
            </PortalLink>
          </RowShell>
          <RowShell last>
            <div className={ROW_CLASS}>
              <RowBody icon={Mail} title="Email address" detail={profile.email} />
              <Badge>Locked</Badge>
            </div>
          </RowShell>
        </Panel>
        {/*
         * The line the prototype's "Change your password" row should have been.
         * COUPLED TO A DASHBOARD SETTING, NOT TO THIS CODEBASE: sign-in method
         * is configured in Kinde, and the §5.1 amendment records the 2026-08-14
         * decision to stay passwordless for the pilot. If that is ever changed,
         * this sentence becomes false and has to change with it.
         */}
        <Footnote>
          There is no password to change. Signing in emails you a one-time code instead, so this
          account has no password for anyone to guess, reuse or steal.
        </Footnote>
      </Group>

      <Group label="WHAT PEOPLE SEE">
        <Panel>
          {/*
           * A reading with a route to the control, not a control. The same call
           * Profile made, for the same reason, and here there is a second: the
           * only Server Action that writes this column
           * (`profile/actions.ts#updateProfileAction`) submits the whole
           * profile form, so a lone toggle posting to it would blank out every
           * other field it did not carry. Making this switchable in place is a
           * small new action, not a re-use of an existing one, and inventing a
           * write path was out of scope for this pass.
           */}
          <RowShell last>
            <Link href="/profile/edit#details" className={ROW_CLASS}>
              <RowBody
                icon={Mail}
                title="Occasional emails"
                /*
                 * §8: the state is spelled out in words, not carried by a
                 * colour or a knob position — the same call Profile's reading
                 * of this field makes.
                 */
                detail={`${profile.email_opt_in ? "On" : "Off"}. Change it on Edit profile.`}
              />
              <Chevron />
            </Link>
          </RowShell>
        </Panel>
        <Footnote>
          There is no visibility setting, because there is nothing to hide from: your profile is
          shown identically to everyone you have met in person, and there is no public version, no
          profile link and no way for a stranger to reach it.
        </Footnote>
      </Group>

      <Group label="YOUR CARDS">
        <Panel>
          <RowShell last>
            <Link href="/activity" className={ROW_CLASS}>
              <RowBody
                icon={CreditCard}
                title="Your cards"
                detail="Revoke a card, and read the log of every tap, on Activity."
              />
              <Chevron />
            </Link>
          </RowShell>
        </Panel>
      </Group>

      <Group label="ACCOUNT">
        <Panel>
          <RowShell last>
            <DeleteAccount />
          </RowShell>
        </Panel>
        {/*
         * The footnote states a rule, so it gets `--text-muted` like the other
         * two. It says the reversible part out loud OUTSIDE the confirmation as
         * well as inside it, because the person deciding whether to tap the row
         * is reading this line, not the panel they have not opened yet — and
         * "soft" is the entire difference between this and the thing they are
         * probably imagining.
         */}
        <Footnote>
          Deleting is reversible by an administrator: nothing is erased, your connections and
          meeting history stay, and your account can be switched back on. Your cards do not switch
          themselves back on — you do that from Activity.
        </Footnote>
      </Group>

      <SignOutSheet
        logoutLink={
          <LogoutLink
            className="flex min-h-11 w-full items-center justify-center rounded-full px-4 py-3.5 text-[14px] leading-[18px] font-semibold text-white"
            style={{ background: "var(--sc-text)" }}
          >
            Sign out
          </LogoutLink>
        }
      />
    </main>
  );
}

/* ---------------------------------------------------------------- identity */

/**
 * Who you are signed in as. The photo and name come from the same place
 * Profile draws them, through the same `AvatarDisc`, so the two screens cannot
 * drift into two different pictures of one person.
 */
function IdentityCard({ profile, photoUrl }: { profile: OwnProfile; photoUrl: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] border p-[15px]" style={GLASS}>
      <AvatarDisc size={48} fontSize={16} initials={initialsFor(profile)} photoUrl={photoUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-5 font-semibold">
          {fullName(profile)}
        </span>
        <span
          className="block truncate font-mono text-[11.5px] leading-4 font-medium"
          style={{ color: "var(--sc-text-subtle)" }}
        >
          {profile.email}
        </span>
      </span>
      <Link
        href="/profile/edit"
        className="flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-[12.5px] leading-4 font-semibold"
        style={{
          border: "1px solid rgba(13,18,32,.12)",
          background: "rgba(255,255,255,.9)",
          color: "var(--sc-text)",
        }}
      >
        Edit
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------- parts */

const GLASS: React.CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  borderColor: "var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

/**
 * One shape for every row, tappable or not — the three links on this screen are
 * a Next `Link`, another Next `Link` and the SDK's `PortalLink`, which have
 * nothing in common but an `<a>` and a `className`, so the shape has to live in
 * the class rather than in a wrapper component.
 *
 * `min-h-14` (56px) rather than `min-h-11`: §8's floor is 44px, and these rows
 * carry two lines of text, so the floor is the minimum rather than the target.
 */
const ROW_CLASS = "flex min-h-14 w-full items-center gap-[11px] px-[15px] py-3.5 text-left";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={titleCase(label)} className="flex flex-col gap-2">
      <span
        className="pl-1 font-mono text-[9.5px] leading-[13px] font-medium"
        style={{ letterSpacing: ".14em", color: "var(--sc-text-subtle)" }}
      >
        {label}
      </span>
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[22px] border" style={GLASS}>
      {children}
    </div>
  );
}

/**
 * §8: any text stating a rule is `--text-muted` or darker, never
 * `--text-subtle`. Both footnotes on this screen state rules — one about what
 * this account has instead of a password, one about who can see a profile — so
 * neither gets the decorative grey the prototype uses for them. Same call
 * `/events` and `/connections` made for their own footnotes.
 */
function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="pl-1 text-[11.5px] leading-4"
      style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
    >
      {children}
    </p>
  );
}

/** Carries the hairline between rows. `last` drops it, so panels never end on one. */
function RowShell({ last = false, children }: { last?: boolean; children: React.ReactNode }) {
  return (
    <div style={last ? undefined : { borderBottom: "1px solid rgba(13,18,32,.055)" }}>
      {children}
    </div>
  );
}

/** The icon and two lines of text every row shares, whatever wraps it. */
function RowBody({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <>
      <Icon
        size={15}
        strokeWidth={1.9}
        aria-hidden
        className="shrink-0"
        style={{ color: "var(--sc-text-muted)" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] leading-[18px] font-medium">{title}</span>
        <span
          className="block truncate text-[11.5px] leading-4"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {detail}
        </span>
      </span>
    </>
  );
}

function Chevron() {
  return (
    <ChevronRight
      size={14}
      strokeWidth={2.2}
      aria-hidden
      className="shrink-0"
      style={{ color: "var(--sc-text-subtle)" }}
    />
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 rounded-lg px-2.5 py-[5px] text-[10.5px] leading-[14px] font-semibold"
      style={{ background: "rgba(13,18,32,.05)", color: "var(--sc-text-muted)" }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- derivation */

function titleCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** Matches Profile's own fallback: the email's local part, never a placeholder word. */
function fullName(profile: OwnProfile): string {
  const full = `${profile.first_name?.trim() ?? ""} ${profile.last_name?.trim() ?? ""}`.trim();
  return full !== "" ? full : (profile.email.split("@")[0] ?? profile.email);
}

function initialsFor(profile: OwnProfile): string {
  const first = profile.first_name?.trim().charAt(0) ?? "";
  const last = profile.last_name?.trim().charAt(0) ?? "";
  const fromName = `${first}${last}`.toUpperCase();
  return fromName !== "" ? fromName : profile.email.slice(0, 2).toUpperCase();
}
