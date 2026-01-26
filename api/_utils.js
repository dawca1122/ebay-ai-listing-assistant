// Shared utilities for Vercel API functions
// Token storage uses Vercel KV or environment variables

// ============================================
// CONFIGURATION
// ============================================
export const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
export const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
];

// Get redirect URI dynamically based on environment
export function getRedirectUri(req) {
  const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/ebay/oauth/callback`;
}

// ============================================
// TOKEN STORAGE (Environment Variables)
// For production, use Vercel KV or a database
// ============================================

// In-memory storage (for demo - will reset on redeploy)
// For production, use Vercel KV: https://vercel.com/docs/storage/vercel-kv
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

// Token cache for access tokens
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
  forClientId: null
};

export function loadStoredTokens() {
  // Try to load from env if available (for cold starts)
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

export function saveStoredTokens(data) {
  tokenStorage = { ...tokenStorage, ...data };
  
  // Log for debugging (tokens will be in Vercel logs)
  console.log('💾 Token storage updated:', {
    connected: tokenStorage.connected,
    hasRefreshToken: !!tokenStorage.refreshToken,
    clientIdPrefix: tokenStorage.clientId?.substring(0, 15)
  });
  
  return tokenStorage;
}

export function getTokenCache() {
  return tokenCache;
}

export function setTokenCache(cache) {
  tokenCache = cache;
}

// ============================================
// REFRESH ACCESS TOKEN
// ============================================
export async function refreshAccessToken() {
  const stored = loadStoredTokens();
  
  if (!stored.refreshToken || !stored.clientId || !stored.clientSecret) {
    throw new Error('Brak połączenia z eBay. Kliknij "Połącz z eBay (OAuth)".');
  }
  
  const authHeader = Buffer.from(`${stored.clientId}:${stored.clientSecret}`).toString('base64');
  
  console.log('🔄 [eBay OAuth] Odświeżam access token...');
  
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
    console.error('❌ [eBay OAuth] Błąd refresh:', responseData);
    
    if (responseData.error === 'invalid_grant') {
      saveStoredTokens({ 
        connected: false,
        error: 'Refresh token wygasł. Połącz ponownie.'
      });
    }
    
    const error = new Error(responseData.error_description || responseData.error);
    error.ebayError = responseData.error;
    throw error;
  }

  console.log('✅ [eBay OAuth] Access token odświeżony!');
  
  setTokenCache({
    accessToken: responseData.access_token,
    expiresAt: Date.now() + (responseData.expires_in * 1000) - (5 * 60 * 1000),
    forClientId: stored.clientId
  });
  
  return responseData.access_token;
}

// ============================================
// GET VALID TOKEN
// ============================================
export async function getValidToken() {
  const stored = loadStoredTokens();
  const cache = getTokenCache();
  
  if (!stored.refreshToken) {
    throw new Error('Brak połączenia z eBay. Kliknij "Połącz z eBay (OAuth)".');
  }
  
  if (cache.accessToken && 
      cache.forClientId === stored.clientId && 
      Date.now() < cache.expiresAt) {
    console.log('📦 [Token Cache] Używam cached token');
    return cache.accessToken;
  }
  
  return await refreshAccessToken();
}

// ============================================
// CORS HEADERS
// ============================================
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders()
    }
  });
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html',
      ...corsHeaders()
    }
  });
}
