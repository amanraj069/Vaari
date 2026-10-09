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
  // Shared with the API: proves the client address we forward is ours (rate limits per farmer).
  proxySharedSecret: process.env.PROXY_SHARED_SECRET ?? "",
  // The WhatsApp Business number farmers message "my fields" (digits with country code). Empty: no button.
  whatsappBusinessNumber: (process.env.WHATSAPP_BUSINESS_NUMBER ?? "").replace(/\D/g, ""),
  // Where people write to us, and ask for their data to be deleted (/privacy#deletion, the footer).
  contactEmail: process.env.CONTACT_EMAIL?.trim() || "amanraj3567@gmail.com",
};

export const COOKIE = {
  accessToken: "vaari_at",
  refreshToken: "vaari_rt",
  // A farmer's phone session (no account): read-only access to the fields booked with one phone.
  farmerSession: "vaari_farmer",
  // Role is only a routing hint for middleware; the API verifies the token on every call.
  role: "vaari_role",
  oauthState: "vaari_oauth",
  // Name from Google's ID token, only to pre-fill the /welcome form.
  displayName: "vaari_name",
  locale: "NEXT_LOCALE",
} as const;

export const ROLE_HOME: Record<string, string> = {
  facilitator: "/book",
  operator: "/operator",
  officer: "/proof",
};
