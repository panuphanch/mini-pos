import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { ProductLite } from '../lib/types';
import ProductTile from './ProductTile';
import { Input } from './ui/input';

interface ProductGridProps {
  products: ProductLite[];
  onAddToCart: (product: ProductLite) => void;
  loading: boolean;
}

export default function ProductGrid({ products, onAddToCart, loading }: ProductGridProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.nameTh.toLowerCase().includes(q) ||
        (p.nameEn && p.nameEn.toLowerCase().includes(q)),
    );
  }, [products, search]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            inputSize="lg"
            className="pl-11"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading products…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {search ? 'No products found' : 'No products available'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filtered.map((product) => (
              <ProductTile key={product.id} product={product} onTap={onAddToCart} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
