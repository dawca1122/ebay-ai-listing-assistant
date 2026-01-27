import React, { useState } from 'react';
import { Product, ProductStatus, ProductCondition, AppSettings, LogEntry, LogStage, EBAY_DE_CONSTANTS } from '../types';

interface PublicationTabProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  settings: AppSettings;
  ebayStatus: boolean;
  onError: (msg: string) => void;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

const API_BASE = '/api/ebay';

const getStoredTokens = () => {
  const stored = localStorage.getItem('ebay_oauth_tokens');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

const PublicationTab: React.FC<PublicationTabProps> = ({ products, setProducts, settings, ebayStatus, onError, addLog }) => {
  const readyProducts = products.filter(p => p.status === ProductStatus.DRAFT_OK);
  const publishedProducts = products.filter(p => p.status === ProductStatus.PUBLISHED);
  
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const startEditing = (product: Product) => {
    setEditingId(product.id);
    setEditForm({
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      priceGross: product.priceGross,
      quantity: product.quantity,
      sku: product.sku,
      ebayCategoryId: product.ebayCategoryId,
    });
  };

  const saveEditing = () => {
    if (editingId && editForm) {
      const priceGross = editForm.priceGross || 0;
      const priceNet = parseFloat((priceGross / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2));
      updateProduct(editingId, { ...editForm, priceNet });
      setEditingId(null);
      setEditForm({});
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handlePublish = async (id: string) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    if (!ebayStatus) {
      onError("Brak połączenia z eBay! Sprawdź token w ustawieniach.");
      return;
    }

    const tokens = getStoredTokens();
    if (!tokens) {
      onError('Brak tokenu eBay');
      return;
    }

    setPublishingId(id);
    
    let inventoryPayload: any = null;
    let offerPayload: any = null;

    try {
      // Step 1: Create/Update Inventory Item
      setCurrentStep('Tworzenie inventory item...');
      
      // Extract brand and model from title/inputName for eBay aspects
      const titleParts = (product.inputName || product.title).split(' ');
      const brand = titleParts[0] || 'Unknown';
      const model = titleParts.slice(1).join(' ') || product.inputName || 'Unknown';
      
      inventoryPayload = {
        product: {
          title: product.title,
          description: product.descriptionHtml,
          aspects: {
            'Marke': [brand],
            'Modell': [model],
            'EAN': [product.ean]
          },
          brand: brand,
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

      // Step 2: Check if offer exists, if not create one
      setCurrentStep('Sprawdzanie oferty...');
      
      let offerId = '';
      
      // First check if offer already exists for this SKU
      const existingOffersResponse = await fetch(`${API_BASE}/offers/${encodeURIComponent(product.sku)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`
        }
      });
      
      if (existingOffersResponse.ok) {
        const existingOffers = await existingOffersResponse.json();
        if (existingOffers.offers && existingOffers.offers.length > 0) {
          offerId = existingOffers.offers[0].offerId;
          console.log('📦 Using existing offer:', offerId);
        }
      }
      
      if (!offerId) {
        setCurrentStep('Tworzenie oferty...');
        
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

        offerId = offerData.offerId;
        console.log('✅ Created new offer:', offerId);
      }

      // Step 3: Publish Offer
      setCurrentStep('Publikacja oferty...');
      
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

      updateProduct(id, {
        status: ProductStatus.PUBLISHED,
        ebayOfferId: offerId,
        ebayItemId: publishData.listingId || '',
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
      
      alert(`Sukces! Produkt wystawiony pod ID: ${publishData.listingId}`);
    } catch (err: any) {
      const msg = err.message || "Nieoczekiwany błąd podczas publikacji.";
      onError(msg);
      updateProduct(id, {
        status: ProductStatus.ERROR_PUBLISH,
        lastError: `Publikacja: ${msg}`
      });

      addLog({
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        stage: LogStage.PUBLISH,
        action: 'Publish to eBay',
        success: false,
        ebayErrorMessage: msg,
        hint: 'Sprawdź autoryzację eBay i dane oferty.',
        inventoryPayload,
        offerPayload
      });
    } finally {
      setPublishingId(null);
      setCurrentStep('');
    }
  };

  const handleOpenEbay = (itemId: string) => {
    window.open(`https://www.ebay.de/itm/${itemId}`, '_blank');
  };

  return (
    <div className="space-y-12 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Publikacja</h2>
          <p className="text-slate-500 font-medium">Finalny krok: wysyłka ofert do systemu eBay DE.</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-white px-6 py-3 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <span className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></span>
            <span className="text-sm font-black uppercase tracking-widest text-slate-600">Gotowe: {readyProducts.length}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Ready Products */}
      <section>
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-6 flex items-center gap-2">
          <span className="w-8 h-px bg-slate-200"></span> Kolejka do wystawienia
        </h3>

        {readyProducts.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-[40px] p-24 text-center">
            <div className="text-5xl mb-6 grayscale opacity-30">📦</div>
            <p className="text-slate-400 font-bold">Wszystkie przygotowane produkty zostały już obsłużone.</p>
            <p className="text-xs text-slate-300 mt-2 uppercase tracking-widest">Wróć do zakładki Produkty, aby przygotować nowe pozycje.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {readyProducts.map(product => (
              <div key={product.id} className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                {editingId === product.id ? (
                  /* EDIT MODE */
                  <div className="p-8 flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <span className="bg-amber-50 text-amber-600 text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-widest">
                        ✏️ Edycja
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={saveEditing}
                          className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700"
                        >
                          ✅ Zapisz
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="px-4 py-2 bg-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-300"
                        >
                          ✖ Anuluj
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Title</label>
                        <input
                          type="text"
                          value={editForm.title || ''}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Opis (HTML)</label>
                        <textarea
                          value={editForm.descriptionHtml || ''}
                          onChange={(e) => setEditForm({ ...editForm, descriptionHtml: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono h-32 resize-none"
                        />
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Cena Brutto €</label>
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.priceGross || 0}
                            onChange={(e) => setEditForm({ ...editForm, priceGross: parseFloat(e.target.value) || 0 })}
                            className="w-full px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-bold text-blue-700"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Ilość</label>
                          <input
                            type="number"
                            min="1"
                            value={editForm.quantity || 1}
                            onChange={(e) => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 1 })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">SKU</label>
                          <input
                            type="text"
                            value={editForm.sku || ''}
                            onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">eBay Category ID</label>
                        <input
                          type="text"
                          value={editForm.ebayCategoryId || ''}
                          onChange={(e) => setEditForm({ ...editForm, ebayCategoryId: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  /* VIEW MODE */
                  <>
                    <div className="p-8 flex-1">
                      <div className="flex justify-between items-start mb-6">
                        <div className="flex flex-col gap-1">
                          <span className="bg-blue-50 text-blue-600 text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-widest w-fit">
                            Status: Ready
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 mt-1">EAN: {product.ean}</span>
                        </div>
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => startEditing(product)}
                            className="px-3 py-2 bg-amber-100 text-amber-600 rounded-xl text-xs font-bold hover:bg-amber-200"
                            title="Edytuj przed publikacją"
                          >
                            ✏️ Edytuj
                          </button>
                          <div className="text-right">
                            <span className="text-slate-900 font-black text-2xl">{product.priceGross.toFixed(2)} €</span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Cena Brutto</p>
                          </div>
                        </div>
                      </div>
                      
                      <h3 className="font-black text-2xl mb-4 leading-tight group-hover:text-blue-600 transition-colors">{product.title}</h3>
                      
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="block text-[9px] font-black uppercase text-slate-400 mb-1">SKU</span>
                          <span className="text-xs font-bold text-slate-700 font-mono">{product.sku}</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <span className="block text-[9px] font-black uppercase text-slate-400 mb-1">Stock</span>
                          <span className="text-xs font-bold text-slate-700">{product.quantity} szt.</span>
                        </div>
                      </div>

                      <div className="bg-slate-50/50 p-4 rounded-2xl text-[11px] text-slate-500 leading-relaxed italic border border-slate-100 h-24 overflow-y-auto scrollbar-hide">
                        {product.descriptionHtml.replace(/<[^>]*>/g, '').slice(0, 200)}...
                      </div>
                    </div>

                    <div className="bg-slate-50 p-6 border-t border-slate-100">
                      <button 
                        disabled={!!publishingId}
                        onClick={() => handlePublish(product.id)}
                        className={`w-full font-black py-4 rounded-2xl text-xs uppercase tracking-[0.1em] transition-all flex items-center justify-center gap-3 shadow-md active:scale-95 ${
                          publishingId === product.id 
                            ? 'bg-slate-200 text-slate-500 cursor-wait' 
                            : 'bg-slate-900 hover:bg-black text-white'
                        }`}
                      >
                        {publishingId === product.id ? (
                          <>
                            <span className="w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin"></span>
                            {currentStep}
                          </>
                        ) : (
                          <>🚀 Wystaw na eBay.de</>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Published History */}
      {publishedProducts.length > 0 && (
        <section className="mt-12">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-6 flex items-center gap-2">
            <span className="w-8 h-px bg-slate-200"></span> Opublikowane dzisiaj
          </h3>
          <div className="space-y-4">
            {publishedProducts.map(p => (
              <div key={p.id} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6 hover:bg-green-50/20 transition-colors">
                <div className="flex items-center gap-6 flex-1">
                  <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center text-green-600 text-xl">✅</div>
                  <div>
                    <h4 className="font-bold text-slate-900 line-clamp-1">{p.title}</h4>
                    <div className="flex gap-4 mt-1">
                      <span className="text-[10px] text-slate-400 font-mono">SKU: {p.sku}</span>
                      <span className="text-[10px] text-slate-400 font-mono">Item ID: {p.ebayItemId}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <div className="text-right mr-4 hidden md:block">
                    <span className="text-sm font-black text-slate-900">{p.priceGross.toFixed(2)} €</span>
                    <p className="text-[8px] font-black text-slate-400 uppercase">Live Price</p>
                  </div>
                  <button 
                    onClick={() => handleOpenEbay(p.ebayItemId)}
                    className="flex-1 md:flex-none bg-blue-50 text-blue-600 hover:bg-blue-100 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    🔗 Podgląd eBay
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default PublicationTab;
