# Research: an open-source, self-hosted Shopee alternative on Cloudflare

**Retrieved:** 2026-10-27. Cloudflare plan limits, beta labels and framework support change often, so re-check the linked pages before you promise a cost or a "free" deployment.

**Goal:** a mobile-first shop that an owner deploys to *their own* Cloudflare account in one click, using Workers, D1, R2 and related services. The UI comes later. This file covers the platform, the domain model and the build order.

Legend: plain bullets are **sourced facts**, each with a link. Lines marked **Inference** are our own design reasoning.

---

## 0. TL;DR

- **Platform:** Cloudflare recommends **Workers with Static Assets** for new projects, not Pages ([Pages docs](https://developers.cloudflare.com/pages/), [migration guide](https://developers.cloudflare.com/pages/migrate-to-workers/)).
- **Data:**
  - **D1** (SQLite) holds catalog, orders and inventory.
  - **R2** holds images.
  - **KV** should not hold anything authoritative, because it is eventually consistent ([How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)).
- **One-click deploy:**
  - The "Deploy to Cloudflare" button exists ([d1-template README](https://github.com/cloudflare/templates/blob/main/d1-template/README.md)).
  - Wrangler can **auto-provision D1, R2, KV and Queues** when a binding has no ID ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
  - Durable Objects are not on that auto-provision list.
  - D1 migrations are **not** applied by `wrangler deploy`; the deploy pipeline must run them explicitly ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)).
- **Free plan:** a small shop can mostly run on it (100k requests/day, **10 ms CPU per request**) ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Two features need the $5/mo Paid plan:
  - Sending email to arbitrary customers through Cloudflare Email Sending, which is Beta ([Email Sending](https://developers.cloudflare.com/email-service/)).
  - Heavier CPU work.
- **Domain model:** Shopee's own Open Platform docs give us a proven model for variants, order states, returns and vouchers (§4).
- **Payments in the Philippines:** PayMongo is plain REST with a hosted checkout. It covers cards, GCash, Maya, GrabPay and QR Ph, and its webhook signatures can be checked with Web Crypto (§5).
- **None of the four reference repos can be reused as-is** (§3). Two are useful:
  - OpenShop is the closest Cloudflare precedent, but it is AGPL and keeps everything in KV.
  - Kuzma02 is MIT, a reasonable relational example.
- **UX lessons (§9):** a small (n=24) Shopee Indonesia study found checkout hard for 70.8% of participants and adding to the cart hard for 79.2%. The top asks were easy checkout and easy order-status checking; clutter and slowness were the top complaints.
- **Decided 2026-10-27:**
  - **One shop per deployment.** Shopee is a multi-vendor marketplace; we build a single-shop storefront with Shopee-style UX and leave out the marketplace-only features (§7).
  - **Workers Free plan.**
  - **Rendering:** the hybrid, a SPA plus meta tags injected by the Worker (§10).
  - **MVP auth:** email + password and Google sign-in, using Better Auth with PBKDF2 hashing; Google and email are optional (§11).
  - **Deploy:** the Deploy button plus Wrangler, not the beta `cf` CLI (§12).

---

## 1. Cloudflare platform facts

### 1.1 Workers vs Pages, and frameworks
- New projects should start on Workers; Pages-to-Workers migration targets **Workers Static Assets** ([Pages](https://developers.cloudflare.com/pages/), [migrate](https://developers.cloudflare.com/pages/migrate-to-workers/)).
- **SPA routing:**
  - `assets.not_found_handling: "single-page-application"` returns `index.html` for unmatched paths.
  - `run_worker_first` sends chosen routes, such as `/api/*`, to the Worker first ([Static assets](https://developers.cloudflare.com/workers/static-assets/)).
- **Frameworks:**
  - Official guides cover React Router, Next.js (via OpenNext), Astro, SvelteKit, TanStack Start, Hono, Nuxt and others. Maturity varies by adapter ([Framework guides](https://developers.cloudflare.com/workers/framework-guides/)).
  - React Router uses `@cloudflare/vite-plugin`. Its SPA mode and prerendering are **not** supported with that plugin ([React Router guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)).

### 1.2 One-click deploy ("Deploy to Cloudflare")
- **The button:** `https://deploy.workers.cloudflare.com/?url=<repo>` ([d1-template](https://github.com/cloudflare/templates/blob/main/d1-template/README.md), [saas-admin-template](https://github.com/cloudflare/templates/blob/main/saas-admin-template/README.md)).
- **Auto-provisioning:**
  - D1, KV, R2 and Queues are created automatically when a binding has no ID, or for R2, no bucket name.
  - On a CLI deploy, Wrangler writes the new IDs back to the config file.
  - On a dashboard or Git deploy, the resources are created but the IDs are **not** written back to the repo ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- **Secrets:**
  - `secrets.required` makes a deploy fail when a secret is missing.
  - We **could not verify** that the button prompts the deployer for each secret ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)).
- **Workers Builds (Git CI):**
  - Builds connect a repo and deploy on push.
  - Monorepos are supported through **Root directory**.
  - The Worker name must match the one in the config.
  - Workers Builds ignores Wrangler's `[build]` section ([Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [Builds config](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)).
- **Migrations:**
  - Create them with `wrangler d1 migrations create`; apply them with `wrangler d1 migrations apply`.
  - Deploying does not apply them ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)).
- **Caveat:** even Cloudflare's own `d1-template` README still asks users to create the DB, edit config, apply migrations and deploy ([d1-template](https://github.com/cloudflare/templates/blob/main/d1-template/README.md)).
- **Inference:**
  - Make the deploy command `wrangler d1 migrations apply DB --remote && wrangler deploy`.
  - Seed the first admin through a first-run setup screen, not a CLI step.
  - **Validate the whole button flow in a throwaway spike before building features.** This is the riskiest promise in the project.

### 1.3 D1 (primary database)
- **Limits** ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)):

  | | Free | Paid |
  |---|---|---|
  | Databases per account | 10 | 50k |
  | Size per database | 500 MB | 10 GB (hard cap) |
  | Account storage | 5 GB | 1 TB |
  | Queries per Worker invocation | 50 | 1,000 |
  | Time Travel retention | 7 days | 30 days |

- **Usage allowance** ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)):
  - Free: 5M rows read and 100k rows written per day.
  - Paid: 25B rows read and 50M rows written per month included.
- **Transactions:** `batch()` runs its statements as one transaction and rolls back on failure. Otherwise D1 auto-commits; there are no interactive transactions ([D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)).
- **Read replicas** are available through the Sessions API ([Sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession), [read replication](https://developers.cloudflare.com/d1/reference/read-replication/)).
- **Drizzle ORM** has an official D1 tutorial ([D1 + Drizzle](https://developers.cloudflare.com/d1/tutorials/d1-and-drizzle/)).
- **Time Travel** restores overwrite the database in place, so keep an export/backup too ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)).
- **Inference: preventing overselling.**
  - Take stock with one conditional write: `UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?`, then check that exactly one row changed.
  - Put the stock writes and the order insert in one `batch()` so they succeed or fail together.
  - No read-then-write race, and no Durable Object needed for v1.

### 1.4 Durable Objects (later: chat, flash sales)
- SQLite-backed Durable Objects are available on the **Free** plan, with 100k requests/day ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
- Each object is single-threaded with strongly consistent storage ([What are DOs](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)).
- WebSocket Hibernation keeps idle sockets open without duration charges; a new deploy disconnects them. A good fit for buyer–seller chat ([WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- **Alarms:** one per object, run at least once ([Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)).

### 1.5 R2 and images
- **Free tier:** 10 GB-month of storage, 1M Class A operations, 10M Class B operations, and free egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)).
- **Uploads:** the browser can upload straight to R2 with a presigned PUT URL (valid 1 s to 7 days) on the S3 hostname. This needs an R2 CORS policy ([presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [CORS](https://developers.cloudflare.com/r2/buckets/cors/)).
- **`r2.dev` is development-only and rate-limited.** Production should use a custom domain ([public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
- **Image transformations:**
  - 5,000 unique transformations/month on Free; new ones **fail** past that ([Images pricing](https://developers.cloudflare.com/images/pricing/)).
  - We could not verify that URL transforms work on a bare `workers.dev` hostname ([transform via URL](https://developers.cloudflare.com/images/transform-images/transform-via-url/)).
  - **Inference:** for v1, serve images from R2 through the Worker. Resize on upload in the browser, which produces a thumbnail and a full-size image, so we don't depend on a zone.

### 1.6 KV, Queues, Cron, Workflows
- **KV:**
  - Eventually consistent; changes can take 60 s or more to spread ([How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)).
  - Free: 100k reads and 1k writes per day ([KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)).
  - Use it only for caches.
- **Queues:** on Free, 10k operations/day ([Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)).
- **Cron Triggers:** 5 per account on Free; changes can take up to 15 min to take effect ([Cron](https://developers.cloudflare.com/workers/platform/cron-triggers/)).
- **Workflows:** available on Free with 3,000 steps/day ([Workflows](https://developers.cloudflare.com/workflows/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
- **Inference:** one Cron Trigger every few minutes scans D1 for deadline columns:
  - `pay_by`: auto-cancel unpaid orders and restore their stock.
  - `auto_complete_at`: complete delivered orders.
  - That is simpler than a timer per order. Make both transitions idempotent.

### 1.7 Email, security, auth
- **Email:**
  - Cloudflare Email Sending is **Beta**. Sending to **arbitrary recipients requires Workers Paid**; sending to verified addresses is free.
  - Email Routing only handles inbound mail ([Email Sending](https://developers.cloudflare.com/email-service/)).
- **Turnstile:** check every token on the server with Siteverify. Tokens are single-use and valid for 300 s ([Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)).
- **Rate Limiting binding:** approximate and per location. Use Durable Objects for strict global limits ([Rate limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).
- **Cloudflare Access** can protect `/admin` behind a zone and denies by default ([Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)).
- **Auth libraries:**
  - Better Auth documents Workers and D1 support, but we **didn't verify** how current it is ([Better Auth](https://www.better-auth.com/docs)).
  - Cloudflare has an OpenAuth template ([openauth-template](https://github.com/cloudflare/templates/tree/main/openauth-template)).
- **Inference:** password hashing (PBKDF2 or similar) uses a lot of CPU, and the Free plan allows only **10 ms CPU** per request. Benchmark login in the spike before choosing an auth approach.

### 1.8 Limits, pricing, Node compatibility
- **Plans** ([limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/)):

  | | Free | Paid (min $5/mo) |
  |---|---|---|
  | Requests | 100k/day | 10M/month included |
  | CPU | 10 ms per request | 30M CPU-ms/month included |
  | Subrequests | 50 per request | — |
  | Script size | 64 MiB uncompressed | — |
  | Memory | 128 MB | — |

  Static asset requests are free and unlimited on Paid.
- **`nodejs_compat`** gives a *subset* of Node APIs. Pin the compatibility date and test your dependencies ([Node compat](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)).
- **Stripe:** verify webhooks with async `constructEventAsync` (Web Crypto) on the **raw** request body ([stripe-node Webhooks.ts](https://github.com/stripe/stripe-node/blob/master/src/Webhooks.ts), [Stripe signatures](https://docs.stripe.com/webhooks/signature)).

### 1.9 Official templates worth reading
- [`d1-template`](https://github.com/cloudflare/templates/blob/main/d1-template/README.md): D1 with migrations, plus a Deploy button.
- [`saas-admin-template`](https://github.com/cloudflare/templates/blob/main/saas-admin-template/README.md): Astro, D1, Workflows and an admin UI.
- [`react-router-hono-fullstack-template`](https://github.com/cloudflare/templates/blob/main/react-router-hono-fullstack-template/README.md): React Router, Hono and Tailwind (no D1).
- [`d1-starter-sessions-api-template`](https://github.com/cloudflare/templates/blob/main/d1-starter-sessions-api-template/README.md): D1 read replicas.
- Cloudflare has **no official e-commerce template** ([templates repo](https://github.com/cloudflare/templates)).

---

## 2. Proposed architecture (Inference)

The simplest setup that deploys with one button and fits the Free plan for a small shop:

```
One Worker  (wrangler.jsonc, compatibility_flags: ["nodejs_compat"])
├── assets: Vite + React SPA (mobile-first), not_found_handling = "single-page-application"
├── /api/*  → Hono router (run_worker_first)   — JSON API, zod validation
├── scheduled() → cron: auto-cancel unpaid, auto-complete delivered
├── D1  binding DB      (auto-provisioned, Drizzle, SQL migrations)
└── R2  binding MEDIA   (auto-provisioned, product/review images)
Later: Durable Object (chat / flash sale), Queue (emails, webhooks)
```

- **Why an SPA plus an API rather than server-side rendering:**
  - Lowest CPU per request on a 10 ms budget.
  - Static assets don't use Worker CPU.
  - It matches OpenShop's proven Cloudflare layout ([OpenShop ARCHITECTURE.md](https://github.com/AJFrio/OpenShop/blob/main/docs/ARCHITECTURE.md)).
  - **Trade-off:** search engines and link previews don't see product pages. Add pre-rendered `<meta>` tags for `/p/:slug` in the Worker later if SEO matters.
- **Money:** store amounts as **integers in centavos**, plus an ISO currency code. Shopee's API uses floats ([add_item `original_price` float](https://open.shopee.com/opservice/api/v1/doc/api/?api_name=v2.product.add_item&version=2)); we shouldn't.
- **Prices:** always recompute them on the server. Never trust a total sent by the client (see the Kuzma02 anti-pattern, §3).

---

## 3. Reference repositories

All four were shallow-cloned and read; none was run.

| Repo | Stack | License | Learn | Avoid |
|---|---|---|---|---|
| [Kuzma02 Electronics shop](https://github.com/Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS) | Next.js + Express + Prisma + MySQL | MIT | Relational product / category / order lines; wishlist, notifications, merchants, bulk import ([schema.prisma](https://github.com/Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS/blob/main/server/prisma/schema.prisma) L16–191) | Stores the **client-supplied total**; no unit-price snapshot on order lines; free-form `status` string; no visible admin authorization on mounted routes ([customer_orders.js](https://github.com/Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS/blob/main/server/controllers/customer_orders.js) L35–83, L191–260; [app.js](https://github.com/Kuzma02/Electronics-eCommerce-Shop-With-Admin-Dashboard-NextJS-NodeJS/blob/main/server/app.js) L121–133) |
| [shashirajraja/shopping-cart](https://github.com/shashirajraja/shopping-cart) | Java Servlet/JSP + JDBC + MySQL | Apache-2.0 | Basic cart / order-line / transaction tables ([mysql_query.sql](https://github.com/shashirajraja/shopping-cart/blob/master/databases/mysql_query.sql)) | **Plaintext passwords** ([UserServiceImpl.java](https://github.com/shashirajraja/shopping-cart/blob/master/src/com/shashi/service/impl/UserServiceImpl.java) L44–54); demo payment counted as paid; stock decremented with no `>=` guard and no transaction, so it can oversell ([OrderServiceImpl.java](https://github.com/shashirajraja/shopping-cart/blob/master/src/com/shashi/service/impl/OrderServiceImpl.java) L39–59; [ProductServiceImpl.java](https://github.com/shashirajraja/shopping-cart/blob/master/src/com/shashi/service/impl/ProductServiceImpl.java) L476–503) |
| [selldone/storefront](https://github.com/selldone/storefront) | Vue 3 + Vite + Vuetify + Selldone SDK | MIT file (package.json says `Selldone®`) | UX flows only: listing / filter, product page, basket by product type, order tracking ([README](https://github.com/selldone/storefront) L39–79) | It is **only a frontend** for Selldone's hosted backend; there is no schema to port ([storefront.ts](https://github.com/selldone/storefront/blob/main/storefront.ts) L79–86) |
| [AJFrio/OpenShop](https://github.com/AJFrio/OpenShop) | React 19/Vite + Hono in one Worker; KV + R2 + Stripe | **AGPL-3.0-only** | Closest precedent: Worker + Static Assets, admin/public API split, R2 media, Stripe price IDs instead of client amounts, setup script ([setup.js](https://github.com/AJFrio/OpenShop/blob/main/scripts/setup.js) L249–329; [checkout.js](https://github.com/AJFrio/OpenShop/blob/main/src/routes/public/checkout.js) L44–96) | **KV as the only store** for catalog and fulfillment (not transactional); no orders table (orders live in Stripe); no stock model; no webhook route found; published default admin password `admin123` with a forced change ([kv-data-model.md](https://github.com/AJFrio/OpenShop/blob/main/docs/generated/kv-data-model.md); README L94–104) |

- **Licensing:** copying OpenShop code would put this project under AGPL. Learning from its structure is fine. MIT and Apache-2.0 code can be reused with attribution.
- **OpenShop's deploy flow:**
  - Its CLI setup script generates `wrangler.toml` (Worker + assets + `nodejs_compat`).
  - It deploys, creates KV and R2, adds the bindings, then redeploys ([setup.js](https://github.com/AJFrio/OpenShop/blob/main/scripts/setup.js) L249–329).
  - Wrangler auto-provisioning (§1.2) should make that dance unnecessary.

---

## 4. Shopee's domain model (from Shopee Open Platform)

Read through Shopee's own docs API: guide JSON at `https://open.shopee.com/opservice/api/v1/developer_guide/detail?document_id=<id>&language_code=en` and API JSON at `https://open.shopee.com/opservice/api/v1/doc/api/?api_name=<name>&version=2`. The human-readable pages are `https://open.shopee.com/developer-guide/<id>`. They are JavaScript-only, which is why they can't be fetched directly.

### 4.1 Products and variants
- **Variants:** up to **two tiers** (e.g. color × size), with **50 variants max** ([Variant management, guide 219](https://open.shopee.com/developer-guide/219)).
  - Each variant ("model") has a `model_id`, a `tier_index` (e.g. `[0,1]` = red, XL), a `model_sku`, a price and stock ([get_model_list](https://open.shopee.com/opservice/api/v1/doc/api/?api_name=v2.product.get_model_list&version=2)).
  - Changing the tier structure (e.g. adding size to a color-only product) **deletes the existing models and creates new ones** ([guide 219](https://open.shopee.com/developer-guide/219)).
- **Item fields** ([add_item](https://open.shopee.com/opservice/api/v1/doc/api/?api_name=v2.product.add_item&version=2)):
  - `item_name`, `description`, `original_price`, `category_id`, `brand`, `image.image_id_list`, `item_sku`, `condition` (New/Used), `weight` (kg) and `dimension` (cm).
  - `logistic_info[]`: shipping channels enabled per item, with a custom fee or free shipping.
  - `pre_order { is_pre_order, days_to_ship }`, `wholesale[]` quantity tiers, `seller_stock[]` per location.
  - `purchase_limit_info` (min/max per order), `scheduled_publish_time`, `size_chart_info`, and `certification_info` (for some PH categories).
- **Item statuses:** `NORMAL`, `BANNED`, `UNLIST`, `REVIEWING`, `SELLER_DELETE`, `SHOPEE_DELETE` ([Data Definition, guide 31](https://open.shopee.com/developer-guide/31)).
- **Price and stock:**
  - `current_price` vs `original_price`: during a promotion, `current_price` is the promo price ([Stock & Price, guide 223](https://open.shopee.com/developer-guide/223)).
  - Stock has `total_available_stock` and `total_reserved_stock` (stock held for promotions) ([get_model_list](https://open.shopee.com/opservice/api/v1/doc/api/?api_name=v2.product.get_model_list&version=2)).
  - In PH, the most expensive variant may cost at most **5×** the cheapest ([guide 223](https://open.shopee.com/developer-guide/223)).

### 4.2 Orders
- **Entities:**
  - An **Order** can hold many items.
  - A **Package** is the unit that ships; one order can be split into several packages.
  - An **Item** is a line in the order ([Order Management, guide 229](https://open.shopee.com/developer-guide/229)).
- **Order statuses** ([guide 229 §10](https://open.shopee.com/developer-guide/229)):

  | Status | Meaning |
  |---|---|
  | `UNPAID` | Created; the buyer hasn't paid |
  | `READY_TO_SHIP` | The seller can arrange shipment |
  | `PROCESSED` | Shipment arranged and a tracking number obtained |
  | `SHIPPED` | Dropped off at, or picked up by, the courier |
  | `TO_CONFIRM_RECEIVE` | Received by the buyer |
  | `COMPLETED` | Done |
  | `RETRY_SHIP` | Courier pickup failed; shipment must be rearranged |
  | `IN_CANCEL` | Cancellation in progress |
  | `CANCELLED` | Cancelled |
  | `TO_RETURN` | A return is in progress |

- **Fulfillment / logistics statuses** ([guide 229](https://open.shopee.com/developer-guide/229)):
  - `LOGISTICS_NOT_START` → `LOGISTICS_READY` → `LOGISTICS_REQUEST_CREATED` → `LOGISTICS_PICKUP_DONE` → `LOGISTICS_DELIVERY_DONE`.
  - `LOGISTICS_READY` means paid, or for COD, passed COD screening.
  - Failure branches: `LOGISTICS_PICKUP_FAILED`, `LOGISTICS_PICKUP_RETRY`, `LOGISTICS_DELIVERY_FAILED`, `LOGISTICS_LOST`, `LOGISTICS_INVALID`, `LOGISTICS_REQUEST_CANCELED`, `LOGISTICS_COD_REJECTED`.
- **Cancellation:**
  - Seller-side reasons: `OUT_OF_STOCK`, `UNDELIVERABLE_AREA`.
  - Buyer cancel reasons include "Need to input / change voucher code", "Modify existing order (color, size, voucher, etc)" and "Seller takes too long to ship" ([guides 229](https://open.shopee.com/developer-guide/229), [31](https://open.shopee.com/developer-guide/31)).
  - Sellers either cancel themselves or accept/reject the buyer's cancellation request (`handle_buyer_cancellation`) ([guide 229](https://open.shopee.com/developer-guide/229)).

### 4.3 Returns and refunds ([Return Refund Management, guide 227](https://open.shopee.com/developer-guide/227))
- **Statuses:** `REQUESTED`, `ACCEPTED`, `CANCELLED`, `JUDGING`, `CLOSED`, `PROCESSING`, `SELLER_DISPUTE`.
- **Solutions:** `RETURN_REFUND` or `REFUND` (refund only, no item returned).
- **Reasons:** `NOT_RECEIPT`, `WRONG_ITEM`, `ITEM_DAMAGED`, `DIFFERENT_DESCRIPTION`, `MUTUAL_AGREE`, `CHANGE_MIND`, `ITEM_MISSING`, `EXPECTATION_FAILED`, `ITEM_FAKE`, `PHYSICAL_DMG`, `FUNCTIONAL_DMG`, `OTHER`.
- **Request types:** normal (after delivery), in-transit, and return-on-the-spot (the buyer refuses the parcel at the door).
- **Flow:** a buyer can raise several return requests per order. The seller can confirm (full refund), make an offer, accept the buyer's offer, or dispute with photo evidence.

### 4.4 Promotions and vouchers
- **Voucher fields** ([v2.voucher.add_voucher](https://open.shopee.com/opservice/api/v1/doc/api/?api_name=v2.voucher.add_voucher&version=2)):
  - `voucher_code`, `start_time` / `end_time`.
  - `voucher_type`: 1 = shop, 2 = product (plus `item_id_list`).
  - `reward_type`: 1 = fixed amount, 2 = percentage, 3 = coin cashback.
  - `usage_quantity`, `min_basket_price`, `discount_amount` or `percentage`, and `max_price` (discount cap; 0 = no cap).
  - `display_channel_list` (empty = hidden or code-only voucher) and `display_start_time` (when buyers can start claiming it).
- **Promotion types:** Campaign, Discount Promotions, Flash Sale, Whole Sale, Group Buy, Bundle Deal, Welcome Package, Add-on Discount, Brand Sale, In-Shop Flash Sale, Gift with Purchase, Exclusive Price, and Platform/Seller Streaming ([guide 31](https://open.shopee.com/developer-guide/31)).

### 4.5 Escrow (a marketplace feature)
- Wallet transaction types include `ESCROW_VERIFIED_ADD` (escrow paid to the seller), `FAST_ESCROW_DISBURSE`, and refund and return-adjustment types. In other words, Shopee holds buyer money and releases it to the seller after the order completes ([guide 31](https://open.shopee.com/developer-guide/31)).

### 4.6 Proposed order state machine for a single shop (Inference)

Shopee's states, collapsed to what one merchant needs:

```
pending_payment ──paid (webhook)──▶ to_ship ──tracking added──▶ shipped ──▶ delivered ──(buyer confirms | auto after N days)──▶ completed
      │  (COD skips straight to to_ship)          │                                  │
      └─pay_by passed (cron) / buyer─▶ cancelled ◀┘seller cancels (restock)          └─▶ return_requested ─▶ return_accepted|return_rejected ─▶ refunded
```

- Keep an `order_events` table, an append-only log of status changes with the actor and any webhook ID. It gives an audit trail and makes webhooks idempotent.
- Shopee's `PROCESSED`/`SHIPPED` and `RETRY_SHIP` states only matter once a courier is integrated. Add them then.

---

## 5. Philippine payments and couriers

- **PayMongo** is the strongest fit:
  - It has a hosted checkout and Checkout Session endpoints: [create](https://docs.paymongo.com/reference/create_checkout_sessions.md), [retrieve](https://docs.paymongo.com/reference/get_checkout_sessions.md), [expire](https://docs.paymongo.com/reference/create_checkout_sessions_id_expire.md) ([hosted checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout.md)).
  - It accepts [cards](https://docs.paymongo.com/docs/payment-acceptance-cards.md), [e-wallets including GCash, Maya and GrabPay](https://docs.paymongo.com/docs/payment-acceptance-e-wallets.md), and [QR Ph](https://docs.paymongo.com/docs/payment-acceptance-qr-ph.md).
  - Test keys are `sk_test_` / `pk_test_` ([testing](https://docs.paymongo.com/docs/payment-acceptance-testing.md)); see also the [verification requirements](https://docs.paymongo.com/docs/account-settings-verification-requirements.md).
  - **Webhook signature** ([Setup & Management](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management.md)):
    - The header looks like `Paymongo-Signature: t=<ts>,te=<test sig>,li=<live sig>`.
    - Compute HMAC-SHA256 of `"{t}.{raw body}"` with the endpoint's secret.
    - Compare against `te` in test mode or `li` in live mode.
    - Optionally reject old timestamps to stop replays.
    - Web Crypto can do all of this, so no SDK is needed.
  - Test-mode and live-mode webhook endpoints are registered separately ([key concepts](https://docs.paymongo.com/docs/developer-tools-webhooks-key-concepts.md)).
- **Xendit:**
  - Supports PH cards, GCash, Maya, GrabPay and QRPh, with [Payment Sessions](https://docs.xendit.co/docs/payment-sessions-overview.md) and [test-mode simulation](https://docs.xendit.co/apidocs/simulate-payment-test-mode.md).
  - Its webhook check is **not verified**; see [Handling webhooks](https://docs.xendit.co/docs/handling-webhooks.md) and [Integration security](https://docs.xendit.co/docs/integration-security.md).
  - Other links: [fees](https://docs.xendit.co/docs/transaction-fees.md), [PH business documents](https://docs.xendit.co/docs/philippines-business-documents.md).
- **Maya Checkout:**
  - Hosted page with a REST/JSON API. Sandbox host `pg-sandbox.paymaya.com`, production `pg.maya.ph`.
  - Its docs list webhook source IPs, but **no signature scheme was found** ([Maya Checkout](https://developers.maya.ph/paymaya/docs/about-maya-checkout)).
- **Stripe** works on Workers with async webhook verification (§1.8). It is less relevant for PH wallets.
- **COD (Inference):** a payment method, not a gateway. The order goes straight to `to_ship`, and money is recorded as received at delivery. Shopee also screens orders before allowing COD (`LOGISTICS_READY` "passed COD screening", `LOGISTICS_COD_REJECTED`) ([guide 229](https://open.shopee.com/developer-guide/229)).
- **Inference:** put payments behind a small `PaymentProvider` interface (`createCheckout`, `verifyWebhook`, `parseEvent`). Ship **COD + PayMongo** first.
- **Couriers:**
  - Ninja Van has an [API docs site](https://api-docs.ninjavan.co/), but we couldn't confirm access terms or PH coverage.
  - We couldn't verify public APIs for J&T PH, LBC, Flash Express, Lalamove, GoGo Xpress or Entrego.
  - **Inference:** v1 uses manual shipping: the seller types the courier and tracking number. Courier integrations come later, behind an adapter.

---

## 6. Proposed minimal D1 schema (Inference)

This combines Shopee's model (§4) with the relational shape the reference repos share (§3). Amounts are integers in centavos.

```
settings(key PK, value)                                -- shop name, currency, pay_by_minutes, auto_complete_days…
users(id, email UNIQUE, phone, password_hash, role CHECK(role IN ('customer','admin')), created_at)
sessions(id_hash PK, user_id, expires_at)
addresses(id, user_id, name, phone, line1, line2, barangay, city, province, postal_code, is_default)
categories(id, parent_id NULL, name, slug UNIQUE, sort)
products(id, slug UNIQUE, name, description, category_id, status CHECK(IN 'active','unlisted','deleted'),
         tier_variations JSON,            -- [{name:"Color",options:["Red","Blue"]},{name:"Size",options:[…]}] (≤2 tiers)
         weight_g, days_to_ship, created_at, updated_at)
product_images(id, product_id, r2_key, sort)
variants(id, product_id, tier_index JSON, sku UNIQUE, price_minor, original_price_minor, stock CHECK(stock>=0), active)
carts(id, user_id NULL, guest_token_hash NULL, updated_at) ; cart_items(cart_id, variant_id, qty, PK(cart_id,variant_id))
orders(id, order_no UNIQUE, user_id NULL, email, phone, status, payment_method, currency,
       subtotal_minor, shipping_minor, discount_minor, total_minor,
       ship_to JSON,                       -- address snapshot
       courier, tracking_no, pay_by, auto_complete_at, created_at, updated_at)
order_items(id, order_id, variant_id, product_name, variant_label, sku, unit_price_minor, qty)   -- snapshots
order_events(id, order_id, from_status, to_status, actor, note, created_at)
payments(id, order_id, provider, provider_ref UNIQUE, status, amount_minor, raw JSON, created_at)  -- webhook idempotency
vouchers(id, code UNIQUE, type CHECK(IN 'shop','product'), reward CHECK(IN 'fixed','percent'),
         amount_minor NULL, percent NULL, max_discount_minor NULL, min_spend_minor, usage_limit, used_count,
         starts_at, ends_at) ; voucher_items(voucher_id, product_id)
wishlists(user_id, product_id, created_at, PK(user_id, product_id))   -- "Favorit Saya" (§9)
reviews(id, order_item_id UNIQUE, user_id, rating CHECK(1..5), body, created_at) ; review_images(review_id, r2_key)
returns(id, order_id, status, solution, reason, note, refund_minor, created_at)
```

- **Checkout in a single `batch()`:**
  - One conditional `UPDATE variants … WHERE stock >= ?` per line.
  - The `orders` and `order_items` inserts.
  - A voucher `UPDATE … SET used_count = used_count + 1 WHERE used_count < usage_limit`.
- **If any guard changes 0 rows,** throw so the batch rolls back. Inside the batch, use a trigger or `RAISE(ABORT)`, or a guarded `INSERT … SELECT`. **Verify this pattern in the spike.**

---

## 7. Open decisions for you

1. ~~**Single shop or marketplace?**~~ **Decided 2026-10-27: one shop per deployment.**
   - **Out of scope:** platform vouchers, buyer-to-seller escrow (§4.5), seller onboarding/KYC, commissions, a cart grouped by shop, and authenticity badges.
   - **Kept:** shop vouchers and product vouchers (§4.4), with the shop owner as the only admin and seller.
2. ~~**Rendering**~~ **Decided 2026-10-27: hybrid.** A SPA, plus the Worker injecting meta tags (title, OG, JSON-LD) on `/` and `/p/*` with HTMLRewriter (§10).
3. ~~**Auth approach**~~ **Decided 2026-10-27:** the MVP has email + password and Google sign-in; more methods later (§11).
4. ~~**Paid plan acceptable?**~~ **Decided 2026-10-27: Free plan for now.**
   - Email is chosen per shop at launch: Cloudflare Email Sending (Paid), Resend (SDK), or skip. It can be changed in Shop settings (§13.2).
   - A custom domain stays optional; it's only needed for email.

## 8. Suggested build order (Inference)

0. **Deploy spike:**
   - An empty Worker with a D1 + R2 binding and no IDs, plus a Deploy button.
   - Run migrations in the deploy command and add a first-run admin setup screen.
   - Check auto-provisioning, any secret prompts, the CPU used by password hashing, and the D1 `batch()` rollback guard.
1. Catalog: categories, products with two-tier variants, R2 images, and the admin CRUD.
2. Cart and COD checkout: the order state machine, conditional stock decrement, `order_events`, and the cron for auto-cancel and auto-complete.
3. Customer accounts, addresses, favourites, and "My Purchases" tabs built from the order states.
4. PayMongo online payments behind the `PaymentProvider` interface, with a webhook.
5. Vouchers, then flash sale (time-boxed `price_minor` overrides).
6. Reviews and returns/refunds.
7. Email (Queue), chat (Durable Objects), courier adapters.

---

## 9. Mobile UX lessons: the Shopee redesign case study

**Source:** Joan Isva Shanti Andrea, ["UI/UX Case Study: Shopee Redesign"](https://medium.com/@joanisva/ui-ux-case-study-shopee-redesign-64f38a4a970d), Medium, 1 May 2022. Read from a PDF export the user supplied (21 pages, saved 2026-10-27); page numbers below refer to that export.

**Read this with care:**
- It is one designer's portfolio piece about **Shopee Indonesia**, not the Philippines (mixed English and Bahasa Indonesia; p.1).
- The survey had **24 completed responses**, 91.7% of them aged 18–25 (p.3).
- The app it describes dates from March 2022 (p.1).
- Treat its findings as hints, not data.
- The heuristic-evaluation table, wireframes and interactive prototype were embedded and didn't survive the PDF export (pp.6–10, 17).

### 9.1 Method and findings
- **Method:**
  - Empathize: survey, Google Play / App Store reviews, and a heuristic evaluation (pp.2–3).
  - Define: a persona (pp.7–8).
  - Ideate and prototype: paper sketches, then Figma (p.9).
- **Goals:**
  1. Fix usability issues.
  2. Create a simpler look.
  3. Improve product search and selection.
  4. Improve the cart (p.2).
- **Survey results:**

  | Finding | Share of participants |
  |---|---|
  | Had difficulties using the app | 50% |
  | Struggled to find original (authentic) products | 37.5% |
  | Found the app overly crowded | 29.5% (written as 29.2% on p.13) |
  | **Found checkout difficult** | **70.8%** |
  | **Had trouble adding items to the cart** | **79.2%** |

  Quotes: "To find things in crowded carts, you'll have to scroll", "Suddenly, things are out of stock", "There are far too many options", "The amount of things in the cart has a restriction", "In the cart, there is no way to categorize or manage the items" (pp.3–4).
- **What users ranked as most important** (p.4–5), in order:
  1. Easy checkout and payment
  2. Easy status checking
  3. Product quality
  4. Easy navigation
  5. Fast seller response
  6. Easy product search
  7. Minimal ads
  8. Easy link sharing
  9. Extras such as games and live streams
- **App reviews:** most complaints are about clutter (banners, pop-ups, too many icons and games) and slowness. One asks to bring back search inside the favourites list (p.6).
- **Persona "Mita", 22, Jakarta** (p.8):
  - Needs: original products, easy checkout and payment, vouchers and discounts.
  - Frustrations: too many useless features, authenticity not guaranteed, a laggy app.
  - Pays digitally, shops on the mobile app.
- **Search problems** (p.9):
  - The filter could be simpler.
  - No authenticity badge on product cards.
  - Shopee Mall is not highlighted.
  - Crowded displays.
  - Too many non-shopping features.
  - Ambiguous categories.
- **Cart problems** (p.9):
  - No search, filter or sort.
  - A limit on the number of items.
  - Hard to find items that have become unavailable.

### 9.2 Proposed redesign (pp.11–17)
- **Home:**
  - Shopee Mall (authentic brands) is promoted to a main section.
  - "Favorit Saya" (favourites) gets a bottom-nav slot instead of living under Profile.
  - Fewer home categories and a cleaner look.
  - Underlined text marks links such as "see more".
  - Recommendations are reduced to Flash Sale, Categories, Shopee Mall (in a contrasting color) and "Products for you" with quick filters.
- **Search:**
  - Swipeable tabs for history, last seen and popular.
  - A refresh button for popular searches and categories.
  - Voice search, alongside the existing image search.
- **Listing:**
  - Filter, Relevance and Sort get visible buttons with icons at the top.
  - An "ORI" badge on authentic product cards, and a one-tap "100% Ori" filter.
- **Cart:**
  - Search inside the cart.
  - Unavailable items (sold out or archived) moved into their own group, so they don't use up the cart limit and stay easy to find.
  - A one-tap link to favourites.

### 9.3 What this means for us (Inference)
- **Make checkout and order status the stars.** They were users' top two priorities, and 70.8% found checkout hard.
  - Keep checkout to one screen: address, shipping, payment, voucher, total.
  - Give "My Purchases" tabs that follow the order states (§4.6).
- **Show stock before checkout ("Suddenly, things are out of stock").**
  - The cart re-checks stock and price on every view.
  - Show sold-out or changed lines in a separate "Unavailable" group with a "remove" or "similar items" action.
  - The server still enforces stock at checkout (§1.3).
- **Don't add a small cart limit.** It was a top complaint. Any cap should be large and only there to stop abuse.
- **Add favourites (wishlist) early and make them easy to reach** (bottom nav, a heart on product cards). Add `wishlists(user_id, product_id, created_at)` to the §6 schema.
- **Listing page:** a sticky bar with Filter / Sort (relevance, newest, price, best-selling) using icons. Few categories, clearly named.
- **Recently viewed and search history** can live in the browser's localStorage. They need no backend.
- **Skip for v1:**
  - Voice search, games and live streams. They are low priority, add clutter, and the reviews complained about clutter.
  - Cart search. A single shop's cart is small. Add it only if carts get large.
- **Authenticity badges ("ORI", Shopee Mall) only make sense in a marketplace.** In a single-shop deployment the whole store is the brand. Trust comes from reviews with photos and clear return terms instead (§4.3, §7 #1).
- **Link sharing ranked #8.** Shared product links should show a proper preview (Open Graph tags), which bears on the SPA vs SSR decision (§2, §7 #2).
- **Few ads, few pop-ups, and a light bundle.** Speed came up again and again in the reviews, and it also suits Workers' 10 ms CPU budget.

---

## 10. Rendering: single-page app vs server-rendered pages vs hybrid

**Facts:**
- **Static assets:** they are served without running Worker code when the path matches. Unmatched paths can fall back to `index.html`, and `run_worker_first` sends chosen paths to the Worker ([Static assets](https://developers.cloudflare.com/workers/static-assets/)).
- **CPU budget:** Free plan Workers get 10 ms of CPU per request ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- **Google** queues every 200 page for rendering in headless Chromium "once Google's resources allow", and indexes the rendered HTML. It still says "server-side or pre-rendering is still a great idea" and that "not all bots can run JavaScript" ([Google JS SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)).
- **Facebook's link-preview crawler** reads Open Graph tags from the first 1 MB of the HTML. Its docs don't say it runs JavaScript ([Facebook crawler](https://developers.facebook.com/docs/sharing/webmasters/crawler)).
- **HTMLRewriter** can rewrite HTML responses as they stream through a Worker ([HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)).

**Comparison (Inference):**

| | A. Plain SPA + JSON API | B. Server-rendered (e.g. React Router framework mode) | C. Hybrid: SPA + Worker-injected meta tags |
|---|---|---|---|
| Simplicity | Simplest. One Vite React app plus a Hono API; a clean split, and the API can later serve a native app. | Most complex: framework conventions, hydration mismatches, server/client code boundaries. | SPA plus one small Worker route. |
| CPU on Free (10 ms) | Lowest. Pages are static files; the Worker runs only for `/api`. | Highest. Every page view renders React on the Worker plus D1 queries, which is tight at 10 ms. | Low. One D1 lookup plus a streaming HTML rewrite on product and home pages. |
| First load on cheap phones / slow data | Slowest: the JS bundle must download before anything shows. Code-splitting helps. | Fastest: content arrives in the HTML. | Same as A. |
| Navigation after load | App-like and instant; can be installed as a PWA. | Good once hydrated. | Same as A. |
| Link previews (FB, Messenger, Viber) | **None:** every link shows the generic shop title. | Full. | **Full:** title, description and image per product. |
| Google SEO | Works, but rendering is delayed. Other bots may see nothing. | Best. | Good: title, description and Product JSON-LD in the HTML; body still client-rendered. |
| Lock-in | None. | Tied to a framework's Cloudflare adapter. | None. |

**Recommendation (Inference): C, the hybrid.**
- Build the shop as a plain SPA.
- Add `run_worker_first` for `/` and `/p/*`.
- On those paths, the Worker fetches the product from D1 and uses HTMLRewriter to put its `<title>`, `og:title`, `og:description`, `og:image` and a Product JSON-LD block into `index.html`.
- That covers link sharing, which matters in the Philippines where shopping links travel through Facebook and Messenger, and basic SEO, at almost no CPU cost.
- If organic search later becomes a priority, move to SSR. The API stays the same.

---

## 11. Auth on the Free plan

**Decided 2026-10-27:** the MVP has **email + password and Google sign-in**; other methods (phone OTP etc.) come later.

**Facts:**
- **Better Auth basics:**
  - It runs on Workers with `nodejs_compat` and takes the D1 binding directly through its built-in Kysely adapter ([installation](https://www.better-auth.com/docs/installation), [database](https://better-auth.com/docs/concepts/database)).
  - The Google callback path is `/api/auth/callback/google` ([OAuth](https://better-auth.com/docs/concepts/oauth)).
  - Email verification is optional. Verification and password-reset emails are sent through functions **we supply** ([email/password](https://www.better-auth.com/docs/authentication/email-password), [email](https://better-auth.com/docs/concepts/email)).
- **Password hashing is the risk:**
  - Better Auth defaults to **scrypt**. Outside Node/Bun/Deno it falls back to pure-JavaScript `@noble/hashes` scrypt ([password.ts](https://raw.githubusercontent.com/better-auth/better-auth/main/packages/better-auth/src/crypto/password.ts)).
  - There is a bug report titled ["email/password sign-up exceeds CPU time limit on Cloudflare Workers" (#8860)](https://github.com/better-auth/better-auth/issues/8860), plus a related performance PR ([#8685](https://github.com/better-auth/better-auth/pull/8685)).
  - Hash and verify can be overridden with `emailAndPassword.password.hash` / `.verify` ([email/password](https://www.better-auth.com/docs/authentication/email-password)).
- **Cloudflare CPU and crypto:**
  - Workers Web Crypto supports **PBKDF2**; no scrypt or Argon2 is listed ([Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)).
  - Free plan CPU is 10 ms, with "some built-in flexibility" for occasional overages ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- **Email on the Free plan:**
  - Cloudflare only sends to *verified* addresses; arbitrary recipients need Paid ([Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)).
  - Resend's free tier: 3,000 emails/month and 100/day, and it **requires a verified domain** ([pricing](https://resend.com/pricing), [domains](https://resend.com/docs/dashboard/domains/introduction)).
  - Brevo's free tier: 300/day; its domain requirement is unverified ([pricing](https://www.brevo.com/pricing/)).
- **Google sign-in setup:**
  - Each shop needs its own Google OAuth client. The redirect URI must match exactly ([Google OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server), [client ID setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)).
  - `openid`, `email` and `profile` are non-sensitive scopes ([policies](https://developers.google.com/identity/protocols/oauth2/policies)).
  - **`workers.dev` is on the Public Suffix List** ([public_suffix_list.dat](https://publicsuffix.org/list/public_suffix_list.dat), checked 2026-10-27). Each account's `<sub>.workers.dev` therefore counts as its own top-level private domain.

**Implications (Inference):**
- **Use Better Auth with the D1 binding, and override password hashing with PBKDF2-SHA256 through Web Crypto**, which is native rather than pure JavaScript.
  - In the spike, measure the CPU time of sign-up and sign-in, and pick the highest iteration count that fits.
  - We recall that workerd rejects PBKDF2 above 100,000 iterations. That isn't in Cloudflare's docs, so check it.
- **Google sign-in is optional at deploy time.** It turns on when the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` secrets exist. The shop owner's one-off steps:
  1. Create a Google Cloud project.
  2. Create a Web OAuth client.
  3. Add `https://<shop>/api/auth/callback/google` as the redirect URI.
  4. Paste the client ID and secret into the Worker's secrets.

  The Public Suffix List entry suggests a `workers.dev` hostname can satisfy Google's domain rules, but **test this in the spike**.
- **Email is optional too:**
  - Without an email provider: no email verification and no self-service "forgot password". Customers who also use Google can sign in that way.
  - For the owner: a recovery secret set in the Cloudflare dashboard (e.g. `ADMIN_RECOVERY_TOKEN`) unlocks a one-time admin password reset.
  - With a Resend API key and a domain, verification and reset emails switch on.

---

## 12. The `cloudflare/cf` CLI: should we deploy with it?

**Facts:**
- **What it is:** Cloudflare's official "agentic CLI for the entire Cloudflare API", generated from the public OpenAPI spec ([repo](https://github.com/cloudflare/cf), [README](https://github.com/cloudflare/cf/blob/main/README.md)).
  - The [announcement](https://blog.cloudflare.com/cf-cli-local-explorer/) calls it an **early technical preview** and part of the future Wrangler CLI.
  - Public since 2026-09-28; latest release `cf@1.0.0-beta.23` (2026-10-26) ([releases](https://github.com/cloudflare/cf/releases)).
  - Licensed MIT or Apache-2.0.
- **Install and login:** `npm install -g cf` (needs Node), then sign in with OAuth or `CLOUDFLARE_API_TOKEN`.
- **Deploy:** `cf deploy` builds, uploads and auto-provisions the resources the bindings need. It takes secrets from a JSON or `.env` file through `--secrets-file`, and it applies Cron triggers.
- **Migrations:** `cf d1 migrations apply <database-id>` is a separate command that needs the database ID. `cf deploy` doesn't run migrations.

**Recommendation (Inference): don't use it as the deploy path.**
- **The Deploy button** stays the primary path. It needs only a browser, and nothing to install.
- **Wrangler**, which is stable, runs our deploy and migration scripts.
- **`cf`** needs Node, a global npm install and a CLI login, so it can't deliver "deploy in seconds" for shop owners. It is also beta, about one month old.
- **Revisit** when it becomes the next Wrangler. A `cf`-based installer for advanced users could be a later extra.

---

## 13. Custom domain through Cloudflare Registrar

**Facts:**
- **Buying the domain:**
  - Cloudflare Registrar charges "at cost", "No markup. No surprise fees" ([Registrar](https://www.cloudflare.com/products/registrar/)).
  - It works on every plan, including Free ([account options](https://developers.cloudflare.com/registrar/account-options/)), but checkout needs a payment method ([register](https://developers.cloudflare.com/registrar/get-started/register-domain/)).
  - Renewals are automatic by default and non-refundable ([renew](https://developers.cloudflare.com/registrar/account-options/renew-domains/)).
  - WHOIS privacy is free by default ([WHOIS](https://developers.cloudflare.com/registrar/account-options/whois-redaction/)).
- **DNS:** a domain registered at Cloudflare must use Cloudflare DNS ([transfer docs](https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/)).
- **Domain endings:**
  - `.com`, `.shop` and `.store` are supported. **`.ph` / `.com.ph` are not on Cloudflare's TLD list** ([TLD policies](https://www.cloudflare.com/tld-policies/)).
  - Domains bought elsewhere can be added as a Free-plan zone by switching nameservers to Cloudflare ([full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/)).
- **Automation:** registering through the API is beta and only works for some domain endings ([Registrar API](https://developers.cloudflare.com/registrar/registrar-api/)). The Deploy button can't do it.
- **Attaching the Worker:**
  - Go to **Settings → Domains & Routes → Add → Custom Domain**. It works after deploying, without touching the repo.
  - Cloudflare creates the DNS record and certificate.
  - The apex domain and `www` are separate hostnames ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
- **Email:**
  - A domain does **not** lift the Paid requirement for Cloudflare Email Sending to arbitrary recipients ([Email Service](https://developers.cloudflare.com/email-service/)).
  - **Email Routing** (inbound forwarding such as `support@shop.com` → Gmail) is free ([Email Routing](https://developers.cloudflare.com/email-routing/)).
  - Resend can add its DNS records to a Cloudflare domain automatically ([Resend + Cloudflare](https://resend.com/docs/knowledge-base/cloudflare)).
- **Google sign-in:** Google checks domain ownership through a DNS TXT record in Search Console ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification), [Search Console](https://support.google.com/webmasters/answer/9008080)).
- **Zone extras on Free:**
  - An R2 custom domain with caching ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
  - 5,000 image transformations/month ([Images pricing](https://developers.cloudflare.com/images/pricing/)).
  - WAF, cache, and Turnstile ([WAF](https://developers.cloudflare.com/waf/), [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)).

**Implications (Inference):**
- **Make the domain recommended but optional.**
  - The shop works on `workers.dev` as soon as it's deployed.
  - A domain is a roughly 5-minute upgrade done in the Cloudflare dashboard.
  - It can't be required, because it costs money every year, needs a card, can't happen inside the Deploy button, and `.ph` has to be bought elsewhere.
- **The app must not hard-code its hostname.** Take the base URL from the request, or from an optional `SHOP_URL` setting, so auth callbacks and OG tags keep working after a domain is added.
- **A domain plus Resend's free tier unlocks verification and password-reset emails on the Free plan**, at 100/day and 3,000/month. Cloudflare's own email sending would still need Paid.

### 13.1 Can Email Routing handle our email? (checked 2026-10-27)

**Background:**
- Email Routing and Email Sending now sit under **Email Service**. Email Sending is labelled beta ([Email Service](https://developers.cloudflare.com/email-service/)).
- Routing needs a domain on Cloudflare DNS; `workers.dev` alone isn't enough ([route emails](https://developers.cloudflare.com/email-service/get-started/route-emails/)).
- A Worker sends through the `send_email` binding. **On Free it can only send to verified destination addresses on the account**; arbitrary recipients need Paid ([Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [limits](https://developers.cloudflare.com/email-service/platform/limits/)).
- Paid includes 3,000 outbound emails/month, then $0.35 per 1,000 ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).
- `message.reply()` can answer an inbound sender once per message, on the same domain, if DMARC passes ([email handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/)).

| Need | Free plan + Email Routing |
|---|---|
| Password reset / email verification to customers | ❌ arbitrary recipients need Paid |
| Order confirmations to customers | ❌ on Free; ✅ on Paid with an onboarded sender domain |
| New-order alerts to the shop owner | ✅ the owner's address is a verified destination |
| `support@shop.com` inbox | ✅ forwards to the owner's Gmail (not a hosted mailbox) |

**Inference:** put email behind one `sendEmail()` function with two backends:
- **Cloudflare `send_email`:** owner alerts on Free; everything on Paid.
- **Resend over fetch:** customer emails on Free.
- The shop picks one based on which settings exist. On Paid, Cloudflare alone covers everything and Resend can be dropped.

### 13.2 Decided 2026-10-27: owner picks the email provider

**Where the choice is made:** in the first-run launch setup, and it can be changed later in **Shop settings → Email**. The options:
- **Cloudflare Email Sending:** needs Workers Paid and a sender domain onboarded in Email Service.
- **Resend:** API key plus sender address; integrated with the official `resend` SDK.
- **Skip for now:** no customer emails; Google sign-in is the customer recovery path.

**Design notes (Inference; verify in the spike):**
- **Storage:** the choice lives in D1 `settings`, so the UI can change it without a redeploy.
  - Any API key stored in D1 is encrypted with AES-GCM, keyed from a Worker secret.
  - The reason: a Worker can't set its own secrets without a Cloudflare API token.
- **One entry point:** `sendEmail()` reads the setting and dispatches to the `send_email` binding or to `resend.emails.send()`.
- **"Send test email" button** in both the setup and settings screens. It is the only reliable way to confirm the plan and domain are configured, because the app can't read the account's plan.
- **Seamless Resend setup:** the SDK's domains API (`domains.create` / `domains.verify`) can register the shop's domain from inside the app and show the DNS records to add. Resend can also add them automatically for Cloudflare domains ([Resend + Cloudflare](https://resend.com/docs/knowledge-base/cloudflare)). The domains API probably needs a full-access key rather than a sending-only key; check this.
- **Check in the spike:**
  - The `resend` SDK bundles and runs on Workers.
  - Declaring a `send_email` binding in `wrangler.jsonc` doesn't break deploys for shops that never set up Email Sending.

---

## 14. Not verified (gaps)

- **`.ph` / `.com.ph` on Cloudflare Registrar:** not on the TLD list. Confirm in the registration flow (§13).
- **Domain price:** the exact `.com` price isn't on any official Cloudflare page; it's shown at checkout.

- **Medium case study media:** the heuristic-evaluation table, wireframes and Figma prototype weren't captured in the PDF export (§9).
- **Auth:**
  - Better Auth's default scrypt settings and which code path the Workers build takes.
  - Real sign-up/sign-in CPU time on the Free plan.
  - The PBKDF2 iteration cap on Workers.
  - Whether Google accepts a `workers.dev` hostname for an OAuth client.
- **Email:** whether any free email provider works without the shop owner owning a domain.
- **Shopee PH Help Centre policy numbers** ([help.shopee.ph](https://help.shopee.ph/)): the pages render only with JavaScript and search returned nothing. That covers:
  - the unpaid auto-cancel timeout,
  - the auto-confirm-receipt window,
  - the Shopee Guarantee release timing,
  - the return window,
  - Coins and rating rules.
  
  Treat our "N minutes/days" values as configurable settings, not Shopee facts.
- **Payments:**
  - Xendit and Maya webhook signature schemes.
  - Fee amounts for any gateway.
- **Couriers:** public API availability for PH couriers.
- **Cloudflare:**
  - Whether the Deploy button prompts for secrets.
  - Whether image transformations work on `workers.dev` only.
- **Auth:** Better Auth's current Workers/D1 compatibility.
