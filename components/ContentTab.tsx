import React, { useState, useEffect, useCallback } from 'react';
import { AppSettings } from '../types';
import { generateProductDetails } from '../services/geminiService';

// Types for eBay inventory items with offer data
interface EbayInventoryItem {
  sku: string;
  product?: {
    title?: string;
    description?: string;
    imageUrls?: string[];
    brand?: string;
    mpn?: string;
    ean?: string[];
    aspects?: Record<string, string[]>;
  };
  condition?: string;
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number;
    };
  };
  offer?: {
    offerId?: string;
    listingDescription?: string;
    pricingSummary?: {
      price?: { value?: string; currency?: string };
    };
    status?: string;
    listingId?: string;
  };
}

interface EditedProduct {
  title?: string;
  description?: string;
  imageUrls?: string[];
}

interface ContentTabProps {
  settings: AppSettings;
  onError: (msg: string) => void;
}

const API_BASE = '/api/ebay';
const STORAGE_KEY_TITLE_INSTRUCTIONS = 'ebay_content_title_instructions';
const STORAGE_KEY_DESC_INSTRUCTIONS = 'ebay_content_desc_instructions';

const ContentTab: React.FC<ContentTabProps> = ({ settings, onError }) => {
  // View mode: 'active' or 'ended'
  const [viewMode, setViewMode] = useState<'active' | 'ended'>('active');
  
  const [inventoryItems, setInventoryItems] = useState<EbayInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // AI Instructions
  const [titleInstructions, setTitleInstructions] = useState(() => 
    localStorage.getItem(STORAGE_KEY_TITLE_INSTRUCTIONS) || 
    'Wygeneruj profesjonalny tytuł po niemiecku. Max 80 znaków. Zawrzyj markę i kluczowe cechy produktu.'
  );
  const [descInstructions, setDescInstructions] = useState(() =>
    localStorage.getItem(STORAGE_KEY_DESC_INSTRUCTIONS) ||
    'Wygeneruj profesjonalny opis produktu w HTML po niemiecku. Użyj nagłówków <h3>, list <ul><li>, pogrubień <strong>.'
  );
  const [showInstructions, setShowInstructions] = useState(false);
  
  // Processing states
  const [processingTitle, setProcessingTitle] = useState<Set<string>>(new Set());
  const [processingDescription, setProcessingDescription] = useState<Set<string>>(new Set());
  
  // Edited values
  const [editedItems, setEditedItems] = useState<Record<string, EditedProduct>>({});
  
  // Modals
  const [editingDescriptionSku, setEditingDescriptionSku] = useState<string | null>(null);
  const [editingImagesSku, setEditingImagesSku] = useState<string | null>(null);
  const [newImageUrl, setNewImageUrl] = useState('');
  
  // Pagination - use 200 (max eBay limit) to get all items
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [itemsPerPage] = useState(200);
  
  // Save instructions to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TITLE_INSTRUCTIONS, titleInstructions);
  }, [titleInstructions]);
  
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DESC_INSTRUCTIONS, descInstructions);
  }, [descInstructions]);
  
  // Filter items based on view mode
  const activeItems = inventoryItems.filter(item => 
    item.offer?.status === 'PUBLISHED' || item.offer?.status === 'ACTIVE'
  );
  const endedItems = inventoryItems.filter(item => 
    !item.offer || item.offer?.status === 'ENDED' || item.offer?.status === 'UNPUBLISHED'
  );
  const displayedItems = viewMode === 'active' ? activeItems : endedItems;
  
  // Load ALL inventory items with pagination (multiple requests if needed)
  const loadInventoryItems = useCallback(async () => {
    setIsLoading(true);
    try {
      let allItems: EbayInventoryItem[] = [];
      let offset = 0;
      const limit = 100; // Use 100 to be safe with timeouts
      let total = 0;
      let hasMore = true;
      
      console.log('[ContentTab] Starting to load all inventory items...');
      
      // Fetch all pages
      while (hasMore) {
        console.log(`[ContentTab] Fetching page: offset=${offset}, limit=${limit}`);
        
        const response = await fetch(`${API_BASE}/inventory-items?limit=${limit}&offset=${offset}&enrichOffers=true`, {
          method: 'GET',
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error(`Failed to load inventory: ${response.status}`);
        
        const data = await response.json();
        total = data.total || 0;
        
        if (data.inventoryItems && data.inventoryItems.length > 0) {
          allItems = [...allItems, ...data.inventoryItems];
          console.log(`[ContentTab] Got ${data.inventoryItems.length} items, total so far: ${allItems.length}/${total}`);
          
          offset += limit;
          hasMore = allItems.length < total;
        } else {
          hasMore = false;
        }
        
        // Safety: max 5 requests (500 items)
        if (offset >= 500) {
          console.log('[ContentTab] Reached max 500 items limit');
          hasMore = false;
        }
      }
      
      console.log(`[ContentTab] Finished loading. Total items: ${allItems.length}`);
      
      // Count statuses
      const published = allItems.filter(i => i.offer?.status === 'PUBLISHED' || i.offer?.status === 'ACTIVE').length;
      const unpublished = allItems.filter(i => !i.offer || i.offer?.status === 'ENDED' || i.offer?.status === 'UNPUBLISHED').length;
      console.log(`[ContentTab] Active: ${published}, Ended: ${unpublished}`);
      
      setInventoryItems(allItems);
      setTotalItems(allItems.length);
    } catch (err: any) {
      console.error('[ContentTab] Load error:', err);
      onError(`Błąd ładowania: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [onError]);
  
  // Load once on mount (prevent double-loading in StrictMode)
  useEffect(() => {
    let mounted = true;
    if (mounted && inventoryItems.length === 0) {
      loadInventoryItems();
    }
    return () => { mounted = false; };
  }, []);
  
  // Reset page when switching views
  useEffect(() => {
    setCurrentPage(0);
    setSelectedItems(new Set());
  }, [viewMode]);
  
  // Getters for current values
  const getCurrentTitle = (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    return editedItems[sku]?.title ?? item?.product?.title ?? '';
  };
  
  const getCurrentDescription = (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    return editedItems[sku]?.description ?? item?.offer?.listingDescription ?? item?.product?.description ?? '';
  };
  
  const getCurrentImages = (sku: string): string[] => {
    const item = inventoryItems.find(i => i.sku === sku);
    return editedItems[sku]?.imageUrls ?? item?.product?.imageUrls ?? [];
  };
  
  const getCurrentPrice = (sku: string): string => {
    const item = inventoryItems.find(i => i.sku === sku);
    return item?.offer?.pricingSummary?.price?.value ?? '';
  };
  
  // Update edited value
  const updateEditedValue = (sku: string, field: keyof EditedProduct, value: any) => {
    setEditedItems(prev => ({
      ...prev,
      [sku]: { ...prev[sku], [field]: value }
    }));
  };
  
  // AI Generate Title
  const handleGenerateTitle = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    if (!item) return;
    
    setProcessingTitle(prev => new Set(prev).add(sku));
    try {
      const existingTitle = item.product?.title || sku;
      const existingDescription = item.offer?.listingDescription || item.product?.description || '';
      const brand = item.product?.brand || '';
      const ean = item.product?.ean?.[0] || '';
      const aspects = item.product?.aspects ? JSON.stringify(item.product.aspects) : '';
      
      const contextInfo = `
INSTRUKCJE: ${titleInstructions}

DANE PRODUKTU:
- Tytuł: ${existingTitle}
- Marka: ${brand}
- EAN: ${ean}
- Cechy: ${aspects}
- Opis: ${existingDescription.substring(0, 800)}

Wygeneruj TYLKO nowy tytuł.`;
      
      const result = await generateProductDetails(
        settings.geminiKey, existingTitle, ean, contextInfo,
        settings.geminiModels.titleDescription, titleInstructions, descInstructions
      );
      
      if (result.title) updateEditedValue(sku, 'title', result.title);
    } catch (err: any) {
      onError(`Błąd generowania tytułu: ${err.message}`);
    } finally {
      setProcessingTitle(prev => { const n = new Set(prev); n.delete(sku); return n; });
    }
  };
  
  // AI Generate Description
  const handleGenerateDescription = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    if (!item) return;
    
    setProcessingDescription(prev => new Set(prev).add(sku));
    try {
      const existingTitle = item.product?.title || sku;
      const existingDescription = item.offer?.listingDescription || item.product?.description || '';
      const brand = item.product?.brand || '';
      const ean = item.product?.ean?.[0] || '';
      const aspects = item.product?.aspects ? JSON.stringify(item.product.aspects) : '';
      
      const contextInfo = `
INSTRUKCJE: ${descInstructions}

DANE PRODUKTU:
- Tytuł: ${existingTitle}
- Marka: ${brand}
- EAN: ${ean}
- Cechy: ${aspects}

AKTUALNY OPIS:
${existingDescription}

${settings.companyBanner ? `BANER FIRMOWY (dodaj na koniec):\n${settings.companyBanner}` : ''}

Wygeneruj TYLKO nowy opis HTML.`;
      
      const result = await generateProductDetails(
        settings.geminiKey, existingTitle, ean, contextInfo,
        settings.geminiModels.titleDescription, titleInstructions, descInstructions
      );
      
      if (result.descriptionHtml) updateEditedValue(sku, 'description', result.descriptionHtml);
    } catch (err: any) {
      onError(`Błąd generowania opisu: ${err.message}`);
    } finally {
      setProcessingDescription(prev => { const n = new Set(prev); n.delete(sku); return n; });
    }
  };
  
  // Image management
  const handleAddImage = (sku: string) => {
    if (!newImageUrl.trim()) return;
    updateEditedValue(sku, 'imageUrls', [...getCurrentImages(sku), newImageUrl.trim()]);
    setNewImageUrl('');
  };
  
  const handleRemoveImage = (sku: string, index: number) => {
    updateEditedValue(sku, 'imageUrls', getCurrentImages(sku).filter((_, i) => i !== index));
  };
  
  const handleMoveImage = (sku: string, index: number, direction: 'up' | 'down') => {
    const images = [...getCurrentImages(sku)];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= images.length) return;
    [images[index], images[newIndex]] = [images[newIndex], images[index]];
    updateEditedValue(sku, 'imageUrls', images);
  };
  
  // SAVE TO EBAY - Fixed version
  const handleSaveToEbay = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    const edits = editedItems[sku];
    
    if (!item) {
      onError('Nie znaleziono produktu');
      return;
    }
    
    if (!edits || (!edits.title && !edits.description && !edits.imageUrls)) {
      onError('Brak zmian do zapisania');
      return;
    }
    
    setIsSaving(prev => new Set(prev).add(sku));
    console.log('[ContentTab] === SAVING TO EBAY ===');
    console.log('[ContentTab] SKU:', sku);
    console.log('[ContentTab] Edits:', JSON.stringify(edits));
    console.log('[ContentTab] Has offer:', !!item.offer, 'offerId:', item.offer?.offerId);
    
    try {
      let inventoryUpdated = false;
      let offerUpdated = false;
      
      // 1. Update inventory item (title, images)
      if (edits.title || edits.imageUrls) {
        const inventoryPayload = {
          ...item,
          product: {
            ...item.product,
            title: edits.title ?? item.product?.title,
            imageUrls: edits.imageUrls ?? item.product?.imageUrls
          }
        };
        delete (inventoryPayload as any).offer;
        
        console.log('[ContentTab] Sending inventory update for:', sku);
        
        const invResponse = await fetch(`${API_BASE}/inventory/${encodeURIComponent(sku)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inventoryPayload)
        });
        
        console.log('[ContentTab] Inventory response status:', invResponse.status);
        
        if (!invResponse.ok && invResponse.status !== 204) {
          const errText = await invResponse.text();
          console.error('[ContentTab] Inventory error:', errText);
          throw new Error(`Błąd inventory: ${invResponse.status}`);
        }
        inventoryUpdated = true;
        console.log('[ContentTab] Inventory updated!');
      }
      
      // 2. Update offer (description)
      if (edits.description && item.offer?.offerId) {
        console.log('[ContentTab] Sending offer update for offerId:', item.offer.offerId);
        
        const offerResponse = await fetch(`${API_BASE}/offer/${item.offer.offerId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingDescription: edits.description })
        });
        
        console.log('[ContentTab] Offer response status:', offerResponse.status);
        
        if (!offerResponse.ok && offerResponse.status !== 204) {
          const errText = await offerResponse.text();
          console.error('[ContentTab] Offer error:', errText);
          throw new Error(`Błąd offer: ${offerResponse.status}`);
        }
        offerUpdated = true;
        console.log('[ContentTab] Offer updated!');
      } else if (edits.description && !item.offer?.offerId) {
        console.warn('[ContentTab] No offerId - description not saved to eBay');
        onError('Produkt nie ma aktywnej oferty - opis zapisany tylko lokalnie');
      }
      
      // Clear edits
      setEditedItems(prev => {
        const next = { ...prev };
        delete next[sku];
        return next;
      });
      
      // Success message
      const parts = [];
      if (inventoryUpdated) parts.push('inventory');
      if (offerUpdated) parts.push('oferta');
      if (parts.length > 0) {
        console.log('[ContentTab] SUCCESS! Updated:', parts.join(' + '));
      }
      
      // Reload
      await loadInventoryItems();
      
    } catch (err: any) {
      console.error('[ContentTab] Save error:', err);
      onError(`Błąd zapisywania: ${err.message}`);
    } finally {
      setIsSaving(prev => { const n = new Set(prev); n.delete(sku); return n; });
    }
  };
  
  // RELIST ended item
  const handleRelistItem = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    if (!item) return;
    
    setIsSaving(prev => new Set(prev).add(sku));
    
    try {
      // If has offerId, try to publish it again
      if (item.offer?.offerId) {
        console.log('[ContentTab] Relisting offer:', item.offer.offerId);
        
        const response = await fetch(`${API_BASE}/offer/${item.offer.offerId}/publish`, {
          method: 'POST',
          credentials: 'include'
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.errors?.[0]?.message || `Publish failed: ${response.status}`);
        }
        
        console.log('[ContentTab] Relisted successfully!');
        await loadInventoryItems();
      } else {
        onError('Ten produkt nie ma oferty do ponownego wystawienia. Utwórz nową ofertę.');
      }
    } catch (err: any) {
      onError(`Błąd ponownego wystawienia: ${err.message}`);
    } finally {
      setIsSaving(prev => { const n = new Set(prev); n.delete(sku); return n; });
    }
  };
  
  // Selection
  const toggleSelect = (sku: string) => {
    setSelectedItems(prev => {
      const n = new Set(prev);
      n.has(sku) ? n.delete(sku) : n.add(sku);
      return n;
    });
  };
  
  const selectAll = () => {
    if (selectedItems.size === displayedItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(displayedItems.map(i => i.sku)));
    }
  };
  
  // Bulk actions
  const handleBulkGenerateTitles = async () => {
    for (const sku of selectedItems) await handleGenerateTitle(sku);
  };
  
  const handleBulkGenerateDescriptions = async () => {
    for (const sku of selectedItems) await handleGenerateDescription(sku);
  };
  
  const handleBulkSave = async () => {
    for (const sku of selectedItems) {
      if (editedItems[sku]) await handleSaveToEbay(sku);
    }
  };
  
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Treści produktów eBay</h2>
          <p className="text-sm text-slate-500 mt-1">
            Zarządzaj tytułami, opisami i zdjęciami produktów
          </p>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setShowInstructions(!showInstructions)}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${showInstructions ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            ⚙️ Instrukcje AI
          </button>
          <button
            onClick={loadInventoryItems}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 flex items-center gap-2"
          >
            {isLoading ? '⟳ Ładowanie...' : '🔄 Odśwież z eBay'}
          </button>
        </div>
      </div>
      
      {/* View Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('active')}
          className={`px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all ${
            viewMode === 'active' 
              ? 'bg-green-600 text-white shadow-lg' 
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          ✅ Aktywne
          <span className={`px-2 py-0.5 rounded-full text-sm ${viewMode === 'active' ? 'bg-green-500' : 'bg-slate-200'}`}>
            {activeItems.length}
          </span>
        </button>
        <button
          onClick={() => setViewMode('ended')}
          className={`px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all ${
            viewMode === 'ended' 
              ? 'bg-orange-600 text-white shadow-lg' 
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          ⏸️ Zakończone
          <span className={`px-2 py-0.5 rounded-full text-sm ${viewMode === 'ended' ? 'bg-orange-500' : 'bg-slate-200'}`}>
            {endedItems.length}
          </span>
        </button>
      </div>
      
      {/* AI Instructions Panel */}
      {showInstructions && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-6 space-y-4">
          <h3 className="font-bold text-indigo-800">🤖 Instrukcje dla AI</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-indigo-700 mb-1">Instrukcje dla TYTUŁÓW:</label>
              <textarea
                value={titleInstructions}
                onChange={(e) => setTitleInstructions(e.target.value)}
                className="w-full h-32 text-sm border border-indigo-200 rounded-lg p-3"
                placeholder="Jak AI ma generować tytuły..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-purple-700 mb-1">Instrukcje dla OPISÓW:</label>
              <textarea
                value={descInstructions}
                onChange={(e) => setDescInstructions(e.target.value)}
                className="w-full h-32 text-sm border border-purple-200 rounded-lg p-3"
                placeholder="Jak AI ma generować opisy..."
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            💡 Instrukcje są zapisywane lokalnie. AI otrzymuje też dane produktu jako kontekst.
          </p>
        </div>
      )}
      
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-blue-600">{totalItems}</div>
          <div className="text-sm text-slate-500">Wszystkich</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-green-600">{activeItems.length}</div>
          <div className="text-sm text-slate-500">Aktywnych</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-orange-600">{endedItems.length}</div>
          <div className="text-sm text-slate-500">Zakończonych</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-slate-600">{Object.keys(editedItems).length}</div>
          <div className="text-sm text-slate-500">Ze zmianami</div>
        </div>
      </div>
      
      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-4">
          <span className="text-indigo-700 font-medium">Zaznaczono {selectedItems.size}:</span>
          <button onClick={handleBulkGenerateTitles} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
            🤖 Generuj tytuły
          </button>
          <button onClick={handleBulkGenerateDescriptions} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">
            📝 Generuj opisy
          </button>
          <button onClick={handleBulkSave} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            💾 Zapisz wszystkie
          </button>
        </div>
      )}
      
      {/* Products Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-3 text-left">
                <input type="checkbox" checked={selectedItems.size === displayedItems.length && displayedItems.length > 0} onChange={selectAll} className="rounded" />
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Zdjęcia</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">SKU / Cena</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Tytuł</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Opis</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {displayedItems.map((item) => {
              const hasEdits = !!editedItems[item.sku];
              const isProcessingT = processingTitle.has(item.sku);
              const isProcessingD = processingDescription.has(item.sku);
              const isSavingItem = isSaving.has(item.sku);
              const images = getCurrentImages(item.sku);
              const description = getCurrentDescription(item.sku);
              const price = getCurrentPrice(item.sku);
              
              return (
                <tr key={item.sku} className={`border-b border-slate-100 hover:bg-slate-50 ${hasEdits ? 'bg-yellow-50' : ''}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selectedItems.has(item.sku)} onChange={() => toggleSelect(item.sku)} className="rounded" />
                  </td>
                  
                  {/* Images */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {images.slice(0, 2).map((url, i) => (
                        <img key={i} src={url} alt="" className="w-12 h-12 object-cover rounded border"
                          onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="%23ddd"><rect width="48" height="48"/></svg>'; }} />
                      ))}
                      {images.length > 2 && <span className="text-xs text-slate-400">+{images.length - 2}</span>}
                    </div>
                    <button onClick={() => setEditingImagesSku(item.sku)} className="mt-1 px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200">
                      📷 ({images.length})
                    </button>
                  </td>
                  
                  {/* SKU / Price / Status */}
                  <td className="px-3 py-3">
                    <div className="font-mono text-sm font-medium">{item.sku}</div>
                    {price && <div className="text-sm font-bold text-green-600 mt-1">{price} €</div>}
                    <div className="text-xs text-slate-400">{item.product?.brand}</div>
                    <div className={`mt-1 text-xs px-2 py-0.5 rounded-full inline-block ${
                      item.offer?.status === 'PUBLISHED' || item.offer?.status === 'ACTIVE' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {item.offer?.status || 'Brak oferty'}
                    </div>
                  </td>
                  
                  {/* Title */}
                  <td className="px-3 py-3 max-w-xs">
                    <textarea
                      value={getCurrentTitle(item.sku)}
                      onChange={(e) => updateEditedValue(item.sku, 'title', e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded px-2 py-1 resize-none"
                      rows={2} maxLength={80}
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => handleGenerateTitle(item.sku)} disabled={isProcessingT}
                        className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 disabled:opacity-50">
                        {isProcessingT ? '⟳...' : '🤖 AI'}
                      </button>
                      <span className="text-xs text-slate-400">{getCurrentTitle(item.sku).length}/80</span>
                    </div>
                  </td>
                  
                  {/* Description */}
                  <td className="px-3 py-3">
                    <div className="w-48 h-16 text-xs border border-slate-200 rounded p-1 overflow-hidden bg-slate-50 cursor-pointer hover:border-slate-400"
                      onClick={() => setEditingDescriptionSku(item.sku)}>
                      {description ? <div dangerouslySetInnerHTML={{ __html: description.substring(0, 200) + '...' }} />
                        : <span className="text-slate-400 italic">Brak opisu</span>}
                    </div>
                    <button onClick={() => handleGenerateDescription(item.sku)} disabled={isProcessingD}
                      className="mt-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50">
                      {isProcessingD ? '⟳...' : '📝 AI'}
                    </button>
                  </td>
                  
                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      {viewMode === 'active' ? (
                        <>
                          <button onClick={() => handleSaveToEbay(item.sku)} disabled={!hasEdits || isSavingItem}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed">
                            {isSavingItem ? '⟳ Zapisuję...' : '💾 Zapisz do eBay'}
                          </button>
                          <button onClick={() => setEditedItems(p => { const n = {...p}; delete n[item.sku]; return n; })} disabled={!hasEdits}
                            className="px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200 disabled:opacity-50">
                            ↩️ Cofnij
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleRelistItem(item.sku)} disabled={isSavingItem}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-300">
                            {isSavingItem ? '⟳...' : '🔄 Wystaw ponownie'}
                          </button>
                          <button onClick={() => handleSaveToEbay(item.sku)} disabled={!hasEdits || isSavingItem}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-300">
                            💾 Zapisz zmiany
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            
            {displayedItems.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  {viewMode === 'active' ? 'Brak aktywnych produktów' : 'Brak zakończonych produktów'}
                </td>
              </tr>
            )}
            
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="animate-spin text-3xl">⟳</div>
                  <div className="text-slate-400 mt-2">Ładowanie produktów z eBay...</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}
            className="px-3 py-1.5 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50">← Poprzednia</button>
          <span className="px-4 text-sm text-slate-600">Strona {currentPage + 1} z {totalPages}</span>
          <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}
            className="px-3 py-1.5 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50">Następna →</button>
        </div>
      )}
      
      {/* Description Modal */}
      {editingDescriptionSku && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Edycja opisu: {editingDescriptionSku}</h3>
              <button onClick={() => setEditingDescriptionSku(null)} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
            </div>
            <textarea
              value={getCurrentDescription(editingDescriptionSku)}
              onChange={(e) => updateEditedValue(editingDescriptionSku, 'description', e.target.value)}
              className="w-full h-96 font-mono text-sm border border-slate-300 rounded-lg p-3"
              placeholder="Wpisz opis HTML..."
            />
            <div className="mt-4 p-4 bg-slate-50 rounded-lg">
              <h4 className="font-semibold mb-2">Podgląd HTML:</h4>
              <div className="bg-white border border-slate-200 rounded p-4 max-h-64 overflow-auto"
                dangerouslySetInnerHTML={{ __html: getCurrentDescription(editingDescriptionSku) }} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => handleGenerateDescription(editingDescriptionSku)} disabled={processingDescription.has(editingDescriptionSku)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {processingDescription.has(editingDescriptionSku) ? '⟳ Generuję...' : '🤖 Generuj AI'}
              </button>
              <button onClick={() => setEditingDescriptionSku(null)} className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700">
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Images Modal */}
      {editingImagesSku && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Zdjęcia: {editingImagesSku}</h3>
              <button onClick={() => setEditingImagesSku(null)} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
            </div>
            <div className="space-y-2 mb-4">
              {getCurrentImages(editingImagesSku).map((url, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                  <img src={url} alt="" className="w-16 h-16 object-cover rounded"
                    onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="%23ddd"><rect width="64" height="64"/></svg>'; }} />
                  <input type="text" value={url} readOnly className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1" />
                  <div className="flex gap-1">
                    <button onClick={() => handleMoveImage(editingImagesSku, index, 'up')} disabled={index === 0} className="px-2 py-1 text-xs bg-slate-200 rounded disabled:opacity-30">↑</button>
                    <button onClick={() => handleMoveImage(editingImagesSku, index, 'down')} disabled={index === getCurrentImages(editingImagesSku).length - 1} className="px-2 py-1 text-xs bg-slate-200 rounded disabled:opacity-30">↓</button>
                    <button onClick={() => handleRemoveImage(editingImagesSku, index)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">🗑️</button>
                  </div>
                </div>
              ))}
              {getCurrentImages(editingImagesSku).length === 0 && <div className="text-center py-8 text-slate-400">Brak zdjęć</div>}
            </div>
            <div className="flex gap-2">
              <input type="text" value={newImageUrl} onChange={(e) => setNewImageUrl(e.target.value)} placeholder="URL zdjęcia..." className="flex-1 border border-slate-300 rounded-lg px-3 py-2" />
              <button onClick={() => handleAddImage(editingImagesSku)} disabled={!newImageUrl.trim()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-slate-300">➕ Dodaj</button>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setEditingImagesSku(null)} className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700">Zamknij</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContentTab;
