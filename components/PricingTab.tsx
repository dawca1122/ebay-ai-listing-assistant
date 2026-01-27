
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

// Helper: Extract main keywords from product title (first 3-4 meaningful words)
const extractSearchKeywords = (text: string): string => {
  if (!text) return '';
  
  const cleaned = text
    .replace(/\b\d{8,14}\b/g, '')  // Remove EAN codes
    .replace(/\b(Neu|OVP|NEU|neu|New|new|Sealed|sealed|Original|ORIGINAL)\b/gi, '')
    .replace(/\b\d+[hH]\b/g, '')   // Remove "32h" etc.
    .replace(/\bIP\d+\b/gi, '')    // Remove "IP54" etc.
    .replace(/[–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const words = cleaned.split(' ').filter(w => w.length >= 2);
  return words.slice(0, 4).join(' ') || text.split(' ').slice(0, 3).join(' ');
};

// Helper: Get eBay link from itemId
const getEbayLink = (itemId?: string) => {
  if (!itemId) return null;
  const parts = itemId.split('|');
  const realId = parts.length === 3 ? parts[1] : itemId;
  return `https://www.ebay.de/itm/${realId}`;
};

const PricingTab: React.FC<PricingTabProps> = ({ products, setProducts, settings, setSettings, onError, ebayConnected }) => {
  const [isChecking, setIsChecking] = useState(false);
  const [competitionPreviewId, setCompetitionPreviewId] = useState<string | null>(null);
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});
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
      // Extract main keywords from title (removes EAN, "Neu", specs)
      const keywords = extractSearchKeywords(product.title || product.inputName || '');
      const data = await checkMarketPrices(product.ean, keywords);
      
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
          seller: i.seller,
          title: i.title,
          itemId: i.itemId,
          condition: i.condition
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
              disabled={isChecking || pricingProducts.length === 0}
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
                  <th className="px-4 py-4 text-center">Min</th>
                  <th className="px-4 py-4 text-center">Median</th>
                  <th className="px-4 py-4 text-center">Oferty</th>
                  <th className="px-4 py-4 text-center">Twoja Cena</th>
                  <th className="px-4 py-4">Zasada</th>
                  <th className="px-4 py-4 text-center">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pricingProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-20 text-center text-slate-400 italic">Brak produktów do wyceny.</td>
                  </tr>
                ) : (
                  pricingProducts.map(p => {
                    const hasEdited = editedPrices[p.id] !== undefined;
                    const currentPrice = hasEdited ? editedPrices[p.id] : p.priceGross;
                    const hasChanged = hasEdited && editedPrices[p.id] !== p.priceGross;
                    
                    return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold truncate max-w-[200px]">{p.title || p.inputName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">EAN: {p.ean} | SKU: {p.sku || '---'}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-green-600">{p.minTotalCompetition ? `${p.minTotalCompetition.toFixed(2)}€` : '---'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-blue-600">{p.medianTotalCompetition ? `${p.medianTotalCompetition.toFixed(2)}€` : '---'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.competitorPrices && p.competitorPrices.length > 0 ? (
                          <button
                            onClick={() => setCompetitionPreviewId(p.id)}
                            className="text-purple-600 hover:text-purple-800 underline text-xs font-bold"
                          >
                            👁️ {p.competitorPrices.length}
                          </button>
                        ) : (
                          <span className="text-slate-300">---</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <input 
                            type="number" 
                            step="0.01"
                            value={currentPrice}
                            onChange={(e) => {
                              const gross = parseFloat(e.target.value) || 0;
                              setEditedPrices(prev => ({ ...prev, [p.id]: gross }));
                            }}
                            className={`w-20 px-2 py-1.5 border rounded-lg font-black text-center outline-none ${
                              hasChanged 
                                ? 'bg-yellow-50 border-yellow-400 text-yellow-700' 
                                : 'bg-blue-50 border-blue-100 text-blue-600'
                            }`}
                          />
                          {hasChanged && (
                            <button
                              onClick={() => {
                                const gross = editedPrices[p.id];
                                updateProduct(p.id, { 
                                  priceGross: gross, 
                                  priceNet: parseFloat((gross / 1.19).toFixed(2)),
                                  pricingRuleApplied: 'Ręcznie'
                                });
                                setEditedPrices(prev => {
                                  const next = { ...prev };
                                  delete next[p.id];
                                  return next;
                                });
                              }}
                              className="px-2 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600"
                              title="Zapisz cenę"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[9px] font-bold text-slate-400">{p.pricingRuleApplied || 'Brak'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => handleCheckCompetition(p.id)}
                          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
                          title="Sprawdź ceny konkurencji"
                        >
                          🔄
                        </button>
                      </td>
                    </tr>
                    );
                  })
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
              <strong>Jak działa wycena:</strong><br/><br/>
              1. Kliknij <strong>"Sprawdź ceny konkurencji"</strong> - pobieramy realne ceny z eBay.de<br/>
              2. AI wyszukuje po EAN lub tytule produktu (tylko nowe/jak nowe)<br/>
              3. <strong>Min</strong> = najtańsza oferta (cena + dostawa)<br/>
              4. <strong>Median</strong> = środkowa wartość wszystkich ofert<br/><br/>
              
              <strong>Tryby Undercut:</strong><br/>
              • <em>Najniższa cena</em>: Twoja cena = Min - Undercut<br/>
              • <em>Mediana</em>: Twoja cena = Median - Undercut<br/>
              • <em>Ręcznie</em>: Sam ustalasz cenę<br/><br/>
              
              Cena nigdy nie spadnie poniżej <strong>Ceny Minimalnej</strong>.
            </div>
          </div>
        </section>
      </div>

      {/* Competition Preview Modal */}
      {competitionPreviewId && (() => {
        const product = products.find(p => p.id === competitionPreviewId);
        if (!product || !product.competitorPrices) return null;
        
        const sortedByPrice = [...product.competitorPrices].sort((a, b) => a.totalPrice - b.totalPrice);
        const top10 = sortedByPrice.slice(0, 10);
        
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-black text-lg">Oferty konkurencji</h3>
                  <p className="text-sm text-slate-500 truncate max-w-md">{product.title || product.inputName}</p>
                </div>
                <button 
                  onClick={() => setCompetitionPreviewId(null)}
                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <div className="space-y-3">
                  {top10.map((offer, idx) => (
                    <div key={idx} className={`p-4 rounded-2xl border ${idx === 0 ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${idx === 0 ? 'bg-green-500 text-white' : 'bg-slate-300 text-slate-600'}`}>
                              #{idx + 1}
                            </span>
                            {offer.condition && (
                              <span className="text-[10px] text-slate-400 italic">{offer.condition}</span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-slate-700 line-clamp-2">{offer.title || 'Brak tytułu'}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`font-black text-lg ${idx === 0 ? 'text-green-600' : 'text-slate-700'}`}>
                            {offer.totalPrice.toFixed(2)}€
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {offer.price.toFixed(2)}€ + {offer.shipping.toFixed(2)}€
                          </div>
                          {offer.itemId && (
                            <a 
                              href={getEbayLink(offer.itemId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                            >
                              Zobacz na eBay →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {product.competitorPrices.length > 10 && (
                  <p className="mt-4 text-center text-xs text-slate-400">
                    Pokazano 10 z {product.competitorPrices.length} ofert
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default PricingTab;
