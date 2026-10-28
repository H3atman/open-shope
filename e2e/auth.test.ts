import { expect, test } from "bun:test";
import { BASE_URL, cookieFrom, getSession, newCredentials, postJson } from "./client";

// Better Auth 1.7.14's default /sign-in* limit: 3 requests per 10 s per IP, and every allowed
// request restarts the window. It is off unless NODE_ENV=production; pacing keeps us under it anyway.
const SIGN_IN_LIMIT = { max: 3, windowMs: 10_000 };

test("a customer who signs up with role 'owner' is still a customer", async () => {
  const customer = newCredentials("E2E Customer");

  const res = await postJson("/api/auth/sign-up/email", { ...customer, role: "owner" });

  expect(res.status).toBe(200);
  const session = await getSession(cookieFrom(res));
  expect(session?.user.email).toBe(customer.email);
  expect(session?.user.role).toBe("customer");
});

test("sign-in with the right password returns a session; a wrong one returns 401", async () => {
  const customer = newCredentials("E2E Customer");
  expect((await postJson("/api/auth/sign-up/email", customer)).status).toBe(200);

  const right = await postJson("/api/auth/sign-in/email", { email: customer.email, password: customer.password });
  expect(right.status).toBe(200);
  expect((await getSession(cookieFrom(right)))?.user.email).toBe(customer.email);

  const wrong = await postJson("/api/auth/sign-in/email", { email: customer.email, password: `${customer.password}x` });
  expect(wrong.status).toBe(401);
  expect(cookieFrom(wrong)).toBe("");
});

// On a deployed shop, a CPU-limit failure shows up as a 503 "Error 1102" page.
test("20 sign-ins in a row all succeed, none hitting the CPU limit", async () => {
  const customer = newCredentials("E2E Customer");
  expect((await postJson("/api/auth/sign-up/email", customer)).status).toBe(200);

  const attempts: { attempt: number; status: number; ms: number; error?: string }[] = [];
  for (let attempt = 1; attempt <= 20; attempt++) {
    // Bursts of `max`, each after a full quiet window, so the limiter would always reset.
    if ((attempt - 1) % SIGN_IN_LIMIT.max === 0) await Bun.sleep(SIGN_IN_LIMIT.windowMs + 500);
    const started = performance.now();
    const res = await postJson("/api/auth/sign-in/email", { email: customer.email, password: customer.password });
    const ms = Math.round(performance.now() - started);
    const body = await res.text();
    const error = res.status === 200 ? undefined : /\b1102\b/.test(body) ? "1102 exceeded CPU" : body.slice(0, 200);
    attempts.push({ attempt, status: res.status, ms, error });
  }

  const prefix = process.env.E2E_ARTIFACT_PREFIX;
  if (prefix) await Bun.write(`${prefix}.sign-ins.json`, JSON.stringify({ target: BASE_URL, attempts }, null, 2));
  expect(attempts.map((a) => a.status)).toEqual(Array.from({ length: 20 }, () => 200));
}, 120_000);
