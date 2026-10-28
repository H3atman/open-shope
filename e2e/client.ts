// Shared helpers for E2E tests. Tests talk to the shop only over HTTP.

const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error("BASE_URL is not set; run the suite with `bun run test:e2e`");

export const BASE_URL = baseUrl.replace(/\/+$/, "");
const ORIGIN = new URL(BASE_URL).origin;

export type Credentials = { name: string; email: string; password: string };
export type Session = { user: { email: string; role: string } } | null;

// Fresh random credentials, so every run creates new accounts.
export function newCredentials(name = "E2E User"): Credentials {
  return {
    name,
    email: `e2e-${crypto.randomUUID()}@example.com`,
    password: crypto.randomUUID(),
  };
}

// POSTs JSON with an Origin header, as a browser on the shop's own page would.
export function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

// Turns a response's Set-Cookie headers into a Cookie request header.
export function cookieFrom(res: Response): string {
  return res.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

// Reads the Better Auth session for a Cookie header; null when signed out.
export async function getSession(cookie: string): Promise<Session> {
  const res = await fetch(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } });
  if (!res.ok) throw new Error(`get-session returned ${res.status}`);
  return (await res.json()) as Session;
}
