import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme adds a `text-2xs` size; without this, tailwind-merge would read it
// as a colour and keep it alongside another text size instead of replacing it.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["2xs"] } } });

/** Merge conditional class names, de-duplicating conflicting Tailwind classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
