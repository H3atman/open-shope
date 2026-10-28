import { expect, test } from "bun:test";
import { BASE_URL } from "./client";

test("health reports D1 and R2 as ok", async () => {
  const res = await fetch(`${BASE_URL}/api/health`);

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ db: "ok", media: "ok" });
});
