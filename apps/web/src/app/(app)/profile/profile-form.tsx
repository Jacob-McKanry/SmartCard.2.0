"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OwnProfile } from "@/server/profile/profile-service";

import { updateProfileAction } from "./actions";
import { initialActionState } from "./action-state";

/**
 * Every field here is in `userProfileUpdateSchema` (`packages/types`), which
 * is itself the exact column-level UPDATE grant on `public.users`
 * (20260809211100). `email` is deliberately not a field in this form — it is
 * not in that grant (identity comes from Kinde, not the client, per that
 * migration's comment block) and is shown as read-only context on the page
 * instead, not editable here.
 */
export function ProfileForm({ profile }: { profile: OwnProfile }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="first_name">
          <Input
            id="first_name"
            name="first_name"
            defaultValue={profile.first_name ?? ""}
            autoComplete="given-name"
            maxLength={100}
          />
        </Field>
        <Field label="Last name" htmlFor="last_name">
          <Input
            id="last_name"
            name="last_name"
            defaultValue={profile.last_name ?? ""}
            autoComplete="family-name"
            maxLength={100}
          />
        </Field>
      </div>

      <Field
        label="Username"
        htmlFor="username"
        hint="Optional. There's no public search or profile URL — this is just a label."
      >
        <Input id="username" name="username" defaultValue={profile.username ?? ""} maxLength={50} />
      </Field>

      <Field label="Phone number" htmlFor="phone_number">
        <Input
          id="phone_number"
          name="phone_number"
          type="tel"
          defaultValue={profile.phone_number ?? ""}
          autoComplete="tel"
          maxLength={30}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" htmlFor="company_name">
          <Input
            id="company_name"
            name="company_name"
            defaultValue={profile.company_name ?? ""}
            autoComplete="organization"
            maxLength={150}
          />
        </Field>
        <Field label="Role" htmlFor="company_role">
          <Input
            id="company_role"
            name="company_role"
            defaultValue={profile.company_role ?? ""}
            autoComplete="organization-title"
            maxLength={150}
          />
        </Field>
      </div>

      <Field label="Bio" htmlFor="bio">
        <Textarea id="bio" name="bio" defaultValue={profile.bio ?? ""} maxLength={1000} rows={4} />
      </Field>

      <label htmlFor="email_opt_in" className="flex items-center gap-2 text-sm">
        <input
          id="email_opt_in"
          type="checkbox"
          name="email_opt_in"
          defaultChecked={profile.email_opt_in}
          className="size-4 rounded border-input"
        />
        Email me occasional updates
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <span aria-live="polite" className="text-sm">
          {state.success && <span className="text-muted-foreground">Saved.</span>}
          {state.error && <span className="text-destructive">{state.error}</span>}
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
