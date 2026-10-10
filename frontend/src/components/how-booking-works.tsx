/** How booking works in three steps, for a village helper doing it the first time (Bookings and Book pages). */
import { Link2, MessageCircle, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";

export function HowBookingWorks() {
  const t = useTranslations("bookings");
  const steps = [
    { icon: UserPlus, title: t("how1Title"), body: t("how1Body") },
    { icon: Link2, title: t("how2Title"), body: t("how2Body") },
    { icon: MessageCircle, title: t("how3Title"), body: t("how3Body") },
  ];
  return (
    <ol className="space-y-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-chip bg-wheat-soft text-wheat-deep">
            <step.icon className="size-4" strokeWidth={1.9} />
          </span>
          <span>
            <span className="block text-sm font-semibold">
              {index + 1}. {step.title}
            </span>
            <span className="block text-sm text-ink-muted">{step.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

