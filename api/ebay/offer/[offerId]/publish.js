import { getValidToken, jsonResponse } from '../../_utils.js';

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
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    // Path: /api/ebay/offer/[offerId]/publish
    const offerId = pathParts[pathParts.length - 2];

    const token = await getValidToken();

    const response = await fetch(
      `https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return jsonResponse(data, response.status);
    }

    return jsonResponse(data);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}
