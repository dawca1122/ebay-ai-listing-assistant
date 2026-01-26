import { loadStoredTokens, getValidToken, getRedirectUri, jsonResponse } from '../_utils.js';

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

  console.log('🚀 ========== TEST POŁĄCZENIA ==========');

  const stored = loadStoredTokens();
  const redirectUri = getRedirectUri(req);

  if (!stored.refreshToken) {
    return jsonResponse({
      success: false,
      message: 'Brak połączenia z eBay',
      hint: 'Najpierw kliknij "Połącz z eBay (OAuth)" aby autoryzować aplikację.',
      debug: {
        connected: false,
        hasRefreshToken: false,
        redirectUri
      }
    }, 400);
  }

  try {
    const token = await getValidToken();

    // Test Taxonomy API
    console.log('🧪 Testing eBay Taxonomy API...');
    const response = await fetch(
      'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`eBay Taxonomy Error (${response.status}): ${err.errors?.[0]?.message || response.statusText}`);
    }

    const categoryData = await response.json();
    console.log(`✅ Category Tree ID: ${categoryData.categoryTreeId}`);

    return jsonResponse({
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
        accessTokenReceived: true
      }
    });

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    return jsonResponse({
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
    }, 500);
  }
}
