import { LoginLink, RegisterLink } from "@kinde-oss/kinde-auth-nextjs/components";

/**
 * What `/card/<code>` renders for a SIGNED-OUT visitor when the code names a
 * real card that nobody owns.
 *
 * This screen did not exist before 2026-08-21, and neither did the state it
 * represents. 6,809 of the 7,142 imported cards are blank stock, and until now
 * every one of them rendered the same "Nothing here" as a garbage code. The
 * physical inventory was unusable to anybody outside the 2026-08-13 legacy
 * import.
 *
 * WHY THIS SCREEN EXISTS AT ALL IS A DELIBERATE DISCLOSURE DECISION. Showing it
 * tells whoever holds the URL that the code is real and unclaimed, which the
 * single-refusal rule in `card-preview-service.ts` spent a lot of words
 * avoiding. The reversal, its cost, and what was NOT reversed alongside it
 * (`revoked` in particular) are recorded at `resolveCardCodeLanding` and in
 * §4.7 threat 1 — not here, because a component is the wrong place for a
 * threat-model decision to live.
 *
 * THERE IS NO SIGNED-IN TWIN OF THIS COMPONENT, ON PURPOSE. A signed-in visitor
 * still gets the redeem flow, which offers to set the card up only after the
 * tap has actually been refused (`card-redeem-flow.tsx`). Pre-checking the
 * card's status for a signed-in caller would have meant either a second
 * lookup-by-code path — the thing 20260809210200 forbids — or spending the
 * anonymous preview budget on an authenticated tap, which would let 20 taps an
 * hour starve real previews of the same card.
 *
 * §7'S HONESTY RULE, APPLIED TO A CARD RATHER THAN A FEATURE. The copy must not
 * imply the card is *already* theirs, and must not promise that claiming will
 * succeed. Two people can be looking at the same code — a claim is decided by
 * the database at the moment it is made (20260821120000's `WHERE status =
 * 'unassigned'`), not by this page having rendered.
 */
export function BlankCardSignedOut({ claimUrl }: { claimUrl: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-[22px] leading-[26px] font-semibold" style={{ letterSpacing: "-.02em" }}>
        A blank SmartCard
      </h1>
      <p
        className="max-w-[34ch] text-[14px] leading-[20px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Nobody has set this card up yet. Create an account and it becomes yours &mdash; anyone who
        taps it afterwards sees your profile.
      </p>

      {/*
        Both links carry the SAME post-login redirect: back to this exact card.
        A card URL is permanent, so unlike the rotating QR at `/c/<token>` there
        is no risk of returning somebody to a dead code — and dropping them on a
        generic landing page would lose the card they were holding, which is the
        whole reason `/card/[code]` sits outside the `(app)` route group.
      */}
      <div className="flex w-full flex-col items-stretch gap-2.5">
        <RegisterLink postLoginRedirectURL={claimUrl}>
          <span
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-[14px] font-semibold text-white"
            style={{
              background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
              boxShadow: "0 12px 28px -12px rgba(11,96,255,.55)",
            }}
          >
            Create an account
          </span>
        </RegisterLink>

        <LoginLink postLoginRedirectURL={claimUrl}>
          <span
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border px-5 text-[14px] font-semibold"
            style={{
              background: "rgba(255,255,255,.72)",
              borderColor: "rgba(13,18,32,.12)",
              color: "var(--sc-text)",
            }}
          >
            I already have one
          </span>
        </LoginLink>
      </div>
    </main>
  );
}
