import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept up to date. `fallback` is what
 * renders where `matchMedia` does not exist (tests, very old browsers).
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : fallback,
    () => fallback,
  );
}
