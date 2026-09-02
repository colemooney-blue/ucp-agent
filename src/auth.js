import { TOKEN_ENDPOINT, requireEnv } from './config.js';

// Tokens expire after 60 minutes. Fetch at runtime rather than caching to disk,
// or a long-running agent starts failing an hour after boot.
export async function getAccessToken({ quiet = false } = {}) {
  const clientId = requireEnv('CLIENT_ID', 'Dev Dashboard -> Catalogs -> Get an API key.');
  const clientSecret = requireEnv('CLIENT_SECRET', 'Dev Dashboard -> Catalogs -> Get an API key.');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });

  if (!res.ok) {
    throw new Error(`Auth failed (HTTP ${res.status}): ${await res.text()}`);
  }

  const { access_token } = await res.json();
  if (!access_token) throw new Error('Auth response contained no access_token.');

  // The JWT payload tells you which tier and permissions you actually hold.
  // If the complete_checkout grant ever lands, it shows up here.
  const [, payload] = access_token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

  if (!quiet) {
    console.log('\n-- 1. Authentication ---------------------------\n');
    console.log(`   Scopes:  ${claims.scopes}`);
    console.log(`   Expires: ${new Date(claims.exp * 1000).toLocaleTimeString()}`);
    if (claims.limits) console.log(`   Limits:  ${JSON.stringify(claims.limits)}`);
  }

  return access_token;
}
