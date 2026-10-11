"use client";

/**
 * Farmer sign-in, one question at a time: the mobile number (India, +91 fixed, 10 digits) with the
 * farmer's consent to messages (needed before any code is sent), then the six-digit code sent on
 * WhatsApp (the same screen whether or not the number is known), then, only for a number Vaari has
 * never seen, the name (FarmerNameForm). A number a helper already booked with goes straight to
 * its bookings. The code goes to our own route handler, which keeps the session in an httpOnly
 * cookie. For a demo farmer's phone nothing is sent: the code is shown on screen, labelled as a demo. Every
 * refusal from the API has its own sentence, and a button never sits dim without saying why.
 */
import { Check, KeyRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { farmerOtpSentSchema, type FarmerOtpSent } from "@/shared";
import { FIELD_INPUT, FarmerNameForm } from "./farmer-name-form";
import { StackPanel } from "./stack-panel";
import { Button } from "./ui";
import { WhatsAppGlyph } from "./whatsapp-start";

type Step = "phone" | "code" | "name";
type Refusal = { error?: string; retryInSeconds?: number; attemptsLeft?: number };

const STEPS: Step[] = ["phone", "code", "name"];
const openPage = (path: string) => window.location.assign(path);

/** The ten digits of an Indian mobile number from whatever was typed or pasted (+91, 0, spaces). */
export function mobileDigits(typed: string): string {
  let digits = typed.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export const isMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);
export const spacedMobile = (digits: string) => `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;

/** The three steps share one grid cell (StackPanel); going back slides back, moving on slides forward. */
function Panel({ step, current, children }: { step: Step; current: Step; children: ReactNode }) {
  return (
    <StackPanel active={step === current} offset={STEPS.indexOf(step) < STEPS.indexOf(current) ? -16 : 16}>
      {children}
    </StackPanel>
  );
}

/** What the code step looks like before a code is sent: its tallest form, so the box is sized for it. */
const CODE_SHAPE = { channel: "demo" as const, expiresInSeconds: 600, resendInSeconds: 30, demoCode: "000000", digits: "9000000000" };

export function FarmerSigninForm({ next = "/dashboard", onSignedIn = openPage }: { next?: string; onSignedIn?: (path: string) => void }) {
  const t = useTranslations("farmerSignin");
  const locale = useLocale();
  const [step, setStep] = useState<Step>("phone");
  const [digits, setDigits] = useState("");
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState<(FarmerOtpSent & { digits: string }) | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // A one-second clock only while a resend countdown is running.
  useEffect(() => {
    if (step !== "code" || resendAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step, resendAt]);

  const phoneReady = isMobile(digits);
  const phoneInvalid = digits.length === 10 && !phoneReady;
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function explain(refusal: Refusal | null): string {
    switch (refusal?.error) {
      case "RESEND_TOO_SOON":
        return t("errorResendSoon", { seconds: refusal.retryInSeconds ?? 30 });
      case "TOO_MANY_CODES":
        return t("errorTooMany");
      case "NUMBER_NOT_ALLOWED":
        return t("errorNotAllowed");
      case "OTP_SEND_FAILED":
        return t("cantGetCode");
      case "OTP_OFF":
        return t("errorOff");
      case "CODE_WRONG":
        return t("errorWrong", { count: refusal.attemptsLeft ?? 0 });
      case "CODE_LOCKED":
        return t("errorLocked");
      case "CODE_EXPIRED":
        return t("errorExpired");
      default:
        return t("errorGeneric");
    }
  }

  async function post(url: string, body: unknown): Promise<{ ok: boolean; body: unknown }> {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return { ok: response.ok, body: await response.json().catch(() => null) };
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (!phoneReady) {
      setHint(t("hintPhone"));
      return;
    }
    if (!consent) {
      setHint(t("hintConsent"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await post("/api/proxy/farmer/otp/request", { phone: `+91${digits}`, language: locale });
      const parsed = answer.ok ? farmerOtpSentSchema.safeParse(answer.body) : null;
      if (!parsed?.success) {
        setError(explain(answer.body as Refusal | null));
        return;
      }
      setSent({ ...parsed.data, digits });
      setCode("");
      setResendAt(Date.now() + parsed.data.resendInSeconds * 1000);
      setNow(Date.now());
      setStep("code");
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!sent || code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await post("/api/farmer/otp/verify", { phone: `+91${sent.digits}`, code });
      if (!answer.ok) {
        setError(explain(answer.body as Refusal | null));
        return;
      }
      // A number Vaari already knows (an account, or a helper's booking) goes to its bookings.
      if ((answer.body as { registered?: boolean } | null)?.registered) onSignedIn(next);
      else setStep("name");
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function backToPhone() {
    setStep("phone");
    setError(null);
  }

  const errorLine = error ? (
    <p role="alert" className="mb-4 rounded-control border border-ember/40 bg-ember-soft/50 px-3 py-2 text-base text-ember-deep">
      {error}
    </p>
  ) : null;

  // The code step draws the code that was sent, or (before any) its tallest shape, invisibly.
  const shown = sent ?? CODE_SHAPE;

  return (
    <section aria-label={t("title")} className="auth-form grid min-h-[35rem] sm:min-h-[31rem] lg:min-h-[30rem]">
      <Panel step="phone" current={step}>
        <form onSubmit={sendCode} noValidate className="flex flex-1 flex-col text-base sm:text-lg">
          <label className="block">
            <span className="font-medium">{t("phoneLabel")}</span>
            <span className="mt-2 flex min-h-12 overflow-hidden rounded-control border border-line-strong bg-paper focus-within:ring-2 focus-within:ring-ink">
              <span aria-hidden className="flex items-center border-r border-line px-3 font-medium tabular text-ink-muted">
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={digits}
                onChange={(event) => {
                  setDigits(mobileDigits(event.target.value));
                  setHint(null);
                }}
                placeholder={t("phonePlaceholder")}
                aria-invalid={phoneInvalid}
                aria-describedby="farmer-phone-help"
                className="min-w-0 flex-1 bg-transparent px-3 tabular outline-none placeholder:text-ink-muted/60"
              />
            </span>
            <span id="farmer-phone-help" className={`mt-2 block text-sm sm:text-base ${phoneInvalid ? "text-ember-deep" : "text-ink-muted"}`}>
              {phoneInvalid ? t("phoneInvalid") : t("phoneHelp")}
            </span>
          </label>
          {/* Consent before any message: the whole row is the target (48px+); the native checkbox stays for keyboards and screen readers. */}
          <label className="mt-5 flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-line bg-paper p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink">
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
          <div className="mt-auto pt-5">
            {step === "phone" ? errorLine : null}
            <Button type="submit" variant="accent" aria-disabled={!phoneReady || !consent || busy} className={`min-h-12 w-full ${phoneReady && consent ? "" : "opacity-60"}`}>
              <WhatsAppGlyph className="size-5" />
              {busy && step === "phone" ? t("sending") : t("sendCode")}
            </Button>
            <p aria-live="polite" className="mt-2 min-h-6 text-center text-sm sm:text-base text-wheat-deep">
              {hint}
            </p>
          </div>
        </form>
      </Panel>

      <Panel step="code" current={step}>
        <h2 className="flex items-center gap-2 font-display text-[1.375rem] sm:text-2xl">
          <KeyRound aria-hidden className="size-6 text-wheat-deep" strokeWidth={1.75} />
          {t("codeTitle")}
        </h2>
        {/* "Change it" sits in the sentence, not on its own row, to keep this (the tallest) step short;
            its vertical padding keeps the tap target tall without moving the lines. */}
        <p className="mt-2 text-sm sm:text-base text-ink-muted">
          {t("codeSentTo", { phone: spacedMobile(shown.digits) })}{" "}
          <button type="button" onClick={backToPhone} className="inline py-2.5 font-medium text-wheat-deep underline decoration-wheat-deep/40 underline-offset-4 hover:decoration-wheat-deep">
            {t("changeNumber")}
          </button>
        </p>

        {shown.channel === "demo" && shown.demoCode ? (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-control border border-wheat-deep/30 bg-wheat-soft/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-wheat-deep">{t("demoCodeTitle")}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{t("demoCodeBody")}</p>
            </div>
            <p className="shrink-0 font-display text-3xl tabular" data-testid={sent ? "demo-code" : undefined}>
              {shown.demoCode}
            </p>
          </div>
        ) : null}

        <form onSubmit={verify} className="mt-5 flex flex-1 flex-col text-base sm:text-lg">
          <label className="block">
            <span className="font-medium">{t("codeLabel")}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={`${FIELD_INPUT} font-display text-2xl tabular tracking-[0.3em]`}
            />
          </label>
          <p className="mt-3 text-sm text-ink-muted">{t("cantGetCode")}</p>
          <div className="mt-auto pt-5">
            {step === "code" ? errorLine : null}
            <Button type="submit" variant="accent" className="min-h-12 w-full" disabled={code.length !== 6 || busy}>
              <Check aria-hidden className="size-5" strokeWidth={2} />
              {busy && step === "code" ? t("verifying") : t("verify")}
            </Button>
            <div className="mt-2 flex justify-center">
              <Button variant="quiet" className="min-h-11" disabled={resendIn > 0 || busy} onClick={() => sendCode()}>
                {resendIn > 0 ? t("resendIn", { seconds: resendIn }) : t("resend")}
              </Button>
            </div>
          </div>
        </form>
      </Panel>

      <Panel step="name" current={step}>
        <h2 className="font-display text-[1.375rem] sm:text-2xl">{t("nameTitle")}</h2>
        <p className="mb-5 mt-2 text-sm sm:text-base text-ink-muted">{t("nameBody")}</p>
        <FarmerNameForm askConsent={false} consentGiven={consent} onDone={() => onSignedIn(next)} />
      </Panel>
    </section>
  );
}
