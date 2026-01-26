// ============================================
// CONFIGURATION
// ============================================
const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
];

// In-memory storage (resets on cold start - for production use Vercel KV)
let tokenStorage = {
  refreshToken: null,
  clientId: null,
  clientSecret: null,
  connectedAt: null,
  connected: false,
  pendingClientId: null,
  pendingClientSecret: null,
  error: null
};

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
  forClientId: null
};

function loadStoredTokens() {
  if (!tokenStorage.refreshToken && process.env.EBAY_REFRESH_TOKEN) {
    tokenStorage = {
      refreshToken: process.env.EBAY_REFRESH_TOKEN,
      clientId: process.env.EBAY_CLIENT_ID,
      clientSecret: process.env.EBAY_CLIENT_SECRET,
      connectedAt: process.env.EBAY_CONNECTED_AT || null,
      connected: true,
      error: null
    };
  }
  return tokenStorage;
}

function saveStoredTokens(data) {
  tokenStorage = { ...tokenStorage, ...data };
  console.log('💾 Token storage updated:', {
    connected: tokenStorage.connected,
    hasRefreshToken: !!tokenStorage.refreshToken
  });
  return tokenStorage;
}

function getRedirectUri(req) {
  const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/ebay/callback`;
}

async function refreshAccessToken() {
  const stored = loadStoredTokens();
  
  if (!stored.refreshToken || !stored.clientId || !stored.clientSecret) {
    throw new Error('Brak połączenia z eBay. Kliknij "Połącz z eBay (OAuth)".');
  }
  
  const authHeader = Buffer.from(`${stored.clientId}:${stored.clientSecret}`).toString('base64');
  
  const formBody = new URLSearchParams();
  formBody.append('grant_type', 'refresh_token');
  formBody.append('refresh_token', stored.refreshToken);
  formBody.append('scope', EBAY_SCOPES.join(' '));
  
  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authHeader}`,
    },
    body: formBody,
  });

  const responseData = await response.json();
  
  if (!response.ok) {
    if (responseData.error === 'invalid_grant') {
      saveStoredTokens({ connected: false, error: 'Refresh token wygasł.' });
    }
    throw new Error(responseData.error_description || responseData.error);
  }

  tokenCache = {
    accessToken: responseData.access_token,
    expiresAt: Date.now() + (responseData.expires_in * 1000) - (5 * 60 * 1000),
    forClientId: stored.clientId
  };
  
  return responseData.access_token;
}

async function getValidToken() {
  const stored = loadStoredTokens();
  
  if (!stored.refreshToken) {
    throw new Error('Brak połączenia z eBay.');
  }
  
  if (tokenCache.accessToken && tokenCache.forClientId === stored.clientId && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  
  return await refreshAccessToken();
}

// ============================================
// CORS HEADERS
// ============================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ============================================
// MAIN HANDLER - Routes all /api/ebay/* requests
// ============================================
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Set CORS headers for all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  const { slug } = req.query;
  const path = Array.isArray(slug) ? slug.join('/') : slug || '';

  console.log(`📡 API Request: ${req.method} /api/ebay/${path}`);

  try {
    // Route: GET /api/ebay/oauth/status
    if (path === 'oauth/status' && req.method === 'GET') {
      const stored = loadStoredTokens();
      return res.json({
        connected: !!stored.refreshToken && stored.connected,
        connectedAt: stored.connectedAt,
        clientId: stored.clientId ? stored.clientId.substring(0, 20) + '...' : null,
        error: stored.error,
        hasRefreshToken: !!stored.refreshToken,
        redirectUri: getRedirectUri(req)
      });
    }

    // Route: POST /api/ebay/oauth/prepare
    if (path === 'oauth/prepare' && req.method === 'POST') {
      const { clientId, clientSecret } = req.body;
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Wymagane: clientId i clientSecret' });
      }
      saveStoredTokens({
        pendingClientId: clientId.trim(),
        pendingClientSecret: clientSecret.trim()
      });
      return res.json({ success: true });
    }

    // Route: POST /api/ebay/oauth/auth-url
    if (path === 'oauth/auth-url' && req.method === 'POST') {
      const { clientId, clientSecret } = req.body;
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Brak Client ID lub Client Secret' });
      }
      
      saveStoredTokens({
        pendingClientId: clientId.trim(),
        pendingClientSecret: clientSecret.trim()
      });

      const redirectUri = getRedirectUri(req);
      const scopeString = EBAY_SCOPES.map(s => encodeURIComponent(s)).join('%20');
      const state = Date.now().toString();

      const authUrl = `${EBAY_AUTH_URL}?` +
        `client_id=${encodeURIComponent(clientId.trim())}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${scopeString}` +
        `&state=${state}`;

      console.log('🔗 OAuth Auth URL generated, redirectUri:', redirectUri);

      return res.json({
        authUrl,
        redirectUri,
        scopes: EBAY_SCOPES,
        message: `WAŻNE: Dodaj Redirect URI do eBay Developer Portal: ${redirectUri}`
      });
    }

    // Route: POST /api/ebay/oauth/disconnect
    if (path === 'oauth/disconnect' && req.method === 'POST') {
      saveStoredTokens({
        refreshToken: null,
        clientId: null,
        clientSecret: null,
        connectedAt: null,
        connected: false,
        error: null
      });
      tokenCache = { accessToken: null, expiresAt: 0, forClientId: null };
      return res.json({ success: true, message: 'Rozłączono z eBay' });
    }

    // Route: POST /api/ebay/test
    if (path === 'test' && req.method === 'POST') {
      const stored = loadStoredTokens();
      if (!stored.refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Brak połączenia z eBay',
          hint: 'Kliknij "Połącz z eBay (OAuth)"'
        });
      }

      const token = await getValidToken();
      const response = await fetch(
        'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE',
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (!response.ok) {
        throw new Error(`eBay API Error: ${response.status}`);
      }

      const data = await response.json();
      return res.json({
        success: true,
        message: `Połączenie OK! Category Tree ID: ${data.categoryTreeId}`,
        details: data
      });
    }

    // Route: PUT /api/ebay/inventory/[sku]
    if (path.startsWith('inventory/') && req.method === 'PUT') {
      const sku = path.replace('inventory/', '');
      const token = await getValidToken();
      
      const response = await fetch(
        `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Language': 'de-DE',
          },
          body: JSON.stringify(req.body),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json(err);
      }
      return res.json({ success: true, sku });
    }

    // Route: POST /api/ebay/offer
    if (path === 'offer' && req.method === 'POST') {
      const token = await getValidToken();
      
      const response = await fetch('https://api.ebay.com/sell/inventory/v1/offer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Language': 'de-DE',
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      return res.status(response.ok ? 200 : response.status).json(data);
    }

    // Route: POST /api/ebay/offer/[offerId]/publish
    if (path.match(/^offer\/[^\/]+\/publish$/) && req.method === 'POST') {
      const offerId = path.split('/')[1];
      const token = await getValidToken();
      
      const response = await fetch(
        `https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();
      return res.status(response.ok ? 200 : response.status).json(data);
    }

    // Route: GET /api/ebay/policies/[type]
    if (path.startsWith('policies/') && req.method === 'GET') {
      const type = path.replace('policies/', '');
      const token = await getValidToken();
      
      const response = await fetch(
        `https://api.ebay.com/sell/account/v1/${type}_policy?marketplace_id=EBAY_DE`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();
      return res.status(response.ok ? 200 : response.status).json(data);
    }

    // Route not found
    return res.status(404).json({ error: 'Route not found', path });

  } catch (error) {
    console.error('❌ API Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
