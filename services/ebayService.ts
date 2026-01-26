import { Product, AppSettings, EBAY_DE_CONSTANTS } from "../types";

// API Base - relative URL works both locally (with Vite proxy) and on Vercel
const API_BASE = "/api/ebay";

// Helper to get access token from localStorage
const getAccessToken = (): string | null => {
  const stored = localStorage.getItem('ebay_oauth_tokens');
  if (!stored) return null;
  try {
    const tokens = JSON.parse(stored);
    return tokens.accessToken;
  } catch {
    return null;
  }
};

// ============================================
// OAuth Status (from localStorage)
// ============================================
export interface OAuthStatus {
  connected: boolean;
  expiresAt: number | null;
}

export const getOAuthStatus = (): OAuthStatus => {
  const stored = localStorage.getItem('ebay_oauth_tokens');
  if (!stored) return { connected: false, expiresAt: null };
  try {
    const tokens = JSON.parse(stored);
    const connected = tokens.expiresAt > Date.now() + (5 * 60 * 1000);
    return { connected, expiresAt: tokens.expiresAt };
  } catch {
    return { connected: false, expiresAt: null };
  }
};

// ============================================
// Test połączenia (używa tokenu z localStorage)
// ============================================
export const testEbayConnection = async (): Promise<{ 
  success: boolean; 
  message: string; 
  hint?: string; 
  details?: any;
  debug?: any;
}> => {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return {
      success: false,
      message: 'Nie jesteś połączony z eBay',
      hint: 'Kliknij "Połącz z eBay" w ustawieniach'
    };
  }
  
  try {
    const response = await fetch(`${API_BASE}/test-connection`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return await response.json();
  } catch (error: any) {
    return { 
      success: false, 
      message: error.message || "Nie można połączyć z backend proxy",
      hint: "Sprawdź połączenie internetowe"
    };
  }
};

// ============================================
// Publikacja produktu na eBay
// ============================================
export const publishToEbay = async (
  product: Product,
  settings: AppSettings
): Promise<{ success: boolean; listingId?: string; error?: string }> => {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return { success: false, error: 'Nie jesteś zalogowany do eBay' };
  }
  
  try {
    // 1. Utwórz/zaktualizuj inventory item
    const inventoryResponse = await fetch(`${API_BASE}/inventory/${encodeURIComponent(product.sku)}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        availability: {
          shipToLocationAvailability: {
            quantity: product.quantity || 1,
          },
        },
        condition: product.condition || "NEW",
        product: {
          title: product.title,
          description: product.descriptionHtml,
          aspects: {},
          imageUrls: product.images || [],
          ean: [product.ean]
        },
      }),
    });

    if (!inventoryResponse.ok) {
      const err = await inventoryResponse.json();
      throw new Error(`Inventory Error: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
    }

    // 2. Utwórz ofertę
    const offerResponse = await fetch(`${API_BASE}/offer`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        sku: product.sku,
        marketplaceId: EBAY_DE_CONSTANTS.MARKETPLACE_ID,
        format: "FIXED_PRICE",
        listingDescription: product.descriptionHtml,
        availableQuantity: product.quantity || 1,
        pricingSummary: {
          price: {
            value: product.priceGross?.toString() || "0",
            currency: EBAY_DE_CONSTANTS.CURRENCY,
          },
        },
        listingPolicies: {
          fulfillmentPolicyId: settings.policies.fulfillmentPolicyId,
          paymentPolicyId: settings.policies.paymentPolicyId,
          returnPolicyId: settings.policies.returnPolicyId,
        },
        merchantLocationKey: settings.policies.merchantLocationKey,
        categoryId: product.ebayCategoryId,
      }),
    });

    if (!offerResponse.ok) {
      const err = await offerResponse.json();
      throw new Error(`Offer Error: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
    }

    const offerData = await offerResponse.json();
    const offerId = offerData.offerId;

    // 3. Opublikuj ofertę
    const publishResponse = await fetch(`${API_BASE}/offer/${offerId}/publish`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
    });

    if (!publishResponse.ok) {
      const err = await publishResponse.json();
      throw new Error(`Publish Error: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
    }

    const publishData = await publishResponse.json();

    return {
      success: true,
      listingId: publishData.listingId,
    };
  } catch (error: any) {
    console.error("eBay publish error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};
