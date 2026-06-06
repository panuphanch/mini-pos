import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { ItemRow } from '../../src/components/EditOrderDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../src/components/ui/dialog';
import type { EditableItem } from '../../src/lib/orderEdit';

// Renders the real ItemRow inside the REAL DialogContent (ui/dialog.tsx) so the
// e2e test guards the actual component's CSS — if the grid-item min-width fix is
// removed from dialog.tsx, this test fails. jsdom (the unit-test env) does no
// layout, so this browser fixture is the only faithful seam for the bug.
// See e2e/edit-order-itemrow.spec.ts.
const LONG =
  'ลอนดอนช็อคโกแลตคาราเมลเค้กพิเศษสูตรเข้มข้นโรยอัลมอนด์และคาราเมลซอสแบบจัดเต็มมาก';

function Harness() {
  const [items, setItems] = useState<EditableItem[]>([
    { productId: 'long', nameTh: LONG, quantity: 1, unitPrice: 165 },
    { productId: 'short', nameTh: 'พายคาราเมลโคตรถั่ว', quantity: 1, unitPrice: 145 },
  ]);
  return (
    <Dialog open>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit order fixture</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Items</div>
            <div
              data-testid="itemlist"
              className="rounded-md border border-border divide-y divide-border"
            >
              {items.map((it, i) => (
                <ItemRow
                  key={`${it.productId}-${i}`}
                  item={it}
                  onChange={(patch) =>
                    setItems((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, ...patch } : p)),
                    )
                  }
                  onRemove={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
