/**
 * Who is calling. Every request carries a bearer access token that the Next backend-for-frontend
 * attached from an httpOnly cookie (the browser never sees it).
 * - AUTH_MODE=cognito: Cognito access tokens, verified with aws-jwt-verify (signature, issuer,
 *   client id, expiry, token use). The role is the user's Cognito group.
 * - AUTH_MODE=demo: short-lived demo sessions signed here, so the product runs with no AWS account.
 */
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SignJWT, jwtVerify } from "jose";
import { roleSchema, type Role } from "../shared";
import type { Config } from "../config";
import type { VaariStore } from "../store/types";

export type Principal = {
  userId: string;
  name: string;
  role: Role;
  chcId: string | null;
  farmerId: string | null;
  demo: boolean;
};

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
  if (config.AUTH_MODE === "demo") {
    const secret = new TextEncoder().encode(config.DEMO_SESSION_SECRET);
    return {
      async verify(token) {
        try {
          const { payload } = await jwtVerify(token, secret, { issuer: DEMO_ISSUER, audience: DEMO_AUDIENCE });
          // Role and CHC come from the stored user record, never from client-supplied claims.
          const user = payload.sub ? await store.getUser(payload.sub) : null;
          if (!user) throw new AuthError("unknown user");
          return { ...user, demo: true };
        } catch (error) {
          throw new AuthError(error instanceof Error ? error.message : "invalid token");
        }
      },
    };
  }

  const cognitoVerifier = CognitoJwtVerifier.create({
    userPoolId: config.COGNITO_USER_POOL_ID,
    clientId: config.COGNITO_CLIENT_ID,
    tokenUse: "access",
  });
  return {
    async verify(token) {
      let payload;
      try {
        payload = await cognitoVerifier.verify(token);
      } catch (error) {
        throw new AuthError(error instanceof Error ? error.message : "invalid token");
      }
      const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
      const role = groups.map((group) => roleSchema.safeParse(group)).find((result) => result.success)?.data;
      if (!role) throw new AuthError("user has no Vaari role group");
      const user = await store.getUser(payload.sub);
      return {
        userId: payload.sub,
        name: user?.name ?? payload.username?.toString() ?? "",
        role,
        chcId: user?.chcId ?? null,
        farmerId: user?.farmerId ?? null,
        demo: false,
      };
    },
  };
}
