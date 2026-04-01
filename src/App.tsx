import { useState, useEffect, useCallback } from 'react';
import type { Product, AppConfig } from './lib/types';
import { api, setApiConfig } from './lib/api';
import { appConfig as tauriConfig } from './lib/tauri';
import StatusBar from './components/StatusBar';
import POSPage from './pages/POSPage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'pos' | 'orders' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pos');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [initError, setInitError] = useState('');

  const initialize = useCallback(async () => {
    try {
      // Load config from Tauri
      const loadedConfig = await tauriConfig.load();
      setConfig(loadedConfig);

      // Configure API client
      if (loadedConfig.apiUrl) {
        setApiConfig(loadedConfig.apiUrl);
      }

      // Authenticate with service account
      if (loadedConfig.serviceUsername && loadedConfig.servicePassword) {
        await api.authenticate(loadedConfig.serviceUsername, loadedConfig.servicePassword);
      }

      // Fetch products
      setProductsLoading(true);
      try {
        const prods = await api.products.getAll();
        setProducts(prods);
      } catch (err) {
        console.error('Failed to load products:', err);
      } finally {
        setProductsLoading(false);
      }
    } catch (err) {
      console.error('Initialization error:', err);
      setInitError(err instanceof Error ? err.message : 'Failed to initialize');
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleConfigSaved = useCallback(
    async (newConfig: AppConfig) => {
      setConfig(newConfig);
      setApiConfig(newConfig.apiUrl);

      // Re-authenticate with new credentials
      try {
        await api.authenticate(newConfig.serviceUsername, newConfig.servicePassword);
        // Refresh products
        setProductsLoading(true);
        const prods = await api.products.getAll();
        setProducts(prods);
      } catch (err) {
        console.error('Re-auth failed:', err);
      } finally {
        setProductsLoading(false);
      }
    },
    []
  );

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      {/* Status bar */}
      <StatusBar printerIp={config?.printerIp || ''} />

      {/* Init error banner */}
      {initError && (
        <div className="bg-red-900/60 text-red-300 text-sm px-4 py-2 text-center">
          {initError} — check Settings to configure API connection
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos' && (
          <POSPage
            products={products}
            productsLoading={productsLoading}
            appConfig={config}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersPage appConfig={config} />
        )}
        {activeTab === 'settings' && (
          <SettingsPage
            appConfig={config}
            onConfigSaved={handleConfigSaved}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="flex border-t border-gray-700 bg-gray-800">
        <TabButton
          label="POS"
          active={activeTab === 'pos'}
          onClick={() => setActiveTab('pos')}
        />
        <TabButton
          label="Orders"
          active={activeTab === 'orders'}
          onClick={() => setActiveTab('orders')}
        />
        <TabButton
          label="Settings"
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        />
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
        active
          ? 'text-blue-400 border-t-2 border-blue-400 bg-gray-900'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

export default App;
