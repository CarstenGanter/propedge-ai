"use client";

import { Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "./themeScript";

/**
 * Paper / night edition switch. It reads the theme from <html> at click time
 * and shows both icons through CSS, so nothing depends on client state and
 * nothing can mismatch during hydration.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the switch still works for this visit.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Moon className="h-[18px] w-[18px] dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-[18px] w-[18px] dark:block" aria-hidden="true" />
      <span className="sr-only dark:hidden">Switch to the night edition</span>
      <span className="sr-only hidden dark:inline">Switch to the paper edition</span>
    </button>
  );
}
