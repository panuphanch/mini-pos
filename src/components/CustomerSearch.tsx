import { useState, useEffect, useRef } from 'react';
import { User, X } from 'lucide-react';
import { catalog } from '../lib/tauri';
import type { CustomerLite } from '../lib/types';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface CustomerSearchProps {
  customerName: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
}

export default function CustomerSearch({ customerName, onSelect, onClear }: CustomerSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerLite[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const customers = await catalog.searchCustomers(query);
        setResults(customers);
        setShowDropdown(true);
      } catch {
        setResults([]);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (customer: CustomerLite) => {
    onSelect(customer.id, customer.nickname || customer.name);
    setQuery('');
    setShowDropdown(false);
  };

  if (customerName) {
    return (
      <div className="flex items-center gap-2 bg-accent text-accent-foreground rounded-md px-3 h-11">
        <User className="h-4 w-4 shrink-0" />
        <span className="text-xs uppercase tracking-wide opacity-70">Customer</span>
        <span className="font-medium flex-1 truncate">{customerName}</span>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Clear customer"
          onClick={onClear}
          className="text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="Search customer…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover text-popover-foreground border border-border rounded-md shadow-lg z-20 max-h-56 overflow-y-auto scrollbar-thin">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-muted-foreground">No customers found</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0"
              >
                <span className="font-medium">{c.nickname || c.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
