/**
 * HUNGERNADS - Betting Pool Logic (D1-backed)
 *
 * Manages the betting pool for a battle. All state is persisted in D1.
 * Distribution: 85% winners, 5% treasury, 5% burn, 3% Schadenfreude pool, 2% streak bonus pool.
 */

import {
  insertBet,
  getBetsByBattle,
  getBetsByUser,
  settleBet,
  settleBattleBets,
  getJackpotPool,
  setJackpotPool,
  getStreakPool,
  setStreakPool,
  getStreakTracking,
  upsertStreakTracking,
  type BetRow,
} from '../db/schema';
import { SeasonManager } from './seasons';

// ─── Betting Phase ───────────────────────────────────────────────

/**
 * Betting lifecycle phases for a battle.
 *
 * - OPEN:    Bets are accepted (battle start through first N epochs).
 * - LOCKED:  No new bets accepted; battle still in progress.
 * - SETTLED: Battle complete, payouts distributed.
 */
export type BettingPhase = 'OPEN' | 'LOCKED' | 'SETTLED';

/**
 * Number of epochs after which betting locks.
 * After this many epochs have been processed, no new bets are accepted.
 * Can be overridden via BETTING_LOCK_AFTER_EPOCH env var.
 */
export const DEFAULT_BETTING_LOCK_AFTER_EPOCH = 3;

// ─── Constants ───────────────────────────────────────────────────

export const POOL_DISTRIBUTION = {
  WINNERS: 0.85,
  TREASURY: 0.05,
  BURN: 0.05,
  SCHADENFREUDE: 0.03,
  STREAK_BONUS: 0.02,
} as const;

/** Streak bonus thresholds: streak length -> percentage of streak pool awarded. */
export const STREAK_THRESHOLDS = {
  3: 0.10, // 3-win streak = 10% of streak pool
  5: 0.25, // 5-win streak = 25% of streak pool
} as const;

/** Minimum bet amount (prevents spam / dust bets). */
const MIN_BET = 1;

// ─── Types ───────────────────────────────────────────────────────

export interface Payout {
  userAddress: string;
  betAmount: number;
  /** Amount awarded from the 85% winners pool (+ any incoming jackpot). */
  payout: number;
}

export interface TopBettorBonus {
  userAddress: string;
  /** The winning bet amount that qualified them as top bettor. */
  winningBetAmount: number;
  /** The 2% bonus awarded. */
  bonus: number;
}

/** Streak bonus awarded to a bettor who hit a streak threshold. */
export interface StreakBonus {
  userAddress: string;
  /** Current streak length after this battle. */
  streakLength: number;
  /** Threshold that was crossed (3 or 5). */
  threshold: number;
  /** Percentage of streak pool awarded (0.10 or 0.25). */
  bonusPercent: number;
  /** Actual amount awarded from the streak pool. */
  bonusAmount: number;
}

export interface PoolSummary {
  total: number;
  perAgent: Record<string, number>;
}

export interface PlaceBetResult {
  betId: string;
  amount: number;
  agentId: string;
}

// ─── Class ───────────────────────────────────────────────────────

export class BettingPool {
  constructor(private db: D1Database) {}

  // ── Place a bet ──────────────────────────────────────────────

  /**
   * Place a bet on an agent in a battle.
   *
   * Validates inputs, persists to D1, and returns the bet ID.
   * Throws on invalid input (caller should catch and return 400).
   */
  async placeBet(
    battleId: string,
    userAddress: string,
    agentId: string,
    amount: number,
  ): Promise<PlaceBetResult> {
    if (!battleId) throw new Error('battleId is required');
    if (!userAddress) throw new Error('userAddress is required');
    if (!agentId) throw new Error('agentId is required');
    if (amount < MIN_BET) throw new Error(`Minimum bet is ${MIN_BET}`);

    const betId = crypto.randomUUID();
    const now = new Date().toISOString();

    const row: BetRow = {
      id: betId,
      battle_id: battleId,
      user_address: userAddress,
      agent_id: agentId,
      amount,
      placed_at: now,
      settled: 0,
      payout: 0,
    };

    await insertBet(this.db, row);

    return { betId, amount, agentId };
  }

  // ── Query bets ───────────────────────────────────────────────

  /** All bets for a battle. */
  async getBets(battleId: string): Promise<BetRow[]> {
    return getBetsByBattle(this.db, battleId);
  }

  /** All bets by a specific user, optionally filtered to a battle. */
  async getUserBets(userAddress: string, battleId?: string): Promise<BetRow[]> {
    const all = await getBetsByUser(this.db, userAddress);
    if (!battleId) return all;
    return all.filter(b => b.battle_id === battleId);
  }

  // ── Pool summary ─────────────────────────────────────────────

  /** Total pool size and per-agent breakdown for a battle. */
  async getBattlePool(battleId: string): Promise<PoolSummary> {
    const bets = await getBetsByBattle(this.db, battleId);

    const perAgent: Record<string, number> = {};
    let total = 0;

    for (const bet of bets) {
      total += bet.amount;
      perAgent[bet.agent_id] = (perAgent[bet.agent_id] ?? 0) + bet.amount;
    }

    return { total, perAgent };
  }

  // ── Settlement ───────────────────────────────────────────────

  /**
   * Settle a battle. Call once when a winner is determined.
   *
   * 1. Marks all losing bets as settled (payout = 0).
   * 2. Splits the pool: 85% winners, 5% treasury, 5% burn,
   *    3% Schadenfreude pool (season accumulation), 2% streak bonus.
   * 3. Persists each winning payout to D1.
   * 4. Accumulates 3% into the current season's Schadenfreude pool.
   * 5. Returns the payout list + treasury/burn/schadenfreude amounts.
   */
  async settleBattle(
    battleId: string,
    winnerId: string,
  ): Promise<{
    payouts: Payout[];
    treasury: number;
    burn: number;
    /** 3% of this battle's pool, sent to the Schadenfreude season pool. */
    schadenfreudeContribution: number;
    /** Season info from the Schadenfreude accumulation (null if accumulation failed). */
    schadenfreude: {
      seasonNumber: number;
      poolTotal: number;
      battleCount: number;
      seasonEnded: boolean;
    } | null;
    /** @deprecated Use streakBonuses instead. Kept for backward compat. */
    topBettorBonus: TopBettorBonus | null;
    /** Streak bonuses awarded this settlement. */
    streakBonuses: StreakBonus[];
    /** Streak pool balance after this settlement (post-accumulation, post-payouts). */
    streakPoolBalance: number;
  }> {
    const bets = await getBetsByBattle(this.db, battleId);
    const emptyResult = {
      payouts: [] as Payout[],
      treasury: 0,
      burn: 0,
      schadenfreudeContribution: 0,
      schadenfreude: null,
      topBettorBonus: null,
      streakBonuses: [] as StreakBonus[],
      streakPoolBalance: 0,
    };

    if (bets.length === 0) {
      return emptyResult;
    }

    // Idempotency: if all bets are already settled, skip re-processing.
    const unsettledBets = bets.filter(b => b.settled === 0);
    if (unsettledBets.length === 0) {
      console.log(`[BettingPool] All bets for battle ${battleId} already settled — skipping`);
      return emptyResult;
    }

    const totalPool = bets.reduce((sum, b) => sum + b.amount, 0);

    // ── Pool split: 85/5/5/3/2 ──────────────────────────────────
    const treasury = totalPool * POOL_DISTRIBUTION.TREASURY;
    const burn = totalPool * POOL_DISTRIBUTION.BURN;
    const schadenfreudeContribution = totalPool * POOL_DISTRIBUTION.SCHADENFREUDE;
    const streakCut = totalPool * POOL_DISTRIBUTION.STREAK_BONUS;

    // Base winners pool = 85% of this battle's pool
    const winnerPool = totalPool * POOL_DISTRIBUTION.WINNERS;

    // ── Schadenfreude pool accumulation ───────────────────────────
    let schadenfreude: {
      seasonNumber: number;
      poolTotal: number;
      battleCount: number;
      seasonEnded: boolean;
    } | null = null;

    try {
      const seasonManager = new SeasonManager(this.db);
      const result = await seasonManager.accumulate(schadenfreudeContribution);
      schadenfreude = {
        seasonNumber: result.seasonNumber,
        poolTotal: result.newPoolTotal,
        battleCount: result.battleCount,
        seasonEnded: result.seasonEnded,
      };
      console.log(
        `[BettingPool] Schadenfreude: +${schadenfreudeContribution} to season ${result.seasonNumber} (total: ${result.newPoolTotal}, battle ${result.battleCount})`,
      );
    } catch (err) {
      console.error('[BettingPool] Schadenfreude accumulation failed:', err);
    }

    // ── Streak pool: accumulate 2% ───────────────────────────────
    let streakPoolBalance = 0;
    try {
      const existingPool = await getStreakPool(this.db);
      streakPoolBalance = existingPool + streakCut;
      console.log(
        `[BettingPool] Streak pool: ${existingPool} + ${streakCut} = ${streakPoolBalance}`,
      );
    } catch (err) {
      console.error('[BettingPool] Streak pool read failed:', err);
      streakPoolBalance = streakCut;
    }

    // Mark losers first (bulk update).
    await settleBattleBets(this.db, battleId, winnerId);

    // Compute winner payouts.
    const winningBets = bets.filter(b => b.agent_id === winnerId);
    const totalWinningStake = winningBets.reduce((sum, b) => sum + b.amount, 0);

    const payouts: Payout[] = [];

    if (totalWinningStake > 0) {
      // Aggregate per-user (a user can have multiple bets on the winner).
      const userStakes = new Map<string, { total: number; betIds: string[] }>();

      for (const bet of winningBets) {
        const entry = userStakes.get(bet.user_address) ?? { total: 0, betIds: [] };
        entry.total += bet.amount;
        entry.betIds.push(bet.id);
        userStakes.set(bet.user_address, entry);
      }

      // ── Distribute winner pool proportionally ──────────────────
      for (const [userAddress, { total, betIds }] of userStakes) {
        const share = total / totalWinningStake;
        const userPayout = Math.floor(winnerPool * share * 100) / 100; // floor to 2 dp

        payouts.push({
          userAddress,
          betAmount: total,
          payout: userPayout,
        });

        // Distribute payout across the user's individual bet rows proportionally.
        for (const betId of betIds) {
          const bet = winningBets.find(b => b.id === betId)!;
          const betShare = bet.amount / total;
          const betPayout = Math.floor(userPayout * betShare * 100) / 100;
          await settleBet(this.db, betId, betPayout);
        }
      }
    }

    // ── Streak tracking & bonus evaluation ────────────────────────
    // Determine unique bettors and whether they won or lost.
    // A user "won" if ANY of their bets were on the winning agent.
    const allBettors = new Map<string, boolean>(); // wallet -> won?
    for (const bet of bets) {
      const currentWon = allBettors.get(bet.user_address) ?? false;
      if (bet.agent_id === winnerId) {
        allBettors.set(bet.user_address, true);
      } else if (!currentWon) {
        allBettors.set(bet.user_address, false);
      }
    }

    const streakBonuses: StreakBonus[] = [];
    let totalStreakPayout = 0;

    try {
      for (const [wallet, won] of allBettors) {
        const existing = await getStreakTracking(this.db, wallet);
        const prevStreak = existing?.current_streak ?? 0;
        const prevMax = existing?.max_streak ?? 0;

        if (won) {
          const newStreak = prevStreak + 1;
          const newMax = Math.max(prevMax, newStreak);

          // Check if this increment crosses a streak threshold.
          // Threshold 3: fires when newStreak reaches exactly 3.
          // Threshold 5: fires when newStreak reaches 5 or any multiple of 5 (10, 15...).
          let bonusPercent = 0;
          let threshold = 0;

          if (newStreak >= 5 && (prevStreak < 5 || (newStreak % 5 === 0))) {
            bonusPercent = STREAK_THRESHOLDS[5];
            threshold = 5;
          } else if (newStreak === 3) {
            bonusPercent = STREAK_THRESHOLDS[3];
            threshold = 3;
          }

          let bonusAmount = 0;
          if (bonusPercent > 0 && streakPoolBalance > 0) {
            bonusAmount = Math.floor(streakPoolBalance * bonusPercent * 100) / 100;
            // Cap at remaining pool balance
            if (totalStreakPayout + bonusAmount > streakPoolBalance) {
              bonusAmount = Math.floor((streakPoolBalance - totalStreakPayout) * 100) / 100;
            }
            if (bonusAmount > 0) {
              totalStreakPayout += bonusAmount;
              streakBonuses.push({
                userAddress: wallet,
                streakLength: newStreak,
                threshold,
                bonusPercent,
                bonusAmount,
              });
              console.log(
                `[BettingPool] Streak bonus: ${wallet} hit ${newStreak}-streak ` +
                `(threshold ${threshold}), awarded ${bonusAmount} (${bonusPercent * 100}% of pool)`,
              );
            }
          }

          await upsertStreakTracking(this.db, wallet, newStreak, newMax, battleId, bonusAmount);
        } else {
          // Lost: reset streak to 0, preserve max
          await upsertStreakTracking(this.db, wallet, 0, prevMax, battleId, 0);
        }
      }
    } catch (err) {
      console.error('[BettingPool] Streak tracking failed:', err);
      // Non-fatal: bets are already settled, streak tracking is a bonus feature
    }

    // ── Persist streak pool (minus payouts) ──────────────────────
    streakPoolBalance = Math.max(0, streakPoolBalance - totalStreakPayout);
    try {
      await setStreakPool(this.db, streakPoolBalance);
    } catch (err) {
      console.error('[BettingPool] Streak pool write failed:', err);
    }

    // Add streak bonuses to the corresponding winner payouts
    for (const sb of streakBonuses) {
      const existingPayout = payouts.find(p => p.userAddress === sb.userAddress);
      if (existingPayout) {
        existingPayout.payout += sb.bonusAmount;
      }
    }

    return {
      payouts,
      treasury,
      burn,
      schadenfreudeContribution,
      schadenfreude,
      topBettorBonus: null, // deprecated — replaced by streak bonuses
      streakBonuses,
      streakPoolBalance,
    };
  }
}
