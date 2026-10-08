"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { signInAsDemo } from "@/lib/api";

/** One-click "Try as …" for judges and visitors: a real session for a seeded demo user. */
export function DemoButton({ role, label, variant = "primary" }: { role: "farmer" | "operator"; label: string; variant?: "primary" | "accent" }) {
  const router = useRouter();
  const t = useTranslations("signin");
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  async function go() {
    setState("working");
    try {
      router.push(await signInAsDemo(role));
    } catch {
      setState("failed");
    }
  }
  const style = variant === "accent" ? "bg-wheat text-ink border-wheat-deep/30 hover:bg-wheat/90" : "bg-ink text-paper border-ink hover:bg-ink/90";
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={go} disabled={state === "working"} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] border px-5 text-base font-medium ${style} disabled:opacity-60`}>
        {state === "working" ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
        {state === "working" ? t("working") : label}
        {state !== "working" ? <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} /> : null}
      </button>
      {state === "failed" ? <span role="alert" className="text-sm text-ember-deep">{t("failed")}</span> : null}
    </span>
  );
}
