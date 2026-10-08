"use client";

/**
 * A small accessible dropdown: a button that opens a panel of menu items. Closes on Escape,
 * outside click or choosing an item, then returns focus to the button. Arrow keys move between
 * items. Used by the account and language menus so both behave the same.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  buttonClassName: string;
  buttonContent: ReactNode;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
};

export function Dropdown({ label, buttonClassName, buttonContent, panelClassName = "w-64", children }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
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
      if (!wrapperRef.current?.contains(event.target as Node)) close(false);
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
    <div ref={wrapperRef} className="relative">
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
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label={label}
          className={`absolute right-0 top-full z-50 mt-3 rounded-card border border-line bg-surface p-2 text-ink shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] ${panelClassName}`}
        >
          {children(() => close())}
        </div>
      ) : null}
    </div>
  );
}

export const MENU_ITEM_CLASS =
  "flex min-h-11 w-full items-center gap-3 rounded-chip px-3 text-left text-sm text-ink hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:outline-none";
