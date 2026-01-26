import React, { useState, useMemo } from 'react';
import { Product, LogEntry, LogStage } from '../types';

interface DebugTabProps {
  products: Product[];
  logs: LogEntry[];
  onRetryStage: (productId: string, stage: LogStage) => void;
}

const STAGE_LABELS: Record<LogStage, string> = {
  [LogStage.AI]: '🤖 AI Generate',
  [LogStage.CATEGORY]: '🏷️ Kategoria',
  [LogStage.PRICE_CHECK]: '💰 Sprawdź ceny',
  [LogStage.PRICE_SET]: '📊 Ustaw cenę',
  [LogStage.DRAFT]: '📝 Build DRAFT',
  [LogStage.PUBLISH]: '🚀 Publikacja'
};

const STAGE_HINTS: Record<string, string> = {
  // AI errors
  'QUOTA_EXCEEDED': 'Przekroczono limit API Gemini. Poczekaj lub zmień klucz.',
  'INVALID_API_KEY': 'Nieprawidłowy klucz API Gemini. Sprawdź w ustawieniach.',
  'EMPTY_RESPONSE': 'AI nie zwróciło odpowiedzi. Spróbuj ponownie.',
  
  // Category errors
  'NO_CATEGORY_MATCH': 'Nie znaleziono pasującej kategorii eBay. Wybierz ręcznie.',
  'INVALID_CATEGORY': 'Nieprawidłowa kategoria eBay. Sprawdź ID kategorii.',
  
  // Pricing errors
  'NO_LISTINGS_FOUND': 'Brak ofert konkurencji dla tego EAN.',
  'PRICE_TOO_LOW': 'Cena poniżej minimalnej. Sprawdź reguły pricing.',
  
  // Draft errors
  'MISSING_POLICY': 'Brak wybranej polityki. Ustaw w zakładce Ustawienia.',
  'MISSING_LOCATION': 'Brak lokalizacji magazynu. Ustaw w zakładce Ustawienia.',
  'MISSING_REQUIRED_FIELD': 'Brak wymaganego pola. Sprawdź dane produktu.',
  
  // Publish errors  
  'INVALID_SCOPE': 'Brak scope OAuth. Zaloguj się ponownie do eBay.',
  'TOKEN_EXPIRED': 'Token wygasł. Zaloguj się ponownie do eBay.',
  'OFFER_NOT_FOUND': 'Nie znaleziono oferty. Najpierw utwórz DRAFT.',
  'DUPLICATE_LISTING': 'Już istnieje aktywna oferta z tym SKU.',
  'CATEGORY_NOT_ENABLED': 'Kategoria nie jest włączona dla tego konta.',
};

const DebugTab: React.FC<DebugTabProps> = ({ products, logs, onRetryStage }) => {
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [retryStage, setRetryStage] = useState<LogStage>(LogStage.AI);

  // Filter logs
  const filteredLogs = useMemo(() => {
    let result = [...logs].sort((a, b) => b.timestamp - a.timestamp);
    
    if (selectedProductId !== 'all') {
      result = result.filter(log => log.productId === selectedProductId);
    }
    
    if (selectedStage !== 'all') {
      result = result.filter(log => log.stage === selectedStage);
    }
    
    if (showOnlyErrors) {
      result = result.filter(log => !log.success);
    }
    
    return result;
  }, [logs, selectedProductId, selectedStage, showOnlyErrors]);

  // Get selected product
  const selectedProduct = useMemo(() => {
    if (selectedProductId === 'all') return null;
    return products.find(p => p.id === selectedProductId) || null;
  }, [products, selectedProductId]);

  // Get last log for selected product
  const lastProductLog = useMemo(() => {
    if (!selectedProduct) return null;
    return logs
      .filter(l => l.productId === selectedProduct.id)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  }, [logs, selectedProduct]);

  // Statistics
  const stats = useMemo(() => {
    const total = logs.length;
    const errors = logs.filter(l => !l.success).length;
    const byStage: Record<string, { total: number; errors: number }> = {};
    
    Object.values(LogStage).forEach(stage => {
      const stageLogs = logs.filter(l => l.stage === stage);
      byStage[stage] = {
        total: stageLogs.length,
        errors: stageLogs.filter(l => !l.success).length
      };
    });
    
    return { total, errors, byStage };
  }, [logs]);

  // Copy error to clipboard
  const handleCopyError = async (log: LogEntry) => {
    const errorData = {
      timestamp: new Date(log.timestamp).toISOString(),
      stage: log.stage,
      action: log.action,
      sku: log.sku,
      ean: log.ean,
      ebayErrorId: log.ebayErrorId,
      ebayErrorMessage: log.ebayErrorMessage,
      hint: log.hint,
      requestUrl: log.requestUrl,
      responseStatus: log.responseStatus,
      responseBody: log.responseBody
    };
    
    await navigator.clipboard.writeText(JSON.stringify(errorData, null, 2));
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Get hint for error
  const getHintForError = (log: LogEntry): string => {
    if (log.hint) return log.hint;
    
    // Try to match known error patterns
    const errorText = `${log.ebayErrorId || ''} ${log.ebayErrorMessage || ''} ${JSON.stringify(log.responseBody || '')}`.toLowerCase();
    
    for (const [pattern, hint] of Object.entries(STAGE_HINTS)) {
      if (errorText.includes(pattern.toLowerCase())) {
        return hint;
      }
    }
    
    // Generic hints by stage
    switch (log.stage) {
      case LogStage.AI:
        return 'Sprawdź klucz API Gemini i połączenie internetowe.';
      case LogStage.CATEGORY:
        return 'Sprawdź czy EAN/nazwa produktu są poprawne.';
      case LogStage.PRICE_CHECK:
        return 'Może brak ofert dla tego produktu na eBay.';
      case LogStage.PRICE_SET:
        return 'Sprawdź reguły pricing w ustawieniach.';
      case LogStage.DRAFT:
        return 'Sprawdź czy wszystkie polityki są ustawione.';
      case LogStage.PUBLISH:
        return 'Sprawdź autoryzację eBay i dane oferty.';
      default:
        return 'Sprawdź szczegóły błędu poniżej.';
    }
  };

  // Format JSON for display
  const formatJson = (data: any): string => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  // Format timestamp
  const formatTime = (ts: number): string => {
    return new Date(ts).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">🔍 Debug / Logi</h2>
          <p className="text-slate-500 mt-1">Podgląd akcji, błędów i payloadów</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="bg-slate-100 px-3 py-2 rounded-lg">
            <span className="text-slate-500">Wszystkie akcje:</span>
            <span className="ml-2 font-bold text-slate-700">{stats.total}</span>
          </div>
          <div className="bg-red-50 px-3 py-2 rounded-lg">
            <span className="text-red-500">Błędy:</span>
            <span className="ml-2 font-bold text-red-600">{stats.errors}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Product filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Produkt:</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Wszystkie produkty</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.sku || p.ean} - {p.inputName.substring(0, 30)}...
                </option>
              ))}
            </select>
          </div>

          {/* Stage filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Etap:</label>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Wszystkie etapy</option>
              {Object.entries(STAGE_LABELS).map(([stage, label]) => (
                <option key={stage} value={stage}>{label}</option>
              ))}
            </select>
          </div>

          {/* Errors only toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyErrors}
              onChange={(e) => setShowOnlyErrors(e.target.checked)}
              className="w-4 h-4 text-red-600 rounded focus:ring-red-500"
            />
            <span className="text-sm font-medium text-red-600">Tylko błędy</span>
          </label>

          {/* Stats by stage */}
          <div className="ml-auto flex items-center gap-2">
            {Object.entries(stats.byStage).map(([stage, s]: [string, { total: number; errors: number }]) => (
              s.total > 0 && (
                <div
                  key={stage}
                  className={`text-xs px-2 py-1 rounded ${
                    s.errors > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}
                >
                  {STAGE_LABELS[stage as LogStage]?.split(' ')[0]} {s.total}/{s.errors}
                </div>
              )
            ))}
          </div>
        </div>
      </div>

      {/* Selected Product Details */}
      {selectedProduct && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-blue-800">
                📦 {selectedProduct.sku || selectedProduct.ean}
              </h3>
              <p className="text-sm text-blue-600 mt-1">{selectedProduct.inputName}</p>
              <div className="flex gap-4 mt-2 text-xs text-blue-500">
                <span>EAN: {selectedProduct.ean}</span>
                <span>Status: {selectedProduct.status}</span>
                {selectedProduct.ebayCategoryName && (
                  <span>Kategoria: {selectedProduct.ebayCategoryName}</span>
                )}
              </div>
            </div>
            
            {/* Retry controls */}
            <div className="flex items-center gap-2">
              <select
                value={retryStage}
                onChange={(e) => setRetryStage(e.target.value as LogStage)}
                className="border border-blue-300 rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                {Object.entries(STAGE_LABELS).map(([stage, label]) => (
                  <option key={stage} value={stage}>{label}</option>
                ))}
              </select>
              <button
                onClick={() => onRetryStage(selectedProduct.id, retryStage)}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                🔄 Retry
              </button>
            </div>
          </div>

          {/* Last action info */}
          {lastProductLog && (
            <div className={`mt-4 p-3 rounded-lg ${lastProductLog.success ? 'bg-green-100' : 'bg-red-100'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${lastProductLog.success ? 'text-green-700' : 'text-red-700'}`}>
                  Ostatnia akcja: {lastProductLog.action} ({formatTime(lastProductLog.timestamp)})
                </span>
                {!lastProductLog.success && (
                  <span className="text-xs text-red-600 bg-red-200 px-2 py-0.5 rounded">
                    {lastProductLog.ebayErrorId || 'ERROR'}
                  </span>
                )}
              </div>
              {!lastProductLog.success && (
                <p className="text-sm text-red-600 mt-1">
                  💡 {getHintForError(lastProductLog)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payload Sections for Selected Product */}
      {selectedProduct && lastProductLog && (
        <div className="grid grid-cols-2 gap-4">
          {/* Last Request/Response */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h4 className="font-semibold text-slate-700 mb-3">📡 Last Request/Response</h4>
            <div className="space-y-2 text-xs">
              <div className="flex gap-2">
                <span className="text-slate-500 w-20">Method:</span>
                <span className="font-mono">{lastProductLog.requestMethod || 'N/A'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-500 w-20">URL:</span>
                <span className="font-mono text-blue-600 break-all">{lastProductLog.requestUrl || 'N/A'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-500 w-20">Status:</span>
                <span className={`font-mono ${lastProductLog.responseStatus && lastProductLog.responseStatus < 400 ? 'text-green-600' : 'text-red-600'}`}>
                  {lastProductLog.responseStatus || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Inventory Payload */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h4 className="font-semibold text-slate-700 mb-3">📦 Payload inventory_item</h4>
            <pre className="text-xs bg-slate-50 p-2 rounded-lg overflow-auto max-h-40 font-mono">
              {lastProductLog.inventoryPayload ? formatJson(lastProductLog.inventoryPayload) : 'Brak danych'}
            </pre>
          </div>

          {/* Offer Payload */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h4 className="font-semibold text-slate-700 mb-3">🏷️ Payload offer</h4>
            <pre className="text-xs bg-slate-50 p-2 rounded-lg overflow-auto max-h-40 font-mono">
              {lastProductLog.offerPayload ? formatJson(lastProductLog.offerPayload) : 'Brak danych'}
            </pre>
          </div>

          {/* Publish Response */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h4 className="font-semibold text-slate-700 mb-3">🚀 Publish Response</h4>
            <pre className="text-xs bg-slate-50 p-2 rounded-lg overflow-auto max-h-40 font-mono">
              {lastProductLog.publishResponse ? formatJson(lastProductLog.publishResponse) : 'Brak danych'}
            </pre>
          </div>
        </div>
      )}

      {/* Logs List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="font-semibold text-slate-700">
            📜 Historia akcji ({filteredLogs.length})
          </h3>
        </div>
        
        <div className="divide-y divide-slate-100 max-h-[500px] overflow-auto">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <div className="text-4xl mb-2">📭</div>
              <p>Brak logów do wyświetlenia</p>
            </div>
          ) : (
            filteredLogs.map(log => (
              <div
                key={log.id}
                className={`p-4 hover:bg-slate-50 transition-colors ${
                  expandedLogId === log.id ? 'bg-slate-50' : ''
                }`}
              >
                {/* Log Header */}
                <div
                  className="flex items-center gap-4 cursor-pointer"
                  onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                >
                  {/* Status indicator */}
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    log.success ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  
                  {/* Timestamp */}
                  <span className="text-xs text-slate-400 font-mono w-28 flex-shrink-0">
                    {formatTime(log.timestamp)}
                  </span>
                  
                  {/* Stage badge */}
                  <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${
                    log.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {STAGE_LABELS[log.stage]?.split(' ')[0] || log.stage}
                  </span>
                  
                  {/* SKU/EAN */}
                  <span className="text-sm font-mono text-slate-600 w-32 truncate flex-shrink-0">
                    {log.sku || log.ean}
                  </span>
                  
                  {/* Action */}
                  <span className="text-sm text-slate-700 flex-1 truncate">
                    {log.action}
                  </span>
                  
                  {/* Error message preview */}
                  {!log.success && log.ebayErrorMessage && (
                    <span className="text-xs text-red-500 truncate max-w-xs">
                      {log.ebayErrorMessage}
                    </span>
                  )}
                  
                  {/* Expand icon */}
                  <span className="text-slate-400 flex-shrink-0">
                    {expandedLogId === log.id ? '▼' : '▶'}
                  </span>
                </div>
                
                {/* Expanded Details */}
                {expandedLogId === log.id && (
                  <div className="mt-4 pl-7 space-y-4">
                    {/* Error Details */}
                    {!log.success && (
                      <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm font-medium text-red-700">
                              {log.ebayErrorId && (
                                <span className="bg-red-200 px-2 py-0.5 rounded mr-2">
                                  {log.ebayErrorId}
                                </span>
                              )}
                              {log.ebayErrorMessage || 'Nieznany błąd'}
                            </div>
                            <div className="text-sm text-red-600 mt-2">
                              💡 <strong>Hint:</strong> {getHintForError(log)}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyError(log);
                            }}
                            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                              copiedId === log.id
                                ? 'bg-green-500 text-white'
                                : 'bg-red-200 text-red-700 hover:bg-red-300'
                            }`}
                          >
                            {copiedId === log.id ? '✓ Skopiowano' : '📋 Kopiuj błąd'}
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {/* Request/Response Details */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Request */}
                      {log.requestPayload && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <div className="text-xs font-medium text-slate-500 mb-2">
                            Request ({log.requestMethod} {log.requestUrl})
                          </div>
                          <pre className="text-xs font-mono overflow-auto max-h-32">
                            {formatJson(log.requestPayload)}
                          </pre>
                        </div>
                      )}
                      
                      {/* Response */}
                      {log.responseBody && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <div className="text-xs font-medium text-slate-500 mb-2">
                            Response (Status: {log.responseStatus})
                          </div>
                          <pre className="text-xs font-mono overflow-auto max-h-32">
                            {formatJson(log.responseBody)}
                          </pre>
                        </div>
                      )}
                    </div>
                    
                    {/* Payloads */}
                    {(log.inventoryPayload || log.offerPayload || log.publishResponse) && (
                      <div className="flex gap-2">
                        {log.inventoryPayload && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(formatJson(log.inventoryPayload));
                            }}
                            className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            📦 Inventory Payload
                          </button>
                        )}
                        {log.offerPayload && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(formatJson(log.offerPayload));
                            }}
                            className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                          >
                            🏷️ Offer Payload
                          </button>
                        )}
                        {log.publishResponse && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(formatJson(log.publishResponse));
                            }}
                            className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                          >
                            🚀 Publish Response
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick Stats by Stage */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-700 mb-4">📊 Statystyki per etap</h3>
        <div className="grid grid-cols-6 gap-4">
          {Object.entries(STAGE_LABELS).map(([stage, label]) => {
            const stageStats = stats.byStage[stage] || { total: 0, errors: 0 };
            const successRate = stageStats.total > 0 
              ? Math.round(((stageStats.total - stageStats.errors) / stageStats.total) * 100) 
              : 100;
            
            return (
              <div 
                key={stage}
                className={`p-3 rounded-lg text-center ${
                  stageStats.errors > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'
                }`}
              >
                <div className="text-lg mb-1">{label.split(' ')[0]}</div>
                <div className="text-xs text-slate-500 mb-2">{label.split(' ').slice(1).join(' ')}</div>
                <div className="text-2xl font-bold mb-1">
                  <span className={stageStats.errors > 0 ? 'text-red-600' : 'text-green-600'}>
                    {successRate}%
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  {stageStats.total - stageStats.errors}/{stageStats.total} OK
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default DebugTab;
