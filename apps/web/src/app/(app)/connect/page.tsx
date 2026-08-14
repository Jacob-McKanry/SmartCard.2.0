import { ConnectToggle } from "./connect-toggle";

/**
 * `/connect` — the single entry point for the QR half of Connect Flow.
 * Used to be two pages (`/connect/present`, `/connect/scan`); see
 * `connect-toggle.tsx` for why this is now one screen with an in-place
 * toggle instead. The auth gate for this whole group lives in
 * `(app)/layout.tsx`; this page assumes it already ran.
 *
 * NFC has no equivalent screen here on purpose — a tapped card redeems
 * itself via `/card/[code]`, which needs no UI of its own to get to.
 */
export const dynamic = "force-dynamic";

export default function ConnectPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 sm:p-10">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold">Connect</h1>
      </header>
      <ConnectToggle />
    </main>
  );
}
