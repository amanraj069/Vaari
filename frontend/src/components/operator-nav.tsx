"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export function OperatorNav() {
  const t = useTranslations("operator");
  const pathname = usePathname();
  const links = [
    { href: "/operator", label: t("navPlan") },
    { href: "/operator/queue", label: t("navQueue") },
  ];
  return (
    <>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
          className={`inline-flex min-h-9 items-center rounded-[8px] px-3 text-sm ${pathname === link.href ? "bg-ink/5 font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
