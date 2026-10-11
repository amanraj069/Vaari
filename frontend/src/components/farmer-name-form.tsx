"use client";

/**
 * The last step for a farmer Vaari has never seen: their name (what the machine operator sees) and
 * their own consent to messages about their bookings. Shown after the sign-in code, and on /farmer
 * if someone left before finishing. The button never sits dim without a reason: tapping it early
 * says what is missing ("Type your name", "Tick the box").
 */
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "./ui";

export const FIELD_INPUT = "mt-2 min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 shadow-control";

/**
 * `askConsent={false}`: on sign-in the farmer is asked on the phone step, before any code, so only
 * the name is asked here and `consentGiven` carries their answer.
 */
export function FarmerNameForm({ onDone, askConsent = true, consentGiven = false, className = "" }: { onDone: (name: string) => void; askConsent?: boolean; consentGiven?: boolean; className?: string }) {
  const t = useTranslations("farmerSignin");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [consentHere, setConsent] = useState(false);
  // On sign-in the step is mounted from the start, so read the phone step's consent live.
  const consent = consentGiven || consentHere;
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missing = name.trim().length === 0 ? t("hintName") : !consent ? t("hintConsent") : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (missing) {
      setHint(missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/proxy/farmer/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), consent, language: locale }),
      });
      const body = (await response.json().catch(() => null)) as { name?: string } | null;
      if (!response.ok || !body?.name) {
        setError(t("errorGeneric"));
        return;
      }
      onDone(body.name);
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={`flex flex-1 flex-col text-base sm:text-lg ${className}`}>
      <div className="space-y-5">
        <label className="block">
          <span className="font-medium">{t("nameLabel")}</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setHint(null);
            }}
            maxLength={80}
            autoComplete="name"
            className={FIELD_INPUT}
          />
          <span className="mt-2 block text-sm sm:text-base text-ink-muted">{t("nameHelp")}</span>
        </label>
        {!askConsent ? null : (
          <>
        {/* The whole row is the target (at least 48px); the native checkbox stays for keyboards and screen readers. */}
        <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-line bg-paper p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              setHint(null);
            }}
            className="peer sr-only"
          />
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2 border-ink-muted transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper">
            {consent ? <Check className="size-4" strokeWidth={3} /> : null}
          </span>
          <span className="text-sm sm:text-base">{t("consentLabel")}</span>
        </label>
          </>
        )}
      </div>
      <div className="mt-auto pt-5">
        {error ? (
          <p role="alert" className="mb-4 rounded-control border border-ember/40 bg-ember-soft/50 px-3 py-2 text-base text-ember-deep">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="accent" aria-disabled={missing !== null || busy} className={`min-h-12 w-full ${missing ? "opacity-60" : ""}`}>
          {busy ? t("saving") : t("continue")}
        </Button>
        <p aria-live="polite" className="mt-2 min-h-6 text-center text-sm sm:text-base text-wheat-deep">
          {hint}
        </p>
      </div>
    </form>
  );
}
