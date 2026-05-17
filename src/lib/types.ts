// === Config (mirror of Rust AppConfig with camelCase serde) ===

export type TabStrategy =
  | 'latest'
  | 'currentWeek'
  | { pinned: string };

export interface AppConfig {
  printerIp: string;
  paperWidth: number;
  spreadsheetId: string;
  serviceAccountPath: string;
  defaultTabStrategy: TabStrategy;
  shopName: string;
  shopPhone: string;
  shopLine: string;
  promptpayType: string;        // "phone" | "id_card"
  promptpayValue: string;
  thankYouMessage: string;
}

// === Catalog ===

export interface ProductLite {
  id: string;
  nameTh: string;
  nameEn: string | null;
  sellingPrice: number;
}

export interface CustomerLite {
  id: string;
  name: string;
  nickname: string | null;
}

// === Orders ===

export interface OrderListRow {
  id: string;
  orderNumber: string;
  customerName: string;
  channel: string | null;
  deliveryLocation: string | null;
  totalAmount: number;
  sourceTab: string | null;
  sourceRow: number | null;
  printedAt: string | null;
  printCount: number;
  deletedAt: string | null;
  orderDate: string;
  notes: string | null;
  itemsSummary: string;
  syncLocked: boolean;
}

export interface OrderDetailItem {
  productId: string;
  nameTh: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerName: string;
  channel: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  status: string;
  totalAmount: number;
  discount: number;
  deliveryFee: number;
  orderDate: string;
  sourceTab: string | null;
  sourceRow: number | null;
  printedAt: string | null;
  printCount: number;
  deletedAt: string | null;
  syncLocked: boolean;
  items: OrderDetailItem[];
}

export interface OrderEditItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderEditPayload {
  items: OrderEditItem[];
  discount: number;
  deliveryFee: number;
}

// === Sync ===

export interface UnknownMenu {
  alias: string;
  suggestedPrice: number;
}

export interface UnknownCustomer {
  alias: string;
}

export interface ParsedOrderItem {
  menuName: string;
  quantity: number;
}

export interface ParsedOrder {
  sourceRow: number;
  channel: string | null;
  customer: string;
  deliveryLocation: string | null;
  notes: string | null;
  items: ParsedOrderItem[];
}

export interface SyncPreview {
  tab: string;
  weekStartDate: string;
  unknownMenus: UnknownMenu[];
  unknownCustomers: UnknownCustomer[];
  parsedOrders: ParsedOrder[];
  willInsert: number;
  willUpdate: number;
  willSoftDelete: number;
  parseErrors: string[];
}

export type MenuMappingChoice =
  | { existing: { productId: string } }
  | { create: { nameTh: string; nameEn: string | null; sellingPrice: number } };

export type CustomerMappingChoice =
  | { existing: { customerId: string } }
  | { create: { name: string } };

export interface SyncMappings {
  menu: Array<[string, MenuMappingChoice]>;
  customer: Array<[string, CustomerMappingChoice]>;
}

export interface SyncResult {
  tab: string;
  rowsAdded: number;
  rowsUpdated: number;
  rowsSoftDeleted: number;
}

// === Receipt (existing) ===

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptData {
  customerName: string;
  items: ReceiptItem[];
  discountType: string;
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
  qrCodeType: string;
  qrCodeValue: string;
  thankYouMessage: string;
}

// === POSPage cart ===

export interface CartItem {
  product: ProductLite;
  quantity: number;
}
