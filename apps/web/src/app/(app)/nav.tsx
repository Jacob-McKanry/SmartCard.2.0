"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CircleUserRound, House, Newspaper, QrCode, Users } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * The persistent navigation for every signed-in screen — the piece that was
 * entirely missing before this pass. Each of `/`, `/feed`, `/connect`,
 * `/connections`, `/profile` used to be reachable only by typing its URL;
 * this is the thing that makes them read as one app instead of five
 * unconnected pages.
 *
 * ONE LIST OF DESTINATIONS, TWO RENDERINGS
 *
 * `NAV_ITEMS` is the single source of truth. `<Nav>` renders it twice — once
 * as a bottom tab bar, once as a top bar — and Tailwind's `sm:` breakpoint
 * decides which one is visible. Both stay in the DOM at all times rather
 * than switching via a JS media-query check, so there's no hydration flash
 * where the wrong variant briefly shows.
 *
 * WHY THIS IS A CLIENT COMPONENT
 *
 * Highlighting the current destination needs `usePathname()`, which only
 * exists on the client. Everything else here is static.
 */

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/feed", label: "Feed", icon: Newspaper },
  { href: "/connect", label: "Connect", icon: QrCode },
  { href: "/connections", label: "Connections", icon: Users },
  { href: "/activity", label: "Activity", icon: Bell },
  { href: "/profile", label: "Profile", icon: CircleUserRound },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-10 hidden border-b border-border bg-background/95 backdrop-blur sm:block">
        <div className="mx-auto flex max-w-2xl items-center gap-1 px-6 py-2">
          <span className="mr-4 text-sm font-semibold">SmartCard</span>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} variant="top" />
          ))}
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              variant="bottom"
            />
          ))}
        </div>
      </nav>
    </>
  );
}

/** Exact match for `/`, prefix match for everything else — so `/connections/[id]` still highlights "Connections". */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  variant,
}: {
  item: NavItem;
  active: boolean;
  variant: "top" | "bottom";
}) {
  const Icon = item.icon;

  if (variant === "top") {
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" />
      {item.label}
    </Link>
  );
}
