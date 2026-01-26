import React, { useState, useEffect } from 'react';
import { AppSettings, EBAY_DE_CONSTANTS } from '../types';

interface SettingsTabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
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

// LocalStorage key for eBay tokens
const EBAY_TOKENS_KEY = 'ebay_oauth_tokens';

// Helper functions to manage tokens in localStorage
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

const SettingsTab: React.FC<SettingsTabProps> = ({ settings, setSettings }) => {
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

  const updateSection = <T extends keyof AppSettings>(section: T, updates: Partial<AppSettings[T]>) => {
    setSettings(prev => ({
      ...prev,
      [section]: { ...prev[section], ...updates }
    }));
  };

  // Check localStorage for tokens on mount
  useEffect(() => {
    checkLocalTokens();
    
    // Listen for OAuth success messages from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'EBAY_AUTH_SUCCESS' && event.data?.tokens) {
        console.log('OAuth success - storing tokens');
        storeTokens(event.data.tokens);
        checkLocalTokens();
        setIsConnecting(false);
      } else if (event.data?.type === 'EBAY_AUTH_ERROR') {
        console.error('OAuth error:', event.data.error);
        setIsConnecting(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkLocalTokens = () => {
    const tokens = getStoredTokens();
    const valid = isTokenValid(tokens);
    setIsConnected(valid);
    setTokenExpiresAt(tokens?.expiresAt || null);
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

  const handleConnectEbay = async () => {
    // Validate required fields
    if (!settings.ebay.clientId || !settings.ebay.clientSecret || !settings.ebay.ruName) {
      alert('Uzupełnij Client ID, Client Secret i RuName przed połączeniem!');
      return;
    }
    
    setIsConnecting(true);
    
    try {
      // Get state for CSRF protection
      const prepareResponse = await fetch(`${API_BASE}/oauth/prepare`);
      const { state } = await prepareResponse.json();
      
      // Get auth URL
      const authUrlResponse = await fetch(`${API_BASE}/oauth/auth-url?state=${state}`);
      const authData = await authUrlResponse.json();
      
      if (!authData.authUrl) {
        throw new Error(authData.error || 'Nie udało się wygenerować URL autoryzacji');
      }
      
      // Open OAuth popup
      const authWindow = window.open(authData.authUrl, 'ebay_oauth', 'width=600,height=700');
      
      // Monitor popup closing
      const checkClosed = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          checkLocalTokens();
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
    
    const tokens = getStoredTokens();
    if (!tokens) {
      setEbayTestResult({
        success: false,
        message: 'Nie jesteś połączony z eBay',
        hint: 'Kliknij "Połącz eBay (OAuth)" aby się zalogować'
      });
      setIsTestingEbay(false);
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/test-connection`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.accessToken}`
        }
      });
      const result = await response.json();
      
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
    const tokens = getStoredTokens();
    if (!tokens) {
      setPoliciesError('Najpierw połącz się z eBay');
      return;
    }
    
    setIsLoadingPolicies(true);
    setPoliciesError(null);
    
    try {
      const response = await fetch(`${API_BASE}/policies`, {
        headers: { 
          'Authorization': `Bearer ${tokens.accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
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
    const tokens = getStoredTokens();
    if (!tokens) {
      setLocationError('Najpierw połącz się z eBay');
      return;
    }
    
    setIsLoadingLocations(true);
    setLocationError(null);
    
    try {
      const response = await fetch(`${API_BASE}/locations`, {
        headers: { 
          'Authorization': `Bearer ${tokens.accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
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
    
    const tokens = getStoredTokens();
    if (!tokens) {
      setLocationError('Najpierw połącz się z eBay');
      return;
    }
    
    setIsLoadingLocations(true);
    setLocationError(null);
    
    try {
      const response = await fetch(`${API_BASE}/locations`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.accessToken}`
        },
        body: JSON.stringify({
          merchantLocationKey: newLocationKey.trim(),
          name: `Warehouse ${newLocationKey.trim()}`,
          address: {
            city: 'Berlin',
            postalCode: '10115',
            country: 'DE'
          }
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
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

      {/* ============ D) VAT i Pricing Rules ============ */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
          <span className="p-2 bg-amber-100 rounded-xl text-amber-600">💰</span> 
          D) VAT i Pricing Rules
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
