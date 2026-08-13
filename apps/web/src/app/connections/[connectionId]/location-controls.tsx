"use client";

import { useActionState } from "react";
import type { LocationVisibility } from "@smartcard/types";

import { Button } from "@/components/ui/button";

import { setLocationConsentAction, setLocationVisibilityAction, setMarkedPrivateAction } from "./actions";
import { initialActionState } from "./action-state";
import { locationSharingSummary, type LocationSharingStatus } from "./location-sharing";

/**
 * The three location-privacy controls the RLS grants in
 * `20260809211200_rls_policies_graph_and_meetings.sql` actually allow a
 * participant to touch — see the build report for the exact mapping. This
 * component renders all three every time; it never hides a control because
 * "the other setting makes it moot" — the whole point of this screen is
 * showing the real, composed state rather than a UI that can't tell the
 * difference between "not shared" and "shared, but a privacy flag is
 * blocking it anyway".
 */
export function LocationControls({
  meetingId,
  connectionId,
  otherName,
  locationVisibility,
  viewerConsent,
  otherConsent,
  viewerMarkedPrivate,
  otherMarkedPrivate,
  sharingStatus,
}: {
  meetingId: string;
  connectionId: string;
  otherName: string;
  locationVisibility: LocationVisibility;
  viewerConsent: boolean;
  otherConsent: boolean;
  viewerMarkedPrivate: boolean;
  otherMarkedPrivate: boolean;
  sharingStatus: LocationSharingStatus;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{locationSharingSummary(sharingStatus, otherName)}</p>

      <VisibilityToggle
        meetingId={meetingId}
        connectionId={connectionId}
        otherName={otherName}
        locationVisibility={locationVisibility}
      />

      <ConsentToggle
        meetingId={meetingId}
        connectionId={connectionId}
        otherName={otherName}
        viewerConsent={viewerConsent}
        otherConsent={otherConsent}
      />

      <MarkPrivateToggle
        meetingId={meetingId}
        connectionId={connectionId}
        otherName={otherName}
        viewerMarkedPrivate={viewerMarkedPrivate}
        otherMarkedPrivate={otherMarkedPrivate}
      />
    </div>
  );
}

function VisibilityToggle({
  meetingId,
  connectionId,
  otherName,
  locationVisibility,
}: {
  meetingId: string;
  connectionId: string;
  otherName: string;
  locationVisibility: LocationVisibility;
}) {
  const isShared = locationVisibility === "mutuals";
  const nextVisibility: LocationVisibility = isShared ? "participants_only" : "mutuals";
  const boundAction = setLocationVisibilityAction.bind(null, meetingId, connectionId, nextVisibility);
  const [state, formAction, pending] = useActionState(boundAction, initialActionState);

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-medium">Share with mutual connections</p>
      <p className="mt-1 text-sm text-muted-foreground">
        A shared setting — either you or {otherName} can turn it on or off, at any time. Turning it
        on doesn&rsquo;t show anything by itself; both of you still have to agree below.
      </p>
      <form action={formAction} className="mt-2 flex items-center gap-2">
        <Button type="submit" variant={isShared ? "outline" : "default"} size="sm" disabled={pending}>
          {pending ? "Saving…" : isShared ? "Stop sharing with mutuals" : "Propose sharing with mutuals"}
        </Button>
      </form>
      {state.error ? <p className="mt-2 text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}

function ConsentToggle({
  meetingId,
  connectionId,
  otherName,
  viewerConsent,
  otherConsent,
}: {
  meetingId: string;
  connectionId: string;
  otherName: string;
  viewerConsent: boolean;
  otherConsent: boolean;
}) {
  const nextConsent = !viewerConsent;
  const boundAction = setLocationConsentAction.bind(null, meetingId, connectionId, nextConsent);
  const [state, formAction, pending] = useActionState(boundAction, initialActionState);

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-medium">Your agreement</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {viewerConsent ? "You've agreed to share this location." : "You haven't agreed to share this yet."}{" "}
        {otherConsent
          ? `${otherName} has agreed too.`
          : `Waiting on ${otherName} to agree — you can't see their choice change until they do.`}
      </p>
      <form action={formAction} className="mt-2 flex items-center gap-2">
        <Button type="submit" variant={viewerConsent ? "outline" : "default"} size="sm" disabled={pending}>
          {pending ? "Saving…" : viewerConsent ? "Withdraw your agreement" : "Agree to share"}
        </Button>
      </form>
      {state.error ? <p className="mt-2 text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}

function MarkPrivateToggle({
  meetingId,
  connectionId,
  otherName,
  viewerMarkedPrivate,
  otherMarkedPrivate,
}: {
  meetingId: string;
  connectionId: string;
  otherName: string;
  viewerMarkedPrivate: boolean;
  otherMarkedPrivate: boolean;
}) {
  const nextMarkedPrivate = !viewerMarkedPrivate;
  const boundAction = setMarkedPrivateAction.bind(null, meetingId, connectionId, nextMarkedPrivate);
  const [state, formAction, pending] = useActionState(boundAction, initialActionState);

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-medium">Mark this meeting private</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {viewerMarkedPrivate
          ? `You've marked this meeting private. It's hidden from everyone but you and ${otherName}, no matter the settings above. Only you can undo this — ${otherName} can't override it.`
          : `Hides this whole meeting from anyone but you and ${otherName}, no matter the settings above. This is a personal override: once set, only you can undo it — ${otherName} has no way to reverse your choice.`}
      </p>
      {otherMarkedPrivate ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {otherName} has separately marked this meeting private too. That&rsquo;s their call, not
          something you can change.
        </p>
      ) : null}
      <form action={formAction} className="mt-2 flex items-center gap-2">
        <Button
          type="submit"
          variant={viewerMarkedPrivate ? "outline" : "destructive"}
          size="sm"
          disabled={pending}
        >
          {pending
            ? "Saving…"
            : viewerMarkedPrivate
              ? "Undo — allow the settings above again"
              : "Mark private"}
        </Button>
      </form>
      {state.error ? <p className="mt-2 text-sm text-destructive">{state.error}</p> : null}
    </div>
  );
}
