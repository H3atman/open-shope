import { Hono } from "hono";
import { getAuth } from "./auth";
import { setup } from "./setup";

const app = new Hono<{ Bindings: Env }>();

// Resolves to "ok" when the probe succeeds, "error" when it throws.
const probe = (check: () => Promise<unknown>) =>
  check().then(() => "ok" as const, () => "error" as const);

// Checks both bindings; 503 names the binding that failed.
app.get("/api/health", async (c) => {
  const [db, media] = await Promise.all([
    probe(() => c.env.DB.prepare("SELECT 1").first()),
    probe(() => c.env.MEDIA.list({ limit: 1 })),
  ]);
  return c.json({ db, media }, db === "ok" && media === "ok" ? 200 : 503);
});

app.route("/api/setup", setup);

app.all("/api/auth/*", (c) => getAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw));

// Only /api/* reaches the Worker; everything else is a static asset or the SPA's index.html.
app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
