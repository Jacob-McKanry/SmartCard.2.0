import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Lock,
  MapPin,
  Megaphone,
  Nfc,
  QrCode,
  RefreshCw,
  SearchX,
  ShieldCheck,
  Ticket,
  UserX,
} from "lucide-react";

import { RingDiagram, type RingBandData } from "@/components/ring-diagram";

/**
 * The public landing page at smartcard.tech, shown at `/` to anyone who is not
 * signed in. A member opening the same URL gets the Home screen instead; the
 * split happens in `app/page.tsx`.
 *
 * WHAT THIS PAGE IS ALLOWED TO SAY
 *
 * Every claim below is something the shipped product actually does, checked
 * against `docs/architecture/` rather than written as aspiration:
 *
 *  - "The code changes every 30 seconds" — §4's QR rotation interval.
 *  - "Both phones' locations are checked" / "if it can't be confirmed, nothing
 *    happens" — the GPS proximity gate, which fails closed (CLAUDE.md).
 *  - "Either of you can hide where you met" — location sharing defaults on but
 *    is a one-sided veto for each participant (§2.4's 2026-08-15 amendment).
 *  - The guest-list paragraph restates the roster amendment's three limits —
 *    opt-in only, fellow attendees of that event only, never creates a
 *    connection (`docs/architecture/2026-08-27-event-attendee-roster.md`).
 *
 * And, as importantly, what it must not say. No member counts, no "join N
 * people", no waitlist or founding-member language: CLAUDE.md lists scarcity
 * mechanics as out of scope, and DESIGN.md §1 says the design's job is to make
 * real facts feel valuable, never to inflate them. The ring diagram in the hero
 * is visibly labelled as an example for the same reason — it is the product's
 * identity motif, but nobody's real record.
 *
 * WHY IT READS NOTHING
 *
 * This is a server component with no data dependency at all: no Supabase
 * client, no session, no props. It is the one page a stranger can load, so it
 * deliberately has nothing to leak. Both calls to action go to `/sign-in`
 * rather than embedding Kinde's links here, so the sign-in gate (and its
 * reasoning about not being an account-existence oracle) stays in one place.
 *
 * Styling follows DESIGN.md: glass panels over the canvas blooms, pills for
 * every button, accent blue only on the primary action and the connection
 * motif. The one full accent field is the app mark, the same 78px plate the
 * sign-in screen carries.
 */

const ACCENT_GRADIENT = "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))";

const GLASS: CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: `blur(var(--sc-glass-blur)) saturate(1.6)`,
  WebkitBackdropFilter: `blur(var(--sc-glass-blur)) saturate(1.6)`,
  border: "1px solid var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

/** Staggered entrance, the prototype's `sc-rise` on a glide curve. */
function rise(delayMs: number): CSSProperties {
  return { animation: `sc-rise .7s var(--sc-ease-glide) ${delayMs}ms both` };
}

/**
 * Illustrative counts for the hero's ring diagram. Chosen to sit well inside
 * DESIGN.md §3's ~40-record tick budget so every band draws one tick per
 * record, and labelled "Example" on screen so nobody mistakes it for a stat.
 */
const EXAMPLE_BANDS: readonly RingBandData[] = [
  {
    key: "connections",
    count: 14,
    color: "var(--sc-accent)",
    noun: { one: "connection", many: "connections" },
  },
  {
    key: "events",
    count: 6,
    color: "var(--sc-text)",
    noun: { one: "event", many: "events" },
  },
  {
    key: "cities",
    count: 3,
    color: "var(--sc-ink-deep)",
    noun: { one: "city", many: "cities" },
  },
];

export function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <SiteHeader />

      <main className="flex flex-col">
        <Hero />
        <HowItWorks />
        <OnPurpose />
        <Trust />
        <Events />
        <HaveACard />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Shared pieces                                                            */
/* ------------------------------------------------------------------------ */

function AppMark({ size = 34, radius = 12, icon = 17 }: { size?: number; radius?: number; icon?: number }) {
  return (
    <span
      aria-hidden
      className="relative flex shrink-0 items-center justify-center overflow-hidden text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: ACCENT_GRADIENT,
        boxShadow: "0 10px 22px -10px rgba(11,96,255,.7)",
      }}
    >
      <span
        className="absolute top-[-40%] left-0 h-[180%] w-[36%]"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent)",
          animation: "sc-shimmer 3.8s var(--sc-ease-glide) infinite",
        }}
      />
      <QrCode size={icon} strokeWidth={1.9} className="relative" />
    </span>
  );
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] leading-[19px] font-semibold text-white transition-transform duration-300 hover:-translate-y-px active:scale-[.98]"
      style={{ background: ACCENT_GRADIENT, boxShadow: "0 16px 32px -12px rgba(11,96,255,.6)" }}
    >
      {children}
      <ArrowRight
        size={17}
        strokeWidth={2.2}
        className="transition-transform duration-300 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function SecondaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] leading-[19px] font-semibold transition-colors duration-300 hover:bg-white"
      style={{
        border: "1px solid rgba(13,18,32,.12)",
        background: "rgba(255,255,255,.7)",
        color: "var(--sc-text)",
      }}
    >
      {children}
    </Link>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-mono text-[11px] leading-[15px] font-medium uppercase"
      style={{ letterSpacing: ".14em", color: "var(--sc-accent-deep)" }}
    >
      {children}
    </p>
  );
}

function SectionHeading({
  eyebrow,
  title,
  lede,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`flex max-w-[640px] flex-col gap-3 ${center ? "mx-auto items-center text-center" : ""}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        className="text-[32px] leading-[36px] font-semibold sm:text-[40px] sm:leading-[44px]"
        style={{ letterSpacing: "-.035em", textWrap: "balance" }}
      >
        {title}
      </h2>
      {lede ? (
        <p
          className="text-[16px] leading-[25px] sm:text-[17px] sm:leading-[27px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-24 px-5 py-16 sm:px-8 sm:py-24 ${className}`}>
      <div className="mx-auto w-full max-w-[1120px]">{children}</div>
    </section>
  );
}

function IconPlate({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "ink" }) {
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-[14px]"
      style={
        tone === "accent"
          ? { background: "var(--sc-accent-tint)", color: "var(--sc-accent-deep)" }
          : { background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }
      }
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Header                                                                   */
/* ------------------------------------------------------------------------ */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 rounded-full py-2 pr-2 pl-3"
        style={GLASS}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="SmartCard home">
          <AppMark />
          <span className="text-[17px] font-semibold" style={{ letterSpacing: "-.025em" }}>
            SmartCard
          </span>
        </Link>

        <ul
          className="hidden items-center gap-7 text-[14px] font-medium md:flex"
          style={{ color: "var(--sc-text-muted)" }}
        >
          <li>
            <a href="#how-it-works" className="transition-colors hover:text-[var(--sc-text)]">
              How it works
            </a>
          </li>
          <li>
            <a href="#trust" className="transition-colors hover:text-[var(--sc-text)]">
              Privacy
            </a>
          </li>
          <li>
            <a href="#events" className="transition-colors hover:text-[var(--sc-text)]">
              Events
            </a>
          </li>
          <li>
            <a href="#card" className="transition-colors hover:text-[var(--sc-text)]">
              The card
            </a>
          </li>
        </ul>

        <Link
          href="/sign-in"
          className="inline-flex min-h-10 items-center rounded-full px-5 text-[14px] font-semibold text-white"
          style={{ background: "var(--sc-text)" }}
        >
          Sign in
        </Link>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------------ */
/* Hero                                                                     */
/* ------------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="px-5 pt-12 pb-16 sm:px-8 sm:pt-20 sm:pb-24">
      <div className="mx-auto grid w-full max-w-[1120px] items-center gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        <div className="flex flex-col items-start gap-7">
          <div style={rise(0)}>
            <span
              className="inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2 text-[12.5px] font-medium"
              style={{ ...GLASS, color: "var(--sc-text-muted)" }}
            >
              <span
                className="flex size-5 items-center justify-center rounded-full text-white"
                style={{ background: ACCENT_GRADIENT }}
              >
                <Check size={12} strokeWidth={3} />
              </span>
              Every connection verified in person
            </span>
          </div>

          <h1
            className="text-[44px] leading-[46px] font-semibold sm:text-[64px] sm:leading-[64px]"
            style={{ letterSpacing: "-.045em", textWrap: "balance", ...rise(80) }}
          >
            Everyone in here, you{" "}
            <span
              style={{
                background: ACCENT_GRADIENT,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              met in person.
            </span>
          </h1>

          <p
            className="max-w-[520px] text-[17px] leading-[27px] sm:text-[19px] sm:leading-[30px]"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty", ...rise(160) }}
          >
            SmartCard is a private network you can only grow face to face. Tap a card or scan a
            live code with someone standing in front of you. That is the only way in, and the
            only way to connect.
          </p>

          <div className="flex flex-wrap items-center gap-3" style={rise(240)}>
            <PrimaryButton href="/sign-in">Get started</PrimaryButton>
            <SecondaryButton href="#how-it-works">See how it works</SecondaryButton>
          </div>

          <ul
            className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium"
            style={{ color: "var(--sc-text-subtle)", ...rise(320) }}
          >
            {["No search", "No followers", "No ads"].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: "var(--sc-accent)" }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

/**
 * A glass "record" card around the ring diagram, with two floating chips that
 * name the two verification paths. Decorative as a whole except for the ring
 * diagram's own accessible summary, which says it is an example.
 *
 * Positioning and entrance animation are on separate elements, per DESIGN.md
 * §2's motion rule: an element that is both translated into place and animated
 * with a transform would have its position overwritten by the keyframes.
 */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[460px]" style={rise(200)}>
      {/* Halo behind the card, so the glass has colour to refract. */}
      <div
        aria-hidden
        className="absolute inset-[8%] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle at 40% 40%, rgba(11,96,255,.35), rgba(124,58,237,.18) 55%, transparent 75%)",
          animation: "sc-halo 7s ease-in-out infinite",
        }}
      />

      <div className="relative flex flex-col items-center gap-5 rounded-[32px] px-6 pt-7 pb-6" style={GLASS}>
        <div className="flex w-full items-center justify-between">
          <span
            className="font-mono text-[10.5px] font-medium uppercase"
            style={{ letterSpacing: ".14em", color: "var(--sc-text-subtle)" }}
          >
            Your record
          </span>
          <span
            className="rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase"
            style={{
              letterSpacing: ".12em",
              color: "var(--sc-text-muted)",
              background: "rgba(13,18,32,.05)",
            }}
          >
            Example
          </span>
        </div>

        <RingDiagram
          preset="profile"
          bands={EXAMPLE_BANDS}
          summary="An example SmartCard record: 14 connections, 6 events attended, 3 cities met people in."
          centre={
            <div
              className="absolute top-1/2 left-1/2 flex size-24 items-center justify-center rounded-full border text-[26px] font-semibold"
              style={{
                margin: "-48px",
                background: "rgba(255,255,255,.85)",
                borderColor: "rgba(255,255,255,.9)",
                boxShadow: "0 12px 30px -12px rgba(16,24,40,.25)",
                letterSpacing: "-.03em",
              }}
            >
              You
            </div>
          }
        />

        <p className="text-center text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          One tick for every person, event and city.
          <br />
          Nothing here can be bought, followed or faked.
        </p>
      </div>

      {/* Floating chips — positioned by the outer span, animated by the inner. */}
      <span className="absolute top-[18%] -left-3 hidden sm:block lg:-left-10" aria-hidden>
        <span
          className="flex items-center gap-2.5 rounded-[18px] py-2.5 pr-4 pl-2.5"
          style={{ ...GLASS, animation: "sc-spring-in .75s var(--sc-ease-spring) .6s both" }}
        >
          <IconPlate>
            <Nfc size={20} strokeWidth={1.9} />
          </IconPlate>
          <span className="flex flex-col">
            <span className="text-[13px] font-semibold">Card tapped</span>
            <span className="text-[11.5px]" style={{ color: "var(--sc-text-muted)" }}>
              NFC, phone to card
            </span>
          </span>
        </span>
      </span>

      <span className="absolute -right-3 bottom-[31%] hidden sm:block lg:-right-8" aria-hidden>
        <span
          className="flex items-center gap-2.5 rounded-[18px] py-2.5 pr-4 pl-2.5"
          style={{ ...GLASS, animation: "sc-spring-in .75s var(--sc-ease-spring) .85s both" }}
        >
          <span
            className="flex size-11 items-center justify-center rounded-[14px] text-white"
            style={{ background: ACCENT_GRADIENT }}
          >
            <BadgeCheck size={21} strokeWidth={2} />
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-semibold">Connected</span>
            <span className="text-[11.5px]" style={{ color: "var(--sc-text-muted)" }}>
              Verified in person
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* How it works                                                             */
/* ------------------------------------------------------------------------ */

const STEPS = [
  {
    n: "01",
    icon: <MapPin size={21} strokeWidth={1.9} />,
    title: "Meet someone",
    body: "Coffee, a conference, a friend's party. SmartCard starts where real life already happened, not before.",
  },
  {
    n: "02",
    icon: <QrCode size={21} strokeWidth={1.9} />,
    title: "Tap or scan",
    body: "Tap their SmartCard to your phone, or scan the code on their screen. The code changes every 30 seconds and both phones' locations are checked, so it only works when you are actually together.",
  },
  {
    n: "03",
    icon: <BadgeCheck size={21} strokeWidth={1.9} />,
    title: "Keep the record",
    body: "The connection is saved with when and how you met. Your rings grow with every person, event and city, and every tick is something that really happened.",
  },
] as const;

function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        eyebrow="How it works"
        title="Three steps, and the first one happens offline."
        lede="There is no invite link, no friend request and no way to add someone from across the room. If you have not been face to face, you cannot connect."
      />

      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex flex-col gap-5 rounded-[26px] p-6 sm:p-7" style={GLASS}>
            <div className="flex items-center justify-between">
              <IconPlate>{step.icon}</IconPlate>
              <span
                className="font-mono text-[12px] font-medium"
                style={{ letterSpacing: ".14em", color: "var(--sc-text-subtle)" }}
              >
                {step.n}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[19px] leading-[24px] font-semibold" style={{ letterSpacing: "-.02em" }}>
                {step.title}
              </h3>
              <p
                className="text-[15px] leading-[23px]"
                style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
              >
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Missing on purpose                                                       */
/* ------------------------------------------------------------------------ */

const ABSENCES = [
  {
    icon: <SearchX size={20} strokeWidth={1.9} />,
    title: "No search",
    body: "You cannot look anyone up, and nobody can look you up.",
  },
  {
    icon: <UserX size={20} strokeWidth={1.9} />,
    title: "No followers",
    body: "Every connection is mutual, and every one was made in person.",
  },
  {
    icon: <Megaphone size={20} strokeWidth={1.9} />,
    title: "No ads, no algorithm",
    body: "Nothing is ranked or suggested. Your feed is just what happened.",
  },
  {
    icon: <Lock size={20} strokeWidth={1.9} />,
    title: "No strangers",
    body: "Your profile is for the people you have actually met.",
  },
] as const;

function OnPurpose() {
  return (
    <Section id="on-purpose">
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.25fr] lg:gap-16">
        <SectionHeading
          eyebrow="Missing on purpose"
          title="What we left out is the point."
          lede="Most social apps grow by making it easy to reach people you do not know. SmartCard does the opposite, so the people in it are the ones who matter."
        />

        <ul className="grid gap-3 sm:grid-cols-2">
          {ABSENCES.map((item) => (
            <li key={item.title} className="flex flex-col gap-4 rounded-[22px] p-5" style={GLASS}>
              <IconPlate tone="ink">{item.icon}</IconPlate>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[16px] leading-[21px] font-semibold" style={{ letterSpacing: "-.02em" }}>
                  {item.title}
                </h3>
                <p className="text-[14px] leading-[21px]" style={{ color: "var(--sc-text-muted)" }}>
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Trust                                                                    */
/* ------------------------------------------------------------------------ */

const SAFEGUARDS = [
  {
    icon: <RefreshCw size={20} strokeWidth={1.9} />,
    title: "Codes that expire",
    body: "The QR code on your screen refreshes every 30 seconds. A screenshot sent to someone across town is already useless.",
  },
  {
    icon: <MapPin size={20} strokeWidth={1.9} />,
    title: "Location as proof, not tracking",
    body: "Your location is checked at the moment you connect, to confirm you are together. Either of you can hide where you met at any time.",
  },
  {
    icon: <ShieldCheck size={20} strokeWidth={1.9} />,
    title: "When in doubt, it says no",
    body: "If your location cannot be confirmed, the connection does not happen. No exceptions and no workarounds.",
  },
] as const;

function Trust() {
  return (
    <Section id="trust">
      <div
        className="relative overflow-hidden rounded-[32px] px-6 py-12 sm:px-12 sm:py-16"
        style={{
          ...GLASS,
          background:
            "linear-gradient(160deg, rgba(255,255,255,.82), rgba(255,255,255,.6)), radial-gradient(500px 300px at 90% 0%, rgba(11,96,255,.14), transparent 70%)",
        }}
      >
        <SectionHeading
          eyebrow="Privacy and trust"
          title="Built so a connection can't be faked."
          lede="Being in the same place is the whole idea, so SmartCard checks it properly every single time."
        />

        <ul className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
          {SAFEGUARDS.map((item) => (
            <li key={item.title} className="flex flex-col gap-4">
              <IconPlate>{item.icon}</IconPlate>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[17px] leading-[22px] font-semibold" style={{ letterSpacing: "-.02em" }}>
                  {item.title}
                </h3>
                <p
                  className="text-[15px] leading-[23px]"
                  style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
                >
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Events                                                                   */
/* ------------------------------------------------------------------------ */

function Events() {
  return (
    <Section id="events">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <SectionHeading
          eyebrow="Events"
          title="The room, before you walk in."
          lede={
            <>
              RSVP to events, see what is coming up and meet people there. Attendees who choose to
              can appear on that event&apos;s guest list, which only fellow attendees can see.
              Nobody is listed unless they say yes, and you still connect the same way: in person.
            </>
          }
        />

        <EventsVisual />
      </div>
    </Section>
  );
}

/** A static, clearly generic event card — no real event, venue or person. */
function EventsVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[440px]">
      <div className="flex flex-col gap-5 rounded-[26px] p-6" style={GLASS} aria-hidden>
        <div className="flex items-start gap-4">
          <div
            className="flex w-14 shrink-0 flex-col items-center rounded-[16px] py-2"
            style={{ background: "rgba(13,18,32,.05)" }}
          >
            <span
              className="font-mono text-[10px] font-medium uppercase"
              style={{ letterSpacing: ".14em", color: "var(--sc-accent-deep)" }}
            >
              Fri
            </span>
            <span className="text-[22px] leading-[26px] font-semibold">14</span>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[17px] leading-[22px] font-semibold" style={{ letterSpacing: "-.02em" }}>
              Founders&apos; breakfast
            </span>
            <span className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--sc-text-muted)" }}>
              <CalendarDays size={14} strokeWidth={1.9} /> 8:30 AM · Downtown
            </span>
          </div>
          <span
            className="ml-auto shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold text-white"
            style={{ background: ACCENT_GRADIENT }}
          >
            Going
          </span>
        </div>

        <div className="h-px w-full" style={{ background: "rgba(13,18,32,.07)" }} />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2.5">
              {["A", "M", "J", "R"].map((letter, i) => (
                <span
                  key={letter}
                  className="flex size-9 items-center justify-center rounded-full border-2 border-white text-[13px] font-semibold"
                  style={{
                    background: ["#dbe7ff", "#e9e1ff", "#dff3ea", "#ffe9d9"][i],
                    color: "var(--sc-text)",
                  }}
                >
                  {letter}
                </span>
              ))}
            </div>
            <span className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
              On the guest list
              <br />
              <span style={{ color: "var(--sc-text-subtle)" }}>attendees who opted in</span>
            </span>
          </div>
          <Ticket size={20} strokeWidth={1.8} style={{ color: "var(--sc-text-subtle)" }} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* The physical card                                                        */
/* ------------------------------------------------------------------------ */

function HaveACard() {
  return (
    <Section id="card">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
        <CardVisual />

        <div className="flex flex-col gap-7">
          <SectionHeading
            eyebrow="The card"
            title="Already have a SmartCard? Just tap."
            lede="Hold your card near any phone and it opens straight to SmartCard. Got a brand new one? Tap it and claim it as yours. If you ever lose it, you can switch it off in the app."
          />
          <div className="flex flex-wrap gap-3">
            <PrimaryButton href="/sign-in">Set up your account</PrimaryButton>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** The physical card, drawn — a tilted glass plate with an NFC mark. */
function CardVisual() {
  return (
    <div className="relative mx-auto flex w-full max-w-[440px] justify-center py-6 lg:order-none" aria-hidden>
      <div
        className="absolute inset-x-[12%] inset-y-[18%] rounded-full blur-3xl"
        style={{ background: "rgba(11,96,255,.22)" }}
      />
      <div style={{ transform: "rotate(-7deg)" }}>
        <div
          className="relative flex aspect-[1.586] w-[300px] flex-col justify-between overflow-hidden rounded-[22px] p-6 text-white sm:w-[340px]"
          style={{
            background: "linear-gradient(140deg, #1a6dff 0%, var(--sc-accent) 38%, var(--sc-accent-deep) 100%)",
            boxShadow: "0 30px 60px -20px rgba(9,70,187,.55), inset 0 1px 0 rgba(255,255,255,.35)",
            animation: "sc-rise .9s var(--sc-ease-spring) both",
          }}
        >
          <span
            className="absolute top-[-40%] left-0 h-[180%] w-[30%]"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)",
              animation: "sc-shimmer 4.6s var(--sc-ease-glide) infinite",
            }}
          />
          <div className="relative flex items-center justify-between">
            <span className="text-[18px] font-semibold" style={{ letterSpacing: "-.025em" }}>
              SmartCard
            </span>
            <Nfc size={26} strokeWidth={1.7} />
          </div>
          <div className="relative flex items-end justify-between">
            <span
              className="font-mono text-[11px] font-medium uppercase opacity-80"
              style={{ letterSpacing: ".16em" }}
            >
              Tap to connect
            </span>
            <QrCode size={30} strokeWidth={1.5} className="opacity-90" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Closing call to action + footer                                          */
/* ------------------------------------------------------------------------ */

function FinalCta() {
  return (
    <Section className="pb-24 sm:pb-32">
      <div
        className="flex flex-col items-center gap-7 rounded-[32px] px-6 py-14 text-center sm:px-12 sm:py-20"
        style={GLASS}
      >
        <AppMark size={78} radius={26} icon={36} />
        <div className="flex max-w-[560px] flex-col gap-3">
          <h2
            className="text-[34px] leading-[38px] font-semibold sm:text-[44px] sm:leading-[48px]"
            style={{ letterSpacing: "-.04em", textWrap: "balance" }}
          >
            Your people, and nobody else.
          </h2>
          <p className="text-[16px] leading-[25px] sm:text-[17px]" style={{ color: "var(--sc-text-muted)" }}>
            Make an account now, and your first connection happens the next time you meet someone.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <PrimaryButton href="/sign-in">Create your account</PrimaryButton>
          <SecondaryButton href="/sign-in">I already have one</SecondaryButton>
        </div>
      </div>
    </Section>
  );
}

function SiteFooter() {
  return (
    <footer className="px-5 pb-10 sm:px-8">
      <div
        className="mx-auto flex w-full max-w-[1120px] flex-col items-center justify-between gap-4 border-t pt-8 text-[13px] sm:flex-row"
        style={{ borderColor: "rgba(13,18,32,.08)", color: "var(--sc-text-subtle)" }}
      >
        <div className="flex items-center gap-2.5">
          <AppMark size={26} radius={9} icon={13} />
          <span className="font-medium" style={{ color: "var(--sc-text-muted)" }}>
            SmartCard
          </span>
          <span>· Connections made in person.</span>
        </div>
        <span className="font-mono text-[11.5px]">© {new Date().getFullYear()} SmartCard</span>
      </div>
    </footer>
  );
}
