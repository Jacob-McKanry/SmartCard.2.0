"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OwnProfile } from "@/server/profile/profile-service";
import { PhotoUploader } from "@/app/(app)/profile/photo-uploader";
import { initialActionState } from "@/app/(app)/profile/action-state";

import { completeOnboardingAction, skipOnboardingAction } from "./actions";

/**
 * The two onboarding steps, `isOnbPhoto` then `isOnbDetails` from
 * `docs/design/prototypes/Auth flow.dc.html`, with the prototype's chrome (the
 * device frame, the screen picker, the annotation rail) dropped.
 *
 * WHY THE STEP IS CLIENT STATE AND NOT A ROUTE OR A SEARCH PARAM
 *
 * Because nothing is committed between the steps. The photo step's own upload
 * is a Server Action that writes immediately and independently — it is the same
 * `PhotoUploader` Edit profile uses, unchanged — and the details step is one
 * submit. There is no half-saved thing for a URL to be the address of, and a
 * `?step=` would create a back button that appears to undo something and does
 * not.
 *
 * The step index surviving the photo upload is not an accident either: uploading
 * revalidates this route, which re-renders the server tree and hands this
 * component a fresh `photoUrl` prop, while React reconciles and keeps the
 * `useState` above it. That is why the uploaded picture appears in place instead
 * of the flow jumping back to step one.
 *
 * WHY REUSE `PhotoUploader` RATHER THAN DRAW THE PROTOTYPE'S CAMERA CARD
 *
 * The prototype's photo step has "Take a photo" and "Choose from library" as two
 * buttons. Those are one control on the web — a file input with `capture` is a
 * platform decision the browser makes — and the shipped uploader already
 * enforces the bucket's real limits (WEBP, 5MB), already states them, and is
 * already backstopped by the Storage policy in 20260813191041. A second uploader
 * here would be a second place for those rules to drift, on the one screen where
 * a person's first impression of the product is formed by whether it works.
 *
 * WHAT THE COPY MAY NOT SAY (§7)
 *
 * Nothing on these screens promises a capability that does not exist, and
 * nothing implies a field is required. "All optional, all editable later" is the
 * prototype's own line and it is literally true: every field here is nullable,
 * every one of them is on Edit profile afterwards, and both buttons at the
 * bottom of each step finish the flow.
 */
export function OnboardingFlow({
  profile,
  photoUrl,
}: {
  profile: OwnProfile;
  photoUrl: string | null;
}) {
  const [step, setStep] = useState<"photo" | "details">("photo");

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[402px] flex-col gap-5 px-[26px] pt-8 pb-9"
      style={{ animation: "sc-rise .45s var(--sc-ease-glide) both" }}
    >
      <ProgressBars step={step} />

      {step === "photo" ? (
        <PhotoStep
          profile={profile}
          photoUrl={photoUrl}
          onContinue={() => setStep("details")}
        />
      ) : (
        <DetailsStep profile={profile} />
      )}
    </main>
  );
}

/**
 * The prototype's two-segment progress indicator. `aria-hidden` with a text
 * equivalent beside it: §8 forbids an indicator being the only signal, and two
 * coloured bars say nothing to a screen reader.
 */
function ProgressBars({ step }: { step: "photo" | "details" }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-[5px]" aria-hidden>
        <span className="h-[3px] flex-1 rounded-sm" style={{ background: "var(--sc-accent)" }} />
        <span
          className="h-[3px] flex-1 rounded-sm"
          style={{ background: step === "details" ? "var(--sc-accent)" : "rgba(13,18,32,.1)" }}
        />
      </div>
      <span
        className="font-mono text-[9.5px] leading-[13px] font-medium"
        style={{ letterSpacing: ".14em", color: "var(--sc-text-subtle)" }}
      >
        STEP {step === "photo" ? "1" : "2"} OF 2
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ step 1 */

function PhotoStep({
  profile,
  photoUrl,
  onContinue,
}: {
  profile: OwnProfile;
  photoUrl: string | null;
  onContinue: () => void;
}) {
  const hasPhoto = profile.photo_path !== null;

  return (
    <>
      <Heading
        title="Add a photo"
        body="So the person you just met remembers which conversation you were."
      />

      <Panel>
        <PhotoUploader photoUrl={photoUrl} initials={initialsFor(profile)} hasPhoto={hasPhoto} />
      </Panel>

      <Spacer />

      <div className="flex gap-[9px]">
        <button type="button" onClick={onContinue} className={PRIMARY_CLASS} style={PRIMARY_STYLE}>
          Continue
        </button>
        {/*
         * Advances rather than finishing. The prototype's Skip on this step
         * leads to the details step, not out of the flow — the only control that
         * ends onboarding early is the one on step 2, so there is exactly one
         * place in this component that writes the completion flag.
         *
         * Hidden once a photo exists, because "Skip" beside a picture you just
         * uploaded is a button with nothing to skip.
         */}
        {hasPhoto ? null : (
          <button type="button" onClick={onContinue} className={GHOST_CLASS} style={GHOST_STYLE}>
            Not now
          </button>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ step 2 */

function DetailsStep({ profile }: { profile: OwnProfile }) {
  const [state, formAction] = useActionState(completeOnboardingAction, initialActionState);

  return (
    <>
      <Heading title="What should people see?" body="All optional, all editable later." />

      <form action={formAction} className="flex flex-1 flex-col gap-5">
        <Panel>
          <div className="flex gap-2.5">
            <Field label="First" htmlFor="first_name">
              <Input
                id="first_name"
                name="first_name"
                defaultValue={profile.first_name ?? ""}
                autoComplete="given-name"
                maxLength={100}
              />
            </Field>
            <Field label="Last" htmlFor="last_name">
              <Input
                id="last_name"
                name="last_name"
                defaultValue={profile.last_name ?? ""}
                autoComplete="family-name"
                maxLength={100}
              />
            </Field>
          </div>

          <div className="flex gap-2.5">
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
            <Textarea
              id="bio"
              name="bio"
              rows={3}
              maxLength={1000}
              defaultValue={profile.bio ?? ""}
              placeholder="One line people will remember you by."
            />
          </Field>

          <Field label="Phone" htmlFor="phone_number">
            <Input
              id="phone_number"
              name="phone_number"
              type="tel"
              defaultValue={profile.phone_number ?? ""}
              autoComplete="tel"
              maxLength={30}
            />
          </Field>

          <label
            htmlFor="email_opt_in"
            className="flex min-h-11 items-center gap-2 text-[13px] leading-[18px] font-medium"
          >
            <input
              id="email_opt_in"
              type="checkbox"
              name="email_opt_in"
              defaultChecked={profile.email_opt_in}
              className="size-4 rounded border-input"
            />
            Email me occasional updates
          </label>
        </Panel>

        {/*
         * §8: the error is announced, not merely coloured. It is also the only
         * thing on this screen that can stop the flow, so it sits directly above
         * the buttons rather than at the top where it would scroll away.
         */}
        <p aria-live="polite" className="min-h-4 text-[12px] leading-4">
          {state.error ? <span style={{ color: "var(--sc-danger)" }}>{state.error}</span> : null}
        </p>

        <Spacer />

        <div className="flex gap-[9px]">
          <DoneButton />
        </div>
      </form>

      {/*
       * OUTSIDE the form above, deliberately: a second submit button inside it
       * would post the filled-in fields to an action that ignores them, which
       * would look like "Later" quietly discarding what somebody typed. This is
       * its own one-button form, and it writes nothing but the flag.
       */}
      <form action={skipOnboardingAction}>
        <SkipButton />
      </form>
    </>
  );
}

function DoneButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${PRIMARY_CLASS} disabled:opacity-70`}
      style={PRIMARY_STYLE}
    >
      {pending ? "Saving…" : "Done"}
    </button>
  );
}

function SkipButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${GHOST_CLASS} w-full disabled:opacity-70`}
      style={GHOST_STYLE}
    >
      {pending ? "One moment…" : "Skip for now"}
    </button>
  );
}

/* ------------------------------------------------------------------- parts */

const PRIMARY_CLASS =
  "flex min-h-11 flex-1 items-center justify-center rounded-full px-4 py-4 text-[15px] leading-[19px] font-semibold text-white";

const PRIMARY_STYLE: React.CSSProperties = {
  background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
  boxShadow: "0 16px 32px -12px rgba(11,96,255,.55)",
};

const GHOST_CLASS =
  "flex min-h-11 items-center justify-center rounded-full px-5 py-4 text-[15px] leading-[19px] font-semibold";

const GHOST_STYLE: React.CSSProperties = {
  border: "1px solid rgba(13,18,32,.12)",
  background: "rgba(255,255,255,.6)",
  color: "var(--sc-text-muted)",
};

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-[26px] leading-[30px] font-semibold" style={{ letterSpacing: "-.035em" }}>
        {title}
      </h1>
      <p
        className="text-[14px] leading-[21px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {body}
      </p>
    </div>
  );
}

/** §2's standard glass, at the card radius the prototype's onboarding uses. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-[24px] border p-[17px]"
      style={{
        background: "var(--sc-glass-bg)",
        backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        borderColor: "var(--sc-glass-bd)",
        boxShadow: "var(--sc-glass-sh)",
      }}
    >
      {children}
    </div>
  );
}

/** Pushes the buttons to the bottom of the viewport, as both prototype steps do. */
function Spacer() {
  return <div className="flex-1" />;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className="font-mono text-[9.5px] font-medium"
        style={{ letterSpacing: ".14em", color: "var(--sc-text-subtle)" }}
      >
        {label.toUpperCase()}
      </Label>
      {children}
    </div>
  );
}

/** Matches Profile's and Settings' fallback exactly: initials, then the email. */
function initialsFor(profile: OwnProfile): string {
  const first = profile.first_name?.trim().charAt(0) ?? "";
  const last = profile.last_name?.trim().charAt(0) ?? "";
  const fromName = `${first}${last}`.toUpperCase();
  return fromName !== "" ? fromName : profile.email.slice(0, 2).toUpperCase();
}
