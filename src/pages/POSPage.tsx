import { useEffect, useState } from 'react';
import type { ProductLite, AppConfig } from '../lib/types';
import { catalog } from '../lib/tauri';
import { useCartStore } from '../stores/cart';
import ProductGrid from '../components/ProductGrid';
import Cart from '../components/Cart';
import PaymentDialog from '../components/PaymentDialog';

interface POSPageProps { appConfig: AppConfig | null; }

export default function POSPage({ appConfig }: POSPageProps) {
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  useEffect(() => {
    (async () => {
      try {
        setProducts(await catalog.searchProducts('', 500));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex h-full">
      <div className="w-[60%] h-full bg-gray-900">
        <ProductGrid products={products} onAddToCart={addItem} loading={loading} />
      </div>
      <div className="w-[40%] h-full border-l border-gray-700">
        <Cart onCharge={() => setShowPayment(true)} />
      </div>
      {showPayment && (
        <PaymentDialog onClose={() => setShowPayment(false)} appConfig={appConfig} />
      )}
    </div>
  );
}
