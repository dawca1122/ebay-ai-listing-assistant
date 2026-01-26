import { 
  loadStoredTokens, 
  saveStoredTokens, 
  getRedirectUri, 
  EBAY_AUTH_URL, 
  EBAY_SCOPES,
  jsonResponse 
} from '../_utils.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const { clientId, clientSecret } = body;

    if (!clientId || !clientSecret) {
      return jsonResponse({ error: 'Brak Client ID lub Client Secret' }, 400);
    }

    const redirectUri = getRedirectUri(req);

    // Save credentials before redirect
    saveStoredTokens({
      pendingClientId: clientId.trim(),
      pendingClientSecret: clientSecret.trim()
    });

    // Build authorization URL
    const scopeString = EBAY_SCOPES.map(s => encodeURIComponent(s)).join('%20');
    const state = Date.now().toString();

    const authUrl = `${EBAY_AUTH_URL}?` +
      `client_id=${encodeURIComponent(clientId.trim())}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scopeString}` +
      `&state=${state}`;

    console.log('🔗 OAuth Auth URL generated');
    console.log(`   Redirect URI: ${redirectUri}`);
    console.log(`   Scopes: ${EBAY_SCOPES.length}`);

    return jsonResponse({
      authUrl,
      redirectUri,
      scopes: EBAY_SCOPES,
      message: `WAŻNE: Upewnij się że w eBay Developer Portal masz dodany Redirect URI: ${redirectUri}`
    });

  } catch (error) {
    console.error('Auth URL error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}
