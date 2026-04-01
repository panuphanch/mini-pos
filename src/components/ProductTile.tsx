import type { Product } from '../lib/types';

interface ProductTileProps {
  product: Product;
  onTap: (product: Product) => void;
}

export default function ProductTile({ product, onTap }: ProductTileProps) {
  return (
    <button
      onClick={() => onTap(product)}
      className="flex flex-col items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg p-3 min-h-[100px] min-w-[120px] transition-colors select-none"
    >
      <span className="text-white text-center font-medium text-sm leading-tight line-clamp-2">
        {product.nameTh}
      </span>
      {product.category && (
        <span className="mt-1 text-[10px] text-gray-400 bg-gray-800 rounded px-1.5 py-0.5 truncate max-w-full">
          {product.category}
        </span>
      )}
      <span className="mt-auto pt-2 text-green-400 font-bold text-base">
        ฿{product.sellingPrice.toFixed(0)}
      </span>
    </button>
  );
}
