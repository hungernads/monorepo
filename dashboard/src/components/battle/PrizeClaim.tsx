"use client";

/**
 * HUNGERNADS - Prize Claim / Victory Component
 *
 * Unified post-battle display:
 *   - VICTORY header with winner portrait
 *   - Prize amount and on-chain tx proof links
 *   - Claim button for users with claimable betting prizes
 *   - Final standings for all agents
 *   - Share button
 */

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther } from "viem";
import {
  useBattlePool,
  useClaimable,
  useClaimed,
  useClaimPrize,
} from "@/lib/contracts";
import { BETTING_ADDRESS, EXPLORER_TX_URL, EXPLORER_ADDRESS_URL } from "@/lib/wallet";
import { CLASS_CONFIG } from "./mock-data";
import AgentPortrait from "./AgentPortrait";
import type { BattleAgent } from "./mock-data";
import type { AgentClass } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WinnerInfo {
  winnerId: string;
  winnerName: string;
  totalEpochs: number;
  reason?: string;
  settlementTxs?: {
    recordResult?: string;
    settleBets?: string;
    distributePrize?: string;
  };
}

export interface SettlementTxs {
  recordResult?: string;
  settleBets?: string;
  distributePrize?: string;
  prizes?: Array<{
    type: string;
    recipient: string;
    amount: string;
    txHash: string;
    success: boolean;
  }>;
}

interface PrizeClaimProps {
  battleId: string;
  winner: WinnerInfo;
  agents: BattleAgent[];
  settlementTxs?: SettlementTxs;
  shareButton?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TxProofLink({ hash, label }: { hash: string; label: string }) {
  const short = `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  return (
    <a
      href={`${EXPLORER_TX_URL}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded border border-gold/30 bg-gold/10 px-3 py-1.5 font-mono text-[10px] text-gold transition-colors hover:bg-gold/20 hover:text-gold"
    >
      <span className="text-gold/60">{label}</span>
      <span>{short}</span>
      <svg className="h-3 w-3 text-gold/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

/** Compact final standings table sorted by placement */
function FinalStandings({ agents, winnerId }: { agents: BattleAgent[]; winnerId: string }) {
  const sorted = [...agents].sort((a, b) => {
    if (a.id === winnerId) return -1;
    if (b.id === winnerId) return 1;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive && b.alive) return b.hp - a.hp;
    return b.kills - a.kills;
  });

  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">
        Final Standings
      </h3>
      {sorted.map((agent, i) => {
        const cfg = CLASS_CONFIG[agent.class as AgentClass] ?? CLASS_CONFIG.WARRIOR;
        const isWinner = agent.id === winnerId;
        return (
          <div
            key={agent.id}
            className={`flex items-center justify-between rounded border px-3 py-2 text-xs ${
              isWinner
                ? "border-gold/30 bg-gold/5"
                : agent.alive
                  ? "border-colosseum-surface-light bg-colosseum-surface"
                  : "border-colosseum-surface-light/50 bg-colosseum-bg/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-5 text-center text-[10px] font-bold ${
                  isWinner ? "text-gold" : "text-gray-600"
                }`}
              >
                #{i + 1}
              </span>
              <AgentPortrait
                image={cfg.image}
                emoji={cfg.emoji}
                alt={agent.name}
                size="w-6 h-6"
                className="text-base"
              />
              <div>
                <span className={`font-bold ${isWinner ? "text-gold" : agent.alive ? "text-white" : "text-gray-500"}`}>
                  {agent.name}
                </span>
                <span className="ml-1.5 text-[10px] text-gray-600">{agent.class}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-right">
              <span className="text-[10px] text-gray-500">
                {agent.kills > 0 ? `${agent.kills} kill${agent.kills > 1 ? "s" : ""}` : ""}
              </span>
              {isWinner ? (
                <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                  VICTOR
                </span>
              ) : agent.alive ? (
                <span className="text-[10px] text-gray-400">{agent.hp} HP</span>
              ) : (
                <span className="text-[10px] font-bold tracking-wider text-blood/60">
                  REKT
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PrizeClaim({ battleId, winner, agents, settlementTxs, shareButton }: PrizeClaimProps) {
  const { address, isConnected } = useAccount();

  // On-chain reads (for betting prize claims)
  const { data: totalPoolRaw } = useBattlePool(battleId);
  const { data: claimableRaw, refetch: refetchClaimable } = useClaimable(battleId);
  const { data: alreadyClaimed, refetch: refetchClaimed } = useClaimed(battleId);

  // Claim write
  const { claim, isPending: isClaiming, isSuccess: claimSuccess, error: claimError, hash } = useClaimPrize();

  // Refresh claimed status after successful claim
  useEffect(() => {
    if (claimSuccess) {
      const timer = setTimeout(() => {
        refetchClaimable();
        refetchClaimed();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [claimSuccess, refetchClaimable, refetchClaimed]);

  // Format amounts
  const totalPool = totalPoolRaw ? Number(formatEther(totalPoolRaw)) : 0;
  const claimableAmount = claimableRaw ? Number(formatEther(claimableRaw)) : 0;
  const hasClaimable = claimableAmount > 0;
  const hasClaimed = alreadyClaimed === true || claimSuccess;

  // Winner agent config
  const winnerAgent = agents.find((a) => a.id === winner.winnerId);
  const winnerCfg = winnerAgent
    ? CLASS_CONFIG[winnerAgent.class as AgentClass] ?? CLASS_CONFIG.WARRIOR
    : CLASS_CONFIG.WARRIOR;

  const isMutualRekt = winner.reason?.toLowerCase().includes("mutual rekt");

  // Merge settlement txs from props and winner event
  const txs = settlementTxs ?? winner.settlementTxs;
  const distributeTxHash = txs?.distributePrize;
  const recordTxHash = txs?.recordResult;

  // Claim tx explorer link
  const claimExplorerUrl = hash ? `${EXPLORER_TX_URL}${hash}` : null;

  return (
    <div className="mb-3 space-y-4 sm:mb-4">
      {/* ── Victory Banner ── */}
      <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-center sm:p-4">
        <div className="font-cinzel text-xl font-black tracking-widest text-gold sm:text-2xl">
          {isMutualRekt ? "ALL REKT" : "VICTORY"}
        </div>

        <div className="mt-3 flex items-center justify-center gap-3">
          <AgentPortrait
            image={winnerCfg.image}
            emoji={winnerCfg.emoji}
            alt={winner.winnerName}
            size="w-14 h-14 sm:w-16 sm:h-16"
            className="text-4xl ring-2 ring-gold/40"
          />
          <div className="text-left">
            <div className="text-sm font-bold text-white sm:text-base">
              {winner.winnerName}
            </div>
            <div className="text-[10px] text-gray-400 sm:text-xs">
              {isMutualRekt
                ? `Wins by tiebreak after ${winner.totalEpochs} epochs!`
                : `Last nad standing after ${winner.totalEpochs} epoch${winner.totalEpochs !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>

        {winner.reason && (
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-gold/70 sm:text-xs">
            {winner.reason}
          </div>
        )}

        {/* Prize amount */}
        {totalPool > 0 && (
          <div className="mt-3 text-xs text-gray-400">
            Prize Pool: <span className="font-bold text-gold">{totalPool.toFixed(4)} MON</span>
            <span className="ml-2 text-gray-600">
              (Winner: {(totalPool * 0.8).toFixed(4)} MON)
            </span>
          </div>
        )}

        {/* Action row: tx proofs + share — all as aligned pill buttons */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {distributeTxHash && (
            <TxProofLink hash={distributeTxHash} label="Payout" />
          )}
          {recordTxHash && (
            <TxProofLink hash={recordTxHash} label="Result" />
          )}
          {shareButton}
        </div>
      </div>

      {/* ── Betting Prize Claim ── */}
      {isConnected && hasClaimable && !hasClaimed && (
        <div className="rounded-lg border border-gold/30 bg-colosseum-surface p-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-600">
            Your Claimable Bet Prize
          </div>
          <div className="mt-1 text-2xl font-bold text-gold">
            {claimableAmount.toFixed(4)} MON
          </div>
          <button
            onClick={() => claim({ battleId })}
            disabled={isClaiming}
            className="mt-3 w-full rounded border border-gold/40 bg-gold/15 py-3 text-sm font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isClaiming ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                Claiming...
              </span>
            ) : (
              "Claim Prize"
            )}
          </button>
          {claimError && (
            <div className="mt-2 rounded border border-blood/30 bg-blood/10 px-3 py-2 text-[10px] text-blood">
              {claimError.message?.includes("AlreadyClaimed")
                ? "Prize already claimed."
                : claimError.message?.includes("NothingToClaim")
                  ? "No claimable prize found."
                  : `Error: ${claimError.message?.slice(0, 100) ?? "Transaction failed"}`}
            </div>
          )}
          <div className="mt-2 text-[9px] text-gray-700">
            Contract:{" "}
            <a
              href={`${EXPLORER_ADDRESS_URL}${BETTING_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-gray-600 underline decoration-gray-700 hover:text-gray-400"
            >
              {BETTING_ADDRESS.slice(0, 8)}...{BETTING_ADDRESS.slice(-6)}
            </a>
          </div>
        </div>
      )}

      {isConnected && hasClaimed && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-center">
          <div className="text-sm font-bold text-green-400">
            Bet Prize Claimed
          </div>
          {claimExplorerUrl && (
            <a
              href={claimExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-[10px] text-gold/80 underline decoration-gold/30 hover:text-gold"
            >
              View claim transaction
            </a>
          )}
        </div>
      )}

      {!isConnected && (
        <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-surface p-3 text-center">
          <div className="text-[10px] text-gray-500">
            Connect wallet to check your bet prizes
          </div>
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button
                onClick={openConnectModal}
                className="mt-2 rounded border border-gold/30 bg-gold/10 px-6 py-2 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98]"
              >
                Connect Wallet
              </button>
            )}
          </ConnectButton.Custom>
        </div>
      )}

      {/* ── Final Standings ── */}
      <FinalStandings agents={agents} winnerId={winner.winnerId} />
    </div>
  );
}
