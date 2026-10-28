# open-shope

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/H3atman/open-shope)

An open-source, self-hosted Shopee-style shop. Each shop owner deploys their own copy to their own Cloudflare account on the free plan.

**Status:** deploy spike ([#1](https://github.com/H3atman/open-shope/issues/1)): a health check, first-run owner setup and email + password sign-in. No shop features yet. See [docs/research/2026-10-27-shopee-alternative-on-cloudflare.md](docs/research/2026-10-27-shopee-alternative-on-cloudflare.md).

## Deploy

A deploy creates:

- a Worker, `open-shope` by default;
- a D1 database and an R2 bucket named after it (`open-shope-db`, `open-shope-media`);
- the database tables: the `deploy` script runs `wrangler deploy`, then the D1 migrations.

The Worker needs a `BETTER_AUTH_SECRET` secret (`openssl rand -hex 32`). After deploying, open the Worker's URL and create the owner account. Until you do, anyone who finds the URL can claim the shop.

## Develop

Log in to Cloudflare with `./scripts/cloudflare-login.sh` (needs [bun](https://bun.sh)). It saves `CLOUDFLARE_ACCOUNT_ID` to `.env`.

```sh
bun install
cp .dev.vars.example .dev.vars   # then fill in BETTER_AUTH_SECRET
bunx wrangler d1 migrations apply DB --local
bun run dev
```

- `bun run typecheck` checks the Worker and the tests.
- `bun run test:e2e` runs the E2E tests against a fresh local Worker and writes a JUnit report to `e2e/artifacts/`.
- `BASE_URL=https://… bun run test:e2e` tests a deployed shop instead. Create the owner first, or the tests claim the shop with a random owner.
- Run `bunx wrangler types` after changing `wrangler.jsonc`.
