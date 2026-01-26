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
    
    if (path.startsWith('inventory/')) {
      return handleInventory(req, res, path);
    }
    
    if (path === 'offer') {
      return handleCreateOffer(req, res);
    }
    
    if (path.match(/^offer\/[^\/]+\/publish$/)) {
      return handlePublishOffer(req, res, path);
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
    // Market
    'POST /api/ebay/market/price-check - Check competition prices',
    // Listing
    'POST /api/ebay/listing/draft - Validate and prepare draft',
    'POST /api/ebay/listing/publish - Publish to eBay'
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

// WHITELISTED SCOPES - DO NOT MODIFY
// These are the only scopes that work with eBay OAuth
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly'
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
// Market Handler - Price Check
// =============================================================================

async function handleMarketPriceCheck(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const { ean, keywords, limit = 20 } = req.body;
    
    const searchQuery = ean || keywords;
    if (!searchQuery) {
      return res.status(400).json({ error: 'ean or keywords is required' });
    }
    
    const searchUrl = `${apiBase}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(searchQuery)}&limit=${limit}&filter=buyingOptions:{FIXED_PRICE}`;
    
    const response = await fetch(searchUrl, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
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
      query: searchQuery,
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
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE'
      },
      body: req.method === 'PUT' ? JSON.stringify(req.body) : undefined
    });
    
    if (response.status === 204) {
      return res.status(204).end();
    }
    
    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    if (error.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.status(500).json({ error: error.message });
  }
}

async function handleCreateOffer(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
        'Content-Language': 'de-DE'
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

async function handlePublishOffer(req, res, path) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const match = path.match(/^offer\/([^\/]+)\/publish$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid offer ID' });
  }
  
  const offerId = match[1];
  
  try {
    const { accessToken } = await getValidAccessToken(req, res);
    const { environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
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
