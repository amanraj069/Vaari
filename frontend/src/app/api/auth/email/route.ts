/**
 * POST /api/auth/email: staff email sign-in, one route with four steps (lib/cognito.ts):
 *   signIn   email + password -> session cookies -> { next } (their page, or /welcome)
 *   signUp   name + email + password -> Cognito emails a 6-digit code -> { confirm: true }
 *   confirm  email + code + password -> account confirmed, then signed in -> { next }
 *   resend   email -> a new code
 *   forgot   email -> Cognito emails a reset code (the same answer whether or not the email has
 *            an account, so the page never says who is registered)
 *   reset    email + code + new password -> the password is changed; the person signs in again
 * Refusals come back as a code the form turns into words (WRONG_LOGIN, EMAIL_TAKEN, ...). Only our
 * own pages may call it (Origin check), and it is off unless AUTH_MODE=cognito.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { cognito, emailSignInAvailable, isStaffPick, refusalCode, rememberRolePick, signInWithPassword } from "@/lib/cognito";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(256);
const pick = z.string().refine(isStaffPick).optional();
const stepSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("signIn"), email, password, pick }),
  z.object({ step: z.literal("signUp"), name: z.string().trim().min(1).max(80), email, password, pick }),
  z.object({ step: z.literal("confirm"), email, code: z.string().regex(/^\d{6}$/), password, name: z.string().trim().max(80).optional(), pick }),
  z.object({ step: z.literal("resend"), email }),
  z.object({ step: z.literal("forgot"), email }),
  z.object({ step: z.literal("reset"), email, code: z.string().regex(/^\d{6}$/), password }),
]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!emailSignInAvailable()) return NextResponse.json({ error: "OFF" }, { status: 404 });
  const parsed = stepSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const input = parsed.data;
  try {
    if ("pick" in input && input.pick && isStaffPick(input.pick)) await rememberRolePick(input.pick);
    switch (input.step) {
      case "signIn":
        return NextResponse.json({ next: await signInWithPassword(input.email, input.password) });
      case "signUp":
        await cognito("SignUp", {
          Username: input.email,
          Password: input.password,
          UserAttributes: [
            { Name: "email", Value: input.email },
            { Name: "name", Value: input.name },
          ],
        });
        return NextResponse.json({ confirm: true });
      case "confirm":
        await cognito("ConfirmSignUp", { Username: input.email, ConfirmationCode: input.code });
        return NextResponse.json({ next: await signInWithPassword(input.email, input.password, input.name) });
      case "resend":
        await cognito("ResendConfirmationCode", { Username: input.email });
        return NextResponse.json({ resent: true });
      case "forgot":
        try {
          await cognito("ForgotPassword", { Username: input.email });
        } catch (error) {
          // An unknown email answers exactly like a known one.
          if (refusalCode(error) !== "WRONG_LOGIN") throw error;
        }
        return NextResponse.json({ sent: true });
      case "reset":
        await cognito("ConfirmForgotPassword", { Username: input.email, ConfirmationCode: input.code, Password: input.password });
        return NextResponse.json({ reset: true });
    }
  } catch (error) {
    const code = refusalCode(error);
    const status = code === "UNAVAILABLE" ? 502 : code === "TOO_MANY" ? 429 : code === "EMAIL_TAKEN" ? 409 : code === "WRONG_LOGIN" ? 401 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
