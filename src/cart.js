import { getMcpEndpoint, callTool } from './mcp.js';
import { withAttribution } from './config.js';

// Cart MCP accepts UNAUTHENTICATED requests. Do all iteration here - line items,
// localization, total estimates across turns. Long TTL, looser rate limits.
// Only move to Checkout MCP when the buyer is actually ready to buy.

const totalOf = c => c?.totals?.find(t => t.type === 'total')?.amount ?? 0;

export async function createCart(merchantOrigin, lineItems, context) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  const cart = { line_items: lineItems };
  if (context) cart.context = context;

  const result = await callTool(endpoint, 'create_cart', { cart });
  const c = result.cart ?? result;

  console.log('\n-- Create Cart --------------------------------\n');
  console.log(`   Cart ID: ${c.id}`);
  console.log(`   Total:   $${(totalOf(c) / 100).toFixed(2)}`);
  if (c.continue_url) console.log(`   Share:   ${withAttribution(c.continue_url)}`);
  return c;
}

export async function getCart(merchantOrigin, cartId) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  const result = await callTool(endpoint, 'get_cart', { id: cartId });
  return result.cart ?? result;
}

// PUT semantics - this REPLACES cart contents, it does not merge.
export async function updateCart(merchantOrigin, cartId, cart) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  const result = await callTool(endpoint, 'update_cart', { id: cartId, cart });
  return result.cart ?? result;
}

export async function cancelCart(merchantOrigin, cartId) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  return callTool(endpoint, 'cancel_cart', { id: cartId }, { idempotent: true });
}
