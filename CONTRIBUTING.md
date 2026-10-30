# Contributing

You'll need [bun](https://bun.sh).

## Local setup

```sh
bun install
cp .dev.vars.example .dev.vars
# Fill in BETTER_AUTH_SECRET in .dev.vars (generate with openssl rand -hex 32).
bunx wrangler d1 migrations apply DB --local
bun run dev
```

## Checks and tests

CI runs these checks, plus a Wrangler dry-run bundle check:

```sh
bun run lint
bun run typecheck
bun run test:e2e
```

`bun run format` fixes formatting and applies safe lint fixes. After changing
`wrangler.jsonc`, run `bunx wrangler types` to refresh the generated types.

Tests are E2E only, at the Worker's HTTP surface under `e2e/`: no mocks and no
unit tests. A behaviour change comes with an E2E test. The runner starts a fresh
local Worker with temporary D1/R2 state and its own secret, then writes JUnit
and sign-in results to `e2e/artifacts/`.

To test a deployed shop, use `BASE_URL=https://… bun run test:e2e`. This creates
accounts and claims the shop if it has no owner; create the owner first.

## Proposing changes

Open or comment on an issue before larger changes. Keep PRs small and explain
what changed and why.

Contributions are licensed under AGPL-3.0, the same license as the project
(inbound = outbound). There is no CLA.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md),
not in public issues.
