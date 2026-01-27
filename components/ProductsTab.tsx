import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Product, ProductStatus, ProductCondition, AppSettings, LogEntry, LogStage, EBAY_DE_CONSTANTS} from '../types';
import { generateProductWithResearch, suggestCategory, researchProduct, generateProductDetails } from '../services/geminiService';
import { fetchStoreCategories, checkMarketPrices } from '../services/ebayService';
import * as XLSX from 'xlsx';

interface ProductsTabProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  settings: AppSettings;
  ebayConnected: boolean;
  onError: (msg: string) => void;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

// Helper: Extract main keywords from product title (first 3-4 meaningful words)
// Removes: EAN codes, "Neu", "OVP", specifications like "32h", "IP54", etc.
const extractSearchKeywords = (text: string): string => {
  if (!text) return '';
  
  // Remove common noise words and patterns
  const cleaned = text
    .replace(/\b\d{8,14}\b/g, '')  // Remove EAN codes (8-14 digits)
    .replace(/\b(Neu|OVP|NEU|neu|New|new|Sealed|sealed|Original|ORIGINAL)\b/gi, '')
    .replace(/\b\d+[hH]\b/g, '')   // Remove "32h", "24H" etc.
    .replace(/\bIP\d+\b/gi, '')    // Remove "IP54", "IP67" etc.
    .replace(/\b[A-Z]{2,}\d+[A-Z]?\d*\b/g, '')  // Remove model codes like "S24" but keep brand names
    .replace(/[–—-]+/g, ' ')       // Replace dashes with spaces
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim();
  
  // Split into words and take first 4 meaningful words (at least 2 chars)
  const words = cleaned.split(' ').filter(w => w.length >= 2);
  const mainKeywords = words.slice(0, 4).join(' ');
  
  return mainKeywords || text.split(' ').slice(0, 3).join(' '); // Fallback to original first 3 words
};

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

// Column mapping modal types
interface ImportPreview {
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>; // our field -> file column
}

const IMPORTABLE_FIELDS = [
  { key: 'ean', label: 'EAN', required: true },
  { key: 'inputName', label: 'Nazwa produktu', required: true },
  { key: 'shopCategory', label: 'Shop Category', required: false },
  { key: 'imageUrl', label: 'Link do zdjęcia', required: false },
  { key: 'sku', label: 'SKU (prefix)', required: false },
  { key: 'quantity', label: 'Ilość', required: false },
  { key: 'priceGross', label: 'Cena brutto', required: false },
];

const ProductsTab: React.FC<ProductsTabProps> = ({ products, setProducts, settings, ebayConnected, onError, addLog }) => {
  // State
  const [bulkInput, setBulkInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterShopCategory, setFilterShopCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  
  // File import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  
  // New Shop Category input
  const [newCategoryInput, setNewCategoryInput] = useState('');
  
  // eBay Store Categories
  const [ebayStoreCategories, setEbayStoreCategories] = useState<string[]>([]);
  const [isLoadingStoreCategories, setIsLoadingStoreCategories] = useState(false);
  
  // Research data storage (per product)
  const [productResearchData, setProductResearchData] = useState<Record<string, string>>({});
  
  // Research preview modal
  const [researchPreviewId, setResearchPreviewId] = useState<string | null>(null);
  
  // Competition prices preview modal
  const [competitionPreviewId, setCompetitionPreviewId] = useState<string | null>(null);
  
  // Description preview modal
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState<string>('');
  
  // Single product manual add form
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualProduct, setManualProduct] = useState({
    ean: '',
    inputName: '',
    shopCategory: '',
    imageUrl: '',
    sku: '',
    quantity: '1',
    priceGross: '',
    condition: ProductCondition.NEW
  });

  // Load eBay Store Categories on mount
  useEffect(() => {
    if (ebayConnected) {
      loadStoreCategories();
    }
  }, [ebayConnected]);

  const loadStoreCategories = async () => {
    setIsLoadingStoreCategories(true);
    try {
      const result = await fetchStoreCategories();
      console.log('📂 Store categories result:', result);
      const cats = result.categories.map(c => c.name).filter(Boolean);
      setEbayStoreCategories(cats);
      if (result.source === 'stores_api') {
        console.log(`✅ Loaded ${cats.length} store categories from eBay`);
      } else if (result.hint) {
        console.warn('⚠️ Store categories:', result.hint);
      }
    } catch (err) {
      console.warn('Failed to load store categories:', err);
    }
    setIsLoadingStoreCategories(false);
  };

  // Get unique shop categories for filter (combine local products + eBay + settings)
  const shopCategories = useMemo(() => {
    const localCats = new Set(products.map(p => p.shopCategory).filter(Boolean));
    const settingsCats = new Set(settings.storeCategories || []);
    const allCats = new Set([...localCats, ...ebayStoreCategories, ...settingsCats]);
    return Array.from(allCats).sort();
  }, [products, ebayStoreCategories, settings.storeCategories]);

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

  // ============ FILE IMPORT (Excel/CSV) ============
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      
      if (jsonData.length < 2) {
        onError('Plik musi zawierać nagłówki i co najmniej jeden wiersz danych');
        return;
      }

      const headers = (jsonData[0] as string[]).map(h => String(h || '').trim());
      const rows = jsonData.slice(1).filter(row => (row as string[]).some(cell => cell));

      console.log('📂 Import headers:', headers);

      // AI-assisted auto-mapping
      const autoMapping: Record<string, string> = {};
      IMPORTABLE_FIELDS.forEach(field => {
        const match = headers.find(h => {
          const hLower = h.toLowerCase().trim();
          if (field.key === 'shopCategory') {
            console.log(`🔍 Checking header "${h}" (lower: "${hLower}") for shopCategory`);
            const isMatch = hLower === 'shop cat' || hLower === 'shop category' || hLower === 'shopcategory' || hLower === 'shop_cat' || hLower === 'shopcat' || hLower.includes('categ') || hLower.includes('kategor');
            console.log(`   → Match: ${isMatch}`);
            return isMatch;
          }
          if (field.key === 'ean') return hLower.includes('ean') || hLower.includes('gtin') || hLower.includes('barcode');
          if (field.key === 'inputName') return hLower.includes('name') || hLower.includes('nazwa') || hLower.includes('product') || hLower.includes('title') || hLower.includes('tytuł');
          if (field.key === 'imageUrl') return hLower.includes('image') || hLower.includes('img') || hLower.includes('zdjęci') || hLower.includes('zdjec') || hLower.includes('bild') || hLower.includes('photo') || hLower.includes('url');
          if (field.key === 'sku') return hLower.includes('sku') || hLower.includes('artik');
          if (field.key === 'quantity') return hLower.includes('qty') || hLower.includes('quant') || hLower.includes('ilość') || hLower.includes('ilosc') || hLower.includes('menge');
          if (field.key === 'priceGross') return hLower.includes('price') || hLower.includes('cena') || hLower.includes('preis') || hLower.includes('brutto');
          return false;
        });
        if (match) {
          autoMapping[field.key] = match;
          console.log(`✅ Mapped ${field.key} → "${match}"`);
        }
      });

      console.log('📋 Final mapping:', autoMapping);

      setImportPreview({
        headers,
        rows: rows as string[][],
        mapping: autoMapping
      });
      setShowImportModal(true);

    } catch (err: any) {
      onError('Błąd odczytu pliku: ' + err.message);
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateMapping = (fieldKey: string, headerName: string) => {
    if (!importPreview) return;
    setImportPreview({
      ...importPreview,
      mapping: { ...importPreview.mapping, [fieldKey]: headerName }
    });
  };

  const executeImport = () => {
    if (!importPreview) return;

    const { headers, rows, mapping } = importPreview;
    const newItems: Product[] = [];

    rows.forEach(row => {
      const getValue = (fieldKey: string): string => {
        const headerName = mapping[fieldKey];
        if (!headerName) return '';
        const idx = headers.indexOf(headerName);
        return idx >= 0 ? String(row[idx] || '').trim() : '';
      };

      const ean = getValue('ean');
      const inputName = getValue('inputName');
      
      if (ean || inputName) {
        const priceStr = getValue('priceGross');
        const priceGross = parseFloat(priceStr.replace(',', '.')) || 0;
        const priceNet = parseFloat((priceGross / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2));
        
        // Parse multiple image URLs from single cell (separated by newline, comma, semicolon, or space)
        const imageUrlRaw = getValue('imageUrl');
        const allImageUrls = imageUrlRaw
          .split(/[\n\r,;]+/)  // Split by newline, comma, semicolon
          .map(url => url.trim())
          .filter(url => url.length > 0 && (url.startsWith('http') || url.startsWith('drive.google')));
        
        // First URL goes to imageUrl (main), rest to images array
        const mainImageUrl = allImageUrls[0] || '';
        const additionalImages = allImageUrls.slice(1);
        
        console.log('🖼️ Import images from cell:', { raw: imageUrlRaw, parsed: allImageUrls, main: mainImageUrl, additional: additionalImages });
        
        newItems.push({
          id: crypto.randomUUID().split('-')[0],
          ean,
          inputName,
          shopCategory: getValue('shopCategory'),
          imageUrl: mainImageUrl,
          images: additionalImages,
          quantity: parseInt(getValue('quantity')) || 1,
          condition: ProductCondition.NEW,
          sku: getValue('sku'), // User prefix, AI will complete
          title: '',
          descriptionHtml: '',
          keywords: '',
          ebayCategoryId: '',
          ebayCategoryName: '',
          competitorPrices: [],
          priceGross,
          priceNet,
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
      setShowImportModal(false);
      setImportPreview(null);
    } else {
      onError('Nie znaleziono prawidłowych wierszy do importu');
    }
  };

  // ============ SINGLE PRODUCT MANUAL ADD ============
  const handleManualAdd = () => {
    if (!manualProduct.ean && !manualProduct.inputName) {
      onError('Podaj przynajmniej EAN lub nazwę produktu');
      return;
    }

    const priceGross = parseFloat(manualProduct.priceGross.replace(',', '.')) || 0;
    const priceNet = parseFloat((priceGross / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2));

    const newProduct: Product = {
      id: crypto.randomUUID().split('-')[0],
      ean: manualProduct.ean.trim(),
      inputName: manualProduct.inputName.trim(),
      shopCategory: manualProduct.shopCategory.trim(),
      imageUrl: manualProduct.imageUrl.trim(),
      quantity: parseInt(manualProduct.quantity) || 1,
      condition: manualProduct.condition,
      sku: manualProduct.sku.trim(),
      title: '',
      descriptionHtml: '',
      keywords: '',
      ebayCategoryId: '',
      ebayCategoryName: '',
      competitorPrices: [],
      priceGross,
      priceNet,
      status: ProductStatus.DRAFT,
      ebayOfferId: '',
      ebayItemId: '',
      lastError: '',
      createdAt: Date.now()
    };

    setProducts(prev => [newProduct, ...prev]);
    
    // Reset form
    setManualProduct({
      ean: '',
      inputName: '',
      shopCategory: '',
      imageUrl: '',
      sku: '',
      quantity: '1',
      priceGross: '',
      condition: ProductCondition.NEW
    });
    setShowManualAdd(false);
  };

  // ============ BULK TEXT IMPORT ============
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
          imageUrl: '',
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

  // ============ SINGLE PRODUCT AI ACTIONS ============
  const handleGenerateSku = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const prefix = product.sku || '';
    // Generate SKU based on EAN and/or product name
    const eanPart = product.ean ? product.ean.slice(-4) : '';
    const namePart = (product.inputName || product.title || 'PROD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);
    
    const newSku = prefix 
      ? `${prefix}-${namePart}${eanPart}` 
      : `${namePart}${eanPart || crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    
    updateProduct(productId, { sku: newSku });
  };

  // ============ SINGLE PRODUCT AI AGENTS ============
  
  // Agent: Research produktu (szuka informacji)
  const handleResearchProduct = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    if (!settings.geminiKey) {
      onError('Brak klucza API Gemini');
      return;
    }

    try {
      updateProduct(productId, { status: ProductStatus.AI_PROCESSING });
      
      const researchResult = await researchProduct(
        settings.geminiKey,
        product.inputName,
        product.ean,
        settings.geminiModels?.productResearch,
        settings.aiInstructions?.productResearchPrompt
      );
      
      // Store research data for this product
      setProductResearchData(prev => ({ ...prev, [productId]: researchResult }));
      
      updateProduct(productId, { 
        status: ProductStatus.AI_DONE,
        lastError: ''
      });

      addLog({
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        stage: LogStage.AI,
        action: 'Research Product',
        success: true,
        responseBody: { researchLength: researchResult.length }
      });
      
    } catch (err: any) {
      updateProduct(productId, { status: ProductStatus.ERROR_AI, lastError: err.message });
      onError(`Research error: ${err.message}`);
    }
  };

  // Agent: Generuj Title dla pojedynczego produktu
  const handleGenerateTitle = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    if (!settings.geminiKey) {
      onError('Brak klucza API Gemini');
      return;
    }

    try {
      updateProduct(productId, { status: ProductStatus.AI_PROCESSING });
      
      // Get research data if available
      const researchData = productResearchData[productId] || '';
      
      const result = await generateProductDetails(
        settings.geminiKey,
        product.inputName,
        product.ean,
        `${settings.aiRules.titleRules}\nShop Category: ${product.shopCategory}`,
        settings.geminiModels?.titleDescription,
        settings.aiInstructions?.titlePrompt,
        undefined, // description prompt not needed
        researchData
      );
      
      updateProduct(productId, { 
        title: result.title || '',
        sku: product.sku || result.sku || '',
        status: ProductStatus.AI_DONE,
        lastError: ''
      });

      addLog({
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        stage: LogStage.AI,
        action: 'Generate Title',
        success: true,
        responseBody: { title: result.title }
      });
      
    } catch (err: any) {
      updateProduct(productId, { status: ProductStatus.ERROR_AI, lastError: err.message });
      onError(`Title error: ${err.message}`);
    }
  };

  // Agent: Generuj Description dla pojedynczego produktu
  const handleGenerateDescription = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    if (!settings.geminiKey) {
      onError('Brak klucza API Gemini');
      return;
    }

    try {
      updateProduct(productId, { status: ProductStatus.AI_PROCESSING });
      
      // Get research data if available
      const researchData = productResearchData[productId] || '';
      
      const result = await generateProductDetails(
        settings.geminiKey,
        product.inputName,
        product.ean,
        `${settings.aiRules.descriptionRules}\nShop Category: ${product.shopCategory}`,
        settings.geminiModels?.titleDescription,
        undefined, // title prompt not needed
        settings.aiInstructions?.descriptionPrompt,
        researchData
      );
      
      // Banner is added only at display/export time, not during generation
      updateProduct(productId, { 
        descriptionHtml: result.descriptionHtml || '',
        keywords: result.keywords || '',
        status: ProductStatus.AI_DONE,
        lastError: ''
      });

      addLog({
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        stage: LogStage.AI,
        action: 'Generate Description',
        success: true,
        responseBody: { descriptionLength: (result.descriptionHtml || '').length }
      });
      
    } catch (err: any) {
      updateProduct(productId, { status: ProductStatus.ERROR_AI, lastError: err.message });
      onError(`Description error: ${err.message}`);
    }
  };

  // Agent: Sprawdź cenę dla pojedynczego produktu (przez eBay API)
  const handleCheckProductPrice = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    // Application Token - nie wymaga logowania użytkownika

    try {
      updateProduct(productId, { status: ProductStatus.AI_PROCESSING });
      
      // Extract main keywords from title (removes EAN, "Neu", specs)
      const keywords = extractSearchKeywords(product.title || product.inputName || '');
      const result = await checkMarketPrices(product.ean, keywords);
      
      const { undercutMode, undercutBy, minGrossPrice } = settings.pricingRules;
      let recommendedPrice = undercutMode === 'median' ? result.statistics.median : result.statistics.min;
      recommendedPrice = Math.max(recommendedPrice - undercutBy, minGrossPrice);
      
      updateProduct(productId, { 
        competitorPrices: result.items.map(i => ({
          price: i.price,
          shipping: i.shipping,
          total: i.total,
          seller: i.seller,
          title: i.title,
          itemId: i.itemId,
          condition: i.condition
        })),
        minTotalCompetition: result.statistics.min,
        medianTotalCompetition: result.statistics.median,
        priceGross: recommendedPrice > 0 ? parseFloat(recommendedPrice.toFixed(2)) : product.priceGross,
        priceNet: recommendedPrice > 0 ? parseFloat((recommendedPrice / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2)) : product.priceNet,
        pricingRuleApplied: `${undercutMode} - ${undercutBy}€`,
        status: ProductStatus.PRICE_CHECK_DONE,
        lastError: ''
      });

      addLog({
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        stage: LogStage.PRICE_CHECK,
        action: 'Check Price (eBay API)',
        success: true,
        responseBody: { min: result.statistics.min, median: result.statistics.median, count: result.items.length }
      });
      
    } catch (err: any) {
      updateProduct(productId, { status: ProductStatus.ERROR_PRICECHECK, lastError: err.message });
      onError(`Price check error: ${err.message}`);
    }
  };

  const handleFindCategory = async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const searchTerm = product.inputName || product.title || '';
    if (!searchTerm) {
      onError('Brak nazwy produktu do wyszukania kategorii');
      return;
    }

    try {
      updateProduct(productId, { status: ProductStatus.AI_PROCESSING });
      
      // Użyj geminiKey2 dla kategorii jeśli dostępny, inaczej geminiKey
      const categoryApiKey = settings.geminiKey2 || settings.geminiKey;
      const result = await suggestCategory(categoryApiKey, searchTerm);
      if (result && result.length > 0) {
        const top = result[0];
        updateProduct(productId, { 
          ebayCategoryId: top.id, 
          ebayCategoryName: top.name,
          status: ProductStatus.CATEGORY_DONE
        });
      } else {
        updateProduct(productId, { status: ProductStatus.ERROR_CATEGORY, lastError: 'AI nie znalazło kategorii' });
      }
    } catch (err: any) {
      updateProduct(productId, { status: ProductStatus.ERROR_CATEGORY, lastError: err.message });
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

  // ============ PIPELINE STEP 1: Research Products (zbiera informacje) ============
  const handleAiGenerate = async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
      onError('Zaznacz produkty do przetworzenia');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('🔬 Research produktów...');

    for (const product of selected) {
      try {
        updateProduct(product.id, { status: ProductStatus.AI_PROCESSING });
        
        setProcessingStep(`🔬 Research: ${product.inputName}...`);
        
        // Krok 1: Research produktu
        const researchResult = await researchProduct(
          settings.geminiKey,
          product.inputName,
          product.ean,
          settings.geminiModels?.productResearch,
          settings.aiInstructions?.productResearchPrompt
        );
        
        // Store research data for this product
        setProductResearchData(prev => ({ ...prev, [product.id]: researchResult }));
        
        setProcessingStep(`📝 Generowanie Title + Description: ${product.inputName}...`);
        
        // Krok 2: Generuj Title + Description używając research data
        const result = await generateProductDetails(
          settings.geminiKey,
          product.inputName,
          product.ean,
          `${settings.aiRules.systemPrompt}\n\nSKU Rules: ${settings.aiRules.skuRules}\nTitle Rules: ${settings.aiRules.titleRules}\nDescription Rules: ${settings.aiRules.descriptionRules}\nForbidden: ${settings.aiRules.forbiddenWords}\nShop Category: ${product.shopCategory}\nCondition: ${product.condition}`,
          settings.geminiModels?.titleDescription,
          settings.aiInstructions?.titlePrompt,
          settings.aiInstructions?.descriptionPrompt,
          researchResult
        );

        // Banner is added only at display/export time, not during generation
        updateProduct(product.id, {
          sku: product.sku ? `${product.sku}-${result.sku}` : result.sku, // Preserve user prefix
          title: result.title,
          descriptionHtml: result.descriptionHtml || '',
          keywords: result.keywords || '',
          status: ProductStatus.AI_DONE,
          lastError: ''
        });

        addLog({
          productId: product.id,
          sku: result.sku,
          ean: product.ean,
          stage: LogStage.AI,
          action: 'AI Research + Generate',
          success: true,
          responseBody: { 
            sku: result.sku, 
            title: result.title,
            hasResearch: !!researchResult
          }
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
          action: 'AI Research + Generate',
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

    // Użyj geminiKey2 dla kategorii jeśli dostępny, inaczej geminiKey
    const categoryApiKey = settings.geminiKey2 || settings.geminiKey;

    for (const product of selected) {
      try {
        const searchText = `${product.title || product.inputName} ${product.shopCategory}`;
        const results = await suggestCategory(
          categoryApiKey, 
          searchText,
          settings.geminiModels?.categorySearch,
          settings.aiInstructions?.categoryPrompt
        );
        
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

    // Application Token - nie wymaga logowania użytkownika

    setIsProcessing(true);
    setProcessingStep('Sprawdzanie cen konkurencji na eBay.de...');

    for (const product of selected) {
      try {
        // Extract main keywords from title (removes EAN, "Neu", specs)
        const keywords = extractSearchKeywords(product.title || product.inputName || '');
        
        const result = await checkMarketPrices(product.ean, keywords);

        // Calculate recommended price
        const { undercutMode, undercutBy, minGrossPrice } = settings.pricingRules;
        let recommendedPrice = undercutMode === 'median' ? result.statistics.median : result.statistics.min;
        recommendedPrice = Math.max(recommendedPrice - undercutBy, minGrossPrice);

        updateProduct(product.id, {
          competitorPrices: result.items.map(i => ({
            price: i.price,
            shipping: i.shipping,
            total: i.total,
            seller: i.seller,
            title: i.title,
            itemId: i.itemId,
            condition: i.condition
          })),
          minTotalCompetition: result.statistics.min,
          medianTotalCompetition: result.statistics.median,
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
          requestUrl: `${API_BASE}/market/price-check`,
          requestMethod: 'POST',
          responseStatus: 200,
          responseBody: { count: result.items.length, min: result.statistics.min, median: result.statistics.median }
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

    setIsProcessing(true);

    for (const product of selected) {
      // Declare payloads outside try for catch access
      let inventoryPayload: any = null;
      let offerPayload: any = null;
      
      try {
        setProcessingStep(`Publikacja: ${product.sku}...`);

        // Extract brand and model from title/inputName for eBay aspects
        const titleParts = (product.inputName || product.title).split(' ');
        const brand = titleParts[0] || 'Unknown';
        const model = titleParts.slice(1).join(' ') || product.inputName || 'Unknown';

        // Fetch required aspects for this category
        let requiredAspects: Record<string, string[]> = {
          'Marke': [brand],
          'Modell': [model]
        };
        
        if (product.ebayCategoryId) {
          try {
            const aspectsResponse = await fetch(`${API_BASE}/category/aspects/${product.ebayCategoryId}`, {
              method: 'GET',
              credentials: 'include'
            });
            if (aspectsResponse.ok) {
              const aspectsData = await aspectsResponse.json();
              console.log('📋 Required aspects for category:', aspectsData.required?.map((a: any) => a.name));
              
              // Build aspects object with default values for required aspects
              for (const aspect of (aspectsData.required || [])) {
                const aspectName = aspect.name;
                if (!requiredAspects[aspectName]) {
                  // Set smart defaults based on aspect name
                  if (aspectName === 'Marke' || aspectName === 'Brand') {
                    requiredAspects[aspectName] = [brand];
                  } else if (aspectName === 'Modell' || aspectName === 'Model') {
                    requiredAspects[aspectName] = [model];
                  } else if (aspectName === 'Konnektivität' || aspectName === 'Connectivity') {
                    requiredAspects[aspectName] = ['Bluetooth'];
                  } else if (aspectName === 'Farbe' || aspectName === 'Color' || aspectName === 'Colour') {
                    requiredAspects[aspectName] = ['Schwarz'];
                  } else if (aspectName === 'Formfaktor' || aspectName === 'Form Factor') {
                    requiredAspects[aspectName] = ['In-Ear'];
                  } else if (aspectName === 'Produktart' || aspectName === 'Type') {
                    requiredAspects[aspectName] = ['Ohrhörer'];
                  } else if (aspect.values && aspect.values.length > 0) {
                    // Use first available value as default
                    requiredAspects[aspectName] = [aspect.values[0]];
                  } else {
                    requiredAspects[aspectName] = ['Nicht zutreffend'];
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Could not fetch aspects:', e);
          }
        }

        // Convert Google Drive links to direct image URLs
        const convertGoogleDriveUrl = (url: string): string => {
          // Match Google Drive file links like:
          // https://drive.google.com/file/d/FILE_ID/view?usp=drivesdk
          // https://drive.google.com/open?id=FILE_ID
          const fileMatch = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
          if (fileMatch) {
            return `https://drive.google.com/uc?export=view&id=${fileMatch[1]}`;
          }
          const openMatch = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
          if (openMatch) {
            return `https://drive.google.com/uc?export=view&id=${openMatch[1]}`;
          }
          return url; // Return original if not a Google Drive link
        };

        // Combine main imageUrl with additional images array
        const allImages: string[] = [];
        if (product.imageUrl && product.imageUrl.trim()) {
          allImages.push(product.imageUrl.trim());
        }
        if (product.images && product.images.length > 0) {
          allImages.push(...product.images);
        }
        
        const processedImages = allImages.map(convertGoogleDriveUrl);
        console.log('🖼️ Main imageUrl:', product.imageUrl);
        console.log('🖼️ Additional images:', product.images);
        console.log('🖼️ All images combined:', allImages);
        console.log('🖼️ Processed images (Google Drive converted):', processedImages);

        // Step 1: Create/Update Inventory Item
        inventoryPayload = {
          product: {
            title: product.title,
            description: product.descriptionHtml,
            aspects: requiredAspects,
            brand: brand,
            mpn: model,
            ean: [product.ean],
            imageUrls: processedImages.length > 0 ? processedImages : []
          },
          condition: product.condition === ProductCondition.NEW ? 'NEW' : 'USED_EXCELLENT',
          availability: {
            shipToLocationAvailability: {
              quantity: product.quantity
            }
          }
        };

        console.log('📦 Inventory payload aspects:', requiredAspects);

        const invResponse = await fetch(`${API_BASE}/inventory/${encodeURIComponent(product.sku)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(inventoryPayload)
        });

        if (!invResponse.ok && invResponse.status !== 204) {
          const errData = await invResponse.json();
          throw new Error(errData.errors?.[0]?.message || `Inventory error ${invResponse.status}`);
        }

        // Step 2: Check if offer exists - if yes DELETE it and create fresh one
        let offerId = '';
        
        // First check if offer already exists for this SKU
        const existingOffersResponse = await fetch(`${API_BASE}/offers/${encodeURIComponent(product.sku)}`, {
          method: 'GET',
          credentials: 'include'
        });
        
        if (existingOffersResponse.ok) {
          const existingOffers = await existingOffersResponse.json();
          if (existingOffers.offers && existingOffers.offers.length > 0) {
            // DELETE existing offer - it may have stale data (missing aspects etc)
            const existingOfferId = existingOffers.offers[0].offerId;
            console.log('🗑️ Deleting existing offer:', existingOfferId, '(may have stale aspects)');
            
            try {
              const deleteResponse = await fetch(`${API_BASE}/offer/${existingOfferId}`, {
                method: 'DELETE',
                credentials: 'include'
              });
              
              if (deleteResponse.ok || deleteResponse.status === 204) {
                console.log('✅ Deleted old offer successfully');
              } else {
                const deleteErr = await deleteResponse.json().catch(() => ({}));
                console.warn('⚠️ Could not delete old offer:', deleteErr);
                // Continue anyway - maybe offer was already published?
              }
            } catch (delErr) {
              console.warn('⚠️ Error deleting old offer:', delErr);
            }
          }
        }
        
        // Always create new offer (we deleted old one if existed)
        // Create new offer
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
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(offerPayload)
        });

        const offerData = await offerResponse.json();
        if (!offerResponse.ok) {
          throw new Error(offerData.errors?.[0]?.message || `Offer error ${offerResponse.status}`);
        }

        offerId = offerData.offerId;
        console.log('✅ Created new offer:', offerId);

        // Step 3: Publish Offer
        const publishResponse = await fetch(`${API_BASE}/offer/${offerId}/publish`, {
          method: 'POST',
          credentials: 'include'
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
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                Shop Category 
                {ebayConnected && (
                  <button 
                    onClick={loadStoreCategories}
                    disabled={isLoadingStoreCategories}
                    className="ml-2 text-teal-500 hover:text-teal-700"
                    title="Odśwież kategorie z eBay"
                  >
                    {isLoadingStoreCategories ? '⏳' : '🔄'}
                  </button>
                )}
              </label>
              <select 
                value={filterShopCategory} 
                onChange={(e) => setFilterShopCategory(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs min-w-[120px]"
              >
                <option value="">Wszystkie ({shopCategories.length})</option>
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

          {/* Import from File */}
          <div className="flex gap-2 items-end">
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all h-10 flex items-center gap-2"
            >
              📁 Import Excel/CSV
            </button>
            
            {/* Manual single product add button */}
            <button 
              onClick={() => setShowManualAdd(!showManualAdd)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all h-10 flex items-center gap-2 ${
                showManualAdd 
                  ? 'bg-green-600 text-white hover:bg-green-700' 
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              ✏️ {showManualAdd ? 'Zamknij formularz' : 'Dodaj ręcznie'}
            </button>
            
            {/* Quick text import */}
            <div className="flex gap-1">
              <input 
                type="text"
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="EAN | Nazwa | Kategoria"
                className="w-48 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono h-10"
                onKeyDown={(e) => e.key === 'Enter' && handleBulkImport()}
              />
              <button 
                onClick={handleBulkImport}
                className="px-3 py-2 bg-slate-700 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all h-10"
              >
                ➕
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MANUAL ADD FORM */}
      {showManualAdd && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-4 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-green-700">✏️ Dodaj produkt ręcznie</span>
            <span className="text-xs text-green-600">(wypełnij pola i kliknij "Dodaj")</span>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div>
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">EAN *</label>
              <input 
                type="text"
                value={manualProduct.ean}
                onChange={(e) => setManualProduct(prev => ({ ...prev, ean: e.target.value }))}
                placeholder="4006508123456"
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            
            <div className="col-span-2">
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">Nazwa produktu *</label>
              <input 
                type="text"
                value={manualProduct.inputName}
                onChange={(e) => setManualProduct(prev => ({ ...prev, inputName: e.target.value }))}
                placeholder="Samsung Galaxy S24 Ultra 256GB Black"
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            
            <div>
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">Kategoria sklepu</label>
              <input 
                type="text"
                value={manualProduct.shopCategory}
                onChange={(e) => setManualProduct(prev => ({ ...prev, shopCategory: e.target.value }))}
                placeholder="Elektronika"
                list="shopCategoriesList"
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
              <datalist id="shopCategoriesList">
                {shopCategories.map(cat => <option key={cat} value={cat} />)}
              </datalist>
            </div>
            
            <div>
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">SKU (prefix)</label>
              <input 
                type="text"
                value={manualProduct.sku}
                onChange={(e) => setManualProduct(prev => ({ ...prev, sku: e.target.value }))}
                placeholder="SAM-S24"
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            
            <div>
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">Ilość</label>
              <input 
                type="number"
                min="1"
                value={manualProduct.quantity}
                onChange={(e) => setManualProduct(prev => ({ ...prev, quantity: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            
            <div>
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">Cena brutto €</label>
              <input 
                type="text"
                value={manualProduct.priceGross}
                onChange={(e) => setManualProduct(prev => ({ ...prev, priceGross: e.target.value }))}
                placeholder="99.99"
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
            <div className="col-span-2">
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">Link do zdjęcia (URL)</label>
              <input 
                type="text"
                value={manualProduct.imageUrl}
                onChange={(e) => setManualProduct(prev => ({ ...prev, imageUrl: e.target.value }))}
                placeholder="https://example.com/image.jpg"
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            
            <div>
              <label className="block text-[9px] font-black uppercase text-green-600 mb-1">Stan</label>
              <select
                value={manualProduct.condition}
                onChange={(e) => setManualProduct(prev => ({ ...prev, condition: e.target.value as ProductCondition }))}
                className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value={ProductCondition.NEW}>Nowy</option>
                <option value={ProductCondition.USED}>Używany</option>
                <option value={ProductCondition.REFURBISHED}>Odnowiony</option>
              </select>
            </div>
            
            <div className="flex items-end gap-2">
              <button 
                onClick={handleManualAdd}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-all h-10"
              >
                ✅ Dodaj produkt
              </button>
              <button 
                onClick={() => setShowManualAdd(false)}
                className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all h-10"
              >
                ✖ Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

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
            🔬 1. Research + AI
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
            disabled={isProcessing || selectedIds.size === 0}
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
                <th className="px-3 py-3">Image URL</th>
                <th className="px-3 py-3 w-16">Qty</th>
                <th className="px-3 py-3 w-20">Condition</th>
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">Title 🤖</th>
                <th className="px-3 py-3">Description 🤖</th>
                <th className="px-3 py-3 w-20">Gross € 🤖</th>
                <th className="px-3 py-3 w-24">Konkurencja</th>
                <th className="px-3 py-3 w-20">Net €</th>
                <th className="px-3 py-3">eBay Cat</th>
                <th className="px-3 py-3 w-20">Status</th>
                <th className="px-3 py-3 w-8">Err</th>
                <th className="px-3 py-3 w-10">🗑️</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-4 py-12 text-center text-slate-400 italic">
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
                        <select
                          value={p.shopCategory}
                          onChange={(e) => {
                            if (e.target.value === '__NEW__') {
                              const newCat = prompt('Podaj nazwę nowej kategorii:');
                              if (newCat && newCat.trim()) {
                                updateProduct(p.id, { shopCategory: newCat.trim() });
                              }
                            } else {
                              updateProduct(p.id, { shopCategory: e.target.value });
                            }
                          }}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                        >
                          <option value="">---</option>
                          {shopCategories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                          {p.shopCategory && !shopCategories.includes(p.shopCategory) && (
                            <option value={p.shopCategory}>{p.shopCategory}</option>
                          )}
                          <option value="__NEW__">➕ Nowa kategoria...</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="text"
                          value={p.ean}
                          onChange={(e) => updateProduct(p.id, { ean: e.target.value })}
                          className="w-[120px] px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            value={p.inputName}
                            onChange={(e) => updateProduct(p.id, { inputName: e.target.value })}
                            className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                          />
                          <button
                            onClick={() => handleResearchProduct(p.id)}
                            className={`px-1.5 py-1 rounded text-xs hover:bg-cyan-200 ${productResearchData[p.id] ? 'bg-cyan-200 text-cyan-800' : 'bg-cyan-100 text-cyan-600'}`}
                            title="🔬 Research produktu"
                          >
                            🔬
                          </button>
                          {productResearchData[p.id] && (
                            <button
                              onClick={() => setResearchPreviewId(p.id)}
                              className="px-1.5 py-1 bg-green-100 text-green-600 rounded text-xs hover:bg-green-200"
                              title="👁️ Podgląd wyników Research"
                            >
                              👁️
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input 
                            type="text"
                            value={p.imageUrl || ''}
                            onChange={(e) => updateProduct(p.id, { imageUrl: e.target.value })}
                            className="w-[180px] px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-mono truncate"
                            placeholder="https://..."
                          />
                          {p.imageUrl && (
                            <a 
                              href={p.imageUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-700 text-xs flex-shrink-0"
                              title="Podgląd"
                            >
                              🔗
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input 
                          type="number"
                          value={p.quantity}
                          onChange={(e) => updateProduct(p.id, { quantity: parseInt(e.target.value) || 0 })}
                          className="w-[50px] px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-center"
                          min={0}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select 
                          value={p.condition}
                          onChange={(e) => updateProduct(p.id, { condition: e.target.value as ProductCondition })}
                          className="w-[70px] px-1 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                        >
                          <option value={ProductCondition.NEW}>NEW</option>
                          <option value={ProductCondition.USED}>USED</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            value={p.sku}
                            onChange={(e) => updateProduct(p.id, { sku: e.target.value })}
                            className="flex-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono min-w-[60px]"
                            placeholder="prefix..."
                          />
                          <button
                            onClick={() => handleGenerateSku(p.id)}
                            className="px-1.5 py-1 bg-blue-100 text-blue-600 rounded text-xs hover:bg-blue-200"
                            title="AI generuje SKU z prefixu"
                          >
                            🤖
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            value={p.title}
                            onChange={(e) => updateProduct(p.id, { title: e.target.value })}
                            className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs min-w-[100px]"
                            placeholder="---"
                          />
                          <button
                            onClick={() => handleGenerateTitle(p.id)}
                            className="px-1.5 py-1 bg-indigo-100 text-indigo-600 rounded text-xs hover:bg-indigo-200"
                            title="🤖 Generuj Title (używa Research)"
                          >
                            🤖
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            value={p.descriptionHtml ? `${p.descriptionHtml.replace(/<[^>]*>/g, '').slice(0, 30)}...` : ''}
                            readOnly
                            onClick={() => {
                              setEditingDescription(p.descriptionHtml || '');
                              setPreviewProductId(p.id);
                            }}
                            className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs min-w-[80px] cursor-pointer hover:bg-slate-100"
                            placeholder="---"
                            title="Kliknij aby otworzyć podgląd i edycję"
                          />
                          <button
                            onClick={() => handleGenerateDescription(p.id)}
                            className="px-1.5 py-1 bg-purple-100 text-purple-600 rounded text-xs hover:bg-purple-200"
                            title="🤖 Generuj Opis (używa Research)"
                          >
                            🤖
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            value={p.priceGross}
                            onChange={(e) => {
                              // Allow digits, dot, comma
                              const val = e.target.value.replace(',', '.');
                              const gross = parseFloat(val) || 0;
                              const net = parseFloat((gross / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2));
                              updateProduct(p.id, { priceGross: gross, priceNet: net });
                            }}
                            className="flex-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-center font-bold text-blue-700 min-w-[50px]"
                            placeholder="0.00"
                          />
                          <button
                            onClick={() => handleCheckProductPrice(p.id)}
                            className="px-1.5 py-1 bg-amber-100 text-amber-600 rounded text-xs hover:bg-amber-200"
                            title="🤖 Sprawdź cenę konkurencji (eBay API)"
                          >
                            🤖
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {(p.minTotalCompetition || p.medianTotalCompetition) ? (
                          <div className="flex flex-col text-xs gap-0.5">
                            <span className="text-green-600 font-bold" title="Minimum">
                              ▼ {p.minTotalCompetition?.toFixed(2) || '---'}€
                            </span>
                            <span className="text-blue-600" title="Mediana">
                              ◆ {p.medianTotalCompetition?.toFixed(2) || '---'}€
                            </span>
                            {p.competitorPrices && p.competitorPrices.length > 0 && (
                              <button
                                onClick={() => setCompetitionPreviewId(p.id)}
                                className="text-purple-500 text-[10px] hover:text-purple-700 underline cursor-pointer"
                                title="👁️ Zobacz oferty konkurencji"
                              >
                                👁️ {p.competitorPrices.length} ofert
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">---</span>
                        )}
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
                        <div className="flex gap-1">
                          <input 
                            type="text"
                            value={p.ebayCategoryId}
                            onChange={(e) => updateProduct(p.id, { ebayCategoryId: e.target.value })}
                            className="w-16 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono"
                            placeholder="---"
                            title={p.ebayCategoryName}
                          />
                          <button
                            onClick={() => handleFindCategory(p.id)}
                            className="px-1.5 py-1 bg-purple-100 text-purple-600 rounded text-xs hover:bg-purple-200"
                            title="AI znajdź kategorię eBay"
                          >
                            🏷️
                          </button>
                        </div>
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
                      <td className="px-3 py-2 text-center">
                        <button 
                          onClick={() => {
                            if (confirm(`Usunąć "${p.inputName || p.ean}"?`)) {
                              setProducts(prev => prev.filter(prod => prod.id !== p.id));
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                next.delete(p.id);
                                return next;
                              });
                            }
                          }}
                          className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-1 transition-colors"
                          title="Usuń produkt"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between items-center">
          <span>Wyświetlono: {filteredProducts.length} / {products.length} produktów</span>
          <div className="flex items-center gap-4">
            <span>Zaznaczono: {selectedIds.size}</span>
            {selectedIds.size > 0 && (
              <button
                onClick={() => {
                  if (confirm(`Usunąć ${selectedIds.size} zaznaczonych produktów?`)) {
                    setProducts(prev => prev.filter(p => !selectedIds.has(p.id)));
                    setSelectedIds(new Set());
                  }
                }}
                className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 transition-colors"
              >
                🗑️ Usuń zaznaczone ({selectedIds.size})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && importPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold">📁 Import pliku</h2>
              <p className="text-xs text-slate-500 mt-1">
                Dopasuj kolumny z pliku do pól w aplikacji. Znaleziono {importPreview.rows.length} wierszy.
              </p>
            </div>

            <div className="p-6 overflow-auto flex-1">
              {/* Mapping section */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                {IMPORTABLE_FIELDS.map(field => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                      {field.label}
                      {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      value={importPreview.mapping[field.key] || ''}
                      onChange={(e) => updateMapping(field.key, e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg text-xs ${
                        field.required && !importPreview.mapping[field.key] 
                          ? 'border-red-300 bg-red-50' 
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <option value="">-- nie mapuj --</option>
                      {importPreview.headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Podgląd pierwszych 5 wierszy:
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100">
                      <tr>
                        {importPreview.headers.map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-bold text-slate-600 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {importPreview.headers.map((_, j) => (
                            <td key={j} className="px-3 py-2 whitespace-nowrap text-slate-600">
                              {String(row[j] || '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => { setShowImportModal(false); setImportPreview(null); }}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300"
              >
                Anuluj
              </button>
              <button
                onClick={executeImport}
                disabled={!importPreview.mapping['ean'] && !importPreview.mapping['inputName']}
                className="px-6 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black disabled:opacity-50"
              >
                ✅ Importuj {importPreview.rows.length} wierszy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Research Preview Modal */}
      {researchPreviewId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setResearchPreviewId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg">🔬 Wyniki Research AI</h3>
              <button onClick={() => setResearchPreviewId(null)} className="text-2xl hover:text-cyan-200">×</button>
            </div>
            
            <div className="p-4 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-bold text-slate-600">Produkt:</span>
                <span className="text-slate-800">{products.find(p => p.id === researchPreviewId)?.inputName}</span>
                <span className="text-slate-400">|</span>
                <span className="font-bold text-slate-600">EAN:</span>
                <span className="font-mono text-slate-800">{products.find(p => p.id === researchPreviewId)?.ean}</span>
              </div>
            </div>
            
            <div className="p-6 overflow-auto max-h-[60vh]">
              {productResearchData[researchPreviewId] ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-slate-700 bg-white p-4 rounded-lg border border-slate-200 font-sans leading-relaxed">
                    {productResearchData[researchPreviewId]}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <p className="text-4xl mb-4">🔍</p>
                  <p>Brak danych Research dla tego produktu</p>
                  <p className="text-sm mt-2">Kliknij przycisk 🔬 przy nazwie produktu aby uruchomić Research</p>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
              <div className="text-xs text-slate-500">
                💡 Te dane są używane przez agentów Title i Description
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (researchPreviewId) {
                      handleResearchProduct(researchPreviewId);
                    }
                  }}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-xs font-bold hover:bg-cyan-700"
                >
                  🔄 Odśwież Research
                </button>
                <button
                  onClick={() => setResearchPreviewId(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300"
                >
                  Zamknij
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Competition Prices Preview Modal */}
      {competitionPreviewId && (() => {
        const product = products.find(p => p.id === competitionPreviewId);
        const prices = product?.competitorPrices || [];
        const sortedByPrice = [...prices].sort((a, b) => a.total - b.total);
        const top10 = sortedByPrice.slice(0, 10); // Top 10 najtańszych
        
        const getEbayLink = (itemId?: string) => {
          if (!itemId) return null;
          // eBay item IDs can be in format "v1|123456789|0" - extract the middle part
          const parts = itemId.split('|');
          const realId = parts.length === 3 ? parts[1] : itemId;
          return `https://www.ebay.de/itm/${realId}`;
        };
        
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCompetitionPreviewId(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white flex justify-between items-center">
                <h3 className="font-bold text-lg">💰 Top 10 Ofert Konkurencji (tylko nowe)</h3>
                <button onClick={() => setCompetitionPreviewId(null)} className="text-2xl hover:text-amber-200">×</button>
              </div>
              
              <div className="p-4 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-bold text-slate-600">Produkt:</span>
                  <span className="text-slate-800">{product?.title || product?.inputName}</span>
                </div>
                <div className="flex gap-6 mt-2 text-sm">
                  <span><strong className="text-green-600">Min:</strong> {product?.minTotalCompetition?.toFixed(2)}€</span>
                  <span><strong className="text-blue-600">Median:</strong> {product?.medianTotalCompetition?.toFixed(2)}€</span>
                  <span><strong className="text-slate-500">Ofert:</strong> {prices.length}</span>
                </div>
              </div>
              
              <div className="p-4 overflow-auto max-h-[60vh]">
                {top10.length > 0 ? (
                  <div className="space-y-2">
                    {top10.map((item, idx) => (
                      <div 
                        key={idx} 
                        className={`border rounded-lg p-3 flex items-center gap-4 ${
                          idx === 0 ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-slate-100 text-slate-600">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate" title={item.title}>
                            {item.title || 'Brak tytułu'}
                          </p>
                          <p className="text-xs text-slate-500">
                            👤 {item.seller} | 📦 {item.condition || 'N/A'}
                          </p>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <p className={`text-lg font-black ${idx === 0 ? 'text-green-600' : 'text-slate-700'}`}>
                            {item.total.toFixed(2)}€
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {item.price.toFixed(2)}€ + {item.shipping.toFixed(2)}€
                          </p>
                        </div>
                        {getEbayLink(item.itemId) && (
                          <a 
                            href={getEbayLink(item.itemId)!} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 whitespace-nowrap"
                          >
                            🔗 eBay
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-400">
                    <p className="text-4xl mb-4">📊</p>
                    <p>Brak danych o cenach konkurencji</p>
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
                <p className="text-xs text-slate-500">
                  💡 Pokazano tylko nowe produkty (bez używanych)
                </p>
                <button
                  onClick={() => setCompetitionPreviewId(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300"
                >
                  Zamknij
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Description Preview Modal */}
      {previewProductId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPreviewProductId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-5xl max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg">📝 Podgląd i Edycja Opisu</h3>
              <button onClick={() => setPreviewProductId(null)} className="text-2xl hover:text-purple-200">×</button>
            </div>
            
            <div className="flex h-[70vh]">
              {/* Left: Edit HTML */}
              <div className="w-1/2 p-4 border-r border-slate-200 flex flex-col">
                <label className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-2">
                  📝 Kod HTML opisu
                </label>
                <textarea
                  value={editingDescription}
                  onChange={(e) => setEditingDescription(e.target.value)}
                  className="flex-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono resize-none"
                  placeholder="Wpisz lub edytuj kod HTML opisu..."
                />
              </div>
              
              {/* Right: Preview */}
              <div className="w-1/2 p-4 flex flex-col">
                <label className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-2">
                  👁️ Podgląd opisu
                </label>
                <div className="flex-1 overflow-auto bg-white border border-slate-200 rounded-lg p-4">
                  {/* Product Description - banner will be added at publish time */}
                  <div 
                    dangerouslySetInnerHTML={{ __html: editingDescription }}
                  />
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
              <div className="text-xs text-slate-500">
                💡 Baner firmowy jest automatycznie dodawany do każdego opisu przy publikacji
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setPreviewProductId(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => {
                    updateProduct(previewProductId, { descriptionHtml: editingDescription });
                    setPreviewProductId(null);
                  }}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700"
                >
                  ✅ Zapisz opis
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsTab;
