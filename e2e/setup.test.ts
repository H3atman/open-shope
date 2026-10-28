import { expect, test } from "bun:test";
import { BASE_URL, cookieFrom, getSession, newCredentials, postJson } from "./client";

// Reads the shop's setup state through the Worker.
async function needsSetup(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/setup`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { needsSetup: boolean };
  return body.needsSetup;
}

const fresh = await needsSetup();
const valid = newCredentials("E2E Owner");
const badInputs = [
  { label: "bad email", body: { ...valid, email: "not-an-email" } },
  { label: "short password", body: { ...valid, password: "short" } },
  { label: "missing name", body: { email: valid.email, password: valid.password } },
];

// Sends unreadable JSON to exercise parsing after the setup claim.
function postUnreadableJson(): Promise<Response> {
  return fetch(`${BASE_URL}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(BASE_URL).origin },
    body: "{",
  });
}

test.skipIf(!fresh)("fresh shop: invalid inputs return JSON 4xx and release the claim", async () => {
  for (const { label, body } of badInputs) {
    const res = await postJson("/api/setup", body);
    console.log(`Setup ${label}: ${res.status}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.json()).toHaveProperty("error", expect.any(String));
    expect(await needsSetup()).toBe(true);
  }
  const unreadable = await postUnreadableJson();
  expect(unreadable.status).toBe(400);
  expect(await unreadable.json()).toHaveProperty("error", expect.any(String));
  expect(await needsSetup()).toBe(true);
});

test.skipIf(!fresh)("fresh shop: an existing customer email returns JSON 4xx and releases the claim", async () => {
  const customer = newCredentials("E2E Customer");
  const signup = await postJson("/api/auth/sign-up/email", customer);
  expect(signup.status).toBe(200);
  expect((await getSession(cookieFrom(signup)))?.user.role).toBe("customer");
  const res = await postJson("/api/setup", customer);
  console.log(`Setup duplicate email: ${res.status}`);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(await res.json()).toHaveProperty("error", expect.any(String));
  expect(await needsSetup()).toBe(true);
});

test.skipIf(!fresh)("fresh shop: concurrent setup creates exactly one owner, then returns 409", async () => {
  const owners = Array.from({ length: 5 }, () => newCredentials("E2E Owner"));
  const responses = await Promise.all(owners.map((owner) => postJson("/api/setup", owner)));
  const statuses = responses.map((res) => res.status);
  expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  expect(statuses.filter((status) => status === 409)).toHaveLength(4);
  const winner = statuses.indexOf(201);
  const session = await getSession(cookieFrom(responses[winner]!));
  expect(session?.user.email).toBe(owners[winner]!.email);
  expect(session?.user.role).toBe("owner");
  expect(await needsSetup()).toBe(false);
  expect((await postJson("/api/setup", valid)).status).toBe(409);
  expect((await postUnreadableJson()).status).toBe(409);
  for (const { body } of badInputs) expect((await postJson("/api/setup", body)).status).toBe(409);
});

test.skipIf(fresh)("already set up: valid and malformed requests all return 409", async () => {
  for (const body of [valid, ...badInputs.map((input) => input.body)]) {
    const res = await postJson("/api/setup", body);
    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty("error", expect.any(String));
  }
  const unreadable = await postUnreadableJson();
  expect(unreadable.status).toBe(409);
  expect(await unreadable.json()).toHaveProperty("error", expect.any(String));
  expect(await needsSetup()).toBe(false);
});
