
import React, { useState } from 'react';
import { Product, ProductStatus, AppSettings } from '../types';
import { publishToEbay } from '../services/ebayService';

interface PublicationTabProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  settings: AppSettings;
  ebayStatus: boolean;
  onError: (msg: string) => void;
}

const PublicationTab: React.FC<PublicationTabProps> = ({ products, setProducts, settings, ebayStatus, onError }) => {
  const readyProducts = products.filter(p => p.status === ProductStatus.DRAFT_OK);
  const publishedProducts = products.filter(p => p.status === ProductStatus.PUBLISHED);
  
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string>('');

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handlePublish = async (id: string) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    if (!ebayStatus) {
      onError("Brak połączenia z eBay! Sprawdź token i dane API w ustawieniach.");
      return;
    }

    setPublishingId(id);
    setCurrentStep('Inicjalizacja...');

    try {
      const result = await publishToEbay(product, settings, (step) => setCurrentStep(step));
      
      updateProduct(id, {
        status: ProductStatus.PUBLISHED,
        ebayOfferId: result.offerId,
        ebayItemId: result.itemId,
        lastError: ''
      });
      
      alert(`Sukces! Produkt wystawiony pod ID: ${result.itemId}`);
    } catch (err: any) {
      const msg = err.message || "Nieoczekiwany błąd podczas publikacji.";
      onError(msg);
      updateProduct(id, {
        status: ProductStatus.ERROR_PUBLISH,
        lastError: `Publikacja: ${msg}`
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
                <div className="p-8 flex-1">
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex flex-col gap-1">
                      <span className="bg-blue-50 text-blue-600 text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-widest w-fit">
                        Status: Ready
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 mt-1">EAN: {product.ean}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-900 font-black text-2xl">{product.priceGross.toFixed(2)} €</span>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Cena Brutto</p>
                    </div>
                  </div>
                  
                  <h3 className="font-black text-xl mb-4 leading-tight group-hover:text-blue-600 transition-colors">{product.title}</h3>
                  
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
