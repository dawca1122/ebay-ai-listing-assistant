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
  // Offer data from API enrichment
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
  price?: string;
}

interface ContentTabProps {
  settings: AppSettings;
  onError: (msg: string) => void;
}

const API_BASE = '/api/ebay';

// Storage keys
const STORAGE_KEY_TITLE_INSTRUCTIONS = 'ebay_content_title_instructions';
const STORAGE_KEY_DESC_INSTRUCTIONS = 'ebay_content_desc_instructions';

const ContentTab: React.FC<ContentTabProps> = ({ settings, onError }) => {
  const [inventoryItems, setInventoryItems] = useState<EbayInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // AI Instructions (local to this tab, stored in localStorage)
  const [titleInstructions, setTitleInstructions] = useState(() => 
    localStorage.getItem(STORAGE_KEY_TITLE_INSTRUCTIONS) || 
    'Wygeneruj profesjonalny tytuł po niemiecku. Max 80 znaków. Zawrzyj markę i kluczowe cechy produktu. Bez wykrzykników.'
  );
  const [descInstructions, setDescInstructions] = useState(() =>
    localStorage.getItem(STORAGE_KEY_DESC_INSTRUCTIONS) ||
    'Wygeneruj profesjonalny opis produktu w HTML po niemiecku. Użyj nagłówków <h3>, list <ul><li>, pogrubień <strong>. Opisz cechy, specyfikację i korzyści.'
  );
  const [showInstructions, setShowInstructions] = useState(false);
  
  // Processing states for AI agents
  const [processingTitle, setProcessingTitle] = useState<Set<string>>(new Set());
  const [processingDescription, setProcessingDescription] = useState<Set<string>>(new Set());
  
  // Edited values (local state before saving to eBay)
  const [editedItems, setEditedItems] = useState<Record<string, EditedProduct>>({});
  
  // Modal for editing description
  const [editingDescriptionSku, setEditingDescriptionSku] = useState<string | null>(null);
  
  // Modal for managing images
  const [editingImagesSku, setEditingImagesSku] = useState<string | null>(null);
  const [newImageUrl, setNewImageUrl] = useState('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [itemsPerPage] = useState(25);
  
  // Save instructions to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TITLE_INSTRUCTIONS, titleInstructions);
  }, [titleInstructions]);
  
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DESC_INSTRUCTIONS, descInstructions);
  }, [descInstructions]);
  
  // Load inventory items from eBay
  const loadInventoryItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = currentPage * itemsPerPage;
      const response = await fetch(`${API_BASE}/inventory-items?limit=${itemsPerPage}&offset=${offset}`, {
        method: 'GET',
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load inventory: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[ContentTab] Loaded items:', data.inventoryItems?.length, 'with offers');
      setInventoryItems(data.inventoryItems || []);
      setTotalItems(data.total || 0);
      
    } catch (err: any) {
      onError(`Błąd ładowania produktów z eBay: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, itemsPerPage, onError]);
  
  useEffect(() => {
    loadInventoryItems();
  }, [loadInventoryItems]);
  
  // Get current value (edited or original) - description from offer!
  const getCurrentTitle = (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    return editedItems[sku]?.title ?? item?.product?.title ?? '';
  };
  
  const getCurrentDescription = (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    // Description comes from offer.listingDescription, NOT product.description
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
  
  // Update local edited value
  const updateEditedValue = (sku: string, field: keyof EditedProduct, value: any) => {
    setEditedItems(prev => ({
      ...prev,
      [sku]: {
        ...prev[sku],
        [field]: value
      }
    }));
  };
  
  // AI Agent: Generate Title - uses existing product info + local instructions
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
      
      // Build context from existing data + use local instructions
      const contextInfo = `
INSTRUKCJE DLA AI:
${titleInstructions}

ISTNIEJĄCE DANE PRODUKTU (użyj jako kontekst):
- Aktualny tytuł: ${existingTitle}
- Marka: ${brand}
- EAN: ${ean}
- Cechy produktu: ${aspects}
- Fragment opisu: ${existingDescription.substring(0, 800)}

Wygeneruj TYLKO nowy tytuł (bez dodatkowych wyjaśnień).
`;
      
      const result = await generateProductDetails(
        settings.geminiKey,
        existingTitle,
        ean,
        contextInfo,
        settings.geminiModels.titleDescription,
        titleInstructions, // Use local instructions
        descInstructions
      );
      
      if (result.title) {
        updateEditedValue(sku, 'title', result.title);
      }
    } catch (err: any) {
      onError(`Błąd generowania tytułu: ${err.message}`);
    } finally {
      setProcessingTitle(prev => {
        const next = new Set(prev);
        next.delete(sku);
        return next;
      });
    }
  };
  
  // AI Agent: Generate Description - uses existing product info + local instructions
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
      
      // Build rich context from existing data + use local instructions
      const contextInfo = `
INSTRUKCJE DLA AI:
${descInstructions}

ISTNIEJĄCE DANE PRODUKTU (użyj jako podstawę do nowego opisu):
- Tytuł: ${existingTitle}
- Marka: ${brand}
- EAN: ${ean}
- Cechy produktu: ${aspects}

AKTUALNY OPIS (przepisz i ulepsz w HTML):
${existingDescription}

${settings.companyBanner ? `DODAJ NA KONIEC OPISU TEN BANER FIRMOWY (bez zmian):\n${settings.companyBanner}` : ''}

Wygeneruj TYLKO nowy opis HTML (bez dodatkowych wyjaśnień).
`;
      
      const result = await generateProductDetails(
        settings.geminiKey,
        existingTitle,
        ean,
        contextInfo,
        settings.geminiModels.titleDescription,
        titleInstructions,
        descInstructions // Use local instructions
      );
      
      if (result.descriptionHtml) {
        updateEditedValue(sku, 'description', result.descriptionHtml);
      }
    } catch (err: any) {
      onError(`Błąd generowania opisu: ${err.message}`);
    } finally {
      setProcessingDescription(prev => {
        const next = new Set(prev);
        next.delete(sku);
        return next;
      });
    }
  };
  
  // Image management
  const handleAddImage = (sku: string) => {
    if (!newImageUrl.trim()) return;
    
    const currentImages = getCurrentImages(sku);
    updateEditedValue(sku, 'imageUrls', [...currentImages, newImageUrl.trim()]);
    setNewImageUrl('');
  };
  
  const handleRemoveImage = (sku: string, index: number) => {
    const currentImages = getCurrentImages(sku);
    const newImages = currentImages.filter((_, i) => i !== index);
    updateEditedValue(sku, 'imageUrls', newImages);
  };
  
  const handleMoveImage = (sku: string, index: number, direction: 'up' | 'down') => {
    const currentImages = [...getCurrentImages(sku)];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= currentImages.length) return;
    
    [currentImages[index], currentImages[newIndex]] = [currentImages[newIndex], currentImages[index]];
    updateEditedValue(sku, 'imageUrls', currentImages);
  };
  
  // Save changes to eBay - update both inventory AND offer
  const handleSaveToEbay = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    const edits = editedItems[sku];
    if (!item) {
      onError('Nie znaleziono produktu');
      return;
    }
    
    console.log('[ContentTab] Saving to eBay:', sku, 'edits:', edits);
    console.log('[ContentTab] Item has offer:', !!item.offer, 'offerId:', item.offer?.offerId);
    
    try {
      // 1. Update inventory item (title, images) if changed
      if (edits?.title || edits?.imageUrls) {
        const updatedProduct = {
          ...item.product,
          title: edits?.title ?? item.product?.title,
          imageUrls: edits?.imageUrls ?? item.product?.imageUrls
        };
        
        const inventoryPayload = {
          ...item,
          product: updatedProduct
        };
        delete (inventoryPayload as any).offer; // Remove offer from inventory payload
        
        console.log('[ContentTab] Updating inventory item:', sku);
        
        const invResponse = await fetch(`${API_BASE}/inventory/${encodeURIComponent(sku)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inventoryPayload)
        });
        
        if (!invResponse.ok && invResponse.status !== 204) {
          const errData = await invResponse.json();
          console.error('[ContentTab] Inventory update failed:', errData);
          throw new Error(errData.errors?.[0]?.message || `Inventory error ${invResponse.status}`);
        }
        console.log('[ContentTab] Inventory updated successfully');
      }
      
      // 2. Update offer (description) if we have offer ID and description changed
      if (edits?.description) {
        if (!item.offer?.offerId) {
          console.warn('[ContentTab] No offerId found for this item - cannot update description');
          onError('Ten produkt nie ma aktywnej oferty - opis nie został zapisany');
        } else {
          const offerPayload = {
            listingDescription: edits.description
          };
          
          console.log('[ContentTab] Updating offer:', item.offer.offerId, 'description length:', edits.description.length);
          
          const offerResponse = await fetch(`${API_BASE}/offer/${item.offer.offerId}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(offerPayload)
          });
          
          if (!offerResponse.ok && offerResponse.status !== 204) {
            const errData = await offerResponse.json();
            console.error('[ContentTab] Offer update failed:', errData);
            throw new Error(errData.errors?.[0]?.message || `Offer error ${offerResponse.status}`);
          }
          console.log('[ContentTab] Offer updated successfully');
        }
      }
      
      // Clear edits for this item and reload
      setEditedItems(prev => {
        const next = { ...prev };
        delete next[sku];
        return next;
      });
      
      await loadInventoryItems();
      
    } catch (err: any) {
      onError(`Błąd zapisywania do eBay: ${err.message}`);
    }
  };
  
  // Toggle selection
  const toggleSelect = (sku: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(sku)) {
        next.delete(sku);
      } else {
        next.add(sku);
      }
      return next;
    });
  };
  
  // Select all
  const selectAll = () => {
    if (selectedItems.size === inventoryItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(inventoryItems.map(i => i.sku)));
    }
  };
  
  // Bulk generate titles for selected
  const handleBulkGenerateTitles = async () => {
    for (const sku of selectedItems) {
      await handleGenerateTitle(sku);
    }
  };
  
  // Bulk generate descriptions for selected
  const handleBulkGenerateDescriptions = async () => {
    for (const sku of selectedItems) {
      await handleGenerateDescription(sku);
    }
  };
  
  // Bulk save to eBay
  const handleBulkSave = async () => {
    for (const sku of selectedItems) {
      if (editedItems[sku]) {
        await handleSaveToEbay(sku);
      }
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
            Zarządzaj tytułami, opisami i zdjęciami produktów z eBay za pomocą AI
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
            {isLoading ? (
              <>
                <span className="animate-spin">⟳</span>
                Ładowanie...
              </>
            ) : (
              <>
                🔄 Odśwież z eBay
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* AI Instructions Panel */}
      {showInstructions && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-6 space-y-4">
          <h3 className="font-bold text-indigo-800 flex items-center gap-2">
            🤖 Instrukcje dla AI
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-indigo-700 mb-1">
                Instrukcje dla generowania TYTUŁÓW:
              </label>
              <textarea
                value={titleInstructions}
                onChange={(e) => setTitleInstructions(e.target.value)}
                className="w-full h-32 text-sm border border-indigo-200 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Opisz jak AI ma generować tytuły..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-purple-700 mb-1">
                Instrukcje dla generowania OPISÓW:
              </label>
              <textarea
                value={descInstructions}
                onChange={(e) => setDescInstructions(e.target.value)}
                className="w-full h-32 text-sm border border-purple-200 rounded-lg p-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                placeholder="Opisz jak AI ma generować opisy HTML..."
              />
            </div>
          </div>
          
          <p className="text-xs text-slate-500">
            💡 Te instrukcje są zapisywane lokalnie i używane przy każdym generowaniu. AI otrzymuje też dane produktu (tytuł, marka, EAN, cechy, aktualny opis) jako kontekst.
          </p>
        </div>
      )}
      
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-blue-600">{totalItems}</div>
          <div className="text-sm text-slate-500">Produktów w eBay</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-green-600">{selectedItems.size}</div>
          <div className="text-sm text-slate-500">Zaznaczonych</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-orange-600">{Object.keys(editedItems).length}</div>
          <div className="text-sm text-slate-500">Ze zmianami</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="text-2xl font-bold text-slate-600">{currentPage + 1}/{totalPages || 1}</div>
          <div className="text-sm text-slate-500">Strona</div>
        </div>
      </div>
      
      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-4">
          <span className="text-indigo-700 font-medium">
            Zaznaczono {selectedItems.size} produktów:
          </span>
          <button
            onClick={handleBulkGenerateTitles}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
          >
            🤖 Generuj tytuły
          </button>
          <button
            onClick={handleBulkGenerateDescriptions}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
          >
            📝 Generuj opisy
          </button>
          <button
            onClick={handleBulkSave}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
          >
            💾 Zapisz wszystkie do eBay
          </button>
        </div>
      )}
      
      {/* Products Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedItems.size === inventoryItems.length && inventoryItems.length > 0}
                  onChange={selectAll}
                  className="rounded"
                />
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Zdjęcia</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">SKU / Cena</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Tytuł</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Opis</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {inventoryItems.map((item) => {
              const hasEdits = !!editedItems[item.sku];
              const isProcessingT = processingTitle.has(item.sku);
              const isProcessingD = processingDescription.has(item.sku);
              const images = getCurrentImages(item.sku);
              const description = getCurrentDescription(item.sku);
              const price = getCurrentPrice(item.sku);
              
              return (
                <tr key={item.sku} className={`border-b border-slate-100 hover:bg-slate-50 ${hasEdits ? 'bg-yellow-50' : ''}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.sku)}
                      onChange={() => toggleSelect(item.sku)}
                      className="rounded"
                    />
                  </td>
                  
                  {/* Thumbnails + Image Management */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {images.slice(0, 2).map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt={`${item.sku}-${i}`}
                          className="w-12 h-12 object-cover rounded border border-slate-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="%23ddd"><rect width="48" height="48"/><text x="24" y="28" text-anchor="middle" fill="%23999" font-size="8">ERR</text></svg>';
                          }}
                        />
                      ))}
                      {images.length > 2 && (
                        <span className="text-xs text-slate-400">+{images.length - 2}</span>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingImagesSku(item.sku)}
                      className="mt-1 px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                    >
                      📷 Zarządzaj ({images.length})
                    </button>
                  </td>
                  
                  {/* SKU / Price */}
                  <td className="px-3 py-3">
                    <div className="font-mono text-sm text-slate-700 font-medium">{item.sku}</div>
                    {price && (
                      <div className="text-sm font-bold text-green-600 mt-1">
                        {price} €
                      </div>
                    )}
                    <div className="text-xs text-slate-400">
                      {item.product?.ean?.[0] && `EAN: ${item.product.ean[0]}`}
                    </div>
                    <div className="text-xs text-slate-400">
                      {item.product?.brand && `${item.product.brand}`}
                    </div>
                  </td>
                  
                  {/* Title */}
                  <td className="px-3 py-3 max-w-xs">
                    <textarea
                      value={getCurrentTitle(item.sku)}
                      onChange={(e) => updateEditedValue(item.sku, 'title', e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded px-2 py-1 resize-none"
                      rows={2}
                      maxLength={80}
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => handleGenerateTitle(item.sku)}
                        disabled={isProcessingT}
                        className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 disabled:opacity-50"
                      >
                        {isProcessingT ? '⟳ Generuję...' : '🤖 AI Tytuł'}
                      </button>
                      <span className="text-xs text-slate-400">
                        {getCurrentTitle(item.sku).length}/80
                      </span>
                    </div>
                  </td>
                  
                  {/* Description */}
                  <td className="px-3 py-3">
                    <div 
                      className="w-48 h-16 text-xs border border-slate-200 rounded p-1 overflow-hidden bg-slate-50 cursor-pointer hover:border-slate-400"
                      onClick={() => setEditingDescriptionSku(item.sku)}
                    >
                      {description ? (
                        <div dangerouslySetInnerHTML={{ __html: description.substring(0, 200) + '...' }} />
                      ) : (
                        <span className="text-slate-400 italic">Brak opisu - kliknij aby dodać</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleGenerateDescription(item.sku)}
                      disabled={isProcessingD}
                      className="mt-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
                    >
                      {isProcessingD ? '⟳ Generuję...' : '📝 AI Opis'}
                    </button>
                  </td>
                  
                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => handleSaveToEbay(item.sku)}
                        disabled={!hasEdits}
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-300"
                      >
                        💾 Zapisz do eBay
                      </button>
                      <button
                        onClick={() => {
                          setEditedItems(prev => {
                            const next = { ...prev };
                            delete next[item.sku];
                            return next;
                          });
                        }}
                        disabled={!hasEdits}
                        className="px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200 disabled:opacity-50"
                      >
                        ↩️ Cofnij
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            
            {inventoryItems.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  Brak produktów w magazynie eBay. Najpierw opublikuj produkty w zakładce "Produkty".
                </td>
              </tr>
            )}
            
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="animate-spin text-3xl">⟳</div>
                  <div className="text-slate-400 mt-2">Ładowanie produktów z eBay (może trwać dłużej - pobieram też opisy z ofert)...</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-3 py-1.5 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50"
          >
            ← Poprzednia
          </button>
          
          <span className="px-4 text-sm text-slate-600">
            Strona {currentPage + 1} z {totalPages}
          </span>
          
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1.5 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50"
          >
            Następna →
          </button>
        </div>
      )}
      
      {/* Description Edit Modal */}
      {editingDescriptionSku && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Edycja opisu: {editingDescriptionSku}</h3>
              <button
                onClick={() => setEditingDescriptionSku(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl"
              >
                ×
              </button>
            </div>
            
            <textarea
              value={getCurrentDescription(editingDescriptionSku)}
              onChange={(e) => updateEditedValue(editingDescriptionSku, 'description', e.target.value)}
              className="w-full h-96 font-mono text-sm border border-slate-300 rounded-lg p-3"
              placeholder="Wpisz opis HTML produktu..."
            />
            
            <div className="mt-4 p-4 bg-slate-50 rounded-lg">
              <h4 className="font-semibold mb-2">Podgląd HTML:</h4>
              <div 
                className="bg-white border border-slate-200 rounded p-4 max-h-64 overflow-auto"
                dangerouslySetInnerHTML={{ __html: getCurrentDescription(editingDescriptionSku) }}
              />
            </div>
            
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => handleGenerateDescription(editingDescriptionSku)}
                disabled={processingDescription.has(editingDescriptionSku)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {processingDescription.has(editingDescriptionSku) ? '⟳ Generuję...' : '🤖 Generuj AI'}
              </button>
              <button
                onClick={() => setEditingDescriptionSku(null)}
                className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Images Management Modal */}
      {editingImagesSku && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Zarządzanie zdjęciami: {editingImagesSku}</h3>
              <button
                onClick={() => setEditingImagesSku(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl"
              >
                ×
              </button>
            </div>
            
            {/* Current images */}
            <div className="space-y-2 mb-4">
              {getCurrentImages(editingImagesSku).map((url, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                  <img
                    src={url}
                    alt={`img-${index}`}
                    className="w-16 h-16 object-cover rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="%23ddd"><rect width="64" height="64"/><text x="32" y="36" text-anchor="middle" fill="%23999" font-size="10">ERR</text></svg>';
                    }}
                  />
                  <input
                    type="text"
                    value={url}
                    readOnly
                    className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleMoveImage(editingImagesSku, index, 'up')}
                      disabled={index === 0}
                      className="px-2 py-1 text-xs bg-slate-200 rounded disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveImage(editingImagesSku, index, 'down')}
                      disabled={index === getCurrentImages(editingImagesSku).length - 1}
                      className="px-2 py-1 text-xs bg-slate-200 rounded disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleRemoveImage(editingImagesSku, index)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
              
              {getCurrentImages(editingImagesSku).length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  Brak zdjęć. Dodaj poniżej.
                </div>
              )}
            </div>
            
            {/* Add new image */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                placeholder="Wklej URL zdjęcia (https://...)"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
              />
              <button
                onClick={() => handleAddImage(editingImagesSku)}
                disabled={!newImageUrl.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-slate-300"
              >
                ➕ Dodaj
              </button>
            </div>
            
            <div className="mt-2 text-xs text-slate-400">
              Wspierane: bezpośrednie linki do obrazów. Linki Google Drive zostaną automatycznie skonwertowane.
            </div>
            
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setEditingImagesSku(null)}
                className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContentTab;
