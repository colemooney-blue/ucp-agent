import { CATALOG_ENDPOINT, CATALOG_ID, requireEnv } from './config.js';
import { callTool } from './mcp.js';

// Catalog rules that will bite you:
//  - You may NOT cache search results (live merchant pricing/availability).
//  - You may NOT download product images to your servers; render in real time.
//
// Addressing: you POST to the Global Catalog MCP endpoint and pass catalog_id
// in the body to scope results to one of your saved catalogs. The endpoint is
// NOT per-catalog. Omit catalog_id to search all of Shopify unscoped.

function endpoint() {
  return CATALOG_ENDPOINT || requireEnv('CATALOG_ENDPOINT',
    'Dev Dashboard -> Catalogs -> Search preview -> cURL tab shows the URL.');
}

// catalog_id is only sent when set, so an unscoped search still works.
const scoped = (obj) => (CATALOG_ID ? { ...obj, catalog_id: CATALOG_ID } : obj);

export async function searchCatalog(token, query, opts = {}) {
  const { filters = { available: true }, context, pagination = { limit: 10 } } = opts;
  const catalog = scoped({ query, filters, pagination });
  if (context) catalog.context = context;
  return callTool(endpoint(), 'search_catalog', { catalog }, { token });
}

export async function getProduct(token, id, selected = [], context) {
  const catalog = scoped({ id, selected });
  if (context) catalog.context = context;
  return callTool(endpoint(), 'get_product', { catalog }, { token });
}

export async function lookupCatalog(token, ids, context = { address_country: 'US' }) {
  return callTool(endpoint(), 'lookup_catalog', { catalog: scoped({ ids, context }) }, { token });
}

// Global Catalog nests money as { amount, currency }; Storefront Catalog returns
// a bare integer. Handle both so a swap does not silently print $NaN.
export function priceOf(v) {
  const p = v?.price ?? v?.price_range?.min;
  return typeof p === 'object' ? p?.amount : p;
}

export function variantOf(product) {
  return product?.variants?.[0];
}

// Global Catalog returns the seller on each variant. Derive the merchant
// origin from the product the buyer actually picked rather than hardcoding a
// store - a cross-merchant agent has no single MERCHANT_ORIGIN anyway.
export function sellerOriginOf(product) {
  const seller = variantOf(product)?.seller ?? product?.seller;
  if (!seller) return null;
  if (seller.url) return new URL(seller.url).origin;
  if (seller.domain) return `https://${seller.domain}`;
  return null;
}

export function displayProducts(products = []) {
  console.log('\n-- Results ------------------------------------\n');
  products.forEach((p, i) => {
    const amount = priceOf(variantOf(p)) ?? priceOf(p);
    const price = typeof amount === 'number' ? ` | $${(amount / 100).toFixed(2)}` : '';
    const seller = variantOf(p)?.seller?.name;
    console.log(`  [${i + 1}] ${p.title}${price}${seller ? ` | ${seller}` : ''}`);
  });
}
