'use client';

import { useState } from 'react';
import type { AgentClass } from '@/types';
import { shortenAddress } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-agent entry (used by season view) */
export interface AgentLeaderboardEntry {
  agentId: string;
  agentClass: AgentClass;
  totalBattles: number;
  wins: number;
  kills: number;
  winRate: number;
  streak: number;
  avgSurvival: number;
}

/** Per-wallet entry (used by all-time view) */
export interface WalletLeaderboardEntry {
  wallet_address: string;
  total_battles: number;
  wins: number;
  kills: number;
  top_class: AgentClass;
  win_rate: number;
  prize_won_mon: string;
  prize_won_hnads: string;
}

interface AgentRowProps {
  entry: AgentLeaderboardEntry | WalletLeaderboardEntry;
  rank: number;
}

// ---------------------------------------------------------------------------
// Class icons & badges
// ---------------------------------------------------------------------------

const CLASS_ICON: Record<AgentClass, string> = {
  WARRIOR: '\u2694\uFE0F',
  TRADER: '\uD83D\uDCCA',
  SURVIVOR: '\uD83D\uDEE1\uFE0F',
  PARASITE: '\uD83E\uDDA0',
  GAMBLER: '\uD83C\uDFB2',
};

const CLASS_BADGE: Record<AgentClass, string> = {
  WARRIOR: 'badge-warrior',
  TRADER: 'badge-trader',
  SURVIVOR: 'badge-survivor',
  PARASITE: 'badge-parasite',
  GAMBLER: 'badge-gambler',
};

// ---------------------------------------------------------------------------
// Rank badge colors
// ---------------------------------------------------------------------------

function rankClass(rank: number): string {
  if (rank === 1) return 'text-gold';
  if (rank === 2) return 'text-gray-300';
  if (rank === 3) return 'text-amber-700';
  return 'text-gray-600';
}

// ---------------------------------------------------------------------------
// Trending detection
// ---------------------------------------------------------------------------

function isTrending(entry: AgentLeaderboardEntry): boolean {
  return entry.streak >= 2 && entry.winRate >= 0.4 && entry.totalBattles >= 3;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AgentRow({ entry, rank }: AgentRowProps) {
  const [copied, setCopied] = useState(false);

  // Discriminated union: check if wallet entry or agent entry
  const isWalletEntry = 'wallet_address' in entry;

  // Extract common fields based on entry type
  const winRate = isWalletEntry ? entry.win_rate : entry.winRate;
  const winPct = Math.round(winRate * 100);
  const kills = entry.kills;
  const totalBattles = isWalletEntry ? entry.total_battles : entry.totalBattles;
  const agentClass = isWalletEntry ? entry.top_class : entry.agentClass;
  const trending = !isWalletEntry && isTrending(entry);

  // Copy address to clipboard (wallet entries only)
  const handleCopyAddress = async () => {
    if (!isWalletEntry) return;
    try {
      await navigator.clipboard.writeText(entry.wallet_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="group flex items-center gap-3 rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-3 transition-colors hover:border-gold/20 hover:bg-colosseum-surface/80 sm:py-2.5">
      {/* Rank */}
      <span className={`w-7 text-center text-sm font-bold ${rankClass(rank)}`}>
        {rank}
      </span>

      {/* Class icon */}
      <span className="w-6 text-center text-base" title={agentClass}>
        {CLASS_ICON[agentClass]}
      </span>

      {/* Name/Address + class badge */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isWalletEntry ? (
          // Wallet entry: show shortened address with copy button
          <button
            onClick={handleCopyAddress}
            className="truncate text-sm font-bold text-gray-200 transition-colors hover:text-gold"
            title={`${entry.wallet_address} (click to copy)`}
          >
            {shortenAddress(entry.wallet_address)}
            {copied && (
              <span className="ml-2 text-[10px] text-green-400">Copied!</span>
            )}
          </button>
        ) : (
          // Agent entry: show agent ID as before
          <span className="truncate text-sm font-bold text-gray-200">
            {entry.agentClass}-{entry.agentId.slice(0, 6)}
          </span>
        )}
        <span className={CLASS_BADGE[agentClass]}>
          {agentClass}
        </span>
        {trending && (
          <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
            Trending
          </span>
        )}
      </div>

      {/* Win rate bar */}
      <div className="hidden w-28 items-center gap-2 sm:flex">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-colosseum-surface-light">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${winPct}%`,
              backgroundColor:
                winPct >= 60
                  ? '#22c55e'
                  : winPct >= 40
                    ? '#f59e0b'
                    : '#dc2626',
            }}
          />
        </div>
        <span className="w-9 text-right text-xs font-bold text-gold">
          {winPct}%
        </span>
      </div>

      {/* Stats */}
      <div className="hidden gap-4 text-right md:flex">
        <div className="w-12">
          <div className="text-xs font-bold text-gray-300">{kills}</div>
          <div className="text-[10px] text-gray-600">kills</div>
        </div>
        <div className="w-12">
          <div className="text-xs font-bold text-gray-300">
            {totalBattles}
          </div>
          <div className="text-[10px] text-gray-600">battles</div>
        </div>
        {isWalletEntry ? (
          // Wallet entry: show total prizes instead of streak
          <div className="w-12">
            <div className="text-xs font-bold text-gray-300">
              {parseInt(entry.prize_won_mon) > 0 ? `${(parseInt(entry.prize_won_mon) / 1e18).toFixed(1)}` : '--'}
            </div>
            <div className="text-[10px] text-gray-600">MON</div>
          </div>
        ) : (
          // Agent entry: show streak as before
          <div className="w-12">
            <div
              className={`text-xs font-bold ${entry.streak > 0 ? 'text-green-400' : 'text-gray-500'}`}
            >
              {entry.streak > 0 ? `${entry.streak}W` : '--'}
            </div>
            <div className="text-[10px] text-gray-600">streak</div>
          </div>
        )}
      </div>

      {/* Mobile win rate */}
      <div className="text-right sm:hidden">
        <span className="text-sm font-bold text-gold">{winPct}%</span>
        <span className="ml-1 text-[10px] text-gray-600">
          ({totalBattles})
        </span>
      </div>
    </div>
  );
}
