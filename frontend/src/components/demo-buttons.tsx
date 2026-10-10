"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiError, signInAsDemo } from "@/lib/api";
import { useRefreshSession } from "@/lib/use-session";

export type DemoRole = "farmer" | "operator" | "facilitator" | "officer";

/** Signs in as a seeded demo user and opens their page; `state` drives the button's words. */
export function useDemoSignIn(role: DemoRole) {
  const router = useRouter();
  const refreshSession = useRefreshSession();
  const [state, setState] = useState<"idle" | "working" | "failed" | "off">("idle");
  async function go() {
    setState("working");
    try {
      const home = await signInAsDemo(role);
      // The demo farmer gets a one-time login link (a route handler that sets the phone session):
      // load it as a page, the way a farmer opens it from WhatsApp.
      if (home.startsWith("/farmer/login/")) {
        window.location.assign(home);
        return;
      }
      await refreshSession();
      router.push(home);
    } catch (error) {
      // 404 means the API is up but demo sign-in is switched off; anything else means it is unreachable.
      setState(error instanceof ApiError && error.status === 404 ? "off" : "failed");
    }
  }
  return { state, go };
}

/** One-click "Try as …" for judges and visitors: a real session for a seeded demo user. */
export function DemoButton({
  role,
  label,
  variant = "primary",
  className = "",
}: {
  role: DemoRole;
  label: string;
  variant?: "primary" | "accent" | "secondary";
  /** Sizing for the wrapper, e.g. "w-full sm:w-auto"; the button fills it. */
  className?: string;
}) {
  const t = useTranslations("signin");
  const { state, go } = useDemoSignIn(role);
  const style =
    variant === "accent"
      ? "bg-wheat text-on-wheat border-wheat-deep/30 hover:bg-wheat/90"
      : variant === "secondary"
        ? "bg-surface text-ink border-line-strong hover:border-ink/50"
        : "bg-ink text-paper border-ink hover:bg-ink/90";
  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <button type="button" onClick={go} disabled={state === "working"} className={`group inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-control border px-6 text-base font-medium transition-[background-color,scale] duration-200 active:scale-[0.98] ${style} disabled:opacity-60`}>
        {state === "working" ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
        {state === "working" ? t("working") : label}
        {state !== "working" ? <ArrowRight aria-hidden className="size-5 transition-transform duration-300 ease-out group-hover:translate-x-1" strokeWidth={1.75} /> : null}
      </button>
      {state === "failed" || state === "off" ? (
        <span role="alert" className="text-sm text-ember-deep">
          {state === "off" ? t("demoOff") : t("failed")}
        </span>
      ) : null}
    </span>
  );
}
