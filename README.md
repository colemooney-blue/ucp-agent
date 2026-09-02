# ucp-agent

Shopify UCP agentic commerce agent: catalog discovery -> cart -> checkout -> handoff.
Built from the six-task runbook. Endpoints verified against shopify.dev on 2026-09-02.

## Status

| Task | What | State |
|---|---|---|
| 1 | Credentials + runtime bearer tokens | Code done. **Needs your client ID/secret.** |
| 2 | UCP profile | Code done. Runs on Shopify's fixture, no hosting needed. |
| 3 | Catalog -> cart -> checkout | Code done. **Needs the catalog endpoint.** |
| 4 | Shop Pay Path B token | Skeleton only. Blocked on task 1, then a real buyer. |
| 5 | `complete_checkout` grant | Draft request in `docs/grant-request.md`. **Yours to send.** |
| 6 | Escalation branch | Done, and wired into `completeCheckout`. |

`npm run demo` works end to end once tasks 1 and 3 are unblocked. It exits through
the escalation branch, which is correct behaviour for an agent without the grant.

## What you have to do (3 things, ~15 minutes)

Everything else is built. These need a browser logged into Shopify, so I could not
do them for you.

### 1. Get API credentials

1. Open https://dev.shopify.com/dashboard
2. Click **Catalogs** in the sidebar
3. Click **Get an API key**, name it, click **Create**
4. Copy the client ID and secret

### 2. Get the catalog endpoint and ID

These are **two different values** and conflating them is the easy mistake.

- **`CATALOG_ENDPOINT`** — the URL you POST to (Global Catalog MCP). Shared
  across all your catalogs, *not* per-catalog. Get the exact value from
  Dev Dashboard -> **Catalogs** -> **Search preview** -> **cURL** tab.
- **`CATALOG_ID`** — which saved catalog to scope results to. Visible in
  **Search preview -> Request -> JSON** as `catalog.catalog_id`. Already
  prefilled in `.env.example` as `01m12pshmzvsegrbkee7xjksbv`. Optional —
  leave it blank to search all of Shopify unscoped.

You do not choose or invent either one. The catalog's *name*
(e.g. `catalog-2026-08-27`) is auto-generated, cosmetic, and used by nothing.

### 3. Fill in .env

```bash
cp .env.example .env
```

Then edit `.env` and paste in `CLIENT_ID`, `CLIENT_SECRET`, and
`CATALOG_ENDPOINT`. `.env` is gitignored. Do not paste secrets into a chat,
including to me.

Verify:

```bash
node smoke.js          # no credentials needed, checks the plumbing
npm run auth           # confirms your credentials and prints your granted scopes
npm run demo           # full walk
```

`npm run auth` printing a `scopes` claim is your proof task 1 works. That claim is
also where the `complete_checkout` permission would appear if the grant ever lands.

## Layout

```
src/config.js     Endpoints, profile URL, attribution helper
src/auth.js       Task 1 - client_credentials -> bearer token (60 min TTL)
src/mcp.js        JSON-RPC caller, endpoint discovery, Retry-After backoff
src/search.js     Task 3a - search_catalog / get_product / lookup_catalog
src/cart.js       Task 3c - Cart MCP (unauthenticated, iterate here)
src/checkout.js   Task 3d + task 6 - Checkout MCP and the escalation branch
src/shoppay.js    Task 4 - Shop Pay Path B skeleton (server-side only)
src/demo.js       End-to-end walk
smoke.js          6 checks, no credentials required
ucp-profile.json  Your own profile, for when you stop using the fixture
docs/grant-request.md  Draft ask for the completion grant
```

## Hosting your own profile: GitHub Pages does NOT work

Shopify validates the `Cache-Control` header on your profile and rejects
anything without an explicit cacheability directive:

    profile_malformed - Unable to fetch agent profile: Invalid cache control

GitHub Pages sends `cache-control: max-age=600` with no `public`, and Pages
gives you no way to set headers. Shopify's own fixtures send
`public, max-age=3600, stale-while-revalidate=7200`.

**Working host: jsDelivr**, which serves straight from this repo with
`public, max-age=604800, s-maxage=43200` and needs no account or config:

    https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/ucp-profile.json

Verified accepted by Shopify. Any host where you control response headers
also works (Cloudflare Pages `_headers`, Netlify `_headers`, Vercel
`vercel.json`, S3 + CloudFront metadata).

Caveat: jsDelivr caches `@main` for up to 7 days. Editing `ucp-profile.json`
will not take effect promptly. Pin a commit SHA instead of `@main` when you
need a change live immediately, and update the URL when you change the file.

## Going from fixture to your own profile

Default profile is Shopify's hosted fixture, so nothing needs hosting to start:

```
https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/cart-and-checkout.json
```

When you want to identify as yourself, publish `ucp-profile.json` at a public
HTTPS URL and set `AGENT_PROFILE` in `.env`. A static object is enough - S3,
Cloudflare Pages, a gist. There is no runtime. **`localhost` will not work**,
because Shopify fetches, validates, negotiates and caches this document itself.

Shopify also hosts deliberately broken fixtures for testing your negotiation
failure handling. Swap `AGENT_PROFILE` to any of these and confirm you degrade
gracefully rather than crashing:

```
https://shopify.dev/ucp/agent-profiles/2026-08-25/empty-capabilities.json
https://shopify.dev/ucp/agent-profiles/2026-08-25/missing-ucp-version.json
https://shopify.dev/ucp/agent-profiles/2026-08-25/unsupported-ucp-version.json
https://shopify.dev/ucp/agent-profiles/2026-08-25/capability-version-mismatch.json
https://shopify.dev/ucp/agent-profiles/2026-08-25/too-large.json
https://shopify.dev/ucp/agent-profiles/2026-08-25/malformed.json
```

## Things that will bite you

- **Catalog results may not be cached**, and product images may not be downloaded
  to your servers. They must render in real time from merchant URLs.
- **Cart MCP is unauthenticated and cheap; Checkout MCP is neither.** Iterate on
  the cart. Only create a checkout when the buyer has committed.
- **"Tool not found" means a missing *capability*, not a missing tool.** If a
  tool shows up in `tools/list` but `tools/call` returns
  `Invalid params - Tool not found: <tool>`, your agent profile does not
  declare the capability that tool belongs to. Negotiation silently drops it.
  Cost us three wrong diagnoses: the `examples/.../cart-and-checkout.json`
  fixture declares only cart and checkout, so `search_catalog` was never
  negotiated. Catalog tools are genuinely keyless, as documented - verified
  working with no token once the profile declared
  `dev.ucp.shopping.catalog.search`.
- **`update_checkout` replaces the fields you send.** `updateCheckout()` echoes
  current state back for you; do not hand-roll a partial update.
- **Tokens die after 60 minutes.** Never cache one to disk.
- **Escalation is permanent.** No grant, tier, or config removes the
  `requires_escalation` branch. An unattended agent still needs a way to get a
  URL in front of a human.
- **Totals are in minor units.** `8900` is $89.00.
- **Money shape differs by catalog.** Global Catalog nests it as
  `{ amount, currency }`; Storefront Catalog returns a bare integer.
  `priceOf()` in `src/search.js` handles both so a swap doesn't print `$NaN`.

## ucp-cli 0.7.0 cannot reach 2026-08-25 merchants

Verified 2026-09-02. The CLI negotiates against a hardcoded agent range of
`[2026-01-23..2026-04-08]`. Both failure modes:

    PROTOCOL_VERSION_INCOMPATIBLE - no business dev.ucp.shopping entry within
      agent range [2026-01-23..2026-04-08]; business offered 2026-08-25
    NO_COMPATIBLE_TRANSPORT - acceptable: [mcp]; business: [embedded]

The second happens with blueprint.bryanjohnson.com, which offers 2026-08-25
over `mcp` and 2026-04-08 over `embedded` - the CLI drops to 04-08 and cannot
speak that transport.

`ucp profile init --protocol-min/--protocol-max` does NOT fix it. Those flags
write `protocol_versions` into `~/.ucp/profiles/<name>/meta.json`, but
negotiation ignores that file. Overwriting `profile.json` in the same
directory does not work either - the range is in the binary. 0.7.0 is the
latest published version, so there is nothing to upgrade to.

Consequence: the `ucp` MCP server (and therefore conversational shopping
through it) currently fails against catalog.shopify.com and Blueprint. The
code in this repo is unaffected - it speaks 2026-08-25 directly.

Worth filing at https://github.com/Shopify/ucp-cli/issues.

## Bearer token for the CLI

Checkout through the CLI needs the Dev Dashboard token ("Catalog JWT" in the
CLI's README). Wired up without storing a secret:

    ~/.ucp/profiles/blueprint-agent/headers.json
      { "default": { "Authorization": "Bearer ${UCP_TOKEN}" } }

    export UCP_TOKEN=$(npm run -s token)   # fresh 60-minute token

`${ENV_VAR}` interpolation keeps the file secret-free. Re-export hourly.

Note: `AUTH_REQUIRED` and `INSUFFICIENT_PERMISSIONS` deliberately do NOT fire
the escalation hook - they return structured error CTAs instead. That is how
you will detect a missing complete_checkout grant, rather than by the
escalation path.

## Cross-check with the official CLI

```bash
ucp cart create --business https://{shop}.example.com \
  --set /line_items/0/item/id='<VARIANT_ID>' --set /line_items/0/quantity=1
```

Useful for confirming whether a failure is your code or the merchant.
