import type { CSSProperties } from "react";

/**
 * The recurring surfaces of `docs/design/DESIGN.md` §2, as style objects.
 *
 * Six Events screens draw the same glass at the same intensity; writing it out
 * per component is how one of them ends up at `.7` while the rest are at `.72`
 * and the set stops reading as one system. The tokens themselves live in
 * `globals.css` (`--sc-glass-*`) — this file only assembles them.
 */

/** §2's "standard" glass: the default for cards, panels and stat tiles. */
export const GLASS: CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  border: "1px solid var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

/**
 * §2's "liquid" glass — thinner and more blurred, used for the panel that
 * overlaps the detail screen's cover image, where there is a photograph rather
 * than a canvas gradient behind it to refract.
 */
export const GLASS_LIQUID: CSSProperties = {
  background: "rgba(255,255,255,.66)",
  backdropFilter: "blur(22px) saturate(1.7)",
  WebkitBackdropFilter: "blur(22px) saturate(1.7)",
  border: "1px solid rgba(255,255,255,.8)",
};

/**
 * The dark panel every host-only surface sits on.
 *
 * This is not decoration and should not be softened. §6: "Host-only management
 * sits on a dark panel so it can never be mistaken for the public view." A host
 * looking at their own event sees both the public numbers and their private
 * ones on one screen, and the only thing separating "everyone can see this" from
 * "only you can see this" is which ground the text is on. Anything host-only —
 * the pending count, the queue, the invite entry point — goes on this.
 */
export const HOST_PANEL: CSSProperties = {
  background: "#0d1220",
  color: "#ffffff",
};

/** §5's placeholder fill for missing imagery. Never a hand-drawn illustration. */
export const COVER_PLACEHOLDER: CSSProperties = {
  background: "repeating-linear-gradient(115deg,#dfe5f0 0 10px,#e9edf5 10px 20px)",
};

/** §5's primary button: the accent gradient. */
export const PRIMARY_BUTTON: CSSProperties = {
  background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
  color: "#ffffff",
  boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
};

/** §5's secondary button: white glass with a hairline. */
export const SECONDARY_BUTTON: CSSProperties = {
  background: "rgba(255,255,255,.65)",
  border: "1px solid rgba(13,18,32,.12)",
  color: "var(--sc-text)",
};

/** §5's neutral primary: solid `--text`. Used for "Host an event". */
export const NEUTRAL_BUTTON: CSSProperties = {
  background: "var(--sc-text)",
  color: "#ffffff",
  boxShadow: "0 8px 20px -8px rgba(13,18,32,.5)",
};
