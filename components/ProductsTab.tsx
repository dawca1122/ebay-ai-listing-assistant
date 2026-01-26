
import React, { useState, useMemo } from 'react';
import { Product, ProductStatus, ProductCondition, AppSettings } from '../types';
import { generateProductDetails, suggestCategory, generateProductTitle } from '../services/geminiService';

interface ProductsTabProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  settings: AppSettings;
  aiInstructions: string;
  onError: (msg: string) => void;
}

const ProductsTab: React.FC<ProductsTabProps> = ({ products, setProducts, settings, aiInstructions, onError }) => {
  const [bulkInput, setBulkInput] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isFindingCategory, setIsFindingCategory] = useState(false);

  const handleBulkImport = () => {
    const lines = bulkInput.split('\n').filter(line => line.trim() !== '');
    const newItems: Product[] = [];

    // Format: NAZWA | EAN | KATEGORIA_SKLEPU | ILOŚĆ
    lines.forEach(line => {
      const parts = line.split('|').map(p => p.trim());
      const name = parts[0] || '';
      const ean = parts[1] || '';
      const shopCategory = parts[2] || '';
      const qty = parseInt(parts[3]) || 1;

      if (name && ean) {
        newItems.push({
          id: crypto.randomUUID().split('-')[0],
          ean: ean,
          inputName: name,
          shopCategory: shopCategory,
          quantity: qty,
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
      onError("Format błędu. Użyj: NAZWA | EAN | KATEGORIA | ILOŚĆ");
    }
  };

  const handleClearAll = () => {
    if (products.length === 0) return;
    if (window.confirm("Czy na pewno chcesz usunąć WSZYSTKIE produkty z listy? Te dane nie zostaną przywrócone.")) {
      setProducts([]);
      setSelectedProductId(null);
    }
  };

  const selectedProduct = useMemo(() => 
    products.find(p => p.id === selectedProductId), 
    [products, selectedProductId]
  );

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleGenerateAi = async (id: string) => {
    const p = products.find(item => item.id === id);
    if (!p) return;
    setIsGenerating(true);
    try {
      const details = await generateProductDetails(settings.geminiKey, p.inputName, p.ean, aiInstructions);
      // Mapuj stare pola na nowe
      updateProduct(id, { 
        sku: details.sku,
        title: details.title,
        descriptionHtml: details.descriptionHtml,
        keywords: details.keywords,
        ebayCategoryId: details.categoryId,
        ebayCategoryName: details.categoryName
      });
    } catch (err: any) {
      onError(err.message || "Błąd AI.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateTitleOnly = async (id: string) => {
    const p = products.find(item => item.id === id);
    if (!p) return;
    setIsGeneratingTitle(true);
    try {
      const title = await generateProductTitle(settings.geminiKey, p.inputName, p.ean, aiInstructions);
      updateProduct(id, { title });
    } catch (err: any) {
      onError(err.message || "Błąd generowania tytułu.");
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const handleSuggestCategory = async (id: string) => {
    const p = products.find(item => item.id === id);
    if (!p) return;
    setIsFindingCategory(true);
    try {
      const results = await suggestCategory(settings.geminiKey, p.inputName);
      if (results.length > 0) {
        const top1 = results[0];
        updateProduct(id, { ebayCategoryId: top1.id, ebayCategoryName: `(${top1.confidence}) ${top1.name}` });
      }
    } catch (err: any) {
      onError(err.message || "Błąd kategorii.");
    } finally {
      setIsFindingCategory(false);
    }
  };

  const handleValidate = (id: string) => {
    const p = products.find(item => item.id === id);
    if (!p) return;

    const errors: string[] = [];
    if (!p.ean) errors.push("Brak EAN");
    if (p.quantity <= 0) errors.push("Ilość <= 0");
    if (!p.sku) errors.push("Brak SKU");
    if (!p.title || p.title.length > 80) errors.push("Tytuł (1-80 znaków)");
    if (!p.descriptionHtml) errors.push("Brak Opisu");
    if (!p.ebayCategoryId) errors.push("Brak Kategorii eBay");
    if (p.priceGross <= 0) errors.push("Cena <= 0");
    
    if (!settings.policies.fulfillmentPolicyId || !settings.policies.paymentPolicyId || !settings.policies.returnPolicyId || !settings.policies.merchantLocationKey) {
      errors.push("Brak kompletnych polityk w Ustawieniach");
    }

    if (errors.length > 0) {
      updateProduct(id, { status: ProductStatus.ERROR, lastError: errors.join(", ") });
    } else {
      updateProduct(id, { status: ProductStatus.READY, lastError: "" });
    }
  };

  const handleSave = () => alert("Zapisano lokalnie.");

  return (
    <div className="grid grid-cols-12 gap-8 h-[calc(100vh-200px)]">
      <div className="col-span-12 lg:col-span-5 flex flex-col gap-6 h-full overflow-hidden">
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 shrink-0">
          <textarea 
            value={bulkInput} 
            onChange={(e) => setBulkInput(e.target.value)} 
            placeholder="NAZWA | EAN" 
            className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono mb-3 resize-none focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
          />
          <div className="flex gap-2">
            <button 
              onClick={handleBulkImport} 
              className="flex-1 bg-slate-900 text-white font-bold py-3 rounded-2xl hover:bg-black transition-colors active:scale-95"
            >
              Importuj
            </button>
            <button 
              onClick={handleClearAll}
              disabled={products.length === 0}
              className="px-4 bg-red-50 text-red-600 font-bold py-3 rounded-2xl hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
              title="Wyczyść listę"
            >
              🗑️
            </button>
          </div>
        </section>

        <section className="bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/30 flex justify-between items-center">
            <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Lista produktów ({products.length})</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-white border-b border-slate-100 uppercase font-black text-slate-400">
                <tr>
                  <th className="px-4 py-3">Produkt</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Akcja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-12 text-center text-slate-400 italic">Brak produktów na liście. Zaimportuj dane powyżej.</td>
                  </tr>
                ) : (
                  products.map(p => (
                    <tr 
                      key={p.id} 
                      className={`cursor-pointer hover:bg-slate-50 transition-colors ${selectedProductId === p.id ? 'bg-blue-50' : ''}`} 
                      onClick={() => setSelectedProductId(p.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold truncate max-w-[150px]">{p.inputName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{p.ean}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter ${
                          p.status === ProductStatus.READY ? 'bg-green-100 text-green-700' : 
                          p.status === ProductStatus.ERROR ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-400'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-[10px] font-black uppercase text-blue-600 hover:underline">Edytuj</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="col-span-12 lg:col-span-7 h-full overflow-hidden">
        {selectedProduct ? (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 h-full flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0 bg-slate-50/30">
              <div className="flex gap-2">
                <button 
                  onClick={() => handleGenerateAi(selectedProduct.id)} 
                  disabled={isGenerating} 
                  className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-blue-100 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isGenerating ? "..." : "🤖 Generuj wszystko"}
                </button>
                <button 
                  onClick={() => handleSuggestCategory(selectedProduct.id)} 
                  disabled={isFindingCategory} 
                  className="bg-purple-50 text-purple-600 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-purple-100 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  🏷️ Kategoria
                </button>
                <button 
                  onClick={() => handleValidate(selectedProduct.id)} 
                  className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-black transition-all flex items-center gap-2"
                >
                  ✅ Waliduj
                </button>
              </div>
              <div className="text-[10px] font-bold text-slate-400">ID: {selectedProduct.id}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {selectedProduct.status === ProductStatus.ERROR && (
                <div className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-2xl text-[10px] flex items-start gap-3">
                  <span className="text-sm">⚠️</span>
                  <div className="font-bold leading-relaxed">{selectedProduct.lastError}</div>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tytuł Aukcji</label>
                    <button 
                      onClick={() => handleGenerateTitleOnly(selectedProduct.id)} 
                      disabled={isGeneratingTitle}
                      className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 disabled:opacity-50 flex items-center gap-1 transition-all"
                    >
                      {isGeneratingTitle ? "Generuję..." : "✨ AI Tytuł"}
                    </button>
                  </div>
                  <input 
                    type="text" 
                    value={selectedProduct.title} 
                    onChange={(e) => updateProduct(selectedProduct.id, { title: e.target.value })} 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                    placeholder="Wprowadź tytuł..."
                  />
                  <div className="flex justify-end mt-1">
                    <span className={`text-[9px] font-bold ${selectedProduct.title.length > 80 ? 'text-red-500' : 'text-slate-300'}`}>
                      {selectedProduct.title.length}/80
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">SKU</label>
                  <input 
                    type="text" 
                    value={selectedProduct.sku} 
                    onChange={(e) => updateProduct(selectedProduct.id, { sku: e.target.value })} 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                    placeholder="Auto-generowane..."
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">EAN</label>
                  <input 
                    type="text" 
                    value={selectedProduct.ean} 
                    disabled 
                    className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-2xl text-sm font-mono text-slate-500 cursor-not-allowed" 
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Opis HTML</label>
                <textarea 
                  value={selectedProduct.descriptionHtml} 
                  onChange={(e) => updateProduct(selectedProduct.id, { descriptionHtml: e.target.value })} 
                  className="w-full h-64 px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none" 
                  placeholder="Tutaj pojawi się opis produktu..."
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50/30">
              <button 
                onClick={handleSave} 
                className="w-full py-3 bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-[0.98]"
              >
                Zapisz zmiany lokalnie
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 bg-white rounded-3xl border-2 border-dashed border-slate-100">
            <div className="text-6xl mb-4 grayscale opacity-20">🛒</div>
            <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Wybierz produkt z listy po lewej</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductsTab;
