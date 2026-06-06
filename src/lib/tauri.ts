import { invoke } from '@tauri-apps/api/core';
import type {
  AppConfig,
  CustomerLite,
  MergeResult,
  OrderDetail,
  OrderEditPayload,
  OrderListRow,
  ProductLite,
  ReceiptData,
  PrinterConfig,
  SyncMappings,
  SyncPreview,
  SyncResult,
} from './types';

export const appConfig = {
  load: () => invoke<AppConfig>('load_config'),
  save: (config: AppConfig) => invoke<string>('save_config', { config }),
};

export const printer = {
  test: (ip: string) => invoke<string>('test_printer', { ip }),
  checkStatus: (ip: string) => invoke<boolean>('check_printer_status', { ip }),
  printReceipt: (receipt: ReceiptData, config: PrinterConfig) =>
    invoke<string>('print_receipt', { receipt, config }),
};

export const sheets = {
  testConnection: (config: AppConfig) =>
    invoke<{ name: string }[]>('test_sheets_connection', { config }),
  syncWeek: (config: AppConfig, tab: string) =>
    invoke<SyncPreview>('sync_week', { config, tab }),
  applySync: (config: AppConfig, tab: string, mappings: SyncMappings) =>
    invoke<SyncResult>('apply_sync', { config, tab, mappings }),
  ignoreMenu: (tab: string, alias: string, ignore = true) =>
    invoke<void>('ignore_sync_menu', { tab, alias, ignore }),
  ignoreRow: (tab: string, sourceRow: number, ignore = true) =>
    invoke<void>('ignore_sync_row', { tab, sourceRow, ignore }),
};

export const catalog = {
  searchProducts: (q: string, limit = 20) =>
    invoke<ProductLite[]>('search_products', { q, limit }),
  searchCustomers: (q: string, limit = 20) =>
    invoke<CustomerLite[]>('search_customers', { q, limit }),
};

export const ordersApi = {
  list: (opts: { tab?: string; includeDeleted?: boolean; limit?: number } = {}) =>
    invoke<OrderListRow[]>('list_orders', {
      tab: opts.tab ?? null,
      includeDeleted: opts.includeDeleted ?? false,
      limit: opts.limit ?? 200,
    }),
  get: (id: string) => invoke<OrderDetail | null>('get_order', { id }),
  print: (config: AppConfig, id: string) =>
    invoke<string>('print_order', { config, id }),
  update: (id: string, payload: OrderEditPayload) =>
    invoke<void>('update_order', { id, payload }),
  delete: (id: string) => invoke<void>('delete_order', { id }),
  merge: (orderIds: string[]) =>
    invoke<MergeResult>('merge_orders', { orderIds }),
};
