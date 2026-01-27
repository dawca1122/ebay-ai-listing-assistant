
import React, { useState, useEffect, useCallback } from 'react';
import { AppSettings } from '../types';
import { generateProductDetails } from '../services/geminiService';

// Types for eBay inventory items
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
}

interface ContentTabProps {
  settings: AppSettings;
  onError: (msg: string) => void;
}

const API_BASE = '/api/ebay';

const ContentTab: React.FC<ContentTabProps> = ({ settings, onError }) => {
  const [inventoryItems, setInventoryItems] = useState<EbayInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Processing states for AI agents
  const [processingTitle, setProcessingTitle] = useState<Set<string>>(new Set());
  const [processingDescription, setProcessingDescription] = useState<Set<string>>(new Set());
  const [processingSku, setProcessingSku] = useState<Set<string>>(new Set());
  
  // Edited values (local state before saving to eBay)
  const [editedItems, setEditedItems] = useState<Record<string, Partial<EbayInventoryItem['product']>>>({});
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [itemsPerPage] = useState(25);
  
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
  
  // Get current value (edited or original)
  const getCurrentValue = (sku: string, field: 'title' | 'description') => {
    const item = inventoryItems.find(i => i.sku === sku);
    return editedItems[sku]?.[field] ?? item?.product?.[field] ?? '';
  };
  
  // Update local edited value
  const updateEditedValue = (sku: string, field: string, value: string) => {
    setEditedItems(prev => ({
      ...prev,
      [sku]: {
        ...prev[sku],
        [field]: value
      }
    }));
  };
  
  // AI Agent: Generate Title
  const handleGenerateTitle = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    if (!item) return;
    
    setProcessingTitle(prev => new Set(prev).add(sku));
    
    try {
      const productName = item.product?.title || sku;
      const ean = item.product?.ean?.[0] || '';
      
      const result = await generateProductDetails(
        settings.geminiKey,
        settings.geminiModels.titleDescription,
        productName,
        ean,
        settings.aiRules.titleRules || 'Max 80 chars, German, include brand.',
        settings.aiInstructions.titlePrompt,
        settings.aiInstructions.descriptionPrompt
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
  
  // AI Agent: Generate Description
  const handleGenerateDescription = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    if (!item) return;
    
    setProcessingDescription(prev => new Set(prev).add(sku));
    
    try {
      const productName = item.product?.title || sku;
      const ean = item.product?.ean?.[0] || '';
      
      // Include company banner in description rules
      const descriptionRules = `${settings.aiRules.descriptionRules || 'HTML, German, professional.'}\n\nDODAJ NA KONIEC OPISU TEN BANER FIRMOWY (bez zmian):\n${settings.companyBanner || ''}`;
      
      const result = await generateProductDetails(
        settings.geminiKey,
        settings.geminiModels.titleDescription,
        productName,
        ean,
        descriptionRules,
        settings.aiInstructions.titlePrompt,
        settings.aiInstructions.descriptionPrompt
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
  
  // AI Agent: Generate SKU (note: SKU cannot be changed after creation on eBay)
  const handleGenerateSku = async (sku: string) => {
    // SKU cannot be changed on eBay after item is created
    // This is just for display/reference
    onError('SKU nie może być zmienione po utworzeniu produktu na eBay. Możesz tylko skopiować sugestię.');
  };
  
  // Save changes to eBay
  const handleSaveToEbay = async (sku: string) => {
    const item = inventoryItems.find(i => i.sku === sku);
    const edits = editedItems[sku];
    if (!item || !edits) return;
    
    try {
      // Prepare updated inventory item
      const updatedProduct = {
        ...item.product,
        title: edits.title ?? item.product?.title,
        description: edits.description ?? item.product?.description
      };
      
      const payload = {
        ...item,
        product: updatedProduct
      };
      
      const response = await fetch(`${API_BASE}/inventory/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok && response.status !== 204) {
        const errData = await response.json();
        throw new Error(errData.errors?.[0]?.message || `Error ${response.status}`);
      }
      
      // Clear edits for this item and reload
      setEditedItems(prev => {
        const next = { ...prev };
        delete next[sku];
        return next;
      });
      
      // Reload to get fresh data
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
            Zarządzaj tytułami i opisami produktów z eBay za pomocą AI
          </p>
        </div>
        
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
              🔄 Odśwież
            </>
          )}
        </button>
      </div>
      
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
            💾 Zapisz wszystkie
          </button>
        </div>
      )}
      
      {/* Products Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedItems.size === inventoryItems.length && inventoryItems.length > 0}
                  onChange={selectAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Zdjęcie</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">SKU</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Tytuł</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Opis</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {inventoryItems.map((item) => {
              const hasEdits = !!editedItems[item.sku];
              const isProcessingT = processingTitle.has(item.sku);
              const isProcessingD = processingDescription.has(item.sku);
              const isProcessingS = processingSku.has(item.sku);
              
              return (
                <tr key={item.sku} className={`border-b border-slate-100 hover:bg-slate-50 ${hasEdits ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.sku)}
                      onChange={() => toggleSelect(item.sku)}
                      className="rounded"
                    />
                  </td>
                  
                  {/* Thumbnail */}
                  <td className="px-4 py-3">
                    {item.product?.imageUrls?.[0] ? (
                      <img
                        src={item.product.imageUrls[0]}
                        alt={item.sku}
                        className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="%23ccc"><rect width="64" height="64"/><text x="32" y="32" text-anchor="middle" dy=".3em" fill="%23666" font-size="10">No img</text></svg>';
                        }}
                      />
                    ) : (
                      <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs">
                        No img
                      </div>
                    )}
                  </td>
                  
                  {/* SKU */}
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm text-slate-700">{item.sku}</div>
                    <div className="text-xs text-slate-400">
                      {item.product?.ean?.[0] && `EAN: ${item.product.ean[0]}`}
                    </div>
                  </td>
                  
                  {/* Title */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={getCurrentValue(item.sku, 'title')}
                        onChange={(e) => updateEditedValue(item.sku, 'title', e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded px-2 py-1 resize-none"
                        rows={2}
                        maxLength={80}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleGenerateTitle(item.sku)}
                          disabled={isProcessingT}
                          className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 disabled:opacity-50"
                        >
                          {isProcessingT ? '⟳' : '🤖'} AI Tytuł
                        </button>
                        <span className="text-xs text-slate-400">
                          {getCurrentValue(item.sku, 'title').length}/80
                        </span>
                      </div>
                    </div>
                  </td>
                  
                  {/* Description */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <div 
                        className="w-48 h-16 text-xs border border-slate-200 rounded px-2 py-1 overflow-hidden bg-slate-50"
                        dangerouslySetInnerHTML={{ 
                          __html: getCurrentValue(item.sku, 'description').substring(0, 200) + '...' 
                        }}
                      />
                      <button
                        onClick={() => handleGenerateDescription(item.sku)}
                        disabled={isProcessingD}
                        className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50 w-fit"
                      >
                        {isProcessingD ? '⟳' : '📝'} AI Opis
                      </button>
                    </div>
                  </td>
                  
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      {hasEdits && (
                        <button
                          onClick={() => handleSaveToEbay(item.sku)}
                          className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          💾 Zapisz do eBay
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditedItems(prev => {
                            const next = { ...prev };
                            delete next[item.sku];
                            return next;
                          });
                        }}
                        disabled={!hasEdits}
                        className="px-3 py-1.5 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200 disabled:opacity-50"
                      >
                        ↩️ Cofnij zmiany
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            
            {inventoryItems.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  Brak produktów w magazynie eBay. Najpierw opublikuj produkty.
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
    </div>
  );
};

export default ContentTab;
