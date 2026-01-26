import { saveStoredTokens, setTokenCache, jsonResponse } from '../_utils.js';

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

  saveStoredTokens({
    refreshToken: null,
    connectedAt: null,
    clientId: null,
    clientSecret: null,
    connected: false,
    error: null
  });

  setTokenCache({ accessToken: null, expiresAt: 0, forClientId: null });

  console.log('🔌 eBay disconnected');
  return jsonResponse({ success: true, message: 'Rozłączono z eBay' });
}
