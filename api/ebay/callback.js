// ============================================
// OAuth Callback - handles eBay redirect with authorization code
// ============================================
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// In-memory storage (shared with main handler via global scope)
// Note: This is a workaround - in production use Vercel KV or database
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

// Try to restore from env on cold start
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
  // Also check if we have pending credentials
  if (process.env.EBAY_PENDING_CLIENT_ID) {
    tokenStorage.pendingClientId = process.env.EBAY_PENDING_CLIENT_ID;
    tokenStorage.pendingClientSecret = process.env.EBAY_PENDING_CLIENT_SECRET;
  }
  return tokenStorage;
}

function saveStoredTokens(data) {
  tokenStorage = { ...tokenStorage, ...data };
  console.log('💾 Callback: Token storage updated');
  return tokenStorage;
}

function getRedirectUri(req) {
  const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/ebay/callback`;
}

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  console.log('🎫 OAuth Callback received');

  // Error from eBay
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

  // No code received
  if (!code) {
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

  // Get stored credentials
  const stored = loadStoredTokens();
  const clientId = stored.pendingClientId;
  const clientSecret = stored.pendingClientSecret;

  if (!clientId || !clientSecret) {
    console.error('❌ No pending credentials found');
    return res.send(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Sesja wygasła</h1>
          <p>Serverless function zrestartowała się. Kliknij "Połącz z eBay" ponownie.</p>
          <p style="color: gray; font-size: 12px;">
            Tip: Dla trwałego storage, skonfiguruj Vercel KV lub dodaj credentials do Environment Variables.
          </p>
        </body>
      </html>
    `);
  }

  const redirectUri = getRedirectUri(req);

  try {
    console.log('   Exchanging code for tokens...');
    
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const formBody = new URLSearchParams();
    formBody.append('grant_type', 'authorization_code');
    formBody.append('code', code);
    formBody.append('redirect_uri', redirectUri);

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
      
      return res.send(`
        <html>
          <head><title>eBay OAuth - Błąd</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1 style="color: red;">❌ Błąd wymiany tokenu</h1>
            <p><strong>${tokenData.error}</strong>: ${tokenData.error_description}</p>
            <p>Upewnij się że Redirect URI w eBay Developer Portal to:</p>
            <code style="background: #f0f0f0; padding: 10px; display: block; margin: 10px;">${redirectUri}</code>
            <p>Zamknij to okno i spróbuj ponownie.</p>
          </body>
        </html>
      `);
    }

    console.log('✅ Token exchange SUCCESS!');
    console.log(`   Refresh token received: ${tokenData.refresh_token ? 'YES' : 'NO'}`);

    // Save tokens
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

    // Success page
    return res.send(`
      <html>
        <head><title>eBay OAuth - Sukces</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: green;">✅ Połączono z eBay!</h1>
          <p>Możesz zamknąć to okno i wrócić do aplikacji.</p>
          <p style="color: gray; font-size: 12px;">To okno zamknie się automatycznie...</p>
          <div style="background: #fffbcc; padding: 15px; margin: 20px; border-radius: 8px;">
            <strong>⚠️ Ważne:</strong> Serverless storage jest tymczasowy.<br>
            Dodaj te wartości do Vercel Environment Variables dla trwałości:
            <pre style="text-align: left; background: #f5f5f5; padding: 10px; overflow: auto; font-size: 11px;">
EBAY_CLIENT_ID=${clientId}
EBAY_CLIENT_SECRET=${clientSecret}
EBAY_REFRESH_TOKEN=${tokenData.refresh_token}
            </pre>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'EBAY_OAUTH_SUCCESS' }, '*');
            }
            setTimeout(() => window.close(), 10000);
          </script>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('❌ Token exchange error:', err.message);
    
    return res.send(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Błąd połączenia</h1>
          <p>${err.message}</p>
          <p>Zamknij to okno i spróbuj ponownie.</p>
        </body>
      </html>
    `);
  }
}
