"use client";

import { useMemo } from "react";
import type { AgentState, AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";
import { EXPLORER_TX_URL } from "@/lib/wallet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettledBet {
  id: string;
  agent_id: string;
  agentName: string;
  agentClass?: AgentClass;
  amount: number;
  payout: number;
  settled: boolean;
}

interface WinnerInfo {
  winnerId: string;
  winnerName: string;
  totalEpochs: number;
}

export interface SettlementTxs {
  recordResult?: string;
  settleBets?: string;
  prizes?: Array<{
    type: string;
    recipient: string;
    amount: string;
    txHash: string;
    success: boolean;
    agentId?: string;
    agentName?: string;
  }>;
}

interface SettlementViewProps {
  winner: WinnerInfo;
  agents: AgentState[];
  bets: SettledBet[];
  totalPool: number;
  settlementTxs?: SettlementTxs;
}

const EXPLORER_URL = EXPLORER_TX_URL;

function TxLink({ hash, label }: { hash: string; label: string }) {
  const short = `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] text-gray-500">{label}</span>
      <a
        href={`${EXPLORER_URL}${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[10px] text-accent hover:text-accent/80 hover:underline"
      >
        {short}
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettlementView({
  winner,
  agents,
  bets,
  totalPool,
  settlementTxs,
}: SettlementViewProps) {
  const winnerAgent = agents.find((a) => a.id === winner.winnerId);
  const winnerCfg = winnerAgent
    ? CLASS_CONFIG[winnerAgent.class]
    : CLASS_CONFIG.WARRIOR;

  // Calculate settlement for each bet
  const settledBets = useMemo(() => {
    return bets.map((bet) => {
      const isWinningBet = bet.agent_id === winner.winnerId;
      return {
        ...bet,
        won: isWinningBet,
        // If payout was already calculated by API, use it; otherwise estimate
        actualPayout: isWinningBet ? bet.payout || bet.amount * 2 : 0,
      };
    });
  }, [bets, winner.winnerId]);

  const totalWagered = settledBets.reduce((sum, b) => sum + b.amount, 0);
  const totalPayout = settledBets.reduce((sum, b) => sum + b.actualPayout, 0);
  const netResult = totalPayout - totalWagered;
  const hasWinningBets = settledBets.some((b) => b.won);

  const hasTxs =
    settlementTxs?.recordResult ||
    settlementTxs?.settleBets ||
    (settlementTxs?.prizes && settlementTxs.prizes.some((p) => p.txHash));

  return (
    <div className="space-y-4">
      {/* Winner banner */}
      <div className="relative overflow-hidden rounded-lg border border-gold/30 bg-gradient-to-br from-gold/10 via-colosseum-surface to-gold/5 p-4 text-center">
        {/* Background glow effect */}
        <div className="absolute inset-0 bg-gradient-to-t from-gold/5 to-transparent" />

        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.3em] text-gold/60">
            Battle Complete
          </div>
          <div className="mt-1 flex items-center justify-center gap-2">
            <AgentPortrait
              image={winnerCfg.image}
              emoji={winnerCfg.emoji}
              alt={winner.winnerName}
              size="w-8 h-8"
              className="text-2xl"
            />
            <span className="font-cinzel text-xl font-black tracking-wider text-gold">
              {winner.winnerName}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            Last nad standing after {winner.totalEpochs} epochs
          </div>
          <div className="mt-2 text-[10px] text-gray-600">
            Total pool:{" "}
            <span className="font-bold text-gold">
              {totalPool.toFixed(0)} $HNADS
            </span>
          </div>
        </div>
      </div>

      {/* On-Chain Settlement */}
      {hasTxs && (
        <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg/50 p-3">
          <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
            On-Chain Settlement
          </h3>
          <div className="divide-y divide-colosseum-surface-light">
            {settlementTxs?.recordResult && (
              <TxLink hash={settlementTxs.recordResult} label="Record Result" />
            )}
            {settlementTxs?.settleBets && (
              <TxLink hash={settlementTxs.settleBets} label="Settle Bets" />
            )}
            {settlementTxs?.prizes
              ?.filter((p) => p.txHash && p.success)
              .map((p, i) => (
                <TxLink
                  key={i}
                  hash={p.txHash}
                  label={
                    p.type === "burn_hnads"
                      ? "Burn $HNADS"
                      : p.type === "treasury_hnads"
                        ? "Treasury"
                        : p.type === "withdraw_mon"
                          ? `Winner Payout`
                          : p.agentName
                            ? `${p.type === "kill_bonus" ? "Kill" : "Survival"} Bonus: ${p.agentName}`
                            : p.type
                  }
                />
              ))}
          </div>
        </div>
      )}

      {/* Your results */}
      {settledBets.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-gray-500">
            Your Results
          </h3>

          {/* Net result banner */}
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-center ${
              netResult > 0
                ? "border-green-500/30 bg-green-500/10"
                : netResult < 0
                  ? "border-blood/30 bg-blood/10"
                  : "border-colosseum-surface-light bg-colosseum-bg/50"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              {netResult > 0
                ? "Profit"
                : netResult < 0
                  ? "Loss"
                  : "Break Even"}
            </div>
            <div
              className={`text-lg font-bold ${
                netResult > 0
                  ? "text-green-400"
                  : netResult < 0
                    ? "text-blood"
                    : "text-gray-400"
              }`}
            >
              {netResult > 0 ? "+" : ""}
              {netResult.toFixed(2)} $HNADS
            </div>
            <div className="mt-0.5 text-[10px] text-gray-600">
              Wagered: {totalWagered.toFixed(0)} | Returned:{" "}
              {totalPayout.toFixed(0)}
            </div>
          </div>

          {/* Individual bets */}
          <div className="space-y-1.5">
            {settledBets.map((bet) => {
              const cfg = bet.agentClass
                ? CLASS_CONFIG[bet.agentClass]
                : null;
              return (
                <div
                  key={bet.id}
                  className={`flex items-center justify-between rounded border px-3 py-2 text-xs ${
                    bet.won
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-blood/20 bg-blood/5"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {cfg && (
                      <AgentPortrait
                        image={cfg.image}
                        emoji={cfg.emoji}
                        alt={bet.agentName}
                        size="w-5 h-5"
                        className="text-sm"
                      />
                    )}
                    <div>
                      <span className="font-bold text-white">
                        {bet.agentName}
                      </span>
                      <span className="ml-2 text-gray-500">
                        {bet.amount} $HNADS
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    {bet.won ? (
                      <div>
                        <span className="font-bold text-green-400">WON</span>
                        <div className="text-[10px] text-green-400/80">
                          +{(bet.actualPayout - bet.amount).toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <span className="font-bold text-blood">LOST</span>
                        <div className="text-[10px] text-blood/80">
                          -{bet.amount.toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded border border-colosseum-surface-light bg-colosseum-bg/30 p-4 text-center">
          <p className="text-xs text-gray-600">
            You did not place any bets this battle
          </p>
          <p className="mt-1 text-[10px] text-gray-700">
            Next time, may the odds be in your favor
          </p>
        </div>
      )}

      {/* Dramatic footer */}
      {hasWinningBets && (
        <div className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-center">
          <div className="text-xs font-bold text-gold">
            THE CROWD REMEMBERS YOUR FORESIGHT
          </div>
          <div className="mt-0.5 text-[10px] text-gray-600">
            Your winning streak continues
          </div>
        </div>
      )}

      {/* Prize Distribution (on-chain proof) */}
      {prizeData?.transactions && prizeData.transactions.length > 0 && (
        <div className="border-t border-colosseum-surface-light pt-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-gray-500">
            Prize Distribution
          </h3>

          {/* Summary */}
          <div className="mb-3 rounded border border-colosseum-surface-light bg-colosseum-bg/30 p-2 text-[10px]">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-600">Total Pool:</span>
                <span className="ml-1 font-bold text-white">{totalPool.toFixed(0)} $HNADS</span>
              </div>
              <div>
                <span className="text-gray-600">Burned:</span>
                <span className="ml-1 font-bold text-blood">
                  {prizeData.transactions
                    .filter((t) => t.type === 'BURN' && t.success)
                    .reduce((sum, t) => sum + t.amount, 0)
                    .toFixed(0)} $HNADS
                </span>
              </div>
            </div>
          </div>

          {/* Transaction list */}
          <div className="space-y-1.5">
            {prizeData.transactions.map((tx, idx) => {
              const typeColors: Record<string, string> = {
                BURN: 'bg-blood/20 text-blood',
                TREASURY: 'bg-gold/20 text-gold',
                MON_WITHDRAWAL: 'bg-purple-500/20 text-purple-400',
                KILL_BONUS: 'bg-green-500/20 text-green-400',
                SURVIVAL_BONUS: 'bg-blue-500/20 text-blue-400',
              };
              const typeColor = typeColors[tx.type] ?? 'bg-gray-500/20 text-gray-400';

              return (
                <div
                  key={idx}
                  className={`rounded border px-2 py-1.5 text-xs ${
                    tx.success
                      ? 'border-colosseum-surface-light bg-colosseum-bg/50'
                      : 'border-blood/30 bg-blood/5 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${typeColor}`}>
                        {tx.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-gray-500">
                        {tx.recipient.slice(0, 6)}...{tx.recipient.slice(-4)}
                      </span>
                    </div>
                    <span className="font-bold text-white">
                      {tx.amount.toFixed(0)} $HNADS
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-600">
                    <a
                      href={`https://testnet.monadexplorer.com/tx/${tx.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-gold transition-colors underline"
                    >
                      {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-8)}
                    </a>
                    <span className={tx.success ? 'text-green-500' : 'text-blood'}>
                      {tx.success ? '✓ Success' : '✗ Failed'}
                    </span>
                  </div>
                  {tx.error && (
                    <div className="mt-0.5 text-[9px] text-blood/80">
                      Error: {tx.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
