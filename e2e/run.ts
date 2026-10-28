// E2E runner behind `bun run test:e2e [bun test filters...]`.
// BASE_URL set: tests that URL and starts nothing.
// BASE_URL unset: boots a fresh local Worker (temp D1/R2 state, local migrations, random
// BETTER_AUTH_SECRET), tests it, and always tears it down.
// Every run writes e2e/artifacts/<target>-<timestamp>.junit.xml.
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const artifacts = join(import.meta.dir, "artifacts");

type LocalWorker = { url: string; stop: () => Promise<void> };

// Picks a free TCP port on loopback.
function freePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

// Signals a whole process group, ignoring groups that are already gone.
function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {}
}

// Polls /api/health until the Worker answers at all; health itself is asserted by tests.
async function waitForWorker(url: string, proc: Bun.Subprocess) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev exited with ${proc.exitCode}`);
    try {
      await fetch(`${url}/api/health`);
      return;
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error("wrangler dev did not answer within 60s");
}

// Boots `wrangler dev` on fresh temp state, independent of the developer's .dev.vars/.env secrets.
async function startLocalWorker(): Promise<LocalWorker> {
  const state = await mkdtemp(join(tmpdir(), "open-shope-e2e-"));
  const log = join(state, "wrangler.log");
  const secret = randomBytes(32).toString("hex");
  const secretsFile = join(state, "secrets.env");
  await writeFile(secretsFile, `BETTER_AUTH_SECRET=${secret}\n`);
  // --env-file stops wrangler reading .dev.vars, but process.env still wins over it, so set both.
  const env = { ...process.env, BETTER_AUTH_SECRET: secret, WRANGLER_SEND_METRICS: "false" };

  let dev: Bun.Subprocess | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (dev) {
      killGroup(dev.pid, "SIGTERM");
      await Promise.race([dev.exited, Bun.sleep(5_000)]);
      killGroup(dev.pid, "SIGKILL");
    }
    await rm(state, { recursive: true, force: true });
  };

  try {
    const migrate = Bun.spawn(
      [wrangler, "d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
      { cwd: root, env, stdout: Bun.file(log), stderr: Bun.file(log) },
    );
    if ((await migrate.exited) !== 0) throw new Error("local migrations failed");

    const port = freePort();
    dev = Bun.spawn(
      [
        wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
        "--inspector-port", String(freePort()), "--persist-to", state,
        "--env-file", secretsFile, "--show-interactive-dev-session=false",
      ],
      { cwd: root, env, detached: true, stdio: ["ignore", Bun.file(log), Bun.file(log)] },
    );
    const url = `http://127.0.0.1:${port}`;
    await waitForWorker(url, dev);
    return { url, stop };
  } catch (error) {
    console.error(await Bun.file(log).text().catch(() => ""));
    await stop();
    throw error;
  }
}

let worker: LocalWorker | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void (worker?.stop() ?? Promise.resolve()).finally(() => process.exit(130)));
}

let exitCode = 1;
try {
  worker = process.env.BASE_URL ? undefined : await startLocalWorker();
  const baseUrl = process.env.BASE_URL ?? worker?.url ?? "";
  const target = worker ? "local" : new URL(baseUrl).host.replace(/[^\w.-]/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = join(artifacts, `${target}-${stamp}`);
  await mkdir(artifacts, { recursive: true });

  const filters = process.argv.slice(2);
  const tests = Bun.spawn(
    [process.execPath, "test", "--reporter=junit", `--reporter-outfile=${prefix}.junit.xml`,
      ...(filters.length ? filters : ["./e2e"])],
    { cwd: root, env: { ...process.env, BASE_URL: baseUrl, E2E_ARTIFACT_PREFIX: prefix }, stdio: ["inherit", "inherit", "inherit"] },
  );
  exitCode = await tests.exited;
  console.log(`E2E report: ${prefix}.junit.xml`);
} finally {
  await worker?.stop();
}
process.exit(exitCode);
