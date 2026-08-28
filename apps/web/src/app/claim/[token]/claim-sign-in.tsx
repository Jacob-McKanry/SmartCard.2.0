import { LoginLink, RegisterLink } from "@kinde-oss/kinde-auth-nextjs/components";

/**
 * What an unauthenticated visitor sees at `/claim/[token]`.
 *
 * NO EVENT NAME, NO HOST NAME — DELIBERATELY, AND DIFFERENT FROM §4.2'S
 * LITERAL TEXT
 *
 * §4.2 step 2 describes a "claim page, unverified" showing "event and host
 * only, nothing personal". `get_claimable_import` (20260828120000) does not
 * grant `anon` at all — see that migration's header for why a per-caller rate
 * limit needs a caller before anything can be looked up. So there is no way
 * to read even the event name before a session exists, and this screen
 * reflects that rather than working around it: "unverified" in §4.2 means
 * "signed in, but not yet proven to be the person this row is about," never
 * "signed out". A signed-out visitor gets this generic screen and, once
 * signed in, lands right back on this exact URL (`postLoginRedirectURL`
 * below is the page's own path) where the real read happens.
 *
 * WHY THE COPY NAMES NO ONE. This screen runs for every claim link, for every
 * host, for every event — it cannot say whose guest list this is, because it
 * has not looked yet. Saying nothing wrong beats guessing right sometimes.
 */
export function ClaimSignIn({ token }: { token: string }) {
  const selfUrl = `/claim/${encodeURIComponent(token)}`;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[402px] flex-col items-center justify-center gap-[26px] px-[26px] py-10 text-center">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[24px] leading-[28px] font-semibold" style={{ letterSpacing: "-.03em" }}>
          You&rsquo;ve been added to a guest list
        </h1>
        <p className="text-[14px] leading-5" style={{ color: "var(--sc-text-muted)" }}>
          Sign in or create an account with the same email address to see what it&rsquo;s for.
        </p>
      </div>

      <div className="flex w-full flex-col gap-2.5">
        <LoginLink
          postLoginRedirectURL={selfUrl}
          className="flex min-h-11 items-center justify-center rounded-full px-4 py-4 text-[15px] leading-[19px] font-semibold text-white"
          style={{
            background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
            boxShadow: "0 16px 32px -12px rgba(11,96,255,.6)",
          }}
        >
          Sign in
        </LoginLink>
        <RegisterLink
          className="flex min-h-11 items-center justify-center rounded-full px-4 py-[15px] text-[15px] leading-[19px] font-semibold"
          style={{
            border: "1px solid rgba(13,18,32,.12)",
            background: "rgba(255,255,255,.7)",
            color: "var(--sc-text)",
          }}
        >
          Create an account
        </RegisterLink>
      </div>

      <p
        className="max-w-[36ch] text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
      >
        Use the same email address this link was sent to — that&rsquo;s how we match it to you.
      </p>
    </main>
  );
}
