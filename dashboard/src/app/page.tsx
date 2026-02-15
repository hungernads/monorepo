'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { AgentState, AgentClass } from '@/types';
import HeroSection from '@/components/home/HeroSection';
import BattleCard from '@/components/home/BattleCard';
import RecentResults from '@/components/home/RecentResults';
import type { RecentResult } from '@/components/home/RecentResults';
import AgentRank from '@/components/home/AgentRank';
import type { RankedAgent } from '@/components/home/AgentRank';
import BettorRank from '@/components/home/BettorRank';
import type { RankedBettor } from '@/components/home/BettorRank';
import LobbyCard from '@/components/lobby/LobbyCard';
import type { LobbyData } from '@/components/lobby/LobbyCard';
import { useFetch } from '@/hooks/useFetch';

// ---------------------------------------------------------------------------
// API response types (match backend shape)
// ---------------------------------------------------------------------------

interface BattleRow {
  id: string;
  status: string;
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

/** Shape returned by GET /battle/:id (ArenaDO live state) */
interface LiveBattleState {
  battleId: string;
  status: string;
  epoch: number;
  agents: {
    id: string;
    name: string;
    class: AgentClass;
    hp: number;
    maxHp: number;
    isAlive: boolean;
    kills: number;
    epochsSurvived?: number;
  }[];
  totalPool?: number;
}

/** Shape returned by GET /leaderboard/agents (wallet-aggregated) */
interface WalletLeaderboardEntry {
  wallet_address: string;
  total_battles: number;
  wins: number;
  kills: number;
  top_class: AgentClass;
  win_rate: number;
  prize_won_mon: string;
  prize_won_hnads: string;
}

interface AgentLeaderboardResponse {
  leaderboard: WalletLeaderboardEntry[];
  count: number;
}

/** Shape returned by GET /leaderboard/bettors */
interface BettorLeaderboardEntry {
  user_address: string;
  total_bets: number;
  total_wagered: number;
  total_payout: number;
  profit: number;
  wins: number;
  win_rate: number;
}

interface BettorLeaderboardResponse {
  leaderboard: BettorLeaderboardEntry[];
  count: number;
}

/** Shape returned by GET /battle/lobbies */
interface LobbiesResponse {
  lobbies: LobbyData[];
}

/** Shape returned by GET /agent/:id (for winner lookups) */
interface AgentInfo {
  id?: string;
  name?: string;
  class?: string;
  agentId?: string;
  agentClass?: string;
}

// ---------------------------------------------------------------------------
// API base URL
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

// ---------------------------------------------------------------------------
// Lobby tier display config (mirrors src/arena/tiers.ts for frontend display)
// ---------------------------------------------------------------------------

type LobbyTier = 'FREE' | 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD';

interface LobbyTierDisplay {
  tier: LobbyTier;
  label: string;
  monFee: string;
  hnadsFee: string;
  maxEpochs: number;
  winnerShare: number;
  killBonus?: string;
  survivalBonus?: string;
  description: string;
  color: string;
}

const LOBBY_TIERS: LobbyTierDisplay[] = [
  {
    tier: 'FREE',
    label: 'Free Arena',
    monFee: '0',
    hnadsFee: '0',
    maxEpochs: 20,
    winnerShare: 0,
    description: 'Practice battles with no stakes',
    color: '#6b7280',
  },
  {
    tier: 'IRON',
    label: 'Iron Arena',
    monFee: '0.01',
    hnadsFee: '10',
    maxEpochs: 30,
    winnerShare: 0.8,
    description: 'Cheap entry to test the arena',
    color: '#8b8b8b',
  },
  {
    tier: 'BRONZE',
    label: 'Bronze Arena',
    monFee: '10',
    hnadsFee: '100',
    maxEpochs: 50,
    winnerShare: 0.8,
    description: 'Stake MON + $HNADS for real prizes',
    color: '#cd7f32',
  },
  {
    tier: 'SILVER',
    label: 'Silver Arena',
    monFee: '50',
    hnadsFee: '500',
    maxEpochs: 75,
    winnerShare: 0.8,
    killBonus: '25',
    description: 'Higher stakes with kill bonuses',
    color: '#c0c0c0',
  },
  {
    tier: 'GOLD',
    label: 'Gold Arena',
    monFee: '100',
    hnadsFee: '1000',
    maxEpochs: 100,
    winnerShare: 0.85,
    killBonus: '50',
    survivalBonus: '100',
    description: 'Maximum stakes, maximum glory',
    color: '#f59e0b',
  },
];

// ---------------------------------------------------------------------------
// Loading skeleton components
// ---------------------------------------------------------------------------

/** Skeleton for lobby cards grid */
function LobbySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card animate-pulse">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-28 rounded bg-colosseum-surface-light" />
              <div className="h-4 w-10 rounded bg-colosseum-surface-light/50" />
            </div>
          </div>
          {/* Player count bar */}
          <div className="mb-2">
            <div className="mb-1 h-3 w-24 rounded bg-colosseum-surface-light/40" />
            <div className="h-2 w-full rounded-full bg-colosseum-surface-light/30" />
          </div>
          {/* Status */}
          <div className="mb-3 h-3 w-36 rounded bg-colosseum-surface-light/30" />
          {/* Action */}
          <div className="flex justify-end">
            <div className="h-8 w-24 rounded-lg bg-colosseum-surface-light/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for live battle cards */
function BattleCardSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div key={i} className="card animate-pulse">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-24 rounded bg-colosseum-surface-light" />
              <div className="h-4 w-10 rounded bg-blood/20" />
            </div>
            <div className="h-3 w-16 rounded bg-colosseum-surface-light/40" />
          </div>
          {/* Agent HP bars */}
          <div className="mb-3 space-y-2">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="flex items-center gap-2">
                <div className="h-3 w-16 rounded bg-colosseum-surface-light/40" />
                <div className="relative h-2 flex-1 rounded-full bg-colosseum-surface-light/30" />
                <div className="h-3 w-10 rounded bg-colosseum-surface-light/30" />
              </div>
            ))}
          </div>
          {/* Footer */}
          <div className="flex items-center justify-between border-t border-colosseum-surface-light pt-2">
            <div className="h-3 w-16 rounded bg-colosseum-surface-light/30" />
            <div className="h-3 w-28 rounded bg-colosseum-surface-light/30" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for recent results list */
function RecentResultsSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="mb-4 h-4 w-28 rounded bg-colosseum-surface-light" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <div className="h-3 w-12 rounded bg-colosseum-surface-light/40" />
              <div className="h-4 w-24 rounded bg-colosseum-surface-light/50" />
              <div className="h-4 w-16 rounded bg-colosseum-surface-light/30" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-3 w-12 rounded bg-colosseum-surface-light/30" />
              <div className="h-3 w-16 rounded bg-colosseum-surface-light/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for agent/bettor rank lists */
function RankSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="mb-4 h-4 w-28 rounded bg-colosseum-surface-light" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2"
          >
            <div className="h-4 w-5 rounded bg-colosseum-surface-light/50" />
            <div className="h-4 flex-1 rounded bg-colosseum-surface-light/40" />
            <div className="h-4 w-16 rounded bg-colosseum-surface-light/30" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state component
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <div className="card flex items-center justify-center py-8">
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  // ── Live battles ──────────────────────────────────────────────
  const [liveBattles, setLiveBattles] = useState<
    {
      battleId: string;
      agents: AgentState[];
      currentEpoch: number;
      totalPool: number;
    }[]
  >([]);
  const [liveBattlesLoading, setLiveBattlesLoading] = useState(true);

  const fetchLiveBattles = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLiveBattlesLoading(true);

      // Step 1: Get active battle IDs
      const listRes = await fetch(
        `${API_BASE}/battles?status=ACTIVE&limit=10`,
      );
      if (!listRes.ok) {
        setLiveBattles([]);
        return;
      }
      const listData = (await listRes.json()) as BattlesResponse;

      if (!listData.battles.length) {
        setLiveBattles([]);
        return;
      }

      // Step 2: Fetch full state for each active battle
      const states = await Promise.allSettled(
        listData.battles.map(async (b) => {
          const res = await fetch(`${API_BASE}/battle/${b.id}`);
          if (!res.ok) return null;
          return res.json() as Promise<LiveBattleState>;
        }),
      );

      const mapped = states
        .filter(
          (r): r is PromiseFulfilledResult<LiveBattleState> =>
            r.status === 'fulfilled' && r.value != null,
        )
        .map((r) => r.value)
        .map((state) => ({
          battleId: state.battleId ?? state.agents?.[0]?.id?.slice(0, 3) ?? '?',
          agents: (state.agents ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            class: a.class,
            hp: a.hp,
            maxHp: a.maxHp ?? 1000,
            alive: a.isAlive ?? a.hp > 0,
            kills: a.kills ?? 0,
          })),
          currentEpoch: state.epoch ?? 0,
          totalPool: state.totalPool ?? 0,
        }));

      setLiveBattles(mapped);
    } catch {
      setLiveBattles([]);
    } finally {
      if (isInitial) setLiveBattlesLoading(false);
    }
  }, []);

  // ── Open lobbies ──────────────────────────────────────────────
  const [lobbies, setLobbies] = useState<LobbyData[]>([]);
  const [lobbiesLoading, setLobbiesLoading] = useState(true);

  const fetchLobbies = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLobbiesLoading(true);
      const res = await fetch(`${API_BASE}/battle/lobbies`);
      if (!res.ok) {
        setLobbies([]);
        return;
      }
      const data = (await res.json()) as LobbiesResponse;
      setLobbies(data.lobbies ?? []);
    } catch {
      setLobbies([]);
    } finally {
      if (isInitial) setLobbiesLoading(false);
    }
  }, []);

  // ── Recent results ────────────────────────────────────────────
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const fetchRecentResults = useCallback(async () => {
    try {
      setRecentLoading(true);

      const res = await fetch(
        `${API_BASE}/battles?status=COMPLETED&limit=5`,
      );
      if (!res.ok) {
        setRecentResults([]);
        return;
      }
      const data = (await res.json()) as BattlesResponse;

      if (!data.battles.length) {
        setRecentResults([]);
        return;
      }

      // For each completed battle, try to get winner info
      const results = await Promise.allSettled(
        data.battles.map(async (b) => {
          let winnerName = 'Unknown';
          let winnerClass: AgentClass = 'WARRIOR';

          if (b.winner_id) {
            try {
              const agentRes = await fetch(
                `${API_BASE}/agent/${b.winner_id}`,
              );
              if (agentRes.ok) {
                const info = (await agentRes.json()) as AgentInfo;
                winnerName =
                  info.name ?? `${info.agentClass ?? 'AGENT'}-${(info.agentId ?? b.winner_id).slice(0, 6)}`;
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
            battleId: b.id.slice(0, 6),
            winnerName,
            winnerClass,
            killCount: b.winner_kills ?? 0,
            durationEpochs: b.epoch_count,
            endedAt: b.ended_at
              ? new Date(b.ended_at).getTime()
              : Date.now(),
          };
        }),
      );

      setRecentResults(
        results
          .filter(
            (r): r is PromiseFulfilledResult<RecentResult> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value),
      );
    } catch {
      setRecentResults([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  // ── Agent leaderboard ─────────────────────────────────────────
  const {
    data: agentLbData,
    loading: agentLbLoading,
  } = useFetch<AgentLeaderboardResponse>('/leaderboard/agents?limit=5');

  const topAgents: RankedAgent[] = (agentLbData?.leaderboard ?? []).map(
    (entry, i) => ({
      rank: i + 1,
      walletAddress: entry.wallet_address,
      topClass: entry.top_class,
      totalKills: entry.kills,
      winRate: Math.round(entry.win_rate * 100),
      totalBattles: entry.total_battles,
      totalPrizesMon: entry.prize_won_mon,
      totalPrizesHnads: entry.prize_won_hnads,
    }),
  );

  // ── Bettor leaderboard ────────────────────────────────────────
  const {
    data: bettorLbData,
    loading: bettorLbLoading,
  } = useFetch<BettorLeaderboardResponse>('/leaderboard/bettors?limit=5');

  const topBettors: RankedBettor[] = (bettorLbData?.leaderboard ?? []).map(
    (entry, i) => ({
      rank: i + 1,
      address: entry.user_address,
      profit: entry.profit,
      totalBets: Number(entry.total_bets),
    }),
  );

  // ── Create a new lobby ──────────────────────────────────────────
  const [creatingLobby, setCreatingLobby] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTier, setSelectedTier] = useState<LobbyTier>('FREE');

  const handleCreateLobby = useCallback(async () => {
    try {
      setCreatingLobby(true);

      const res = await fetch(`${API_BASE}/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { battleId: string };
      window.location.href = `/lobby/${data.battleId}`;
    } catch (err) {
      console.error('Failed to create lobby:', err);
      setCreatingLobby(false);
    }
  }, [selectedTier]);

  // ── Kick off fetches on mount ─────────────────────────────────
  useEffect(() => {
    fetchLiveBattles(true);
    fetchLobbies(true);
    fetchRecentResults();

    // Poll live battles + lobbies every 15 seconds (silent — no skeleton flash)
    const interval = setInterval(() => {
      fetchLiveBattles();
      fetchLobbies();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchLiveBattles, fetchLobbies, fetchRecentResults]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div>
      <HeroSection activeBattleCount={liveBattles.length} />

      {/* Open Lobbies Section */}
      <div className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            Open Arenas
          </h2>
        </div>

        {lobbiesLoading ? (
          <LobbySkeleton />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lobbies.map((lobby) => (
              <LobbyCard key={lobby.battleId} lobby={lobby} />
            ))}
            <button
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="card flex flex-col items-center justify-center gap-3 border-dashed border-colosseum-surface-light hover:border-gold/40 transition-colors min-h-[140px]"
            >
              <span className="text-3xl text-gray-600">+</span>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Create New Arena</span>
            </button>
          </div>
        )}
      </div>

      {/* Tier Selection Section */}
      <div className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-500">
            Choose Arena Tier
          </h2>
          <button
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="transition-transform"
            style={{ transform: showCreateForm ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-500"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>

        {showCreateForm && (
          <div className="rounded-lg border border-gold/20 bg-colosseum-surface p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {LOBBY_TIERS.map((t) => {
                const isSelected = selectedTier === t.tier;
                return (
                  <button
                    key={t.tier}
                    type="button"
                    onClick={() => setSelectedTier(t.tier)}
                    className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                      isSelected
                        ? 'scale-[1.02] border-current shadow-lg'
                        : 'border-colosseum-surface-light hover:border-gray-600'
                    }`}
                    style={{
                      color: isSelected ? t.color : undefined,
                      backgroundColor: isSelected ? `${t.color}10` : undefined,
                      boxShadow: isSelected ? `0 0 20px ${t.color}25` : undefined,
                    }}
                  >
                    {/* Selected indicator */}
                    {isSelected && (
                      <span
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-colosseum-bg"
                        style={{ backgroundColor: t.color }}
                      >
                        &#10003;
                      </span>
                    )}

                    {/* Tier name */}
                    <div
                      className="font-cinzel text-sm font-bold"
                      style={{ color: t.color }}
                    >
                      {t.label}
                    </div>

                    {/* Fees */}
                    <div className="mt-2 space-y-0.5">
                      <div className="text-xs text-gray-400">
                        <span className="font-bold text-gray-200">{t.monFee}</span>{' '}
                        MON
                      </div>
                      <div className="text-xs text-gray-400">
                        <span className="font-bold text-gray-200">{t.hnadsFee}</span>{' '}
                        $HNADS
                      </div>
                    </div>

                    {/* Features */}
                    <div className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                      <div>{t.maxEpochs} max epochs</div>
                      {t.winnerShare > 0 && (
                        <div>Winner: {Math.round(t.winnerShare * 100)}% of pool</div>
                      )}
                      {t.killBonus && <div>{t.killBonus} $HNADS/kill</div>}
                      {t.survivalBonus && <div>{t.survivalBonus} survival bonus</div>}
                    </div>

                    {/* Description */}
                    <p className="mt-2 text-[10px] leading-snug text-gray-600">
                      {t.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Create button */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[11px] text-gray-500">
                {selectedTier === 'FREE'
                  ? 'No entry fee required.'
                  : `Each gladiator pays ${LOBBY_TIERS.find((t) => t.tier === selectedTier)?.monFee ?? '?'} MON + ${LOBBY_TIERS.find((t) => t.tier === selectedTier)?.hnadsFee ?? '?'} $HNADS to enter.`}
              </p>
              <button
                onClick={handleCreateLobby}
                disabled={creatingLobby}
                className="rounded-lg bg-gradient-to-r from-gold-dark via-gold to-gold-light px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-colosseum-bg shadow-lg shadow-gold/20 transition-all hover:shadow-gold/40 active:scale-[0.97] disabled:opacity-60"
              >
                {creatingLobby ? 'Creating...' : 'Create Arena'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-5">
        {/* Left column: live battles + recent results */}
        <div className="space-y-6 lg:col-span-3">
          <div>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-blood" />
              Live Battles
            </h2>
            {liveBattlesLoading ? (
              <BattleCardSkeleton />
            ) : liveBattles.length === 0 ? (
              <EmptyState message="No battles are currently live. Check back soon." />
            ) : (
              <div className="space-y-4">
                {liveBattles.map((battle) => (
                  <BattleCard
                    key={battle.battleId}
                    battleId={battle.battleId}
                    agents={battle.agents}
                    currentEpoch={battle.currentEpoch}
                    totalPool={battle.totalPool}
                  />
                ))}
              </div>
            )}
          </div>

          {recentLoading ? (
            <RecentResultsSkeleton />
          ) : recentResults.length === 0 ? (
            <EmptyState message="No completed battles yet." />
          ) : (
            <>
              <RecentResults results={recentResults} />
              <div className="mt-4 text-center">
                <Link
                  href="/battles"
                  className="text-xs font-bold uppercase tracking-wider text-gray-600 transition-colors hover:text-gold"
                >
                  View All Battles
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Right column: leaderboards */}
        <div className="space-y-6 lg:col-span-2">
          {agentLbLoading ? (
            <RankSkeleton />
          ) : topAgents.length === 0 ? (
            <EmptyState message="No agents ranked yet." />
          ) : (
            <AgentRank agents={topAgents} />
          )}

          {bettorLbLoading ? (
            <RankSkeleton />
          ) : topBettors.length === 0 ? (
            <EmptyState message="No bettors ranked yet." />
          ) : (
            <BettorRank bettors={topBettors} />
          )}

          <Link
            href="/leaderboard"
            className="block text-center text-xs font-bold uppercase tracking-wider text-gray-600 transition-colors hover:text-gold"
          >
            View Full Leaderboard
          </Link>
        </div>
      </div>

      <div className="mt-12 text-center text-xs text-gray-700">
        <p>$HNADS on nad.fun // Monad Hackathon - Moltiverse</p>
      </div>
    </div>
  );
}
