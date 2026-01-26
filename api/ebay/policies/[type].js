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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    // Path: /api/ebay/policies/[type]
    const type = pathParts[pathParts.length - 1];

    const token = await getValidToken();

    const response = await fetch(
      `https://api.ebay.com/sell/account/v1/${type}_policy?marketplace_id=EBAY_DE`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();
    return jsonResponse(data, response.ok ? 200 : response.status);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}
