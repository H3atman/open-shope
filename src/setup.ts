import { Hono } from "hono";
import { createAuth } from "./auth";

type Owner = { name: string; email: string; password: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns the owner's sign-up fields, or null when any is missing or invalid.
// Password bounds match Better Auth's defaults (8 to 128), so sign-up can't reject them later.
function parseOwner(body: unknown): Owner | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, email, password } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof email !== "string" || !EMAIL.test(email)) return null;
  if (typeof password !== "string" || password.length < 8 || password.length > 128) return null;
  return { name: name.trim(), email, password };
}

// First-run setup, mounted at /api/setup.
export const setup = new Hono<{ Bindings: Env }>();

// Reports whether the shop still needs an owner.
setup.get("/", async (c) => {
  const owner = await c.env.DB.prepare(`SELECT 1 FROM "user" WHERE "role" = 'owner' LIMIT 1`).first();
  return c.json({ needsSetup: owner === null });
});

// Creates the owner once and signs them in. The 'setup' settings row is an atomic claim:
// only the request whose INSERT changes a row may continue; everyone else gets 409.
setup.post("/", async (c) => {
  const owner = parseOwner(await c.req.json().catch(() => null));
  if (!owner) return c.json({ error: "Name, a valid email and an 8 to 128 character password are required" }, 400);

  const claim = await c.env.DB
    .prepare(`INSERT INTO "settings" ("key", "value") VALUES ('setup', ?) ON CONFLICT DO NOTHING`)
    .bind(new Date().toISOString())
    .run();
  if (claim.meta.changes === 0) return c.json({ error: "Setup is already done" }, 409);

  try {
    const auth = createAuth(c.env, new URL(c.req.url).origin);
    const { headers, response } = await auth.api.signUpEmail({
      body: owner,
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    await c.env.DB.prepare(`UPDATE "user" SET "role" = 'owner' WHERE "id" = ?`).bind(response.user.id).run();
    for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
    return c.json({ ok: true }, 201);
  } catch (error) {
    await c.env.DB.prepare(`DELETE FROM "settings" WHERE "key" = 'setup'`).run();
    throw error;
  }
});
