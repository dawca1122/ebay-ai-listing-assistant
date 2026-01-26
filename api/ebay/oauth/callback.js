import { 
  loadStoredTokens, 
  saveStoredTokens, 
  setTokenCache,
  getRedirectUri,
  EBAY_TOKEN_URL,
  htmlResponse 
} from '../_utils.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  console.log('🎫 OAuth Callback received');

  if (error) {
    console.error(`❌ OAuth Error: ${error} - ${errorDescription}`);
    return htmlResponse(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Błąd autoryzacji</h1>
          <p><strong>${error}</strong>: ${errorDescription}</p>
          <p>Zamknij to okno i spróbuj ponownie.</p>
          <script>setTimeout(() => window.close(), 5000);</script>
        </body>
      </html>
    `);
  }

  if (!code) {
    return htmlResponse(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Brak kodu autoryzacji</h1>
          <p>Zamknij to okno i spróbuj ponownie.</p>
        </body>
      </html>
    `);
  }

  const stored = loadStoredTokens();
  const clientId = stored.pendingClientId;
  const clientSecret = stored.pendingClientSecret;

  if (!clientId || !clientSecret) {
    return htmlResponse(`
      <html>
        <head><title>eBay OAuth - Błąd</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: red;">❌ Sesja wygasła</h1>
          <p>Kliknij "Połącz z eBay" ponownie w aplikacji.</p>
        </body>
      </html>
    `);
  }

  const redirectUri = getRedirectUri(req);

  try {
    console.log('   Exchanging code for tokens...');
    
    const authHeader = btoa(`${clientId}:${clientSecret}`);
    
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
      saveStoredTokens({ 
        error: tokenData.error_description || tokenData.error,
        connected: false 
      });

      return htmlResponse(`
        <html>
          <head><title>eBay OAuth - Błąd</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1 style="color: red;">❌ Błąd wymiany tokenu</h1>
            <p><strong>${tokenData.error}</strong>: ${tokenData.error_description}</p>
            <p>Upewnij się że Redirect URI w eBay Developer Portal to:<br><code>${redirectUri}</code></p>
            <p>Zamknij to okno i spróbuj ponownie.</p>
          </body>
        </html>
      `);
    }

    console.log('✅ Token exchange SUCCESS!');

    // Save refresh token
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
    setTokenCache({
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000) - (5 * 60 * 1000),
      forClientId: clientId
    });

    return htmlResponse(`
      <html>
        <head><title>eBay OAuth - Sukces</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: green;">✅ Połączono z eBay!</h1>
          <p>Możesz zamknąć to okno i wrócić do aplikacji.</p>
          <p style="color: gray; font-size: 12px;">To okno zamknie się automatycznie...</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'EBAY_OAUTH_SUCCESS' }, '*');
            }
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('❌ Token exchange error:', err.message);
    return htmlResponse(`
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
