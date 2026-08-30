"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ImportClaimLink } from "@smartcard/types";

import { GLASS } from "../../../lib/surfaces";

/**
 * The pending claim links, one row per guest, each with a copy button.
 *
 * WHY THE URL IS BUILT IN THE BROWSER AND NOT ON THE SERVER
 *
 * `window.location.origin` is the origin the host is looking at this page on,
 * which is by construction the origin the claim link has to point at. The
 * alternative — an app-URL environment variable — is a second place the answer
 * lives, and the failure mode is silent and bad: a preview deployment or a
 * stale variable produces links that look right, get sent to real people, and
 * land nowhere. There is no such variable in `.env.example` today and this
 * screen is not a reason to add one.
 *
 * WHY EACH ROW IS COPIED SEPARATELY AND THERE IS NO "COPY ALL"
 *
 * This exists because the email phase (§5) is not built, and it is meant to
 * stay obviously smaller than the thing it stands in for. A button that yields
 * every token at once is a mail-merge tool — it would make hand-sending a
 * hundred invitations feel supported, and it puts a file of claim tokens on
 * somebody's disk. One at a time is enough to test the flow and enough to
 * chase a guest who missed out, which is what this is for.
 */
export function ClaimLinksList({ links }: { links: readonly ImportClaimLink[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {links.map((link) => (
        <ClaimLinkRow key={link.lookup_token} link={link} />
      ))}
    </ul>
  );
}

function ClaimLinkRow({ link }: { link: ImportClaimLink }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    const url = `${window.location.origin}/claim/${link.lookup_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // `navigator.clipboard` is unavailable over plain HTTP and can be refused
      // by permissions policy. Prompting with the URL is a worse experience but
      // it is not a dead end — a host who cannot copy cannot send anything, and
      // silently doing nothing would read as a broken button.
      window.prompt("Copy this claim link", url);
    }
  }, [link.lookup_token]);

  const name = [link.first_name, link.last_name].filter(Boolean).join(" ");

  return (
    <li className="flex items-center gap-3 rounded-[20px] px-4 py-3" style={GLASS}>
      <div className="flex min-w-0 flex-col">
        {/*
          The name is the heading when there is one, and the email drops to a
          subtitle. A guest list may carry nothing but an address, so the email
          becomes the heading in that case rather than leaving a blank line —
          it is the only identifier that row has.
        */}
        <span className="truncate text-[14px] leading-[19px] font-medium">
          {name === "" ? link.email : name}
        </span>
        {name === "" ? null : (
          <span
            className="truncate text-[12px] leading-[17px]"
            style={{ color: "var(--sc-text-subtle)" }}
          >
            {link.email}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => void copy()}
        className="ml-auto flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] leading-[17px] font-semibold"
        style={{
          background: copied ? "var(--sc-accent)" : "var(--sc-surface-2, rgba(0,0,0,.06))",
          color: copied ? "#fff" : "var(--sc-text)",
        }}
        aria-label={`Copy the claim link for ${name === "" ? link.email : name}`}
      >
        {copied ? <Check size={15} strokeWidth={2.6} aria-hidden /> : <Copy size={15} aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </li>
  );
}
