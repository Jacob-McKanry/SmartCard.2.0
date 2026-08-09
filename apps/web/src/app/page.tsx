import { placeholder as corePlaceholder } from "@smartcard/core";
import { placeholder as apiClientPlaceholder } from "@smartcard/api-client";

export default function Home() {
  // Proves the pnpm workspace wiring (apps/web -> packages/core,
  // packages/api-client -> packages/types) actually resolves at build time.
  console.log(corePlaceholder(), apiClientPlaceholder());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        SmartCard — under construction
      </h1>
    </div>
  );
}
