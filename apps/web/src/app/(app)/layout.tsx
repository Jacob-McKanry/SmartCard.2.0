import { AppShell } from "./app-shell";

/**
 * The layout for every signed-in screen under `(app)/`. The gate itself —
 * sign-in redirect, auth failure screens, the onboarding redirect and the nav
 * — lives in `AppShell`, whose header documents each job. It moved there so
 * `app/page.tsx` (the shared `/` route: landing page signed out, Home signed
 * in) can run the identical gate without a second copy of it.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
