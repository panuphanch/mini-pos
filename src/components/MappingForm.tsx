import { useState } from 'react';
import { catalog } from '../lib/tauri';
import type {
  CustomerMappingChoice,
  MenuMappingChoice,
  SyncMappings,
  SyncPreview,
} from '../lib/types';
import SearchPicker, { type SearchResult } from './SearchPicker';

interface MappingFormProps {
  preview: SyncPreview;
  onApply: (mappings: SyncMappings) => void;
  onCancel: () => void;
  applying: boolean;
}

type MenuRow = {
  alias: string;
  suggestedPrice: number;
  selected: SearchResult | null;
  draft: { nameTh: string; nameEn: string; sellingPrice: number } | null;
};

type CustomerRow = {
  alias: string;
  selected: SearchResult | null;
  draft: { name: string } | null;
};

export default function MappingForm({ preview, onApply, onCancel, applying }: MappingFormProps) {
  const [menuRows, setMenuRows] = useState<MenuRow[]>(
    preview.unknownMenus.map((m) => ({
      alias: m.alias, suggestedPrice: m.suggestedPrice, selected: null, draft: null,
    }))
  );
  const [customerRows, setCustomerRows] = useState<CustomerRow[]>(
    preview.unknownCustomers.map((c) => ({ alias: c.alias, selected: null, draft: null }))
  );

  const menuResolved = menuRows.every((r) => r.selected !== null || r.draft !== null);
  const customerResolved = customerRows.every((r) => r.selected !== null || r.draft !== null);
  const canApply = menuResolved && customerResolved;

  const buildMappings = (): SyncMappings => ({
    menu: menuRows.map((r): [string, MenuMappingChoice] => [
      r.alias,
      r.selected
        ? { existing: { productId: r.selected.id } }
        : { create: {
            nameTh: r.draft!.nameTh,
            nameEn: r.draft!.nameEn.trim() ? r.draft!.nameEn : null,
            sellingPrice: r.draft!.sellingPrice,
          } },
    ]),
    customer: customerRows.map((r): [string, CustomerMappingChoice] => [
      r.alias,
      r.selected
        ? { existing: { customerId: r.selected.id } }
        : { create: { name: r.draft!.name } },
    ]),
  });

  return (
    <div className="h-full p-6 space-y-6 overflow-y-auto">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">
          Resolve unknowns — {preview.tab}
        </h2>
        <span className="text-sm text-gray-400">
          +{preview.willInsert} new / ~{preview.willUpdate} updated / −{preview.willSoftDelete} removed
        </span>
      </header>

      {menuRows.length > 0 && (
        <section>
          <h3 className="text-white font-semibold mb-3">
            Unknown menu names ({menuRows.length})
          </h3>
          <div className="space-y-3">
            {menuRows.map((row, i) => (
              <MenuRowEditor key={row.alias} row={row} onChange={(updated) =>
                setMenuRows((rows) => rows.map((r, idx) => idx === i ? updated : r))} />
            ))}
          </div>
        </section>
      )}

      {customerRows.length > 0 && (
        <section>
          <h3 className="text-white font-semibold mb-3">
            Unknown customers ({customerRows.length})
          </h3>
          <div className="space-y-3">
            {customerRows.map((row, i) => (
              <CustomerRowEditor key={row.alias} row={row} onChange={(updated) =>
                setCustomerRows((rows) => rows.map((r, idx) => idx === i ? updated : r))} />
            ))}
          </div>
        </section>
      )}

      {preview.parseErrors.length > 0 && (
        <section className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3">
          <h4 className="text-yellow-300 font-semibold mb-1">Parse warnings</h4>
          <ul className="text-yellow-200 text-sm list-disc list-inside">
            {preview.parseErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
          Cancel
        </button>
        <button
          onClick={() => onApply(buildMappings())}
          disabled={!canApply || applying}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg"
        >
          {applying ? 'Applying…' : 'Apply mappings & sync'}
        </button>
      </div>
    </div>
  );
}

function MenuRowEditor({ row, onChange }: {
  row: MenuRow;
  onChange: (r: MenuRow) => void;
}) {
  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-white font-medium">{row.alias}</span>
          <span className="text-gray-400 text-sm ml-2">฿{row.suggestedPrice}</span>
        </div>
        {(row.selected || row.draft) && (
          <button onClick={() => onChange({ ...row, selected: null, draft: null })}
            className="text-xs text-gray-400 hover:text-white">Clear</button>
        )}
      </div>
      {!row.draft && (
        <SearchPicker
          placeholder="Map to existing product…"
          search={async (q) => {
            const items = await catalog.searchProducts(q);
            return items.map((p) => ({
              id: p.id, primary: p.nameTh, secondary: p.nameEn ?? null,
            }));
          }}
          onPick={(r) => onChange({ ...row, selected: r, draft: null })}
          onCreate={() => onChange({
            ...row, selected: null,
            draft: { nameTh: row.alias, nameEn: '', sellingPrice: row.suggestedPrice },
          })}
          selected={row.selected}
        />
      )}
      {row.draft && (
        <div className="grid grid-cols-3 gap-2">
          <input value={row.draft.nameTh}
            onChange={(e) => onChange({ ...row, draft: { ...row.draft!, nameTh: e.target.value } })}
            placeholder="Name (Thai)"
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
          <input value={row.draft.nameEn}
            onChange={(e) => onChange({ ...row, draft: { ...row.draft!, nameEn: e.target.value } })}
            placeholder="Name (English, optional)"
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
          <input type="number" value={row.draft.sellingPrice}
            onChange={(e) => onChange({ ...row,
              draft: { ...row.draft!, sellingPrice: parseInt(e.target.value || '0', 10) } })}
            placeholder="Price (THB)"
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
        </div>
      )}
    </div>
  );
}

function CustomerRowEditor({ row, onChange }: {
  row: CustomerRow;
  onChange: (r: CustomerRow) => void;
}) {
  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-white font-medium">{row.alias}</span>
        {(row.selected || row.draft) && (
          <button onClick={() => onChange({ ...row, selected: null, draft: null })}
            className="text-xs text-gray-400 hover:text-white">Clear</button>
        )}
      </div>
      {!row.draft && (
        <SearchPicker
          placeholder="Map to existing customer…"
          search={async (q) => {
            const items = await catalog.searchCustomers(q);
            return items.map((c) => ({
              id: c.id, primary: c.name, secondary: c.nickname ?? null,
            }));
          }}
          onPick={(r) => onChange({ ...row, selected: r, draft: null })}
          onCreate={() => onChange({ ...row, selected: null, draft: { name: row.alias } })}
          selected={row.selected}
        />
      )}
      {row.draft && (
        <input value={row.draft.name}
          onChange={(e) => onChange({ ...row, draft: { name: e.target.value } })}
          placeholder="Canonical name"
          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm" />
      )}
    </div>
  );
}
