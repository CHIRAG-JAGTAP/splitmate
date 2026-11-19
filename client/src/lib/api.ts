import axios, { AxiosError } from 'axios';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, headers: { 'X-Requested-With': 'SplitMate' } });

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = 'ERROR', public details?: { path: string; message: string }[]) { super(message); }
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');

let refreshing: Promise<void> | null = null;
let onAuthLost: () => void = () => undefined;
export const setAuthLostHandler = (fn: () => void) => { onAuthLost = fn; };

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<{ error?: { message: string; code: string; details?: any } }>) => {
    const cfg = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const body = error.response?.data?.error;
    const url = cfg?.url ?? '';
    if (error.response?.status === 401 && cfg && !cfg._retried && !url.startsWith('/auth/')) {
      cfg._retried = true;
      try {
        refreshing ??= api.post('/auth/refresh').then(() => undefined).finally(() => { refreshing = null; });
        await refreshing;
        return api(cfg);
      } catch { onAuthLost(); }
    }
    if (error.response?.status === 403 && body?.code === 'SUSPENDED') onAuthLost();
    if (!error.response) throw new ApiError('Cannot reach the server. Check that the API is running on port 4000.', 0, 'NETWORK');
    throw new ApiError(body?.message ?? 'Request failed', error.response.status, body?.code, body?.details);
  },
);

export const get = async <T,>(url: string, params?: object) => (await api.get<T>(url, { params })).data;
export const post = async <T,>(url: string, body?: object) => (await api.post<T>(url, body)).data;
export const patch = async <T,>(url: string, body?: object) => (await api.patch<T>(url, body)).data;
export const del = async <T,>(url: string) => (await api.delete<T>(url)).data;
export const upload = async <T,>(url: string, field: string, file: File) => {
  const f = new FormData(); f.append(field, file);
  return (await api.post<T>(url, f)).data;
};
