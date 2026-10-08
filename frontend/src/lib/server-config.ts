/**
 * Server-only settings for the backend-for-frontend. The browser never sees these, and never
 * holds an access token: Next keeps tokens in httpOnly cookies and calls the API on its behalf.
 */
import "server-only";

export const serverConfig = {
  apiUrl: process.env.API_URL ?? "http://localhost:4000",
  authMode: (process.env.AUTH_MODE ?? "demo") as "demo" | "cognito",
  demoMode: (process.env.DEMO_MODE ?? "true") === "true",
  cognitoDomain: process.env.COGNITO_DOMAIN ?? "",
  cognitoClientId: process.env.COGNITO_CLIENT_ID ?? "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  secureCookies: (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://"),
};

export const COOKIE = {
  accessToken: "vaari_at",
  refreshToken: "vaari_rt",
  // Role is only a routing hint for middleware; the API verifies the token on every call.
  role: "vaari_role",
  oauthState: "vaari_oauth",
  locale: "NEXT_LOCALE",
} as const;

export const ROLE_HOME: Record<string, string> = {
  farmer: "/farmer",
  facilitator: "/farmer",
  operator: "/operator",
  officer: "/proof",
};
