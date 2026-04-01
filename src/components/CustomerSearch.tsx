import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import type { Customer } from '../lib/types';

interface CustomerSearchProps {
  customerName: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
}

export default function CustomerSearch({ customerName, onSelect, onClear }: CustomerSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [creating, setCreating] = useState(false);
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
        const customers = await api.customers.search(query);
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

  const handleSelect = (customer: Customer) => {
    onSelect(customer.id, customer.nickname || customer.name);
    setQuery('');
    setShowDropdown(false);
  };

  const handleQuickAdd = async () => {
    if (!query.trim()) return;
    setCreating(true);
    try {
      const customer = await api.customers.create({ name: query.trim() });
      onSelect(customer.id, customer.nickname || customer.name);
      setQuery('');
      setShowDropdown(false);
    } catch {
      // silently fail
    } finally {
      setCreating(false);
    }
  };

  if (customerName) {
    return (
      <div className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2">
        <span className="text-gray-400 text-sm">Customer:</span>
        <span className="text-white font-medium flex-1 truncate">{customerName}</span>
        <button
          onClick={onClear}
          className="text-gray-400 hover:text-red-400 text-sm"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search customer..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-gray-700 text-white placeholder-gray-400 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      />
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c)}
              className="w-full text-left px-3 py-2 hover:bg-gray-600 text-white text-sm border-b border-gray-600 last:border-0"
            >
              <span className="font-medium">{c.nickname || c.name}</span>
              {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}
            </button>
          ))}
          <button
            onClick={handleQuickAdd}
            disabled={creating}
            className="w-full text-left px-3 py-2 hover:bg-gray-600 text-blue-400 text-sm font-medium"
          >
            {creating ? 'Creating...' : `+ Add "${query.trim()}" as new customer`}
          </button>
        </div>
      )}
    </div>
  );
}
