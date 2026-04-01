import type { CartItem } from '../lib/types';

interface CartItemRowProps {
  item: CartItem;
  onUpdateQuantity: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}

export default function CartItemRow({ item, onUpdateQuantity, onRemove }: CartItemRowProps) {
  const lineTotal = item.product.sellingPrice * item.quantity;

  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-700">
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-medium truncate">
          {item.product.nameTh}
        </div>
        <div className="text-gray-400 text-xs">
          ฿{item.product.sellingPrice.toFixed(0)} each
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
          className="w-8 h-8 flex items-center justify-center bg-gray-600 hover:bg-gray-500 active:bg-gray-400 rounded text-white text-lg font-bold"
        >
          -
        </button>
        <span className="w-8 text-center text-white font-medium">
          {item.quantity}
        </span>
        <button
          onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
          className="w-8 h-8 flex items-center justify-center bg-gray-600 hover:bg-gray-500 active:bg-gray-400 rounded text-white text-lg font-bold"
        >
          +
        </button>
      </div>
      <div className="w-16 text-right text-white font-medium text-sm">
        ฿{lineTotal.toFixed(0)}
      </div>
      <button
        onClick={() => onRemove(item.product.id)}
        className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-gray-600 rounded"
      >
        ✕
      </button>
    </div>
  );
}
