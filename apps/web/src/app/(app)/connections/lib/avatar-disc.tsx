import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * The one way a person is drawn across People, the meeting record, the
 * Connect payoff and Activity — `docs/design/DESIGN.md` §2/§6, ported from the
 * `SmartCard 2.0.dc.html` prototype's avatar treatment.
 *
 * WHY THIS IS SHARED RATHER THAN INLINED FOUR TIMES
 *
 * Every screen in this pass draws the same object (a circular plate, a
 * blue/violet gradient, initials, optionally a photo) at a different size, and
 * two of them also need the *greyed* variant that marks a removed connection.
 * Four hand-rolled copies is exactly how the removed state ends up looking
 * identical to the live one on one screen and not another — which would be a
 * correctness bug, not a styling one, because "this connection is gone" is the
 * only thing distinguishing the two states.
 *
 * WHY IT WRAPS `components/ui/avatar` INSTEAD OF `<img>`
 *
 * `photoUrl` is a short-lived signed URL minted by `signedProfilePhotoUrl`
 * (see that file's header: the bucket is private and the URL is a bearer
 * credential). Radix's Avatar gives the load/fail states for free, so a URL
 * that has expired between render and paint degrades to the initials rather
 * than to a broken-image glyph.
 *
 * PHOTOS BLUR UP (§2's motion rule) rather than showing a spinner, because the
 * URL is short-lived and a spinner would imply something is wrong when the
 * image is merely arriving.
 */

export type AvatarDiscTone =
  /** Live person: the accent/violet gradient plate. */
  | "live"
  /**
   * A removed connection. Greyed and flattened on purpose — §6's "Connection
   * removed" spec. Never use this for a person who is merely offline, absent
   * from a list, or unknown; it means one specific thing.
   */
  | "removed"
  /** Activity's deliberately flat treatment (§2's Glass rule): no gradient, square-ish plate. */
  | "flat";

export function AvatarDisc({
  size,
  fontSize,
  initials,
  photoUrl,
  tone = "live",
}: {
  size: number;
  /** Initials type size. Passed rather than derived so each screen matches the prototype exactly. */
  fontSize: number;
  initials: string;
  photoUrl: string | null;
  tone?: AvatarDiscTone;
}) {
  const flat = tone === "flat";
  const removed = tone === "removed";

  const plate =
    tone === "live"
      ? "linear-gradient(140deg, rgba(11,96,255,.16), rgba(124,58,237,.14))"
      : "rgba(13,18,32,.05)";

  return (
    <Avatar
      className="shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: flat ? Math.round(size * 0.29) : 999,
      }}
    >
      <AvatarImage
        src={photoUrl ?? undefined}
        alt=""
        style={{
          animation: "sc-blurup .9s var(--sc-ease-glide) both",
          // A removed connection's photo is dimmed the same way its rings are,
          // so the state reads at a glance and not only from the caption.
          filter: removed ? "grayscale(1)" : undefined,
          opacity: removed ? 0.55 : undefined,
        }}
      />
      <AvatarFallback
        className="font-semibold"
        style={{
          background: plate,
          border: tone === "live" ? "1px solid rgba(255,255,255,.92)" : "1px solid rgba(13,18,32,.1)",
          borderRadius: flat ? Math.round(size * 0.29) : 999,
          color: tone === "live" ? "var(--sc-text)" : "var(--sc-text-muted)",
          fontSize,
          lineHeight: 1,
        }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
