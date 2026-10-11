/** The person's initials in a neutral circle; an outline of a person when there is no name yet. */
import { UserRound } from "lucide-react";
import { initials } from "@/lib/viewer-kind";

export function Avatar({ name, size = "md" }: { name: string | null; size?: "sm" | "md" }) {
  const letters = initials(name);
  const box = size === "sm" ? "size-9 text-xs" : "size-11 text-sm";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-ink/[0.07] font-semibold text-ink ring-1 ring-inset ring-line ${box}`}>
      {letters ?? <UserRound className="size-[45%] text-ink-muted" strokeWidth={1.75} />}
    </span>
  );
}
