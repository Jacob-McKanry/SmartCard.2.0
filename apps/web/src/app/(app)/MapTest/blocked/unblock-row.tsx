"use client";

import { useState, useTransition } from "react";

import { GLASS } from "../../events/lib/surfaces";
import type { BlockedPerson } from "@/server/safety/blocks-service";
import { unblockUserAction } from "./actions";

export function UnblockRow({ person }: { person: BlockedPerson }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex items-center justify-between gap-3 rounded-[22px] p-[15px]" style={GLASS}>
      <div className="flex flex-col">
        <span className="text-[14px] leading-[19px] font-semibold">
          {person.firstName ?? "Deleted account"}
        </span>
        <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
          Blocked {new Date(person.blockedAt).toLocaleDateString()}
        </span>
        {error !== null ? (
          <span className="text-[12px] leading-[17px]" style={{ color: "#dc2626" }}>
            {error}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              await unblockUserAction(person.blockedUserId);
            } catch {
              setError("Couldn't unblock — try again.");
            }
          })
        }
        className="min-h-11 shrink-0 rounded-full px-4 text-[13px] leading-[17px] font-semibold disabled:opacity-60"
        style={{ background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }}
      >
        {pending ? "Unblocking…" : "Unblock"}
      </button>
    </li>
  );
}
