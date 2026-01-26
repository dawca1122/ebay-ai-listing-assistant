
export enum ProductStatus {
  DRAFT = 'DRAFT',                     // Nowy, nic nie zrobione
  AI_PROCESSING = 'AI_PROCESSING',     // Trwa generowanie AI
  AI_DONE = 'AI_DONE',                 // AI wygenerowało SKU/Title/Desc
  ERROR_AI = 'ERROR_AI',               // Błąd AI
  CATEGORY_DONE = 'CATEGORY_DONE',     // Kategoria dobrana
  ERROR_CATEGORY = 'ERROR_CATEGORY',   // Błąd kategorii
  PRICE_CHECK_DONE = 'PRICE_CHECK_DONE', // Ceny konkurencji sprawdzone
  ERROR_PRICECHECK = 'ERROR_PRICECHECK', // Błąd sprawdzania cen
  PRICE_SET_DONE = 'PRICE_SET_DONE',   // Cena ustawiona
  DRAFT_OK = 'DRAFT_OK',               // Gotowy do publikacji (DRAFT zbudowany)
  ERROR_DRAFT = 'ERROR_DRAFT',         // Błąd budowania draftu
  PUBLISHED = 'PUBLISHED',             // Opublikowany na eBay
  ERROR_PUBLISH = 'ERROR_PUBLISH'      // Błąd publikacji
}

export enum ProductCondition {
  NEW = 'NEW',
  USED = 'USED',
  REFURBISHED = 'REFURBISHED'
}

// ============ USTAWIENIA GLOBALNE ============

export interface EbayCredentials {
  clientId: string;
  clientSecret: string;
  ruName: string;              // RuName dla OAuth (nie URL!)
  marketplace: string;         // EBAY_DE (stałe)
}

export interface EbayPolicies {
  paymentPolicyId: string;
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
}

export interface PricingRules {
  undercutMode: 'lowest' | 'median' | 'manual';
  undercutBy: number;          // np. 0.01 EUR
  minGrossPrice: number;       // minimalna cena brutto
}

export interface AiRules {
  skuRules: string;
  titleRules: string;
  descriptionRules: string;
  forbiddenWords: string;
  systemPrompt: string;
}

export interface AppSettings {
  ebay: EbayCredentials;
  policies: EbayPolicies;
  geminiKey: string;
  aiRules: AiRules;
  pricingRules: PricingRules;
  vatRate: number;             // 0.19 dla DE (stałe)
}

// ============ PRODUKT ============

export interface CompetitorPrice {
  price: number;
  shipping: number;
  total: number;
  seller: string;
  deliveryDays?: number;
}

export interface Product {
  id: string;
  
  // Dane wejściowe (wklejane)
  ean: string;
  inputName: string;           // productName
  shopCategory: string;        // wewnętrzna kategoria sklepu (nie idzie do eBay)
  quantity: number;
  condition: ProductCondition;
  
  // Generowane przez AI
  sku: string;
  title: string;
  descriptionHtml: string;
  keywords: string;
  
  // Kategoria eBay (AI dobiera)
  ebayCategoryId: string;
  ebayCategoryName: string;
  
  // Ceny
  competitorPrices: CompetitorPrice[];
  minTotalCompetition?: number;
  medianTotalCompetition?: number;
  priceGross: number;          // cena brutto (finalna)
  priceNet: number;            // cena netto (priceGross / 1.19)
  pricingRuleApplied?: string;
  pricingWarnings?: string[];
  
  // Status pipeline
  status: ProductStatus;
  ebayOfferId: string;
  ebayItemId: string;
  lastError: string;
  
  // Meta
  createdAt: number;
  images?: string[];
}

// Stałe dla EBAY_DE
export const EBAY_DE_CONSTANTS = {
  MARKETPLACE_ID: 'EBAY_DE',
  VAT_RATE: 0.19,
  CURRENCY: 'EUR',
  CATEGORY_TREE_ID: '77'
};

// ============ LOGI / DEBUG ============

export enum LogStage {
  AI = 'AI',
  CATEGORY = 'CATEGORY',
  PRICE_CHECK = 'PRICE_CHECK',
  PRICE_SET = 'PRICE_SET',
  DRAFT = 'DRAFT',
  PUBLISH = 'PUBLISH'
}

export interface LogEntry {
  id: string;
  timestamp: number;
  productId: string;
  sku: string;
  ean: string;
  stage: LogStage;
  action: string;               // np. "AI Generate", "Publish Offer"
  success: boolean;
  
  // Request/Response
  requestUrl?: string;
  requestMethod?: string;
  requestPayload?: any;
  responseStatus?: number;
  responseBody?: any;
  
  // eBay specific
  ebayErrorId?: string;
  ebayErrorMessage?: string;
  
  // Hints for debugging
  hint?: string;
  
  // Payloads for eBay
  inventoryPayload?: any;
  offerPayload?: any;
  publishResponse?: any;
}
