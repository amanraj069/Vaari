/**
 * CSRF guard for our state-changing route handlers (on top of SameSite cookies): a POST must come
 * from one of our own pages. A browser always sends Origin on a cross-site POST, so a request whose
 * Origin is not ours is refused; a request with no Origin (a server, curl) is let through, as before.
 *
 * "Ours" is not request.url alone: behind Amplify (CloudFront in front of the Next server) that is
 * the server's internal address, never the public one the browser shows. So it is any of:
 * PUBLIC_BASE_URL (the configured public address), the host the browser asked for as the proxy
 * forwards it (X-Forwarded-Host, else Host), and request.url (local development).
 */
import "server-only";
import { serverConfig } from "./server-config";

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0]!.trim();
  const forwardedProto = (request.headers.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  const ours = [
    originOf(serverConfig.publicBaseUrl),
    forwardedHost ? originOf(`${forwardedProto}://${forwardedHost}`) : null,
    originOf(request.url),
  ];
  return ours.includes(origin);
}
