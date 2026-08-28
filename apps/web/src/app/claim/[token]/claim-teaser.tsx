/**
 * `available: true, can_claim: false` — the caller is signed in, the token
 * resolves to a live row, but §3.2/§3.2.1's gate does not hold for THIS
 * account (wrong email, unverified and not grandfathered, or any other
 * reason the gate can fail).
 *
 * WHY THIS SCREEN EXISTS SEPARATELY FROM `ClaimNotAvailable`
 *
 * `get_claimable_import` discloses event name and host name whenever the
 * token itself resolves to a live row, "regardless of `can_claim`"
 * (20260828120000's header): a caller holding the unguessable 244-bit token
 * already knows this much from the claim email itself. So this is not a
 * refusal in the §3.6 sense — the caller is told what the link is for. What
 * it does NOT do is say why claiming failed. "Wrong account", "email not
 * verified yet" and "already claimed by someone else" would each answer a
 * question about someone else's data (whether a given address is on this
 * guest list, whether it already claimed) that this feature exists not to
 * answer — so, same as `ClaimNotAvailable`, the explanation is one fixed
 * sentence for every reason.
 *
 * NO RETRY, NO "TRY A DIFFERENT ACCOUNT" LINK. Signing out and back in with a
 * different address is possible through the ordinary nav, and inventing a
 * shortcut here would suggest this screen knows which address would work,
 * which is exactly the thing it must not disclose.
 */
export function ClaimTeaser({
  eventName,
  hostFirstName,
  hostLastName,
}: {
  eventName: string;
  hostFirstName: string | null;
  hostLastName: string | null;
}) {
  const hostName = [hostFirstName, hostLastName].filter(Boolean).join(" ").trim();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[22px] leading-[26px] font-semibold" style={{ letterSpacing: "-.02em" }}>
        {eventName}
      </h1>
      <p className="text-[14px] leading-5" style={{ color: "var(--sc-text-muted)" }}>
        {hostName !== "" ? `${hostName} says you were on the guest list.` : "You were on the guest list."}
      </p>
      <p
        className="max-w-[34ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
      >
        This link isn&rsquo;t available to claim on the account you&rsquo;re signed in with. If you
        expected it to work, try signing in with the email address it was sent to.
      </p>
    </main>
  );
}
