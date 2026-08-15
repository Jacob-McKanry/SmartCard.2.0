"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CircleUserRound,
  House,
  Newspaper,
  QrCode,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

/**
 * The navigation shell, ported from `docs/design/prototypes/SmartCard 2.0.dc.html`
 * (spec: `docs/design/DESIGN.md` §4).
 *
 * ONE LIST, TWO RENDERINGS — unchanged from the previous version, and still the
 * reason this file is a single component: `NAV_ITEMS` is the source of truth and
 * both the phone dock and the desktop top bar render it. Both stay mounted and
 * Tailwind's `sm:` breakpoint picks one, so there is no hydration flash where the
 * wrong variant briefly shows.
 *
 * WHAT CHANGED, AND WHY IT IS NOT COSMETIC
 *
 * Seven slots, not six: **Events** joins the bar. Its backend has been complete
 * for some time with no way to reach it, so this is the change that makes the
 * feature exist for users at all.
 *
 * **Home moves to the centre** (index 3 of 7). That is the design's stated
 * reason, quoted from the prototype: the one destination you always come back to
 * should be the easiest thumb target, with discovery to its left and your own
 * network and identity to its right. It also means the slot order is load-bearing
 * — reordering `NAV_ITEMS` silently breaks the layout's intent, so don't.
 *
 * "Connections" is labelled **People**. The route stays `/connections`; only the
 * label changed, per the prototype's nav list.
 *
 * WHY THE SLOTS ARE `pointer-events: none`
 *
 * The dock supports press-and-drag: hold anywhere on the bar and slide, and the
 * pill tracks your finger, magnifying whichever slot is under it, navigating on
 * release. That requires one element to own the whole gesture — if each slot
 * handled its own pointer events, a drag begun on Feed and released on Profile
 * would be two unrelated interactions and the browser would fire a click on Feed.
 *
 * So the container owns `pointerdown/move/up`, and the slots opt out of hit
 * testing. They are still real `<Link>`s: keyboard focus, Enter, middle-click and
 * Next's route prefetching all keep working, and a screen reader still sees seven
 * labelled links rather than an unlabelled div. Only mouse/touch hit testing is
 * redirected to the parent, which is the thing the gesture needs.
 */

interface NavItem {
  /** Stable key used for active-state matching, independent of label or href. */
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Extra path prefixes that should still light this slot up. A meeting record
   * lives at `/connections/[id]`, so "People" stays active while you read one.
   */
  alsoActiveFor?: readonly string[];
}

/**
 * Order is the design, not a preference — Home is deliberately index 3 of 7.
 * See the header. The pill's geometry below divides by `NAV_ITEMS.length`, so
 * adding or removing an entry re-flows the bar correctly, but moving Home off
 * centre would contradict the spec.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { key: "feed", href: "/feed", label: "Feed", icon: Newspaper },
  { key: "connect", href: "/connect", label: "Connect", icon: QrCode },
  { key: "events", href: "/events", label: "Events", icon: Ticket },
  { key: "home", href: "/", label: "Home", icon: House },
  { key: "people", href: "/connections", label: "People", icon: Users },
  { key: "activity", href: "/activity", label: "Activity", icon: Bell },
  {
    key: "profile",
    href: "/profile",
    label: "Profile",
    icon: CircleUserRound,
    /*
     * Settings is reached from Profile and belongs to it, but it is a
     * top-level route rather than `/profile/settings` — see that page and the
     * DESIGN.md note for why. Without this entry `activeIndex` would find no
     * match and fall back to slot 0, lighting **Feed** while you sit on
     * Settings: not a crash, just the nav quietly lying about where you are.
     */
    alsoActiveFor: ["/settings"],
  },
];

/** Exact match for `/`, prefix match otherwise — so nested records keep their slot lit. */
function activeIndex(pathname: string): number {
  const found = NAV_ITEMS.findIndex((item) => {
    if (item.href === "/") return pathname === "/";
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
    return (item.alsoActiveFor ?? []).some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  });
  // Never -1: an unrecognised path (there are none under this layout today)
  // would otherwise translate the pill to a negative offset and slide it off
  // the left edge of the bar.
  return found === -1 ? 0 : found;
}

export function Nav() {
  const pathname = usePathname();
  const active = activeIndex(pathname);

  return (
    <>
      <DesktopBar active={active} />
      <PhoneDock active={active} />
    </>
  );
}

/* ------------------------------------------------------------------ desktop */

/**
 * Desktop (`≥640px`): a glass top bar. Same list, no drag — the gesture is a
 * touch affordance and a pointer has no use for it.
 */
function DesktopBar({ active }: { active: number }) {
  return (
    <header
      className="sticky top-0 z-40 hidden border-b sm:block"
      style={{
        background: "var(--sc-glass-bg)",
        backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
        borderBottomColor: "var(--sc-glass-bd)",
      }}
    >
      <div className="mx-auto flex max-w-[940px] items-center gap-1.5 px-7 py-3">
        <span className="mr-[18px] flex items-center gap-2 text-[15px] leading-5 font-bold tracking-[-0.02em]">
          <span
            className="size-[9px] rounded-[3px]"
            style={{
              background: "var(--sc-accent)",
              boxShadow: "0 0 0 4px var(--sc-accent-tint)",
            }}
            aria-hidden
          />
          SmartCard
        </span>
        {NAV_ITEMS.map((item, index) => {
          const on = index === active;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className="flex items-center gap-[7px] rounded-full px-3.5 py-2 text-[13px] leading-4 transition-all duration-200"
              style={{
                background: on ? "var(--sc-accent-tint)" : "transparent",
                color: on ? "var(--sc-accent-deep)" : "var(--sc-text-muted)",
                fontWeight: on ? 600 : 500,
                transitionTimingFunction: "var(--sc-ease-glide)",
              }}
            >
              <Icon size={16} strokeWidth={1.9} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- phone */

function PhoneDock({ active }: { active: number }) {
  const router = useRouter();
  const dockRef = useRef<HTMLDivElement | null>(null);
  /** Slot the finger is currently over mid-drag; null when not dragging. */
  const [drag, setDrag] = useState<number | null>(null);
  /** Slot under a hovering pointer. Magnifies only — never moves the pill. */
  const [hover, setHover] = useState<number | null>(null);

  /**
   * Which slot a given clientX falls in, measured from the dock's own box
   * rather than assumed from a hardcoded width. The bar is inset 14px from
   * each screen edge and has 6px of internal padding, so its usable track is
   * `width - 12` — deriving the index from anything else drifts on narrow
   * phones and lands the pill one slot off.
   */
  const indexAt = useCallback((clientX: number): number | null => {
    const el = dockRef.current;
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    const inner = rect.width - 12;
    if (inner <= 0) return null;
    const x = Math.min(Math.max(clientX - rect.left - 6, 0), inner - 1);
    return Math.min(NAV_ITEMS.length - 1, Math.max(0, Math.floor((x / inner) * NAV_ITEMS.length)));
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Capture so a finger that slides past the dock's edge keeps reporting to
      // us instead of silently stranding the gesture with the pill left behind.
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag(indexAt(event.clientX));
    },
    [indexAt],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const index = indexAt(event.clientX);
      if (drag !== null) {
        setDrag(index);
      } else {
        setHover(index);
      }
    },
    [drag, indexAt],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const index = indexAt(event.clientX) ?? drag;
      setDrag(null);
      setHover(null);
      if (index === null) return;
      const target = NAV_ITEMS[index];
      // Releasing on the slot you are already on is a no-op rather than a
      // redundant navigation — pushing the current route would remount the
      // page and throw away its scroll position for no reason.
      if (target !== undefined && index !== active) {
        router.push(target.href);
      }
    },
    [active, drag, indexAt, router],
  );

  const onPointerLeave = useCallback(() => {
    setDrag(null);
    setHover(null);
  }, []);

  // The pill sits under the finger while dragging and under the active route
  // otherwise, so a drag previews its destination before you commit to it.
  const pillIndex = drag ?? active;
  const focused = drag ?? hover ?? -1;

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3.5 pb-3.5 sm:hidden"
    >
      <div
        ref={dockRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerLeave}
        onPointerLeave={onPointerLeave}
        className="pointer-events-auto relative flex touch-none select-none items-stretch rounded-[26px] border p-1.5"
        style={{
          background: "var(--sc-glass-bg)",
          backdropFilter: "blur(26px) saturate(1.7)",
          WebkitBackdropFilter: "blur(26px) saturate(1.7)",
          borderColor: "var(--sc-glass-bd)",
          boxShadow: "0 16px 40px -12px rgba(16,24,40,.28)",
        }}
      >
        {/*
         * The sliding selection. One slot wide, moved by whole multiples of its
         * own width, so it lands exactly on a slot at any bar width without any
         * pixel arithmetic. It follows the finger on a short glide while
         * dragging and springs when you tap — a spring that tracked a finger
         * would overshoot past the slot you are pointing at.
         */}
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-1.5 rounded-[18px] border"
          style={{
            width: `calc((100% - 12px) / ${NAV_ITEMS.length})`,
            transform: `translateX(${pillIndex * 100}%) scaleY(${drag !== null ? 1.06 : 1})`,
            transition:
              drag !== null
                ? "transform .18s var(--sc-ease-glide)"
                : "transform .44s var(--sc-ease-spring)",
            background:
              "linear-gradient(160deg, rgba(255,255,255,.96), rgba(255,255,255,.78))",
            borderColor: "rgba(255,255,255,.95)",
            boxShadow:
              "0 8px 18px -8px rgba(16,24,40,.4), inset 0 1px 0 rgba(255,255,255,.95)",
          }}
        />

        {NAV_ITEMS.map((item, index) => {
          const lifted = index === focused;
          const under = index === pillIndex;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={index === active ? "page" : undefined}
              tabIndex={0}
              // See the file header: hit testing belongs to the container so the
              // drag gesture is one interaction. Keyboard access is unaffected.
              className="pointer-events-none relative flex min-h-12 flex-1 flex-col items-center justify-center gap-[3px] rounded-2xl text-[10px] leading-[13px]"
              style={{
                color: under || lifted ? "var(--sc-accent-deep)" : "var(--sc-text-subtle)",
                fontWeight: under || lifted ? 600 : 500,
                transform: lifted ? "scale(1.18) translateY(-3px)" : "scale(1)",
                transition: "transform .3s var(--sc-ease-spring), color .2s ease",
              }}
            >
              <Icon size={lifted ? 23 : 20} strokeWidth={1.9} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
