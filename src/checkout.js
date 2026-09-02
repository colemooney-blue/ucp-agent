import { getMcpEndpoint, callTool, classifyMessages } from './mcp.js';
import { withAttribution } from './config.js';

// Checkout MCP requires auth and is rate-limited harder than Cart at every tier.
// Checkouts are short-lived with strict freshness guarantees - re-fetch before acting.

const totalOf = c => c?.totals?.find(t => t.type === 'total')?.amount ?? 0;

export async function createCheckout(token, merchantOrigin, cartId) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  const checkout = await callTool(endpoint, 'create_checkout', { cart_id: cartId }, { token });

  console.log('\n-- Create Checkout ----------------------------\n');
  console.log(`   ID:     ${checkout.id}`);
  console.log(`   Status: ${checkout.status}`);
  console.log(`   Total:  $${(totalOf(checkout) / 100).toFixed(2)}`);
  return checkout;
}

export async function getCheckout(token, merchantOrigin, checkoutId) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  return callTool(endpoint, 'get_checkout', { id: checkoutId }, { token });
}

// update_checkout replaces the fields you send, so echo current state back.
export async function updateCheckout(token, merchantOrigin, checkoutId, patch) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  const current = await getCheckout(token, merchantOrigin, checkoutId);

  const checkout = {
    currency: current.currency,
    context: current.context,
    line_items: (current.line_items ?? []).map(li => ({
      quantity: li.quantity,
      item: { id: li.item.id }
    })),
    buyer: { ...(current.buyer ?? {}), ...(patch.buyer ?? {}) },
    ...patch.checkout
  };

  const updated = await callTool(endpoint, 'update_checkout', { id: checkoutId, checkout }, { token });
  console.log(`\n-- Update Checkout ----------------------------\n\n   Status: ${updated.status}`);
  return updated;
}

export async function cancelCheckout(token, merchantOrigin, checkoutId) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  return callTool(endpoint, 'cancel_checkout', { id: checkoutId }, { token, idempotent: true });
}

/**
 * Task 6 - the escalation branch.
 *
 * There is NO state in which autonomous completion is guaranteed. A fully
 * eligible, fully granted agent still gets requires_escalation for 3DS
 * challenges, channel opt-in, and other interactive review. This branch is
 * permanent. Treat escalation as a normal outcome with its own success
 * metric, not as a failure, or your dashboards will lie to you.
 *
 * @param payment - UCP payment instrument. Null until the Shop Pay Path B
 *                  token exists AND the complete_checkout grant has landed.
 * @returns { escalated, url } | { escalated: false, order }
 */
export async function completeCheckout(token, merchantOrigin, checkoutId, payment) {
  const endpoint = await getMcpEndpoint(merchantOrigin);
  const current = await getCheckout(token, merchantOrigin, checkoutId);
  const { unrecoverable } = classifyMessages(current.messages);

  if (unrecoverable.length) {
    return { escalated: true, unrecoverable, url: withAttribution(current.continue_url) };
  }

  if (current.status !== 'ready_for_complete') {
    console.log(`\n   Checkout is ${current.status}. Handing off to the buyer.`);
    return { escalated: true, reason: current.status, url: withAttribution(current.continue_url) };
  }

  if (!payment) {
    console.log('\n   ready_for_complete, but no payment instrument. Handing off.');
    return { escalated: true, reason: 'no_payment_instrument', url: withAttribution(current.continue_url) };
  }

  // idempotency-key is REQUIRED here. It is what makes a retry safe
  // rather than a double charge. callTool adds it via idempotent: true.
  const checkout = await callTool(
    endpoint, 'complete_checkout',
    { id: checkoutId, checkout: { payment } },
    { token, idempotent: true }
  );

  console.log('\n-- Complete Checkout --------------------------\n');
  console.log(`   Status: ${checkout.status}`);
  if (checkout.order) console.log(`   Order:  ${checkout.order.id}`);
  return { escalated: false, order: checkout.order, checkout };
}
