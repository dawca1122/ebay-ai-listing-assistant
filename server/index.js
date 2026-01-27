import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const FRONTEND_URL = 'http://localhost:3000';

// ============================================
// KONFIGURACJA eBay OAuth
// ============================================
const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// REDIRECT URI - musi być DOKŁADNIE taki sam jak w eBay Developer Portal!
// Użytkownik MUSI dodać ten URL do swojej aplikacji w eBay Developer Portal:
// Application Settings → OAuth Redirect URL
const REDIRECT_URI = `http://localhost:${PORT}/api/ebay/oauth/callback`;

// SCOPES - minimalne wymagane scopes
// UWAGA: Każdy scope musi być aktywowany w eBay Developer Portal!
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.stores'       // eBay Store categories
];

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// ============================================
// STORAGE - Przechowywanie tokenów (plik JSON)
// ============================================
const CONFIG_FILE = path.join(__dirname, 'ebay_tokens.json');

function loadStoredTokens() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('❌ Błąd odczytu tokenów:', error.message);
  }
  return { refreshToken: null, connectedAt: null, clientId: null };
}

function saveStoredTokens(data) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
    console.log('✅ Tokeny zapisane do:', CONFIG_FILE);
  } catch (error) {
    console.error('❌ Błąd zapisu tokenów:', error.message);
  }
}

// ============================================
// TOKEN CACHE (runtime - access token)
// ============================================
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
  forClientId: null
};

// ============================================
// DEBUG LOGGER
// ============================================
function logDebug(label, data) {
  console.log(`\n========== ${label} ==========`);
  Object.entries(data).forEach(([key, value]) => {
    if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')) {
      console.log(`  ${key}: ${typeof value === 'string' ? value.substring(0, 20) + '...' : value}`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  });
  console.log(`  timestamp: ${new Date().toISOString()}`);
  console.log(`====================================\n`);
}

// ============================================
// OAUTH ENDPOINTS
// ============================================

// 1. GENERUJ AUTH URL - frontend otwiera ten URL w przeglądarce
app.post('/api/ebay/oauth/auth-url', (req, res) => {
  const { clientId, clientSecret } = req.body;
  
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Brak Client ID lub Client Secret' });
  }
  
  // Zapisz credentials PRZED przekierowaniem do eBay (potrzebne w callback)
  saveStoredTokens({ 
    ...loadStoredTokens(), 
    pendingClientId: clientId.trim(),
    pendingClientSecret: clientSecret.trim()
  });
  
  // Buduj URL autoryzacji RĘCZNIE (żeby mieć kontrolę nad kodowaniem)
  const scopeString = EBAY_SCOPES.map(s => encodeURIComponent(s)).join('%20');
  const state = Date.now().toString();
  
  const finalUrl = `${EBAY_AUTH_URL}?` +
    `client_id=${encodeURIComponent(clientId.trim())}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${scopeString}` +
    `&state=${state}`;
  
  // ============ DIAGNOSTYKA ============
  console.log('\n');
  console.log('🔗 ════════════════════════════════════════════════════════════════════');
  console.log('   OAUTH AUTHORIZE URL - PEŁNA DIAGNOSTYKA');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(`   Authorize Endpoint: ${EBAY_AUTH_URL}`);
  console.log(`   Client ID: ${clientId.substring(0, 15)}...${clientId.substring(clientId.length - 5)}`);
  console.log(`   Response Type: code`);
  console.log(`   Redirect URI: ${REDIRECT_URI}`);
  console.log(`   `);
  console.log(`   SCOPES (${EBAY_SCOPES.length} scopes, space-delimited):`);
  EBAY_SCOPES.forEach((s, i) => console.log(`     ${i+1}. ${s}`));
  console.log(`   `);
  console.log(`   PEŁNY URL (kopiuj do przeglądarki jeśli popup nie działa):`);
  console.log(`   ${finalUrl}`);
  console.log('════════════════════════════════════════════════════════════════════════\n');
  
  res.json({ 
    authUrl: finalUrl,
    redirectUri: REDIRECT_URI,
    scopes: EBAY_SCOPES,
    message: `WAŻNE: Upewnij się że w eBay Developer Portal masz dodany Redirect URI: ${REDIRECT_URI}`
  });
});

// 2. CALLBACK - eBay przekierowuje tutaj z kodem
app.get('/api/ebay/oauth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  
  console.log('\n🎫 ========== OAUTH CALLBACK ==========');
  
  if (error) {
    console.error(`❌ OAuth Error: ${error} - ${error_description}`);
    return res.send(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Błąd autoryzacji</h1>
          <p><strong>${error}</strong>: ${error_description}</p>
          <p>Zamknij to okno i spróbuj ponownie.</p>
          <script>setTimeout(() => window.close(), 5000);</script>
        </body>
      </html>
    `);
  }
  
  if (!code) {
    console.error('❌ Brak authorization code');
    return res.send(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Brak kodu autoryzacji</h1>
          <p>Zamknij to okno i spróbuj ponownie.</p>
        </body>
      </html>
    `);
  }
  
  console.log(`   Authorization code: ${code.substring(0, 30)}...`);
  
  // Pobierz zapisane dane (clientId)
  const stored = loadStoredTokens();
  const clientId = stored.pendingClientId;
  const clientSecret = stored.pendingClientSecret;
  
  if (!clientId || !clientSecret) {
    console.error('❌ Brak credentials - użytkownik musi najpierw kliknąć "Połącz z eBay"');
    return res.send(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Sesja wygasła</h1>
          <p>Kliknij "Połącz z eBay" ponownie w aplikacji.</p>
        </body>
      </html>
    `);
  }
  
  // Wymieniamy code na tokeny
  try {
    console.log('   Wymieniamy code na tokeny...');
    
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const formBody = new URLSearchParams();
    formBody.append('grant_type', 'authorization_code');
    formBody.append('code', code);
    formBody.append('redirect_uri', REDIRECT_URI);
    
    console.log('   Token request:');
    console.log(`     grant_type: authorization_code`);
    console.log(`     redirect_uri: ${REDIRECT_URI}`);
    
    const tokenResponse = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`,
      },
      body: formBody,
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      console.error('❌ Token exchange failed:', tokenData);
      saveStoredTokens({ 
        ...stored, 
        error: tokenData.error_description || tokenData.error,
        connected: false 
      });
      
      return res.send(`
        <html>
          <head><title>eBay OAuth - Błąd</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1 style="color: red;">❌ Błąd wymiany tokenu</h1>
            <p><strong>${tokenData.error}</strong>: ${tokenData.error_description}</p>
            <p>Upewnij się że Redirect URI w eBay Developer Portal to:<br><code>${REDIRECT_URI}</code></p>
            <p>Zamknij to okno i spróbuj ponownie.</p>
          </body>
        </html>
      `);
    }
    
    console.log('✅ Token exchange SUCCESS!');
    console.log(`   access_token length: ${tokenData.access_token?.length}`);
    console.log(`   refresh_token length: ${tokenData.refresh_token?.length}`);
    console.log(`   expires_in: ${tokenData.expires_in}s`);
    
    // ZAPISZ REFRESH TOKEN!
    saveStoredTokens({
      refreshToken: tokenData.refresh_token,
      clientId: clientId,
      clientSecret: clientSecret,
      connectedAt: new Date().toISOString(),
      connected: true,
      error: null,
      pendingClientId: null,
      pendingClientSecret: null
    });
    
    // Cache access token
    tokenCache = {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000) - (5 * 60 * 1000),
      forClientId: clientId
    };
    
    console.log('============================================\n');
    
    // Sukces - pokaż komunikat i zamknij okno
    return res.send(`
      <html>
        <head><title>eBay OAuth - Sukces</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: green;">✅ Połączono z eBay!</h1>
          <p>Możesz zamknąć to okno i wrócić do aplikacji.</p>
          <p style="color: gray; font-size: 12px;">To okno zamknie się automatycznie...</p>
          <script>
            // Powiadom opener window
            if (window.opener) {
              window.opener.postMessage({ type: 'EBAY_OAUTH_SUCCESS' }, '*');
            }
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Token exchange error:', error.message);
    
    return res.send(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Błąd połączenia</h1>
          <p>${error.message}</p>
          <p>Zamknij to okno i spróbuj ponownie.</p>
        </body>
      </html>
    `);
  }
});

// 3. STATUS OAuth - sprawdź czy połączono
app.get('/api/ebay/oauth/status', (req, res) => {
  const stored = loadStoredTokens();
  res.json({
    connected: !!stored.refreshToken && stored.connected,
    connectedAt: stored.connectedAt,
    clientId: stored.clientId ? stored.clientId.substring(0, 20) + '...' : null,
    error: stored.error,
    hasRefreshToken: !!stored.refreshToken,
    redirectUri: REDIRECT_URI
  });
});

// 4. ZAPISZ CREDENTIALS przed OAuth (żeby mieć Client Secret w callback)
app.post('/api/ebay/oauth/prepare', (req, res) => {
  const { clientId, clientSecret } = req.body;
  
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Wymagane: clientId i clientSecret' });
  }
  
  const stored = loadStoredTokens();
  saveStoredTokens({
    ...stored,
    pendingClientId: clientId.trim(),
    pendingClientSecret: clientSecret.trim()
  });
  
  console.log('📝 Credentials zapisane (pending)');
  res.json({ success: true, message: 'Credentials zapisane. Teraz kliknij "Połącz z eBay".' });
});

// 5. DISCONNECT - usuń refresh token
app.post('/api/ebay/oauth/disconnect', (req, res) => {
  saveStoredTokens({ 
    refreshToken: null, 
    connectedAt: null, 
    clientId: null,
    clientSecret: null,
    connected: false 
  });
  tokenCache = { accessToken: null, expiresAt: 0, forClientId: null };
  
  console.log('🔌 eBay disconnected');
  res.json({ success: true, message: 'Rozłączono z eBay' });
});

// ============================================
// REFRESH ACCESS TOKEN (używa zapisanego refresh token)
// ============================================
async function refreshAccessToken() {
  const stored = loadStoredTokens();
  
  if (!stored.refreshToken || !stored.clientId || !stored.clientSecret) {
    throw new Error('Brak połączenia z eBay. Kliknij "Połącz z eBay (OAuth)".');
  }
  
  const authHeader = Buffer.from(`${stored.clientId}:${stored.clientSecret}`).toString('base64');
  
  console.log('🔄 [eBay OAuth] Odświeżam access token...');
  
  const formBody = new URLSearchParams();
  formBody.append('grant_type', 'refresh_token');
  formBody.append('refresh_token', stored.refreshToken);
  formBody.append('scope', EBAY_SCOPES);
  
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
    
    // Jeśli refresh token wygasł, wyczyść połączenie
    if (responseData.error === 'invalid_grant') {
      saveStoredTokens({ 
        ...stored, 
        connected: false,
        error: 'Refresh token wygasł. Połącz ponownie.'
      });
    }
    
    const error = new Error(responseData.error_description || responseData.error);
    error.ebayError = responseData.error;
    error.ebayDescription = responseData.error_description;
    throw error;
  }

  console.log('✅ [eBay OAuth] Access token odświeżony!');
  
  tokenCache = {
    accessToken: responseData.access_token,
    expiresAt: Date.now() + (responseData.expires_in * 1000) - (5 * 60 * 1000),
    forClientId: stored.clientId
  };
  
  return {
    accessToken: responseData.access_token,
    expiresIn: responseData.expires_in
  };
}

// ============================================
// GET VALID TOKEN
// ============================================
async function getValidToken() {
  const stored = loadStoredTokens();
  
  if (!stored.refreshToken) {
    throw new Error('Brak połączenia z eBay. Kliknij "Połącz z eBay (OAuth)".');
  }
  
  if (tokenCache.accessToken && 
      tokenCache.forClientId === stored.clientId && 
      Date.now() < tokenCache.expiresAt) {
    console.log('📦 [Token Cache] Używam cached token');
    return tokenCache.accessToken;
  }
  
  const result = await refreshAccessToken();
  return result.accessToken;
}

// ============================================
// TEST POŁĄCZENIA - Taxonomy API
// ============================================
async function testEbayApiCall(token) {
  console.log('🧪 [eBay Taxonomy] GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE');
  
  const response = await fetch('https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`eBay Taxonomy Error (${response.status}): ${err.errors?.[0]?.message || response.statusText}`);
  }
  
  const data = await response.json();
  console.log(`✅ [eBay Taxonomy] categoryTreeId: ${data.categoryTreeId}`);
  return data;
}

// ============================================
// TEST ENDPOINT
// ============================================
app.post('/api/ebay/test', async (req, res) => {
  console.log('\n🚀 ========== TEST POŁĄCZENIA ==========');
  
  const stored = loadStoredTokens();
  
  // Sprawdź czy jest połączenie
  if (!stored.refreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Brak połączenia z eBay',
      hint: 'Najpierw kliknij "Połącz z eBay (OAuth)" aby autoryzować aplikację.',
      debug: {
        connected: false,
        hasRefreshToken: false,
        redirectUri: REDIRECT_URI
      }
    });
  }
  
  try {
    // Pobierz access token (odśwież jeśli trzeba)
    const token = await getValidToken();
    
    // Test Taxonomy API
    const categoryData = await testEbayApiCall(token);
    
    console.log('✅ ========== TEST OK ==========\n');
    
    res.json({ 
      success: true, 
      message: `Połączenie OK! Category Tree ID: ${categoryData.categoryTreeId}`,
      details: {
        categoryTreeId: categoryData.categoryTreeId,
        categoryTreeVersion: categoryData.categoryTreeVersion,
        connectedAt: stored.connectedAt
      },
      debug: {
        connected: true,
        hasRefreshToken: true,
        clientIdPrefix: stored.clientId?.substring(0, 20),
        accessTokenReceived: true,
        accessTokenLength: token.length
      }
    });
    
  } catch (error) {
    console.error('❌ ========== TEST FAILED ==========');
    console.error('Error:', error.message);
    
    res.status(500).json({ 
      success: false, 
      message: error.message,
      error: error.ebayError || 'unknown_error',
      hint: error.ebayError === 'invalid_grant' 
        ? 'Refresh token wygasł. Kliknij "Odłącz" i połącz ponownie.'
        : null,
      debug: {
        connected: stored.connected,
        hasRefreshToken: !!stored.refreshToken,
        error: error.ebayError
      }
    });
  }
});

// ============================================
// INVENTORY ENDPOINTS (używają OAuth)
// ============================================
app.put('/api/ebay/inventory/:sku', async (req, res) => {
  try {
    const token = await getValidToken();
    const { sku } = req.params;
    
    const response = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
      },
      body: JSON.stringify(req.body),
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json(err);
    }
    
    res.json({ success: true, sku });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ebay/offer', async (req, res) => {
  try {
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
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ebay/offer/:offerId/publish', async (req, res) => {
  try {
    const token = await getValidToken();
    const { offerId } = req.params;
    
    const response = await fetch(`https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ebay/policies/:type', async (req, res) => {
  try {
    const token = await getValidToken();
    const { type } = req.params;
    
    const response = await fetch(`https://api.ebay.com/sell/account/v1/${type}_policy?marketplace_id=EBAY_DE`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
🚀 eBay Proxy Server running at http://localhost:${PORT}
📡 OAuth Authorization Code Flow enabled

============================================
⚠️  WAŻNE - KONFIGURACJA eBay Developer Portal:
============================================
Dodaj ten Redirect URI do swojej aplikacji:
${REDIRECT_URI}

Ścieżka: eBay Developer Portal → Your Application → 
         Application Settings → OAuth Redirect URL
============================================

Endpoints:
  OAuth:
    POST /api/ebay/oauth/prepare    - Zapisz credentials przed OAuth
    POST /api/ebay/oauth/auth-url   - Generuj URL autoryzacji
    GET  /api/ebay/oauth/callback   - Callback z eBay (automatyczny)
    GET  /api/ebay/oauth/status     - Status połączenia
    POST /api/ebay/oauth/disconnect - Rozłącz
  
  API:
    POST /api/ebay/test             - Test połączenia
    PUT  /api/ebay/inventory/:sku   - Create/Update Inventory
    POST /api/ebay/offer            - Create Offer
    POST /api/ebay/offer/:id/publish - Publish Offer
    GET  /api/ebay/policies/:type   - Get Policies
`);
});
