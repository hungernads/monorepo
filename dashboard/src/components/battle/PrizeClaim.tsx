"use client";

/**
 * HUNGERNADS - Prize Claim Component
 *
 * Displayed after a battle completes. Shows:
 *   - Winner announcement with portrait
 *   - Total pool and winner share breakdown
 *   - Claim button for users with claimable prizes (calls HungernadsBetting.claimPrize)
 *   - Final standings for all agents
 *   - "Already claimed" state when prize has been collected
 *   - Wallet connect prompt if not connected
 */

import { useEffect } from "react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { formatEther } from "viem";
import {
  useBattlePool,
  useClaimable,
  useClaimed,
  useClaimPrize,
} from "@/lib/contracts";
import { BETTING_ADDRESS } from "@/lib/wallet";
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
}

interface PrizeClaimProps {
  battleId: string;
  winner: WinnerInfo;
  agents: BattleAgent[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Compact final standings table sorted by placement */
function FinalStandings({ agents, winnerId }: { agents: BattleAgent[]; winnerId: string }) {
  // Sort: winner first, then alive agents by HP desc, then dead agents by kill count desc
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

export default function PrizeClaim({ battleId, winner, agents }: PrizeClaimProps) {
  const { address, isConnected } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();

  // On-chain reads
  const { data: totalPoolRaw } = useBattlePool(battleId);
  const { data: claimableRaw, refetch: refetchClaimable } = useClaimable(battleId);
  const { data: alreadyClaimed, refetch: refetchClaimed } = useClaimed(battleId);

  // Claim write
  const { claim, isPending: isClaiming, isSuccess: claimSuccess, error: claimError, hash } = useClaimPrize();

  // Refresh claimed status after successful claim
  useEffect(() => {
    if (claimSuccess) {
      // Small delay for chain confirmation
      const timer = setTimeout(() => {
        refetchClaimable();
        refetchClaimed();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [claimSuccess, refetchClaimable, refetchClaimed]);

  // Format amounts from wei to human-readable
  const totalPool = totalPoolRaw ? Number(formatEther(totalPoolRaw)) : 0;
  const claimableAmount = claimableRaw ? Number(formatEther(claimableRaw)) : 0;
  const hasClaimable = claimableAmount > 0;
  const hasClaimed = alreadyClaimed === true || claimSuccess;

  // Winner agent config for portrait
  const winnerAgent = agents.find((a) => a.id === winner.winnerId);
  const winnerCfg = winnerAgent
    ? CLASS_CONFIG[winnerAgent.class as AgentClass] ?? CLASS_CONFIG.WARRIOR
    : CLASS_CONFIG.WARRIOR;

  // Explorer link for claim tx
  const explorerTxUrl = hash
    ? `https://testnet.monadexplorer.com/tx/${hash}`
    : null;

  return (
    <div className="space-y-4">
      {/* Winner spotlight */}
      <div className="relative overflow-hidden rounded-lg border border-gold/30 bg-gradient-to-br from-gold/10 via-colosseum-surface to-gold/5 p-4 text-center">
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-t from-gold/5 to-transparent" />

        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.3em] text-gold/60">
            The Arena Has Spoken
          </div>
          <div className="mt-2 flex items-center justify-center gap-3">
            <AgentPortrait
              image={winnerCfg.image}
              emoji={winnerCfg.emoji}
              alt={winner.winnerName}
              size="w-12 h-12"
              className="text-3xl"
            />
            <div className="text-left">
              <div className="font-cinzel text-xl font-black tracking-wider text-gold">
                {winner.winnerName}
              </div>
              <div className="text-[10px] text-gray-500">
                Last nad standing after {winner.totalEpochs} epoch{winner.totalEpochs !== 1 ? "s" : ""}
              </div>
            </div>
          </div>

          {/* Pool breakdown */}
          {totalPool > 0 && (
            <div className="mt-4 flex justify-center gap-6 text-xs">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-gray-600">
                  Total Pool
                </div>
                <div className="font-bold text-white">
                  {totalPool.toFixed(4)} MON
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-gray-600">
                  Winner Share (85%)
                </div>
                <div className="font-bold text-gold">
                  {(totalPool * 0.85).toFixed(4)} MON
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Claim section */}
      {isConnected ? (
        <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-surface p-4">
          {hasClaimed ? (
            /* Already claimed */
            <div className="text-center">
              <div className="text-sm font-bold text-green-400">
                Prize Claimed
              </div>
              <div className="mt-1 text-[10px] text-gray-500">
                Your winnings have been sent to your wallet.
              </div>
              {explorerTxUrl && (
                <a
                  href={explorerTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[10px] text-gold/80 underline decoration-gold/30 transition-colors hover:text-gold"
                >
                  View transaction on explorer
                </a>
              )}
            </div>
          ) : hasClaimable ? (
            /* Has unclaimed prize */
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-gray-600">
                Your Claimable Prize
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
                  href={`https://testnet.monadexplorer.com/address/${BETTING_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-gray-600 underline decoration-gray-700 hover:text-gray-400"
                >
                  {BETTING_ADDRESS.slice(0, 8)}...{BETTING_ADDRESS.slice(-6)}
                </a>
              </div>
            </div>
          ) : (
            /* No claimable prize (spectator or losing bettor) */
            <div className="text-center">
              <div className="text-xs text-gray-500">
                No claimable prizes for this battle.
              </div>
              <div className="mt-1 text-[10px] text-gray-700">
                Better luck next time, nad.
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Wallet not connected */
        <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-surface p-4 text-center">
          <div className="text-xs text-gray-500">
            Connect wallet to check your prizes
          </div>
          <button
            onClick={() => connect({ connector: injected() })}
            disabled={isConnecting}
            className="mt-2 rounded border border-gold/30 bg-gold/10 px-6 py-2 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98] disabled:opacity-60"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      )}

      {/* Final standings */}
      <FinalStandings agents={agents} winnerId={winner.winnerId} />
    </div>
  );
}
