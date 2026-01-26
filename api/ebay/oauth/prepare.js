import { loadStoredTokens, saveStoredTokens, jsonResponse } from '../_utils.js';

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
      return jsonResponse({ error: 'Wymagane: clientId i clientSecret' }, 400);
    }

    const stored = loadStoredTokens();
    saveStoredTokens({
      ...stored,
      pendingClientId: clientId.trim(),
      pendingClientSecret: clientSecret.trim()
    });

    console.log('📝 Credentials zapisane (pending)');
    return jsonResponse({ 
      success: true, 
      message: 'Credentials zapisane. Teraz kliknij "Połącz z eBay".' 
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}
