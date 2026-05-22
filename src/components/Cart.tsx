import { ShoppingCart } from 'lucide-react';
import { useCartStore } from '../stores/cart';
import CartItemRow from './CartItemRow';
import CustomerSearch from './CustomerSearch';
import { Button } from './ui/button';
import { Separator } from './ui/separator';

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
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="p-4 border-b border-border">
        <CustomerSearch
          customerName={customerName}
          onSelect={(id, name) => setCustomer(id, name)}
          onClear={() => setCustomer(null, '')}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 scrollbar-thin">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <ShoppingCart className="h-10 w-10 opacity-40" />
            <p className="text-sm">Tap a product to add it to the cart</p>
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

      <div className="border-t border-border p-4 space-y-3 bg-card">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>
            Subtotal · {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
          <span className="tabular-nums">฿{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span className="tabular-nums">฿{total.toFixed(2)}</span>
        </div>
        <Separator />
        <div className="flex gap-2">
          {items.length > 0 && (
            <Button variant="secondary" size="lg" onClick={clear}>
              Clear
            </Button>
          )}
          <Button
            variant="success"
            size="lg"
            onClick={onCharge}
            disabled={items.length === 0}
            className="flex-1 text-xl font-bold tracking-tight"
          >
            Charge ฿{total.toFixed(0)}
          </Button>
        </div>
      </div>
    </div>
  );
}
