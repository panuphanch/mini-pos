import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

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
  createLabel = 'Create new',
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
      if (q.trim().length === 0) {
        setResults([]);
        return;
      }
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
        <Input
          type="text"
          value={selected ? selected.primary : q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
        />
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-popover text-popover-foreground border border-border rounded-md shadow-lg max-h-64 overflow-y-auto z-20 scrollbar-thin">
            {loading && <div className="px-3 py-2.5 text-sm text-muted-foreground">Searching…</div>}
            {!loading && results.length === 0 && q.trim().length > 0 && (
              <div className="px-3 py-2.5 text-sm text-muted-foreground">No matches</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onPick(r);
                  setOpen(false);
                  setQ('');
                }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-b border-border last:border-0"
              >
                <div>{r.primary}</div>
                {r.secondary && <div className="text-xs text-muted-foreground">{r.secondary}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button variant="outline" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {createLabel}
      </Button>
    </div>
  );
}
