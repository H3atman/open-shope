import { APIError, isAPIError } from "better-auth/api";
import { Hono } from "hono";
import { getAuth } from "./auth";

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
  const claim = await c.env.DB.prepare(
    `INSERT INTO "settings" ("key", "value") VALUES ('setup', ?) ON CONFLICT DO NOTHING`,
  )
    .bind(new Date().toISOString())
    .run();
  if (claim.meta.changes === 0) return c.json({ error: "Setup is already done" }, 409);

  try {
    const auth = getAuth(c.env, new URL(c.req.url).origin);
    const body = await c.req.json<{ name: string; email: string; password: string }>().catch(() => {
      throw new APIError("BAD_REQUEST", { message: "Request body must be valid JSON" });
    });
    const { headers, response } = await auth.api.signUpEmail({
      body,
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    await c.env.DB.prepare(`UPDATE "user" SET "role" = 'owner' WHERE "id" = ?`).bind(response.user.id).run();
    for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
    return c.json({ ok: true }, 201);
  } catch (error) {
    await c.env.DB.prepare(`DELETE FROM "settings" WHERE "key" = 'setup'`).run();
    if (isAPIError(error)) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }
});
