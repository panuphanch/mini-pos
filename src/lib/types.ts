// === API Response Types (from grannys-ledger API) ===

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface Product {
  id: string;
  nameTh: string;
  nameEn: string | null;
  sellingPrice: number;
  category: string | null;
  isActive: boolean;
  imageUrl: string | null;
}

export interface Customer {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  totalSpent: number;
  orderCount: number;
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderCreateInput {
  customerId: string;
  platform: string;
  deliveryType: string;
  items: OrderItemInput[];
  discount?: number;
  deliveryFee?: number;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  orderDate: string;
  customer: { name: string };
}

// === Receipt Types (matching Rust structs with camelCase serde) ===

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptData {
  customerName: string;
  items: ReceiptItem[];
  discountType: string; // "none" | "percentage" | "fixed"
  discount: number;
  deliveryFee: number;
}

export interface PrinterConfig {
  ip: string;
  paperWidth: number;
  shopName: string;
  shopPhone: string;
  shopLine: string;
  qrText: string;
  qrCodeType: string; // "phone" | "id_card"
  qrCodeValue: string;
  thankYouMessage: string;
}

// === App Config (matching Rust AppConfig with camelCase serde) ===

export interface AppConfig {
  printerIp: string;
  paperWidth: number;
  apiUrl: string;
  serviceUsername: string;
  servicePassword: string;
}

// === Local Cart Types ===

export interface CartItem {
  product: Product;
  quantity: number;
}
