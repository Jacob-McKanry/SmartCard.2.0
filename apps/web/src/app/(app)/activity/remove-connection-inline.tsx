"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { removeConnectionFromActivityAction } from "./actions";

/**
 * The Activity page's own two-step-confirm remove-connection control.
 * Functionally identical to `RemoveConnection` in the connections detail
 * feature, kept as a separate small component rather than imported across
 * routes because that one redirects to `/connections` on success — right for
 * a page with nothing left to show once the connection is gone, wrong here,
 * where the Activity list is what should re-render in place.
 */
export function RemoveConnectionInline({
  connectionId,
  otherName,
}: {
  connectionId: string;
  otherName: string;
}) {
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
        means meeting {otherName} in person again and going through Connect Flow, not tapping a button.
      </p>
      <div className="flex gap-2">
        <form action={removeConnectionFromActivityAction.bind(null, connectionId)}>
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
