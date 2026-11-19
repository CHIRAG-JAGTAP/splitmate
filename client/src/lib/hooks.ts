import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg, get } from './api';

/** Tiny data-fetching hook: loading / error / data + reload. */
export function useFetch<T>(url: string | null, params?: object, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(params ?? {});
  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try { const d = await get<T>(url, params); if (my === seq.current) { setData(d); setError(null); } }
    catch (e) { if (my === seq.current) setError(errMsg(e)); }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key]);
  useEffect(() => { void load(); }, [load, ...deps]);
  return { data, loading, error, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
