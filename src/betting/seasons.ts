/**
 * HUNGERNADS - Schadenfreude Pool & Season Mechanics
 *
 * 3% of every battle pool accumulates in the global Schadenfreude pool.
 * Every 50 battles = 1 season. At season end, the top 10 bettors by
 * profit receive a proportional payout from the pool.
 * Unclaimed after 7 days -> burned.
 */

import {
  getActiveSeason,
  getSeason,
  getSeasonByNumber,
  insertSeason,
  updateSeason,
  insertSeasonLeaderboardEntry,
  getSeasonLeaderboard,
  claimSeasonPayout,
  getUnclaimedSeasonEntries,
  getExpiredSeasons,
  getTopBettorsByProfit,
  getTopBettorsByProfitForSeason,
  getUserSeasonEntry,
  listSeasons,
  getAgentStatsForSeason,
  insertSeasonAgentLeaderboardEntry,
  getSeasonAgentLeaderboard,
  getSeasonBettingStats,
  updateBattle,
  BATTLES_PER_SEASON,
  CLAIM_WINDOW_DAYS,
  SCHADENFREUDE_TOP_N,
  type SeasonRow,
  type SeasonLeaderboardRow,
  type SeasonAgentLeaderboardRow,
} from '../db/schema';

// ─── Types ──────────────────────────────────────────────────────

export interface SeasonSummary {
  id: string;
  seasonNumber: number;
  status: 'active' | 'ended' | 'burned';
  startedAt: string;
  endedAt: string | null;
  battleCount: number;
  schadenfreudePool: number;
  battlesRemaining: number;
  totalDistributed: number;
  totalBurned: number;
  claimDeadline: string | null;
  /** Season-scoped betting stats (populated for detail queries). */
  bettingStats?: {
    totalBets: number;
    totalWagered: number;
    totalPayout: number;
    uniqueBettors: number;
  };
}

export interface SeasonAgentLeaderboardEntry {
  rank: number;
  agentId: string;
  agentClass: string;
  agentName: string;
  wins: number;
  losses: number;
  kills: number;
  totalBattles: number;
  avgEpochsSurvived: number;
  winRate: number;
}

export interface SeasonLeaderboardEntry {
  rank: number;
  userAddress: string;
  profit: number;
  totalWagered: number;
  totalPayout: number;
  winCount: number;
  betCount: number;
  schadenfreudePayout: number;
  claimed: boolean;
}

export interface AccumulateResult {
  seasonId: string;
  seasonNumber: number;
  amountAdded: number;
  newPoolTotal: number;
  battleCount: number;
  seasonEnded: boolean;
}

export interface EndSeasonResult {
  seasonId: string;
  seasonNumber: number;
  totalPool: number;
  leaderboard: SeasonLeaderboardEntry[];
  agentLeaderboard: SeasonAgentLeaderboardEntry[];
  claimDeadline: string;
  nextSeasonId: string;
  nextSeasonNumber: number;
}

export interface BurnResult {
  seasonId: string;
  seasonNumber: number;
  totalBurned: number;
  entriesBurned: number;
}

// ─── Class ──────────────────────────────────────────────────────

export class SeasonManager {
  constructor(private db: D1Database) {}

  // ── Get or create the active season ────────────────────────────

  /**
   * Returns the current active season. Creates season 1 if none exists.
   */
  async getOrCreateActiveSeason(): Promise<SeasonRow> {
    let season = await getActiveSeason(this.db);

    if (!season) {
      // Determine the next season number
      const seasons = await listSeasons(this.db, 1);
      const nextNumber = seasons.length > 0 ? seasons[0].season_number + 1 : 1;

      season = {
        id: crypto.randomUUID(),
        season_number: nextNumber,
        status: 'active',
        started_at: new Date().toISOString(),
        ended_at: null,
        battle_count: 0,
        schadenfreude_pool: 0,
        total_distributed: 0,
        total_burned: 0,
        claim_deadline: null,
      };

      await insertSeason(this.db, season);
      console.log(`[SeasonManager] Created season ${nextNumber} (${season.id})`);
    }

    return season;
  }

  // ── Assign a battle to the current season ────────────────────────

  /**
   * Links a battle to the current active season by setting its season_id.
   * Should be called when a battle is created.
   *
   * @param battleId The battle to assign.
   * @returns The season ID the battle was assigned to.
   */
  async assignBattleToSeason(battleId: string): Promise<string> {
    const season = await this.getOrCreateActiveSeason();
    await updateBattle(this.db, battleId, { season_id: season.id });
    console.log(
      `[SeasonManager] Battle ${battleId} assigned to season ${season.season_number} (${season.id})`,
    );
    return season.id;
  }

  // ── Accumulate Schadenfreude pool ──────────────────────────────

  /**
   * Called after each battle settlement. Adds the 3% Schadenfreude cut
   * to the current season's pool and increments the battle count.
   *
   * If the season reaches BATTLES_PER_SEASON (50), automatically ends
   * the season and creates the next one.
   *
   * @param amount The 3% Schadenfreude amount from the battle pool.
   * @returns Result with current season state and whether the season ended.
   */
  async accumulate(amount: number): Promise<AccumulateResult> {
    const season = await this.getOrCreateActiveSeason();

    const newPool = season.schadenfreude_pool + amount;
    const newBattleCount = season.battle_count + 1;

    await updateSeason(this.db, season.id, {
      schadenfreude_pool: newPool,
      battle_count: newBattleCount,
    });

    console.log(
      `[SeasonManager] Season ${season.season_number}: +${amount} to pool (total: ${newPool}), battle ${newBattleCount}/${BATTLES_PER_SEASON}`,
    );

    let seasonEnded = false;

    // Check if season should end
    if (newBattleCount >= BATTLES_PER_SEASON) {
      await this.endSeason(season.id);
      seasonEnded = true;
    }

    return {
      seasonId: season.id,
      seasonNumber: season.season_number,
      amountAdded: amount,
      newPoolTotal: newPool,
      battleCount: newBattleCount,
      seasonEnded,
    };
  }

  // ── End a season ──────────────────────────────────────────────

  /**
   * Ends a season: snapshots the top 10 bettors by profit, allocates
   * their proportional Schadenfreude payouts, sets a claim deadline,
   * and creates the next season.
   */
  async endSeason(seasonId: string): Promise<EndSeasonResult> {
    const season = await getSeason(this.db, seasonId);
    if (!season) throw new Error(`Season ${seasonId} not found`);
    if (season.status !== 'active') {
      throw new Error(`Season ${seasonId} is not active (status: ${season.status})`);
    }

    const now = new Date();
    const claimDeadline = new Date(now.getTime() + CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Get top bettors by profit (season-scoped first, fall back to global)
    let topBettors = await getTopBettorsByProfitForSeason(this.db, seasonId, SCHADENFREUDE_TOP_N);
    if (topBettors.length === 0) {
      // Fallback for older battles without season_id linkage
      topBettors = await getTopBettorsByProfit(this.db, SCHADENFREUDE_TOP_N);
    }

    // Calculate proportional payouts
    const totalProfit = topBettors.reduce((sum, b) => sum + b.profit, 0);
    const leaderboard: SeasonLeaderboardEntry[] = [];

    for (let i = 0; i < topBettors.length; i++) {
      const bettor = topBettors[i];
      const share = totalProfit > 0 ? bettor.profit / totalProfit : 0;
      const payout = Math.floor(season.schadenfreude_pool * share * 100) / 100;

      const entry: SeasonLeaderboardRow = {
        id: crypto.randomUUID(),
        season_id: seasonId,
        rank: i + 1,
        user_address: bettor.user_address,
        profit: bettor.profit,
        total_wagered: bettor.total_wagered,
        total_payout: bettor.total_payout,
        win_count: bettor.win_count,
        bet_count: bettor.bet_count,
        schadenfreude_payout: payout,
        claimed: 0,
        claimed_at: null,
      };

      await insertSeasonLeaderboardEntry(this.db, entry);

      leaderboard.push({
        rank: i + 1,
        userAddress: bettor.user_address,
        profit: bettor.profit,
        totalWagered: bettor.total_wagered,
        totalPayout: bettor.total_payout,
        winCount: bettor.win_count,
        betCount: bettor.bet_count,
        schadenfreudePayout: payout,
        claimed: false,
      });
    }

    // Mark season as ended
    await updateSeason(this.db, seasonId, {
      status: 'ended',
      ended_at: now.toISOString(),
      claim_deadline: claimDeadline.toISOString(),
      total_distributed: leaderboard.reduce((sum, e) => sum + e.schadenfreudePayout, 0),
    });

    console.log(
      `[SeasonManager] Season ${season.season_number} ended. Pool: ${season.schadenfreude_pool}, distributed to ${leaderboard.length} bettors`,
    );

    // ── Snapshot agent leaderboard ───────────────────────────────
    const agentLeaderboard: SeasonAgentLeaderboardEntry[] = [];
    try {
      const agentStats = await getAgentStatsForSeason(this.db, seasonId, 50);
      for (let i = 0; i < agentStats.length; i++) {
        const agent = agentStats[i];
        const entry: SeasonAgentLeaderboardRow = {
          id: crypto.randomUUID(),
          season_id: seasonId,
          rank: i + 1,
          agent_id: agent.agent_id,
          agent_class: agent.agent_class,
          agent_name: agent.agent_name,
          wins: agent.wins,
          losses: agent.losses,
          kills: agent.kills,
          total_battles: agent.total_battles,
          avg_epochs_survived: agent.avg_epochs_survived,
          win_rate: agent.win_rate,
        };
        await insertSeasonAgentLeaderboardEntry(this.db, entry);
        agentLeaderboard.push({
          rank: i + 1,
          agentId: agent.agent_id,
          agentClass: agent.agent_class,
          agentName: agent.agent_name,
          wins: agent.wins,
          losses: agent.losses,
          kills: agent.kills,
          totalBattles: agent.total_battles,
          avgEpochsSurvived: agent.avg_epochs_survived,
          winRate: agent.win_rate,
        });
      }
      console.log(
        `[SeasonManager] Snapshotted ${agentLeaderboard.length} agents for season ${season.season_number}`,
      );
    } catch (err) {
      console.error('[SeasonManager] Agent leaderboard snapshot failed:', err);
    }

    // Create the next season
    const nextSeason: SeasonRow = {
      id: crypto.randomUUID(),
      season_number: season.season_number + 1,
      status: 'active',
      started_at: now.toISOString(),
      ended_at: null,
      battle_count: 0,
      schadenfreude_pool: 0,
      total_distributed: 0,
      total_burned: 0,
      claim_deadline: null,
    };
    await insertSeason(this.db, nextSeason);
    console.log(`[SeasonManager] Created season ${nextSeason.season_number} (${nextSeason.id})`);

    return {
      seasonId,
      seasonNumber: season.season_number,
      totalPool: season.schadenfreude_pool,
      leaderboard,
      agentLeaderboard,
      claimDeadline: claimDeadline.toISOString(),
      nextSeasonId: nextSeason.id,
      nextSeasonNumber: nextSeason.season_number,
    };
  }

  // ── Claim a payout ────────────────────────────────────────────

  /**
   * Claim a Schadenfreude payout for a user in a specific season.
   * Returns the payout amount or null if not eligible.
   */
  async claimPayout(
    seasonId: string,
    userAddress: string,
  ): Promise<{ payout: number; rank: number } | null> {
    const season = await getSeason(this.db, seasonId);
    if (!season) throw new Error(`Season ${seasonId} not found`);
    if (season.status !== 'ended') {
      throw new Error(`Season ${seasonId} is not ended (status: ${season.status})`);
    }

    // Check claim deadline
    if (season.claim_deadline) {
      const deadline = new Date(season.claim_deadline).getTime();
      if (Date.now() > deadline) {
        throw new Error(`Claim deadline has passed for season ${season.season_number}`);
      }
    }

    const entry = await getUserSeasonEntry(this.db, seasonId, userAddress);
    if (!entry) return null;
    if (entry.claimed === 1) {
      throw new Error(`Payout already claimed for season ${season.season_number}`);
    }

    await claimSeasonPayout(this.db, entry.id);

    console.log(
      `[SeasonManager] ${userAddress} claimed ${entry.schadenfreude_payout} from season ${season.season_number} (rank ${entry.rank})`,
    );

    return { payout: entry.schadenfreude_payout, rank: entry.rank };
  }

  // ── Burn unclaimed payouts ────────────────────────────────────

  /**
   * Processes expired seasons: burns all unclaimed Schadenfreude payouts.
   * Should be called periodically (e.g., via a cron trigger).
   */
  async burnExpiredPayouts(): Promise<BurnResult[]> {
    const expiredSeasons = await getExpiredSeasons(this.db);
    const results: BurnResult[] = [];

    for (const season of expiredSeasons) {
      const unclaimed = await getUnclaimedSeasonEntries(this.db, season.id);
      if (unclaimed.length === 0) {
        // Nothing to burn — just mark as burned
        await updateSeason(this.db, season.id, { status: 'burned' });
        results.push({
          seasonId: season.id,
          seasonNumber: season.season_number,
          totalBurned: 0,
          entriesBurned: 0,
        });
        continue;
      }

      const totalBurned = unclaimed.reduce((sum, e) => sum + e.schadenfreude_payout, 0);

      // Mark each entry as "claimed" (they won't receive the payout — it's burned)
      for (const entry of unclaimed) {
        await claimSeasonPayout(this.db, entry.id);
      }

      await updateSeason(this.db, season.id, {
        status: 'burned',
        total_burned: (season.total_burned ?? 0) + totalBurned,
      });

      console.log(
        `[SeasonManager] Burned ${totalBurned} from season ${season.season_number} (${unclaimed.length} unclaimed entries)`,
      );

      results.push({
        seasonId: season.id,
        seasonNumber: season.season_number,
        totalBurned,
        entriesBurned: unclaimed.length,
      });
    }

    return results;
  }

  // ── Query helpers ─────────────────────────────────────────────

  /**
   * Get current season summary for API responses.
   */
  async getCurrentSeason(): Promise<SeasonSummary> {
    const season = await this.getOrCreateActiveSeason();
    return this.toSummary(season);
  }

  /**
   * Get a season summary by ID.
   */
  async getSeasonSummary(seasonId: string): Promise<SeasonSummary | null> {
    const season = await getSeason(this.db, seasonId);
    if (!season) return null;
    return this.toSummary(season);
  }

  /**
   * Get a season summary by number.
   */
  async getSeasonByNumber(seasonNumber: number): Promise<SeasonSummary | null> {
    const season = await getSeasonByNumber(this.db, seasonNumber);
    if (!season) return null;
    return this.toSummary(season);
  }

  /**
   * Get the leaderboard for a season.
   */
  async getLeaderboard(seasonId: string): Promise<SeasonLeaderboardEntry[]> {
    const rows = await getSeasonLeaderboard(this.db, seasonId);
    return rows.map((row) => ({
      rank: row.rank,
      userAddress: row.user_address,
      profit: row.profit,
      totalWagered: row.total_wagered,
      totalPayout: row.total_payout,
      winCount: row.win_count,
      betCount: row.bet_count,
      schadenfreudePayout: row.schadenfreude_payout,
      claimed: row.claimed === 1,
    }));
  }

  /**
   * List recent seasons.
   */
  async listSeasons(limit: number = 10): Promise<SeasonSummary[]> {
    const seasons = await listSeasons(this.db, limit);
    return seasons.map((s) => this.toSummary(s));
  }

  // ── Agent leaderboard ────────────────────────────────────────

  /**
   * Get the agent leaderboard for a season.
   * For ended/burned seasons, returns the snapshotted data.
   * For active seasons, returns live agent stats.
   */
  async getAgentLeaderboard(seasonId: string): Promise<SeasonAgentLeaderboardEntry[]> {
    // Try snapshotted data first
    const rows = await getSeasonAgentLeaderboard(this.db, seasonId);
    if (rows.length > 0) {
      return rows.map((row) => ({
        rank: row.rank,
        agentId: row.agent_id,
        agentClass: row.agent_class,
        agentName: row.agent_name,
        wins: row.wins,
        losses: row.losses,
        kills: row.kills,
        totalBattles: row.total_battles,
        avgEpochsSurvived: row.avg_epochs_survived,
        winRate: row.win_rate,
      }));
    }

    // For active seasons: compute live from battle_records
    const liveStats = await getAgentStatsForSeason(this.db, seasonId, 50);
    return liveStats.map((agent, i) => ({
      rank: i + 1,
      agentId: agent.agent_id,
      agentClass: agent.agent_class,
      agentName: agent.agent_name,
      wins: agent.wins,
      losses: agent.losses,
      kills: agent.kills,
      totalBattles: agent.total_battles,
      avgEpochsSurvived: agent.avg_epochs_survived,
      winRate: agent.win_rate,
    }));
  }

  /**
   * Get detailed season summary with betting stats.
   */
  async getSeasonDetail(seasonId: string): Promise<SeasonSummary | null> {
    const season = await getSeason(this.db, seasonId);
    if (!season) return null;

    const summary = this.toSummary(season);
    const bettingStats = await getSeasonBettingStats(this.db, seasonId);
    summary.bettingStats = bettingStats;

    return summary;
  }

  /**
   * Get a live bettor leaderboard for an active season (not snapshotted).
   */
  async getLiveBettorLeaderboard(seasonId: string): Promise<SeasonLeaderboardEntry[]> {
    const topBettors = await getTopBettorsByProfitForSeason(this.db, seasonId, SCHADENFREUDE_TOP_N);
    return topBettors.map((bettor, i) => ({
      rank: i + 1,
      userAddress: bettor.user_address,
      profit: bettor.profit,
      totalWagered: bettor.total_wagered,
      totalPayout: bettor.total_payout,
      winCount: bettor.win_count,
      betCount: bettor.bet_count,
      schadenfreudePayout: 0, // Not yet distributed for active season
      claimed: false,
    }));
  }

  // ── Private helpers ───────────────────────────────────────────

  private toSummary(season: SeasonRow): SeasonSummary {
    return {
      id: season.id,
      seasonNumber: season.season_number,
      status: season.status as 'active' | 'ended' | 'burned',
      startedAt: season.started_at,
      endedAt: season.ended_at,
      battleCount: season.battle_count,
      schadenfreudePool: season.schadenfreude_pool,
      battlesRemaining: Math.max(0, BATTLES_PER_SEASON - season.battle_count),
      totalDistributed: season.total_distributed,
      totalBurned: season.total_burned,
      claimDeadline: season.claim_deadline,
    };
  }
}
