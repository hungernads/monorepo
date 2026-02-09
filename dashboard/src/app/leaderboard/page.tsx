'use client';

import { useState, useCallback } from 'react';
import { useFetch } from '@/hooks/useFetch';
import type { AgentClass } from '@/types';
import LeaderboardTable from '@/components/leaderboard/LeaderboardTable';
import SeasonSelector from '@/components/leaderboard/SeasonSelector';
import type { SeasonSummary } from '@/components/leaderboard/SeasonSelector';
import type { AgentLeaderboardEntry } from '@/components/leaderboard/AgentRow';
import type { BettorLeaderboardEntry } from '@/components/leaderboard/BettorRow';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface AgentLeaderboardResponse {
  leaderboard: AgentLeaderboardEntry[];
  count: number;
}

interface BettorLeaderboardResponse {
  leaderboard: BettorLeaderboardEntry[];
  count: number;
}

// Season-scoped responses
interface SeasonAgentResponse {
  agentLeaderboard: Array<{
    rank: number;
    agentId: string;
    agentClass: AgentClass;
    agentName: string;
    wins: number;
    losses: number;
    kills: number;
    totalBattles: number;
    avgEpochsSurvived: number;
    winRate: number;
  }>;
  count: number;
  isLive: boolean;
}

interface SeasonBettorResponse {
  leaderboard: Array<{
    rank: number;
    userAddress: string;
    profit: number;
    totalWagered: number;
    totalPayout: number;
    winCount: number;
    betCount: number;
    schadenfreudePayout: number;
    claimed: boolean;
  }>;
  count: number;
  isLive: boolean;
}

// ---------------------------------------------------------------------------
// Helpers: map season responses to existing component types
// ---------------------------------------------------------------------------

function mapSeasonAgents(
  data: SeasonAgentResponse | null,
): AgentLeaderboardEntry[] {
  if (!data) return [];
  return data.agentLeaderboard.map((a) => ({
    agentId: a.agentId,
    agentClass: a.agentClass,
    totalBattles: a.totalBattles,
    wins: a.wins,
    kills: a.kills,
    winRate: a.winRate,
    streak: 0, // Season snapshot doesn't track streak
    avgSurvival: a.avgEpochsSurvived,
  }));
}

function mapSeasonBettors(
  data: SeasonBettorResponse | null,
): BettorLeaderboardEntry[] {
  if (!data) return [];
  return data.leaderboard.map((b) => ({
    user_address: b.userAddress,
    total_bets: b.betCount,
    total_wagered: b.totalWagered,
    total_payout: b.totalPayout,
    profit: b.profit,
    wins: b.winCount,
    win_rate: b.betCount > 0 ? b.winCount / b.betCount : 0,
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<SeasonSummary | null>(null);

  const handleSeasonChange = useCallback(
    (seasonId: string | null, summary: SeasonSummary | null) => {
      setSelectedSeasonId(seasonId);
      setSelectedSeason(summary);
    },
    [],
  );

  // ── All-time data (when no season selected) ────────────────────
  const {
    data: agentData,
    loading: agentLoading,
    error: agentError,
  } = useFetch<AgentLeaderboardResponse>('/leaderboard/agents?limit=200', {
    skip: selectedSeasonId !== null,
  });

  const {
    data: bettorData,
    loading: bettorLoading,
    error: bettorError,
  } = useFetch<BettorLeaderboardResponse>('/leaderboard/bettors?limit=200', {
    skip: selectedSeasonId !== null,
  });

  // ── Season-scoped data (when a season is selected) ─────────────
  const {
    data: seasonAgentData,
    loading: seasonAgentLoading,
    error: seasonAgentError,
  } = useFetch<SeasonAgentResponse>(
    selectedSeasonId ? `/season/${selectedSeasonId}/agents` : '',
    { skip: selectedSeasonId === null },
  );

  const {
    data: seasonBettorData,
    loading: seasonBettorLoading,
    error: seasonBettorError,
  } = useFetch<SeasonBettorResponse>(
    selectedSeasonId ? `/season/${selectedSeasonId}/leaderboard` : '',
    { skip: selectedSeasonId === null },
  );

  // ── Derived values ─────────────────────────────────────────────
  const isSeasonMode = selectedSeasonId !== null;
  const agents = isSeasonMode
    ? mapSeasonAgents(seasonAgentData)
    : (agentData?.leaderboard ?? []);
  const bettors = isSeasonMode
    ? mapSeasonBettors(seasonBettorData)
    : (bettorData?.leaderboard ?? []);
  const isAgentLoading = isSeasonMode ? seasonAgentLoading : agentLoading;
  const isBettorLoading = isSeasonMode ? seasonBettorLoading : bettorLoading;
  const anyError = isSeasonMode
    ? seasonAgentError || seasonBettorError
    : agentError || bettorError;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <Link
            href="/"
            className="text-xs text-gray-600 transition-colors hover:text-gold"
          >
            Home
          </Link>
          <span className="text-xs text-gray-700">/</span>
          <span className="text-xs text-gray-400">Leaderboard</span>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-cinzel text-2xl font-black uppercase tracking-widest text-gold sm:text-3xl lg:text-4xl">
              Leaderboard
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {isSeasonMode && selectedSeason
                ? `Season ${selectedSeason.seasonNumber} rankings${selectedSeason.status === 'active' ? ' (live)' : ''}`
                : 'All-time rankings of the fiercest gladiators and sharpest bettors.'}
            </p>
          </div>

          {/* Stats summary */}
          <div className="hidden items-center gap-6 sm:flex">
            {!isAgentLoading && agents.length > 0 && (
              <div className="text-right">
                <div className="text-lg font-bold text-gold">
                  {agents.length}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Gladiators
                </div>
              </div>
            )}
            {!isBettorLoading && bettors.length > 0 && (
              <div className="text-right">
                <div className="text-lg font-bold text-accent-light">
                  {bettors.length}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Bettors
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Season selector */}
      <div className="mb-6">
        <SeasonSelector
          selectedSeasonId={selectedSeasonId}
          onSeasonChange={handleSeasonChange}
        />
      </div>

      {/* Error banners */}
      {anyError && (
        <div className="mb-4 rounded-lg border border-blood/30 bg-blood/10 px-4 py-2 text-sm text-blood">
          Failed to load leaderboard data: {anyError}
        </div>
      )}

      {/* Live indicator for active season */}
      {isSeasonMode && selectedSeason?.status === 'active' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-2 text-sm text-green-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Live season data -- rankings update after each battle
        </div>
      )}

      {/* Main table */}
      <div className="card">
        <LeaderboardTable
          agents={agents}
          bettors={bettors}
          agentsLoading={isAgentLoading}
          bettorsLoading={isBettorLoading}
        />
      </div>
    </div>
  );
}
