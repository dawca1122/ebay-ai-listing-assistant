import React, { useState, useEffect } from 'react';
import { AppSettings, EBAY_DE_CONSTANTS, GEMINI_MODELS, GeminiModelId, DEFAULT_GEMINI_MODELS, DEFAULT_AI_INSTRUCTIONS, DEFAULT_COMPANY_BANNER } from '../types';
import { 
  getOAuthStatus, 
  getOAuthStartUrl,
  disconnectOAuth, 
  testEbayConnection, 
  fetchPolicies, 
  fetchLocations, 
  createLocation 
} from '../services/ebayService';

interface SettingsTabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onEbayConnect?: () => void;
}

interface EbayTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  tokenType: string;
}

interface TestResult {
  success: boolean;
  message: string;
  hint?: string;
  categoryTreeId?: string;
}

interface PolicyItem {
  policyId: string;
  name: string;
  description?: string;
}

interface PoliciesData {
  payment: PolicyItem[];
  fulfillment: PolicyItem[];
  return: PolicyItem[];
}

interface LocationData {
  merchantLocationKey: string;
  name?: string;
  address?: {
    city?: string;
    postalCode?: string;
    country?: string;
  };
}

// API Base - relative URL works both locally (with Vite proxy) and on Vercel
const API_BASE = '/api/ebay';

// LocalStorage key for eBay tokens (kept for backward compatibility)
const EBAY_TOKENS_KEY = 'ebay_oauth_tokens';

// Helper functions to manage tokens in localStorage (for backward compatibility)
const getStoredTokens = (): EbayTokens | null => {
  const stored = localStorage.getItem(EBAY_TOKENS_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

const storeTokens = (tokens: EbayTokens) => {
  localStorage.setItem(EBAY_TOKENS_KEY, JSON.stringify(tokens));
};

const clearStoredTokens = () => {
  localStorage.removeItem(EBAY_TOKENS_KEY);
};

// Check if tokens are valid (not expired)
const isTokenValid = (tokens: EbayTokens | null): boolean => {
  if (!tokens) return false;
  return tokens.expiresAt > Date.now() + (5 * 60 * 1000);
};

const SettingsTab: React.FC<SettingsTabProps> = ({ settings, setSettings, onEbayConnect }) => {
  // OAuth state
  const [isConnected, setIsConnected] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ebayTestResult, setEbayTestResult] = useState<TestResult | null>(null);
  const [isTestingEbay, setIsTestingEbay] = useState(false);
  
  // Policies state
  const [policies, setPolicies] = useState<PoliciesData | null>(null);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(false);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  
  // Location state
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [newLocationKey, setNewLocationKey] = useState('');
  
  // Save status
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Gemini test state
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Active AI tab
  const [activeAiTab, setActiveAiTab] = useState<'models' | 'instructions'>('models');

  const updateSection = <T extends keyof AppSettings>(section: T, updates: Partial<AppSettings[T]>) => {
    setSettings(prev => ({
      ...prev,
      [section]: { ...prev[section], ...updates }
    }));
  };
  
  // Initialize missing settings if needed
  useEffect(() => {
    if (!settings.geminiModels) {
      setSettings(prev => ({ ...prev, geminiModels: DEFAULT_GEMINI_MODELS }));
    }
    if (!settings.aiInstructions) {
      setSettings(prev => ({ ...prev, aiInstructions: DEFAULT_AI_INSTRUCTIONS }));
    }
  }, []);

  // Check connection status on mount (now uses cookies)
  useEffect(() => {
    checkConnectionStatus();
    
    // Listen for OAuth success messages from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'EBAY_AUTH_SUCCESS' && event.data?.tokens) {
        console.log('OAuth success - storing tokens in localStorage for backward compatibility');
        storeTokens(event.data.tokens);
        checkConnectionStatus();
        onEbayConnect?.(); // Notify parent to refresh status
        setIsConnecting(false);
      } else if (event.data?.type === 'EBAY_AUTH_ERROR') {
        console.error('OAuth error:', event.data.error);
        // Handle invalid_scope specifically
        if (event.data.isInvalidScope) {
          alert('eBay odrzucił scope. Poprawiono konfigurację — uruchom Połącz eBay ponownie.');
        }
        setIsConnecting(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkConnectionStatus = async () => {
    try {
      const status = await getOAuthStatus();
      setIsConnected(status.connected);
      setTokenExpiresAt(status.expiresAt);
    } catch (error) {
      console.error('Failed to check connection status:', error);
      // Fallback to localStorage
      const tokens = getStoredTokens();
      const valid = tokens ? tokens.expiresAt > Date.now() + (5 * 60 * 1000) : false;
      setIsConnected(valid);
      setTokenExpiresAt(tokens?.expiresAt || null);
    }
  };

  // ============ A) eBay API ============

  const handleSaveSettings = () => {
    setSaveStatus('saving');
    // Settings are already in state and saved via useEffect in App.tsx
    localStorage.setItem('ebay_ai_settings', JSON.stringify(settings));
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  // ============ Gemini Test ============
  const handleTestGemini = async () => {
    if (!settings.geminiKey) {
      setGeminiTestResult({ success: false, message: 'Brak klucza API Gemini' });
      return;
    }
    
    setIsTestingGemini(true);
    setGeminiTestResult(null);
    
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: settings.geminiKey });
      const model = settings.geminiModels?.titleDescription || 'gemini-2.5-flash';
      
      const response = await ai.models.generateContent({
        model,
        contents: 'Odpowiedz tylko: OK',
      });
      
      if (response.text?.includes('OK')) {
        setGeminiTestResult({ 
          success: true, 
          message: `✅ Połączono z Gemini! Model: ${model}` 
        });
      } else {
        setGeminiTestResult({ 
          success: true, 
          message: `✅ Gemini odpowiedział: "${response.text?.slice(0, 50)}..."` 
        });
      }
    } catch (error: any) {
      setGeminiTestResult({ 
        success: false, 
        message: `❌ Błąd: ${error.message}` 
      });
    }
    
    setIsTestingGemini(false);
  };

  const handleConnectEbay = () => {
    setIsConnecting(true);
    
    try {
      // Open popup directly to OAuth start endpoint - it will redirect to eBay
      const oauthUrl = getOAuthStartUrl();
      console.log('[OAuth] Opening popup to:', oauthUrl);
      
      const authWindow = window.open(oauthUrl, 'ebay_oauth', 'width=600,height=700');
      
      // Monitor popup closing
      const checkClosed = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          checkConnectionStatus();
        }
      }, 1000);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkClosed);
        setIsConnecting(false);
      }, 5 * 60 * 1000);
      
    } catch (error: any) {
      console.error('OAuth error:', error);
      alert(`Błąd: ${error.message}`);
      setIsConnecting(false);
    }
  };

  const handleDisconnectEbay = async () => {
    if (!confirm('Czy na pewno chcesz rozłączyć z eBay?')) return;
    
    try {
      await disconnectOAuth();
    } catch (error) {
      console.error('Disconnect error:', error);
    }
    
    clearStoredTokens();
    setIsConnected(false);
    setTokenExpiresAt(null);
    setEbayTestResult(null);
    setPolicies(null);
    setLocations([]);
  };

  const handleTestEbay = async () => {
    setIsTestingEbay(true);
    setEbayTestResult(null);
    
    try {
      const result = await testEbayConnection();
      
      if (result.success) {
        setEbayTestResult({
          success: true,
          message: `Połączenie OK!`,
          categoryTreeId: result.categoryTreeId || EBAY_DE_CONSTANTS.CATEGORY_TREE_ID
        });
      } else {
        setEbayTestResult({
          success: false,
          message: result.message || 'Błąd połączenia',
          hint: result.hint
        });
      }
    } catch (error: any) {
      setEbayTestResult({
        success: false,
        message: `Błąd: ${error.message}`,
        hint: "Sprawdź połączenie internetowe"
      });
    }
    
    setIsTestingEbay(false);
  };

  // ============ B) Polityki eBay ============

  const handleFetchPolicies = async () => {
    setIsLoadingPolicies(true);
    setPoliciesError(null);
    
    try {
      const data = await fetchPolicies();
      
      setPolicies({
        payment: data.paymentPolicies || [],
        fulfillment: data.fulfillmentPolicies || [],
        return: data.returnPolicies || []
      });
      
    } catch (error: any) {
      setPoliciesError(`Błąd pobierania polityk: ${error.message}`);
    }
    
    setIsLoadingPolicies(false);
  };

  // ============ C) Lokalizacja ============

  const handleFetchLocations = async () => {
    setIsLoadingLocations(true);
    setLocationError(null);
    
    try {
      const data = await fetchLocations();
      
      setLocations(data.locations || []);
      
      // Auto-select first location if none selected
      if (data.locations?.length > 0 && !settings.policies.merchantLocationKey) {
        updateSection('policies', { merchantLocationKey: data.locations[0].merchantLocationKey });
      }
      
    } catch (error: any) {
      setLocationError(`Błąd pobierania lokalizacji: ${error.message}`);
    }
    
    setIsLoadingLocations(false);
  };

  const handleCreateLocation = async () => {
    if (!newLocationKey.trim()) {
      setLocationError('Wpisz klucz lokalizacji');
      return;
    }
    
    setIsLoadingLocations(true);
    setLocationError(null);
    
    try {
      await createLocation(
        newLocationKey.trim(),
        `Warehouse ${newLocationKey.trim()}`,
        { city: 'Berlin', postalCode: '10115', country: 'DE' }
      );
      
      // Refresh locations
      await handleFetchLocations();
      setNewLocationKey('');
      updateSection('policies', { merchantLocationKey: newLocationKey.trim() });
      
    } catch (error: any) {
      setLocationError(`Błąd tworzenia lokalizacji: ${error.message}`);
    }
    
    setIsLoadingLocations(false);
  };

  return (
    <div className="space-y-8 pb-12 max-w-5xl mx-auto">
      
      {/* ============ A) eBay API ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-blue-100 rounded-xl text-blue-600">🔌</span> 
          A) eBay API
        </h2>
        
        <div className="space-y-6">
          {/* Pola konfiguracyjne */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Client ID</label>
              <input 
                type="text" 
                value={settings.ebay.clientId} 
                onChange={(e) => updateSection('ebay', { clientId: e.target.value })} 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                placeholder="Production-ClientID..." 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Client Secret</label>
              <input 
                type="password" 
                value={settings.ebay.clientSecret} 
                onChange={(e) => updateSection('ebay', { clientSecret: e.target.value })} 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                placeholder="PRD-secret..." 
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">RuName (Redirect URI Name)</label>
              <input 
                type="text" 
                value={settings.ebay.ruName} 
                onChange={(e) => updateSection('ebay', { ruName: e.target.value })} 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                placeholder="Konrad_Tomczak-KonradTo-dodawa-zozqj" 
              />
              <p className="text-[10px] text-slate-400 mt-1 ml-1">Znajdziesz w eBay Developer → User Tokens</p>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Marketplace</label>
              <input 
                type="text" 
                value={EBAY_DE_CONSTANTS.MARKETPLACE_ID} 
                readOnly
                className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-mono text-slate-500 cursor-not-allowed" 
              />
            </div>
          </div>
          
          {/* Status połączenia */}
          <div className={`flex justify-between items-center p-4 rounded-2xl border ${
            isConnected 
              ? 'bg-green-50 border-green-200' 
              : 'bg-slate-50 border-slate-100'
          }`}>
            <div>
              <span className="text-[10px] font-black uppercase text-slate-400 block">Status połączenia</span>
              <span className={`text-sm font-bold ${isConnected ? 'text-green-700' : 'text-slate-500'}`}>
                {isConnected ? '✅ Połączono z eBay' : '⚪ Nie połączono'}
              </span>
              {tokenExpiresAt && (
                <span className="text-[10px] text-slate-400 block">
                  Token wygasa: {new Date(tokenExpiresAt).toLocaleString('pl-PL')}
                </span>
              )}
            </div>
          </div>
          
          {/* Przyciski */}
          <div className="flex flex-wrap gap-3">
            <button 
              onClick={handleSaveSettings}
              disabled={saveStatus === 'saving'}
              className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                saveStatus === 'saved' 
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
              }`}
            >
              {saveStatus === 'saving' ? '⏳ Zapisywanie...' : saveStatus === 'saved' ? '✅ Zapisano!' : '💾 Zapisz ustawienia'}
            </button>
            
            {!isConnected ? (
              <button 
                onClick={handleConnectEbay} 
                disabled={isConnecting} 
                className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                  isConnecting 
                    ? 'bg-blue-200 text-blue-500 cursor-wait' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isConnecting ? "⏳ Łączenie..." : "🔗 Połącz eBay (OAuth)"}
              </button>
            ) : (
              <button 
                onClick={handleDisconnectEbay}
                className="px-6 py-3 bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 font-bold rounded-xl text-sm transition-all"
              >
                🔌 Odłącz
              </button>
            )}
            
            <button 
              onClick={handleTestEbay} 
              disabled={isTestingEbay || !isConnected} 
              className={`px-6 py-3 rounded-xl text-sm font-bold transition-all border ${
                isTestingEbay 
                  ? 'bg-slate-100 text-slate-400 cursor-wait' 
                  : isConnected
                    ? 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200'
              }`}
            >
              {isTestingEbay ? "⏳ Testowanie..." : "🧪 Testuj eBay"}
            </button>
          </div>
          
          {/* Wynik testu */}
          {ebayTestResult && (
            <div className={`p-4 rounded-xl border ${
              ebayTestResult.success 
                ? 'bg-green-50 border-green-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <div className={`font-bold text-sm ${ebayTestResult.success ? 'text-green-700' : 'text-red-700'}`}>
                {ebayTestResult.success ? '✅' : '❌'} {ebayTestResult.message}
              </div>
              {ebayTestResult.categoryTreeId && (
                <div className="mt-2 text-sm text-green-600">
                  📂 Category Tree ID: <span className="font-mono font-bold">{ebayTestResult.categoryTreeId}</span>
                </div>
              )}
              {ebayTestResult.hint && (
                <div className="mt-2 text-xs text-red-600 bg-red-100 p-2 rounded-lg">
                  💡 {ebayTestResult.hint}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ============ B) Polityki eBay ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-green-100 rounded-xl text-green-600">📋</span> 
          B) Polityki eBay (Account API)
        </h2>
        
        <div className="space-y-6">
          {/* Przycisk pobierania */}
          <button 
            onClick={handleFetchPolicies}
            disabled={isLoadingPolicies || !isConnected}
            className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
              isLoadingPolicies 
                ? 'bg-slate-100 text-slate-400 cursor-wait' 
                : isConnected
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isLoadingPolicies ? "⏳ Pobieranie..." : "📥 Pobierz polityki"}
          </button>
          
          {policiesError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              ❌ {policiesError}
            </div>
          )}
          
          {/* Dropdowny polityk */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Payment Policy</label>
              <select 
                value={settings.policies.paymentPolicyId}
                onChange={(e) => updateSection('policies', { paymentPolicyId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              >
                <option value="">-- Wybierz --</option>
                {policies?.payment.map(p => (
                  <option key={p.policyId} value={p.policyId}>{p.name}</option>
                ))}
              </select>
              {settings.policies.paymentPolicyId && (
                <p className="text-[9px] text-slate-400 mt-1 ml-1 font-mono">{settings.policies.paymentPolicyId}</p>
              )}
            </div>
            
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Fulfillment Policy</label>
              <select 
                value={settings.policies.fulfillmentPolicyId}
                onChange={(e) => updateSection('policies', { fulfillmentPolicyId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              >
                <option value="">-- Wybierz --</option>
                {policies?.fulfillment.map(p => (
                  <option key={p.policyId} value={p.policyId}>{p.name}</option>
                ))}
              </select>
              {settings.policies.fulfillmentPolicyId && (
                <p className="text-[9px] text-slate-400 mt-1 ml-1 font-mono">{settings.policies.fulfillmentPolicyId}</p>
              )}
            </div>
            
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Return Policy</label>
              <select 
                value={settings.policies.returnPolicyId}
                onChange={(e) => updateSection('policies', { returnPolicyId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              >
                <option value="">-- Wybierz --</option>
                {policies?.return.map(p => (
                  <option key={p.policyId} value={p.policyId}>{p.name}</option>
                ))}
              </select>
              {settings.policies.returnPolicyId && (
                <p className="text-[9px] text-slate-400 mt-1 ml-1 font-mono">{settings.policies.returnPolicyId}</p>
              )}
            </div>
          </div>
          
          {!policies && !policiesError && isConnected && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
              💡 Kliknij "Pobierz polityki" aby załadować listę z eBay Account API
            </div>
          )}
        </div>
      </section>

      {/* ============ C) Lokalizacja ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-purple-100 rounded-xl text-purple-600">📍</span> 
          C) Lokalizacja (Inventory)
        </h2>
        
        <div className="space-y-6">
          {/* Przycisk pobierania */}
          <button 
            onClick={handleFetchLocations}
            disabled={isLoadingLocations || !isConnected}
            className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
              isLoadingLocations 
                ? 'bg-slate-100 text-slate-400 cursor-wait' 
                : isConnected
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isLoadingLocations ? "⏳ Sprawdzanie..." : "🔍 Sprawdź merchantLocationKey"}
          </button>
          
          {locationError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              ❌ {locationError}
            </div>
          )}
          
          {/* Dropdown lokalizacji */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Merchant Location Key</label>
              {locations.length > 0 ? (
                <select 
                  value={settings.policies.merchantLocationKey}
                  onChange={(e) => updateSection('policies', { merchantLocationKey: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                >
                  <option value="">-- Wybierz --</option>
                  {locations.map(loc => (
                    <option key={loc.merchantLocationKey} value={loc.merchantLocationKey}>
                      {loc.merchantLocationKey} {loc.name ? `(${loc.name})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input 
                  type="text" 
                  value={settings.policies.merchantLocationKey}
                  onChange={(e) => updateSection('policies', { merchantLocationKey: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                  placeholder="np. warehouse-de" 
                />
              )}
            </div>
            
            {/* Tworzenie nowej lokalizacji */}
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Utwórz nową lokalizację</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={newLocationKey}
                  onChange={(e) => setNewLocationKey(e.target.value)}
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                  placeholder="nowy-klucz" 
                />
                <button 
                  onClick={handleCreateLocation}
                  disabled={isLoadingLocations || !isConnected || !newLocationKey.trim()}
                  className="px-4 py-3 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ➕ Utwórz
                </button>
              </div>
            </div>
          </div>
          
          {locations.length === 0 && !locationError && isConnected && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-700">
              💡 Brak lokalizacji? Kliknij "Sprawdź" lub utwórz nową wpisując klucz powyżej.
            </div>
          )}
        </div>
      </section>

      {/* ============ D) Gemini AI ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-indigo-100 rounded-xl text-indigo-600">🤖</span> 
          D) Gemini AI
        </h2>
        
        <div className="space-y-6">
          {/* API Key */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Gemini API Key</label>
              <input 
                type="password" 
                value={settings.geminiKey}
                onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                placeholder="AIza..." 
              />
            </div>
            <div className="flex items-end gap-2">
              <button 
                onClick={handleTestGemini}
                disabled={isTestingGemini || !settings.geminiKey}
                className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                  isTestingGemini 
                    ? 'bg-slate-100 text-slate-400 cursor-wait' 
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {isTestingGemini ? "⏳ Testowanie..." : "🧪 Testuj Gemini"}
              </button>
            </div>
          </div>
          
          {geminiTestResult && (
            <div className={`p-3 rounded-xl border ${
              geminiTestResult.success 
                ? 'bg-green-50 border-green-200 text-green-700' 
                : 'bg-red-50 border-red-200 text-red-700'
            } text-sm`}>
              {geminiTestResult.message}
            </div>
          )}
          
          {/* Tabs: Models / Instructions */}
          <div className="flex gap-2 border-b border-slate-200 pb-2">
            <button
              onClick={() => setActiveAiTab('models')}
              className={`px-4 py-2 rounded-t-lg text-sm font-bold transition-all ${
                activeAiTab === 'models' 
                  ? 'bg-indigo-100 text-indigo-700' 
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              🎯 Modele
            </button>
            <button
              onClick={() => setActiveAiTab('instructions')}
              className={`px-4 py-2 rounded-t-lg text-sm font-bold transition-all ${
                activeAiTab === 'instructions' 
                  ? 'bg-indigo-100 text-indigo-700' 
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              📝 Instrukcje
            </button>
          </div>
          
          {/* Models Tab */}
          {activeAiTab === 'models' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 mb-4">
                Wybierz model Gemini dla każdego zadania. Szybkie modele (Flash) są tańsze, Pro są dokładniejsze.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title & Description */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Tytuły i Opisy
                  </label>
                  <select
                    value={settings.geminiModels?.titleDescription || 'gemini-2.5-flash'}
                    onChange={(e) => updateSection('geminiModels', { titleDescription: e.target.value as GeminiModelId })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  >
                    {Object.entries(GEMINI_MODELS).map(([id, info]) => (
                      <option key={id} value={id}>
                        {info.name} ({info.tier})
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">
                    {GEMINI_MODELS[settings.geminiModels?.titleDescription || 'gemini-2.5-flash']?.desc}
                  </p>
                </div>
                
                {/* Price Search */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Szukanie Cen
                  </label>
                  <select
                    value={settings.geminiModels?.priceSearch || 'gemini-2.5-flash'}
                    onChange={(e) => updateSection('geminiModels', { priceSearch: e.target.value as GeminiModelId })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  >
                    {Object.entries(GEMINI_MODELS).map(([id, info]) => (
                      <option key={id} value={id}>
                        {info.name} ({info.tier})
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">
                    {GEMINI_MODELS[settings.geminiModels?.priceSearch || 'gemini-2.5-flash']?.desc}
                  </p>
                </div>
                
                {/* Table Analysis */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Analiza Tabeli
                  </label>
                  <select
                    value={settings.geminiModels?.tableAnalysis || 'gemini-2.5-pro'}
                    onChange={(e) => updateSection('geminiModels', { tableAnalysis: e.target.value as GeminiModelId })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  >
                    {Object.entries(GEMINI_MODELS).map(([id, info]) => (
                      <option key={id} value={id}>
                        {info.name} ({info.tier})
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">
                    {GEMINI_MODELS[settings.geminiModels?.tableAnalysis || 'gemini-2.5-pro']?.desc}
                  </p>
                </div>
                
                {/* Category Search */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Szukanie Kategorii
                  </label>
                  <select
                    value={settings.geminiModels?.categorySearch || 'gemini-2.5-flash'}
                    onChange={(e) => updateSection('geminiModels', { categorySearch: e.target.value as GeminiModelId })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  >
                    {Object.entries(GEMINI_MODELS).map(([id, info]) => (
                      <option key={id} value={id}>
                        {info.name} ({info.tier})
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">
                    {GEMINI_MODELS[settings.geminiModels?.categorySearch || 'gemini-2.5-flash']?.desc}
                  </p>
                </div>
                
                {/* Product Research */}
                <div className="md:col-span-2 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                  <label className="block text-[10px] font-black uppercase text-purple-600 mb-2 ml-1">
                    🔬 Research Produktu (Deep Search)
                  </label>
                  <select
                    value={settings.geminiModels?.productResearch || 'deep-research-pro-preview'}
                    onChange={(e) => updateSection('geminiModels', { productResearch: e.target.value as GeminiModelId })}
                    className="w-full px-4 py-3 bg-white border border-purple-200 rounded-xl text-sm"
                  >
                    {Object.entries(GEMINI_MODELS).map(([id, info]) => (
                      <option key={id} value={id}>
                        {info.name} ({info.tier})
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-purple-500 mt-1 ml-1">
                    {GEMINI_MODELS[settings.geminiModels?.productResearch || 'deep-research-pro-preview']?.desc}
                  </p>
                  <p className="text-[9px] text-slate-500 mt-2 ml-1">
                    ⚡ Ten model wyszukuje w internecie informacje o produkcie przed generowaniem tytułu/opisu
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Instructions Tab */}
          {activeAiTab === 'instructions' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 mb-4">
                Dostosuj instrukcje (prompty) dla każdego zadania AI.
              </p>
              
              <div className="space-y-4">
                {/* Title Prompt */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Instrukcja: Tytuły
                  </label>
                  <textarea
                    value={settings.aiInstructions?.titlePrompt || ''}
                    onChange={(e) => updateSection('aiInstructions', { titlePrompt: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono h-24 resize-none"
                    placeholder="Instrukcje dla generowania tytułów..."
                  />
                </div>
                
                {/* Description Prompt */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Instrukcja: Opisy
                  </label>
                  <textarea
                    value={settings.aiInstructions?.descriptionPrompt || ''}
                    onChange={(e) => updateSection('aiInstructions', { descriptionPrompt: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono h-24 resize-none"
                    placeholder="Instrukcje dla generowania opisów..."
                  />
                </div>
                
                {/* Price Search Prompt - Info that it uses eBay API now */}
                <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                  <label className="block text-[10px] font-black uppercase text-amber-600 mb-2 ml-1">
                    💰 Sprawdzanie Cen (eBay Browse API)
                  </label>
                  <div className="text-xs text-amber-700 bg-white p-3 rounded-lg border border-amber-100">
                    <p className="font-bold mb-2">ℹ️ Ceny są teraz sprawdzane przez eBay Browse API</p>
                    <p>Sprawdzanie cen konkurencji działa automatycznie przez oficjalne API eBay.</p>
                    <p className="mt-2">Konfiguracja w sekcji E) VAT i Pricing Rules:</p>
                    <ul className="list-disc list-inside mt-1 text-[11px]">
                      <li>Undercut By - kwota odejmowana od min konkurencji</li>
                      <li>Min Gross Price - cena minimalna</li>
                      <li>Tryb: najniższa cena lub mediana</li>
                    </ul>
                  </div>
                </div>
                
                {/* Category Prompt */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Instrukcja: Szukanie Kategorii
                  </label>
                  <textarea
                    value={settings.aiInstructions?.categoryPrompt || ''}
                    onChange={(e) => updateSection('aiInstructions', { categoryPrompt: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono h-24 resize-none"
                    placeholder="Instrukcje dla szukania kategorii eBay..."
                  />
                </div>
                
                {/* Table Analysis Prompt */}
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                    Instrukcja: Analiza Tabeli
                  </label>
                  <textarea
                    value={settings.aiInstructions?.tableAnalysisPrompt || ''}
                    onChange={(e) => updateSection('aiInstructions', { tableAnalysisPrompt: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono h-24 resize-none"
                    placeholder="Instrukcje dla analizy importowanej tabeli..."
                  />
                </div>
                
                {/* Product Research Prompt */}
                <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                  <label className="block text-[10px] font-black uppercase text-purple-600 mb-2 ml-1">
                    🔬 Instrukcja: Research Produktu
                  </label>
                  <textarea
                    value={settings.aiInstructions?.productResearchPrompt || ''}
                    onChange={(e) => updateSection('aiInstructions', { productResearchPrompt: e.target.value })}
                    className="w-full px-4 py-3 bg-white border border-purple-200 rounded-xl text-sm font-mono h-32 resize-none"
                    placeholder="Instrukcje dla wyszukiwania informacji o produkcie w internecie..."
                  />
                  <p className="text-[9px] text-purple-500 mt-2">
                    💡 Ten prompt jest używany przez model Deep Research do wyszukiwania szczegółowych informacji o produkcie
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (confirm('Przywrócić domyślne instrukcje?')) {
                      setSettings(prev => ({ ...prev, aiInstructions: DEFAULT_AI_INSTRUCTIONS }));
                    }
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-all"
                >
                  🔄 Przywróć domyślne
                </button>
              </div>
            </div>
          )}
          
          {/* Save button for AI settings */}
          <div className="pt-4 border-t border-slate-200">
            <button 
              onClick={handleSaveSettings}
              disabled={saveStatus === 'saving'}
              className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                saveStatus === 'saved' 
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {saveStatus === 'saving' ? '⏳ Zapisywanie...' : saveStatus === 'saved' ? '✅ Zapisano!' : '💾 Zapisz ustawienia AI'}
            </button>
            <p className="text-[10px] text-slate-400 mt-2">
              Zmiany modeli i instrukcji są zapisywane dopiero po kliknięciu przycisku.
            </p>
          </div>
        </div>
      </section>

      {/* ============ E) VAT i Pricing Rules ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-amber-100 rounded-xl text-amber-600">💰</span> 
          E) VAT i Pricing Rules
        </h2>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">VAT Rate</label>
              <input 
                type="text" 
                value={`${(EBAY_DE_CONSTANTS.VAT_RATE * 100).toFixed(0)}%`}
                readOnly
                className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-mono text-slate-500 cursor-not-allowed" 
              />
              <p className="text-[10px] text-slate-400 mt-1 ml-1">Stałe dla EBAY_DE</p>
            </div>
            
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Undercut By (€)</label>
              <input 
                type="number" 
                step="0.01"
                value={settings.pricingRules.undercutBy}
                onChange={(e) => updateSection('pricingRules', { undercutBy: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                placeholder="0.01" 
              />
              <p className="text-[10px] text-slate-400 mt-1 ml-1">Kwota odejmowana od min. konkurencji</p>
            </div>
            
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Min Gross Price (€)</label>
              <input 
                type="number" 
                step="0.01"
                value={settings.pricingRules.minGrossPrice}
                onChange={(e) => updateSection('pricingRules', { minGrossPrice: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" 
                placeholder="1.00" 
              />
              <p className="text-[10px] text-slate-400 mt-1 ml-1">Cena minimalna (opcjonalnie)</p>
            </div>
          </div>
          
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700">
            <strong>📊 Pricing Logic:</strong><br/>
            <code className="font-mono">finalPrice = min(konkurencja) - undercutBy</code><br/>
            Jeśli <code>finalPrice &lt; minGrossPrice</code>, to <code>finalPrice = minGrossPrice</code>
          </div>
        </div>
      </section>

      {/* ============ F) Firmowy Baner ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-pink-100 rounded-xl text-pink-600">🎨</span> 
          F) Firmowy Baner
        </h2>
        
        <div className="space-y-6">
          <p className="text-sm text-slate-500">
            Ten baner HTML będzie automatycznie dodawany <strong>na początku</strong> każdego opisu produktu (przed treścią).
          </p>
          
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
              Kod HTML Banera
            </label>
            <textarea
              value={settings.companyBanner || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, companyBanner: e.target.value }))}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono h-48 resize-y"
              placeholder={'<div style="...">Twój baner firmowy...</div>'}
            />
          </div>
          
          {/* Podgląd banera */}
          {settings.companyBanner && (
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">
                Podgląd Banera
              </label>
              <div 
                className="border border-slate-200 rounded-xl p-4 bg-white"
                dangerouslySetInnerHTML={{ __html: settings.companyBanner }}
              />
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (confirm('Przywrócić domyślny baner?')) {
                  setSettings(prev => ({ ...prev, companyBanner: DEFAULT_COMPANY_BANNER }));
                }
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-all"
            >
              🔄 Przywróć domyślny
            </button>
            <button
              onClick={() => setSettings(prev => ({ ...prev, companyBanner: '' }))}
              className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-bold transition-all"
            >
              🗑️ Usuń baner
            </button>
          </div>
          
          <div className="bg-pink-50 border border-pink-200 rounded-xl p-4 text-xs text-pink-700">
            <strong>💡 Wskazówki:</strong><br/>
            • Używaj inline CSS (<code>style="..."</code>) zamiast klas - eBay nie obsługuje zewnętrznych stylów<br/>
            • Unikaj JavaScript - zostanie usunięty przez eBay<br/>
            • Baner pojawi się na końcu opisu każdego produktu<br/>
            • Zapisz ustawienia żeby zmiany zostały zachowane
          </div>
          
          <button 
            onClick={handleSaveSettings}
            disabled={saveStatus === 'saving'}
            className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
              saveStatus === 'saved' 
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-pink-600 hover:bg-pink-700 text-white'
            }`}
          >
            {saveStatus === 'saving' ? '⏳ Zapisywanie...' : saveStatus === 'saved' ? '✅ Zapisano!' : '💾 Zapisz baner'}
          </button>
        </div>
      </section>
      
      {/* Blokada info */}
      {!isConnected && (
        <div className="bg-red-50 border-2 border-red-200 rounded-3xl p-6 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h3 className="text-lg font-black text-red-700 mb-2">Najpierw połącz eBay</h3>
          <p className="text-sm text-red-600">
            Uzupełnij Client ID, Client Secret i RuName, następnie kliknij "Połącz eBay (OAuth)".<br/>
            Bez poprawnego tokenu zakładka Produkty będzie zablokowana.
          </p>
        </div>
      )}
    </div>
  );
};

export default SettingsTab;
