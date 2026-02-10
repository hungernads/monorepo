/**
 * HUNGERNADS - D1 Database Schema & Query Helpers
 *
 * Type-safe row types and prepared-statement query helpers for D1 SQLite.
 * Matches the schema in migrations/0001_initial.sql.
 */

// ─── Row Types ───────────────────────────────────────────────────

export interface AgentRow {
  id: string;
  class: string;
  name: string;
  created_at: string;
  /** Wallet address of the player who registered this agent in the lobby. */
  wallet_address: string | null;
  /** Optional profile image URL for the agent. */
  image_url: string | null;
  /** The battle this agent is registered to (lobby join). */
  battle_id: string | null;
  /** Transaction hash of the participation fee payment (off-chain tracking). */
  tx_hash: string | null;
}

export interface BattleRow {
  id: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  winner_id: string | null;
  epoch_count: number;
  /** Betting lifecycle phase: OPEN, LOCKED, or SETTLED. */
  betting_phase: string;
  /** Season this battle belongs to (nullable for pre-season battles). */
  season_id: string | null;
  /** Maximum number of players allowed in the lobby (default 8). */
  max_players: number;
  /** Entry fee amount as a string (to handle large numbers / decimals). */
  fee_amount: string;
  /** ISO timestamp when the countdown expires and battle starts. */
  countdown_ends_at: string | null;
  /** ISO timestamp when the battle was cancelled (null if not cancelled). */
  cancelled_at: string | null;
}

export interface EpochRow {
  id: string;
  battle_id: string;
  epoch_num: number;
  market_data_json: string | null;
  timestamp: string;
}

export interface EpochActionRow {
  id: string;
  epoch_id: string;
  agent_id: string;
  prediction_json: string | null;
  attack_json: string | null;
  defend: number; // 0 or 1
  hp_before: number | null;
  hp_after: number | null;
  reasoning: string | null;
}

export interface LessonRow {
  id: string;
  agent_id: string;
  battle_id: string;
  context: string | null;
  outcome: string | null;
  learning: string | null;
  applied: string | null;
  created_at: string;
}

export interface BetRow {
  id: string;
  battle_id: string;
  user_address: string;
  agent_id: string;
  amount: number;
  placed_at: string;
  settled: number; // 0 or 1
  payout: number;
}

export interface SponsorshipRow {
  id: string;
  battle_id: string;
  agent_id: string;
  sponsor_address: string;
  amount: number;
  message: string | null;
  accepted: number; // 0 or 1
  tier: string | null;
  epoch_number: number | null;
}

export interface BattleRecordRow {
  id: string;
  agent_id: string;
  battle_id: string;
  result: string; // 'win' | 'loss' | 'rekt'
  epochs_survived: number;
  kills: number;
  killer_id: string | null;
  killer_class: string | null;
  agent_class: string;
  recorded_at: string;
}

export interface FaucetClaimRow {
  id: string;
  wallet_address: string;
  tier: number; // 1, 2, or 3
  amount: number;
  claimed_at: string;
}

export interface StreakTrackingRow {
  wallet_address: string;
  current_streak: number;
  max_streak: number;
  last_bet_battle_id: string | null;
  total_streak_bonus: number;
  updated_at: string;
}

export interface SeasonRow {
  id: string;
  season_number: number;
  status: string; // 'active' | 'ended' | 'burned'
  started_at: string;
  ended_at: string | null;
  battle_count: number;
  schadenfreude_pool: number;
  total_distributed: number;
  total_burned: number;
  claim_deadline: string | null;
}

export interface SeasonLeaderboardRow {
  id: string;
  season_id: string;
  rank: number;
  user_address: string;
  profit: number;
  total_wagered: number;
  total_payout: number;
  win_count: number;
  bet_count: number;
  schadenfreude_payout: number;
  claimed: number; // 0 or 1
  claimed_at: string | null;
}

export interface SeasonAgentLeaderboardRow {
  id: string;
  season_id: string;
  rank: number;
  agent_id: string;
  agent_class: string;
  agent_name: string;
  wins: number;
  losses: number;
  kills: number;
  total_battles: number;
  avg_epochs_survived: number;
  win_rate: number;
}

// ─── Agent Queries ───────────────────────────────────────────────

export async function insertAgent(
  db: D1Database,
  agent: Pick<AgentRow, 'id' | 'class' | 'name' | 'created_at'> & Partial<AgentRow>,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO agents (id, class, name, created_at, wallet_address, image_url, battle_id, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      agent.id,
      agent.class,
      agent.name,
      agent.created_at,
      agent.wallet_address ?? null,
      agent.image_url ?? null,
      agent.battle_id ?? null,
      agent.tx_hash ?? null,
    )
    .run();
}

export async function getAgent(
  db: D1Database,
  id: string,
): Promise<AgentRow | null> {
  return db
    .prepare('SELECT * FROM agents WHERE id = ?')
    .bind(id)
    .first<AgentRow>();
}

export async function getAllAgents(db: D1Database): Promise<AgentRow[]> {
  const result = await db.prepare('SELECT * FROM agents').all<AgentRow>();
  return result.results;
}

// ─── Battle Queries ──────────────────────────────────────────────

export async function insertBattle(
  db: D1Database,
  battle: Pick<BattleRow, 'id'> & Partial<BattleRow>,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO battles (id, status, started_at, ended_at, winner_id, epoch_count, betting_phase, season_id, max_players, fee_amount, countdown_ends_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      battle.id,
      battle.status ?? 'PENDING',
      battle.started_at ?? null,
      battle.ended_at ?? null,
      battle.winner_id ?? null,
      battle.epoch_count ?? 0,
      battle.betting_phase ?? 'OPEN',
      battle.season_id ?? null,
      battle.max_players ?? 8,
      battle.fee_amount ?? '0',
      battle.countdown_ends_at ?? null,
      battle.cancelled_at ?? null,
    )
    .run();
}

export async function getBattle(
  db: D1Database,
  id: string,
): Promise<BattleRow | null> {
  return db
    .prepare('SELECT * FROM battles WHERE id = ?')
    .bind(id)
    .first<BattleRow>();
}

export async function updateBattleStatus(
  db: D1Database,
  id: string,
  status: string,
): Promise<void> {
  await db
    .prepare('UPDATE battles SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();
}

export async function updateBattle(
  db: D1Database,
  id: string,
  fields: Partial<Omit<BattleRow, 'id'>>,
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) {
    setClauses.push('status = ?');
    values.push(fields.status);
  }
  if (fields.started_at !== undefined) {
    setClauses.push('started_at = ?');
    values.push(fields.started_at);
  }
  if (fields.ended_at !== undefined) {
    setClauses.push('ended_at = ?');
    values.push(fields.ended_at);
  }
  if (fields.winner_id !== undefined) {
    setClauses.push('winner_id = ?');
    values.push(fields.winner_id);
  }
  if (fields.epoch_count !== undefined) {
    setClauses.push('epoch_count = ?');
    values.push(fields.epoch_count);
  }
  if (fields.betting_phase !== undefined) {
    setClauses.push('betting_phase = ?');
    values.push(fields.betting_phase);
  }
  if (fields.season_id !== undefined) {
    setClauses.push('season_id = ?');
    values.push(fields.season_id);
  }
  if (fields.max_players !== undefined) {
    setClauses.push('max_players = ?');
    values.push(fields.max_players);
  }
  if (fields.fee_amount !== undefined) {
    setClauses.push('fee_amount = ?');
    values.push(fields.fee_amount);
  }
  if (fields.countdown_ends_at !== undefined) {
    setClauses.push('countdown_ends_at = ?');
    values.push(fields.countdown_ends_at);
  }
  if (fields.cancelled_at !== undefined) {
    setClauses.push('cancelled_at = ?');
    values.push(fields.cancelled_at);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  await db
    .prepare(`UPDATE battles SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Get battles in LOBBY or COUNTDOWN status with agent counts.
 * Uses a LEFT JOIN to count agents per battle efficiently.
 * Returns battles ordered by most recently created first.
 */
export async function getOpenLobbies(
  db: D1Database,
): Promise<
  Array<
    BattleRow & { player_count: number }
  >
> {
  const result = await db
    .prepare(
      `SELECT b.*, COALESCE(a.cnt, 0) as player_count
       FROM battles b
       LEFT JOIN (
         SELECT battle_id, COUNT(*) as cnt
         FROM agents
         WHERE battle_id IS NOT NULL
         GROUP BY battle_id
       ) a ON a.battle_id = b.id
       WHERE b.status IN ('LOBBY', 'COUNTDOWN')
       ORDER BY b.rowid DESC`,
    )
    .all<BattleRow & { player_count: number }>();
  return result.results;
}

// ─── Epoch Queries ───────────────────────────────────────────────

export async function insertEpoch(
  db: D1Database,
  epoch: EpochRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO epochs (id, battle_id, epoch_num, market_data_json, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      epoch.id,
      epoch.battle_id,
      epoch.epoch_num,
      epoch.market_data_json,
      epoch.timestamp,
    )
    .run();
}

export async function getEpoch(
  db: D1Database,
  id: string,
): Promise<EpochRow | null> {
  return db
    .prepare('SELECT * FROM epochs WHERE id = ?')
    .bind(id)
    .first<EpochRow>();
}

export async function getEpochsByBattle(
  db: D1Database,
  battleId: string,
): Promise<EpochRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM epochs WHERE battle_id = ? ORDER BY epoch_num ASC',
    )
    .bind(battleId)
    .all<EpochRow>();
  return result.results;
}

// ─── Epoch Action Queries ────────────────────────────────────────

export async function insertEpochAction(
  db: D1Database,
  action: EpochActionRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO epoch_actions (id, epoch_id, agent_id, prediction_json, attack_json, defend, hp_before, hp_after, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      action.id,
      action.epoch_id,
      action.agent_id,
      action.prediction_json,
      action.attack_json,
      action.defend,
      action.hp_before,
      action.hp_after,
      action.reasoning,
    )
    .run();
}

export async function getEpochActions(
  db: D1Database,
  epochId: string,
): Promise<EpochActionRow[]> {
  const result = await db
    .prepare('SELECT * FROM epoch_actions WHERE epoch_id = ?')
    .bind(epochId)
    .all<EpochActionRow>();
  return result.results;
}

export async function getAgentActions(
  db: D1Database,
  agentId: string,
  limit: number = 50,
): Promise<EpochActionRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM epoch_actions WHERE agent_id = ? ORDER BY rowid DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<EpochActionRow>();
  return result.results;
}

// ─── Lesson Queries ──────────────────────────────────────────────

export async function insertLesson(
  db: D1Database,
  lesson: LessonRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO lessons (id, agent_id, battle_id, context, outcome, learning, applied, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      lesson.id,
      lesson.agent_id,
      lesson.battle_id,
      lesson.context,
      lesson.outcome,
      lesson.learning,
      lesson.applied,
      lesson.created_at,
    )
    .run();
}

export async function getAgentLessons(
  db: D1Database,
  agentId: string,
  limit: number = 10,
): Promise<LessonRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM lessons WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<LessonRow>();
  return result.results;
}

export async function getLessonsByBattle(
  db: D1Database,
  battleId: string,
): Promise<LessonRow[]> {
  const result = await db
    .prepare('SELECT * FROM lessons WHERE battle_id = ?')
    .bind(battleId)
    .all<LessonRow>();
  return result.results;
}

// ─── Bet Queries ─────────────────────────────────────────────────

export async function insertBet(
  db: D1Database,
  bet: BetRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO bets (id, battle_id, user_address, agent_id, amount, placed_at, settled, payout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      bet.id,
      bet.battle_id,
      bet.user_address,
      bet.agent_id,
      bet.amount,
      bet.placed_at,
      bet.settled,
      bet.payout,
    )
    .run();
}

export async function getBetsByBattle(
  db: D1Database,
  battleId: string,
): Promise<BetRow[]> {
  const result = await db
    .prepare('SELECT * FROM bets WHERE battle_id = ?')
    .bind(battleId)
    .all<BetRow>();
  return result.results;
}

export async function getBetsByUser(
  db: D1Database,
  userAddress: string,
): Promise<BetRow[]> {
  const result = await db
    .prepare('SELECT * FROM bets WHERE user_address = ? ORDER BY placed_at DESC')
    .bind(userAddress)
    .all<BetRow>();
  return result.results;
}

export async function settleBet(
  db: D1Database,
  betId: string,
  payout: number,
): Promise<void> {
  await db
    .prepare('UPDATE bets SET settled = 1, payout = ? WHERE id = ?')
    .bind(payout, betId)
    .run();
}

export async function settleBattleBets(
  db: D1Database,
  battleId: string,
  winnerId: string,
): Promise<void> {
  // Mark all losing bets as settled with 0 payout
  await db
    .prepare(
      'UPDATE bets SET settled = 1, payout = 0 WHERE battle_id = ? AND agent_id != ?',
    )
    .bind(battleId, winnerId)
    .run();
}

// ─── Sponsorship Queries ─────────────────────────────────────────

export async function insertSponsorship(
  db: D1Database,
  sponsorship: SponsorshipRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sponsorships (id, battle_id, agent_id, sponsor_address, amount, message, accepted, tier, epoch_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      sponsorship.id,
      sponsorship.battle_id,
      sponsorship.agent_id,
      sponsorship.sponsor_address,
      sponsorship.amount,
      sponsorship.message,
      sponsorship.accepted,
      sponsorship.tier,
      sponsorship.epoch_number,
    )
    .run();
}

export async function getSponsorshipsByBattle(
  db: D1Database,
  battleId: string,
): Promise<SponsorshipRow[]> {
  const result = await db
    .prepare('SELECT * FROM sponsorships WHERE battle_id = ?')
    .bind(battleId)
    .all<SponsorshipRow>();
  return result.results;
}

export async function getSponsorshipsByAgent(
  db: D1Database,
  agentId: string,
): Promise<SponsorshipRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM sponsorships WHERE agent_id = ? ORDER BY rowid DESC',
    )
    .bind(agentId)
    .all<SponsorshipRow>();
  return result.results;
}

export async function acceptSponsorship(
  db: D1Database,
  sponsorshipId: string,
): Promise<void> {
  await db
    .prepare('UPDATE sponsorships SET accepted = 1 WHERE id = ?')
    .bind(sponsorshipId)
    .run();
}

/**
 * Get sponsorships for a specific epoch (for effect resolution during epoch processing).
 */
export async function getSponsorshipsByEpoch(
  db: D1Database,
  battleId: string,
  epochNumber: number,
): Promise<SponsorshipRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM sponsorships WHERE battle_id = ? AND epoch_number = ? AND accepted = 1',
    )
    .bind(battleId, epochNumber)
    .all<SponsorshipRow>();
  return result.results;
}

/**
 * Check if an agent already has a sponsorship for a given epoch (1-per-agent-per-epoch cap).
 */
export async function hasAgentSponsorshipForEpoch(
  db: D1Database,
  battleId: string,
  agentId: string,
  epochNumber: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) as cnt FROM sponsorships WHERE battle_id = ? AND agent_id = ? AND epoch_number = ?',
    )
    .bind(battleId, agentId, epochNumber)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) > 0;
}

// ─── Battle Record Queries ──────────────────────────────────────

export async function insertBattleRecord(
  db: D1Database,
  record: BattleRecordRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO battle_records (id, agent_id, battle_id, result, epochs_survived, kills, killer_id, killer_class, agent_class, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      record.id,
      record.agent_id,
      record.battle_id,
      record.result,
      record.epochs_survived,
      record.kills,
      record.killer_id,
      record.killer_class,
      record.agent_class,
      record.recorded_at,
    )
    .run();
}

export async function getAgentBattleRecords(
  db: D1Database,
  agentId: string,
  limit: number = 50,
): Promise<BattleRecordRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM battle_records WHERE agent_id = ? ORDER BY recorded_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<BattleRecordRow>();
  return result.results;
}

export async function getAgentWins(
  db: D1Database,
  agentId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM battle_records WHERE agent_id = ? AND result = 'win'",
    )
    .bind(agentId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function getAgentBattleCount(
  db: D1Database,
  agentId: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM battle_records WHERE agent_id = ?')
    .bind(agentId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// ─── Faucet Queries ─────────────────────────────────────────────

/** Faucet tier config: amount awarded per tier. */
export const FAUCET_TIERS: Record<number, { amount: number; label: string }> = {
  1: { amount: 100, label: 'Basic' },
  2: { amount: 500, label: 'Bettor' },
  3: { amount: 1000, label: 'Sponsor' },
};

/** 24 hours in milliseconds. */
const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function insertFaucetClaim(
  db: D1Database,
  claim: FaucetClaimRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO faucet_claims (id, wallet_address, tier, amount, claimed_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(claim.id, claim.wallet_address, claim.tier, claim.amount, claim.claimed_at)
    .run();
}

/**
 * Get the most recent faucet claim for a wallet + tier combo.
 * Returns null if never claimed.
 */
export async function getLastFaucetClaim(
  db: D1Database,
  walletAddress: string,
  tier: number,
): Promise<FaucetClaimRow | null> {
  return db
    .prepare(
      'SELECT * FROM faucet_claims WHERE wallet_address = ? AND tier = ? ORDER BY claimed_at DESC LIMIT 1',
    )
    .bind(walletAddress, tier)
    .first<FaucetClaimRow>();
}

/**
 * Check if a wallet can claim a specific faucet tier (24h cooldown).
 * Returns { eligible, nextClaimAt } where nextClaimAt is null if eligible now.
 */
export async function checkFaucetEligibility(
  db: D1Database,
  walletAddress: string,
  tier: number,
): Promise<{ eligible: boolean; nextClaimAt: string | null }> {
  const lastClaim = await getLastFaucetClaim(db, walletAddress, tier);
  if (!lastClaim) {
    return { eligible: true, nextClaimAt: null };
  }

  const lastClaimTime = new Date(lastClaim.claimed_at).getTime();
  const nextEligible = lastClaimTime + FAUCET_COOLDOWN_MS;
  const now = Date.now();

  if (now >= nextEligible) {
    return { eligible: true, nextClaimAt: null };
  }

  return {
    eligible: false,
    nextClaimAt: new Date(nextEligible).toISOString(),
  };
}

/**
 * Count total bets placed by a wallet address.
 */
export async function getUserBetCount(
  db: D1Database,
  walletAddress: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM bets WHERE user_address = ?')
    .bind(walletAddress)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Count total sponsorships by a wallet address.
 */
export async function getUserSponsorCount(
  db: D1Database,
  walletAddress: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM sponsorships WHERE sponsor_address = ?')
    .bind(walletAddress)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Get all faucet claims for a wallet, ordered by most recent first.
 */
export async function getFaucetClaimsByWallet(
  db: D1Database,
  walletAddress: string,
): Promise<FaucetClaimRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM faucet_claims WHERE wallet_address = ? ORDER BY claimed_at DESC',
    )
    .bind(walletAddress)
    .all<FaucetClaimRow>();
  return result.results;
}

// ─── Token Stats Queries ───────────────────────────────────────

/**
 * Get total amount of HNADS burned from sponsorships and total sponsorship count.
 */
export async function getTotalBurnedStats(
  db: D1Database,
): Promise<{ totalBurned: number; totalSponsorships: number }> {
  const row = await db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) as total_burned, COUNT(*) as total_sponsorships FROM sponsorships',
    )
    .first<{ total_burned: number; total_sponsorships: number }>();
  return {
    totalBurned: row?.total_burned ?? 0,
    totalSponsorships: row?.total_sponsorships ?? 0,
  };
}

/**
 * Get total amount of HNADS distributed via faucet.
 */
export async function getTotalFaucetDistributed(
  db: D1Database,
): Promise<{ totalDistributed: number; totalClaims: number }> {
  const row = await db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) as total_distributed, COUNT(*) as total_claims FROM faucet_claims',
    )
    .first<{ total_distributed: number; total_claims: number }>();
  return {
    totalDistributed: row?.total_distributed ?? 0,
    totalClaims: row?.total_claims ?? 0,
  };
}

// ─── Jackpot Pool Queries ──────────────────────────────────────

/**
 * Get the current accumulated jackpot pool.
 * The jackpot is 3% of each battle's pool carried forward to the next battle.
 * Returns 0 if no jackpot has been accumulated yet.
 */
export async function getJackpotPool(db: D1Database): Promise<number> {
  // Ensure the table exists (idempotent).
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS jackpot_pool (id INTEGER PRIMARY KEY CHECK (id = 1), amount REAL NOT NULL DEFAULT 0)',
    )
    .run();

  const row = await db
    .prepare('SELECT amount FROM jackpot_pool WHERE id = 1')
    .first<{ amount: number }>();

  return row?.amount ?? 0;
}

/**
 * Set the jackpot pool to a new amount (replaces the previous value).
 * Called after each battle settlement with the 3% carry-forward.
 */
export async function setJackpotPool(
  db: D1Database,
  amount: number,
): Promise<void> {
  // Ensure the table exists (idempotent).
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS jackpot_pool (id INTEGER PRIMARY KEY CHECK (id = 1), amount REAL NOT NULL DEFAULT 0)',
    )
    .run();

  await db
    .prepare(
      'INSERT INTO jackpot_pool (id, amount) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET amount = excluded.amount',
    )
    .bind(amount)
    .run();
}

// ─── Season Queries ─────────────────────────────────────────────

/** Number of battles per season. */
export const BATTLES_PER_SEASON = 50;

/** Days after season end before unclaimed payouts are burned. */
export const CLAIM_WINDOW_DAYS = 7;

/** Number of top bettors who receive the Schadenfreude payout. */
export const SCHADENFREUDE_TOP_N = 10;

/**
 * Get the current active season. Returns null if none exists.
 */
export async function getActiveSeason(
  db: D1Database,
): Promise<SeasonRow | null> {
  return db
    .prepare("SELECT * FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1")
    .first<SeasonRow>();
}

/**
 * Get a season by ID.
 */
export async function getSeason(
  db: D1Database,
  seasonId: string,
): Promise<SeasonRow | null> {
  return db
    .prepare('SELECT * FROM seasons WHERE id = ?')
    .bind(seasonId)
    .first<SeasonRow>();
}

/**
 * Get a season by number.
 */
export async function getSeasonByNumber(
  db: D1Database,
  seasonNumber: number,
): Promise<SeasonRow | null> {
  return db
    .prepare('SELECT * FROM seasons WHERE season_number = ?')
    .bind(seasonNumber)
    .first<SeasonRow>();
}

/**
 * Create a new season.
 */
export async function insertSeason(
  db: D1Database,
  season: SeasonRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO seasons (id, season_number, status, started_at, ended_at, battle_count, schadenfreude_pool, total_distributed, total_burned, claim_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      season.id,
      season.season_number,
      season.status,
      season.started_at,
      season.ended_at,
      season.battle_count,
      season.schadenfreude_pool,
      season.total_distributed,
      season.total_burned,
      season.claim_deadline,
    )
    .run();
}

/**
 * Update season fields.
 */
export async function updateSeason(
  db: D1Database,
  id: string,
  fields: Partial<Omit<SeasonRow, 'id'>>,
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) {
    setClauses.push('status = ?');
    values.push(fields.status);
  }
  if (fields.ended_at !== undefined) {
    setClauses.push('ended_at = ?');
    values.push(fields.ended_at);
  }
  if (fields.battle_count !== undefined) {
    setClauses.push('battle_count = ?');
    values.push(fields.battle_count);
  }
  if (fields.schadenfreude_pool !== undefined) {
    setClauses.push('schadenfreude_pool = ?');
    values.push(fields.schadenfreude_pool);
  }
  if (fields.total_distributed !== undefined) {
    setClauses.push('total_distributed = ?');
    values.push(fields.total_distributed);
  }
  if (fields.total_burned !== undefined) {
    setClauses.push('total_burned = ?');
    values.push(fields.total_burned);
  }
  if (fields.claim_deadline !== undefined) {
    setClauses.push('claim_deadline = ?');
    values.push(fields.claim_deadline);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  await db
    .prepare(`UPDATE seasons SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Get the total number of completed battles (for season tracking).
 */
export async function getCompletedBattleCount(
  db: D1Database,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM battles WHERE status = 'COMPLETED'")
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Insert a season leaderboard entry.
 */
export async function insertSeasonLeaderboardEntry(
  db: D1Database,
  entry: SeasonLeaderboardRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO season_leaderboard (id, season_id, rank, user_address, profit, total_wagered, total_payout, win_count, bet_count, schadenfreude_payout, claimed, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.id,
      entry.season_id,
      entry.rank,
      entry.user_address,
      entry.profit,
      entry.total_wagered,
      entry.total_payout,
      entry.win_count,
      entry.bet_count,
      entry.schadenfreude_payout,
      entry.claimed,
      entry.claimed_at,
    )
    .run();
}

/**
 * Get the leaderboard for a season.
 */
export async function getSeasonLeaderboard(
  db: D1Database,
  seasonId: string,
): Promise<SeasonLeaderboardRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM season_leaderboard WHERE season_id = ? ORDER BY rank ASC',
    )
    .bind(seasonId)
    .all<SeasonLeaderboardRow>();
  return result.results;
}

/**
 * Mark a season leaderboard entry as claimed.
 */
export async function claimSeasonPayout(
  db: D1Database,
  entryId: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE season_leaderboard SET claimed = 1, claimed_at = ? WHERE id = ?',
    )
    .bind(new Date().toISOString(), entryId)
    .run();
}

/**
 * Get unclaimed entries for a season (for burn processing).
 */
export async function getUnclaimedSeasonEntries(
  db: D1Database,
  seasonId: string,
): Promise<SeasonLeaderboardRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM season_leaderboard WHERE season_id = ? AND claimed = 0',
    )
    .bind(seasonId)
    .all<SeasonLeaderboardRow>();
  return result.results;
}

/**
 * Get all ended seasons past their claim deadline (for burn processing).
 */
export async function getExpiredSeasons(
  db: D1Database,
): Promise<SeasonRow[]> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      "SELECT * FROM seasons WHERE status = 'ended' AND claim_deadline IS NOT NULL AND claim_deadline < ?",
    )
    .bind(now)
    .all<SeasonRow>();
  return result.results;
}

/**
 * Get top bettors by profit across all settled bets (for season leaderboard snapshot).
 * Returns the top N bettors ranked by profit.
 */
export async function getTopBettorsByProfit(
  db: D1Database,
  limit: number = 10,
): Promise<
  Array<{
    user_address: string;
    profit: number;
    total_wagered: number;
    total_payout: number;
    win_count: number;
    bet_count: number;
  }>
> {
  const result = await db
    .prepare(
      `SELECT
         user_address,
         SUM(payout) - SUM(amount) as profit,
         SUM(amount) as total_wagered,
         SUM(payout) as total_payout,
         SUM(CASE WHEN payout > amount THEN 1 ELSE 0 END) as win_count,
         COUNT(*) as bet_count
       FROM bets
       WHERE settled = 1
       GROUP BY user_address
       HAVING profit > 0
       ORDER BY profit DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      user_address: string;
      profit: number;
      total_wagered: number;
      total_payout: number;
      win_count: number;
      bet_count: number;
    }>();
  return result.results;
}

/**
 * Get a user's season leaderboard entry.
 */
export async function getUserSeasonEntry(
  db: D1Database,
  seasonId: string,
  userAddress: string,
): Promise<SeasonLeaderboardRow | null> {
  return db
    .prepare(
      'SELECT * FROM season_leaderboard WHERE season_id = ? AND user_address = ?',
    )
    .bind(seasonId, userAddress)
    .first<SeasonLeaderboardRow>();
}

/**
 * List all seasons, ordered by season_number descending.
 */
export async function listSeasons(
  db: D1Database,
  limit: number = 10,
): Promise<SeasonRow[]> {
  const result = await db
    .prepare('SELECT * FROM seasons ORDER BY season_number DESC LIMIT ?')
    .bind(limit)
    .all<SeasonRow>();
  return result.results;
}

// ─── Streak Tracking Queries ──────────────────────────────────

/**
 * Get the streak tracking record for a wallet. Returns null if not tracked yet.
 */
export async function getStreakTracking(
  db: D1Database,
  walletAddress: string,
): Promise<StreakTrackingRow | null> {
  return db
    .prepare('SELECT * FROM streak_tracking WHERE wallet_address = ?')
    .bind(walletAddress)
    .first<StreakTrackingRow>();
}

/**
 * Upsert a wallet's streak tracking. Increments or resets current_streak,
 * updates max_streak if exceeded, and records the battle ID.
 */
export async function upsertStreakTracking(
  db: D1Database,
  walletAddress: string,
  currentStreak: number,
  maxStreak: number,
  lastBetBattleId: string,
  bonusToAdd: number = 0,
): Promise<void> {
  const now = new Date().toISOString();

  // Ensure table exists (idempotent, for safety during rollout)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS streak_tracking (
        wallet_address TEXT NOT NULL PRIMARY KEY,
        current_streak INTEGER NOT NULL DEFAULT 0,
        max_streak INTEGER NOT NULL DEFAULT 0,
        last_bet_battle_id TEXT,
        total_streak_bonus REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO streak_tracking (wallet_address, current_streak, max_streak, last_bet_battle_id, total_streak_bonus, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet_address) DO UPDATE SET
         current_streak = excluded.current_streak,
         max_streak = MAX(streak_tracking.max_streak, excluded.max_streak),
         last_bet_battle_id = excluded.last_bet_battle_id,
         total_streak_bonus = streak_tracking.total_streak_bonus + ?,
         updated_at = excluded.updated_at`,
    )
    .bind(walletAddress, currentStreak, maxStreak, lastBetBattleId, bonusToAdd, now, bonusToAdd)
    .run();
}

/**
 * Get the top streakers (highest current_streak or max_streak).
 */
export async function getTopStreakers(
  db: D1Database,
  limit: number = 20,
): Promise<StreakTrackingRow[]> {
  // Ensure table exists
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS streak_tracking (
        wallet_address TEXT NOT NULL PRIMARY KEY,
        current_streak INTEGER NOT NULL DEFAULT 0,
        max_streak INTEGER NOT NULL DEFAULT 0,
        last_bet_battle_id TEXT,
        total_streak_bonus REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();

  const result = await db
    .prepare(
      'SELECT * FROM streak_tracking ORDER BY current_streak DESC, max_streak DESC LIMIT ?',
    )
    .bind(limit)
    .all<StreakTrackingRow>();
  return result.results;
}

// ─── Generative Memory Row Types ─────────────────────────────

export interface MemoryObservationRow {
  id: string;
  agent_id: string;
  battle_id: string;
  epoch: number;
  event_type: string;
  description: string;
  importance: number;
  tags_json: string;
  created_at: string;
}

export interface MemoryReflectionRow {
  id: string;
  agent_id: string;
  source_observation_ids_json: string;
  insight: string;
  importance: number;
  abstraction_level: number;
  tags_json: string;
  created_at: string;
}

export interface MemoryPlanRow {
  id: string;
  agent_id: string;
  source_reflection_ids_json: string;
  plan_text: string;
  status: string;
  importance: number;
  tags_json: string;
  created_at: string;
  applied_at: string | null;
}

// ─── Generative Memory Queries ──────────────────────────────

export async function insertMemoryObservation(
  db: D1Database,
  row: MemoryObservationRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO memory_observations
       (id, agent_id, battle_id, epoch, event_type, description, importance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.agent_id,
      row.battle_id,
      row.epoch,
      row.event_type,
      row.description,
      row.importance,
      row.tags_json,
      row.created_at,
    )
    .run();
}

export async function getAgentObservations(
  db: D1Database,
  agentId: string,
  limit: number = 50,
): Promise<MemoryObservationRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_observations WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<MemoryObservationRow>();
  return result.results;
}

export async function getObservationsByBattle(
  db: D1Database,
  agentId: string,
  battleId: string,
): Promise<MemoryObservationRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_observations WHERE agent_id = ? AND battle_id = ? ORDER BY epoch ASC',
    )
    .bind(agentId, battleId)
    .all<MemoryObservationRow>();
  return result.results;
}

export async function getRecentMemoryObservations(
  db: D1Database,
  agentId: string,
  limit: number = 20,
): Promise<MemoryObservationRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_observations WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<MemoryObservationRow>();
  return result.results;
}

export async function getHighImportanceObservations(
  db: D1Database,
  agentId: string,
  minImportance: number = 7,
  limit: number = 20,
): Promise<MemoryObservationRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_observations WHERE agent_id = ? AND importance >= ? ORDER BY importance DESC, created_at DESC LIMIT ?',
    )
    .bind(agentId, minImportance, limit)
    .all<MemoryObservationRow>();
  return result.results;
}

export async function insertMemoryReflection(
  db: D1Database,
  row: MemoryReflectionRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO memory_reflections
       (id, agent_id, source_observation_ids_json, insight, importance, abstraction_level, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.agent_id,
      row.source_observation_ids_json,
      row.insight,
      row.importance,
      row.abstraction_level,
      row.tags_json,
      row.created_at,
    )
    .run();
}

export async function getAgentReflections(
  db: D1Database,
  agentId: string,
  limit: number = 20,
): Promise<MemoryReflectionRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_reflections WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<MemoryReflectionRow>();
  return result.results;
}

export async function getReflectionsByAbstraction(
  db: D1Database,
  agentId: string,
  level: number,
  limit: number = 10,
): Promise<MemoryReflectionRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_reflections WHERE agent_id = ? AND abstraction_level = ? ORDER BY importance DESC, created_at DESC LIMIT ?',
    )
    .bind(agentId, level, limit)
    .all<MemoryReflectionRow>();
  return result.results;
}

export async function insertMemoryPlan(
  db: D1Database,
  row: MemoryPlanRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO memory_plans
       (id, agent_id, source_reflection_ids_json, plan_text, status, importance, tags_json, created_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.agent_id,
      row.source_reflection_ids_json,
      row.plan_text,
      row.status,
      row.importance,
      row.tags_json,
      row.created_at,
      row.applied_at,
    )
    .run();
}

export async function getActivePlans(
  db: D1Database,
  agentId: string,
  limit: number = 5,
): Promise<MemoryPlanRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM memory_plans WHERE agent_id = ? AND status = 'active' ORDER BY importance DESC, created_at DESC LIMIT ?",
    )
    .bind(agentId, limit)
    .all<MemoryPlanRow>();
  return result.results;
}

export async function getAgentPlans(
  db: D1Database,
  agentId: string,
  limit: number = 20,
): Promise<MemoryPlanRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM memory_plans WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(agentId, limit)
    .all<MemoryPlanRow>();
  return result.results;
}

export async function updatePlanStatus(
  db: D1Database,
  planId: string,
  status: string,
  appliedAt?: string,
): Promise<void> {
  if (appliedAt) {
    await db
      .prepare('UPDATE memory_plans SET status = ?, applied_at = ? WHERE id = ?')
      .bind(status, appliedAt, planId)
      .run();
  } else {
    await db
      .prepare('UPDATE memory_plans SET status = ? WHERE id = ?')
      .bind(status, planId)
      .run();
  }
}

export async function supersedePlansByAgent(
  db: D1Database,
  agentId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE memory_plans SET status = 'superseded' WHERE agent_id = ? AND status = 'active'",
    )
    .bind(agentId)
    .run();
}

// ─── Streak Pool Queries ──────────────────────────────────────

/**
 * Get the current accumulated streak bonus pool.
 * The pool is 2% of each battle's total pool, accumulated across battles.
 * Returns 0 if no pool has been accumulated yet.
 */
export async function getStreakPool(db: D1Database): Promise<number> {
  // Ensure the table exists (idempotent).
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS streak_pool (id INTEGER PRIMARY KEY CHECK (id = 1), amount REAL NOT NULL DEFAULT 0)',
    )
    .run();

  const row = await db
    .prepare('SELECT amount FROM streak_pool WHERE id = 1')
    .first<{ amount: number }>();

  return row?.amount ?? 0;
}

/**
 * Set the streak pool to a new amount (replaces the previous value).
 * Called after each battle settlement: add 2%, subtract awarded bonuses.
 */
export async function setStreakPool(
  db: D1Database,
  amount: number,
): Promise<void> {
  // Ensure the table exists (idempotent).
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS streak_pool (id INTEGER PRIMARY KEY CHECK (id = 1), amount REAL NOT NULL DEFAULT 0)',
    )
    .run();

  await db
    .prepare(
      'INSERT INTO streak_pool (id, amount) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET amount = excluded.amount',
    )
    .bind(amount)
    .run();
}

// ─── Season-Scoped Queries ───────────────────────────────────────

/**
 * Get battles belonging to a specific season.
 */
export async function getBattlesBySeason(
  db: D1Database,
  seasonId: string,
): Promise<BattleRow[]> {
  const result = await db
    .prepare('SELECT * FROM battles WHERE season_id = ? ORDER BY started_at ASC')
    .bind(seasonId)
    .all<BattleRow>();
  return result.results;
}

/**
 * Get top bettors by profit for a specific season (using season_id on battles).
 * Only considers bets on battles that belong to the given season.
 */
export async function getTopBettorsByProfitForSeason(
  db: D1Database,
  seasonId: string,
  limit: number = 10,
): Promise<
  Array<{
    user_address: string;
    profit: number;
    total_wagered: number;
    total_payout: number;
    win_count: number;
    bet_count: number;
  }>
> {
  const result = await db
    .prepare(
      `SELECT
         b.user_address,
         SUM(b.payout) - SUM(b.amount) as profit,
         SUM(b.amount) as total_wagered,
         SUM(b.payout) as total_payout,
         SUM(CASE WHEN b.payout > b.amount THEN 1 ELSE 0 END) as win_count,
         COUNT(*) as bet_count
       FROM bets b
       INNER JOIN battles bt ON b.battle_id = bt.id
       WHERE b.settled = 1 AND bt.season_id = ?
       GROUP BY b.user_address
       HAVING profit > 0
       ORDER BY profit DESC
       LIMIT ?`,
    )
    .bind(seasonId, limit)
    .all<{
      user_address: string;
      profit: number;
      total_wagered: number;
      total_payout: number;
      win_count: number;
      bet_count: number;
    }>();
  return result.results;
}

/**
 * Get agent performance stats for a specific season (using season_id on battles).
 * Aggregates battle_records for battles in the given season.
 */
export async function getAgentStatsForSeason(
  db: D1Database,
  seasonId: string,
  limit: number = 20,
): Promise<
  Array<{
    agent_id: string;
    agent_class: string;
    agent_name: string;
    wins: number;
    losses: number;
    kills: number;
    total_battles: number;
    avg_epochs_survived: number;
    win_rate: number;
  }>
> {
  const result = await db
    .prepare(
      `SELECT
         br.agent_id,
         br.agent_class,
         a.name as agent_name,
         SUM(CASE WHEN br.result = 'win' THEN 1 ELSE 0 END) as wins,
         SUM(CASE WHEN br.result != 'win' THEN 1 ELSE 0 END) as losses,
         SUM(br.kills) as kills,
         COUNT(*) as total_battles,
         AVG(br.epochs_survived) as avg_epochs_survived,
         CAST(SUM(CASE WHEN br.result = 'win' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as win_rate
       FROM battle_records br
       INNER JOIN battles bt ON br.battle_id = bt.id
       INNER JOIN agents a ON br.agent_id = a.id
       WHERE bt.season_id = ?
       GROUP BY br.agent_id
       HAVING total_battles >= 1
       ORDER BY win_rate DESC, kills DESC
       LIMIT ?`,
    )
    .bind(seasonId, limit)
    .all<{
      agent_id: string;
      agent_class: string;
      agent_name: string;
      wins: number;
      losses: number;
      kills: number;
      total_battles: number;
      avg_epochs_survived: number;
      win_rate: number;
    }>();
  return result.results;
}

// ─── Season Agent Leaderboard Queries ────────────────────────────

/**
 * Insert a season agent leaderboard entry.
 */
export async function insertSeasonAgentLeaderboardEntry(
  db: D1Database,
  entry: SeasonAgentLeaderboardRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO season_agent_leaderboard
       (id, season_id, rank, agent_id, agent_class, agent_name, wins, losses, kills, total_battles, avg_epochs_survived, win_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.season_id,
      entry.rank,
      entry.agent_id,
      entry.agent_class,
      entry.agent_name,
      entry.wins,
      entry.losses,
      entry.kills,
      entry.total_battles,
      entry.avg_epochs_survived,
      entry.win_rate,
    )
    .run();
}

/**
 * Get the agent leaderboard for a season.
 */
export async function getSeasonAgentLeaderboard(
  db: D1Database,
  seasonId: string,
): Promise<SeasonAgentLeaderboardRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM season_agent_leaderboard WHERE season_id = ? ORDER BY rank ASC',
    )
    .bind(seasonId)
    .all<SeasonAgentLeaderboardRow>();
  return result.results;
}

/**
 * Get season stats summary: total bets, total wagered, total bettors for a season.
 */
export async function getSeasonBettingStats(
  db: D1Database,
  seasonId: string,
): Promise<{
  totalBets: number;
  totalWagered: number;
  totalPayout: number;
  uniqueBettors: number;
}> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) as total_bets,
         COALESCE(SUM(b.amount), 0) as total_wagered,
         COALESCE(SUM(b.payout), 0) as total_payout,
         COUNT(DISTINCT b.user_address) as unique_bettors
       FROM bets b
       INNER JOIN battles bt ON b.battle_id = bt.id
       WHERE bt.season_id = ?`,
    )
    .bind(seasonId)
    .first<{
      total_bets: number;
      total_wagered: number;
      total_payout: number;
      unique_bettors: number;
    }>();
  return {
    totalBets: row?.total_bets ?? 0,
    totalWagered: row?.total_wagered ?? 0,
    totalPayout: row?.total_payout ?? 0,
    uniqueBettors: row?.unique_bettors ?? 0,
  };
}
