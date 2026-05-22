import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';

if (typeof window !== 'undefined' && typeof window.localStorage?.clear !== 'function') {
  const storage = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => (storage.has(key) ? (storage.get(key) as string) : null),
    key: (i) => Array.from(storage.keys())[i] ?? null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

beforeEach(() => {
  window.localStorage?.clear?.();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  window.localStorage?.clear?.();
  document.documentElement.classList.remove('dark');
});
