import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditOrderDialog from './EditOrderDialog';
import type { OrderDetail } from '../lib/types';

const updateMock = vi.fn();
const searchProductsMock = vi.fn();
const toastMock = vi.fn();

vi.mock('../lib/tauri', () => ({
  ordersApi: {
    update: (...args: unknown[]) => updateMock(...args),
  },
  catalog: {
    searchProducts: (...args: unknown[]) => searchProductsMock(...args),
  },
}));

vi.mock('../lib/toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const baseDetail: OrderDetail = {
  id: 'order-1',
  orderNumber: 'A-001',
  customerName: 'Alice',
  channel: null,
  deliveryLocation: null,
  notes: null,
  status: 'pending',
  totalAmount: 250,
  discount: 0,
  deliveryFee: 0,
  orderDate: '2026-05-17',
  sourceTab: null,
  sourceRow: null,
  printedAt: null,
  printCount: 0,
  deletedAt: null,
  syncLocked: false,
  items: [
    { productId: 'p1', nameTh: 'ก๋วยเตี๋ยว', quantity: 2, unitPrice: 100 },
    { productId: 'p2', nameTh: 'ชาเย็น', quantity: 1, unitPrice: 50 },
  ],
};

const detailWithFreeItem: OrderDetail = {
  ...baseDetail,
  items: [{ productId: 'p1', nameTh: 'ของแถม', quantity: 1, unitPrice: 0 }],
};

const findQtyInputs = () =>
  screen
    .getAllByRole('spinbutton')
    .filter((el) => (el as HTMLInputElement).className.includes('text-center'));

describe('EditOrderDialog', () => {
  beforeEach(() => {
    updateMock.mockResolvedValue(undefined);
    searchProductsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    updateMock.mockReset();
    searchProductsMock.mockReset();
    toastMock.mockReset();
  });

  it('blocks save and shows error when every row has zero quantity', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(<EditOrderDialog detail={baseDetail} onClose={onClose} onSaved={onSaved} />);

    const qtyInputs = findQtyInputs();
    expect(qtyInputs).toHaveLength(2);
    for (const input of qtyInputs) {
      await user.clear(input);
      await user.type(input, '0');
    }

    await user.click(screen.getByRole('button', { name: /save & lock from sync/i }));

    expect(await screen.findByText('Order must have at least one item')).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks save when an active row has a zero unit price', async () => {
    const user = userEvent.setup();
    render(<EditOrderDialog detail={detailWithFreeItem} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /save & lock from sync/i }));

    expect(
      await screen.findByText(/items need a price greater than ฿0/i),
    ).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('saves a stripped payload on the happy path', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(<EditOrderDialog detail={baseDetail} onClose={onClose} onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: /save & lock from sync/i }));

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('order-1', {
      items: [
        { productId: 'p1', quantity: 2, unitPrice: 100 },
        { productId: 'p2', quantity: 1, unitPrice: 50 },
      ],
      discount: 0,
      deliveryFee: 0,
    });

    // wait for the async save handler to settle
    await screen.findByRole('button', { name: /save & lock from sync/i });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops zero-quantity rows from the payload', async () => {
    const user = userEvent.setup();
    render(<EditOrderDialog detail={baseDetail} onClose={vi.fn()} onSaved={vi.fn()} />);

    const qtyInputs = findQtyInputs();
    await user.clear(qtyInputs[1]);
    await user.type(qtyInputs[1], '0');

    await user.click(screen.getByRole('button', { name: /save & lock from sync/i }));

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, payload] = updateMock.mock.calls[0];
    expect(payload.items).toEqual([{ productId: 'p1', quantity: 2, unitPrice: 100 }]);
  });
});
