import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getOwnProfile,
  listOwnSocialLinks,
  type OwnProfile,
} from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { ProfileForm } from "./profile-form";
import { SocialLinksSection } from "./social-links-section";
import { PhotoUploader } from "./photo-uploader";

/**
 * The Profile screen: view + edit of the signed-in user's own identity.
 *
 * ONE IDENTITY, SHOWN IDENTICALLY TO EVERYONE — NO PERSONA SPLIT
 *
 * §2.1 / §3 of the product spec: "One profile identity per user, shown
 * identically to everyone. No personal/professional split." There is
 * therefore exactly one render path below, not a "your own view" vs. "public
 * view" branch — because there is no second view to branch to.
 *
 * WHY THIS IS "MY OWN PROFILE" ONLY, WITH NO `/profile/[userId]`
 *
 * Deliberately out of scope for this pass, not a shortcut: viewing *someone
 * else's* profile needs its own access-control logic (the graph-gated
 * `users` select policy already allows reading a connection's row — see
 * 20260809211100 — but there is no UI consumer of that yet), and there is no
 * graph to view through in the first place until Connect Flow exists (build
 * order in README.md: Profile, then Connect Flow). Building a generic viewer
 * route now would be scope invented ahead of what the product can actually
 * use it for.
 *
 * WHY THERE'S NO SIGN-IN SCREEN HERE ANYMORE
 *
 * `(app)/layout.tsx` now runs this exact check once for every page in this
 * group and redirects a signed-out visitor to `/sign-in` before this
 * component ever runs. The `context === null` branch below is TypeScript
 * narrowing, not a reachable UI state — `getAuthenticatedContext()` is
 * `cache()`-memoized (see its header), so this is the same call the layout
 * already made, not a second verify-and-mint.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 p-6 sm:p-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          Shown identically to every connection — there&rsquo;s no separate public view, and no way
          for a stranger to find this page.
        </p>
      </header>

      <section aria-labelledby="photo-heading" className="flex flex-col gap-3">
        <h2 id="photo-heading" className="text-sm font-medium text-muted-foreground">
          Photo
        </h2>
        <PhotoUploader
          photoUrl={photoUrl}
          initials={initialsFor(profile)}
          hasPhoto={profile.photo_path !== null}
        />
      </section>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="text-sm font-medium text-muted-foreground">
          Details
        </h2>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{profile.email}</span> — tied
          to your sign-in, not editable here.
        </p>
        <ProfileForm profile={profile} />
      </section>

      <section aria-labelledby="links-heading" className="flex flex-col gap-3">
        <h2 id="links-heading" className="text-sm font-medium text-muted-foreground">
          Social links
        </h2>
        <SocialLinksSection links={socialLinks} />
      </section>
    </main>
  );
}

function initialsFor(profile: Pick<OwnProfile, "first_name" | "last_name" | "email">): string {
  const first = profile.first_name?.trim().charAt(0) ?? "";
  const last = profile.last_name?.trim().charAt(0) ?? "";
  const fromName = `${first}${last}`.toUpperCase();
  return fromName !== "" ? fromName : profile.email.slice(0, 2).toUpperCase();
}
