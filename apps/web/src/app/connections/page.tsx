import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { listOwnConnections, type ConnectionListItem } from "@/server/connections/connections-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { displayName, formatOccurredAt, initialsFor, verificationMethodLabel } from "./lib/format";

/**
 * The connections list (README build order item 3): every `active`
 * connection the signed-in user has, per the task doc's "A connections list"
 * section. Each row is a link into `/connections/[connectionId]`, the
 * meeting-record view.
 *
 * WHY THIS IS THE CALLER'S OWN LIST ONLY, WITH NO WAY TO BROWSE ANYONE
 * ELSE'S
 *
 * `listOwnConnections` derives everything from the caller's own RLS-bound
 * client and never takes a `userId` argument for whose graph to read — same
 * posture as `getOwnProfile` in the Profile feature, and for the same
 * reason: CLAUDE.md's non-negotiable product rule forbids anything that
 * looks like a directory, and a "view someone else's connections" route
 * would be exactly that, reachable from nothing but a URL.
 */
export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const context = await getAuthenticatedContext();

  if (context === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Sign in to see your connections</h1>
        <p className="text-sm text-muted-foreground">
          Every connection here came from an in-person tap or a GPS-verified scan — sign in to see who
          you&rsquo;ve met.
        </p>
        <LoginLink postLoginRedirectURL="/connections">
          <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            Sign in with Kinde
          </span>
        </LoginLink>
      </main>
    );
  }

  const { supabase, userId } = context;
  const connections = await listOwnConnections(supabase, userId);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Your connections</h1>
        <p className="text-sm text-muted-foreground">
          Everyone you&rsquo;ve connected with in person. There&rsquo;s no way to browse anyone else&rsquo;s.
        </p>
      </header>

      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No connections yet — tap an NFC card or scan a QR code in person to connect with someone.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {connections.map((connection) => (
            <ConnectionListRow key={connection.connectionId} connection={connection} supabase={supabase} />
          ))}
        </ul>
      )}
    </main>
  );
}

async function ConnectionListRow({
  connection,
  supabase,
}: {
  connection: ConnectionListItem;
  supabase: SupabaseClient;
}) {
  const name = displayName(connection.otherUser);
  const photoUrl = await signedProfilePhotoUrl(supabase, connection.otherUser.photo_path);

  return (
    <li>
      <Link
        href={`/connections/${connection.connectionId}`}
        className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-accent"
      >
        <Avatar>
          <AvatarImage src={photoUrl ?? undefined} alt="" />
          <AvatarFallback>{initialsFor(connection.otherUser)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {verificationMethodLabel(connection.verificationMethod)} &middot;{" "}
            {formatOccurredAt(connection.occurredAt)}
          </div>
        </div>
      </Link>
    </li>
  );
}
