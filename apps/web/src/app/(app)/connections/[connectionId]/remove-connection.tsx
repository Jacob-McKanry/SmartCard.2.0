"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { removeConnectionAction } from "./actions";

/**
 * Requires a second, explicit click before `removeConnectionAction` ever
 * runs — a two-step confirm built from local component state, the same
 * pattern `SocialLinkListItem`'s edit/view toggle uses in the Profile
 * feature, rather than reaching for a dialog primitive that doesn't exist in
 * `components/ui` yet.
 *
 * The copy here is the one place this feature has to be completely honest
 * about §3.6's one-way RLS transition: there is no "undo" button to build,
 * because no such action exists at any layer below this one. Framing this as
 * anything softer than permanent would be describing a capability the app
 * doesn't have.
 */
export function RemoveConnection({ connectionId, otherName }: { connectionId: string; otherName: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Remove connection
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
      <p className="text-sm text-foreground">
        Remove your connection with {otherName}? This can&rsquo;t be undone from here — reconnecting
        means meeting {otherName} in person again and going through Connect Flow, not tapping a
        button.
      </p>
      <div className="flex gap-2">
        <form action={removeConnectionAction.bind(null, connectionId)}>
          <Button type="submit" variant="destructive" size="sm">
            Yes, remove connection
          </Button>
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
