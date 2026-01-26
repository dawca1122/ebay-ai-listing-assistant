
import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import ProductsTab from './components/ProductsTab';
import PricingTab from './components/PricingTab';
import PublicationTab from './components/PublicationTab';
import SettingsTab from './components/SettingsTab';
import { Product, AppSettings, EBAY_DE_CONSTANTS } from './types';

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
  
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('ebay_ai_products');
    return saved ? JSON.parse(saved) : [];
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('ebay_ai_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  });

  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('ebay_ai_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('ebay_ai_settings', JSON.stringify(settings));
  }, [settings]);

  const handleError = (msg: string) => {
    setLastError(msg);
    setTimeout(() => setLastError(null), 8000);
  };

  // Check eBay connection from localStorage tokens
  const getEbayConnectionStatus = (): boolean => {
    const stored = localStorage.getItem('ebay_oauth_tokens');
    if (!stored) return false;
    try {
      const tokens = JSON.parse(stored);
      // Token valid if expires more than 5 min from now
      return tokens.expiresAt > Date.now() + (5 * 60 * 1000);
    } catch {
      return false;
    }
  };

  const ebayStatus = getEbayConnectionStatus();
  const geminiStatus = settings.geminiKey.length > 20;

  const renderTab = () => {
    const aiContext = `${settings.aiRules.systemPrompt}\nSKU Rules: ${settings.aiRules.skuRules}\nTitle Rules: ${settings.aiRules.titleRules}\nDescription Rules: ${settings.aiRules.descriptionRules}\nForbidden Words: ${settings.aiRules.forbiddenWords}`;

    switch (activeTab) {
      case 'products':
        return <ProductsTab 
                  products={products} 
                  setProducts={setProducts} 
                  settings={settings}
                  aiInstructions={aiContext}
                  onError={handleError}
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
                />;
      case 'settings':
        return <SettingsTab settings={settings} setSettings={setSettings} />;
      default:
        return <ProductsTab products={products} setProducts={setProducts} settings={settings} aiInstructions={aiContext} onError={handleError} />;
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
