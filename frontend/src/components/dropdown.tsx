"use client";

/**
 * A small accessible dropdown: a button that opens a panel of menu items. Closes on Escape,
 * outside click or choosing an item, then returns focus to the button. Arrow keys move between
 * items. Used by the account and language menus so both behave the same.
 */
import { motion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EASE_OUT } from "./dashboard/motion";

type Props = {
  label: string;
  buttonClassName: string;
  buttonContent: ReactNode;
  panelClassName?: string;
  // below: opens under the button, right-aligned (top bars); above: over it, left-aligned (the sidebar's foot).
  placement?: "below" | "above";
  className?: string;
  // Shown before the button inside the same box, so the panel spans the whole box (the sidebar's
  // foot: the profile link, then the menu's own button). A click on it counts as outside the menu.
  leading?: ReactNode;
  children: (close: () => void) => ReactNode;
};

export function Dropdown({ label, buttonClassName, buttonContent, panelClassName = "w-64", placement = "below", className = "", leading, children }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const items = () => [...(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    items()[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
        list[next]?.focus();
      }
      if (event.key === "Tab") close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div className={`relative ${className}`}>
      {leading}
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={buttonClassName}
      >
        {buttonContent}
      </button>
      {open ? (
        <motion.div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label={label}
          // Eases in from the side it opens on: a short slide, fade and a hint of scale.
          initial={{ opacity: 0, y: placement === "above" ? 6 : -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          style={{ transformOrigin: placement === "above" ? "bottom left" : "top right" }}
          className={`absolute z-50 rounded-card border border-line bg-surface p-2 text-ink shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] ${placement === "above" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-3"} ${panelClassName}`}
        >
          {children(() => close())}
        </motion.div>
      ) : null}
    </div>
  );
}

export const MENU_ITEM_CLASS =
  "flex min-h-11 w-full items-center gap-3 rounded-chip px-3 text-left text-sm text-ink hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:outline-none";
