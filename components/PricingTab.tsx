
import React, { useState } from 'react';
import { Product, ProductStatus, AppSettings, EBAY_DE_CONSTANTS } from '../types';
import { checkMarketPrices } from '../services/ebayService';

interface PricingTabProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onError: (msg: string) => void;
  ebayConnected: boolean;
}

const PricingTab: React.FC<PricingTabProps> = ({ products, setProducts, settings, setSettings, onError, ebayConnected }) => {
  const [isChecking, setIsChecking] = useState(false);
  const pricingProducts = products.filter(p => p.status !== ProductStatus.PUBLISHED);

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const updateGlobalRules = (updates: Partial<typeof settings.pricingRules>) => {
    setSettings(prev => ({
      ...prev,
      pricingRules: { ...prev.pricingRules, ...updates }
    }));
  };

  const calculateSuggestedPrice = (minTotal: number, medianTotal: number, rules: typeof settings.pricingRules) => {
    const basePrice = rules.undercutMode === 'median' ? medianTotal : minTotal;
    let price = basePrice - rules.undercutBy;
    if (price < rules.minGrossPrice) {
      price = rules.minGrossPrice;
    }
    return parseFloat(price.toFixed(2));
  };

  // Sprawdzanie cen przez eBay Browse API (Application Token - nie wymaga logowania)
  const handleCheckCompetition = async (id: string) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    // Application Token - nie wymaga logowania użytkownika

    try {
      const searchQuery = product.ean || product.title || product.inputName;
      const data = await checkMarketPrices(product.ean, searchQuery);
      
      const newSuggested = calculateSuggestedPrice(
        data.statistics.min, 
        data.statistics.median, 
        settings.pricingRules
      );
      
      updateProduct(id, {
        competitorPrices: data.items.map(i => ({
          price: i.price,
          shipping: i.shipping,
          total: i.total,
          seller: i.seller
        })),
        minTotalCompetition: data.statistics.min,
        medianTotalCompetition: data.statistics.median,
        priceGross: newSuggested > 0 ? newSuggested : product.priceGross,
        priceNet: newSuggested > 0 ? parseFloat((newSuggested / (1 + EBAY_DE_CONSTANTS.VAT_RATE)).toFixed(2)) : product.priceNet,
        pricingRuleApplied: `${settings.pricingRules.undercutMode} -${settings.pricingRules.undercutBy}€`,
        pricingWarnings: data.items.length === 0 ? ['Brak ofert konkurencji'] : undefined
      });
    } catch (err: any) {
      onError(`Błąd wyceny dla ${product.sku || product.id}: ${err.message}`);
      updateProduct(id, {
        pricingWarnings: [err.message]
      });
    }
  };

  const handleCheckAll = async () => {
    // Application Token - nie wymaga logowania użytkownika
    
    setIsChecking(true);
    for (const p of pricingProducts) {
      await handleCheckCompetition(p.id);
    }
    setIsChecking(false);
  };

  return (
    <div className="grid grid-cols-12 gap-8 h-[calc(100vh-200px)]">
      {/* Info about Application Token */}
      
      {/* Left: Competition Table */}
      <div className="col-span-12 lg:col-span-9 flex flex-col h-full overflow-hidden">
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div>
              <h2 className="text-xl font-black">Analiza Konkurencji</h2>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Rynek: eBay.de (Browse API)</p>
            </div>
            <button
              onClick={handleCheckAll}
              disabled={isChecking || pricingProducts.length === 0 || !ebayConnected}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest px-6 py-3 rounded-2xl shadow-lg transition-all"
            >
              {isChecking ? 'Sprawdzanie...' : 'Sprawdź ceny konkurencji'}
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-white shadow-sm z-10 text-[9px] font-black uppercase text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-4">Produkt (SKU/EAN)</th>
                  <th className="px-4 py-4">Kategoria</th>
                  <th className="px-4 py-4 text-center">Min Total</th>
                  <th className="px-4 py-4 text-center">Median Total</th>
                  <th className="px-4 py-4 text-center">Twoja Sugestia</th>
                  <th className="px-4 py-4">Zasada</th>
                  <th className="px-4 py-4">Ostrzeżenia</th>
                  <th className="px-4 py-4 text-right">Akcja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pricingProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-20 text-center text-slate-400 italic">Brak produktów do wyceny.</td>
                  </tr>
                ) : (
                  pricingProducts.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-bold truncate max-w-[150px]">{p.title || p.inputName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">EAN: {p.ean}</div>
                        <div className="text-[9px] text-blue-500 font-bold">SKU: {p.sku || '---'}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-500 italic max-w-[120px] truncate">{p.ebayCategoryName || '---'}</td>
                      <td className="px-4 py-4 text-center">
                        <span className="font-bold text-slate-700">{p.minTotalCompetition ? `${p.minTotalCompetition}€` : '---'}</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="font-bold text-slate-700">{p.medianTotalCompetition ? `${p.medianTotalCompetition}€` : '---'}</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <input 
                          type="number" 
                          value={p.priceGross}
                          onChange={(e) => {
                            const gross = parseFloat(e.target.value) || 0;
                            updateProduct(p.id, { priceGross: gross, priceNet: parseFloat((gross / 1.19).toFixed(2)) });
                          }}
                          className="w-20 px-2 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-blue-600 font-black text-center outline-none"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[9px] font-bold text-slate-400">{p.pricingRuleApplied || 'Manual'}</span>
                      </td>
                      <td className="px-4 py-4 max-w-[150px]">
                        {p.pricingWarnings?.map((w, idx) => (
                          <div key={idx} className="text-[8px] text-orange-600 font-medium leading-tight mb-1">⚠️ {w}</div>
                        )) || <span className="text-green-500 text-[10px]">✅ OK</span>}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button 
                          onClick={() => handleCheckCompetition(p.id)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
                          title="Przelicz ponownie"
                        >
                          🔄
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right: Rules Panel */}
      <div className="col-span-12 lg:col-span-3 h-full">
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
            <span className="p-1.5 bg-blue-100 rounded-lg text-blue-600 text-xs">🛠️</span> Reguły Ceny
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Undercut (€)</label>
              <input 
                type="number"
                step="0.01"
                value={settings.pricingRules.undercutBy}
                onChange={(e) => updateGlobalRules({ undercutBy: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <p className="mt-1 text-[9px] text-slate-400 italic">Kwota odejmowana od min ceny konkurencji.</p>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Cena Minimalna Brutto (€)</label>
              <input 
                type="number"
                value={settings.pricingRules.minGrossPrice}
                onChange={(e) => updateGlobalRules({ minGrossPrice: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <p className="mt-1 text-[9px] text-slate-400 italic">Cena minimalna brutto, poniżej której nie schodzimy.</p>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Tryb Undercut</label>
              <select 
                value={settings.pricingRules.undercutMode}
                onChange={(e) => updateGlobalRules({ undercutMode: e.target.value as 'lowest' | 'median' | 'manual' })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              >
                <option value="lowest">Najniższa cena</option>
                <option value="median">Mediana</option>
                <option value="manual">Ręcznie</option>
              </select>
              <p className="mt-1 text-[9px] text-slate-400 italic">Wybierz sposób kalkulacji ceny.</p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <div className="p-4 bg-blue-50 rounded-2xl text-[10px] text-blue-700 leading-relaxed italic">
              AI sprawdza realne ceny na <strong>eBay.de</strong> (Item + Shipping). <br/><br/>
              Propozycja ceny = (Min Konkurencja) - (Undercut), ale nie mniej niż (Floor).
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PricingTab;
