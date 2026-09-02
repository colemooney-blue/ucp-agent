// End-to-end walk: auth -> catalog -> cart -> checkout -> handoff.
// Runs today with zero hosting, using Shopify's fixture profile.
// Completion (task 4 payment + task 5 grant) is stubbed with payment: null,
// so this exits through the escalation branch - which is the correct
// behaviour for an agent without the grant.

import { getAccessToken } from './auth.js';
import { searchCatalog, displayProducts, variantOf, sellerOriginOf } from './search.js';
import { createCart, cancelCart } from './cart.js';
import { createCheckout, updateCheckout, completeCheckout, cancelCheckout } from './checkout.js';
import { getMerchantCapabilities } from './mcp.js';
import { AGENT_PROFILE, MERCHANT_ORIGIN } from './config.js';
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => rl.question(q);

async function main() {
  console.log(`\n   Profile: ${AGENT_PROFILE}\n`);

  // 1. Authentication
  const token = await getAccessToken();

  // 2. Discovery
  const query = await ask('\n   What are you looking for? > ');
  const result = await searchCatalog(token, query);
  const products = result?.products ?? [];
  if (!products.length) return console.log('\n   No results.\n');
  displayProducts(products);

  const pick = Number(await ask('\n   Pick a result [number] > '));
  const chosen = products[pick - 1];
  if (!chosen) return console.log('\n   Invalid selection.\n');

  const variantId = variantOf(chosen)?.id ?? chosen.id;
  console.log(`\n   Selected: ${chosen.title} (${variantId})`);

  // 3. Cart - unauthenticated, iterate freely here.
  // Merchant origin comes from the picked product's seller. MERCHANT_ORIGIN
  // is only an override for testing one specific store.
  const origin = sellerOriginOf(chosen) || MERCHANT_ORIGIN;
  if (!origin) throw new Error('No seller on the selected product, and MERCHANT_ORIGIN is unset.');
  console.log(`   Merchant: ${origin}`);
  const caps = await getMerchantCapabilities(origin);
  console.log(`\n   Merchant capabilities: ${caps ? Object.keys(caps).join(', ') : 'no /.well-known/ucp'}`);

  const cart = await createCart(origin, [{ quantity: 1, item: { id: variantId } }]);

  // 4. Checkout - only now that the buyer has committed
  let checkout = await createCheckout(token, origin, cart.id);

  const email = await ask('\n   Buyer email > ');
  checkout = await updateCheckout(token, origin, checkout.id, { buyer: { email } });

  // 5. Completion attempt -> escalation branch (payment intentionally null)
  const outcome = await completeCheckout(token, origin, checkout.id, null);

  if (outcome.escalated) {
    console.log('\n-- Escalated (expected without the grant) -----\n');
    console.log(`   Reason: ${outcome.reason ?? 'unrecoverable messages'}`);
    console.log(`   Finish here: ${outcome.url}\n`);
  } else {
    console.log(`\n   Order placed: ${outcome.order?.id}\n`);
  }

  // Keep tutorial state clean. In production, only cancel on real abandonment.
  const cleanup = await ask('   Cancel this checkout and exit? [y/N] > ');
  if (cleanup.toLowerCase() === 'y') {
    await cancelCheckout(token, origin, checkout.id);
    await cancelCart(origin, cart.id).catch(() => {});
    console.log('\n   Cancelled.\n');
  }
}

main()
  .catch(err => { console.error('\n   Request failed:', err.message, '\n'); process.exitCode = 1; })
  .finally(() => rl.close());
