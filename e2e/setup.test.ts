import { expect, test } from "bun:test";
import { BASE_URL, cookieFrom, getSession, newCredentials, postJson } from "./client";

async function needsSetup(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/setup`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { needsSetup: boolean };
  return body.needsSetup;
}

// Runs before the setup race below: a leaked claim here would leave that race without a 201.
test("setup rejects a bad email, a short password or a missing name with 400", async () => {
  const before = await needsSetup();
  const valid = newCredentials("E2E Owner");

  for (const body of [
    { ...valid, email: "not-an-email" },
    { ...valid, password: "short" },
    { email: valid.email, password: valid.password },
  ]) {
    expect((await postJson("/api/setup", body)).status).toBe(400);
  }
  expect(await needsSetup()).toBe(before);
});

test("setup creates exactly one owner once, then returns 409", async () => {
  const fresh = await needsSetup();
  const owners = Array.from({ length: 5 }, () => newCredentials("E2E Owner"));

  const responses = await Promise.all(owners.map((owner) => postJson("/api/setup", owner)));
  const statuses = responses.map((res) => res.status);

  if (fresh) {
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
    const winner = statuses.indexOf(201);
    const session = await getSession(cookieFrom(responses[winner]!));
    expect(session?.user.email).toBe(owners[winner]!.email);
    expect(session?.user.role).toBe("owner");
  } else {
    expect(statuses).toEqual([409, 409, 409, 409, 409]);
  }

  expect(await needsSetup()).toBe(false);
  expect((await postJson("/api/setup", newCredentials("E2E Owner"))).status).toBe(409);
});
