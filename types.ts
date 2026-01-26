
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

// Dostępne modele Gemini
export const GEMINI_MODELS = {
  // Szybkie, tanie - do masowych zadań
  'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', desc: 'Szybki, tani - masowe zapytania', tier: 'fast' },
  'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', desc: 'Stabilny, prosty chat', tier: 'fast' },
  'gemini-flash-lite': { name: 'Gemini Flash Lite', desc: 'Ultra tani, szybki', tier: 'fast' },
  // Dokładne - do złożonych zadań
  'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', desc: 'Dokładny, złożone myślenie', tier: 'pro' },
  'gemini-pro-latest': { name: 'Gemini Pro Latest', desc: 'Najnowszy Pro', tier: 'pro' },
  // Preview / Experimental
  'gemini-3-flash-preview': { name: 'Gemini 3 Flash Preview', desc: 'Nowa generacja', tier: 'preview' },
  'gemini-3-pro-preview': { name: 'Gemini 3 Pro Preview', desc: 'Nowa generacja Pro', tier: 'preview' },
  // Research
  'deep-research-pro-preview': { name: 'Deep Research Pro', desc: 'Długie badania, raporty, bardzo dokładny', tier: 'research' },
} as const;

export type GeminiModelId = keyof typeof GEMINI_MODELS;

// Ustawienia modeli dla różnych zadań
export interface GeminiModelSettings {
  titleDescription: GeminiModelId;    // Tytuły i opisy produktów
  priceSearch: GeminiModelId;         // Szukanie cen konkurencji
  tableAnalysis: GeminiModelId;       // Analiza tabeli importu
  categorySearch: GeminiModelId;      // Szukanie kategorii eBay
}

// Instrukcje AI dla różnych zadań
export interface AiInstructions {
  titlePrompt: string;                // Instrukcje dla generowania tytułów
  descriptionPrompt: string;          // Instrukcje dla opisów
  priceSearchPrompt: string;          // Instrukcje szukania cen
  tableAnalysisPrompt: string;        // Instrukcje analizy tabeli
  categoryPrompt: string;             // Instrukcje szukania kategorii
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
  geminiModels: GeminiModelSettings;  // Wybór modeli
  aiInstructions: AiInstructions;     // Instrukcje
  aiRules: AiRules;
  pricingRules: PricingRules;
  vatRate: number;             // 0.19 dla DE (stałe)
}

// Domyślne ustawienia modeli
export const DEFAULT_GEMINI_MODELS: GeminiModelSettings = {
  titleDescription: 'gemini-2.5-flash',
  priceSearch: 'gemini-2.5-flash',
  tableAnalysis: 'gemini-2.5-pro',
  categorySearch: 'gemini-2.5-flash',
};

// Domyślne instrukcje AI
export const DEFAULT_AI_INSTRUCTIONS: AiInstructions = {
  titlePrompt: `Generuj profesjonalne tytuły do aukcji eBay.de w języku niemieckim.
- Max 80 znaków
- Zawieraj markę, model, kluczowe cechy
- Nie używaj caps lock ani wykrzykników
- Format: Marka Model - Cechy - Stan`,
  descriptionPrompt: `Generuj opisy produktów dla eBay.de w HTML.
- Język niemiecki
- Profesjonalny ton
- Zawieraj specyfikacje techniczne
- Użyj tagów HTML do formatowania`,
  priceSearchPrompt: `Szukaj aktualnych ofert na eBay.de dla podanego produktu.
- Najpierw szukaj po EAN, potem po nazwie
- Znajdź cenę łączną (produkt + wysyłka do Niemiec)
- Ignoruj oferty z dostawą >7 dni`,
  tableAnalysisPrompt: `Analizuj strukturę tabeli importu i dopasuj kolumny.
- Rozpoznaj EAN/GTIN, nazwy produktów, ceny, ilości
- Uwzględnij polskie i niemieckie nazwy kolumn`,
  categoryPrompt: `Znajdź najlepszą kategorię eBay.de dla produktu.
- Zwróć ID kategorii z drzewa 77 (EBAY_DE)
- Wybierz najbardziej szczegółową pasującą kategorię`,
};

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
  imageUrl: string;            // Link do zdjęcia (główny)
  images?: string[];           // Dodatkowe zdjęcia
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
