import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { catalog } from '../lib/tauri';
import type {
  CustomerMappingChoice,
  MenuMappingChoice,
  SyncMappings,
  SyncPreview,
} from '../lib/types';
import SearchPicker, { type SearchResult } from './SearchPicker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent } from './ui/card';

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
      alias: m.alias,
      suggestedPrice: m.suggestedPrice,
      selected: null,
      draft: null,
    })),
  );
  const [customerRows, setCustomerRows] = useState<CustomerRow[]>(
    preview.unknownCustomers.map((c) => ({ alias: c.alias, selected: null, draft: null })),
  );

  const menuResolved = menuRows.every((r) => r.selected !== null || r.draft !== null);
  const customerResolved = customerRows.every((r) => r.selected !== null || r.draft !== null);
  const canApply = menuResolved && customerResolved;

  const buildMappings = (): SyncMappings => ({
    menu: menuRows.map((r): [string, MenuMappingChoice] => [
      r.alias,
      r.selected
        ? { existing: { productId: r.selected.id } }
        : {
            create: {
              nameTh: r.draft!.nameTh,
              nameEn: r.draft!.nameEn.trim() ? r.draft!.nameEn : null,
              sellingPrice: r.draft!.sellingPrice,
            },
          },
    ]),
    customer: customerRows.map((r): [string, CustomerMappingChoice] => [
      r.alias,
      r.selected
        ? { existing: { customerId: r.selected.id } }
        : { create: { name: r.draft!.name } },
    ]),
  });

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-2xl font-bold tracking-tight">
            Resolve unknowns
            <span className="ml-2 text-base font-medium text-muted-foreground">
              {preview.tab}
            </span>
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            +{preview.willInsert} new · ~{preview.willUpdate} updated · −{preview.willSoftDelete} removed
          </span>
        </header>

        {menuRows.length > 0 && (
          <section className="space-y-3">
            <h3 className="font-semibold">Unknown menu names ({menuRows.length})</h3>
            <div className="space-y-3">
              {menuRows.map((row, i) => (
                <MenuRowEditor
                  key={row.alias}
                  row={row}
                  onChange={(updated) =>
                    setMenuRows((rows) => rows.map((r, idx) => (idx === i ? updated : r)))
                  }
                />
              ))}
            </div>
          </section>
        )}

        {customerRows.length > 0 && (
          <section className="space-y-3">
            <h3 className="font-semibold">Unknown customers ({customerRows.length})</h3>
            <div className="space-y-3">
              {customerRows.map((row, i) => (
                <CustomerRowEditor
                  key={row.alias}
                  row={row}
                  onChange={(updated) =>
                    setCustomerRows((rows) => rows.map((r, idx) => (idx === i ? updated : r)))
                  }
                />
              ))}
            </div>
          </section>
        )}

        {preview.parseErrors.length > 0 && (
          <Card className="border-warning/40 bg-warning/10">
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 mb-2 text-warning-foreground">
                <AlertTriangle className="h-4 w-4" />
                <h4 className="font-semibold">Parse warnings</h4>
              </div>
              <ul className="text-sm list-disc list-inside space-y-1">
                {preview.parseErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onApply(buildMappings())} disabled={!canApply || applying}>
            {applying ? 'Applying…' : 'Apply mappings & sync'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MenuRowEditor({ row, onChange }: { row: MenuRow; onChange: (r: MenuRow) => void }) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-medium">{row.alias}</span>
            <span className="text-sm text-muted-foreground ml-2">฿{row.suggestedPrice}</span>
          </div>
          {(row.selected || row.draft) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...row, selected: null, draft: null })}
            >
              Clear
            </Button>
          )}
        </div>
        {!row.draft && (
          <SearchPicker
            placeholder="Map to existing product…"
            search={async (q) => {
              const items = await catalog.searchProducts(q);
              return items.map((p) => ({
                id: p.id,
                primary: p.nameTh,
                secondary: p.nameEn ?? null,
              }));
            }}
            onPick={(r) => onChange({ ...row, selected: r, draft: null })}
            onCreate={() =>
              onChange({
                ...row,
                selected: null,
                draft: { nameTh: row.alias, nameEn: '', sellingPrice: row.suggestedPrice },
              })
            }
            selected={row.selected}
          />
        )}
        {row.draft && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Name (Thai)</Label>
              <Input
                value={row.draft.nameTh}
                onChange={(e) =>
                  onChange({ ...row, draft: { ...row.draft!, nameTh: e.target.value } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Name (English)</Label>
              <Input
                value={row.draft.nameEn}
                placeholder="optional"
                onChange={(e) =>
                  onChange({ ...row, draft: { ...row.draft!, nameEn: e.target.value } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Price (฿)</Label>
              <Input
                type="number"
                value={row.draft.sellingPrice}
                onChange={(e) =>
                  onChange({
                    ...row,
                    draft: { ...row.draft!, sellingPrice: parseInt(e.target.value || '0', 10) },
                  })
                }
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CustomerRowEditor({
  row,
  onChange,
}: {
  row: CustomerRow;
  onChange: (r: CustomerRow) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">{row.alias}</span>
          {(row.selected || row.draft) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...row, selected: null, draft: null })}
            >
              Clear
            </Button>
          )}
        </div>
        {!row.draft && (
          <SearchPicker
            placeholder="Map to existing customer…"
            search={async (q) => {
              const items = await catalog.searchCustomers(q);
              return items.map((c) => ({
                id: c.id,
                primary: c.name,
                secondary: c.nickname ?? null,
              }));
            }}
            onPick={(r) => onChange({ ...row, selected: r, draft: null })}
            onCreate={() => onChange({ ...row, selected: null, draft: { name: row.alias } })}
            selected={row.selected}
          />
        )}
        {row.draft && (
          <div className="space-y-1.5">
            <Label>Canonical name</Label>
            <Input
              value={row.draft.name}
              onChange={(e) => onChange({ ...row, draft: { name: e.target.value } })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
