/**
 * Task 4 - Shop Pay identity-linked payment tokens (Path B).
 *
 * STATUS: SKELETON. Not runnable yet, and deliberately so - see README.
 * The exact Shop authorization/token endpoints are discovered at runtime from
 * the merchant's UCP profile payment_handlers config, and the Shop Wallet
 * authorization step needs a real signed-in buyer. Wire this only after
 * tasks 1-3 pass end to end.
 *
 * Two paths exist. Only Path B supports autonomy:
 *   Path A  One-time Payment Request. Single-use, checkout-scoped,
 *           time-limited. Buyer authorizes each transaction. NOT autonomous.
 *   Path B  Identity-Linked Payment Tokens. Multi-use instruments
 *           "authorized for the platform to use in autonomous checkouts."
 *           Time-limited, identity-scoped to your platform. <- this one.
 *
 * CORRECTION (verified 2026-09-02 against the UCP spec):
 * The functions below implement an RFC 8693 -> RFC 7523 chain against a
 * central Shop IdP. That is NOT the v1 identity-linking mechanism. UCP v1
 * (https://ucp.dev/2026-04-08/specification/identity-linking/) specifies
 * plain OAuth 2.0 Authorization Code + PKCE(S256) against EACH BUSINESS's own
 * authorization server, discovered at
 *   {business-domain}/.well-known/oauth-authorization-server
 * The delegated-IdP chaining these functions model is named in the spec as a
 * FUTURE extension (config.providers, e.g. com.shopify) and is explicitly not
 * in v1. Treat everything below as unverified until Shopify documents the
 * Shop Pay Path B enrollment path.
 *
 * Also verified: blueprint.bryanjohnson.com does NOT advertise
 * dev.ucp.common.identity_linking, so no scope gates checkout there - guest /
 * agent-authenticated checkout is permitted. Its OAuth AS
 * (https://shopify.com/authentication/77231292701) offers Customer Account API
 * scopes, not UCP scopes, and advertises only client_secret_basic /
 * client_secret_post - no 'none', so a public client cannot link against it.
 *
 * SHORTCUT WORTH TAKING: Shopify publishes a Shop skill for personal agents
 * that completes identity linking and UCP checkout for you:
 *   https://clawhub.ai/shopify/shop
 * If the goal is a personal shopping agent rather than a platform, start
 * there instead of hand-rolling any of this.
 *
 * Path A needs a separate client_id from registering with Shop Pay, and is
 * single-use per checkout. Not useful for autonomy.
 *
 * SECURITY: every function here needs the Dev Dashboard client secret and
 * MUST run server-side only. A public client (browser, mobile) cannot
 * complete this flow safely - the secret is recoverable from shipped source
 * and network traffic. All exchanges over TLS 1.2+.
 */

import { requireEnv } from './config.js';

const SHOP_IDP_ORIGIN = 'https://accounts.shop.app';

/** Step 1: discover Shop's OAuth endpoints from its authorization server metadata. */
export async function discoverShopEndpoints() {
  const res = await fetch(`${SHOP_IDP_ORIGIN}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`Shop OAuth discovery failed: HTTP ${res.status}`);
  const meta = await res.json();
  return { authorizationEndpoint: meta.authorization_endpoint, tokenEndpoint: meta.token_endpoint };
}

/**
 * Step 2: standard OAuth authorization code flow against Shop, to get a Shop
 * access token for the signed-in customer. Needs a browser redirect, so the
 * redirect URI must be registered on your Dev Dashboard client.
 * Localhost is fine in development.
 */
export function buildShopAuthorizeUrl({ authorizationEndpoint, redirectUri, state, scope }) {
  const u = new URL(authorizationEndpoint);
  u.searchParams.set('client_id', requireEnv('CLIENT_ID', 'See .env.example.'));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  if (scope) u.searchParams.set('scope', scope);
  return u.toString();
}

/**
 * Step 3: exchange the Shop access token for a JWT authorization grant.
 * RFC 8693 token exchange, against Shop's token endpoint.
 */
export async function exchangeForGrant({ tokenEndpoint, shopAccessToken, audience }) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: shopAccessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    audience,
    client_id: requireEnv('CLIENT_ID', 'See .env.example.'),
    client_secret: requireEnv('CLIENT_SECRET', 'See .env.example.')
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Token exchange failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * Step 4: redeem the grant for a buyer-linked token.
 * RFC 7523 jwt-bearer, against Shopify's token endpoint.
 */
export async function redeemForBuyerLinkedToken({ shopifyTokenEndpoint, grant, scope }) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: grant,
    scope: scope ?? 'dev.ucp.shopping.catalog.search:read',
    client_id: requireEnv('CLIENT_ID', 'See .env.example.'),
    client_secret: requireEnv('CLIENT_SECRET', 'See .env.example.')
  });

  const res = await fetch(shopifyTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Buyer-linked token redemption failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

/**
 * Wrap a Shop Token as a UCP payment instrument for complete_checkout.
 * This is the shape that goes in as `checkout.payment`.
 */
export function toShopPayInstrument(shopToken, { id = 'instr_shop_pay_1' } = {}) {
  return {
    id,
    handler_id: 'shop_pay',
    type: 'shop_pay',
    selected: true,
    credential: { type: 'shop_token', token: shopToken }
  };
}

/** Confirm the merchant actually advertises Shop Pay before trying to use it. */
export function findShopPayHandler(checkout) {
  return checkout?.ucp?.payment_handlers?.['dev.shopify.shop_pay']?.[0] ?? null;
}

/**
 * Path B tokens carry a SPEND LIMIT, surfaced on instrument.display. This is
 * the real consent boundary for an autonomous agent - check it before
 * completing, or the agent discovers the ceiling by failing a purchase.
 *
 *   display.limit            spending limit this period (minor units)
 *   display.remaining_amount what is left (minor units)
 *   display.renewal_type     'monthly' is the only supported value today
 *   display.renews_at        ISO 8601, when the limit resets
 *
 * Returns { ok, reason, remaining, limit, renewsAt }. No display block means
 * no limit is set, which is allowed - treat as unlimited, not as zero.
 */
export function checkSpendLimit(instrument, amountMinorUnits) {
  const d = instrument?.display;
  if (!d || d.remaining_amount == null) {
    return { ok: true, reason: 'no_limit_set', remaining: null, limit: null, renewsAt: null };
  }
  const ok = amountMinorUnits <= d.remaining_amount;
  return {
    ok,
    reason: ok ? 'within_limit' : 'exceeds_remaining',
    remaining: d.remaining_amount,
    limit: d.limit ?? null,
    renewsAt: d.renews_at ?? null
  };
}
