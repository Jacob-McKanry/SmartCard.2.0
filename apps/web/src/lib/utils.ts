import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class lists, with later classes winning conflicts
 * (`tailwind-merge`) after conditional composition (`clsx`).
 *
 * Standard shadcn/ui helper — every component in `src/components/ui` composes
 * its own default classes with a caller-supplied `className` through this, so
 * a consumer can override a default without fighting Tailwind's cascade order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
