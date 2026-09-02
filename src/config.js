// Central config. Endpoints verified against shopify.dev 2026-09-02.
// Shopify notes API URLs are subject to change - re-check if auth starts 404ing.

export const TOKEN_ENDPOINT = 'https://api.shopify.com/auth/access_token';

// Sent on every MCP request. Dev Dashboard's own preview sends this; without
// it a server may fall back to a different protocol version than you expect.
export const MCP_PROTOCOL_VERSION = '2026-03-26';

// Your agent's UCP profile. Shopify fetches, validates, negotiates and caches
// this, so it must be publicly reachable - localhost will not work.
// Default is Shopify's own hosted fixture, so you can run the entire flow
// without hosting anything. Swap to your own once you publish ucp-profile.json.
//
// MUST declare every capability whose tools you intend to call. Negotiation
// drops undeclared tools, and the server reports that as
// "Invalid params - Tool not found: <tool>", which reads like a missing tool
// but means a missing capability. The cart-and-checkout fixture omits catalog
// and will break search_catalog for exactly this reason.
export const AGENT_PROFILE =
  process.env.AGENT_PROFILE ||
  'https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json';

// The catalog is addressed by TWO separate things, which is easy to conflate:
//   CATALOG_ENDPOINT - the URL you POST to (Global Catalog MCP). Shared.
//   CATALOG_ID       - which saved catalog to scope the search to. Yours.
// The Dev Dashboard "Search preview -> cURL" tab shows the exact endpoint.
// catalog_id is optional: omit it to search all of Shopify unscoped.
export const CATALOG_ENDPOINT =
  process.env.CATALOG_ENDPOINT || 'https://catalog.shopify.com/api/ucp/mcp';
export const CATALOG_ID = process.env.CATALOG_ID;
export const MERCHANT_ORIGIN = process.env.MERCHANT_ORIGIN;

// Attribution so merchants can see which sales your agent influenced.
export const ATTRIBUTION = { utm_source: 'ucp_agent', utm_medium: 'agent' };

export function withAttribution(url) {
  if (!url) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(ATTRIBUTION)) u.searchParams.set(k, v);
  return u.toString();
}

export function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment. ${hint}`);
  return v;
}
