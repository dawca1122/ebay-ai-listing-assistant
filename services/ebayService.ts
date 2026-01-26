import { Product, AppSettings } from "../types";

// Backend proxy URL
const API_BASE = "http://localhost:3001/api/ebay";

// ============================================
// OAuth Status
// ============================================
export interface OAuthStatus {
  connected: boolean;
  connectedAt: string | null;
  clientId: string | null;
  error: string | null;
  hasRefreshToken: boolean;
  redirectUri: string;
}

export const getOAuthStatus = async (): Promise<OAuthStatus> => {
  const response = await fetch(`${API_BASE}/oauth/status`);
  return response.json();
};

// ============================================
// Test połączenia (używa zapisanych credentials z OAuth)
// ============================================
export const testEbayConnection = async (settings?: AppSettings): Promise<{ 
  success: boolean; 
  message: string; 
  hint?: string; 
  details?: any;
  debug?: any;
}> => {
  try {
    const response = await fetch(`${API_BASE}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return await response.json();
  } catch (error: any) {
    return { 
      success: false, 
      message: error.message || "Nie można połączyć z backend proxy",
      hint: "Upewnij się że backend działa na localhost:3001"
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
  try {
    // 1. Utwórz/zaktualizuj inventory item
    const inventoryResponse = await fetch(`${API_BASE}/inventory/${encodeURIComponent(product.sku)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        availability: {
          shipToLocationAvailability: {
            quantity: product.quantity || 1,
          },
        },
        condition: "NEW",
        product: {
          title: product.title,
          description: product.descriptionHtml,
          aspects: {},
          imageUrls: [],
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: product.sku,
        marketplaceId: settings.ebay.marketplace,
        format: "FIXED_PRICE",
        listingDescription: product.descriptionHtml,
        availableQuantity: product.quantity || 1,
        pricingSummary: {
          price: {
            value: product.finalPrice?.toString() || "0",
            currency: "EUR",
          },
        },
        listingPolicies: {
          fulfillmentPolicyId: settings.policies.fulfillmentId,
          paymentPolicyId: settings.policies.paymentId,
          returnPolicyId: settings.policies.returnId,
        },
        merchantLocationKey: settings.policies.merchantLocationKey,
        categoryId: product.categoryId,
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
      headers: { 'Content-Type': 'application/json' },
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
