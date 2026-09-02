import { AGENT_PROFILE, MCP_PROTOCOL_VERSION } from './config.js';

// UCP merchants publish a business profile at /.well-known/ucp on their
// storefront origin. Read it to confirm capability support before calling.
const endpointCache = new Map();

export async function getMcpEndpoint(merchantOrigin) {
  if (endpointCache.has(merchantOrigin)) return endpointCache.get(merchantOrigin);

  let endpoint = `${merchantOrigin}/api/ucp/mcp`; // documented fallback
  try {
    const res = await fetch(`${merchantOrigin}/.well-known/ucp`);
    if (res.ok) {
      const ucp = await res.json();
      const shopping = ucp?.ucp?.services?.['dev.ucp.shopping'];
      const mcp = Array.isArray(shopping) && shopping.find(s => s.transport === 'mcp');
      if (mcp?.endpoint) endpoint = mcp.endpoint;
    }
  } catch (_) { /* fall through to the documented default */ }

  endpointCache.set(merchantOrigin, endpoint);
  return endpoint;
}

export async function getMerchantCapabilities(merchantOrigin) {
  const res = await fetch(`${merchantOrigin}/.well-known/ucp`);
  if (!res.ok) return null;
  return (await res.json())?.ucp?.capabilities ?? null;
}

let rpcId = 0;

// One JSON-RPC caller for every MCP tool. Handles the meta envelope, the
// structuredContent/content duality, and Retry-After backoff.
export async function callTool(endpoint, name, args, { token, idempotent = false, attempt = 0 } = {}) {
  const meta = { 'ucp-agent': { profile: AGENT_PROFILE } };
  if (idempotent) meta['idempotency-key'] = crypto.randomUUID();

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: ++rpcId,
      params: { name, arguments: { ...args, meta } }
    })
  });

  // Checkout MCP throttles harder than Cart at every tier.
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** attempt;
    const jitter = Math.random() * 250;
    await new Promise(r => setTimeout(r, retryAfter * 1000 + jitter));
    return callTool(endpoint, name, args, { token, idempotent, attempt: attempt + 1 });
  }

  const data = await res.json();
  if (data?.result?.content?.[0]?.text && typeof data.result.content[0].text === 'string') {
    try { data.result.content[0].text = JSON.parse(data.result.content[0].text); } catch (_) {}
  }
  // JSON-RPC errors come back inside an HTTP 200. Surface them legibly.
  if (data.error) {
    const detail = typeof data.error.data === 'string' ? data.error.data : JSON.stringify(data.error.data ?? {});
    const hint = /Tool not found/i.test(detail) && !token
      ? ' (calling this tool needs a Bearer token - tools/list is open, tools/call is not)'
      : '';
    throw new Error(`${name}: ${data.error.message} - ${detail}${hint}`);
  }
  if (!data.result) throw new Error(`${name} failed: ${JSON.stringify(data)}`);

  return data.result.structuredContent ?? data.result.content?.[0]?.text;
}

// Messages carry severity (the recovery path) and path (a JSONPath pointer).
// "unrecoverable" means stop - no amount of update_* will fix it.
export function classifyMessages(messages = []) {
  return {
    unrecoverable: messages.filter(m => m.severity === 'unrecoverable'),
    needsBuyer: messages.filter(m => String(m.severity ?? '').startsWith('requires_buyer')),
    all: messages
  };
}
