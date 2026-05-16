import type { ProductLite } from '../lib/types';

interface ProductTileProps {
  product: ProductLite;
  onTap: (product: ProductLite) => void;
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
      <span className="mt-auto pt-2 text-green-400 font-bold text-base">
        ฿{product.sellingPrice.toFixed(0)}
      </span>
    </button>
  );
}
