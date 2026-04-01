import { useState } from 'react';
import type { Product, AppConfig } from '../lib/types';
import { useCartStore } from '../stores/cart';
import ProductGrid from '../components/ProductGrid';
import Cart from '../components/Cart';
import PaymentDialog from '../components/PaymentDialog';

interface POSPageProps {
  products: Product[];
  productsLoading: boolean;
  appConfig: AppConfig | null;
}

export default function POSPage({ products, productsLoading, appConfig }: POSPageProps) {
  const [showPayment, setShowPayment] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  return (
    <div className="flex h-full">
      {/* Product grid — left 60% */}
      <div className="w-[60%] h-full bg-gray-900">
        <ProductGrid
          products={products}
          onAddToCart={addItem}
          loading={productsLoading}
        />
      </div>

      {/* Cart — right 40% */}
      <div className="w-[40%] h-full border-l border-gray-700">
        <Cart onCharge={() => setShowPayment(true)} />
      </div>

      {/* Payment dialog */}
      {showPayment && (
        <PaymentDialog
          onClose={() => setShowPayment(false)}
          appConfig={appConfig}
        />
      )}
    </div>
  );
}
