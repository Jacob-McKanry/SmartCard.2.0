import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isAdmin } from "@/server/hosting/host-application-service";
import { listMyBlocks } from "@/server/safety/blocks-service";

import { GLASS } from "../../events/lib/surfaces";
import { UnblockRow } from "./unblock-row";

/**
 * The caller's own blocked-users list (owner decision 4,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`). See
 * `/MapTest/page.tsx`'s header — admin-only, not wired into the real
 * settings page yet.
 */
export const dynamic = "force-dynamic";

export default async function BlockedUsersPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  if (!(await isAdmin(context.supabase))) {
    notFound();
  }

  const blocked = await listMyBlocks(context.supabase);

  return (
    <main
      className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Blocked users
        </h1>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-subtle)" }}>
          {blocked.length} blocked
        </p>
      </header>

      {blocked.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
          <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
            You haven&apos;t blocked anyone.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {blocked.map((person) => (
            <UnblockRow key={person.blockedUserId} person={person} />
          ))}
        </ul>
      )}
    </main>
  );
}
