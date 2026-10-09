import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isAdmin } from "@/server/hosting/host-application-service";

import { GLASS } from "../events/lib/surfaces";

/**
 * `/MapTest` — the isolated, admin-gated harness for the live-map amendment
 * (`docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`, §9).
 *
 * THIS IS THE ONLY WAY TO REACH ANYTHING THIS AMENDMENT BUILDS. Per the
 * owner's explicit instruction, nothing it builds is linked from the real
 * nav or any existing page until the owner tests it here and says to bring
 * it live — at which point a separate, later change adds real nav entries
 * and flips `app_config.map_enabled`. This route, and everything under it,
 * stops existing (or stops mattering) the day that happens.
 *
 * THE SAME TWO-GATE SHAPE `/admin/host-applications` USES
 *
 *  1. Every RPC this route's pages call re-derives admin status itself
 *     (`private.is_admin()`) and fails closed — that is the real
 *     enforcement, and it holds even if this file were deleted.
 *  2. `isAdmin(...)` here decides ROUTING: a non-admin, or anyone not
 *     signed in, gets the same `notFound()` a stranger gets for a route
 *     that does not exist — so guessing this URL does not even confirm it
 *     exists.
 *
 * Add a link here for each new piece of this amendment as later phases land
 * (map, hangouts, messages, requests) — this page is deliberately just a
 * list, so that growing it is one line, not a redesign.
 */
export const dynamic = "force-dynamic";

export default async function MapTestIndexPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  if (!(await isAdmin(context.supabase))) {
    notFound();
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Live map — test harness
        </h1>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-subtle)" }}>
          Admin-only. Nothing here is reachable from the real app yet — see
          docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        <TestLink
          href="/MapTest/age-gate-preview"
          title="Age & terms gate"
          description="Preview the 18+/terms gate screen."
        />
        <TestLink
          href="/MapTest/blocked"
          title="Blocked users"
          description="Your blocked-users list. Unblock from here."
        />
        <TestLink
          href="/MapTest/safety"
          title="Safety page"
          description="The required in-app safety/contact page."
        />
        <TestLink
          href="/MapTest/admin/reports"
          title="Admin: reports queue"
          description="Open reports, sorted by SLA deadline."
        />
      </ul>
    </main>
  );
}

function TestLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <li>
      <a
        href={href}
        className="flex flex-col gap-1 rounded-[22px] p-[17px]"
        style={GLASS}
      >
        <span className="text-[14px] leading-[19px] font-semibold">{title}</span>
        <span className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
          {description}
        </span>
      </a>
    </li>
  );
}
