// Vercel Serverless Function - Unified eBay API Handler
// This handles ALL /api/ebay/* routes including callback

const TOKEN_STORAGE = new Map();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Extract the path from URL
  const url = new URL(req.url, `https://${req.headers.host}`);
  const fullPath = url.pathname;
  
  // Remove /api/ebay/ prefix to get the route
  const path = fullPath.replace(/^\/api\/ebay\/?/, '');
  
  console.log('=== EBAY API HANDLER ===');
  console.log('Full Path:', fullPath);
  console.log('Route Path:', path);
  console.log('Method:', req.method);
  
  try {
    // Route handling
    if (path === '' || path === '/') {
      return res.status(200).json({ message: 'eBay API endpoint active', route: path });
    }
    
    if (path === 'test') {
      return res.status(200).json({ 
        success: true, 
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        path: path
      });
    }
    
    if (path === 'oauth/status') {
      return handleOAuthStatus(req, res);
    }
    
    if (path === 'oauth/prepare') {
      return handleOAuthPrepare(req, res);
    }
    
    if (path === 'oauth/auth-url') {
      return handleGetAuthUrl(req, res);
    }
    
    if (path === 'callback') {
      return handleCallback(req, res);
    }
    
    if (path === 'oauth/disconnect') {
      return handleDisconnect(req, res);
    }
    
    if (path === 'test-connection') {
      return handleTestConnection(req, res);
    }
    
    // All policies (GET)
    if (path === 'policies') {
      return handleAllPolicies(req, res);
    }
    
    // Locations (GET/POST)
    if (path === 'locations') {
      return handleLocations(req, res);
    }
    
    // Inventory routes
    if (path.startsWith('inventory/')) {
      return handleInventory(req, res, path);
    }
    
    if (path === 'offer') {
      return handleCreateOffer(req, res);
    }
    
    if (path.match(/^offer\/[^\/]+\/publish$/)) {
      return handlePublishOffer(req, res, path);
    }
    
    // Policies routes
    if (path.startsWith('policies/')) {
      return handlePolicies(req, res, path);
    }
    
    // Not found
    return res.status(404).json({ 
      error: 'Route not found', 
      path: path,
      fullPath: fullPath,
      availableRoutes: [
        'test',
        'oauth/status',
        'oauth/prepare',
        'oauth/auth-url',
        'callback',
        'oauth/disconnect',
        'test-connection',
        'policies',
        'policies/:type',
        'locations',
        'inventory/:sku',
        'offer',
        'offer/:offerId/publish'
      ]
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}

// Helper to get eBay credentials from environment
function getEbayCredentials() {
  return {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    // eBay uses RuName (Redirect URL Name) instead of actual URL!
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

// Token storage (in-memory for Vercel, will reset on cold start)
// For production, use a database like Redis, Vercel KV, or a DB
function getStoredTokens() {
  return TOKEN_STORAGE.get('tokens') || null;
}

function storeTokens(tokens) {
  TOKEN_STORAGE.set('tokens', tokens);
}

function clearTokens() {
  TOKEN_STORAGE.delete('tokens');
}

// Handler: OAuth Status
async function handleOAuthStatus(req, res) {
  const tokens = getStoredTokens();
  const { clientId, environment } = getEbayCredentials();
  
  if (!tokens) {
    return res.status(200).json({
      connected: false,
      environment: environment,
      hasCredentials: !!clientId
    });
  }
  
  // Check if token is expired
  const now = Date.now();
  const isExpired = tokens.expiresAt && now >= tokens.expiresAt;
  
  if (isExpired && tokens.refreshToken) {
    // Try to refresh
    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      return res.status(200).json({
        connected: true,
        environment: environment,
        expiresAt: refreshed.expiresAt,
        username: tokens.username || 'eBay User'
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
      clearTokens();
      return res.status(200).json({
        connected: false,
        environment: environment,
        error: 'Token refresh failed'
      });
    }
  }
  
  return res.status(200).json({
    connected: true,
    environment: environment,
    expiresAt: tokens.expiresAt,
    username: tokens.username || 'eBay User'
  });
}

// Handler: OAuth Prepare (generates state)
async function handleOAuthPrepare(req, res) {
  const state = 'ebay_' + Math.random().toString(36).substring(2, 15);
  
  // Store state for validation (in production, use session/DB)
  TOKEN_STORAGE.set('oauth_state', state);
  
  return res.status(200).json({ state });
}

// Handler: Get Auth URL
async function handleGetAuthUrl(req, res) {
  const { state, scopes } = req.query;
  const { clientId, ruName, environment } = getEbayCredentials();
  
  if (!clientId) {
    return res.status(400).json({ error: 'eBay credentials not configured (missing EBAY_CLIENT_ID)' });
  }
  
  if (!ruName) {
    return res.status(400).json({ error: 'eBay RuName not configured (missing EBAY_RUNAME)' });
  }
  
  const authBase = getEbayAuthUrl(environment);
  
  // Use provided scopes or defaults
  const scopeList = scopes || 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment';
  
  // Build auth URL - eBay uses RuName (not URL!) as redirect_uri
  const authUrl = `${authBase}/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(ruName)}&response_type=code&scope=${scopeList.split(' ').map(s => encodeURIComponent(s)).join('%20')}&state=${encodeURIComponent(state)}`;
  
  console.log('Generated auth URL with RuName:', authUrl);
  console.log('RuName:', ruName);
  
  return res.status(200).json({ authUrl });
}

// Handler: OAuth Callback
async function handleCallback(req, res) {
  const { code, state, error, error_description } = req.query;
  
  console.log('OAuth callback received:', { code: !!code, state, error });
  
  if (error) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>eBay Authorization Failed</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #e74c3c;">❌ Authorization Failed</h1>
        <p>Error: ${error}</p>
        <p>${error_description || ''}</p>
        <script>
          setTimeout(() => {
            window.opener?.postMessage({ type: 'EBAY_AUTH_ERROR', error: '${error}' }, '*');
            window.close();
          }, 2000);
        </script>
      </body>
      </html>
    `);
  }
  
  if (!code) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>eBay Authorization Failed</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #e74c3c;">❌ No Authorization Code</h1>
        <p>eBay did not provide an authorization code.</p>
        <script>
          setTimeout(() => {
            window.opener?.postMessage({ type: 'EBAY_AUTH_ERROR', error: 'no_code' }, '*');
            window.close();
          }, 2000);
        </script>
      </body>
      </html>
    `);
  }
  
  // Exchange code for tokens
  try {
    const { clientId, clientSecret, ruName, environment } = getEbayCredentials();
    const apiBase = getEbayBaseUrl(environment);
    
    console.log('Token exchange - using RuName:', ruName);
    
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    // IMPORTANT: redirect_uri must be the SAME RuName used in authorize!
    const tokenResponse = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
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
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
    }
    
    // Store tokens
    const tokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      refreshExpiresAt: Date.now() + (tokenData.refresh_token_expires_in * 1000),
      tokenType: tokenData.token_type
    };
    
    // Note: We send tokens to frontend via postMessage
    // Frontend will store them in localStorage
    console.log('Tokens received successfully, sending to frontend');
    
    // Encode tokens as base64 JSON for safe transfer
    const tokensJson = JSON.stringify(tokens);
    const tokensBase64 = Buffer.from(tokensJson).toString('base64');
    
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>eBay Authorization Successful</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #27ae60;">✅ Authorization Successful!</h1>
        <p>Your eBay account has been connected.</p>
        <p>This window will close automatically...</p>
        <script>
          const tokensBase64 = '${tokensBase64}';
          const tokensJson = atob(tokensBase64);
          const tokens = JSON.parse(tokensJson);
          
          // Send tokens to parent window
          window.opener?.postMessage({ 
            type: 'EBAY_AUTH_SUCCESS',
            tokens: tokens
          }, '*');
          
          setTimeout(() => window.close(), 1500);
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Callback error:', error);
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>eBay Authorization Failed</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #e74c3c;">❌ Authorization Failed</h1>
        <p>${error.message}</p>
        <script>
          setTimeout(() => {
            window.opener?.postMessage({ type: 'EBAY_AUTH_ERROR', error: '${error.message}' }, '*');
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `);
  }
}

// Handler: Disconnect
async function handleDisconnect(req, res) {
  clearTokens();
  return res.status(200).json({ success: true, message: 'Disconnected from eBay' });
}

// Handler: Test Connection with eBay API
async function handleTestConnection(req, res) {
  // Get token from Authorization header (sent from frontend localStorage)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Brak tokenu autoryzacji',
      hint: 'Zaloguj się ponownie do eBay'
    });
  }
  
  const accessToken = authHeader.replace('Bearer ', '');
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  try {
    // Test call - get default category tree for EBAY_DE
    const response = await fetch(`${apiBase}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      return res.status(200).json({
        success: true,
        message: `Połączenie działa! Category Tree ID: ${data.categoryTreeId}`,
        debug: {
          categoryTreeId: data.categoryTreeId,
          categoryTreeVersion: data.categoryTreeVersion
        }
      });
    } else {
      return res.status(200).json({
        success: false,
        message: data.errors?.[0]?.message || 'Błąd API eBay',
        hint: 'Token mógł wygasnąć - spróbuj połączyć się ponownie',
        debug: data
      });
    }
  } catch (error) {
    return res.status(200).json({
      success: false,
      message: `Błąd: ${error.message}`,
      hint: 'Sprawdź połączenie internetowe'
    });
  }
}

// Handler: Refresh Token
async function refreshAccessToken(refreshToken) {
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
    throw new Error(data.error_description || 'Token refresh failed');
  }
  
  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000),
    refreshExpiresAt: Date.now() + (data.refresh_token_expires_in * 1000) || getStoredTokens()?.refreshExpiresAt,
    tokenType: data.token_type
  };
  
  storeTokens(tokens);
  return tokens;
}

// Get valid access token (refresh if needed)
async function getValidAccessToken() {
  let tokens = getStoredTokens();
  
  if (!tokens) {
    throw new Error('Not authenticated');
  }
  
  // Refresh if token expires in less than 5 minutes
  const now = Date.now();
  if (tokens.expiresAt && now >= tokens.expiresAt - (5 * 60 * 1000)) {
    if (!tokens.refreshToken) {
      throw new Error('Token expired and no refresh token available');
    }
    tokens = await refreshAccessToken(tokens.refreshToken);
  }
  
  return tokens.accessToken;
}

// Handler: Inventory operations
async function handleInventory(req, res, path) {
  const sku = path.replace('inventory/', '');
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  try {
    const accessToken = await getValidAccessToken();
    
    if (req.method === 'PUT') {
      // Create/Update inventory item
      const response = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US'
        },
        body: JSON.stringify(req.body)
      });
      
      if (response.status === 204) {
        return res.status(204).end();
      }
      
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    
    if (req.method === 'GET') {
      // Get inventory item
      const response = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    
    if (req.method === 'DELETE') {
      // Delete inventory item
      const response = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (response.status === 204) {
        return res.status(204).end();
      }
      
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Inventory error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Handler: Create Offer
async function handleCreateOffer(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  try {
    const accessToken = await getValidAccessToken();
    
    const response = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US'
      },
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('Create offer error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Handler: Publish Offer
async function handlePublishOffer(req, res, path) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const match = path.match(/^offer\/([^\/]+)\/publish$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid offer ID' });
  }
  
  const offerId = match[1];
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  try {
    const accessToken = await getValidAccessToken();
    
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
    console.error('Publish offer error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Handler: Get All Policies (payment, fulfillment, return)
async function handleAllPolicies(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  
  const accessToken = authHeader.replace('Bearer ', '');
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  try {
    // Fetch all three policy types in parallel
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
    
    // Transform to simple format
    const paymentPolicies = (paymentData.paymentPolicies || []).map(p => ({
      policyId: p.paymentPolicyId,
      name: p.name,
      description: p.description
    }));
    
    const fulfillmentPolicies = (fulfillmentData.fulfillmentPolicies || []).map(p => ({
      policyId: p.fulfillmentPolicyId,
      name: p.name,
      description: p.description
    }));
    
    const returnPolicies = (returnData.returnPolicies || []).map(p => ({
      policyId: p.returnPolicyId,
      name: p.name,
      description: p.description
    }));
    
    return res.status(200).json({
      paymentPolicies,
      fulfillmentPolicies,
      returnPolicies
    });
    
  } catch (error) {
    console.error('Get all policies error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Handler: Locations (GET list, POST create)
async function handleLocations(req, res) {
  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  
  const accessToken = authHeader.replace('Bearer ', '');
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${apiBase}/sell/inventory/v1/location?limit=100`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: data.errors?.[0]?.message || 'Failed to fetch locations' 
        });
      }
      
      const locations = (data.locations || []).map(loc => ({
        merchantLocationKey: loc.merchantLocationKey,
        name: loc.name,
        address: loc.location?.address
      }));
      
      return res.status(200).json({ locations });
      
    } catch (error) {
      console.error('Get locations error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  if (req.method === 'POST') {
    try {
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
      
      if (response.status === 204) {
        return res.status(200).json({ 
          success: true, 
          merchantLocationKey,
          message: 'Location created/updated successfully' 
        });
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: data.errors?.[0]?.message || 'Failed to create location' 
        });
      }
      
      return res.status(200).json({ success: true, data });
      
    } catch (error) {
      console.error('Create location error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}

// Handler: Policies (by type)
async function handlePolicies(req, res, path) {
  const policyType = path.replace('policies/', '');
  const { environment } = getEbayCredentials();
  const apiBase = getEbayBaseUrl(environment);
  
  try {
    const accessToken = await getValidAccessToken();
    
    let endpoint = '';
    switch (policyType) {
      case 'fulfillment':
        endpoint = '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US';
        break;
      case 'payment':
        endpoint = '/sell/account/v1/payment_policy?marketplace_id=EBAY_US';
        break;
      case 'return':
        endpoint = '/sell/account/v1/return_policy?marketplace_id=EBAY_US';
        break;
      default:
        return res.status(400).json({ error: 'Invalid policy type' });
    }
    
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('Policies error:', error);
    return res.status(500).json({ error: error.message });
  }
}
