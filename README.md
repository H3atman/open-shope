# open-shope

[![CI](https://github.com/H3atman/open-shope/actions/workflows/ci.yml/badge.svg)](https://github.com/H3atman/open-shope/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/H3atman/open-shope)

An open-source, self-hosted, mobile-first Shopee-style shop. Each owner runs their own copy on their own Cloudflare account, on the Free plan.

**Status:** an early deploy spike ([#1](https://github.com/H3atman/open-shope/issues/1)), **not production-ready**. Today it has a health check, first-run owner setup, and email + password sign-in; no shop features yet. See the [research](docs/research/2026-10-27-shopee-alternative-on-cloudflare.md).

## Deploy

The button copies this repo into your GitHub account and deploys it with Cloudflare Workers Builds. A deploy creates:

- a Worker, `open-shope` by default;
- a D1 database and an R2 bucket named after it (`open-shope-db`, `open-shope-media`);
- the database tables: the `deploy` script runs `wrangler deploy`, then the D1 migrations.

The Worker needs a `BETTER_AUTH_SECRET` secret; generate one with `openssl rand -hex 32`. (Whether the button's form asks for it is still being checked in [#1](https://github.com/H3atman/open-shope/issues/1).) After deploying, open the Worker's URL and create the owner account. **Until you do, anyone who finds the URL can claim the shop.**

### Deploy from your machine

Clone your copy of this repo, then run these commands with [bun](https://bun.sh) and OpenSSL installed:

```sh
bun install
bunx wrangler login
(umask 077; printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars.deploy)
bunx wrangler deploy --secrets-file .dev.vars.deploy
bunx wrangler d1 migrations apply DB --remote
```

`.dev.vars.deploy` is gitignored. Keep it private; generate it only for the first deploy.
The first deploy uploads the required secret with the Worker version. Later deploys
retain existing secrets, so use:

```sh
bun run deploy
```

## Develop

```sh
bun install
cp .dev.vars.example .dev.vars
# Fill in BETTER_AUTH_SECRET, then:
bunx wrangler d1 migrations apply DB --local
bun run dev
```

Run `bun run lint`, `bun run typecheck`, and `bun run test:e2e` before a PR.
`bun run format` fixes formatting. See [CONTRIBUTING.md](CONTRIBUTING.md) for testing
and contribution details.

## Community

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

License: [AGPL-3.0](LICENSE).
