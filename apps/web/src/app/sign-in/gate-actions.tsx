"use client";

import { useCallback, useState } from "react";
import { Lock, QrCode } from "lucide-react";

/**
 * The two buttons on the sign-in gate, plus the handoff interstitial the
 * prototype's `isHandoff` state draws (`docs/design/prototypes/Auth flow.dc.html`).
 *
 * WHY THE INTERSTITIAL EXISTS, IN THE DESIGN'S OWN WORDS
 *
 * "Today this is an unannounced redirect — you tap and the address bar changes
 * to a domain you've never seen, which is exactly what a phishing flow looks
 * like. Naming the destination first costs one moment and buys trust." The
 * screen a person is thrown to is not `smartcard.tech`, and nothing prepares
 * them for that. `destinationHost` is the host of `KINDE_ISSUER_URL`, which is
 * the host the login endpoint redirects to — so the claim this screen makes is
 * one the next address bar will confirm, not a reassurance.
 *
 * WHY IT COSTS NOTHING — NO EXTRA ROUTE, NO EXTRA WAIT
 *
 * The prototype draws this as its own step, which would mean a page between the
 * tap and the redirect. It is built instead as a state of the gate itself: the
 * anchors are ordinary links to `/api/auth/{login,register}`, and this component
 * only paints over the blank moment the browser is already spending on that
 * navigation. Nothing is delayed and nothing waits for a second tap.
 *
 * WHY THE LINKS ARE PASSED IN AS ELEMENTS RATHER THAN IMPORTED HERE
 *
 * `LoginLink`/`RegisterLink` build their `href` from `process.env` at module
 * scope (`KINDE_AUTH_API_PATH`, `KINDE_AUTH_LOGIN_ROUTE`, and — for
 * `LoginLink`'s absolute-URL rewrite — `KINDE_SITE_URL`). None of those carry a
 * `NEXT_PUBLIC_` prefix, so in a browser bundle they resolve to `undefined` and
 * the components fall back to defaults that happen to be right today and would
 * silently stop being right the day one of them is set. Rendering them on the
 * server and passing the elements down means the real values are always used.
 *
 * The click is caught by listening for it as it bubbles out of the anchor,
 * which is also why this wrapper works at all without re-rendering the link:
 * a Server Component element passed as a prop is opaque to this component.
 *
 * IF JAVASCRIPT NEVER RUNS, NOTHING IS LOST. The interstitial is additive —
 * the anchors underneath are plain links and still navigate.
 */
export function GateActions({
  signIn,
  createAccount,
  destinationHost,
}: {
  /** A server-rendered `<LoginLink>`. */
  signIn: React.ReactNode;
  /** A server-rendered `<RegisterLink>`. */
  createAccount: React.ReactNode;
  /** Host of `KINDE_ISSUER_URL`, e.g. `smartcard.kinde.com`. */
  destinationHost: string;
}) {
  const [leaving, setLeaving] = useState(false);

  /*
   * Only a plain left-click that is actually going to navigate this tab should
   * paint the interstitial. A modifier-click opens a new tab and leaves this
   * one exactly where it is, so showing "one moment" would strand the page in
   * a state nothing ever clears.
   */
  const onClick = useCallback((event: React.MouseEvent<HTMLSpanElement>) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setLeaving(true);
  }, []);

  return (
    <>
      <div className="flex w-full flex-col gap-2.5">
        <span onClick={onClick} className="contents">
          {signIn}
        </span>
        <span onClick={onClick} className="contents">
          {createAccount}
        </span>
      </div>

      {leaving ? <Handoff destinationHost={destinationHost} /> : null}
    </>
  );
}

/**
 * `isHandoff`, drawn over the gate rather than instead of it: the app's mark, a
 * pulse, a lock, and the host the browser is on its way to.
 *
 * `aria-live="polite"` rather than a dialog role — nothing here is
 * interactive, there is nothing to dismiss, and the page is about to be
 * replaced. It is an announcement, not a modal.
 */
function Handoff({ destinationHost }: { destinationHost: string }) {
  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-[22px] px-8 text-center"
      style={{
        background: "rgba(241,244,250,.92)",
        backdropFilter: "blur(18px) saturate(1.4)",
        WebkitBackdropFilter: "blur(18px) saturate(1.4)",
        animation: "sc-rise .4s var(--sc-ease-glide) both",
      }}
    >
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex size-[52px] items-center justify-center rounded-[17px] text-white"
          style={{ background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))" }}
        >
          <QrCode size={24} strokeWidth={2} />
        </span>
        <span aria-hidden className="flex gap-1">
          {[0, 0.18, 0.36].map((delay) => (
            <span
              key={delay}
              className="size-[5px] rounded-full"
              style={{
                background: "var(--sc-accent)",
                animation: `sc-halo 1.4s ease-in-out ${delay}s infinite`,
              }}
            />
          ))}
        </span>
        <span
          aria-hidden
          className="flex size-[52px] items-center justify-center rounded-[17px] border"
          style={{
            background: "rgba(255,255,255,.75)",
            borderColor: "rgba(13,18,32,.08)",
            color: "var(--sc-text-subtle)",
          }}
        >
          <Lock size={22} strokeWidth={1.9} />
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-[20px] leading-[25px] font-semibold" style={{ letterSpacing: "-.025em" }}>
          One moment
        </h2>
        <p
          className="max-w-[30ch] text-[13.5px] leading-5"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Taking you to the secure sign-in page. Your address bar should read:
        </p>
        {/*
         * Mono, because §2 puts "any value a user would copy" there — and this
         * is a value a person is being asked to *read and compare*, which wants
         * the same unambiguous letterforms. It is `--sc-text` rather than a
         * muted grey because §8 puts anything stating a rule at muted or
         * darker, and "the next page should say exactly this" is a rule.
         */}
        <p className="font-mono text-[13px] leading-[18px] font-medium break-all">
          {destinationHost}
        </p>
      </div>
    </div>
  );
}
