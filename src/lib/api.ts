import type {
  Product,
  Customer,
  Order,
  OrderCreateInput,
} from './types';

let accessToken: string | null = null;
let apiBaseUrl = 'http://localhost:3000/api';

export function setApiConfig(url: string) {
  apiBaseUrl = url.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}

async function authenticate(username: string, password: string) {
  const res = await fetch(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Authentication failed');
  accessToken = data.data.accessToken;
}

async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${apiBaseUrl}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    accessToken = null;
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data.data;
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const api = {
  authenticate,
  products: {
    getAll: () => apiFetch<Product[]>('/products?limit=500&isActive=true'),
    search: (q: string) => apiFetch<Product[]>(`/products/search?q=${encodeURIComponent(q)}`),
  },
  customers: {
    search: (q: string) => apiFetch<Customer[]>(`/customers/search?q=${encodeURIComponent(q)}`),
    create: (data: { name: string }) =>
      apiFetch<Customer>('/customers', { method: 'POST', body: JSON.stringify(data) }),
  },
  orders: {
    create: (data: OrderCreateInput) =>
      apiFetch<Order>('/orders', { method: 'POST', body: JSON.stringify(data) }),
    getRecent: () =>
      apiFetch<{ data: Order[] }>('/orders?limit=50&sort=orderDate:desc'),
  },
  settings: {
    getAll: () => apiFetch<Array<{ key: string; value: string }>>('/settings'),
  },
};
