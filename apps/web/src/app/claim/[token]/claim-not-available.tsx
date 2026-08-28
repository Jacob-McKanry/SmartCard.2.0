/**
 * The one refusal screen for the claim flow, rendered for every reason a
 * claim link can fail — no such token, expired, already claimed, or a
 * rate-limited/failed lookup. No props, deliberately, mirroring
 * `PreviewNotFound` (`non-user-preview.tsx`): §3.6 requires the refusals
 * behind `get_claimable_import`'s `{available: false}` to be indistinguishable,
 * and that property is only real if the bytes rendered for each of them are
 * also identical. A component that took a "reason" prop would be the one
 * place that promise gets broken by a screen instead of a query.
 *
 * This is also the screen a caller with `can_claim: false` sees AFTER the
 * teaser (`claim-teaser.tsx`) — see that file for why the two are different
 * components rather than one: the teaser discloses event and host name
 * (already knowable from possessing the token), this one discloses nothing.
 */
export function ClaimNotAvailable() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[22px] leading-[26px] font-semibold" style={{ letterSpacing: "-.02em" }}>
        This link isn&rsquo;t available
      </h1>
      <p
        className="max-w-[34ch] text-[14px] leading-[20px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        It may have expired, already been used, or not apply to your account. If you think that
        isn&rsquo;t right, ask whoever added you to the guest list to resend it.
      </p>
    </main>
  );
}
