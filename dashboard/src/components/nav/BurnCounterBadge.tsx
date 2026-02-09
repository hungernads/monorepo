/**
 * HUNGERNADS - Burn Counter Badge (Navbar Widget)
 *
 * Compact header widget showing total $HNADS burned via sponsorships.
 * Reads from BurnCounterContext and flashes when new burns arrive
 * via WebSocket events (pushed by battle pages).
 */

'use client';

import { Flame } from 'lucide-react';
import { useBurnCounter } from '@/contexts/BurnCounterContext';

function formatBurned(value: number): string {
  if (value === 0) return '0';
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export default function BurnCounterBadge() {
  const { totalBurned, loading, isFlashing } = useBurnCounter();

  // Don't render while loading initial data
  if (loading) {
    return (
      <div className="flex items-center gap-1">
        <div className="h-4 w-14 animate-pulse rounded bg-colosseum-surface-light" />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1 rounded-md px-2 py-1 transition-all duration-300 ${
        isFlashing
          ? 'animate-burn-flash bg-blood/20'
          : 'bg-transparent'
      }`}
      title={`${totalBurned.toLocaleString()} $HNADS burned from sponsorships`}
    >
      <Flame
        size={14}
        className={`flex-shrink-0 transition-all duration-300 ${
          isFlashing
            ? 'text-blood-light drop-shadow-[0_0_6px_rgba(220,38,38,0.6)]'
            : 'text-blood/70'
        }`}
      />
      <span
        className={`text-[11px] font-bold tabular-nums transition-colors duration-300 ${
          isFlashing ? 'text-blood-light' : 'text-gray-500'
        }`}
      >
        {formatBurned(totalBurned)}
      </span>
      <span className="hidden text-[9px] text-gray-600 sm:inline">
        burned
      </span>
    </div>
  );
}
