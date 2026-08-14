"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { SocialLinkRow } from "@smartcard/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addSocialLinkAction, deleteSocialLinkAction, updateSocialLinkAction } from "./actions";
import { initialActionState } from "./action-state";

/**
 * Add/edit/remove for the caller's own `social_links` rows — the exact CRUD
 * `20260809211100_rls_policies_identity_and_cards.sql` grants: a user manages
 * only their own rows, and `url` is validated on the way in against
 * `socialLinkUrlSchema` (`packages/types`) so this UI can't reintroduce the
 * malformed-URL problem the §6.4 legacy import found (multiple URLs or
 * trailing text stuffed into one field).
 */
export function SocialLinksSection({ links }: { links: SocialLinkRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No links yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <SocialLinkListItem key={link.id} link={link} />
          ))}
        </ul>
      )}
      <AddSocialLinkForm />
    </div>
  );
}

function SocialLinkListItem({ link }: { link: SocialLinkRow }) {
  const [editing, setEditing] = useState(false);
  const boundUpdate = updateSocialLinkAction.bind(null, link.id);
  const [state, formAction, pending] = useActionState(boundUpdate, initialActionState);

  // Close the edit form once a save succeeds. Deliberately *not* a
  // `useEffect` — this is "adjusting state during render" (React's own
  // pattern for this, since an Effect that calls setState synchronously in
  // its body just causes an extra render pass for no benefit here: no
  // external system is being synchronized, only local UI state derived from
  // this component's own action result). `lastHandledState` tracks which
  // action result has already been reacted to, so this only fires once per
  // new result rather than on every render.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success) {
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <li className="rounded-md border border-border p-3">
        <form action={formAction} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor={`platform-${link.id}`} className="sr-only">
                Platform
              </Label>
              <Input
                id={`platform-${link.id}`}
                name="platform"
                defaultValue={link.platform}
                placeholder="Platform (e.g. Instagram)"
                maxLength={100}
                required
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor={`url-${link.id}`} className="sr-only">
                URL
              </Label>
              <Input
                id={`url-${link.id}`}
                name="url"
                type="url"
                defaultValue={link.url}
                placeholder="https://…"
                maxLength={2048}
                required
              />
            </div>
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{link.platform}</div>
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block truncate text-sm text-muted-foreground hover:underline"
        >
          {link.url}
        </a>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <form action={deleteSocialLinkAction.bind(null, link.id)}>
          <Button type="submit" variant="ghost" size="sm">
            Remove
          </Button>
        </form>
      </div>
    </li>
  );
}

function AddSocialLinkForm() {
  const [state, formAction, pending] = useActionState(addSocialLinkAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3"
    >
      <Label className="text-sm font-medium">Add a link</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="platform" placeholder="Platform (e.g. Instagram)" maxLength={100} required />
        <Input name="url" type="url" placeholder="https://…" maxLength={2048} required />
        <Button type="submit" disabled={pending} className="sm:shrink-0">
          {pending ? "Adding…" : "Add link"}
        </Button>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
