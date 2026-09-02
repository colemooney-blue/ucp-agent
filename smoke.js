// Smallest thing that fails if the plumbing breaks. No credentials needed.
// Run: node smoke.js
import assert from 'node:assert/strict';
import { getMcpEndpoint, classifyMessages } from './src/mcp.js';
import { AGENT_PROFILE, withAttribution } from './src/config.js';
import { toShopPayInstrument, checkSpendLimit } from './src/shoppay.js';
import { priceOf, sellerOriginOf } from './src/search.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('fixture profile is reachable and negotiable', async () => {
  const res = await fetch(AGENT_PROFILE);
  assert.equal(res.status, 200, `profile returned HTTP ${res.status}`);
  const p = await res.json();
  assert.ok(p.ucp.version, 'profile has no ucp.version');
  // Every capability we call tools from must be declared, or negotiation
  // drops the tool and the server says "Tool not found".
  for (const cap of ['dev.ucp.shopping.cart', 'dev.ucp.shopping.checkout',
                     'dev.ucp.shopping.catalog.search', 'dev.ucp.shopping.catalog.lookup']) {
    assert.ok(p.ucp.capabilities[cap], `default profile lacks ${cap}`);
  }
});

check('our own profile declares the same capabilities', async () => {
  const p = JSON.parse(await (await import('node:fs/promises')).readFile('./ucp-profile.json', 'utf8'));
  for (const cap of ['dev.ucp.shopping.cart', 'dev.ucp.shopping.checkout',
                     'dev.ucp.shopping.catalog.search', 'dev.ucp.shopping.catalog.lookup']) {
    assert.ok(p.ucp.capabilities[cap], `ucp-profile.json lacks ${cap}`);
  }
});

check('endpoint discovery falls back when /.well-known/ucp is absent', async () => {
  const ep = await getMcpEndpoint('https://example.invalid');
  assert.equal(ep, 'https://example.invalid/api/ucp/mcp');
});

check('attribution params survive existing query strings', () => {
  const out = withAttribution('https://shop.example.com/cart/c/abc?key=xyz');
  assert.ok(out.includes('key=xyz'), 'dropped the checkout key');
  assert.ok(out.includes('utm_source=ucp_agent'), 'did not add attribution');
});

check('unrecoverable messages are separated from buyer-input ones', () => {
  const { unrecoverable, needsBuyer } = classifyMessages([
    { severity: 'unrecoverable', code: 'item_unavailable' },
    { severity: 'requires_buyer_input' },
    { severity: 'requires_buyer_review' }
  ]);
  assert.equal(unrecoverable.length, 1);
  assert.equal(needsBuyer.length, 2);
});

check('shop pay instrument matches the documented shape', () => {
  const i = toShopPayInstrument('shop_abc123');
  assert.equal(i.handler_id, 'shop_pay');
  assert.equal(i.type, 'shop_pay');
  assert.equal(i.credential.type, 'shop_token');
  assert.equal(i.credential.token, 'shop_abc123');
});

check('priceOf reads both Global and Storefront money shapes', () => {
  assert.equal(priceOf({ price: { amount: 8999, currency: 'USD' } }), 8999, 'Global shape');
  assert.equal(priceOf({ price: 8900 }), 8900, 'Storefront shape');
  assert.equal(priceOf({ price_range: { min: { amount: 7200 } } }), 7200, 'price_range fallback');
  assert.equal(priceOf(undefined), undefined, 'missing variant must not throw');
});

check('seller origin is derived from the catalog response', () => {
  assert.equal(
    sellerOriginOf({ variants: [{ seller: { url: 'https://ex.myshopify.com/collections/x' } }] }),
    'https://ex.myshopify.com', 'should strip path from seller.url');
  assert.equal(
    sellerOriginOf({ variants: [{ seller: { domain: 'ex.myshopify.com' } }] }),
    'https://ex.myshopify.com', 'should build origin from seller.domain');
  assert.equal(sellerOriginOf({ variants: [{}] }), null, 'no seller must return null, not throw');
});

check('spend limit gates a purchase before it is attempted', () => {
  const withLimit = { display: { remaining_amount: 40136, limit: 80272, renewal_type: 'monthly' } };
  assert.equal(checkSpendLimit(withLimit, 8400).ok, true, '$84 under $401 remaining');
  assert.equal(checkSpendLimit(withLimit, 50000).ok, false, '$500 over $401 remaining');
  assert.equal(checkSpendLimit(withLimit, 40136).ok, true, 'exactly at remaining is allowed');
  // No display block means no limit configured - must not read as zero.
  assert.equal(checkSpendLimit({}, 999999).ok, true, 'absent limit must not block');
});

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
console.log(failed ? `\n${failed} check(s) failed.\n` : `\nAll ${checks.length} checks passed.\n`);
process.exitCode = failed ? 1 : 0;
