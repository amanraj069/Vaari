/**
 * Who is calling. Every request carries a bearer access token that the Next backend-for-frontend
 * attached from an httpOnly cookie (the browser never sees it).
 * - Cognito access tokens (AUTH_MODE=cognito), verified with aws-jwt-verify (signature, issuer,
 *   client id, expiry, token use). The role is the user's Cognito group.
 * - Demo sessions, short-lived and signed here, so anyone can try a demo account in one click
 *   and the product runs with no AWS account. Both can be on at the same time.
 * Farmers are not principals here: they have no account and use a phone session
 * (auth/farmer-session.ts), which only the /farmer routes accept.
 */
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { roleSchema, type Role } from "../shared";
import type { Config } from "../config";
import type { VaariStore } from "../store/types";

export type Principal = {
  userId: string;
  name: string;
  // null: signed in with Google but not onboarded yet (no Cognito group and no stored profile).
  role: Role | null;
  chcId: string | null;
  demo: boolean;
};

/** A stored role that is no longer a role (e.g. "farmer", from when farmers had accounts) counts as none. */
const knownRole = (role: unknown): Role | null => roleSchema.safeParse(role).data ?? null;

const DEMO_ISSUER = "vaari-demo";
const DEMO_AUDIENCE = "vaari-api";
const DEMO_SESSION_SECONDS = 4 * 60 * 60;

export class AuthError extends Error {}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export async function mintDemoToken(config: Config, user: { userId: string }): Promise<{ token: string; expiresIn: number }> {
  const secret = new TextEncoder().encode(config.DEMO_SESSION_SECRET);
  const token = await new SignJWT({ demo: true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuer(DEMO_ISSUER)
    .setAudience(DEMO_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${DEMO_SESSION_SECONDS}s`)
    .sign(secret);
  return { token, expiresIn: DEMO_SESSION_SECONDS };
}

export function createTokenVerifier(config: Config, store: VaariStore): TokenVerifier {
  // Demo sessions and Cognito tokens are accepted side by side: judges use one-click demo
  // accounts while real users sign in with Google through Cognito.
  const demoSecret = new TextEncoder().encode(config.DEMO_SESSION_SECRET);
  const cognitoVerifier =
    config.AUTH_MODE === "cognito" && config.COGNITO_USER_POOL_ID && config.COGNITO_CLIENT_ID
      ? CognitoJwtVerifier.create({ userPoolId: config.COGNITO_USER_POOL_ID, clientId: config.COGNITO_CLIENT_ID, tokenUse: "access" })
      : null;

  async function verifyDemo(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, demoSecret, { issuer: DEMO_ISSUER, audience: DEMO_AUDIENCE });
      // Role and CHC come from the stored user record, never from client-supplied claims.
      const user = payload.sub ? await store.getUser(payload.sub) : null;
      if (!user) throw new AuthError("unknown user");
      return { userId: user.userId, name: user.name, role: knownRole(user.role), chcId: user.chcId, demo: true };
    } catch (error) {
      throw new AuthError(error instanceof Error ? error.message : "invalid token");
    }
  }

  async function verifyCognito(verifier: NonNullable<typeof cognitoVerifier>, token: string): Promise<Principal> {
    let payload;
    try {
      payload = await verifier.verify(token);
    } catch (error) {
      throw new AuthError(error instanceof Error ? error.message : "invalid token");
    }
    // A Cognito group is authoritative; otherwise the role the user picked on /welcome.
    const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
    const groupRole = groups.map((group) => roleSchema.safeParse(group)).find((result) => result.success)?.data;
    const user = await store.getUser(payload.sub);
    return {
      userId: payload.sub,
      name: user?.name ?? payload.username?.toString() ?? "",
      role: groupRole ?? knownRole(user?.role),
      chcId: user?.chcId ?? null,
      demo: false,
    };
  }

  return {
    async verify(token) {
      // The issuer is read unverified only to pick the verifier; each verifier checks the signature.
      let issuer: string | undefined;
      try {
        issuer = decodeJwt(token).iss;
      } catch {
        throw new AuthError("malformed token");
      }
      if (issuer === DEMO_ISSUER) {
        return verifyDemo(token);
      }
      if (!cognitoVerifier) throw new AuthError("Cognito sign-in is not configured");
      return verifyCognito(cognitoVerifier, token);
    },
  };
}
