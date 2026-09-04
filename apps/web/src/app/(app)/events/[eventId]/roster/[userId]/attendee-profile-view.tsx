import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";

import type { AttendeeProfile } from "@/server/events/roster-service";
import { AvatarDisc } from "../../../../connections/lib/avatar-disc";
import { displayName, initialsFor } from "../../../lib/format";
import { GLASS } from "../../../lib/surfaces";

/**
 * One opted-in attendee's card, opened from the roster.
 *
 * WHY THERE IS NO CONNECT ACTION ANYWHERE ON THIS SCREEN, AND WHY THE FOOTER
 * SAYS SO
 *
 * CLAUDE.md's non-negotiable rule: a connection is only ever made through an
 * in-person NFC tap or a live, GPS-verified QR scan. This page renders a
 * name, a photo, contact details and a save button — everything a stranger's
 * card preview shows — and states the rule explicitly rather than leaving a
 * viewer to wonder why there is no button for the obvious next step. Saving
 * this person's contact card is not the same thing as connecting with them,
 * and the two must never be allowed to look interchangeable here.
 */
export function AttendeeProfileView({
  eventId,
  eventTitle,
  userId,
  profile,
  photoUrl,
}: {
  eventId: string;
  eventTitle: string;
  userId: string;
  profile: AttendeeProfile;
  photoUrl: string | null;
}) {
  const name = displayName({ first_name: profile.firstName, last_name: profile.lastName });
  const role = [profile.companyRole, profile.companyName].filter((part) => part?.trim()).join(" at ");

  return (
    <main
      className="mx-auto flex w-full max-w-[520px] flex-col gap-5 px-[22px] pt-4 pb-8 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <Link
        href={`/events/${eventId}/roster`}
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        {eventTitle}
      </Link>

      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <AvatarDisc
          size={76}
          fontSize={22}
          initials={initialsFor({ first_name: profile.firstName, last_name: profile.lastName })}
          photoUrl={photoUrl}
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[22px] leading-[27px] font-semibold tracking-[-0.02em]">{name}</h1>
          {role !== "" ? (
            <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
              {role}
            </p>
          ) : null}
        </div>
      </div>

      {profile.bio?.trim() ? (
        <p
          className="rounded-[20px] p-[15px] text-[13px] leading-[19px]"
          style={{ ...GLASS, textWrap: "pretty" }}
        >
          {profile.bio}
        </p>
      ) : null}

      <dl
        className="flex flex-col rounded-[20px] border py-0.5"
        style={{
          background: "var(--sc-glass-bg)",
          backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
          WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
          borderColor: "var(--sc-glass-bd)",
          boxShadow: "var(--sc-glass-sh)",
        }}
      >
        {profile.phoneNumber?.trim() ? <ContactRow label="Phone" value={profile.phoneNumber} /> : null}
        <ContactRow label="Email" value={profile.email} />
      </dl>

      {profile.socialLinks.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {profile.socialLinks.map((link) => (
            <li key={link.id}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="block max-w-[220px] truncate rounded-full px-3.5 py-2 text-[12.5px] font-medium"
                style={GLASS}
              >
                {link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <a
        href={`/events/${eventId}/roster/${userId}/vcard`}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-4 text-[15px] leading-[19px] font-semibold text-white"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 16px 32px -12px rgba(11,96,255,.55)",
        }}
      >
        <Download size={16} strokeWidth={2.25} aria-hidden />
        Save to contacts
      </a>

      <p
        className="text-center text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        To add this person on SmartCard, please connect in person.
      </p>
    </main>
  );
}

function ContactRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center gap-2.5 border-b px-[15px] py-2.5 last:border-b-0"
      style={{ borderBottomColor: "rgba(13,18,32,.055)" }}
    >
      <dt className="flex-1 text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
        {label}
      </dt>
      <dd
        className="min-w-0 truncate text-[12.5px] leading-[17px] font-medium"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        {value}
      </dd>
    </div>
  );
}
