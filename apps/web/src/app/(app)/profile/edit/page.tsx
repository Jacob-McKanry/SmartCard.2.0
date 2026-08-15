import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getOwnProfile,
  listOwnSocialLinks,
  type OwnProfile,
} from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { ProfileForm } from "../profile-form";
import { SocialLinksSection } from "../social-links-section";
import { PhotoUploader } from "../photo-uploader";

/**
 * Editing your own profile — the forms that used to sit on `/profile` itself.
 *
 * WHY THEY MOVED HERE
 *
 * `docs/design/DESIGN.md` §6 specifies Profile as a *viewing* screen with "a
 * floating Edit pill bottom-right above the dock", which only means something if
 * there is somewhere for the pill to go. Nothing about the forms changed in the
 * move: same three components, same Server Actions, same validation, same RLS.
 * Only the route they render on is new.
 *
 * WHY THIS IS ITS OWN PAGE AND NOT A SHEET OVER THE PROFILE
 *
 * §5 has sheets, and a sheet would have been closer to the phone idiom. It would
 * also have meant either duplicating the form components into a client-rendered
 * overlay or holding the whole edit surface mounted behind the viewing screen on
 * every profile visit. A route keeps the forms exactly as they were — Server
 * Components rendering Server Actions, with no client state coordinating them —
 * and means an interrupted edit has a URL to come back to.
 *
 * §7's honesty rules apply here as much as anywhere: this page never claims a
 * save is undoable, and the destructive control it does carry (removing a photo)
 * is the one that already existed and already says exactly what it does.
 */
export const dynamic = "force-dynamic";

export default async function ProfileEditPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  const [profile, socialLinks] = await Promise.all([
    getOwnProfile(supabase, userId),
    listOwnSocialLinks(supabase, userId),
  ]);
  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photo_path);

  return (
    <main
      className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-5 pt-5 sm:px-7 sm:pt-8"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <div className="flex flex-col gap-2">
        <Link
          href="/profile"
          className="-ml-1 flex min-h-11 w-fit items-center gap-1.5 pr-2 text-[13px] leading-[18px] font-medium"
          style={{ color: "var(--sc-text-muted)" }}
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          Profile
        </Link>
        <h1 className="text-[30px] leading-[34px] font-semibold" style={{ letterSpacing: "-.03em" }}>
          Edit profile
        </h1>
        <p
          className="max-w-[52ch] text-[14px] leading-5"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Everything here is shown identically to every connection. There is no separate public
          version to keep in step, and nothing on this page is visible to anyone you haven&rsquo;t
          met.
        </p>
      </div>

      <Panel title="Photo" id="photo">
        <PhotoUploader
          photoUrl={photoUrl}
          initials={initialsFor(profile)}
          hasPhoto={profile.photo_path !== null}
        />
      </Panel>

      <Panel title="Details" id="details">
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          Signed in as{" "}
          <span className="font-medium" style={{ fontFamily: "var(--font-geist-mono)" }}>
            {profile.email}
          </span>{" "}
          — tied to your sign-in, not editable here.
        </p>
        <ProfileForm profile={profile} />
      </Panel>

      <Panel title="Links" id="links">
        <SocialLinksSection links={socialLinks} />
      </Panel>
    </main>
  );
}

/**
 * §2's standard glass, §2's card radius. The forms inside are the shadcn
 * primitives, which point at the same tokens (see the note at the top of
 * `globals.css` about re-pointing rather than deleting them), so a shadcn Input
 * and this panel share one accent and one text colour.
 */
function Panel({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      id={id}
      className="flex scroll-mt-6 flex-col gap-3.5 rounded-[24px] border p-5"
      style={{
        background: "var(--sc-glass-bg)",
        backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        borderColor: "var(--sc-glass-bd)",
        boxShadow: "var(--sc-glass-sh)",
      }}
    >
      <h2
        id={`${id}-heading`}
        className="text-[15px] leading-5 font-semibold"
        style={{ letterSpacing: "-.01em" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function initialsFor(profile: Pick<OwnProfile, "first_name" | "last_name" | "email">): string {
  const first = profile.first_name?.trim().charAt(0) ?? "";
  const last = profile.last_name?.trim().charAt(0) ?? "";
  const fromName = `${first}${last}`.toUpperCase();
  return fromName !== "" ? fromName : profile.email.slice(0, 2).toUpperCase();
}
