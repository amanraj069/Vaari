"use client";

/**
 * Dialog on the native <dialog> element: modal focus trap, Escape to close and top-layer
 * rendering come from the browser. Focus returns to whatever opened it.
 */
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  closeLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ open, onClose, title, description, closeLabel, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const returnFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement;
      // jsdom has no showModal; fall back to the open attribute there.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      {open ? (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-2xl">{title}</h2>
            <button type="button" onClick={onClose} aria-label={closeLabel} className="-m-2 grid size-11 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-ink/5 hover:text-ink">
              <X aria-hidden className="size-5" strokeWidth={1.75} />
            </button>
          </div>
          {description ? <p id={descriptionId} className="mt-2 text-ink-muted">{description}</p> : null}
          {children ? <div className="mt-5">{children}</div> : null}
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
