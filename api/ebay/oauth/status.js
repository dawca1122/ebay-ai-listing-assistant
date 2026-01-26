import { loadStoredTokens, getRedirectUri, jsonResponse } from '../_utils.js';

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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const stored = loadStoredTokens();
  const redirectUri = getRedirectUri(req);

  return jsonResponse({
    connected: !!stored.refreshToken && stored.connected,
    connectedAt: stored.connectedAt,
    clientId: stored.clientId ? stored.clientId.substring(0, 20) + '...' : null,
    error: stored.error,
    hasRefreshToken: !!stored.refreshToken,
    redirectUri
  });
}
