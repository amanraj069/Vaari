/** The person's initials in a wheat circle; an outline of a person when there is no name yet. */
import { UserRound } from "lucide-react";
import { initials } from "@/lib/viewer-kind";

export function Avatar({ name, size = "md" }: { name: string | null; size?: "sm" | "md" }) {
  const letters = initials(name);
  const box = size === "sm" ? "size-9 text-xs" : "size-11 text-sm";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-wheat-soft font-semibold text-ink ${box}`}>
      {letters ?? <UserRound className="size-[45%] text-wheat-deep" strokeWidth={1.75} />}
    </span>
  );
}
