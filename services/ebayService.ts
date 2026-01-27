import { Product, AppSettings, EBAY_DE_CONSTANTS } from "../types";

// API Base - relative URL works both locally (with Vite proxy) and on Vercel
const API_BASE = "/api/ebay";

// Legacy: Get access token from localStorage (for backward compatibility)
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

// Common fetch options to include credentials (cookies) AND localStorage token as fallback
const fetchWithCredentials = (url: string, options: RequestInit = {}) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  
  // Always include localStorage token as Authorization header (fallback for when cookies don't work)
  const accessToken = getAccessToken();
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });
};

// ============================================
// OAuth Status - now checks backend via cookies
// ============================================
export interface OAuthStatus {
  connected: boolean;
  expiresAt: number | null;
  needsRefresh?: boolean;
  hasRefreshToken?: boolean;
}

// Helper to check localStorage tokens
const checkLocalStorageTokens = (): OAuthStatus => {
  const stored = localStorage.getItem('ebay_oauth_tokens');
  if (!stored) return { connected: false, expiresAt: null };
  try {
    const tokens = JSON.parse(stored);
    const connected = tokens.expiresAt > Date.now() + (5 * 60 * 1000);
    return { 
      connected, 
      expiresAt: tokens.expiresAt,
      hasRefreshToken: !!tokens.refreshToken
    };
  } catch {
    return { connected: false, expiresAt: null };
  }
};

export const getOAuthStatus = async (): Promise<OAuthStatus> => {
  try {
    const response = await fetchWithCredentials(`${API_BASE}/oauth/status`);
    const data = await response.json();
    
    // If API says connected via cookies, use that
    if (data.connected) {
      return {
        connected: true,
        expiresAt: data.expiresAt || null,
        needsRefresh: data.needsRefresh,
        hasRefreshToken: data.hasRefreshToken
      };
    }
    
    // If API says not connected, check localStorage as fallback
    // (cookies might not work but tokens might be in localStorage)
    const localStatus = checkLocalStorageTokens();
    if (localStatus.connected) {
      console.log('[OAuth] Using localStorage tokens (cookies not available)');
      return localStatus;
    }
    
    return { connected: false, expiresAt: null };
  } catch (error) {
    console.error('Failed to get OAuth status:', error);
    // Fallback to localStorage for backward compatibility
    return checkLocalStorageTokens();
  }
};

// ============================================
// Test połączenia (używa cookie lub tokenu z localStorage)
// ============================================
export const testEbayConnection = async (): Promise<{ 
  success: boolean; 
  message: string; 
  hint?: string; 
  details?: any;
  categoryTreeId?: string;
}> => {
  try {
    // First try with cookies
    const response = await fetchWithCredentials(`${API_BASE}/test`, {
      method: 'GET',
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      return {
        success: true,
        message: `Połączono z eBay! Category Tree ID: ${result.categoryTreeId}`,
        categoryTreeId: result.categoryTreeId
      };
    }
    
    // If no cookie auth, try with localStorage token as fallback
    if (response.status === 401) {
      const accessToken = getAccessToken();
      if (accessToken) {
        const fallbackResponse = await fetch(`${API_BASE}/test`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const fallbackResult = await fallbackResponse.json();
        
        if (fallbackResponse.ok && fallbackResult.success) {
          return {
            success: true,
            message: `Połączono z eBay! Category Tree ID: ${fallbackResult.categoryTreeId}`,
            categoryTreeId: fallbackResult.categoryTreeId
          };
        }
      }
      
      return {
        success: false,
        message: 'Nie jesteś połączony z eBay',
        hint: 'Kliknij "Połącz z eBay" w ustawieniach'
      };
    }
    
    return { 
      success: false, 
      message: result.error || result.message || 'Błąd połączenia',
      hint: result.hint || 'Sprawdź konfigurację'
    };
    
  } catch (error: any) {
    return { 
      success: false, 
      message: error.message || "Nie można połączyć z backend proxy",
      hint: "Sprawdź połączenie internetowe"
    };
  }
};

// ============================================
// Fetch Policies
// ============================================
export interface PolicyItem {
  policyId: string;
  name: string;
  description?: string;
}

export interface PoliciesData {
  paymentPolicies: PolicyItem[];
  fulfillmentPolicies: PolicyItem[];
  returnPolicies: PolicyItem[];
}

export const fetchPolicies = async (): Promise<PoliciesData> => {
  let response = await fetchWithCredentials(`${API_BASE}/account/policies`, {
    method: 'GET',
  });
  
  // Fallback to Authorization header if 401
  if (response.status === 401) {
    const accessToken = getAccessToken();
    if (accessToken) {
      response = await fetch(`${API_BASE}/account/policies`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
    }
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
};

// ============================================
// Fetch Locations
// ============================================
export interface LocationData {
  merchantLocationKey: string;
  name?: string;
  address?: {
    city?: string;
    postalCode?: string;
    country?: string;
  };
}

export const fetchLocations = async (): Promise<{ locations: LocationData[] }> => {
  let response = await fetchWithCredentials(`${API_BASE}/account/locations`, {
    method: 'GET',
  });
  
  if (response.status === 401) {
    const accessToken = getAccessToken();
    if (accessToken) {
      response = await fetch(`${API_BASE}/account/locations`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
    }
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
};

// ============================================
// Create Location
// ============================================
export const createLocation = async (
  merchantLocationKey: string,
  name: string,
  address: { city: string; postalCode: string; country: string }
): Promise<{ success: boolean; merchantLocationKey: string }> => {
  let response = await fetchWithCredentials(`${API_BASE}/account/locations`, {
    method: 'POST',
    body: JSON.stringify({ merchantLocationKey, name, address }),
  });
  
  if (response.status === 401) {
    const accessToken = getAccessToken();
    if (accessToken) {
      response = await fetch(`${API_BASE}/account/locations`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ merchantLocationKey, name, address }),
      });
    }
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
};

// ============================================
// Category Suggestion
// ============================================
export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  relevancy?: number;
}

export const getCategorySuggestions = async (query: string): Promise<{ suggestions: CategorySuggestion[] }> => {
  let response = await fetchWithCredentials(`${API_BASE}/category/suggest`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  
  if (response.status === 401) {
    const accessToken = getAccessToken();
    if (accessToken) {
      response = await fetch(`${API_BASE}/category/suggest`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ query }),
      });
    }
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
};

// ============================================
// Store Categories - Get categories from eBay store
// ============================================
export interface StoreCategory {
  name: string;
  categoryId: string;
}

export const fetchStoreCategories = async (): Promise<{ categories: StoreCategory[]; source: string; hint?: string }> => {
  let response = await fetchWithCredentials(`${API_BASE}/store/categories`, {
    method: 'GET',
  });
  
  if (response.status === 401) {
    const accessToken = getAccessToken();
    if (accessToken) {
      response = await fetch(`${API_BASE}/store/categories`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
    }
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
};

// ============================================
// Market Price Check
// ============================================
export interface MarketPriceResult {
  query: string;
  totalResults: number;
  items: Array<{
    title: string;
    price: number;
    currency: string;
    shipping: number;
    total: number;
    seller: string;
    condition: string;
    itemId: string;
  }>;
  statistics: {
    count: number;
    min: number;
    max: number;
    median: number;
    average: number;
  };
}

export const checkMarketPrices = async (ean?: string, keywords?: string): Promise<MarketPriceResult> => {
  console.log('[checkMarketPrices] Starting with:', { ean, keywords });
  
  let response = await fetchWithCredentials(`${API_BASE}/market/price-check`, {
    method: 'POST',
    body: JSON.stringify({ ean, keywords }),
  });
  
  console.log('[checkMarketPrices] Response status:', response.status);
  
  if (response.status === 401) {
    console.log('[checkMarketPrices] Got 401, trying with localStorage token');
    const accessToken = getAccessToken();
    if (accessToken) {
      response = await fetch(`${API_BASE}/market/price-check`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ ean, keywords }),
      });
      console.log('[checkMarketPrices] Retry response status:', response.status);
    }
  }
  
  if (!response.ok) {
    const error = await response.json();
    console.error('[checkMarketPrices] Error:', error);
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  const result = await response.json();
  console.log('[checkMarketPrices] Success:', { query: result.query, count: result.items?.length, stats: result.statistics });
  return result;
};

// ============================================
// Validate Draft
// ============================================
export interface DraftValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  pricing: {
    gross: number;
    net: number;
    vat: number;
    vatRate: string;
  };
  payloads: {
    inventory: any;
    offer: any;
  };
}

export const validateDraft = async (
  product: Product,
  policies: {
    paymentPolicyId?: string;
    fulfillmentPolicyId?: string;
    returnPolicyId?: string;
    merchantLocationKey?: string;
  }
): Promise<DraftValidationResult> => {
  const response = await fetchWithCredentials(`${API_BASE}/listing/draft`, {
    method: 'POST',
    body: JSON.stringify({ product, policies }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return await response.json();
};

// ============================================
// Publikacja produktu na eBay (via new endpoint)
// ============================================
export const publishToEbay = async (
  product: Product,
  settings: AppSettings
): Promise<{ 
  success: boolean; 
  listingId?: string; 
  offerId?: string;
  error?: string;
  step?: string;
  ebayErrorId?: number;
  details?: any;
}> => {
  try {
    // Try new endpoint with cookies first
    let response = await fetchWithCredentials(`${API_BASE}/listing/publish`, {
      method: 'POST',
      body: JSON.stringify({
        product: {
          sku: product.sku,
          title: product.title,
          descriptionHtml: product.descriptionHtml,
          ean: product.ean,
          images: product.images,
          condition: product.condition || 'NEW',
          priceGross: product.priceGross,
          quantity: product.quantity || 1,
          ebayCategoryId: product.ebayCategoryId,
          aspects: {}
        },
        policies: {
          paymentPolicyId: settings.policies.paymentPolicyId,
          fulfillmentPolicyId: settings.policies.fulfillmentPolicyId,
          returnPolicyId: settings.policies.returnPolicyId,
          merchantLocationKey: settings.policies.merchantLocationKey
        }
      }),
    });
    
    // Fallback to Authorization header if 401
    if (response.status === 401) {
      const accessToken = getAccessToken();
      if (accessToken) {
        response = await fetch(`${API_BASE}/listing/publish`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            product: {
              sku: product.sku,
              title: product.title,
              descriptionHtml: product.descriptionHtml,
              ean: product.ean,
              images: product.images,
              condition: product.condition || 'NEW',
              priceGross: product.priceGross,
              quantity: product.quantity || 1,
              ebayCategoryId: product.ebayCategoryId,
              aspects: {}
            },
            policies: {
              paymentPolicyId: settings.policies.paymentPolicyId,
              fulfillmentPolicyId: settings.policies.fulfillmentPolicyId,
              returnPolicyId: settings.policies.returnPolicyId,
              merchantLocationKey: settings.policies.merchantLocationKey
            }
          }),
        });
      }
    }
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Publikacja nie powiodła się',
        step: data.step,
        ebayErrorId: data.ebayErrorId,
        details: data.details
      };
    }
    
    return {
      success: true,
      listingId: data.listingId,
      offerId: data.offerId,
    };
    
  } catch (error: any) {
    console.error("eBay publish error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// ============================================
// OAuth Actions
// ============================================

// Returns the URL to open in popup - backend will redirect to eBay
export const getOAuthStartUrl = (): string => {
  return `${API_BASE}/oauth/start`;
};

// Legacy: startOAuth for backward compatibility
export const startOAuth = async (): Promise<{ authUrl: string; state: string }> => {
  // Now we just return the endpoint URL since backend does 302 redirect
  return { 
    authUrl: getOAuthStartUrl(),
    state: '' 
  };
};

export const refreshOAuthToken = async (): Promise<{ success: boolean; expiresAt?: number }> => {
  const response = await fetchWithCredentials(`${API_BASE}/oauth/refresh`, {
    method: 'POST',
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to refresh token');
  }
  
  return await response.json();
};

export const disconnectOAuth = async (): Promise<{ success: boolean }> => {
  const response = await fetchWithCredentials(`${API_BASE}/oauth/disconnect`, {
    method: 'POST',
  });
  
  // Also clear localStorage
  localStorage.removeItem('ebay_oauth_tokens');
  
  return await response.json();
};
