/**
 * HUNGERNADS - Prize Distribution System
 *
 * Orchestrates winner payouts and token operations on battle completion.
 * Called from the Arena Durable Object when a battle ends.
 *
 * Prize flow:
 *   1. Calculate distribution from tier config (calculatePrizePool)
 *   2. Burn 50% of collected $HNADS (on-chain: burnHnads)
 *   3. Transfer 50% of $HNADS to treasury (on-chain: transferHnadsToTreasury)
 *   4. Withdraw MON fees to owner/treasury (on-chain: withdrawFees)
 *   5. Award per-kill $HNADS bonuses (on-chain: awardKillBonus)
 *   6. Award survival $HNADS bonuses (on-chain: awardSurvivalBonus)
 *   7. Return distribution summary for broadcasting + D1 persistence
 *
 * All on-chain calls are non-blocking (fire-and-forget pattern).
 * Chain failures are logged but never block battle completion.
 */

import type { Address, Hash } from 'viem';
import type { HungernadsChainClient } from '../chain/client';
import {
  type LobbyTier,
  calculatePrizePool,
  getKillBonus,
  getSurvivalBonus,
  getTierConfig,
} from './tiers';

// ─── Types ──────────────────────────────────────────────────────────

/** Agent info needed for prize distribution. */
export interface PayoutAgent {
  id: string;
  name: string;
  class: string;
  kills: number;
  epochsSurvived: number;
  isAlive: boolean;
  isWinner: boolean;
  /** Wallet address to receive rewards (may be ephemeral). */
  walletAddress?: string;
}

/** Result of a single on-chain payout operation. */
export interface PayoutTx {
  type: 'burn_hnads' | 'treasury_hnads' | 'withdraw_mon' | 'kill_bonus' | 'survival_bonus';
  /** Target address (burn address, treasury, or agent wallet). */
  recipient: string;
  /** Amount as a human-readable string. */
  amount: string;
  /** On-chain tx hash (empty string if tx failed or was skipped). */
  txHash: string;
  /** Whether the on-chain call succeeded. */
  success: boolean;
  /** Error message if the call failed. */
  error?: string;
  /** Agent ID this payout is for (only for kill/survival bonuses). */
  agentId?: string;
  /** Agent name for display. */
  agentName?: string;
}

/** Full prize distribution result for a completed battle. */
export interface PrizeDistribution {
  battleId: string;
  tier: LobbyTier;
  playerCount: number;
  winnerId: string | null;
  winnerName: string | null;
  /** Calculated pool breakdown (from tiers.ts). */
  pool: {
    totalMon: string;
    winnerPayout: string;
    treasuryMon: string;
    totalHnads: string;
    hnadsBurned: string;
    hnadsTreasury: string;
  };
  /** Individual kill bonuses (per agent). */
  killBonuses: { agentId: string; agentName: string; kills: number; bonusHnads: string }[];
  /** Survival bonuses (for agents alive past threshold). */
  survivalBonuses: { agentId: string; agentName: string; bonusHnads: string }[];
  /** On-chain transaction results. */
  transactions: PayoutTx[];
  /** ISO timestamp of distribution. */
  distributedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────

/** Survival bonus epoch threshold (agents must survive >= this many epochs). */
const SURVIVAL_BONUS_EPOCH_THRESHOLD = 50;

/** $HNADS uses 18 decimals (standard ERC20). */
const HNADS_DECIMALS = 18;

// ─── Core Function ──────────────────────────────────────────────────

/**
 * Distribute prizes for a completed battle.
 *
 * Calculates the prize pool from the tier configuration and executes
 * on-chain operations to burn HNADS, transfer to treasury, withdraw
 * MON fees, and award per-agent bonuses.
 *
 * All on-chain calls are best-effort: failures are captured in the
 * PrizeDistribution result but never throw. The caller should log
 * failures and optionally retry specific operations.
 *
 * @param battleId - The completed battle's ID
 * @param tier - Lobby tier (determines prize pool sizes)
 * @param agents - All agents that participated in the battle
 * @param winnerId - Winner's agent ID (null if no winner)
 * @param chainClient - On-chain client (null = skip all chain calls)
 * @returns PrizeDistribution summary for broadcasting and D1 storage
 */
export async function distributePrizes(
  battleId: string,
  tier: LobbyTier,
  agents: PayoutAgent[],
  winnerId: string | null,
  chainClient: HungernadsChainClient | null,
): Promise<PrizeDistribution> {
  const playerCount = agents.length;
  const tierConfig = getTierConfig(tier);

  // ── Calculate pool breakdown ────────────────────────────────────
  const pool = calculatePrizePool(tier, playerCount);

  const winnerAgent = winnerId
    ? agents.find((a) => a.id === winnerId) ?? null
    : null;

  const transactions: PayoutTx[] = [];

  // ── Skip on-chain operations for FREE tier (no fees collected) ──
  const isFree = tier === 'FREE';

  // ── Step 1: Burn 50% of $HNADS fees ────────────────────────────
  if (!isFree && chainClient && parseFloat(pool.hnadsBurned) > 0) {
    const tx = await safeChainCall(
      () => chainClient.burnHnads(battleId),
      'burn_hnads',
      '0xdEaD',
      pool.hnadsBurned,
    );
    transactions.push(tx);
  }

  // ── Step 2: Transfer 50% of $HNADS to treasury ─────────────────
  if (!isFree && chainClient && parseFloat(pool.hnadsTreasury) > 0) {
    const tx = await safeChainCall(
      () => chainClient.transferHnadsToTreasury(battleId),
      'treasury_hnads',
      'treasury',
      pool.hnadsTreasury,
    );
    transactions.push(tx);
  }

  // ── Step 3: Withdraw MON fees to owner ─────────────────────────
  if (!isFree && chainClient && parseFloat(pool.totalMon) > 0) {
    const tx = await safeChainCall(
      () => chainClient.withdrawFees(battleId),
      'withdraw_mon',
      'owner',
      pool.totalMon,
    );
    transactions.push(tx);
  }

  // ── Step 4: Award per-kill $HNADS bonuses ──────────────────────
  const killBonusPerKill = getKillBonus(tier);
  const killBonuses: PrizeDistribution['killBonuses'] = [];

  if (killBonusPerKill > 0) {
    for (const agent of agents) {
      if (agent.kills <= 0) continue;

      const totalBonus = killBonusPerKill * agent.kills;
      killBonuses.push({
        agentId: agent.id,
        agentName: agent.name,
        kills: agent.kills,
        bonusHnads: totalBonus.toString(),
      });

      // Award on-chain if agent has a wallet
      if (chainClient && agent.walletAddress) {
        const amountWei = BigInt(totalBonus) * (10n ** BigInt(HNADS_DECIMALS));
        const tx = await safeChainCall(
          () => chainClient.awardKillBonus(agent.walletAddress as Address, amountWei),
          'kill_bonus',
          agent.walletAddress,
          totalBonus.toString(),
          agent.id,
          agent.name,
        );
        transactions.push(tx);
      }
    }
  }

  // ── Step 5: Award survival $HNADS bonuses ──────────────────────
  const survivalBonusAmount = getSurvivalBonus(tier);
  const survivalBonuses: PrizeDistribution['survivalBonuses'] = [];

  if (survivalBonusAmount > 0) {
    for (const agent of agents) {
      // Must be alive and have survived past the threshold
      if (!agent.isAlive || agent.epochsSurvived < SURVIVAL_BONUS_EPOCH_THRESHOLD) continue;

      survivalBonuses.push({
        agentId: agent.id,
        agentName: agent.name,
        bonusHnads: survivalBonusAmount.toString(),
      });

      // Award on-chain if agent has a wallet
      if (chainClient && agent.walletAddress) {
        const amountWei = BigInt(survivalBonusAmount) * (10n ** BigInt(HNADS_DECIMALS));
        const tx = await safeChainCall(
          () => chainClient.awardSurvivalBonus(agent.walletAddress as Address, amountWei),
          'survival_bonus',
          agent.walletAddress,
          survivalBonusAmount.toString(),
          agent.id,
          agent.name,
        );
        transactions.push(tx);
      }
    }
  }

  // ── Build result summary ────────────────────────────────────────
  const distribution: PrizeDistribution = {
    battleId,
    tier,
    playerCount,
    winnerId,
    winnerName: winnerAgent?.name ?? null,
    pool,
    killBonuses,
    survivalBonuses,
    transactions,
    distributedAt: new Date().toISOString(),
  };

  // Log summary
  const successCount = transactions.filter((t) => t.success).length;
  const failCount = transactions.filter((t) => !t.success).length;
  console.log(
    `[Payouts] Battle ${battleId.slice(0, 8)} (${tier}): ` +
    `${playerCount} players, ${killBonuses.length} kill bonuses, ${survivalBonuses.length} survival bonuses. ` +
    `Chain txs: ${successCount} ok, ${failCount} failed.`,
  );

  return distribution;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Execute an on-chain call with error capture. Never throws.
 * Returns a PayoutTx record with success/failure status.
 */
async function safeChainCall(
  fn: () => Promise<Hash>,
  type: PayoutTx['type'],
  recipient: string,
  amount: string,
  agentId?: string,
  agentName?: string,
): Promise<PayoutTx> {
  try {
    const txHash = await fn();
    return {
      type,
      recipient,
      amount,
      txHash,
      success: true,
      agentId,
      agentName,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Payouts] ${type} failed: ${msg}`);
    return {
      type,
      recipient,
      amount,
      txHash: '',
      success: false,
      error: msg,
      agentId,
      agentName,
    };
  }
}
