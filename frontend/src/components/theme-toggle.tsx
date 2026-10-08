"use client";

/** The intake project's theme toggle (@theme-toggles/react "Classic"); it animates from the `dark` class on <html>. */
import "@theme-toggles/react/styles/classic.css";
import { Classic } from "@theme-toggles/react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/contexts/theme-context";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const t = useTranslations("common");
  const label = theme === "dark" ? t("themeToLight") : t("themeToDark");
  return (
    <div className="flex items-center" suppressHydrationWarning>
      <Classic
        duration={750}
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        className="grid size-11 cursor-pointer place-items-center rounded-full text-ink hover:bg-ink/5"
        style={{ fontSize: "1.25rem" }}
      />
    </div>
  );
}
