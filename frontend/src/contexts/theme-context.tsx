"use client";

/**
 * Light/dark theme, the same way as the intake project: the stored choice wins, otherwise the
 * system preference. The inline script in layout.tsx applies it before first paint (no flash);
 * this context keeps the `dark` class and colour-scheme on <html> in sync and remembers the choice.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "theme";

type ThemeContextValue = { theme: Theme; toggleTheme: () => void; selectTheme: (theme: Theme) => void };

const ThemeContext = createContext<ThemeContextValue>({ theme: "light", toggleTheme: () => {}, selectTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // localStorage and matchMedia only exist in the browser, so the choice is read after mount.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage can be blocked (private mode); fall back to the system preference.
    }
    if (stored === "light" || stored === "dark") setTheme(stored);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Not persisted; the theme still applies for this visit.
    }
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => setTheme((previous) => (previous === "dark" ? "light" : "dark")), []);
  const selectTheme = useCallback((next: Theme) => setTheme(next), []);

  return <ThemeContext.Provider value={{ theme, toggleTheme, selectTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Runs in <head> before React: applies the stored or system theme so the first paint is right. */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var d=document.documentElement;if(s==='dark'||(!s&&window.matchMedia('(prefers-color-scheme: dark)').matches)){d.classList.add('dark');d.style.colorScheme='dark';}else{d.classList.remove('dark');d.style.colorScheme='light';}}catch(e){}})();`;
