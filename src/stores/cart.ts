import { create } from 'zustand';
import type { Product, CartItem } from '../lib/types';

export type DiscountType = 'none' | 'percentage' | 'amount';

interface CartState {
  items: CartItem[];
  customerId: string | null;
  customerName: string;
  discountType: DiscountType;
  discountValue: number;
  deliveryFee: number;

  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, qty: number) => void;
  setCustomer: (id: string | null, name: string) => void;
  setDiscount: (type: DiscountType, value: number) => void;
  setDeliveryFee: (fee: number) => void;
  clear: () => void;

  getSubtotal: () => number;
  getDiscountAmount: () => number;
  getTotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: '',
  discountType: 'none',
  discountValue: 0,
  deliveryFee: 0,

  addItem: (product) =>
    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return { items: [...state.items, { product, quantity: 1 }] };
    }),

  removeItem: (productId) =>
    set((state) => ({
      items: state.items.filter((i) => i.product.id !== productId),
    })),

  updateQuantity: (productId, qty) =>
    set((state) => {
      if (qty <= 0) {
        return { items: state.items.filter((i) => i.product.id !== productId) };
      }
      return {
        items: state.items.map((i) =>
          i.product.id === productId ? { ...i, quantity: qty } : i
        ),
      };
    }),

  setCustomer: (id, name) => set({ customerId: id, customerName: name }),

  setDiscount: (type, value) => set({ discountType: type, discountValue: value }),

  setDeliveryFee: (fee) => set({ deliveryFee: fee }),

  clear: () =>
    set({
      items: [],
      customerId: null,
      customerName: '',
      discountType: 'none',
      discountValue: 0,
      deliveryFee: 0,
    }),

  getSubtotal: () => {
    const { items } = get();
    return items.reduce((sum, i) => sum + i.product.sellingPrice * i.quantity, 0);
  },

  getDiscountAmount: () => {
    const { discountType, discountValue } = get();
    const subtotal = get().getSubtotal();
    if (discountType === 'percentage') return (discountValue / 100) * subtotal;
    if (discountType === 'amount') return discountValue;
    return 0;
  },

  getTotal: () => {
    const subtotal = get().getSubtotal();
    const discount = get().getDiscountAmount();
    const { deliveryFee } = get();
    return Math.max(0, subtotal - discount + deliveryFee);
  },
}));
