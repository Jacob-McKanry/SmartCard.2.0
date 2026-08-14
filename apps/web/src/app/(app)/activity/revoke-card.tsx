"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { revokeCardAction } from "./actions";

/**
 * Requires a second, explicit click before `revokeCardAction` ever runs —
 * same two-step confirm pattern as `RemoveConnection` in the connections
 * feature, for the same reason: this is the irreversible-from-this-UI kill
 * switch §4.5 names for a lost or stolen card.
 *
 * The RLS policy behind this action also permits reversing it
 * (`revoked -> assigned`, an owner un-revoking their own card), but no
 * restore action exists anywhere in this app yet — that's a deliberate scope
 * cut for this pass, not a gap being papered over, and the copy below says so
 * rather than implying a permanence the database doesn't actually enforce.
 */
export function RevokeCard({ cardId, cardCode }: { cardId: string; cardCode: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Revoke card
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
      <p className="text-sm text-foreground">
        Revoke card {cardCode}? It will stop working immediately — nobody, including you, will be able
        to tap it to connect. There&rsquo;s no restore button in the app yet, so treat this as permanent
        for now.
      </p>
      <div className="flex gap-2">
        <form action={revokeCardAction.bind(null, cardId)}>
          <Button type="submit" variant="destructive" size="sm">
            Yes, revoke card
          </Button>
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
