import type { ProductLite } from '../lib/types';
import { cn } from '../lib/cn';

interface ProductTileProps {
  product: ProductLite;
  onTap: (product: ProductLite) => void;
}

export default function ProductTile({ product, onTap }: ProductTileProps) {
  return (
    <button
      type="button"
      onClick={() => onTap(product)}
      className={cn(
        'group flex flex-col items-stretch justify-between rounded-xl border border-border bg-card text-card-foreground shadow-sm p-4 min-h-[120px] text-left',
        'transition-all hover:border-primary hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <span className="text-base font-medium leading-snug line-clamp-2">
        {product.nameTh}
      </span>
      <span className="mt-3 text-xl font-bold text-primary tabular-nums">
        ฿{product.sellingPrice.toFixed(0)}
      </span>
    </button>
  );
}
