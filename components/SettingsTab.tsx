import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { testConnection } from '../services/geminiService';

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
  debug?: any;
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
  // Token is valid if it expires more than 5 minutes from now
  return tokens.expiresAt > Date.now() + (5 * 60 * 1000);
};

const SettingsTab: React.FC<SettingsTabProps> = ({ settings, setSettings }) => {
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  
  // OAuth state
  const [isConnected, setIsConnected] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ebayTestResult, setEbayTestResult] = useState<TestResult | null>(null);
  const [isTestingEbay, setIsTestingEbay] = useState(false);

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

  const handleConnectEbay = async () => {
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
  };

  const handleTestEbay = async () => {
    setIsTestingEbay(true);
    setEbayTestResult(null);
    
    const tokens = getStoredTokens();
    if (!tokens) {
      setEbayTestResult({
        success: false,
        message: 'Nie jesteś połączony z eBay',
        hint: 'Kliknij "Połącz z eBay" aby się zalogować'
      });
      setIsTestingEbay(false);
      return;
    }
    
    try {
      // Test API call - get default category tree
      const response = await fetch(`${API_BASE}/test-connection`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.accessToken}`
        }
      });
      const result = await response.json();
      setEbayTestResult(result);
    } catch (error: any) {
      setEbayTestResult({
        success: false,
        message: `Błąd: ${error.message}`,
        hint: "Sprawdź połączenie internetowe"
      });
    }
    
    setIsTestingEbay(false);
  };

  const handleTestGemini = async () => {
    setIsTesting(true);
    setTestResult(null);
    const ok = await testConnection(settings.geminiKey);
    setTestResult(ok ? "Połączenie OK! ✅" : "Błąd połączenia ❌");
    setIsTesting(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-12">
      {/* eBay API Section */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
           <span className="p-2 bg-blue-100 rounded-xl text-blue-600">🔌</span> eBay API (OAuth)
        </h2>
        <div className="space-y-4">
          
          {/* Status połączenia */}
          <div className="pt-2">
            <div className={`flex justify-between items-center p-3 rounded-2xl border ${
              isConnected 
                ? 'bg-green-50 border-green-200' 
                : 'bg-slate-50 border-slate-100'
            }`}>
               <div>
                 <span className="text-[10px] font-black uppercase text-slate-400 block">Status</span>
                 <span className={`text-sm font-bold ${isConnected ? 'text-green-700' : 'text-slate-500'}`}>
                   {isConnected ? '✅ Połączono z eBay' : '⚪ Nie połączono'}
                 </span>
                 {tokenExpiresAt && (
                   <span className="text-[10px] text-slate-400 block">
                     Token wygasa: {new Date(tokenExpiresAt).toLocaleString('pl-PL')}
                   </span>
                 )}
               </div>
               <div className="text-right">
                 <span className="text-[10px] font-black uppercase text-slate-400 block">Marketplace</span>
                 <span className="text-sm font-bold text-slate-900">{settings.ebay.marketplace}</span>
               </div>
            </div>
          </div>
          
          {/* Przyciski OAuth */}
          <div className="flex gap-2">
            {!isConnected ? (
              <button 
                onClick={handleConnectEbay} 
                disabled={isConnecting} 
                className={`flex-1 font-bold py-3 rounded-xl text-sm transition-all shadow-sm ${
                  isConnecting 
                    ? 'bg-blue-200 text-blue-500 cursor-wait' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isConnecting ? "⏳ Łączenie..." : "🔗 Połącz z eBay (OAuth)"}
              </button>
            ) : (
              <button 
                onClick={handleDisconnectEbay}
                className="flex-1 bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 font-bold py-3 rounded-xl text-sm transition-all"
              >
                🔌 Odłącz
              </button>
            )}
          </div>
          
          {/* Test połączenia */}
          <button 
            onClick={handleTestEbay} 
            disabled={isTestingEbay || !isConnected} 
            className={`w-full font-bold py-2 rounded-xl text-sm transition-all border ${
              isTestingEbay 
                ? 'bg-slate-100 text-slate-400 cursor-wait' 
                : isConnected
                  ? 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isTestingEbay ? "⏳ Testowanie..." : "🧪 Testuj połączenie"}
          </button>
          
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
              {ebayTestResult.hint && (
                <div className="mt-2 text-xs text-red-600 bg-red-100 p-2 rounded-lg">
                  💡 {ebayTestResult.hint}
                </div>
              )}
              {ebayTestResult.debug && (
                <div className="mt-3 text-[10px] font-mono bg-slate-100 p-2 rounded-lg text-slate-600">
                  <div className="font-bold text-slate-700 mb-1">🔍 Debug:</div>
                  <div>connected: <span className={ebayTestResult.debug.connected ? 'text-green-600' : 'text-red-600'}>{String(ebayTestResult.debug.connected)}</span></div>
                  <div>hasRefreshToken: <span className={ebayTestResult.debug.hasRefreshToken ? 'text-green-600' : 'text-red-600'}>{String(ebayTestResult.debug.hasRefreshToken)}</span></div>
                  {ebayTestResult.debug.accessTokenReceived !== undefined && (
                    <div>accessTokenReceived: <span className={ebayTestResult.debug.accessTokenReceived ? 'text-green-600 font-bold' : 'text-red-600'}>{String(ebayTestResult.debug.accessTokenReceived)}</span></div>
                  )}
                  {ebayTestResult.debug.accessTokenLength && (
                    <div>accessTokenLength: <span className="text-blue-600">{ebayTestResult.debug.accessTokenLength}</span></div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Polityki i Lokalizacja */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
           <span className="p-2 bg-green-100 rounded-xl text-green-600">📦</span> Polityki i Lokalizacja
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Fulfillment ID</label>
              <input type="text" value={settings.policies.fulfillmentId} onChange={(e) => updateSection('policies', { fulfillmentId: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Payment ID</label>
              <input type="text" value={settings.policies.paymentId} onChange={(e) => updateSection('policies', { paymentId: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Return ID</label>
              <input type="text" value={settings.policies.returnId} onChange={(e) => updateSection('policies', { returnId: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Merchant Location Key</label>
              <input type="text" value={settings.policies.merchantLocationKey} onChange={(e) => updateSection('policies', { merchantLocationKey: e.target.value })} placeholder="np. default" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Kod Pocztowy (DE)</label>
            <input type="text" value={settings.policies.locationPostalCode} onChange={(e) => updateSection('policies', { locationPostalCode: e.target.value })} placeholder="np. 10115" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono" />
          </div>
        </div>
      </section>

      {/* Gemini AI */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
           <span className="p-2 bg-purple-100 rounded-xl text-purple-600">🧠</span> Gemini AI
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Gemini API Key</label>
            <input type="password" value={settings.geminiKey} onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          </div>
          <button onClick={handleTestGemini} disabled={isTesting} className="w-full bg-slate-50 border border-slate-200 hover:bg-slate-100 font-bold py-2 rounded-xl text-xs transition-all shadow-sm">
            {isTesting ? "Testowanie..." : "Testuj Gemini"}
          </button>
          {testResult && <div className={`text-center p-2 rounded-xl text-xs font-bold ${testResult.includes('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{testResult}</div>}
        </div>
      </section>

      {/* Reguły Generowania */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
           <span className="p-2 bg-orange-100 rounded-xl text-orange-600">📜</span> Reguły Generowania
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">System Prompt</label>
            <input type="text" value={settings.aiRules.systemPrompt} onChange={(e) => updateSection('aiRules', { systemPrompt: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">SKU</label>
              <input type="text" value={settings.aiRules.skuRules} onChange={(e) => updateSection('aiRules', { skuRules: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-1">Tytuły</label>
              <input type="text" value={settings.aiRules.titleRules} onChange={(e) => updateSection('aiRules', { titleRules: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsTab;
