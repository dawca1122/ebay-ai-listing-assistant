
import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import ProductsTab from './components/ProductsTab';
import PricingTab from './components/PricingTab';
import PublicationTab from './components/PublicationTab';
import SettingsTab from './components/SettingsTab';
import { Product, AppSettings } from './types';

const INITIAL_SETTINGS: AppSettings = {
  ebay: {
    clientId: '', // Teraz w backendzie
    clientSecret: '', // Teraz w backendzie
    refreshToken: '', // Teraz w backendzie
    marketplace: 'EBAY_DE'
  },
  policies: {
    fulfillmentId: '',
    paymentId: '',
    returnId: '',
    locationPostalCode: '',
    merchantLocationKey: 'default' // Domyślny klucz lokalizacji
  },
  geminiKey: process.env.API_KEY || '',
  aiRules: {
    systemPrompt: 'You are a professional eBay listing specialist.',
    skuRules: 'Format: EB-[BRAND]-[MODEL]-[YEAR]',
    titleRules: 'Max 80 characters, include EAN at the end.',
    descriptionRules: 'HTML based, clean lists, German language.',
    forbiddenWords: 'cheap, best, free shipping'
  },
  pricingRules: {
    undercut: 0.01,
    priceFloor: 5.00,
    maxDeliveryDays: 5,
    ignoreOutliers: true
  }
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

  const ebayStatus = settings.ebay.refreshToken.length > 20;
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
