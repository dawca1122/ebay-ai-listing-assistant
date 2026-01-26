
import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  ebayStatus: boolean;
  geminiStatus: boolean;
  lastError: string | null;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activeTab, 
  setActiveTab, 
  ebayStatus, 
  geminiStatus, 
  lastError 
}) => {
  const tabs = [
    { id: 'products', label: 'Produkty' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'publication', label: 'Publikacja' },
    { id: 'settings', label: 'Ustawienia' },
  ];

  return (
    <div className="flex flex-col h-screen text-slate-800">
      {/* Header / Tabs */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            e
          </div>
          <h1 className="text-xl font-bold tracking-tight">AI Listing Assistant</h1>
        </div>
        <nav className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between sticky bottom-0 z-10 text-xs">
        <div className="flex gap-6 items-center">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase tracking-wider font-semibold">Integracja eBay:</span>
            <span className={`px-2 py-0.5 rounded-full font-bold ${ebayStatus ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {ebayStatus ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase tracking-wider font-semibold">Integracja Gemini:</span>
            <span className={`px-2 py-0.5 rounded-full font-bold ${geminiStatus ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {geminiStatus ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
        <div className="flex-1 ml-10 truncate text-slate-400 italic">
          {lastError ? (
            <span className="text-red-500 font-medium">Błąd: {lastError}</span>
          ) : (
            'System gotowy do pracy.'
          )}
        </div>
        <div className="text-slate-400">
          v1.0.0-beta
        </div>
      </footer>
    </div>
  );
};

export default Layout;
