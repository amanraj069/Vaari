/**
 * Never log tokens. Slot links and farmer login links carry their token in the URL path, so every
 * logged URL passes through here first: the token segment becomes "[redacted]" and the rest (the
 * route, the query) stays readable for debugging. Meta's webhook verification sends our verify
 * token in the query (hub.verify_token): its value is cut too.
 */
const TOKEN_IN_PATH = /(\/(?:slot|farmer\/login)\/)[^/?#]+/g;
const TOKEN_IN_QUERY = /([?&]hub\.verify_token=)[^&#]*/g;

export function redactUrl(url: string): string {
  return url.replace(TOKEN_IN_PATH, "$1[redacted]").replace(TOKEN_IN_QUERY, "$1[redacted]");
}

/** pino-http request serializer: method and a redacted URL, nothing else (no headers, no body). */
export function requestSerializer(request: { method: string; url: string }): { method: string; url: string } {
  return { method: request.method, url: redactUrl(request.url) };
}
