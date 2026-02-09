/**
 * HUNGERNADS - Burn Counter Context
 *
 * Global context for tracking total $HNADS burned via sponsorships.
 * Fetches initial value from /token/stats and provides an `addBurn()`
 * function that battle pages call when they receive sponsor_boost
 * WebSocket events, enabling real-time header updates.
 */

'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────

interface BurnCounterState {
  /** Total $HNADS burned across all sponsorships. */
  totalBurned: number;
  /** Total number of sponsorship transactions. */
  totalSponsorships: number;
  /** Whether the initial fetch is still loading. */
  loading: boolean;
  /** True for a brief period after a real-time burn increment. */
  isFlashing: boolean;
  /** Call from battle pages when a sponsor_boost WS event arrives. */
  addBurn: (amount: number) => void;
}

const BurnCounterContext = createContext<BurnCounterState>({
  totalBurned: 0,
  totalSponsorships: 0,
  loading: true,
  isFlashing: false,
  addBurn: () => {},
});

// ─── Provider ────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

interface TokenStatsResponse {
  burned: {
    totalAmount: number;
    totalSponsorships: number;
  };
  faucet: {
    totalDistributed: number;
    totalClaims: number;
  };
}

export function BurnCounterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [totalBurned, setTotalBurned] = useState(0);
  const [totalSponsorships, setTotalSponsorships] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isFlashing, setIsFlashing] = useState(false);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Fetch initial stats
  useEffect(() => {
    mountedRef.current = true;

    async function fetchStats() {
      try {
        const res = await fetch(`${API_BASE}/token/stats`);
        if (!res.ok) return;
        const data = (await res.json()) as TokenStatsResponse;
        if (mountedRef.current) {
          setTotalBurned(data.burned.totalAmount);
          setTotalSponsorships(data.burned.totalSponsorships);
        }
      } catch {
        // Silently fail - counter will show 0 until WS events arrive
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchStats();

    // Poll every 60s as a fallback for pages without WS connections
    const interval = setInterval(fetchStats, 60_000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  // Increment burn counter from WebSocket events
  const addBurn = useCallback((amount: number) => {
    setTotalBurned((prev) => prev + amount);
    setTotalSponsorships((prev) => prev + 1);

    // Trigger flash animation
    setIsFlashing(true);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setIsFlashing(false);
    }, 1200);
  }, []);

  return (
    <BurnCounterContext.Provider
      value={{ totalBurned, totalSponsorships, loading, isFlashing, addBurn }}
    >
      {children}
    </BurnCounterContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useBurnCounter(): BurnCounterState {
  return useContext(BurnCounterContext);
}
