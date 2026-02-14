'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { AgentClass } from '@/types';
import { CLASS_CONFIG } from '@/components/battle/mock-data';

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface BattleRow {
  id: string;
  status: string;
  tier: string;
  started_at: string | null;
  ended_at: string | null;
  winner_id: string | null;
  epoch_count: number;
  winner_kills?: number | null;
}

interface BattlesResponse {
  battles: BattleRow[];
  count: number;
}

interface AgentInfo {
  id?: string;
  name?: string;
  class?: string;
  agentId?: string;
  agentClass?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TIER_BADGE: Record<string, { label: string; color: string }> = {
  FREE: { label: 'Free', color: '#6b7280' },
  IRON: { label: 'Iron', color: '#8b8b8b' },
  BRONZE: { label: 'Bronze', color: '#cd7f32' },
  SILVER: { label: 'Silver', color: '#c0c0c0' },
  GOLD: { label: 'Gold', color: '#f59e0b' },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BattlesPage() {
  const [battles, setBattles] = useState<
    {
      id: string;
      winnerName: string;
      winnerClass: AgentClass;
      killCount: number;
      epochCount: number;
      tier: string;
      endedAt: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchBattles = async (currentOffset: number) => {
    try {
      setLoading(true);

      const res = await fetch(
        `${API_BASE}/battles?status=COMPLETED&limit=20&offset=${currentOffset}`,
      );
      if (!res.ok) {
        setBattles([]);
        setHasMore(false);
        return;
      }
      const data = (await res.json()) as BattlesResponse;

      if (!data.battles.length) {
        setHasMore(false);
        return;
      }

      // For each completed battle, try to get winner info
      const results = await Promise.allSettled(
        data.battles.map(async (b) => {
          let winnerName = 'Unknown';
          let winnerClass: AgentClass = 'WARRIOR';

          if (b.winner_id) {
            try {
              const agentRes = await fetch(`${API_BASE}/agent/${b.winner_id}`);
              if (agentRes.ok) {
                const info = (await agentRes.json()) as AgentInfo;
                winnerName =
                  info.name ??
                  `${info.agentClass ?? 'AGENT'}-${(info.agentId ?? b.winner_id).slice(0, 6)}`;
                winnerClass =
                  (info.class as AgentClass) ??
                  (info.agentClass as AgentClass) ??
                  'WARRIOR';
              }
            } catch {
              // Use defaults
            }
          }

          return {
            id: b.id,
            winnerName,
            winnerClass,
            killCount: b.winner_kills ?? 0,
            epochCount: b.epoch_count,
            tier: b.tier ?? 'FREE',
            endedAt: b.ended_at ?? new Date().toISOString(),
          };
        }),
      );

      const mapped = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<any>).value);

      setBattles((prev) => (currentOffset === 0 ? mapped : [...prev, ...mapped]));
      setHasMore(data.battles.length === 20);
    } catch {
      setBattles([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBattles(0);
  }, []);

  const handleLoadMore = () => {
    const newOffset = offset + 20;
    setOffset(newOffset);
    fetchBattles(newOffset);
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-cinzel text-2xl font-bold uppercase tracking-wider text-gold sm:text-3xl">
            Battle History
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            All completed battles in the colosseum
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-gray-700 bg-colosseum-surface px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-400 transition-all hover:border-gold hover:text-gold"
        >
          Back to Arena
        </Link>
      </div>

      {/* Battle list */}
      {loading && offset === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="card flex animate-pulse items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="h-4 w-16 rounded bg-colosseum-surface-light" />
                <div className="h-5 w-32 rounded bg-colosseum-surface-light" />
                <div className="h-4 w-16 rounded bg-colosseum-surface-light/50" />
              </div>
              <div className="flex items-center gap-4">
                <div className="h-3 w-12 rounded bg-colosseum-surface-light/30" />
                <div className="h-3 w-16 rounded bg-colosseum-surface-light/30" />
                <div className="h-3 w-12 rounded bg-colosseum-surface-light/30" />
                <div className="h-3 w-20 rounded bg-colosseum-surface-light/30" />
              </div>
            </div>
          ))}
        </div>
      ) : battles.length === 0 ? (
        <div className="card flex items-center justify-center py-12">
          <p className="text-sm text-gray-600">No completed battles yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {battles.map((battle) => {
              const tierInfo = TIER_BADGE[battle.tier] ?? TIER_BADGE.FREE;
              const classConfig = CLASS_CONFIG[battle.winnerClass];

              return (
                <div
                  key={battle.id}
                  className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* Left: Battle ID + Winner */}
                  <div className="flex items-center gap-4 min-w-0">
                    <Link
                      href={`/battle/${battle.id}`}
                      className="flex-shrink-0 text-xs text-gray-600 transition-colors hover:text-gold"
                    >
                      #{battle.id.slice(0, 8)}
                    </Link>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-sm font-bold text-gray-200">
                        {battle.winnerName}
                      </span>
                      <span
                        className={`flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${classConfig.bgColor} ${classConfig.color}`}
                      >
                        {battle.winnerClass}
                      </span>
                    </div>
                  </div>

                  {/* Right: Stats */}
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{battle.killCount} kills</span>
                    <span>{battle.epochCount} epochs</span>
                    <span
                      className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: `${tierInfo.color}15`,
                        color: tierInfo.color,
                      }}
                    >
                      {tierInfo.label}
                    </span>
                    <span suppressHydrationWarning>{timeAgo(battle.endedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load More button */}
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="rounded-lg border border-gold/40 bg-gold/10 px-8 py-3 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98] disabled:opacity-60"
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
