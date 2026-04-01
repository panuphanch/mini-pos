import { invoke } from '@tauri-apps/api/core';
import type { ReceiptData, PrinterConfig, AppConfig } from './types';

export const printer = {
  printReceipt: (receipt: ReceiptData, config: PrinterConfig) =>
    invoke<string>('print_receipt', { receipt, config }),
  testPrint: (ip: string) =>
    invoke<string>('test_printer', { ip }),
  checkStatus: (ip: string) =>
    invoke<boolean>('check_printer_status', { ip }),
};

export const appConfig = {
  load: () => invoke<AppConfig>('load_config'),
  save: (config: AppConfig) => invoke<string>('save_config', { config }),
};
