import { Minus, Plus, Trash2 } from 'lucide-react';
import type { CartItem } from '../lib/types';
import { Button } from './ui/button';

interface CartItemRowProps {
  item: CartItem;
  onUpdateQuantity: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}

export default function CartItemRow({ item, onUpdateQuantity, onRemove }: CartItemRowProps) {
  const lineTotal = item.product.sellingPrice * item.quantity;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-base font-medium leading-tight truncate">{item.product.nameTh}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          ฿{item.product.sellingPrice.toFixed(0)} each
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="iconSm"
          aria-label="Decrease quantity"
          onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-8 text-center text-base font-semibold tabular-nums">
          {item.quantity}
        </span>
        <Button
          variant="outline"
          size="iconSm"
          aria-label="Increase quantity"
          onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="w-20 text-right text-base font-semibold tabular-nums">
        ฿{lineTotal.toFixed(0)}
      </div>
      <Button
        variant="ghost"
        size="iconSm"
        aria-label="Remove item"
        onClick={() => onRemove(item.product.id)}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
