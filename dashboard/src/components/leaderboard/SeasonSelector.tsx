'use client';

import { useFetch } from '@/hooks/useFetch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeasonSummary {
  id: string;
  seasonNumber: number;
  status: 'active' | 'ended' | 'burned';
  startedAt: string;
  endedAt: string | null;
  battleCount: number;
  schadenfreudePool: number;
  battlesRemaining: number;
  totalDistributed: number;
  totalBurned: number;
  claimDeadline: string | null;
  bettingStats?: {
    totalBets: number;
    totalWagered: number;
    totalPayout: number;
    uniqueBettors: number;
  };
}

interface SeasonsListResponse {
  seasons: SeasonSummary[];
  count: number;
}

interface SeasonSelectorProps {
  /** Currently selected season ID (null = "All Time"). */
  selectedSeasonId: string | null;
  /** Called when the user picks a different season. null = all-time. */
  onSeasonChange: (seasonId: string | null, summary: SeasonSummary | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'active':
      return { label: 'LIVE', cls: 'bg-green-500/20 text-green-400 border-green-500/40' };
    case 'ended':
      return { label: 'ENDED', cls: 'bg-gold/15 text-gold border-gold/40' };
    case 'burned':
      return { label: 'BURNED', cls: 'bg-blood/15 text-blood border-blood/40' };
    default:
      return { label: status.toUpperCase(), cls: 'bg-gray-500/15 text-gray-400 border-gray-500/40' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SeasonSelector({
  selectedSeasonId,
  onSeasonChange,
}: SeasonSelectorProps) {
  const {
    data: seasonsData,
    loading,
  } = useFetch<SeasonsListResponse>('/seasons?limit=20');

  const seasons = seasonsData?.seasons ?? [];

  if (loading) {
    return (
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <div className="h-8 w-20 animate-pulse rounded-lg bg-colosseum-surface-light" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-colosseum-surface-light" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-colosseum-surface-light" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Season pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {/* All Time option */}
        <button
          onClick={() => onSeasonChange(null, null)}
          className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all sm:py-1.5 ${
            selectedSeasonId === null
              ? 'border-gold bg-gold/20 text-gold'
              : 'border-colosseum-surface-light text-gray-500 hover:border-gold/20 hover:text-gray-300'
          }`}
        >
          All Time
        </button>

        {seasons.map((season) => {
          const badge = statusBadge(season.status);
          const isSelected = selectedSeasonId === season.id;

          return (
            <button
              key={season.id}
              onClick={() => onSeasonChange(season.id, season)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all sm:py-1.5 ${
                isSelected
                  ? 'border-gold bg-gold/20 text-gold'
                  : 'border-colosseum-surface-light text-gray-500 hover:border-gold/20 hover:text-gray-300'
              }`}
            >
              <span>S{season.seasonNumber}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[9px] leading-none ${badge.cls}`}
              >
                {badge.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Season info banner (only when a season is selected) */}
      {selectedSeasonId && (() => {
        const season = seasons.find((s) => s.id === selectedSeasonId);
        if (!season) return null;
        const badge = statusBadge(season.status);

        return (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-colosseum-surface-light bg-colosseum-surface/50 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-cinzel text-sm font-bold text-gold">
                  Season {season.seasonNumber}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>
              <div className="mt-0.5 text-[10px] text-gray-600">
                {formatDate(season.startedAt)}
                {season.endedAt ? ` - ${formatDate(season.endedAt)}` : ' - Present'}
              </div>
            </div>

            <div className="text-center">
              <div className="text-sm font-bold text-gray-200">
                {season.battleCount}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-gray-600">
                Battles
              </div>
            </div>

            {season.status === 'active' && (
              <div className="text-center">
                <div className="text-sm font-bold text-green-400">
                  {season.battlesRemaining}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Remaining
                </div>
              </div>
            )}

            <div className="text-center">
              <div className="text-sm font-bold text-accent-light">
                {season.schadenfreudePool.toLocaleString()}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-gray-600">
                Schadenfreude Pool
              </div>
            </div>

            {season.bettingStats && (
              <>
                <div className="text-center">
                  <div className="text-sm font-bold text-gray-200">
                    {season.bettingStats.uniqueBettors}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-600">
                    Bettors
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold text-gray-200">
                    {season.bettingStats.totalBets}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-600">
                    Total Bets
                  </div>
                </div>
              </>
            )}

            {season.totalDistributed > 0 && (
              <div className="text-center">
                <div className="text-sm font-bold text-green-400">
                  {season.totalDistributed.toLocaleString()}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Distributed
                </div>
              </div>
            )}

            {season.totalBurned > 0 && (
              <div className="text-center">
                <div className="text-sm font-bold text-blood">
                  {season.totalBurned.toLocaleString()}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Burned
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
