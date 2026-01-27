// =============================================================================
// Vercel Serverless Function - Complete eBay API Handler
// ETAP 4: Secure backend with token storage using encrypted HTTP-only cookies
// =============================================================================

import * as cookie from 'cookie';

// Encryption key from environment (32 chars for AES-256)
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'ebay-ai-listing-assistant-key32';

// Simple XOR encryption for tokens (in production, use proper AES)
function encryptToken(text) {
  const key = ENCRYPTION_KEY;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(result, 'binary').toString('base64');
}

function decryptToken(encrypted) {
  try {
    const key = ENCRYPTION_KEY;
    const text = Buffer.from(encrypted, 'base64').toString('binary');
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch {
    return null;
  }
}

// Cookie helpers
function setTokenCookies(res, tokens) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30 // 30 days (refresh token validity)
  };
  
  const encryptedTokens = encryptToken(JSON.stringify(tokens));
  
  res.setHeader('Set-Cookie', cookie.serialize('ebay_tokens', encryptedTokens, cookieOptions));
}

function getTokensFromCookies(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  if (!cookies.ebay_tokens) return null;
  
  try {
    const decrypted = decryptToken(cookies.ebay_tokens);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

function clearTokenCookies(res) {
  res.setHeader('Set-Cookie', cookie.serialize('ebay_tokens', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  }));
}

// =============================================================================
// Main Handler
// =============================================================================

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Extract path
  const url = new URL(req.url, `https://${req.headers.host}`);
  const fullPath = url.pathname;
  const path = fullPath.replace(/^\/api\/ebay\/?/, '');
  
  console.log(`[eBay API] ${req.method} ${path}`);
  
  try {
    // ==========================================================================
    // OAUTH ROUTES
    // ==========================================================================
    
    if (path === '' || path === '/') {
      return res.status(200).json({ 
        message: 'eBay API v2 - Backend Token Storage',
        endpoints: getAvailableRoutes()
      });
    }
    
    if (path === 'test') {
      return handleTest(req, res);
    }
    
    if (path === 'oauth/start') {
      return handleOAuthStart(req, res);
    }
    
    if (path === 'oauth/callback' || path === 'callback') {
      return handleOAuthCallback(req, res);
    }
    
    if (path === 'oauth/refresh') {
      return handleOAuthRefresh(req, res);
    }
    
    if (path === 'oauth/status') {
      return handleOAuthStatus(req, res);
    }
    
    if (path === 'oauth/disconnect') {
      return handleOAuthDisconnect(req, res);
    }
    
    if (path === 'oauth/manual-exchange') {
      return handleManualCodeExchange(req, res);
    }
    
    // ==========================================================================
    // ACCOUNT ROUTES
    // ==========================================================================
    
    if (path === 'account/policies') {
      return handleAccountPolicies(req, res);
    }
    
    if (path === 'account/locations') {
      return handleAccountLocations(req, res);
    }
    
    // ==========================================================================
    // TAXONOMY ROUTES
    // ==========================================================================
    
    if (path === 'category/suggest') {
      return handleCategorySuggest(req, res);
    }
    
    if (path.startsWith('category/aspects/')) {
      return handleCategoryAspects(req, res, path);
    }
    
    // ==========================================================================
    // STORE ROUTES
    // ==========================================================================
    
    if (path === 'store/categories') {
      return handleStoreCategories(req, res);
    }
    
    // ==========================================================================
    // MARKET ROUTES
    // ==========================================================================
    
    if (path === 'market/price-check') {
      return handleMarketPriceCheck(req, res);
    }
    
    // ==========================================================================
    // LISTING ROUTES
    // ==========================================================================
    
    if (path === 'listing/draft') {
      return handleListingDraft(req, res);
    }
    
    if (path === 'listing/publish') {
      return handleListingPublish(req, res);
    }
    
    // ==========================================================================
    // LEGACY ROUTES (for backward compatibility)
    // ==========================================================================
    
    if (path === 'test-connection') {
      return handleTestConnection(req, res);
    }
    
    if (path === 'policies') {
      return handleAccountPolicies(req, res);
    }
    
    if (path === 'locations') {
      return handleAccountLocations(req, res);
    }
    
    if (path === 'browse/search') {
      return handleBrowseSearch(req, res);
    }
    
    // Debug: get raw inventory count
    if (path === 'inventory-items-debug') {
      return handleGetInventoryItemsDebug(req, res);
    }
    
    // Get all inventory items (paginated) - Inventory API
    if (path === 'inventory-items') {
      return handleGetInventoryItems(req, res);
    }
    
    // Get ALL seller listings via Trading API GetSellerList
    if (path === 'seller-list') {
      return handleGetSellerList(req, res);
    }
    
    // Revise item via Trading API ReviseItem
    if (path === 'revise-item') {
      return handleReviseItem(req, res);
    }
    
    if (path.startsWith('inventory/')) {
      return handleInventory(req, res, path);
    }
    
    if (path === 'offer') {
      return handleCreateOffer(req, res);
    }
    
    // Handle /offers?sku=XXX (query param) - used by ContentTab
    if (path === 'offers') {
      return handleGetOffersBySkuQuery(req, res);
    }
    
    if (path.startsWith('offers/')) {
      return handleGetOffersBySku(req, res, path);
    }
    
    if (path.match(/^offer\/[^\/]+\/publish$/)) {
      return handlePublishOffer(req, res, path);
    }
    
    if (path.match(/^offer\/[^\/]+$/) && !path.includes('/publish')) {
      return handleDeleteOrUpdateOffer(req, res, path);
    }
    
    // Not found
    return res.status(404).json({ 
      error: 'Route not found', 
      path,
      availableRoutes: getAvailableRoutes()
    });
    
  } catch (error) {
    console.error('[eBay API] Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}

function getAvailableRoutes() {
  return [
    // OAuth
    'GET  /api/ebay/oauth/start - Start OAuth flow',
    'GET  /api/ebay/oauth/callback - OAuth callback',
    'POST /api/ebay/oauth/refresh - Refresh access token',
    'GET  /api/ebay/oauth/status - Check connection status',
    'POST /api/ebay/oauth/disconnect - Disconnect',
    'GET  /api/ebay/test - Test with category tree',
    // Account
    'GET  /api/ebay/account/policies - Get all policies',
    'GET  /api/ebay/account/locations - Get locations',
    'POST /api/ebay/account/locations - Create location',
    // Taxonomy
    'POST /api/ebay/category/suggest - Suggest eBay categories',
    // Store
    'GET  /api/ebay/store/categories - Get store categories',
    // Market
    'POST /api/ebay/market/price-check - Check competition prices',
    // Listing
    'POST /api/ebay/listing/draft - Validate and prepare draft',
    'POST /api/ebay/listing/publish - Publish to eBay',
    // Inventory
    'GET  /api/ebay/inventory-items - Get inventory items (REST API only)',
    'GET  /api/ebay/seller-list - Get ALL seller listings (Trading API)',
    'POST /api/ebay/revise-item - Update listing (Trading API ReviseItem)'
  ];
}

// =============================================================================
// Helper Functions
// =============================================================================

function getEbayCredentials() {
  return {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    ruName: process.env.EBAY_RUNAME,
    environment: process.env.EBAY_ENVIRONMENT || 'PRODUCTION'
  };
}

function getEbayBaseUrl(environment) {
  return environment === 'PRODUCTION' 
    ? 'https://api.ebay.com' 
    : 'https://api.sandbox.ebay.com';
}

function getEbayAuthUrl(environment) {
  return environment === 'PRODUCTION'
    ? 'https://auth.ebay.com'
    : 'https://auth.sandbox.ebay.com';
}

// Get Application Token (client_credentials) for Browse API
// This doesn't require user login - uses app credentials only
async function getApplicationToken() {
  const { clientId, clientSecret, environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope'
    }).toString()
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('[eBay API] Application token error:', data);
    throw new Error(data.error_description || 'Failed to get application token');
  }
  
  return data.access_token;
}

async function getValidAccessToken(req, res) {
  let tokens = getTokensFromCookies(req);
  
  // Also check Authorization header (for backward compatibility)
  if (!tokens) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.replace('Bearer ', '');
      return { accessToken, fromHeader: true };
    }
  }
  
  if (!tokens) {
    throw new Error('NOT_AUTHENTICATED');
  }
  
  // Check if token needs refresh (5 min buffer)
  const now = Date.now();
  if (tokens.expiresAt && now >= tokens.expiresAt - (5 * 60 * 1000)) {
    if (!tokens.refreshToken) {
      throw new Error('TOKEN_EXPIRED');
    }
    
    // Refresh the token
    tokens = await refreshAccessTokenInternal(tokens.refreshToken);
    setTokenCookies(res, tokens);
  }
  
  return { accessToken: tokens.accessToken, tokens };
}

async function refreshAccessTokenInternal(refreshToken) {
  const { clientId, clientSecret, environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('[eBay API] Token refresh failed:', data);
    throw new Error(data.error_description || 'TOKEN_REFRESH_FAILED');
  }
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000),
    refreshExpiresAt: Date.now() + (data.refresh_token_expires_in * 1000),
    tokenType: data.token_type
  };
}

// =============================================================================
// OAuth Handlers
// =============================================================================

// VERIFIED SCOPES - from eBay Developer Portal OAuth Scopes list
// These are confirmed available for this application
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',                    // View public data
  'https://api.ebay.com/oauth/api_scope/sell.inventory',     // View and manage inventory
  'https://api.ebay.com/oauth/api_scope/sell.account',       // View and manage account
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',   // View and manage orders
  'https://api.ebay.com/oauth/api_scope/sell.stores'         // View and manage eBay Stores
];

async function handleOAuthStart(req, res) {
  const { clientId, ruName, environment } = getEbayCredentials();
  
  if (!clientId || !ruName) {
    return res.status(400).json({ 
      error: 'Missing eBay credentials',
      missing: !clientId ? 'EBAY_CLIENT_ID' : 'EBAY_RUNAME',
      hint: 'Set EBAY_CLIENT_ID and EBAY_RUNAME in Vercel environment variables'
    });
  }
  
  const state = 'ebay_' + Math.random().toString(36).substring(2, 15);
  const authBase = getEbayAuthUrl(environment);
  
  // Use whitelisted scopes only - NO commerce.catalog.readonly (causes invalid_scope)
  const authUrl = `${authBase}/oauth2/authorize?` + new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,  // This is the RuName, not a URL
    response_type: 'code',
    scope: EBAY_SCOPES.join(' '),
    state: state
  }).toString();
  
  console.log('[eBay OAuth] Redirecting to:', authUrl);
  
  // Return 302 redirect to eBay auth page
  res.setHeader('Location', authUrl);
  return res.status(302).end();
}

async function handleOAuthCallback(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');
  const state = url.searchParams.get('state');
  
  console.log('[eBay OAuth Callback] Params:', { code: code ? 'present' : 'missing', error, errorDesc, state });
  
  // Handle invalid_scope error specifically
  if (error === 'invalid_scope') {
    console.error('[eBay OAuth] Invalid scope error - check EBAY_SCOPES whitelist');
    return sendCallbackResponse(res, false, 'invalid_scope', null, {
      isInvalidScope: true,
      hint: 'eBay odrzucił scope. Poprawiono konfigurację — uruchom Połącz eBay ponownie.',
      fullUrl: req.url
    });
  }
  
  if (error) {
    console.error('[eBay OAuth] Error:', error, errorDesc);
    return sendCallbackResponse(res, false, `${error}: ${errorDesc}`);
  }
  
  if (!code) {
    console.error('[eBay OAuth] No code received. Query:', Object.fromEntries(url.searchParams));
    return res.status(400).json({
      success: false,
      error: 'NO_CODE',
      details: Object.fromEntries(url.searchParams),
      hint: 'Authorization code not received from eBay'
    });
  }
  
  try {
    const { clientId, clientSecret, ruName, environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const response = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: ruName
      }).toString()
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[eBay API] Token exchange failed:', data);
      return sendCallbackResponse(res, false, data.error_description || data.error);
    }
    
    // Store tokens in secure HTTP-only cookie
    const tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      refreshExpiresAt: Date.now() + (data.refresh_token_expires_in * 1000),
      tokenType: data.token_type
    };
    
    setTokenCookies(res, tokens);
    
    // Also send tokens to frontend for backward compatibility
    return sendCallbackResponse(res, true, null, tokens);
    
  } catch (err) {
    console.error('[eBay API] Callback error:', err);
    return sendCallbackResponse(res, false, err.message);
  }
}

function sendCallbackResponse(res, success, error = null, tokens = null, extra = {}) {
  const tokensBase64 = tokens ? Buffer.from(JSON.stringify(tokens)).toString('base64') : '';
  const isInvalidScope = extra.isInvalidScope || false;
  const hint = extra.hint || '';
  
  const errorMessage = isInvalidScope 
    ? 'eBay odrzucił scope. Poprawiono konfigurację — uruchom Połącz eBay ponownie.'
    : (error || 'Unknown error');
  
  return res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>eBay Authorization</title></head>
    <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f8fafc;">
      <div style="max-width: 400px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        ${success ? `
          <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
          <h1 style="color: #16a34a; margin: 0 0 8px 0;">Sukces!</h1>
          <p style="color: #64748b;">Połączono z eBay. To okno zamknie się automatycznie.</p>
          <p style="font-size: 12px; color: #94a3b8;">Refresh token zapisany ✓</p>
        ` : `
          <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
          <h1 style="color: #dc2626; margin: 0 0 8px 0;">Błąd autoryzacji</h1>
          <p style="color: #64748b;">${errorMessage}</p>
          ${hint ? `<p style="font-size: 12px; color: #f97316; margin-top: 8px;">${hint}</p>` : ''}
        `}
      </div>
      <script>
        console.log('[eBay Callback] Success:', ${success}, 'Error:', '${error}');
        ${success ? `
          const tokensBase64 = '${tokensBase64}';
          const tokens = tokensBase64 ? JSON.parse(atob(tokensBase64)) : null;
          console.log('[eBay Callback] Tokens received, refresh_token:', tokens?.refreshToken ? 'present' : 'missing');
          window.opener?.postMessage({ type: 'EBAY_AUTH_SUCCESS', tokens }, '*');
        ` : `
          const errorData = { error: '${error}', isInvalidScope: ${isInvalidScope} };
          console.error('[eBay Callback] Error:', errorData);
          window.opener?.postMessage({ type: 'EBAY_AUTH_ERROR', ...errorData }, '*');
        `}
        setTimeout(() => window.close(), ${success ? 2000 : 5000});
      </script>
    </body>
    </html>
  `);
}

async function handleOAuthRefresh(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const tokens = getTokensFromCookies(req);
  
  if (!tokens || !tokens.refreshToken) {
    return res.status(401).json({ error: 'No refresh token available' });
  }
  
  try {
    const newTokens = await refreshAccessTokenInternal(tokens.refreshToken);
    setTokenCookies(res, newTokens);
    
    return res.status(200).json({ 
      success: true,
      expiresAt: newTokens.expiresAt
    });
  } catch (error) {
    console.error('[eBay API] Refresh error:', error);
    clearTokenCookies(res);
    return res.status(401).json({ error: error.message });
  }
}

async function handleOAuthStatus(req, res) {
  const tokens = getTokensFromCookies(req);
  const { environment } = getEbayCredentials();
  
  if (!tokens) {
    return res.status(200).json({
      connected: false,
      environment,
      message: 'Not authenticated'
    });
  }
  
  const now = Date.now();
  const isExpired = tokens.expiresAt && now >= tokens.expiresAt;
  const needsRefresh = tokens.expiresAt && now >= tokens.expiresAt - (5 * 60 * 1000);
  
  return res.status(200).json({
    connected: !isExpired || !!tokens.refreshToken,
    environment,
    expiresAt: tokens.expiresAt,
    needsRefresh,
    hasRefreshToken: !!tokens.refreshToken
  });
}

// Manual code exchange - when RuName redirect doesn't work
async function handleManualCodeExchange(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }
  
  let body;
  try {
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = req.body;
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  
  const { code } = body;
  
  if (!code) {
    return res.status(400).json({ 
      error: 'Missing code parameter',
      usage: 'POST with JSON body: { "code": "v^1.1#..." }'
    });
  }
  
  try {
    const { clientId, clientSecret, ruName, environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    console.log('[eBay Manual Exchange] Exchanging code for tokens...');
    
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const response = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: ruName
      }).toString()
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[eBay Manual Exchange] Failed:', data);
      return res.status(400).json({
        success: false,
        error: data.error,
        error_description: data.error_description,
        hint: data.error === 'invalid_grant' 
          ? 'Kod wygasł (ważny 5 minut). Rozpocznij OAuth ponownie.'
          : 'Sprawdź kod autoryzacyjny'
      });
    }
    
    // Store tokens in secure HTTP-only cookie
    const tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      refreshExpiresAt: Date.now() + (data.refresh_token_expires_in * 1000),
      tokenType: data.token_type
    };
    
    setTokenCookies(res, tokens);
    
    console.log('[eBay Manual Exchange] Success! Tokens saved.');
    
    return res.status(200).json({
      success: true,
      message: 'Tokeny zapisane pomyślnie!',
      expiresIn: data.expires_in,
      refreshExpiresIn: data.refresh_token_expires_in
    });
    
  } catch (err) {
    console.error('[eBay Manual Exchange] Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

async function handleOAuthDisconnect(req, res) {
  clearTokenCookies(res);
  return res.status(200).json({ success: true, message: 'Disconnected' });
}

// =============================================================================
// Test Handler
// =============================================================================

async function handleTest(req, res) {
  try {
    const { accessToken, tokens } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    console.log('[eBay Test] Calling taxonomy API with token:', accessToken ? 'present' : 'missing');
    
    const response = await fetch(`${apiBase}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      return res.status(200).json({
        success: true,
        categoryTreeId: data.categoryTreeId,
        categoryTreeVersion: data.categoryTreeVersion,
        message: `Category Tree ID: ${data.categoryTreeId} (expected: 77 for EBAY_DE)`,
        hasRefreshToken: tokens?.refreshToken ? true : false
      });
    }
    
    // eBay returned an error
    const ebayError = data.errors?.[0];
    return res.status(200).json({
      success: false,
      error: ebayError?.message || 'eBay API error',
      error_id: ebayError?.errorId,
      error_description: ebayError?.longMessage || ebayError?.message,
      http_status_code: response.status,
      hint: getErrorHint(ebayError?.errorId, response.status),
      data
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(200).json({ 
        success: false, 
        error: 'Not authenticated',
        hint: 'Połącz eBay w Ustawieniach'
      });
    }
    if (error.message === 'TOKEN_EXPIRED') {
      return res.status(200).json({ 
        success: false, 
        error: 'Token expired',
        hint: 'Token wygasł - połącz ponownie z eBay'
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      hint: 'Wystąpił błąd serwera'
    });
  }
}

// Helper to provide error hints based on eBay error codes
function getErrorHint(errorId, httpStatus) {
  if (httpStatus === 401) return 'Token nieważny - połącz ponownie z eBay';
  if (httpStatus === 403) return 'Brak uprawnień - sprawdź scope OAuth';
  if (errorId === 1001) return 'Nieprawidłowy token - połącz ponownie';
  if (errorId === 1100) return 'Brak dostępu do tego zasobu';
  return 'Sprawdź konfigurację eBay API';
}

async function handleTestConnection(req, res) {
  return handleTest(req, res);
}

// =============================================================================
// Account Handlers
// =============================================================================

async function handleAccountPolicies(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const [paymentRes, fulfillmentRes, returnRes] = await Promise.all([
      fetch(`${apiBase}/sell/account/v1/payment_policy?marketplace_id=EBAY_DE`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }),
      fetch(`${apiBase}/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }),
      fetch(`${apiBase}/sell/account/v1/return_policy?marketplace_id=EBAY_DE`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })
    ]);
    
    const [paymentData, fulfillmentData, returnData] = await Promise.all([
      paymentRes.json(),
      fulfillmentRes.json(),
      returnRes.json()
    ]);
    
    return res.status(200).json({
      paymentPolicies: (paymentData.paymentPolicies || []).map(p => ({
        policyId: p.paymentPolicyId,
        name: p.name,
        description: p.description
      })),
      fulfillmentPolicies: (fulfillmentData.fulfillmentPolicies || []).map(p => ({
        policyId: p.fulfillmentPolicyId,
        name: p.name,
        description: p.description
      })),
      returnPolicies: (returnData.returnPolicies || []).map(p => ({
        policyId: p.returnPolicyId,
        name: p.name,
        description: p.description
      }))
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Policies error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function handleAccountLocations(req, res) {
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    if (req.method === 'GET') {
      const response = await fetch(`${apiBase}/sell/inventory/v1/location?limit=100`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      const data = await response.json();
      
      return res.status(200).json({
        locations: (data.locations || []).map(loc => ({
          merchantLocationKey: loc.merchantLocationKey,
          name: loc.name,
          address: loc.location?.address
        }))
      });
    }
    
    if (req.method === 'POST') {
      const { merchantLocationKey, name, address } = req.body;
      
      if (!merchantLocationKey) {
        return res.status(400).json({ error: 'merchantLocationKey is required' });
      }
      
      const locationData = {
        location: {
          address: {
            city: address?.city || 'Berlin',
            postalCode: address?.postalCode || '10115',
            country: address?.country || 'DE'
          }
        },
        name: name || merchantLocationKey,
        merchantLocationStatus: 'ENABLED',
        locationTypes: ['WAREHOUSE']
      };
      
      const response = await fetch(`${apiBase}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(locationData)
      });
      
      if (response.status === 204 || response.status === 200) {
        return res.status(200).json({ success: true, merchantLocationKey });
      }
      
      const data = await response.json();
      return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed' });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Locations error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// Taxonomy Handler - Category Suggest
// =============================================================================

async function handleCategorySuggest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    
    // Use category tree ID 77 for EBAY_DE
    const response = await fetch(`${apiBase}/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.errors?.[0]?.message || 'Failed to get suggestions',
        data 
      });
    }
    
    const suggestions = (data.categorySuggestions || []).map(s => ({
      categoryId: s.category?.categoryId,
      categoryName: s.category?.categoryName,
      relevancy: s.categoryTreeNodeLevel
    }));
    
    return res.status(200).json({ suggestions });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Category suggest error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// Taxonomy Handler - Get Required Aspects for Category
// =============================================================================

async function handleCategoryAspects(req, res, path) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const categoryId = path.replace('category/aspects/', '');
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    // Category tree ID 77 is for EBAY_DE
    const url = `${apiBase}/commerce/taxonomy/v1/category_tree/77/get_item_aspects_for_category?category_id=${categoryId}`;
    console.log('[eBay Aspects] Fetching aspects for category:', categoryId);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[eBay Aspects] Error:', data);
      return res.status(response.status).json(data);
    }
    
    // Extract only required aspects with aspectRequired: true
    const requiredAspects = (data.aspects || [])
      .filter(a => a.aspectConstraint?.aspectRequired === true)
      .map(a => ({
        name: a.localizedAspectName,
        dataType: a.aspectConstraint?.aspectDataType,
        mode: a.aspectConstraint?.aspectMode,
        cardinality: a.aspectConstraint?.itemToAspectCardinality,
        values: (a.aspectValues || []).slice(0, 50).map(v => v.localizedValue)
      }));
    
    // Also get recommended aspects
    const recommendedAspects = (data.aspects || [])
      .filter(a => a.aspectConstraint?.aspectUsage === 'RECOMMENDED' && a.aspectConstraint?.aspectRequired !== true)
      .slice(0, 20)
      .map(a => ({
        name: a.localizedAspectName,
        dataType: a.aspectConstraint?.aspectDataType,
        mode: a.aspectConstraint?.aspectMode,
        cardinality: a.aspectConstraint?.itemToAspectCardinality,
        values: (a.aspectValues || []).slice(0, 50).map(v => v.localizedValue)
      }));
    
    console.log('[eBay Aspects] Required:', requiredAspects.map(a => a.name));
    
    return res.status(200).json({
      categoryId,
      required: requiredAspects,
      recommended: recommendedAspects,
      totalAspects: data.aspects?.length || 0
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Aspects error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// Store Handler - Get Store Categories
// =============================================================================

async function handleStoreCategories(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    console.log('[Store Categories] Fetching from Stores API...');
    
    // Use the new Stores API to get store categories
    // https://developer.ebay.com/api-docs/sell/stores/resources/store/methods/getStoreCategories
    const response = await fetch(`${apiBase}/sell/stores/v1/store/categories`, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    console.log('[Store Categories] Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Store Categories] Got data:', JSON.stringify(data).slice(0, 500));
      
      // Parse categories from response - they come in hierarchical structure
      // Response uses: storeCategories[].categoryName, childrenCategories
      const parseCategories = (categories, parentName = '') => {
        let result = [];
        for (const cat of (categories || [])) {
          const catName = cat.categoryName || cat.name;
          const fullName = parentName ? `${parentName} > ${catName}` : catName;
          result.push({
            categoryId: cat.categoryId,
            name: catName,
            fullPath: fullName,
            order: cat.order,
            level: cat.level
          });
          // Recurse into child categories (up to 3 levels supported)
          if (cat.childrenCategories && cat.childrenCategories.length > 0) {
            result = result.concat(parseCategories(cat.childrenCategories, fullName));
          }
        }
        return result;
      };
      
      const categories = parseCategories(data.storeCategories || []);
      
      return res.status(200).json({
        categories,
        source: 'stores_api',
        total: categories.length
      });
    }
    
    // If Stores API fails (e.g., no store subscription), return empty with hint
    const errorData = await response.json().catch(() => ({}));
    console.log('[Store Categories] Error response:', errorData);
    
    return res.status(200).json({
      categories: [],
      source: 'no_store',
      hint: 'Nie udało się pobrać kategorii sklepu. Sprawdź czy masz aktywną subskrypcję eBay Store.',
      error: errorData.message || `HTTP ${response.status}`
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Store categories error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// Market Handler - Price Check (uses Application Token - no user login required)
// =============================================================================

async function handleMarketPriceCheck(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Use Application Token for Browse API (doesn't require user login)
    const accessToken = await getApplicationToken();
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const { ean, keywords, limit = 20 } = req.body;
    
    if (!ean && !keywords) {
      return res.status(400).json({ error: 'ean or keywords is required' });
    }
    
    // Helper function to search eBay
    // Filter: FIXED_PRICE only, conditionIds: 1000=New, 1500=New other, 2000=Certified Refurbished, 2500=Seller refurbished
    // Excluded: 3000=Used (Gebraucht), 4000=Very Good, 5000=Good, 6000=Acceptable
    async function searchEbay(query) {
      const searchUrl = `${apiBase}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}&filter=buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500}`;
      const response = await fetch(searchUrl, {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
        }
      });
      return response.json();
    }
    
    // Try EAN first, fallback to keywords if no results
    let data;
    let usedQuery = ean || keywords;
    
    if (ean) {
      data = await searchEbay(ean);
      // If EAN returns no results, try keywords
      if ((!data.itemSummaries || data.itemSummaries.length === 0) && keywords) {
        console.log(`[Price Check] EAN "${ean}" returned 0 results, trying keywords: "${keywords}"`);
        data = await searchEbay(keywords);
        usedQuery = keywords;
      }
    } else {
      data = await searchEbay(keywords);
    }
    
    if (data.errors) {
      return res.status(400).json({ 
        error: data.errors?.[0]?.message || 'Search failed',
        data 
      });
    }
    
    const items = (data.itemSummaries || []).map(item => ({
      title: item.title,
      price: parseFloat(item.price?.value || 0),
      currency: item.price?.currency || 'EUR',
      shipping: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
      total: parseFloat(item.price?.value || 0) + parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
      seller: item.seller?.username,
      condition: item.condition,
      itemId: item.itemId
    }));
    
    // Calculate statistics
    const prices = items.map(i => i.total).filter(p => p > 0).sort((a, b) => a - b);
    
    return res.status(200).json({
      query: usedQuery,
      queryType: ean && usedQuery !== ean ? 'keywords (fallback)' : (ean ? 'ean' : 'keywords'),
      totalResults: data.total || items.length,
      items,
      statistics: {
        count: prices.length,
        min: prices[0] || 0,
        max: prices[prices.length - 1] || 0,
        median: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0,
        average: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
      }
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Price check error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// Listing Handlers - Draft & Publish
// =============================================================================

async function handleListingDraft(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { product, policies } = req.body;
  
  if (!product) {
    return res.status(400).json({ error: 'product is required' });
  }
  
  // Validation
  const errors = [];
  const warnings = [];
  
  if (!product.sku) errors.push({ field: 'sku', message: 'SKU is required' });
  if (!product.title) errors.push({ field: 'title', message: 'Title is required' });
  if (!product.title || product.title.length > 80) warnings.push({ field: 'title', message: 'Title should be max 80 characters' });
  if (!product.descriptionHtml) errors.push({ field: 'descriptionHtml', message: 'Description is required' });
  if (!product.ebayCategoryId) errors.push({ field: 'ebayCategoryId', message: 'eBay category is required' });
  if (!product.priceGross || product.priceGross <= 0) errors.push({ field: 'priceGross', message: 'Price must be > 0' });
  if (!product.quantity || product.quantity <= 0) errors.push({ field: 'quantity', message: 'Quantity must be > 0' });
  if (!product.condition) errors.push({ field: 'condition', message: 'Condition is required' });
  
  // Policy validation
  if (!policies?.paymentPolicyId) errors.push({ field: 'paymentPolicyId', message: 'Payment policy is required' });
  if (!policies?.fulfillmentPolicyId) errors.push({ field: 'fulfillmentPolicyId', message: 'Fulfillment policy is required' });
  if (!policies?.returnPolicyId) errors.push({ field: 'returnPolicyId', message: 'Return policy is required' });
  if (!policies?.merchantLocationKey) errors.push({ field: 'merchantLocationKey', message: 'Merchant location is required' });
  
  // Calculate net price with 19% VAT
  const vatRate = 0.19;
  const priceNet = product.priceGross ? parseFloat((product.priceGross / (1 + vatRate)).toFixed(2)) : 0;
  
  // Build inventory payload
  const inventoryPayload = {
    product: {
      title: product.title,
      description: product.descriptionHtml,
      aspects: product.aspects || {},
      ean: product.ean ? [product.ean] : undefined,
      imageUrls: product.images || []
    },
    condition: product.condition === 'NEW' ? 'NEW' : 'USED_EXCELLENT',
    availability: {
      shipToLocationAvailability: {
        quantity: product.quantity
      }
    }
  };
  
  // Build offer payload
  const offerPayload = {
    sku: product.sku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    listingDescription: product.descriptionHtml,
    availableQuantity: product.quantity,
    categoryId: product.ebayCategoryId,
    merchantLocationKey: policies?.merchantLocationKey,
    pricingSummary: {
      price: {
        value: product.priceGross?.toFixed(2),
        currency: 'EUR'
      }
    },
    listingPolicies: {
      fulfillmentPolicyId: policies?.fulfillmentPolicyId,
      paymentPolicyId: policies?.paymentPolicyId,
      returnPolicyId: policies?.returnPolicyId
    }
  };
  
  return res.status(200).json({
    valid: errors.length === 0,
    errors,
    warnings,
    pricing: {
      gross: product.priceGross,
      net: priceNet,
      vat: parseFloat((product.priceGross - priceNet).toFixed(2)),
      vatRate: '19%'
    },
    payloads: {
      inventory: inventoryPayload,
      offer: offerPayload
    }
  });
}

async function handleListingPublish(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const { product, policies } = req.body;
    
    // Re-validate
    if (!product?.sku || !product?.title || !product?.ebayCategoryId || !product?.priceGross) {
      return res.status(400).json({ error: 'Missing required product fields' });
    }
    
    if (!policies?.paymentPolicyId || !policies?.fulfillmentPolicyId || !policies?.returnPolicyId) {
      return res.status(400).json({ error: 'Missing required policies' });
    }
    
    // Step 1: Create/Update Inventory Item
    const inventoryPayload = {
      product: {
        title: product.title,
        description: product.descriptionHtml,
        aspects: product.aspects || {},
        ean: product.ean ? [product.ean] : undefined
      },
      condition: product.condition === 'NEW' ? 'NEW' : 'USED_EXCELLENT',
      availability: {
        shipToLocationAvailability: {
          quantity: product.quantity || 1
        }
      }
    };
    
    const invResponse = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(product.sku)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE'
      },
      body: JSON.stringify(inventoryPayload)
    });
    
    if (!invResponse.ok && invResponse.status !== 204) {
      const invData = await invResponse.json();
      return res.status(invResponse.status).json({
        step: 'inventory',
        error: invData.errors?.[0]?.message || 'Inventory creation failed',
        ebayErrorId: invData.errors?.[0]?.errorId,
        details: invData
      });
    }
    
    // Step 2: Create Offer
    const offerPayload = {
      sku: product.sku,
      marketplaceId: 'EBAY_DE',
      format: 'FIXED_PRICE',
      listingDescription: product.descriptionHtml,
      availableQuantity: product.quantity || 1,
      categoryId: product.ebayCategoryId,
      merchantLocationKey: policies.merchantLocationKey,
      pricingSummary: {
        price: {
          value: product.priceGross.toFixed(2),
          currency: 'EUR'
        }
      },
      listingPolicies: {
        fulfillmentPolicyId: policies.fulfillmentPolicyId,
        paymentPolicyId: policies.paymentPolicyId,
        returnPolicyId: policies.returnPolicyId
      }
    };
    
    const offerResponse = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE'
      },
      body: JSON.stringify(offerPayload)
    });
    
    const offerData = await offerResponse.json();
    
    if (!offerResponse.ok) {
      return res.status(offerResponse.status).json({
        step: 'offer',
        error: offerData.errors?.[0]?.message || 'Offer creation failed',
        ebayErrorId: offerData.errors?.[0]?.errorId,
        details: offerData
      });
    }
    
    const offerId = offerData.offerId;
    
    // Step 3: Publish Offer
    const publishResponse = await fetch(`${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const publishData = await publishResponse.json();
    
    if (!publishResponse.ok) {
      return res.status(publishResponse.status).json({
        step: 'publish',
        error: publishData.errors?.[0]?.message || 'Publish failed',
        ebayErrorId: publishData.errors?.[0]?.errorId,
        offerId,
        details: publishData
      });
    }
    
    return res.status(200).json({
      success: true,
      offerId,
      listingId: publishData.listingId,
      sku: product.sku,
      inventoryPayload,
      offerPayload,
      publishResponse: publishData
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay API] Publish error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// Legacy Handlers (for backward compatibility)
// =============================================================================

async function handleBrowseSearch(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const url = new URL(req.url, `https://${req.headers.host}`);
    const q = url.searchParams.get('q') || '';
    const filter = url.searchParams.get('filter') || '';
    const limit = url.searchParams.get('limit') || '20';
    
    let searchUrl = `${apiBase}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    if (filter) {
      searchUrl += `&filter=${encodeURIComponent(filter)}`;
    }
    
    const response = await fetch(searchUrl, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function handleInventory(req, res, path) {
  const sku = path.replace('inventory/', '');
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    console.log('[eBay Inventory] SKU:', sku);
    console.log('[eBay Inventory] Method:', req.method);
    console.log('[eBay Inventory] Body:', JSON.stringify(req.body, null, 2));
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      },
      body: req.method === 'PUT' ? JSON.stringify(req.body) : undefined
    });
    
    console.log('[eBay Inventory] Response status:', response.status);
    
    if (response.status === 204) {
      return res.status(204).end();
    }
    
    const data = await response.json();
    console.log('[eBay Inventory] Response data:', JSON.stringify(data, null, 2));
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function handleCreateOffer(req, res) {
  console.log('[eBay CreateOffer] Method:', req.method);
  console.log('[eBay CreateOffer] Body:', JSON.stringify(req.body, null, 2));
  
  // Allow both POST and handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', receivedMethod: req.method, hint: 'Use POST to create offer' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      },
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function handleGetOffersBySku(req, res, path) {
  const sku = path.replace('offers/', '');
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    console.log('[eBay GetOffers] SKU:', sku);
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    const data = await response.json();
    console.log('[eBay GetOffers] Response:', JSON.stringify(data, null, 2));
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

// Handle GET /offers?sku=XXX (query parameter style - used by ContentTab)
async function handleGetOffersBySkuQuery(req, res) {
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    // Extract SKU from query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sku = url.searchParams.get('sku');
    
    if (!sku) {
      return res.status(400).json({ error: 'sku query parameter is required' });
    }
    
    console.log('[eBay GetOffers Query] SKU:', sku);
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Language': 'en-US',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    const data = await response.json();
    console.log('[eBay GetOffers Query] Response status:', response.status);
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function handleDeleteOrUpdateOffer(req, res, path) {
  const match = path.match(/^offer\/([^\/]+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid offer ID' });
  }
  
  const offerId = match[1];
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    if (req.method === 'DELETE') {
      console.log('[eBay Offer] Deleting offer:', offerId);
      
      const response = await fetch(`${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Language': 'de-DE',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
        }
      });
      
      if (response.status === 204) {
        return res.status(204).end();
      }
      
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    
    if (req.method === 'PUT') {
      console.log('[eBay Offer] V2 Updating offer:', offerId);
      console.log('[eBay Offer] V2 Update payload:', JSON.stringify(req.body));
      
      // First, get the current offer to have full data
      const getResponse = await fetch(`${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
        }
      });
      
      if (!getResponse.ok) {
        const errData = await getResponse.json();
        console.log('[eBay Offer] Failed to get offer:', errData);
        return res.status(getResponse.status).json(errData);
      }
      
      const currentOffer = await getResponse.json();
      console.log('[eBay Offer] Current offer retrieved');
      
      // Merge with new data (only update listingDescription)
      const updatedOffer = {
        ...currentOffer,
        listingDescription: req.body.listingDescription ?? currentOffer.listingDescription
      };
      
      // Remove read-only fields
      delete updatedOffer.offerId;
      delete updatedOffer.listing;
      delete updatedOffer.status;
      
      console.log('[eBay Offer] Sending updated offer with description length:', updatedOffer.listingDescription?.length);
      
      const response = await fetch(`${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept-Language': 'de-DE',
          'Content-Language': 'de-DE',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
        },
        body: JSON.stringify(updatedOffer)
      });
      
      if (response.status === 204) {
        return res.status(204).end();
      }
      
      const data = await response.json();
      console.log('[eBay Offer] Update response:', JSON.stringify(data).substring(0, 500));
      return res.status(response.status).json(data);
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function handlePublishOffer(req, res, path) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const match = path.match(/^offer\/([^\/]+)\/publish$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid offer ID' });
  }
  
  const offerId = match[1];
  console.log('[eBay Publish] Offer ID:', offerId);
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    const data = await response.json();
    console.log('[eBay Publish] Response status:', response.status);
    console.log('[eBay Publish] Response data:', JSON.stringify(data, null, 2));
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

// ============ DEBUG: GET INVENTORY COUNT FROM MULTIPLE APIs ============
async function handleGetInventoryItemsDebug(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const results = {};
    
    // 1. Get inventory items count (limit 1 to get total quickly)
    const inventoryResponse = await fetch(`${apiBase}/sell/inventory/v1/inventory_item?limit=1&offset=0`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    const inventoryData = await inventoryResponse.json();
    results.inventoryApi = {
      total: inventoryData.total,
      status: inventoryResponse.status,
      error: inventoryData.errors || inventoryData.error || null,
      response: inventoryResponse.status !== 200 ? inventoryData : undefined
    };
    
    // 2. Get offers count
    const offersResponse = await fetch(`${apiBase}/sell/inventory/v1/offer?limit=1&offset=0`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    const offersData = await offersResponse.json();
    results.offersApi = {
      total: offersData.total,
      status: offersResponse.status,
      error: offersData.errors || offersData.error || null,
      response: offersResponse.status !== 200 ? offersData : undefined
    };
    
    // 3. Get active listings via Fulfillment API (if available)
    try {
      const ordersResponse = await fetch(`${apiBase}/sell/fulfillment/v1/order?limit=1`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
        }
      });
      const ordersData = await ordersResponse.json();
      results.ordersApi = {
        total: ordersData.total,
        status: ordersResponse.status
      };
    } catch (e) {
      results.ordersApi = { error: e.message };
    }
    
    // 4. Try without marketplace header
    const inventoryResponse2 = await fetch(`${apiBase}/sell/inventory/v1/inventory_item?limit=1&offset=0`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    const inventoryData2 = await inventoryResponse2.json();
    results.inventoryApiNoMarketplace = {
      total: inventoryData2.total,
      status: inventoryResponse2.status,
      error: inventoryData2.errors || null
    };
    
    console.log('[eBay Debug] Results:', JSON.stringify(results, null, 2));
    
    return res.status(200).json({
      message: 'Debug info from eBay APIs',
      environment,
      results
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay Debug] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============ GET ALL INVENTORY ITEMS (PAGINATED) ============
async function handleGetInventoryItems(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    
    // Get pagination params from query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
    const offset = url.searchParams.get('offset') || '0';
    const enrichOffers = url.searchParams.get('enrichOffers') !== 'false'; // default true
    
    console.log('[eBay GetInventoryItems] Limit:', limit, 'Offset:', offset, 'EnrichOffers:', enrichOffers);
    
    // 1. Get inventory items
    const response = await fetch(`${apiBase}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Language': 'en-US',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    const data = await response.json();
    console.log('[eBay GetInventoryItems] Response status:', response.status);
    console.log('[eBay GetInventoryItems] Total items:', data.total, 'Returned:', data.inventoryItems?.length);
    
    // Log image counts
    data.inventoryItems?.forEach(item => {
      console.log(`[eBay GetInventoryItems] ${item.sku}: images=${item.product?.imageUrls?.length || 0}`);
    });
    
    // 2. For each inventory item, fetch offer to get description and price (if enrichOffers)
    if (enrichOffers && data.inventoryItems && data.inventoryItems.length > 0) {
      // Limit concurrent requests to avoid timeout - do in batches of 10
      const batchSize = 10;
      const enrichedItems = [];
      
      for (let i = 0; i < data.inventoryItems.length; i += batchSize) {
        const batch = data.inventoryItems.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            try {
              const offerResponse = await fetch(
                `${apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(item.sku)}`,
                {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
                  }
                }
              );
              
              if (offerResponse.ok) {
                const offerData = await offerResponse.json();
                const offer = offerData.offers?.[0];
                
                if (offer) {
                  return {
                    ...item,
                    offer: {
                      offerId: offer.offerId,
                      listingDescription: offer.listingDescription,
                      pricingSummary: offer.pricingSummary,
                      status: offer.status,
                      listingId: offer.listing?.listingId
                    }
                  };
                }
              }
              return item;
            } catch (err) {
              console.log(`[eBay GetInventoryItems] Failed to get offer for ${item.sku}:`, err.message);
              return item;
            }
          })
        );
        enrichedItems.push(...batchResults);
      }
      
      data.inventoryItems = enrichedItems;
    }
    
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay GetInventoryItems] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ============ GET ALL SELLER LISTINGS (TRADING API - GetSellerList) ============
// This endpoint retrieves ALL seller listings, not just those created via REST API
async function handleGetSellerList(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    
    // Get pagination params from query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pageNumber = parseInt(url.searchParams.get('page') || '1');
    const entriesPerPage = Math.min(parseInt(url.searchParams.get('limit') || '200'), 200);
    const status = url.searchParams.get('status') || 'all'; // 'active', 'ended', 'all'
    
    console.log('[eBay GetSellerList] Page:', pageNumber, 'EntriesPerPage:', entriesPerPage, 'Status:', status);
    
    // Trading API endpoint
    const tradingApiUrl = environment === 'PRODUCTION'
      ? 'https://api.ebay.com/ws/api.dll'
      : 'https://api.sandbox.ebay.com/ws/api.dll';
    
    // Calculate date range (max 120 days) - get items ending in next 120 days OR ended in last 120 days
    const now = new Date();
    let dateFilter = '';
    
    if (status === 'active') {
      // Active items: end time from now to 120 days in future
      const endTimeFrom = now.toISOString();
      const endTimeTo = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString();
      dateFilter = `
        <EndTimeFrom>${endTimeFrom}</EndTimeFrom>
        <EndTimeTo>${endTimeTo}</EndTimeTo>
      `;
    } else if (status === 'ended') {
      // Ended items: end time from 120 days ago to now
      const endTimeFrom = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
      const endTimeTo = now.toISOString();
      dateFilter = `
        <EndTimeFrom>${endTimeFrom}</EndTimeFrom>
        <EndTimeTo>${endTimeTo}</EndTimeTo>
      `;
    } else {
      // All items: start time from 120 days ago to now (catches both active and recently ended)
      const startTimeFrom = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
      const startTimeTo = now.toISOString();
      dateFilter = `
        <StartTimeFrom>${startTimeFrom}</StartTimeFrom>
        <StartTimeTo>${startTimeTo}</StartTimeTo>
      `;
    }
    
    // Build XML request body for GetSellerList
    // Note: To get Description, we need DetailLevel=ReturnAll or ItemReturnDescription
    // But this limits to 200 items per page (which we already have)
    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <DetailLevel>ReturnAll</DetailLevel>
  ${dateFilter}
  <IncludeWatchCount>true</IncludeWatchCount>
  <Pagination>
    <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
</GetSellerListRequest>`;
    
    console.log('[eBay GetSellerList] Calling Trading API...');
    
    const response = await fetch(tradingApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '77', // 77 = Germany
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
        'X-EBAY-API-CALL-NAME': 'GetSellerList',
        'X-EBAY-API-IAF-TOKEN': accessToken
      },
      body: xmlBody
    });
    
    const xmlText = await response.text();
    console.log('[eBay GetSellerList] Response status:', response.status);
    
    // Parse XML response
    const result = parseGetSellerListXml(xmlText);
    
    if (result.error) {
      console.error('[eBay GetSellerList] Error:', result.error);
      return res.status(400).json({ error: result.error, details: result.details });
    }
    
    console.log('[eBay GetSellerList] Found items:', result.items?.length, 'Total:', result.totalItems);
    
    return res.status(200).json({
      items: result.items,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
      currentPage: pageNumber,
      hasMoreItems: result.hasMoreItems,
      entriesPerPage
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay GetSellerList] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Parse GetSellerList XML response
function parseGetSellerListXml(xmlText) {
  try {
    // Check for errors first
    const ackMatch = xmlText.match(/<Ack>([^<]+)<\/Ack>/);
    const ack = ackMatch ? ackMatch[1] : '';
    
    if (ack === 'Failure') {
      const errorMatch = xmlText.match(/<ShortMessage>([^<]+)<\/ShortMessage>/);
      const longErrorMatch = xmlText.match(/<LongMessage>([^<]+)<\/LongMessage>/);
      return {
        error: errorMatch ? errorMatch[1] : 'Unknown error',
        details: longErrorMatch ? longErrorMatch[1] : xmlText.substring(0, 500)
      };
    }
    
    // Extract pagination info
    const totalPagesMatch = xmlText.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
    const totalEntriesMatch = xmlText.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/);
    const hasMoreMatch = xmlText.match(/<HasMoreItems>([^<]+)<\/HasMoreItems>/);
    
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1]) : 1;
    const totalItems = totalEntriesMatch ? parseInt(totalEntriesMatch[1]) : 0;
    const hasMoreItems = hasMoreMatch ? hasMoreMatch[1] === 'true' : false;
    
    // Extract items
    const items = [];
    const itemRegex = /<Item>([\s\S]*?)<\/Item>/g;
    let itemMatch;
    
    while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
      const itemXml = itemMatch[1];
      
      // Extract fields with safe regex
      const getField = (name) => {
        const match = itemXml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
        return match ? match[1] : null;
      };
      
      // Get Description (can contain HTML, might be in CDATA)
      let description = null;
      // Try CDATA first
      const cdataMatch = itemXml.match(/<Description><!\[CDATA\[([\s\S]*?)\]\]><\/Description>/);
      if (cdataMatch) {
        description = cdataMatch[1];
      } else {
        // Try regular content (HTML entities encoded)
        const descMatch = itemXml.match(/<Description>([\s\S]*?)<\/Description>/);
        if (descMatch) {
          description = decodeXmlEntities(descMatch[1]);
        }
      }
      
      // Get picture URLs
      const pictureUrls = [];
      const pictureUrlRegex = /<PictureURL>([^<]+)<\/PictureURL>/g;
      let picMatch;
      while ((picMatch = pictureUrlRegex.exec(itemXml)) !== null) {
        pictureUrls.push(picMatch[1]);
      }
      
      // Get current price from SellingStatus
      const currentPriceMatch = itemXml.match(/<CurrentPrice[^>]*>([^<]+)<\/CurrentPrice>/);
      const currentPrice = currentPriceMatch ? currentPriceMatch[1] : null;
      const currencyMatch = itemXml.match(/<CurrentPrice[^>]*currencyID="([^"]+)"/);
      const currency = currencyMatch ? currencyMatch[1] : 'EUR';
      
      // Get listing status
      const listingStatusMatch = itemXml.match(/<ListingStatus>([^<]+)<\/ListingStatus>/);
      const listingStatus = listingStatusMatch ? listingStatusMatch[1] : 'Active';
      
      // Get quantity info
      const quantityMatch = itemXml.match(/<Quantity>(\d+)<\/Quantity>/);
      const quantitySoldMatch = itemXml.match(/<QuantitySold>(\d+)<\/QuantitySold>/);
      const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
      const quantitySold = quantitySoldMatch ? parseInt(quantitySoldMatch[1]) : 0;
      
      // Get times
      const startTimeMatch = itemXml.match(/<StartTime>([^<]+)<\/StartTime>/);
      const endTimeMatch = itemXml.match(/<EndTime>([^<]+)<\/EndTime>/);
      
      // Get View Item URL
      const viewItemUrlMatch = itemXml.match(/<ViewItemURL>([^<]+)<\/ViewItemURL>/);
      
      // Get category
      const categoryIdMatch = itemXml.match(/<CategoryID>([^<]+)<\/CategoryID>/);
      const categoryNameMatch = itemXml.match(/<CategoryName>([^<]+)<\/CategoryName>/);
      
      const item = {
        itemId: getField('ItemID'),
        sku: getField('SKU') || getField('ItemID'), // Use ItemID as SKU if not set
        title: getField('Title'),
        description: description, // HTML description of the listing
        pictureUrls: pictureUrls,
        currentPrice: {
          value: currentPrice,
          currency: currency
        },
        listingStatus: listingStatus,
        quantity: quantity,
        quantitySold: quantitySold,
        quantityAvailable: quantity - quantitySold,
        startTime: startTimeMatch ? startTimeMatch[1] : null,
        endTime: endTimeMatch ? endTimeMatch[1] : null,
        timeLeft: getField('TimeLeft'),
        viewItemUrl: viewItemUrlMatch ? viewItemUrlMatch[1] : null,
        watchCount: getField('WatchCount'),
        condition: getField('ConditionDisplayName'),
        category: {
          id: categoryIdMatch ? categoryIdMatch[1] : null,
          name: categoryNameMatch ? decodeXmlEntities(categoryNameMatch[1]) : null
        }
      };
      
      // Decode HTML entities in title
      if (item.title) {
        item.title = decodeXmlEntities(item.title);
      }
      
      items.push(item);
    }
    
    return {
      items,
      totalItems,
      totalPages,
      hasMoreItems
    };
    
  } catch (error) {
    console.error('[eBay GetSellerList] Parse error:', error);
    return {
      error: 'Failed to parse response',
      details: error.message
    };
  }
}

// Decode XML/HTML entities
function decodeXmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

// Encode text for XML (escape special chars)
function encodeXmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============ REVISE ITEM (Trading API - ReviseItem) ============
// Update an existing listing using Trading API ReviseItem
async function handleReviseItem(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    
    const { itemId, title, description, pictureUrls } = req.body;
    
    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }
    
    console.log('[eBay ReviseItem] ItemID:', itemId);
    console.log('[eBay ReviseItem] Changes - Title:', !!title, 'Description:', !!description, 'Pictures:', pictureUrls?.length);
    
    // Trading API endpoint
    const tradingApiUrl = environment === 'PRODUCTION'
      ? 'https://api.ebay.com/ws/api.dll'
      : 'https://api.sandbox.ebay.com/ws/api.dll';
    
    // Build Item element with only changed fields
    let itemElement = `<ItemID>${itemId}</ItemID>`;
    
    if (title) {
      itemElement += `<Title>${encodeXmlEntities(title)}</Title>`;
    }
    
    if (description) {
      // Description needs CDATA wrapper for HTML content
      itemElement += `<Description><![CDATA[${description}]]></Description>`;
    }
    
    if (pictureUrls && pictureUrls.length > 0) {
      itemElement += '<PictureDetails>';
      for (const url of pictureUrls) {
        itemElement += `<PictureURL>${encodeXmlEntities(url)}</PictureURL>`;
      }
      itemElement += '</PictureDetails>';
    }
    
    // Build XML request body for ReviseItem
    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    ${itemElement}
  </Item>
</ReviseItemRequest>`;
    
    console.log('[eBay ReviseItem] Calling Trading API...');
    
    const response = await fetch(tradingApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '77', // 77 = Germany
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
        'X-EBAY-API-CALL-NAME': 'ReviseItem',
        'X-EBAY-API-IAF-TOKEN': accessToken
      },
      body: xmlBody
    });
    
    const xmlText = await response.text();
    console.log('[eBay ReviseItem] Response status:', response.status);
    
    // Check for errors
    const ackMatch = xmlText.match(/<Ack>([^<]+)<\/Ack>/);
    const ack = ackMatch ? ackMatch[1] : '';
    
    if (ack === 'Failure') {
      const errorMatch = xmlText.match(/<ShortMessage>([^<]+)<\/ShortMessage>/);
      const longErrorMatch = xmlText.match(/<LongMessage>([^<]+)<\/LongMessage>/);
      const errorCode = xmlText.match(/<ErrorCode>([^<]+)<\/ErrorCode>/);
      
      console.error('[eBay ReviseItem] Error:', errorMatch?.[1], longErrorMatch?.[1]);
      
      return res.status(400).json({
        error: errorMatch ? decodeXmlEntities(errorMatch[1]) : 'ReviseItem failed',
        details: longErrorMatch ? decodeXmlEntities(longErrorMatch[1]) : null,
        errorCode: errorCode ? errorCode[1] : null
      });
    }
    
    // Extract item ID from response
    const revisedItemIdMatch = xmlText.match(/<ItemID>([^<]+)<\/ItemID>/);
    
    console.log('[eBay ReviseItem] Success! ItemID:', revisedItemIdMatch?.[1]);
    
    return res.status(200).json({
      success: true,
      itemId: revisedItemIdMatch ? revisedItemIdMatch[1] : itemId,
      ack: ack
    });
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[eBay ReviseItem] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
