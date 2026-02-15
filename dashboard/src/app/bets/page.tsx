'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Coins, ExternalLink } from 'lucide-react';
import useFetch from '@/hooks/useFetch';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CLASS_CONFIG } from '@/components/battle/mock-data';
import AgentPortrait from '@/components/battle/AgentPortrait';
import { useClaimable, useClaimed, battleIdToBytes32 } from '@/lib/contracts';
import { BETTING_ADDRESS, EXPLORER_TX_URL } from '@/lib/wallet';
import type { AgentClass } from '@/types';

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface UserBet {
  id: string;
  battle_id: string;
  agent_id: string;
  agent_class?: AgentClass;
  agent_name?: string;
  amount: number;
  payout: number;
  settled: boolean;
  created_at: string;
}

interface UserBetsResponse {
  userAddress: string;
  bets: UserBet[];
  count: number;
}

// ---------------------------------------------------------------------------
// Claim button for a specific battle
// ---------------------------------------------------------------------------

function ClaimButton({ battleId }: { battleId: string }) {
  const { data: claimableRaw, refetch: refetchClaimable } = useClaimable(battleId);
  const { data: alreadyClaimed, refetch: refetchClaimed } = useClaimed(battleId);

  const claimable = claimableRaw ? Number(claimableRaw) / 1e18 : 0;
  const claimed = alreadyClaimed === true;

  const { writeContract, isPending, data: hash, error } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash });

  // Refresh after claim tx confirms
  useEffect(() => {
    if (isSuccess) {
      const t = setTimeout(() => { refetchClaimable(); refetchClaimed(); }, 3000);
      return () => clearTimeout(t);
    }
  }, [isSuccess, refetchClaimable, refetchClaimed]);

  if (claimed || isSuccess) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-green-500/20 px-2 py-0.5 text-[10px] font-bold text-green-400">
          Claimed
        </span>
        {hash && (
          <a
            href={`${EXPLORER_TX_URL}${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gold/70 hover:text-gold hover:underline"
          >
            TX
          </a>
        )}
      </div>
    );
  }

  if (claimable <= 0) return null;

  function handleClaim() {
    const battleBytes = battleIdToBytes32(battleId);
    writeContract({
      address: BETTING_ADDRESS,
      abi: [{
        name: 'claimPrize',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'battleId', type: 'bytes32' }],
        outputs: [],
      }],
      functionName: 'claimPrize',
      args: [battleBytes],
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClaim}
        disabled={isPending}
        className="rounded border border-gold/40 bg-gold/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
            Claiming...
          </span>
        ) : (
          `Claim ${claimable.toFixed(2)} MON`
        )}
      </button>
      {error && (
        <span className="text-[9px] text-blood">
          {error.message?.includes('AlreadyClaimed') ? 'Already claimed' : 'Claim failed'}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BetsPage() {
  const { address, isConnected } = useAccount();

  const { data, loading, error } = useFetch<UserBetsResponse>(
    `/user/${address}/bets`,
    { skip: !isConnected || !address },
  );

  const bets = useMemo(() => data?.bets ?? [], [data?.bets]);

  const stats = useMemo(() => {
    if (bets.length === 0) return null;
    const totalWagered = bets.reduce((s, b) => s + b.amount, 0);
    const totalPayout = bets.filter((b) => b.settled).reduce((s, b) => s + b.payout, 0);
    const wins = bets.filter((b) => b.settled && b.payout > 0).length;
    const settled = bets.filter((b) => b.settled).length;
    return {
      totalBets: bets.length,
      totalWagered,
      totalPayout,
      profit: totalPayout - bets.filter((b) => b.settled).reduce((s, b) => s + b.amount, 0),
      wins,
      winRate: settled > 0 ? wins / settled : 0,
      pending: bets.filter((b) => !b.settled).length,
      claimable: bets.filter((b) => b.settled && b.payout > 0).length,
    };
  }, [bets]);

  // Group won bets that may need claiming
  const claimableBattleIds = useMemo(() => {
    const ids = new Set<string>();
    bets.filter((b) => b.settled && b.payout > 0).forEach((b) => ids.add(b.battle_id));
    return Array.from(ids);
  }, [bets]);

  // ── Not connected ──
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <Coins className="h-12 w-12 text-gray-700" />
        <h1 className="font-cinzel text-xl font-bold uppercase tracking-widest text-gray-400">
          Connect wallet to view bets
        </h1>
        <ConnectButton />
      </div>
    );
  }

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
          <span className="text-xs text-gray-400">My Bets</span>
        </div>

        <h1 className="font-cinzel text-2xl font-black uppercase tracking-widest text-gold sm:text-3xl">
          My Bets
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Your wagering history across all battles.
        </p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total bets" value={String(stats.totalBets)} />
          <StatCard
            label="Wagered"
            value={`${stats.totalWagered.toFixed(0)} $HNADS`}
          />
          <StatCard
            label="Profit"
            value={`${stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(0)}`}
            valueClass={stats.profit >= 0 ? 'text-green-400' : 'text-blood'}
          />
          <StatCard
            label="Win rate"
            value={`${(stats.winRate * 100).toFixed(0)}%`}
            sub={`${stats.wins}W / ${stats.totalBets - stats.wins - stats.pending}L`}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-blood/30 bg-blood/10 px-4 py-2 text-sm text-blood">
          Failed to load bets: {error}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="py-12 text-center text-sm text-gray-600 animate-pulse">
          Loading your bets...
        </div>
      )}

      {/* Empty state */}
      {!loading && bets.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16">
          <Coins className="h-10 w-10 text-gray-700" />
          <p className="text-sm text-gray-600">No bets placed yet.</p>
          <Link
            href="/"
            className="rounded bg-gold/20 px-4 py-2 text-xs font-bold text-gold transition-colors hover:bg-gold/30"
          >
            Go to Arena
          </Link>
        </div>
      )}

      {/* Bets list */}
      {bets.length > 0 && (
        <div className="card divide-y divide-colosseum-surface-light">
          {bets.map((bet) => {
            const cfg = bet.agent_class ? CLASS_CONFIG[bet.agent_class] : null;
            const won = bet.settled && bet.payout > 0;

            return (
              <div
                key={bet.id}
                className="flex items-center justify-between px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {cfg && (
                    <AgentPortrait
                      image={cfg.image}
                      emoji={cfg.emoji}
                      alt={bet.agent_name ?? bet.agent_id}
                      size="w-6 h-6"
                      className="text-base"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate">
                        {bet.agent_name ?? bet.agent_id.slice(0, 8)}
                      </span>
                      {cfg && (
                        <span className={cfg.badgeClass}>{bet.agent_class}</span>
                      )}
                    </div>
                    <Link
                      href={`/battle/${bet.battle_id}`}
                      className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-600 hover:text-gold transition-colors"
                    >
                      Battle {bet.battle_id.slice(0, 8)}
                      <ExternalLink size={10} />
                    </Link>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-gray-400">
                      {bet.amount.toFixed(0)} $HNADS
                    </div>
                    {bet.settled && (
                      <div
                        className={`text-[10px] ${won ? 'text-green-400' : 'text-blood'}`}
                      >
                        {won
                          ? `+${bet.payout.toFixed(0)}`
                          : `-${bet.amount.toFixed(0)}`}
                      </div>
                    )}
                  </div>

                  {/* Status badge or claim button */}
                  {won ? (
                    <ClaimButton battleId={bet.battle_id} />
                  ) : (
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        !bet.settled
                          ? 'bg-gold/20 text-gold'
                          : 'bg-blood/20 text-blood'
                      }`}
                    >
                      {!bet.settled ? 'Active' : 'Lost'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-600">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-bold ${valueClass ?? 'text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-600">{sub}</div>}
    </div>
  );
}
