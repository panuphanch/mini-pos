import { useState, type ReactNode } from 'react';
import { AlertTriangle, EyeOff, Undo2 } from 'lucide-react';
import { catalog, sheets } from '../lib/tauri';
import type {
  CustomerMappingChoice,
  MenuMappingChoice,
  ParsedOrder,
  SyncMappings,
  SyncPreview,
} from '../lib/types';
import { cn } from '../lib/cn';
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

type DriftRow = {
  alias: string;
  productId: string;
  productNameTh: string;
  productNameEn: string | null;
  currentPrice: number;
  sheetPrice: number;
  action: 'keep' | 'update' | 'remap' | null;
  remapSelected: SearchResult | null;
  remapDraft: { nameTh: string; nameEn: string; sellingPrice: number } | null;
};

const driftResolved = (r: DriftRow): boolean =>
  r.action === 'keep' ||
  r.action === 'update' ||
  (r.action === 'remap' && (r.remapSelected !== null || r.remapDraft !== null));

const driftChoice = (r: DriftRow): MenuMappingChoice => {
  if (r.action === 'update') {
    return { updatePrice: { productId: r.productId, sellingPrice: r.sheetPrice } };
  }
  if (r.action === 'remap' && r.remapSelected) {
    return { existing: { productId: r.remapSelected.id } };
  }
  if (r.action === 'remap' && r.remapDraft) {
    return {
      create: {
        nameTh: r.remapDraft.nameTh,
        nameEn: r.remapDraft.nameEn.trim() ? r.remapDraft.nameEn : null,
        sellingPrice: r.remapDraft.sellingPrice,
      },
    };
  }
  // 'keep' — alias stays bound to the same product.
  return { existing: { productId: r.productId } };
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
  const [driftRows, setDriftRows] = useState<DriftRow[]>(
    preview.driftedMenus.map((d) => ({
      alias: d.alias,
      productId: d.productId,
      productNameTh: d.productNameTh,
      productNameEn: d.productNameEn,
      currentPrice: d.currentPrice,
      sheetPrice: d.sheetPrice,
      action: null,
      remapSelected: null,
      remapDraft: null,
    })),
  );
  // Order rows the cashier has chosen to skip this sync (e.g. duplicates or
  // garbage trailing rows). Persisted server-side; removed from the visible list.
  const [ignoredRows, setIgnoredRows] = useState<ParsedOrder[]>([]);
  const [showOrders, setShowOrders] = useState(false);

  const activeOrders = preview.parsedOrders.filter(
    (o) => !ignoredRows.some((r) => r.sourceRow === o.sourceRow),
  );

  const menuResolved = menuRows.every((r) => r.selected !== null || r.draft !== null);
  const customerResolved = customerRows.every((r) => r.selected !== null || r.draft !== null);
  const driftsResolved = driftRows.every(driftResolved);
  const canApply = menuResolved && customerResolved && driftsResolved;

  const ignoreMenu = async (alias: string) => {
    await sheets.ignoreMenu(preview.tab, alias);
    setMenuRows((rows) => rows.filter((r) => r.alias !== alias));
  };

  const ignoreRow = async (order: ParsedOrder) => {
    await sheets.ignoreRow(preview.tab, order.sourceRow);
    const remaining = activeOrders.filter((o) => o.sourceRow !== order.sourceRow);
    setIgnoredRows((rows) => [...rows, order]);
    // Drop customer cards whose alias no longer appears in any surviving row,
    // so resolving them is no longer required to apply.
    const stillReferenced = new Set(remaining.map((o) => o.customer));
    setCustomerRows((rows) =>
      rows.filter((r) => stillReferenced.has(r.alias)),
    );
  };

  const restoreRow = async (order: ParsedOrder) => {
    await sheets.ignoreRow(preview.tab, order.sourceRow, false);
    setIgnoredRows((rows) => rows.filter((r) => r.sourceRow !== order.sourceRow));
    // Re-surface the customer if it became unknown again and isn't already shown.
    const known = preview.unknownCustomers.some((c) => c.alias === order.customer);
    setCustomerRows((rows) =>
      known && !rows.some((r) => r.alias === order.customer)
        ? [...rows, { alias: order.customer, selected: null, draft: null }]
        : rows,
    );
  };

  const buildMappings = (): SyncMappings => ({
    menu: [
      ...menuRows.map((r): [string, MenuMappingChoice] => [
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
      ...driftRows.map((r): [string, MenuMappingChoice] => [r.alias, driftChoice(r)]),
    ],
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

        {driftRows.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-warning-foreground">
              <AlertTriangle className="h-4 w-4" />
              <h3 className="font-semibold">Price changed since last sync ({driftRows.length})</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              These names already map to a product, but this week's sheet price differs.
              Confirm what each one should do before syncing.
            </p>
            <div className="space-y-3">
              {driftRows.map((row, i) => (
                <DriftRowEditor
                  key={row.alias}
                  row={row}
                  onChange={(updated) =>
                    setDriftRows((rows) => rows.map((r, idx) => (idx === i ? updated : r)))
                  }
                />
              ))}
            </div>
          </section>
        )}

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
                  onIgnore={() => ignoreMenu(row.alias)}
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

        {preview.parsedOrders.length > 0 && (
          <section className="space-y-3">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setShowOrders((s) => !s)}
            >
              Order rows in this sync ({activeOrders.length})
              {ignoredRows.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  · {ignoredRows.length} ignored
                </span>
              )}
              <span className="text-xs">{showOrders ? '▲' : '▼'}</span>
            </button>
            {showOrders && (
              <div className="space-y-1.5">
                {activeOrders.map((o) => (
                  <OrderRowLine
                    key={o.sourceRow}
                    order={o}
                    onIgnore={() => ignoreRow(o)}
                  />
                ))}
                {ignoredRows.map((o) => (
                  <OrderRowLine
                    key={o.sourceRow}
                    order={o}
                    ignored
                    onRestore={() => restoreRow(o)}
                  />
                ))}
              </div>
            )}
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

function MenuRowEditor({
  row,
  onChange,
  onIgnore,
}: {
  row: MenuRow;
  onChange: (r: MenuRow) => void;
  onIgnore: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-medium">{row.alias}</span>
            <span className="text-sm text-muted-foreground ml-2">฿{row.suggestedPrice}</span>
          </div>
          <div className="flex items-center gap-1">
            {(row.selected || row.draft) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...row, selected: null, draft: null })}
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={onIgnore}
              title="Skip this name — don't create a product or sync its quantities"
            >
              <EyeOff className="h-4 w-4" />
              Ignore
            </Button>
          </div>
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

function DriftRowEditor({
  row,
  onChange,
}: {
  row: DriftRow;
  onChange: (r: DriftRow) => void;
}) {
  const productLabel = row.productNameEn
    ? `${row.productNameTh} · ${row.productNameEn}`
    : row.productNameTh;
  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="pt-5 space-y-3">
        <div>
          <span className="font-medium">{row.alias}</span>
          <span className="text-sm text-muted-foreground ml-2">→ {productLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DriftAction
            active={row.action === 'keep'}
            onClick={() => onChange({ ...row, action: 'keep', remapSelected: null, remapDraft: null })}
          >
            Keep ฿{row.currentPrice}
          </DriftAction>
          <DriftAction
            active={row.action === 'update'}
            onClick={() => onChange({ ...row, action: 'update', remapSelected: null, remapDraft: null })}
          >
            Update → ฿{row.sheetPrice}
          </DriftAction>
          <DriftAction
            active={row.action === 'remap'}
            onClick={() => onChange({ ...row, action: 'remap' })}
          >
            Remap / new product
          </DriftAction>
        </div>
        {row.action === 'remap' && !row.remapDraft && (
          <SearchPicker
            placeholder="Map to a different product…"
            search={async (q) => {
              const items = await catalog.searchProducts(q);
              return items.map((p) => ({
                id: p.id,
                primary: p.nameTh,
                secondary: p.nameEn ?? null,
              }));
            }}
            onPick={(r) => onChange({ ...row, remapSelected: r, remapDraft: null })}
            onCreate={() =>
              onChange({
                ...row,
                remapSelected: null,
                remapDraft: { nameTh: row.alias, nameEn: '', sellingPrice: row.sheetPrice },
              })
            }
            selected={row.remapSelected}
          />
        )}
        {row.action === 'remap' && row.remapDraft && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Name (Thai)</Label>
              <Input
                value={row.remapDraft.nameTh}
                onChange={(e) =>
                  onChange({ ...row, remapDraft: { ...row.remapDraft!, nameTh: e.target.value } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Name (English)</Label>
              <Input
                value={row.remapDraft.nameEn}
                placeholder="optional"
                onChange={(e) =>
                  onChange({ ...row, remapDraft: { ...row.remapDraft!, nameEn: e.target.value } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Price (฿)</Label>
              <Input
                type="number"
                value={row.remapDraft.sellingPrice}
                onChange={(e) =>
                  onChange({
                    ...row,
                    remapDraft: {
                      ...row.remapDraft!,
                      sellingPrice: parseInt(e.target.value || '0', 10),
                    },
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

function DriftAction({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'secondary'}
      className={cn(!active && 'text-muted-foreground')}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function OrderRowLine({
  order,
  ignored = false,
  onIgnore,
  onRestore,
}: {
  order: ParsedOrder;
  ignored?: boolean;
  onIgnore?: () => void;
  onRestore?: () => void;
}) {
  const itemSummary = order.items.map((it) => `${it.menuName}×${it.quantity}`).join(', ');
  return (
    <div
      className={`flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm ${
        ignored ? 'opacity-50' : ''
      }`}
    >
      <span className="w-10 shrink-0 tabular-nums text-xs text-muted-foreground">
        #{order.sourceRow}
      </span>
      <div className="min-w-0 flex-1">
        <span className="font-medium">{order.customer || '(no name)'}</span>
        {itemSummary && (
          <span className="ml-2 text-muted-foreground">{itemSummary}</span>
        )}
      </div>
      {ignored ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onRestore}>
          <Undo2 className="h-4 w-4" />
          Restore
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onIgnore}>
          <EyeOff className="h-4 w-4" />
          Ignore
        </Button>
      )}
    </div>
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
