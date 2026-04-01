import { useCartStore } from '../stores/cart';
import CartItemRow from './CartItemRow';
import CustomerSearch from './CustomerSearch';

interface CartProps {
  onCharge: () => void;
}

export default function Cart({ onCharge }: CartProps) {
  const items = useCartStore((s) => s.items);
  const customerName = useCartStore((s) => s.customerName);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);
  const getSubtotal = useCartStore((s) => s.getSubtotal);
  const getTotal = useCartStore((s) => s.getTotal);

  const subtotal = getSubtotal();
  const total = getTotal();

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {/* Customer search */}
      <div className="p-3 border-b border-gray-700">
        <CustomerSearch
          customerName={customerName}
          onSelect={(id, name) => setCustomer(id, name)}
          onClear={() => setCustomer(null, '')}
        />
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto px-3">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Tap a product to add to cart
          </div>
        ) : (
          items.map((item) => (
            <CartItemRow
              key={item.product.id}
              item={item}
              onUpdateQuantity={updateQuantity}
              onRemove={removeItem}
            />
          ))
        )}
      </div>

      {/* Totals and charge */}
      <div className="border-t border-gray-700 p-3 space-y-2">
        <div className="flex justify-between text-gray-400 text-sm">
          <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
          <span>฿{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-white text-lg font-bold">
          <span>Total</span>
          <span>฿{total.toFixed(2)}</span>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button
              onClick={clear}
              className="px-4 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium text-sm"
            >
              Clear
            </button>
          )}
          <button
            onClick={onCharge}
            disabled={items.length === 0}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 active:bg-green-400 disabled:bg-gray-600 disabled:text-gray-400 text-white rounded-lg font-bold text-lg transition-colors"
          >
            CHARGE ฿{total.toFixed(0)}
          </button>
        </div>
      </div>
    </div>
  );
}
