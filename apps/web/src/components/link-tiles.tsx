import { Plus } from "lucide-react";
import Link from "next/link";

import { handleFromUrl, markFor } from "./social-marks";

/**
 * The link tiles — `docs/design/DESIGN.md` §5, "Link tiles":
 * "Brand mark in a `32px` tinted plate + platform name + handle, two-up grid.
 * **Past four links the row scrolls horizontally** with
 * `scroll-snap-type: x mandatory` and `184px` tiles — never wrap to a third
 * row. Brand colour goes on the mark only."
 *
 * WHY THE FOUR-LINK THRESHOLD MATTERS
 *
 * It is not a styling preference. A third row of tiles pushes the profile's own
 * fields — name, bio, contact — below the fold on a phone, so the links start
 * outranking the person. Past four they become a strip you scan sideways rather
 * than a list you read down. Both layouts are rendered from the same tile
 * markup so they cannot drift.
 *
 * WHY THIS MOVED OUT OF `app/(app)/profile/` INTO `components/` (2026-08-15)
 *
 * It has two callers now: Profile, and the signed-out card preview
 * (`non-user-preview.tsx`). §5 describes one tile, and DESIGN.md §6's "Profile
 * as a visitor sees it" is explicit that a visitor sees "identical fields" — so
 * a second, visually-similar tile written for the visitor would be exactly the
 * drift a shared component prevents. The only thing that differs between the
 * two callers is `emptyState`, below.
 */

/**
 * What a tile needs, and deliberately less than a `social_links` row.
 *
 * A structural type rather than `SocialLinkRow`, because the preview's caller is
 * not handed rows at all: `card-preview-service.ts` maps its service-role read
 * field by field into a three-field object and never lets a database row leave
 * that module. Typing this as `SocialLinkRow` would push it into carrying
 * `user_id`, `created_at` and `updated_at` around for a component that has never
 * rendered any of them. A real `SocialLinkRow[]` still satisfies this, so
 * Profile passes its rows through unchanged.
 */
export interface LinkTileData {
  id: string;
  platform: string;
  url: string;
}

/**
 * What the block does when the person has no links.
 *
 * `"invite"` is Profile's: a quiet dashed "Add a link" into the edit screen.
 * `"omit"` renders nothing at all, and is what the signed-out preview passes —
 * a visitor has no edit screen to be sent to, and a "Links" heading over empty
 * space would be the app remarking on an absence §7 calls normal.
 */
export type LinkTilesEmptyState = "invite" | "omit";

export function LinkTiles({
  links,
  emptyState = "invite",
}: {
  links: readonly LinkTileData[];
  emptyState?: LinkTilesEmptyState;
}) {
  if (links.length === 0 && emptyState === "omit") {
    return null;
  }

  const scrolls = links.length > 4;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="text-[10px] leading-[14px] font-medium uppercase"
          style={{
            fontFamily: "var(--font-geist-mono)",
            letterSpacing: ".12em",
            color: "var(--sc-text-subtle)",
          }}
        >
          Links
        </span>
        {scrolls ? (
          <span className="text-[11px] leading-[15px]" style={{ color: "var(--sc-text-subtle)" }}>
            {links.length} &middot; swipe for more
          </span>
        ) : null}
      </div>

      {links.length === 0 ? (
        <AddFirstLink />
      ) : scrolls ? (
        <ul
          className="flex gap-2 overflow-x-auto px-px pt-px pb-1"
          style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
        >
          {links.map((link) => (
            <li key={link.id} className="w-[184px] shrink-0" style={{ scrollSnapAlign: "start" }}>
              <Tile link={link} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {links.map((link) => (
            <li key={link.id}>
              <Tile link={link} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ link }: { link: LinkTileData }) {
  const mark = markFor(link.platform);
  const handle = handleFromUrl(link.url, mark.atPrefixed);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex min-h-11 items-center gap-2.5 rounded-[18px] border px-3 py-2.5 transition-transform duration-300 hover:-translate-y-0.5"
      style={{
        background: "rgba(255,255,255,.78)",
        borderColor: "rgba(13,18,32,.08)",
        boxShadow: "0 2px 8px rgba(16,24,40,.05)",
        transitionTimingFunction: "var(--sc-ease-spring)",
      }}
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-[11px] p-2"
        style={{ background: mark.tint, color: mark.color }}
      >
        {mark.path === null ? (
          // No mark exists for this platform, so the plate carries the first
          // letter of the name as typed. §4 forbids hand-drawing an icon, and a
          // borrowed one would be worse than none.
          <span className="text-[13px] leading-none font-semibold">
            {mark.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="block size-full">
            <path d={mark.path} />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] leading-4 font-semibold">{mark.name}</span>
        <span
          className="block truncate text-[11px] leading-[15px]"
          style={{ color: "var(--sc-text-subtle)" }}
        >
          {handle}
        </span>
      </span>
    </a>
  );
}

/**
 * §5's empty state, in its smallest honest form. No links is entirely normal —
 * they are optional — so this is a quiet dashed invitation rather than the full
 * icon-plate panel a genuinely empty *screen* gets.
 */
function AddFirstLink() {
  return (
    <Link
      href="/profile/edit#links"
      className="flex min-h-11 items-center justify-center gap-1.5 rounded-[18px] border border-dashed px-3 py-3 text-[12px] leading-4 font-medium"
      style={{ borderColor: "rgba(13,18,32,.18)", color: "var(--sc-text-muted)" }}
    >
      <Plus size={13} strokeWidth={2} aria-hidden />
      Add a link
    </Link>
  );
}
