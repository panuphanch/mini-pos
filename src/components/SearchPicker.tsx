import { useEffect, useRef, useState } from 'react';

export interface SearchResult {
  id: string;
  primary: string;
  secondary?: string | null;
}

interface SearchPickerProps {
  placeholder?: string;
  search: (q: string) => Promise<SearchResult[]>;
  onPick: (item: SearchResult) => void;
  onCreate: () => void;
  selected?: SearchResult | null;
  createLabel?: string;
}

export default function SearchPicker({
  placeholder = 'Search…',
  search,
  onPick,
  onCreate,
  selected,
  createLabel = '+ Create new',
}: SearchPickerProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(async () => {
      if (q.trim().length === 0) { setResults([]); return; }
      setLoading(true);
      try {
        setResults(await search(q.trim()));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [q, open, search]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={selected ? selected.primary : q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto z-10">
            {loading && <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>}
            {!loading && results.length === 0 && q.trim().length > 0 && (
              <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => { onPick(r); setOpen(false); setQ(''); }}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                <div>{r.primary}</div>
                {r.secondary && <div className="text-xs text-gray-400">{r.secondary}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onCreate}
        className="px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg whitespace-nowrap"
      >
        {createLabel}
      </button>
    </div>
  );
}
