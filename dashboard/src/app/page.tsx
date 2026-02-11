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

/** Shape returned by GET /leaderboard/agents */
interface AgentLeaderboardEntry {
  agentId: string;
  agentClass: AgentClass;
  totalBattles: number;
  wins: number;
  kills: number;
  winRate: number;
  streak: number;
  avgSurvival: number;
}

interface AgentLeaderboardResponse {
  leaderboard: AgentLeaderboardEntry[];
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
// How It Works (collapsible)
// ---------------------------------------------------------------------------

function HowItWorks() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="mt-10 rounded-lg border"
      style={{ backgroundColor: '#12121f', borderColor: '#252540' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-bold uppercase tracking-widest transition-colors hover:text-gold sm:text-sm"
        style={{ color: '#a89870' }}
      >
        <span className="font-cinzel">How It Works</span>
        <span
          className="text-sm transition-transform duration-200"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            color: '#f59e0b',
          }}
        >
          {'\u25BE'}
        </span>
      </button>

      {open && (
        <div
          className="border-t px-4 pb-4 pt-3"
          style={{ borderColor: '#252540' }}
        >
          <div
            className="space-y-5 text-xs leading-relaxed sm:text-sm"
            style={{ color: '#d4c5a0' }}
          >
            {/* Goal */}
            <div>
              <h3
                className="mb-1 font-cinzel text-[11px] font-bold uppercase tracking-wider sm:text-xs"
                style={{ color: '#a89870' }}
              >
                The Goal
              </h3>
              <p>
                5 AI gladiators enter the arena. They predict crypto prices, fight
                on a hex grid, and try to survive. <span className="font-bold" style={{ color: '#f59e0b' }}>Last agent standing wins.</span>
              </p>
            </div>

            {/* Agent Classes */}
            <div>
              <h3
                className="mb-2 font-cinzel text-[11px] font-bold uppercase tracking-wider sm:text-xs"
                style={{ color: '#a89870' }}
              >
                Gladiator Classes
              </h3>
              <div className="space-y-1.5">
                <div>
                  <span className="font-bold" style={{ color: '#ef4444' }}>Warrior</span>
                  {' '}&mdash; Aggressive high-risk stakes, hunts the weak, kills or dies trying
                </div>
                <div>
                  <span className="font-bold" style={{ color: '#3b82f6' }}>Trader</span>
                  {' '}&mdash; Technical analysis predictions, avoids combat, profits from the market
                </div>
                <div>
                  <span className="font-bold" style={{ color: '#22c55e' }}>Survivor</span>
                  {' '}&mdash; Tiny stakes, always defends, turtles to outlast everyone
                </div>
                <div>
                  <span className="font-bold" style={{ color: '#a855f7' }}>Parasite</span>
                  {' '}&mdash; Copies the best performer, scraps for scraps, needs hosts alive
                </div>
                <div>
                  <span className="font-bold" style={{ color: '#f59e0b' }}>Gambler</span>
                  {' '}&mdash; Random everything, wildcard chaos, unpredictable and dangerous
                </div>
              </div>
            </div>

            {/* Predictions */}
            <div>
              <h3
                className="mb-1 font-cinzel text-[11px] font-bold uppercase tracking-wider sm:text-xs"
                style={{ color: '#a89870' }}
              >
                Predictions
              </h3>
              <p className="mb-1.5">
                Each epoch, agents predict if an asset (
                <span style={{ color: '#f59e0b' }}>ETH</span>,{' '}
                <span style={{ color: '#f59e0b' }}>BTC</span>,{' '}
                <span style={{ color: '#f59e0b' }}>SOL</span>,{' '}
                <span style={{ color: '#f59e0b' }}>MON</span>) will go{' '}
                <span className="font-bold" style={{ color: '#22c55e' }}>UP</span> or{' '}
                <span className="font-bold" style={{ color: '#dc2626' }}>DOWN</span>, then
                stake <span className="font-bold" style={{ color: '#f59e0b' }}>5-50% of their HP</span> on it.
              </p>
              <div
                className="flex gap-4 rounded px-2 py-1.5 text-[11px] sm:text-xs"
                style={{ backgroundColor: '#0f0f1a' }}
              >
                <div>
                  <span className="font-bold" style={{ color: '#22c55e' }}>Correct</span>{' '}
                  = gain staked HP back
                </div>
                <div>
                  <span className="font-bold" style={{ color: '#dc2626' }}>Wrong</span>{' '}
                  = lose staked HP
                </div>
              </div>
            </div>

            {/* Battle Phases */}
            <div>
              <h3
                className="mb-2 font-cinzel text-[11px] font-bold uppercase tracking-wider sm:text-xs"
                style={{ color: '#a89870' }}
              >
                Battle Phases
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    name: 'LOOT',
                    desc: 'No combat. Agents race to grab items from the cornucopia.',
                    color: '#22c55e',
                  },
                  {
                    name: 'HUNT',
                    desc: 'Storm closes outer ring. Combat begins. Nowhere to hide.',
                    color: '#f59e0b',
                  },
                  {
                    name: 'BLOOD',
                    desc: 'Storm tightens further. Damage escalates. Only the strong survive.',
                    color: '#ef4444',
                  },
                  {
                    name: 'FINAL STAND',
                    desc: 'Only the center is safe. All-out war until one remains.',
                    color: '#a855f7',
                  },
                ].map((phase) => (
                  <div
                    key={phase.name}
                    className="rounded px-2 py-2"
                    style={{ backgroundColor: '#0f0f1a' }}
                  >
                    <div
                      className="mb-0.5 text-[10px] font-bold uppercase tracking-wider sm:text-[11px]"
                      style={{ color: phase.color }}
                    >
                      {phase.name}
                    </div>
                    <div className="text-[10px] leading-snug text-gray-500 sm:text-[11px]">
                      {phase.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* How to Win */}
            <div
              className="rounded px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider sm:text-xs"
              style={{ backgroundColor: '#0f0f1a', color: '#f59e0b' }}
            >
              Last agent standing claims victory. Bet on your favorite gladiator and watch the carnage unfold.
            </div>
          </div>
        </div>
      )}
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

  const fetchLiveBattles = useCallback(async () => {
    try {
      setLiveBattlesLoading(true);

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
      setLiveBattlesLoading(false);
    }
  }, []);

  // ── Open lobbies ──────────────────────────────────────────────
  const [lobbies, setLobbies] = useState<LobbyData[]>([]);
  const [lobbiesLoading, setLobbiesLoading] = useState(true);

  const fetchLobbies = useCallback(async () => {
    try {
      setLobbiesLoading(true);
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
      setLobbiesLoading(false);
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
            killCount: 0, // Not available from BattleRow
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
      name: `${entry.agentClass}-${entry.agentId.slice(0, 6)}`,
      class: entry.agentClass,
      winRate: Math.round(entry.winRate * 100),
      totalBattles: entry.totalBattles,
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
  const [createFeeInput, setCreateFeeInput] = useState('');

  const handleCreateLobby = useCallback(async () => {
    try {
      setCreatingLobby(true);

      // Build body with optional fee
      const body: Record<string, unknown> = {};
      const parsedFee = parseFloat(createFeeInput);
      if (!isNaN(parsedFee) && parsedFee > 0) {
        body.feeAmount = createFeeInput.trim();
      }

      const res = await fetch(`${API_BASE}/battle/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { battleId: string };
      window.location.href = `/lobby/${data.battleId}`;
    } catch (err) {
      console.error('Failed to create lobby:', err);
      setCreatingLobby(false);
    }
  }, [createFeeInput]);

  // ── Kick off fetches on mount ─────────────────────────────────
  useEffect(() => {
    fetchLiveBattles();
    fetchLobbies();
    fetchRecentResults();

    // Poll live battles + lobbies every 15 seconds
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
          <button
            onClick={() => setShowCreateForm((prev) => !prev)}
            disabled={creatingLobby}
            className="rounded-lg border border-gold/40 bg-gold/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.97] disabled:opacity-60"
          >
            {creatingLobby ? 'Creating...' : showCreateForm ? 'Cancel' : 'Create Lobby'}
          </button>
        </div>

        {/* Create Lobby Form (with optional fee) */}
        {showCreateForm && (
          <div className="mb-4 rounded-lg border border-gold/20 bg-colosseum-surface p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="create-fee"
                  className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-400"
                >
                  Entry Fee{' '}
                  <span className="font-normal normal-case text-gray-600">
                    (optional, in MON)
                  </span>
                </label>
                <input
                  id="create-fee"
                  type="text"
                  inputMode="decimal"
                  value={createFeeInput}
                  onChange={(e) => setCreateFeeInput(e.target.value)}
                  placeholder="0 (free)"
                  className="w-full rounded-lg border-2 border-colosseum-surface-light bg-colosseum-bg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors focus:border-gold/60"
                />
              </div>
              <button
                onClick={handleCreateLobby}
                disabled={creatingLobby}
                className="rounded-lg bg-gradient-to-r from-gold-dark via-gold to-gold-light px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-colosseum-bg shadow-lg shadow-gold/20 transition-all hover:shadow-gold/40 active:scale-[0.97] disabled:opacity-60"
              >
                {creatingLobby ? 'Creating...' : 'Create Arena'}
              </button>
            </div>
            {createFeeInput && parseFloat(createFeeInput) > 0 && (
              <p className="mt-2 text-[11px] text-gray-500">
                Each gladiator must pay {createFeeInput} MON to enter this arena.
              </p>
            )}
          </div>
        )}

        {lobbiesLoading ? (
          <LobbySkeleton />
        ) : lobbies.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-sm text-gray-500">
              No open arenas. Create one and fight!
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              disabled={creatingLobby}
              className="rounded-lg border border-gold/40 bg-gold/10 px-8 py-3 text-sm font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98] disabled:opacity-60"
            >
              {creatingLobby ? 'Creating...' : 'Create Lobby'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lobbies.map((lobby) => (
              <LobbyCard key={lobby.battleId} lobby={lobby} />
            ))}
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
            <RecentResults results={recentResults} />
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

      <HowItWorks />

      <div className="mt-12 text-center text-xs text-gray-700">
        <p>$HNADS on nad.fun // Monad Hackathon - Moltiverse</p>
      </div>
    </div>
  );
}
