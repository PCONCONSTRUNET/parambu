import { broadcastAppChange, setOnRemoteChange } from './useLiveRefresh';

export class ApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MAX_GET_CACHE_ENTRIES = 80;
const getResponseCache = new Map<string, unknown>();
const inFlightGet = new Map<string, Promise<unknown>>();
const preloadedImages = new Set<string>();
let cacheGeneration = 0;

function normalizeCacheKey(path: string): string {
  return path.endsWith('?') ? path.slice(0, -1) : path;
}

export function clearApiCache() {
  cacheGeneration += 1;
  getResponseCache.clear();
  inFlightGet.clear();
}

function invalidateCachePrefixes(prefixes: string[]) {
  cacheGeneration += 1;
  for (const key of Array.from(getResponseCache.keys())) {
    if (prefixes.some((p) => key.startsWith(p))) {
      getResponseCache.delete(key);
    }
  }
  for (const key of Array.from(inFlightGet.keys())) {
    if (prefixes.some((p) => key.startsWith(p))) {
      inFlightGet.delete(key);
    }
  }
}

function invalidateCacheForMutation(path: string) {
  if (path.startsWith('/rentals')) {
    invalidateCachePrefixes(['/rentals', '/dashboard', '/finance']);
  } else if (path.startsWith('/sales') || path.startsWith('/debts')) {
    invalidateCachePrefixes(['/sales', '/debts', '/customers', '/products', '/dashboard', '/finance']);
  } else if (path.startsWith('/products')) {
    invalidateCachePrefixes(['/products', '/dashboard', '/finance']);
  } else if (path.startsWith('/customers')) {
    invalidateCachePrefixes(['/customers', '/sales', '/dashboard']);
  } else if (path.startsWith('/finance')) {
    invalidateCachePrefixes(['/finance', '/dashboard']);
  } else {
    clearApiCache();
  }
}

setOnRemoteChange(clearApiCache);

export function getCachedApi<T>(path: string): T | undefined {
  const key = normalizeCacheKey(path);
  return getResponseCache.get(key) as T | undefined;
}

export function prefetchApi<T>(path: string): Promise<T | undefined> {
  const key = normalizeCacheKey(path);
  const cached = getResponseCache.get(key);
  if (cached !== undefined) {
    return Promise.resolve(cached as T);
  }
  return api<T>(key).catch(() => undefined);
}

function setCachedApi(key: string, data: unknown) {
  if (getResponseCache.has(key)) {
    getResponseCache.delete(key);
  }
  getResponseCache.set(key, data);
  while (getResponseCache.size > MAX_GET_CACHE_ENTRIES) {
    const oldest = getResponseCache.keys().next().value;
    if (!oldest) break;
    getResponseCache.delete(oldest);
  }
}

export function preloadImageUrls(urls: Array<string | null | undefined>) {
  if (typeof Image === 'undefined') return;
  for (const url of urls) {
    if (!url || preloadedImages.has(url)) continue;
    preloadedImages.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError('Sem conexão com o sistema. Tente de novo.', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error || 'Algo deu errado. Tente de novo.', res.status);
  }
  return data as T;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const key = normalizeCacheKey(path);
  const canCacheGet =
    method === 'GET' && !key.startsWith('/auth/') && !key.startsWith('/backup/');

  if (canCacheGet) {
    const existing = inFlightGet.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const genAtStart = cacheGeneration;
    const promise = fetchJson<T>(key, init)
      .then((data) => {
        if (genAtStart === cacheGeneration) {
          setCachedApi(key, data);
        }
        return data;
      })
      .finally(() => {
        if (inFlightGet.get(key) === promise) {
          inFlightGet.delete(key);
        }
      });
    inFlightGet.set(key, promise);
    return promise;
  }

  const data = await fetchJson<T>(path, init);

  if (method !== 'GET') {
    if (!path.startsWith('/auth/')) {
      invalidateCacheForMutation(path);
      broadcastAppChange();
    } else if (path === '/auth/logout' || path === '/auth/login') {
      clearApiCache();
    }
  }

  return data;
}

export async function uploadPhoto(file: File): Promise<string> {
  const form = new FormData();
  form.append('photo', file);
  const res = await api<{ url: string }>('/uploads', {
    method: 'POST',
    body: form,
  });
  return res.url;
}
