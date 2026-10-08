"use client";

/** Onboarding form: name, role (farmer or operator), CHC, language. Big targets, one question per block. */
import { Check, Sprout, Tractor } from "lucide-react";
import { PAGE_TITLE } from "./page-shell";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ChcOption, Locale, Role } from "@/shared";
import { useRefreshSession } from "@/lib/use-session";
import { Button } from "./ui";

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "hi", label: "हिन्दी" },
];

type Props = {
  chcs: ChcOption[];
  suggestedName: string;
  currentRole: Role | null;
  locale: Locale;
  operatorSelfService: boolean;
};

export function WelcomeForm({ chcs, suggestedName, currentRole, locale, operatorSelfService }: Props) {
  const t = useTranslations("welcome");
  const router = useRouter();
  const refreshSession = useRefreshSession();
  const [name, setName] = useState(suggestedName);
  const [role, setRole] = useState<"farmer" | "operator">(currentRole === "operator" ? "operator" : "farmer");
  const [chcId, setChcId] = useState(chcs.length === 1 ? chcs[0]!.id : "");
  const [language, setLanguage] = useState<Locale>(locale);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const operatorAllowed = operatorSelfService || currentRole === "operator";

  const roles = [
    { value: "farmer" as const, label: t("roleFarmer"), body: t("roleFarmerBody"), Icon: Sprout, allowed: true },
    { value: "operator" as const, label: t("roleOperator"), body: t("roleOperatorBody"), Icon: Tractor, allowed: operatorAllowed },
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("saving");
    const response = await fetch("/api/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), role, chcId, language }),
    }).catch(() => null);
    if (!response?.ok) return setState("failed");
    const { home } = (await response.json()) as { home: string };
    await refreshSession();
    router.push(home);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-8 text-lg">
      <div>
        <h1 className={PAGE_TITLE}>{t("title")}</h1>
        <p className="mt-2 text-ink-muted">{t("body")}</p>
      </div>

      <label className="block">
        <span className="font-medium">{t("nameLabel")}</span>
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          className="mt-2 min-h-12 w-full rounded-control border border-line-strong bg-surface px-3"
        />
      </label>

      <fieldset>
        <legend className="font-medium">{t("roleLabel")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {roles.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!option.allowed}
              aria-pressed={role === option.value}
              onClick={() => setRole(option.value)}
              className={`flex min-h-24 flex-col items-start gap-1 rounded-card border p-5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                role === option.value ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink/50"
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <option.Icon aria-hidden className="size-5" strokeWidth={1.75} />
                {option.label}
              </span>
              <span className={`text-sm ${role === option.value ? "text-paper/80" : "text-ink-muted"}`}>{option.body}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {operatorAllowed ? (role === "operator" && operatorSelfService ? t("operatorDemoNote") : t("comingSoon")) : t("operatorLocked")}
        </p>
      </fieldset>

      <fieldset>
        <legend className="font-medium">{t("chcLabel")}</legend>
        <div className="mt-2 space-y-2">
          {chcs.map((chc) => (
            <button
              key={chc.id}
              type="button"
              aria-pressed={chcId === chc.id}
              onClick={() => setChcId(chc.id)}
              className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-control border px-4 text-left ${
                chcId === chc.id ? "border-ink bg-surface ring-2 ring-ink" : "border-line bg-surface hover:border-ink/50"
              }`}
            >
              <span>
                <span className="block font-medium">{chc.name}</span>
                <span className="block text-sm text-ink-muted">{t("chcMeta", { villages: chc.villageCount, machines: chc.machineCount })}</span>
              </span>
              {chcId === chc.id ? <Check aria-hidden className="size-5" strokeWidth={2} /> : null}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-medium">{t("languageLabel")}</legend>
        <div className="mt-2 flex gap-2">
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              lang={option.code}
              aria-pressed={language === option.code}
              onClick={() => setLanguage(option.code)}
              className={`min-h-12 flex-1 rounded-control border ${language === option.code ? "border-ink bg-ink text-paper" : "border-line bg-surface"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {state === "failed" ? <p role="alert" className="text-ember-deep">{t("failed")}</p> : null}
      <Button type="submit" variant="accent" className="min-h-12 w-full text-lg" disabled={!name.trim() || !chcId || state === "saving"}>
        {state === "saving" ? t("saving") : t("continue")}
      </Button>
    </form>
  );
}
