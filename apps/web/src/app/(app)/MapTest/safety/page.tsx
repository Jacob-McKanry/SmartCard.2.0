import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isAdmin } from "@/server/hosting/host-application-service";

import { GLASS } from "../../events/lib/surfaces";

/**
 * The required in-app safety page (brief §11: "published contact information
 * inside the app"). See `/MapTest/page.tsx`'s header — admin-only preview.
 *
 * The contact line below is a placeholder, deliberately, rather than a made-up
 * address: `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`
 * open question L4 names this as blocking Phase 2 — the owner needs to supply
 * real published contact details before this page (or anything that links to
 * it) goes live.
 */
export const dynamic = "force-dynamic";

export default async function SafetyPreviewPage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  if (!(await isAdmin(context.supabase))) {
    notFound();
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">Safety</h1>
      </header>

      <Section title="Report and block">
        SmartCard is for people you&apos;ve actually met, or arranged to meet.
        If someone makes you uncomfortable, you can report them and block
        them — blocking removes them from your connections and hides you
        from each other everywhere in the app. They&apos;re never told you did
        this.
      </Section>

      <Section title="What happens after you report">
        A real person reviews every report within 24 hours. We may remove
        content, suspend the account, or take no action — you&apos;ll keep the
        same confirmation either way, since the review itself isn&apos;t
        something we can show you live.
      </Section>

      <Section title="18 and over">
        SmartCard requires everyone to confirm they are 18 or older before
        using the app.
      </Section>

      <Section title="Contact us">
        {/* TODO(owner): replace with real published contact details before launch. */}
        <span style={{ color: "#dc2626" }}>
          [Placeholder — the owner needs to supply a real published contact
          address/email before this page can go live. See amendment open
          question L4.]
        </span>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
      <h2 className="text-[15px] leading-5 font-semibold">{title}</h2>
      <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
        {children}
      </p>
    </section>
  );
}
