import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";

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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center gap-6 px-5 py-10">
      <section
        className="flex flex-col items-center gap-4 rounded-[28px] border p-7 text-center"
        style={glassSurface}
      >
        <span
          className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full text-[22px] font-semibold"
          style={{
            background: "linear-gradient(140deg, rgba(11,96,255,.16), rgba(124,58,237,.14))",
            color: "var(--sc-accent-deep)",
            lineHeight: 1,
          }}
        >
          {preview.photoUrl === null ? (
            <span aria-hidden>{previewInitials(preview)}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL, not a static asset next/image can optimise.
            <img src={preview.photoUrl} alt="" className="size-full object-cover" />
          )}
        </span>

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
