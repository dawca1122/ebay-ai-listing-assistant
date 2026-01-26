import React, { useState, useMemo } from 'react';
import { Product, ProductStatus, ProductCondition, AppSettings, LogEntry, LogStage, EBAY_DE_CONSTANTS} from '../types';
import { generateProductDetails, suggestCategory } from '../services/geminiService';

interface ProductsTabProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  settings: AppSettings;
  ebayConnected: boolean;
  onError: (msg: string) => void;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

// Helper to get tokens from localStorage
const getStoredTokens = () => {
  const stored = localStorage.getItem('ebay_oauth_tokens');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

const API_BASE = '/api/ebay';

// Status colors and labels
const STATUS_CONFIG: Record<ProductStatus, { bg: string; text: string; label: string }> = {
  [ProductStatus.DRAFT]: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Draft' },
  [ProductStatus.AI_PROCESSING]: { bg: 'bg-blue-100', text: 'text-blue-600', label: 'AI...' },
  [ProductStatus.AI_DONE]: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'AI OK' },
  [ProductStatus.ERROR_AI]: { bg: 'bg-red-100', text: 'text-red-600', label: 'AI Err' },
  [ProductStatus.CATEGORY_DONE]: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Cat OK' },
  [ProductStatus.ERROR_CATEGORY]: { bg: 'bg-red-100', text: 'text-red-600', label: 'Cat Err' },
  [ProductStatus.PRICE_CHECK_DONE]: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Price OK' },
  [ProductStatus.ERROR_PRICECHECK]: { bg: 'bg-red-100', text: 'text-red-600', label: 'Price Err' },
  [ProductStatus.PRICE_SET_DONE]: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Price Set' },
  [ProductStatus.DRAFT_OK]: { bg: 'bg-green-100', text: 'text-green-700', label: 'Ready' },
  [ProductStatus.ERROR_DRAFT]: { bg: 'bg-red-100', text: 'text-red-600', label: 'Draft Err' },
  [ProductStatus.PUBLISHED]: { bg: 'bg-green-200', text: 'text-green-800', label: 'Published' },
  [ProductStatus.ERROR_PUBLISH]: { bg: 'bg-red-100', text: 'text-red-600', label: 'Pub Err' },
};

const ProductsTab: React.FC<ProductsTabProps> = ({ products, setProducts, settings, ebayConnected, onError, addLog }) => {
  // State
  const [bulkInput, setBulkInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterShopCategory, setFilterShopCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');

  // Get unique shop categories for filter
  const shopCategories = useMemo(() => {
    const cats = new Set(products.map(p => p.shopCategory).filter(Boolean));
    return Array.from(cats).sort();
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (filterShopCategory && p.shopCategory !== filterShopCategory) return false;
      if (filterStatus && p.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!p.ean.toLowerCase().includes(q) && 
            !p.title.toLowerCase().includes(q) && 
            !p.sku.toLowerCase().includes(q) &&
            !p.inputName.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [products, filterShopCategory, filterStatus, searchQuery]);

  // Update single product
  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // ============ IMPORT ============
  const handleBulkImport = () => {
    const lines = bulkInput.split('\n').filter(line => line.trim() !== '');
    const newItems: Product[] = [];

    // Format: EAN | productName | shopCategory
    lines.forEach(line => {
      const parts = line.split('|').map(p => p.trim());
      const ean = parts[0] || '';
      const name = parts[1] || '';
      const shopCategory = parts[2] || '';

      if (ean && name) {
        newItems.push({
          id: crypto.randomUUID().split('-')[0],
          ean,
          inputName: name,
          shopCategory,
          quantity: 1,
          condition: ProductCondition.NEW,
          sku: '',
          title: '',
          descriptionHtml: '',
          keywords: '',
          ebayCategoryId: '',
          ebayCategoryName: '',
          competitorPrices: [],
          priceGross: 0,
          priceNet: 0,
          status: ProductStatus.DRAFT,
          ebayOfferId: '',
          ebayItemId: '',
          lastError: '',
          createdAt: Date.now()
        });
      }
    });

    if (newItems.length > 0) {
      setProducts(prev => [...newItems, ...prev]);
      setBulkInput('');
    } else {
      onError("Błąd formatu. Użyj: EAN | NAZWA | KATEGORIA");
    }
  };

  // ============ SELECTION ============
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const getSelectedProducts = () => products.filter(p => selectedIds.has(p.id));

  // ============ PIPELINE STEP 1: AI Generate ============
  const handleAiGenerate = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('AI: Generowanie SKU + Title + Description...');

    for (const product of selected) {
      try {
        updateProduct(product.id, { status: ProductStatus.AI_PROCESSING });
        
        const details = await generateProductDetails(
          settings.geminiKey,
          product.inputName,
          product.ean,
          `${settings.aiRules.systemPrompt}\n\nSKU Rules: ${settings.aiRules.skuRules}\nTitle Rules: ${settings.aiRules.titleRules}\nDescription Rules: ${settings.aiRules.descriptionRules}\nForbidden: ${settings.aiRules.forbiddenWords}\nShop Category: ${product.shopCategory}\nCondition: ${product.condition}`
        );

        updateProduct(product.id, {
          sku: details.sku,
          title: details.title,
          descriptionHtml: details.descriptionHtml,
          keywords: details.keywords || '',
          status: ProductStatus.AI_DONE,
          lastError: ''
        });

        addLog({
          productId: product.id,
          sku: details.sku,
          ean: product.ean,
          stage: LogStage.AI,
          action: 'AI Generate',
          success: true,
          responseBody: { sku: details.sku, title: details.title }
        });
      } catch (err: any) {
        updateProduct(product.id, {
          status: ProductStatus.ERROR_AI,
          lastError: err.message || 'Błąd AI'
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.AI,
          action: 'AI Generate',
          success: false,
          ebayErrorMessage: err.message || 'Błąd AI',
          hint: 'Sprawdź klucz API Gemini i połączenie internetowe.'
        });
      }
    }

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ PIPELINE STEP 2: eBay Category ============
  const handlePickCategory = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('Dobieranie kategorii eBay...');

    for (const product of selected) {
      try {
        const searchText = `${product.title || product.inputName} ${product.shopCategory}`;
        const results = await suggestCategory(settings.geminiKey, searchText);
        
        if (results.length > 0) {
          const top = results[0];
          updateProduct(product.id, {
            ebayCategoryId: top.id,
            ebayCategoryName: top.name,
            status: ProductStatus.CATEGORY_DONE,
            lastError: ''
          });

          addLog({
            productId: product.id,
            sku: product.sku,
            ean: product.ean,
            stage: LogStage.CATEGORY,
            action: 'Pick Category',
            success: true,
            responseBody: { categoryId: top.id, categoryName: top.name }
          });
        } else {
          throw new Error('Brak sugestii kategorii');
        }
      } catch (err: any) {
        updateProduct(product.id, {
          status: ProductStatus.ERROR_CATEGORY,
          lastError: err.message || 'Błąd kategorii'
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.CATEGORY,
          action: 'Pick Category',
          success: false,
          ebayErrorMessage: err.message || 'Błąd kategorii',
          hint: 'Sprawdź czy EAN/nazwa produktu są poprawne.'
        });
      }
    }

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ PIPELINE STEP 3: Check Competition Prices ============
  const handleCheckPrices = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    if (!ebayConnected) {
      onError('Najpierw połącz się z eBay w Ustawieniach');
      return;
    }

    const tokens = getStoredTokens();
    if (!tokens) {
      onError('Brak tokenu eBay');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('Sprawdzanie cen konkurencji na eBay.de...');

    for (const product of selected) {
      try {
        // Search by EAN first, fallback to title
        const searchQuery = product.ean || product.title || product.inputName;
        
        const response = await fetch(`${API_BASE}/browse/search?q=${encodeURIComponent(searchQuery)}&filter=buyingOptions:{FIXED_PRICE}`, {
          headers: { 'Authorization': `Bearer ${tokens.accessToken}` }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const items = data.itemSummaries || [];

        // Extract prices
        const competitorPrices = items.slice(0, 10).map((item: any) => ({
          price: parseFloat(item.price?.value || 0),
          shipping: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
          total: parseFloat(item.price?.value || 0) + parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
          seller: item.seller?.username || 'unknown'
        }));

        // Calculate min and median
        const totals = competitorPrices.map((c: any) => c.total).filter((t: number) => t > 0).sort((a: number, b: number) => a - b);
        const minTotal = totals[0] || 0;
        const medianTotal = totals.length > 0 ? totals[Math.floor(totals.length / 2)] : 0;

        // Calculate recommended price
        const { undercutMode, undercutBy, minGrossPrice } = settings.pricingRules;
        let recommendedPrice = undercutMode === 'median' ? medianTotal : minTotal;
        recommendedPrice = Math.max(recommendedPrice - undercutBy, minGrossPrice);

        updateProduct(product.id, {
          competitorPrices,
          minTotalCompetition: minTotal,
          medianTotalCompetition: medianTotal,
          pricingRuleApplied: `${undercutMode} - ${undercutBy}€`,
          status: ProductStatus.PRICE_CHECK_DONE,
          lastError: ''
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.PRICE_CHECK,
          action: 'Check Prices',
          success: true,
          requestUrl: `${API_BASE}/browse/search?q=${encodeURIComponent(searchQuery)}`,
          requestMethod: 'GET',
          responseStatus: response.status,
          responseBody: { count: competitorPrices.length, minTotal, medianTotal }
        });

      } catch (err: any) {
        updateProduct(product.id, {
          status: ProductStatus.ERROR_PRICECHECK,
          lastError: err.message || 'Błąd sprawdzania cen'
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.PRICE_CHECK,
          action: 'Check Prices',
          success: false,
          ebayErrorMessage: err.message || 'Błąd sprawdzania cen',
          hint: 'Może brak ofert dla tego produktu na eBay.'
        });
      }
    }

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ PIPELINE STEP 4: Set Price AUTO ============
  const handleSetPriceAuto = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('Ustawianie cen AUTO...');

    for (const product of selected) {
      const { undercutMode, undercutBy, minGrossPrice } = settings.pricingRules;
      
      let basePrice = undercutMode === 'median' 
        ? (product.medianTotalCompetition || 0)
        : (product.minTotalCompetition || 0);
      
      let priceGross = Math.max(basePrice - undercutBy, minGrossPrice);
      
      // If no competition data, keep existing price or set minimum
      if (priceGross <= 0) {
        priceGross = product.priceGross > 0 ? product.priceGross : minGrossPrice;
      }

      const priceNet = parseFloat((priceGross / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2));

      updateProduct(product.id, {
        priceGross: parseFloat(priceGross.toFixed(2)),
        priceNet,
        pricingRuleApplied: `AUTO: ${undercutMode} - ${undercutBy}€`,
        status: ProductStatus.PRICE_SET_DONE,
        lastError: ''
      });

      addLog({
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        stage: LogStage.PRICE_SET,
        action: 'Set Price Auto',
        success: true,
        responseBody: { priceGross: parseFloat(priceGross.toFixed(2)), priceNet, rule: `${undercutMode} - ${undercutBy}€` }
      });
    }

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ PIPELINE STEP 5: Build DRAFT ============
  const handleBuildDraft = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('Budowanie DRAFT...');

    for (const product of selected) {
      const errors: string[] = [];

      // Validate required fields
      if (!product.sku) errors.push('Brak SKU');
      if (!product.title) errors.push('Brak Title');
      if (!product.descriptionHtml) errors.push('Brak Description');
      if (!product.ebayCategoryId) errors.push('Brak eBay Category');
      if (product.quantity <= 0) errors.push('Quantity <= 0');
      if (!product.condition) errors.push('Brak Condition');
      if (product.priceGross <= 0) errors.push('Price <= 0');

      // Validate policies from settings
      if (!settings.policies.paymentPolicyId) errors.push('Brak Payment Policy');
      if (!settings.policies.fulfillmentPolicyId) errors.push('Brak Fulfillment Policy');
      if (!settings.policies.returnPolicyId) errors.push('Brak Return Policy');
      if (!settings.policies.merchantLocationKey) errors.push('Brak Merchant Location');

      if (errors.length > 0) {
        updateProduct(product.id, {
          status: ProductStatus.ERROR_DRAFT,
          lastError: errors.join(', ')
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.DRAFT,
          action: 'Build Draft',
          success: false,
          ebayErrorMessage: errors.join(', '),
          hint: 'Sprawdź czy wszystkie wymagane pola są uzupełnione.'
        });
      } else {
        updateProduct(product.id, {
          status: ProductStatus.DRAFT_OK,
          lastError: ''
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.DRAFT,
          action: 'Build Draft',
          success: true,
          responseBody: { ready: true }
        });
      }
    }

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ PIPELINE STEP 6: Publish to eBay ============
  const handlePublish = async () => {
    const selected = getSelectedProducts().filter(p => p.status === ProductStatus.DRAFT_OK);
    if (selected.length === 0) {
      onError('Zaznacz produkty ze statusem DRAFT_OK');
      return;
    }

    if (!ebayConnected) {
      onError('Najpierw połącz się z eBay w Ustawieniach');
      return;
    }

    const tokens = getStoredTokens();
    if (!tokens) {
      onError('Brak tokenu eBay');
      return;
    }

    setIsProcessing(true);

    for (const product of selected) {
      // Declare payloads outside try for catch access
      let inventoryPayload: any = null;
      let offerPayload: any = null;
      
      try {
        setProcessingStep(`Publikacja: ${product.sku}...`);

        // Step 1: Create/Update Inventory Item
        inventoryPayload = {
          product: {
            title: product.title,
            description: product.descriptionHtml,
            aspects: {},
            ean: [product.ean]
          },
          condition: product.condition === ProductCondition.NEW ? 'NEW' : 'USED_EXCELLENT',
          availability: {
            shipToLocationAvailability: {
              quantity: product.quantity
            }
          }
        };

        const invResponse = await fetch(`${API_BASE}/inventory/${encodeURIComponent(product.sku)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokens.accessToken}`
          },
          body: JSON.stringify(inventoryPayload)
        });

        if (!invResponse.ok && invResponse.status !== 204) {
          const errData = await invResponse.json();
          throw new Error(errData.errors?.[0]?.message || `Inventory error ${invResponse.status}`);
        }

        // Step 2: Create Offer
        offerPayload = {
          sku: product.sku,
          marketplaceId: EBAY_DE_CONSTANTS.MARKETPLACE_ID,
          format: 'FIXED_PRICE',
          listingDescription: product.descriptionHtml,
          availableQuantity: product.quantity,
          categoryId: product.ebayCategoryId,
          merchantLocationKey: settings.policies.merchantLocationKey,
          pricingSummary: {
            price: {
              value: product.priceGross.toFixed(2),
              currency: EBAY_DE_CONSTANTS.CURRENCY
            }
          },
          listingPolicies: {
            fulfillmentPolicyId: settings.policies.fulfillmentPolicyId,
            paymentPolicyId: settings.policies.paymentPolicyId,
            returnPolicyId: settings.policies.returnPolicyId
          }
        };

        const offerResponse = await fetch(`${API_BASE}/offer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokens.accessToken}`
          },
          body: JSON.stringify(offerPayload)
        });

        const offerData = await offerResponse.json();
        if (!offerResponse.ok) {
          throw new Error(offerData.errors?.[0]?.message || `Offer error ${offerResponse.status}`);
        }

        const offerId = offerData.offerId;

        // Step 3: Publish Offer
        const publishResponse = await fetch(`${API_BASE}/offer/${offerId}/publish`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokens.accessToken}`
          }
        });

        const publishData = await publishResponse.json();
        if (!publishResponse.ok) {
          throw new Error(publishData.errors?.[0]?.message || `Publish error ${publishResponse.status}`);
        }

        updateProduct(product.id, {
          ebayOfferId: offerId,
          ebayItemId: publishData.listingId || '',
          status: ProductStatus.PUBLISHED,
          lastError: ''
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.PUBLISH,
          action: 'Publish to eBay',
          success: true,
          requestUrl: `${API_BASE}/offer/${offerId}/publish`,
          requestMethod: 'POST',
          responseStatus: publishResponse.status,
          responseBody: publishData,
          inventoryPayload,
          offerPayload,
          publishResponse: publishData
        });

      } catch (err: any) {
        updateProduct(product.id, {
          status: ProductStatus.ERROR_PUBLISH,
          lastError: err.message || 'Błąd publikacji'
        });

        addLog({
          productId: product.id,
          sku: product.sku,
          ean: product.ean,
          stage: LogStage.PUBLISH,
          action: 'Publish to eBay',
          success: false,
          ebayErrorMessage: err.message || 'Błąd publikacji',
          hint: 'Sprawdź autoryzację eBay i dane oferty.',
          inventoryPayload,
          offerPayload
        });
      }
    }

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ TURBO: Auto-Prepare (Steps 1-5) ============
  const handleTurbo = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    setIsProcessing(true);

    // Step 1: AI Generate
    setProcessingStep('TURBO 1/5: AI Generate...');
    await handleAiGenerate();

    // Step 2: Pick Category
    setProcessingStep('TURBO 2/5: Pick Category...');
    await handlePickCategory();

    // Step 3: Check Prices (if connected)
    if (ebayConnected) {
      setProcessingStep('TURBO 3/5: Check Prices...');
      await handleCheckPrices();
    }

    // Step 4: Set Price Auto
    setProcessingStep('TURBO 4/5: Set Price...');
    await handleSetPriceAuto();

    // Step 5: Build Draft
    setProcessingStep('TURBO 5/5: Build Draft...');
    await handleBuildDraft();

    setIsProcessing(false);
    setProcessingStep('');
  };

  // ============ RENDER ============
  return (
    <div className="flex flex-col h-[calc(100vh-180px)] gap-4">
      {/* Blokada jeśli nie połączono z eBay */}
      {!ebayConnected && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
          <span className="text-red-600 font-bold">🔒 Najpierw połącz eBay w zakładce Ustawienia</span>
        </div>
      )}

      {/* TOP BAR: Filters + Import */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shrink-0">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Filters */}
          <div className="flex gap-3 flex-1">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">Shop Category</label>
              <select 
                value={filterShopCategory} 
                onChange={(e) => setFilterShopCategory(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs min-w-[120px]"
              >
                <option value="">Wszystkie</option>
                {shopCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">Status</label>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs min-w-[100px]"
              >
                <option value="">Wszystkie</option>
                {Object.values(ProductStatus).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            
            <div className="flex-1 max-w-xs">
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">Szukaj</label>
              <input 
                type="text"
                placeholder="EAN / SKU / Tytuł..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
            </div>
          </div>

          {/* Import */}
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">Import (EAN | Nazwa | Kategoria)</label>
              <textarea 
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="4006381333931 | Produkt ABC | Elektronika"
                className="w-64 h-10 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono resize-none"
              />
            </div>
            <button 
              onClick={handleBulkImport}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all h-10"
            >
              ➕ Dodaj
            </button>
          </div>
        </div>
      </div>

      {/* PIPELINE BUTTONS */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shrink-0">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[9px] font-black uppercase text-slate-400 mr-2">
            Pipeline ({selectedIds.size} zaznaczonych):
          </span>
          
          <button 
            onClick={handleAiGenerate}
            disabled={isProcessing || selectedIds.size === 0}
            className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold hover:bg-blue-100 disabled:opacity-50 transition-all"
          >
            🤖 1. AI Generate
          </button>
          
          <button 
            onClick={handlePickCategory}
            disabled={isProcessing || selectedIds.size === 0}
            className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[10px] font-bold hover:bg-purple-100 disabled:opacity-50 transition-all"
          >
            🏷️ 2. Kategoria
          </button>
          
          <button 
            onClick={handleCheckPrices}
            disabled={isProcessing || selectedIds.size === 0 || !ebayConnected}
            className="px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold hover:bg-amber-100 disabled:opacity-50 transition-all"
          >
            💰 3. Ceny
          </button>
          
          <button 
            onClick={handleSetPriceAuto}
            disabled={isProcessing || selectedIds.size === 0}
            className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-100 disabled:opacity-50 transition-all"
          >
            📊 4. Ustaw cenę
          </button>
          
          <button 
            onClick={handleBuildDraft}
            disabled={isProcessing || selectedIds.size === 0}
            className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-bold hover:bg-green-100 disabled:opacity-50 transition-all"
          >
            📝 5. Build DRAFT
          </button>
          
          <button 
            onClick={handlePublish}
            disabled={isProcessing || selectedIds.size === 0 || !ebayConnected}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold hover:bg-black disabled:opacity-50 transition-all"
          >
            🚀 6. Wystaw
          </button>
          
          <div className="w-px h-6 bg-slate-200 mx-2" />
          
          <button 
            onClick={handleTurbo}
            disabled={isProcessing || selectedIds.size === 0}
            className="px-4 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-[10px] font-bold hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all"
          >
            ⚡ TURBO (1→5)
          </button>
          
          {isProcessing && (
            <span className="text-[10px] text-slate-500 ml-4 animate-pulse">
              {processingStep}
            </span>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
              <tr className="text-[9px] font-black uppercase text-slate-400">
                <th className="px-3 py-3 w-8">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.size === filteredProducts.length && filteredProducts.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded"
                  />
                </th>
                <th className="px-3 py-3">Shop Cat</th>
                <th className="px-3 py-3">EAN</th>
                <th className="px-3 py-3">Product Name</th>
                <th className="px-3 py-3 w-16">Qty</th>
                <th className="px-3 py-3 w-20">Condition</th>
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3 w-20">Gross €</th>
                <th className="px-3 py-3 w-20">Net €</th>
                <th className="px-3 py-3">eBay Cat</th>
                <th className="px-3 py-3 w-20">Status</th>
                <th className="px-3 py-3 w-8">Err</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-400 italic">
                    Brak produktów. Zaimportuj dane powyżej.
                  </td>
                </tr>
              ) : (
                filteredProducts.map(p => {
                  const statusConfig = STATUS_CONFIG[p.status] || STATUS_CONFIG[ProductStatus.DRAFT];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.shopCategory}
                          onChange={(e) => updateProduct(p.id, { shopCategory: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                          placeholder="---"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.ean}
                          onChange={(e) => updateProduct(p.id, { ean: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.inputName}
                          onChange={(e) => updateProduct(p.id, { inputName: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="number"
                          value={p.quantity}
                          onChange={(e) => updateProduct(p.id, { quantity: parseInt(e.target.value) || 0 })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-center"
                          min={0}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select 
                          value={p.condition}
                          onChange={(e) => updateProduct(p.id, { condition: e.target.value as ProductCondition })}
                          className="w-full px-1 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                        >
                          <option value={ProductCondition.NEW}>NEW</option>
                          <option value={ProductCondition.USED}>USED</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.sku}
                          onChange={(e) => updateProduct(p.id, { sku: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono"
                          placeholder="auto"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.title}
                          onChange={(e) => updateProduct(p.id, { title: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                          placeholder="---"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="number"
                          step="0.01"
                          value={p.priceGross}
                          onChange={(e) => {
                            const gross = parseFloat(e.target.value) || 0;
                            const net = parseFloat((gross / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2));
                            updateProduct(p.id, { priceGross: gross, priceNet: net });
                          }}
                          className="w-full px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-center font-bold text-blue-700"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.priceNet.toFixed(2)}
                          readOnly
                          className="w-full px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs text-center text-slate-500 cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.ebayCategoryId}
                          onChange={(e) => updateProduct(p.id, { ebayCategoryId: e.target.value })}
                          className="w-20 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono"
                          placeholder="---"
                          title={p.ebayCategoryName}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[8px] px-2 py-1 rounded-full font-bold ${statusConfig.bg} ${statusConfig.text}`}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {p.lastError && (
                          <button 
                            onClick={() => alert(p.lastError)}
                            className="text-red-500 hover:text-red-700"
                            title={p.lastError}
                          >
                            ⚠️
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between">
          <span>Wyświetlono: {filteredProducts.length} / {products.length} produktów</span>
          <span>Zaznaczono: {selectedIds.size}</span>
        </div>
      </div>
    </div>
  );
};

export default ProductsTab;
