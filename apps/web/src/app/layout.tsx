import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

/**
 * The two typefaces `docs/design/DESIGN.md` §2 specifies, replacing the
 * scaffold's Geist sans.
 *
 * Instrument Sans carries everything. Geist Mono is reserved — deliberately
 * narrowly — for card codes, timestamps in record contexts, small-caps labels,
 * and any value a user would actually copy (phone, email). That split is a
 * legibility decision, not decoration: a monospaced run of digits is the one
 * thing a person transcribes by eye, and the design brief treats "a value you
 * would copy" as the test for which face to use.
 *
 * Both are loaded through `next/font/google`, which self-hosts them as build
 * output. No request reaches Google from a user's browser — which matters more
 * than usual here, because this app's whole premise is that who you have met is
 * private, and a font request from a page leaks that the page was visited.
 */
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SmartCard",
  description: "Connections made in person.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
