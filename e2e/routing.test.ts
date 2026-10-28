import { expect, test } from "bun:test";
import { BASE_URL } from "./client";

test("/ and an unknown deep link both serve index.html", async () => {
  const home = await fetch(`${BASE_URL}/`);
  const deepLink = await fetch(`${BASE_URL}/p/does-not-exist`);

  expect(home.status).toBe(200);
  expect(home.headers.get("content-type")).toStartWith("text/html");
  const html = await home.text();
  expect(html).toContain("<!doctype html>");
  expect(deepLink.status).toBe(200);
  expect(await deepLink.text()).toBe(html);
});

test("an unknown /api/* path returns a JSON 404", async () => {
  const res = await fetch(`${BASE_URL}/api/nope`);

  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toStartWith("application/json");
  expect(await res.json()).toEqual({ error: "Not found" });
});
