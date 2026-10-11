"use client";

/**
 * The form half of /signin/<role> for village helpers, operators and officers. Top to bottom:
 * back and a title that follows the role and the step; the role (the same Helper / Operator /
 * Officer picker, preset from the address and switching in place); Continue with Google; "or use email"; email and password with
 * "Forgot password?"; the submit button; "New here? Create an account" (or back to sign in); and,
 * quieter, the farmer's way in. Create account, its emailed code, and the password reset are steps
 * of the same card, swapped in place. Our route handler (/api/auth/email) talks to Cognito; the card
 * never sees a token. Errors are one announced line above the button and never say whether an email
 * is registered for a wrong sign-in. The role is remembered in this browser for next time.
 */
import { Check, Circle, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BackButton } from "./back-button";
import { GoogleSignIn, OrDivider } from "./google-sign-in";
import { StaffRoleToggle, type StaffRole } from "./staff-signin-panel";
import { Button } from "./ui";
import { WhatsAppGlyph } from "./whatsapp-start";

export type PasswordRule = { kind: "min"; length: number } | { kind: "lowercase" | "uppercase" | "number" | "symbol" };
type Mode = "signIn" | "create" | "confirm" | "forgot" | "reset";
type Answer = { next?: string; confirm?: boolean; resent?: boolean; sent?: boolean; reset?: boolean; error?: string } | null;

export const ROLE_STORAGE_KEY = "vaari:staff-role";
const RESEND_SECONDS = 30;
const EASE = [0.22, 1, 0.36, 1] as const;
const INPUT =
  "min-h-12 w-full rounded-control border border-line-strong bg-paper px-3 text-base outline-none transition-colors focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/20 disabled:opacity-60 aria-[invalid=true]:border-ember-deep";
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const openPage = (path: string) => window.location.assign(path);

export function ruleMet(rule: PasswordRule, password: string): boolean {
  switch (rule.kind) {
    case "min":
      return password.length >= rule.length;
    case "lowercase":
      return /[a-z]/.test(password);
    case "uppercase":
      return /[A-Z]/.test(password);
    case "number":
      return /\d/.test(password);
    case "symbol":
      return /[^A-Za-z0-9\s]/.test(password);
  }
}

function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-ember-deep">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, describedBy, disabled }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string; describedBy?: string; disabled: boolean }) {
  const t = useTranslations("signin");
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));
  return (
    <>
      <span className="flex min-h-12 overflow-hidden rounded-control border border-line-strong bg-paper focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/20">
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          enterKeyHint="go"
          maxLength={256}
          disabled={disabled}
          aria-describedby={[describedBy, capsLock ? `${id}-caps` : null].filter(Boolean).join(" ") || undefined}
          className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          aria-label={shown ? t("passwordHide") : t("passwordShow")}
          aria-pressed={shown}
          aria-controls={id}
          disabled={disabled}
          className="grid w-12 shrink-0 place-items-center text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"
        >
          {shown ? <EyeOff aria-hidden className="size-5" strokeWidth={1.75} /> : <Eye aria-hidden className="size-5" strokeWidth={1.75} />}
        </button>
      </span>
      {capsLock ? (
        <p id={`${id}-caps`} role="status" className="mt-1.5 text-sm text-wheat-deep">
          {t("capsLock")}
        </p>
      ) : null}
    </>
  );
}

function PasswordChecklist({ rules, password, id }: { rules: PasswordRule[]; password: string; id: string }) {
  const t = useTranslations("signin");
  return (
    <ul id={id} className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
      {rules.map((rule) => {
        const met = ruleMet(rule, password);
        const label = rule.kind === "min" ? t("ruleMin", { count: rule.length }) : t(`rule_${rule.kind}`);
        return (
          <li key={rule.kind} className={`flex items-center gap-1.5 transition-colors duration-200 ${met ? "text-field" : "text-ink-muted"}`}>
            {met ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.25} /> : <Circle aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />}
            {label}
            <span className="sr-only">{met ? t("ruleDone") : t("ruleNotYet")}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function StaffAuthCard({
  initialRole,
  googleOn,
  emailOn,
  passwordRules,
  onSignedIn = openPage,
}: {
  initialRole: StaffRole;
  googleOn: boolean;
  emailOn: boolean;
  passwordRules: PasswordRule[];
  onSignedIn?: (path: string) => void;
}) {
  const t = useTranslations("signin");
  const ids = useId();
  const [role, setRole] = useState<StaffRole>(initialRole);
  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  // Remember the role in this browser (the next visit to /signin starts from it).
  useEffect(() => {
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    } catch {}
  }, [role]);

  // A one-second clock only while a resend countdown runs.
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  function chooseRole(next: StaffRole) {
    setRole(next);
    // Same page, new address: a refresh, a shared link or "back" opens this role.
    window.history.replaceState(null, "", `/signin/${next}`);
  }

  function go(next: Mode, message: string | null = null) {
    setMode(next);
    setError(null);
    setNotice(message);
    setEmailError(null);
    if (next === "signIn" || next === "create") setCode("");
  }

  function startCountdown() {
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
    setNow(Date.now());
  }

  function explain(code: string | undefined): string {
    switch (code) {
      case "WRONG_LOGIN":
        return t("errorWrongLogin");
      case "EMAIL_TAKEN":
        return t("errorEmailTaken");
      case "WEAK_PASSWORD":
        return t("errorWeakPassword");
      case "CODE_WRONG":
        return t("errorCodeWrong");
      case "CODE_EXPIRED":
        return t("errorCodeExpired");
      case "TOO_MANY":
        return t("errorTooMany");
      case "INVALID":
        return t("errorInvalid");
      default:
        return t("errorUnavailable");
    }
  }

  async function call(body: Record<string, unknown>): Promise<Answer> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return (await response.json().catch(() => null)) as Answer;
    } catch {
      return { error: "UNAVAILABLE" };
    } finally {
      setBusy(false);
    }
  }

  function emailOk(): boolean {
    if (looksLikeEmail(email)) return true;
    setEmailError(t("errorEmailFormat"));
    return false;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setNotice(null);
    if (mode === "signIn") {
      if (!emailOk() || !password) return;
      const answer = await call({ step: "signIn", email, password, pick: role });
      if (answer?.next) return onSignedIn(answer.next);
      if (answer?.error === "NOT_CONFIRMED") {
        await call({ step: "resend", email });
        startCountdown();
        return go("confirm", t("notConfirmed"));
      }
      return setError(explain(answer?.error));
    }
    if (mode === "create") {
      if (!name.trim()) return setError(t("errorName"));
      if (!emailOk()) return;
      if (!passwordRules.every((rule) => ruleMet(rule, password)) || !password) return setError(t("errorRulesNotMet"));
      const answer = await call({ step: "signUp", name: name.trim(), email, password, pick: role });
      if (answer?.confirm) {
        startCountdown();
        return go("confirm");
      }
      return setError(explain(answer?.error));
    }
    if (mode === "confirm") {
      if (code.length !== 6) return;
      const answer = await call({ step: "confirm", email, code, password, name: name.trim() || undefined, pick: role });
      if (answer?.next) return onSignedIn(answer.next);
      return setError(explain(answer?.error));
    }
    if (mode === "forgot") {
      if (!emailOk()) return;
      const answer = await call({ step: "forgot", email });
      if (answer?.sent) {
        startCountdown();
        setPassword("");
        return go("reset", t("resetSent", { email: email.trim() }));
      }
      return setError(explain(answer?.error));
    }
    if (mode === "reset") {
      if (code.length !== 6) return;
      if (!passwordRules.every((rule) => ruleMet(rule, password)) || !password) return setError(t("errorRulesNotMet"));
      const answer = await call({ step: "reset", email, code, password });
      if (answer?.reset) {
        setPassword("");
        return go("signIn", t("resetDone"));
      }
      return setError(explain(answer?.error));
    }
  }

  async function resend() {
    if (busy || resendIn > 0) return;
    const answer = await call(mode === "confirm" ? { step: "resend", email } : { step: "forgot", email });
    if (answer?.resent || answer?.sent) {
      startCountdown();
      setNotice(t("codeResent"));
    } else setError(explain(answer?.error));
  }

  const title = mode === "signIn" ? t("roleTitle", { role }) : mode === "create" ? t("createTitle", { role }) : mode === "confirm" ? t("confirmTitle") : t("resetTitle");
  const choosing = mode === "signIn" || mode === "create";
  const emailField = (
    <Field id={`${ids}-email`} label={t("emailLabel")} error={emailError}>
      <input
        id={`${ids}-email`}
        type="email"
        inputMode="email"
        autoComplete="email"
        enterKeyHint="next"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setEmailError(null);
        }}
        onBlur={() => {
          if (email.trim() && !looksLikeEmail(email)) setEmailError(t("errorEmailFormat"));
        }}
        aria-invalid={emailError ? true : undefined}
        aria-describedby={emailError ? `${ids}-email-error` : undefined}
        maxLength={254}
        disabled={busy}
        className={INPUT}
      />
    </Field>
  );
  const codeField = (
    <Field id={`${ids}-code`} label={t("codeLabel")}>
      <input
        id={`${ids}-code`}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        enterKeyHint="go"
        maxLength={6}
        disabled={busy}
        className={`${INPUT} font-display text-2xl tabular tracking-[0.3em]`}
      />
    </Field>
  );
  const newPasswordField = (
    <Field id={`${ids}-password`} label={mode === "reset" ? t("newPasswordLabel") : t("passwordLabel")} hint={passwordRules.length ? <PasswordChecklist rules={passwordRules} password={password} id={`${ids}-rules`} /> : undefined}>
      <PasswordInput id={`${ids}-password`} value={password} onChange={setPassword} autoComplete="new-password" describedBy={passwordRules.length ? `${ids}-password-hint` : undefined} disabled={busy} />
    </Field>
  );
  const submitLabel = { signIn: t("modeSignIn"), create: t("modeCreate"), confirm: t("confirm"), forgot: t("sendResetCode"), reset: t("setNewPassword") }[mode];
  const resendButton = (
    <button type="button" onClick={resend} disabled={busy || resendIn > 0} className="min-h-11 text-sm font-medium text-wheat-deep hover:underline disabled:text-ink-muted disabled:no-underline">
      {resendIn > 0 ? t("resendIn", { seconds: resendIn }) : t("resendCode")}
    </button>
  );

  return (
    <div className="auth-form mx-auto w-full max-w-md">
      <div className="flex items-center gap-1">
        <BackButton fallback={`/signin?pick=${role}`} />
        <h1 className="min-w-0 font-display text-[1.625rem] leading-tight tracking-tight sm:text-3xl">{title}</h1>
      </div>

      {choosing ? (
        <div className="mt-4">
          {/* The same role picker as /signin, preset from the address; it switches in place. */}
          <p id={`${ids}-role-label`} className="sr-only">
            {t("eyebrowStaff")}
          </p>
          <StaffRoleToggle value={role} onChange={chooseRole} labelledBy={`${ids}-role-label`} />
          <div className="mt-5">
            <GoogleSignIn href={`/api/auth/login?pick=${role}`} on={googleOn} />
          </div>
          <OrDivider label={t("orUseEmail")} />
        </div>
      ) : null}

      {!emailOn ? (
        <p className="mt-2 text-sm text-ink-muted">{t("emailOff")}</p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.form
            key={mode}
            onSubmit={submit}
            noValidate
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: EASE }}
            className={choosing ? "" : "mt-6"}
          >
            {mode === "confirm" ? (
              <p className="mb-4 flex gap-2 text-sm text-ink-muted sm:text-base">
                <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-wheat-deep" strokeWidth={1.75} />
                {t("confirmBody", { email: email.trim() })}
              </p>
            ) : mode === "forgot" ? (
              <p className="mb-4 text-sm text-ink-muted sm:text-base">{t("forgotBody")}</p>
            ) : null}
            {notice ? (
              <p role="status" className="mb-4 rounded-control border border-field/30 bg-field-soft/60 px-3 py-2 text-sm text-ink">
                {notice}
              </p>
            ) : null}

            <div className="space-y-4">
              {mode === "create" ? (
                <Field id={`${ids}-name`} label={t("nameLabel")}>
                  <input id={`${ids}-name`} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" enterKeyHint="next" maxLength={80} disabled={busy} className={INPUT} />
                </Field>
              ) : null}
              {mode === "signIn" || mode === "create" || mode === "forgot" ? emailField : null}
              {mode === "signIn" ? (
                <div>
                  <Field id={`${ids}-password`} label={t("passwordLabel")}>
                    <PasswordInput id={`${ids}-password`} value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
                  </Field>
                  <div className="mt-1 flex justify-end">
                    <button type="button" onClick={() => go("forgot")} className="min-h-11 text-sm font-medium text-wheat-deep hover:underline">
                      {t("forgotLink")}
                    </button>
                  </div>
                </div>
              ) : null}
              {mode === "create" ? newPasswordField : null}
              {mode === "confirm" || mode === "reset" ? codeField : null}
              {mode === "reset" ? newPasswordField : null}
            </div>

            <div aria-live="assertive" className="mt-4">
              {error ? (
                <p role="alert" className="rounded-control border border-ember/40 bg-ember-soft/50 px-3 py-2 text-sm text-ember-deep">
                  {error}
                </p>
              ) : null}
            </div>

            <Button type="submit" variant="accent" aria-disabled={busy} disabled={busy || ((mode === "confirm" || mode === "reset") && code.length !== 6)} className="mt-4 min-h-12 w-full text-base">
              {busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
              {busy ? t("working") : submitLabel}
            </Button>

            {mode === "confirm" || mode === "reset" ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => go(mode === "confirm" ? "create" : "forgot")} className="min-h-11 text-sm font-medium text-ink-muted hover:text-ink">
                  {t("wrongEmailBack")}
                </button>
                {resendButton}
              </div>
            ) : mode === "forgot" ? (
              <div className="mt-3">
                <button type="button" onClick={() => go("signIn")} className="min-h-11 text-sm font-medium text-ink-muted hover:text-ink">
                  {t("backToSignIn")}
                </button>
              </div>
            ) : (
              <p className="mt-5 text-center text-sm text-ink-muted">
                {mode === "signIn" ? t("newHere") : t("haveAccount")}{" "}
                <button type="button" onClick={() => go(mode === "signIn" ? "create" : "signIn")} className="min-h-11 font-medium text-wheat-deep hover:underline">
                  {mode === "signIn" ? t("createAccountLink") : t("signInLink")}
                </button>
              </p>
            )}
          </motion.form>
        </AnimatePresence>
      )}

      <p className="mt-5 border-t border-line pt-3 text-center text-sm text-ink-muted">
        <Link href="/farmer/signin" className="inline-flex min-h-11 items-center gap-2 hover:text-ink">
          <WhatsAppGlyph className="size-4 text-field" />
          {t("farmerWhatsApp")}
        </Link>
      </p>
    </div>
  );
}
