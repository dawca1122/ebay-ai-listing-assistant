
import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import ProductsTab from './components/ProductsTab';
import PricingTab from './components/PricingTab';
import PublicationTab from './components/PublicationTab';
import SettingsTab from './components/SettingsTab';
import DebugTab from './components/DebugTab';
import { Product, AppSettings, LogEntry, LogStage, EBAY_DE_CONSTANTS } from './types';

const INITIAL_SETTINGS: AppSettings = {
  ebay: {
    clientId: '',
    clientSecret: '',
    ruName: '',                          // RuName dla OAuth
    marketplace: EBAY_DE_CONSTANTS.MARKETPLACE_ID
  },
  policies: {
    paymentPolicyId: '',
    fulfillmentPolicyId: '',
    returnPolicyId: '',
    merchantLocationKey: ''
  },
  geminiKey: process.env.API_KEY || '',
  aiRules: {
    systemPrompt: 'You are a professional eBay listing specialist for German market (eBay.de). Write in German.',
    skuRules: 'Format: EB-[BRAND]-[MODEL]-[YEAR]',
    titleRules: 'Max 80 characters, include brand and EAN, German language.',
    descriptionRules: 'HTML based, clean lists, German language, professional tone.',
    forbiddenWords: 'cheap, best, free shipping, billig, gratis'
  },
  pricingRules: {
    undercutMode: 'lowest',
    undercutBy: 0.01,
    minGrossPrice: 1.00
  },
  vatRate: EBAY_DE_CONSTANTS.VAT_RATE    // 19% VAT dla DE
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('products');
  const [ebayConnected, setEbayConnected] = useState(false);
  
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('ebay_ai_products');
    return saved ? JSON.parse(saved) : [];
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('ebay_ai_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  });

  const [lastError, setLastError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>(() => {
    const saved = localStorage.getItem('ebay_ai_logs');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('ebay_ai_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('ebay_ai_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('ebay_ai_settings', JSON.stringify(settings));
  }, [settings]);

  const handleError = (msg: string) => {
    setLastError(msg);
    setTimeout(() => setLastError(null), 8000);
  };

  // Add log entry
  const addLog = useCallback((log: Omit<LogEntry, 'id' | 'timestamp'>) => {
    const newLog: LogEntry = {
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };
    setLogs(prev => [newLog, ...prev].slice(0, 500)); // Keep max 500 logs
  }, []);

  // Retry stage handler (will be passed to DebugTab and handled by ProductsTab)
  const handleRetryStage = useCallback((productId: string, stage: LogStage) => {
    // Update product status to allow retry
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p;
      
      // Reset to appropriate status based on stage
      let newStatus = p.status;
      switch (stage) {
        case LogStage.AI:
          newStatus = 'DRAFT' as any;
          break;
        case LogStage.CATEGORY:
          newStatus = 'AI_DONE' as any;
          break;
        case LogStage.PRICE_CHECK:
          newStatus = 'CATEGORY_DONE' as any;
          break;
        case LogStage.PRICE_SET:
          newStatus = 'PRICE_CHECK_DONE' as any;
          break;
        case LogStage.DRAFT:
          newStatus = 'PRICE_SET_DONE' as any;
          break;
        case LogStage.PUBLISH:
          newStatus = 'DRAFT_OK' as any;
          break;
      }
      
      return { ...p, status: newStatus, lastError: '' };
    }));
    
    // Switch to products tab
    setActiveTab('products');
  }, []);

  // Check eBay connection status via API (tokens in HTTP-only cookie)
  const checkEbayConnection = useCallback(async () => {
    try {
      const response = await fetch('/api/ebay/oauth/status', {
        credentials: 'include'
      });
      const data = await response.json();
      setEbayConnected(data.connected === true);
    } catch {
      setEbayConnected(false);
    }
  }, []);

  // Check connection on mount and when tab changes to settings
  useEffect(() => {
    checkEbayConnection();
  }, [checkEbayConnection]);

  // Re-check when returning to app (e.g., after OAuth popup)
  useEffect(() => {
    const handleFocus = () => checkEbayConnection();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkEbayConnection]);

  // Listen for OAuth success message from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'EBAY_OAUTH_SUCCESS') {
        checkEbayConnection();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkEbayConnection]);

  const ebayStatus = ebayConnected;
  const geminiStatus = settings.geminiKey.length > 20;

  const renderTab = () => {
    const aiContext = `${settings.aiRules.systemPrompt}\nSKU Rules: ${settings.aiRules.skuRules}\nTitle Rules: ${settings.aiRules.titleRules}\nDescription Rules: ${settings.aiRules.descriptionRules}\nForbidden Words: ${settings.aiRules.forbiddenWords}`;

    switch (activeTab) {
      case 'products':
        return <ProductsTab 
                  products={products} 
                  setProducts={setProducts} 
                  settings={settings}
                  ebayConnected={ebayStatus}
                  onError={handleError}
                  addLog={addLog}
                />;
      case 'pricing':
        return <PricingTab 
                  products={products} 
                  setProducts={setProducts} 
                  settings={settings}
                  setSettings={setSettings}
                  onError={handleError}
                />;
      case 'publication':
        return <PublicationTab 
                  products={products} 
                  setProducts={setProducts} 
                  settings={settings}
                  ebayStatus={ebayStatus} 
                  onError={handleError}
                  addLog={addLog}
                />;
      case 'debug':
        return <DebugTab 
                  products={products}
                  logs={logs}
                  onRetryStage={handleRetryStage}
                />;
      case 'settings':
        return <SettingsTab settings={settings} setSettings={setSettings} onEbayConnect={checkEbayConnection} />;
      default:
        return <ProductsTab products={products} setProducts={setProducts} settings={settings} ebayConnected={ebayStatus} onError={handleError} addLog={addLog} />;
    }
  };

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab}
      ebayStatus={ebayStatus}
      geminiStatus={geminiStatus}
      lastError={lastError}
    >
      {renderTab()}
    </Layout>
  );
};

export default App;
