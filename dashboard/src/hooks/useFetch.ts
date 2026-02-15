/**
 * HUNGERNADS - useFetch Hook
 *
 * Generic data-fetching hook with loading/error/empty states.
 * Reads NEXT_PUBLIC_API_URL from environment for the base URL.
 *
 * Usage:
 *   const { data, loading, error } = useFetch<MyType>('/battles');
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFetch<T>(
  path: string,
  options?: {
    /** Skip fetching when true (useful for conditional fetches). */
    skip?: boolean;
    /** Polling interval in ms. 0 = no polling. */
    pollInterval?: number;
  },
): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options?.skip);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const hasFetchedRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (options?.skip) return;

    // Only show loading skeleton on first fetch, not on re-polls
    if (!hasFetchedRef.current) setLoading(true);
    setError(null);

    try {
      const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
      const res = await fetch(url);

      if (!mountedRef.current) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as T;
      if (mountedRef.current) {
        setData(json);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        hasFetchedRef.current = true;
        setLoading(false);
      }
    }
  }, [path, options?.skip]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    let interval: ReturnType<typeof setInterval> | null = null;
    if (options?.pollInterval && options.pollInterval > 0) {
      interval = setInterval(fetchData, options.pollInterval);
    }

    return () => {
      mountedRef.current = false;
      if (interval) clearInterval(interval);
    };
  }, [fetchData, options?.pollInterval]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Fetch multiple battle states in parallel.
 * Returns an array of full battle states from the ArenaDO.
 */
export async function fetchBattleStates(
  battleIds: string[],
): Promise<Record<string, unknown>[]> {
  const results = await Promise.allSettled(
    battleIds.map(async (id) => {
      const res = await fetch(`${API_BASE}/battle/${id}`);
      if (!res.ok) return null;
      return res.json();
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<Record<string, unknown>> =>
        r.status === 'fulfilled' && r.value != null,
    )
    .map((r) => r.value);
}

export default useFetch;
