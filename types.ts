
export enum ProductStatus {
  DRAFT = 'DRAFT',
  PRICING = 'PRICING',
  READY = 'READY',
  PUBLISHED = 'PUBLISHED',
  ERROR = 'ERROR'
}

export interface EbayPolicies {
  fulfillmentId: string;
  paymentId: string;
  returnId: string;
  locationPostalCode: string;
  merchantLocationKey: string; // Kluczowy dla Inventory API
}

export interface EbayCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplace: string;
}

export interface AiRules {
  skuRules: string;
  titleRules: string;
  descriptionRules: string;
  forbiddenWords: string;
  systemPrompt: string;
}

export interface PricingRules {
  undercut: number;
  priceFloor: number;
  maxDeliveryDays: number;
  ignoreOutliers: boolean;
}

export interface AppSettings {
  ebay: EbayCredentials;
  policies: EbayPolicies;
  geminiKey: string;
  aiRules: AiRules;
  pricingRules: PricingRules;
}

export interface Product {
  id: string;
  ean: string;
  inputName: string;
  sku: string;
  title: string;
  descriptionHtml: string;
  keywords: string;
  categoryId: string;
  categoryName: string;
  suggestedPrice: number;
  finalPrice: number;
  quantity: number;
  status: ProductStatus;
  ebayOfferId: string;
  ebayItemId: string;
  errorMessage: string;
  createdAt: number;
  minTotalCompetition?: number;
  medianTotalCompetition?: number;
  pricingRuleApplied?: string;
  pricingWarnings?: string[];
}
