/**
 * Staff email sign-in, server side only. Next calls Cognito's own user API (SignUp, ConfirmSignUp,
 * ResendConfirmationCode, InitiateAuth with USER_PASSWORD_AUTH, ForgotPassword and
 * ConfirmForgotPassword) for the public app client, so
 * passwords go from the browser to Next to Cognito over HTTPS and are never stored or logged here.
 * Cognito checks the password policy, sends the email code and keeps the account; the tokens it
 * returns are the same kind as Google's (the API verifies the access token), so after sign-in the
 * person lands where a Google sign-in would: their page, or /welcome to set up.
 */
import "server-only";
import { cookies } from "next/headers";
import { meSchema } from "@/shared";
import { COOKIE, ROLE_HOME, serverConfig } from "./server-config";
import { setRoleCookie, setSession } from "./session";

/** The roles a person can pick on /signin (the farmer has their own page), by URL slug. */
export const STAFF_PICKS = { helper: "facilitator", operator: "operator", officer: "officer" } as const;
export type StaffPick = keyof typeof STAFF_PICKS;
export const isStaffPick = (value: string): value is StaffPick => value in STAFF_PICKS;

export class CognitoError extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message);
  }
}

export function cognitoRegion(): string {
  if (serverConfig.cognitoRegion) return serverConfig.cognitoRegion;
  return /\.auth\.([a-z0-9-]+)\.amazoncognito\.com/.exec(serverConfig.cognitoDomain)?.[1] ?? "";
}

export const emailSignInAvailable = () => serverConfig.authMode === "cognito" && Boolean(serverConfig.cognitoClientId) && Boolean(cognitoRegion());

/** One call to Cognito's JSON API (these actions need no AWS signature, only the client id). */
export async function cognito<Answer>(
  action: "SignUp" | "ConfirmSignUp" | "ResendConfirmationCode" | "InitiateAuth" | "ForgotPassword" | "ConfirmForgotPassword",
  body: Record<string, unknown>,
): Promise<Answer> {
  const response = await fetch(`https://cognito-idp.${cognitoRegion()}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: serverConfig.cognitoClientId, ...body }),
    cache: "no-store",
  });
  const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // "__type" is e.g. "UsernameExistsException" (sometimes prefixed with a namespace and "#").
    const type = String(answer.__type ?? "UnknownError").split("#").pop()!;
    throw new CognitoError(type, String(answer.message ?? type));
  }
  return answer as Answer;
}

/** What the web shows for a Cognito refusal. */
export function refusalCode(error: unknown): string {
  if (!(error instanceof CognitoError)) return "UNAVAILABLE";
  switch (error.type) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "WRONG_LOGIN";
    case "UserNotConfirmedException":
      return "NOT_CONFIRMED";
    case "UsernameExistsException":
      return "EMAIL_TAKEN";
    case "InvalidPasswordException":
      return "WEAK_PASSWORD";
    case "CodeMismatchException":
      return "CODE_WRONG";
    case "ExpiredCodeException":
      return "CODE_EXPIRED";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "TOO_MANY";
    case "InvalidParameterException":
      return "INVALID";
    default:
      return "UNAVAILABLE";
  }
}

/**
 * Signs in with email and password, keeps the tokens in the httpOnly session cookies, and says
 * where to go next, exactly like the Google callback: the person's page, or /welcome to set up.
 */
export async function signInWithPassword(email: string, password: string, displayName?: string): Promise<string> {
  const answer = await cognito<{ AuthenticationResult?: { AccessToken: string; RefreshToken?: string; ExpiresIn: number }; ChallengeName?: string }>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const tokens = answer.AuthenticationResult;
  // A challenge (a new password, MFA) is not something this form handles.
  if (!tokens) throw new CognitoError("ChallengeNotSupported", answer.ChallengeName ?? "challenge");
  await setSession(tokens.AccessToken, tokens.ExpiresIn, "pending", tokens.RefreshToken);
  const meResponse = await fetch(`${serverConfig.apiUrl}/me`, { headers: { authorization: `Bearer ${tokens.AccessToken}` }, cache: "no-store" }).catch(() => null);
  const me = meResponse?.ok ? meSchema.safeParse(await meResponse.json()) : null;
  if (!me?.success) throw new CognitoError("ApiUnavailable", "the API did not answer /me");
  if (me.data.needsOnboarding || !me.data.role) {
    if (displayName) (await cookies()).set(COOKIE.displayName, displayName, { httpOnly: true, secure: serverConfig.secureCookies, sameSite: "lax", path: "/", maxAge: 900 });
    return "/welcome";
  }
  await setRoleCookie(me.data.role);
  return ROLE_HOME[me.data.role] ?? "/";
}

/**
 * The user pool's password policy, as COGNITO_PASSWORD_POLICY states it (it must match the pool:
 * Cognito > User pool > Authentication methods > Password policy), e.g.
 * "min=8,lowercase,uppercase,number,symbol". Empty: no checklist is shown, and a weak password is
 * still refused by Cognito with a plain message.
 */
export type PasswordRule = { kind: "min"; length: number } | { kind: "lowercase" | "uppercase" | "number" | "symbol" };

export function passwordPolicy(): PasswordRule[] {
  const rules: PasswordRule[] = [];
  for (const part of serverConfig.cognitoPasswordPolicy.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)) {
    const min = /^min=(\d{1,2})$/.exec(part);
    if (min) rules.push({ kind: "min", length: Number(min[1]) });
    else if (part === "lowercase" || part === "uppercase" || part === "number" || part === "symbol") rules.push({ kind: part });
  }
  return rules;
}

/** Remembers which role the person picked, for /welcome (15 minutes). */
export async function rememberRolePick(pick: StaffPick) {
  (await cookies()).set(COOKIE.rolePick, pick, { httpOnly: true, secure: serverConfig.secureCookies, sameSite: "lax", path: "/", maxAge: 900 });
}
