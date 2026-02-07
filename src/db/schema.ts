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
}

export interface BattleRow {
  id: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  winner_id: string | null;
  epoch_count: number;
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

// ─── Agent Queries ───────────────────────────────────────────────

export async function insertAgent(
  db: D1Database,
  agent: AgentRow,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO agents (id, class, name, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(agent.id, agent.class, agent.name, agent.created_at)
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
      'INSERT INTO battles (id, status, started_at, ended_at, winner_id, epoch_count) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      battle.id,
      battle.status ?? 'pending',
      battle.started_at ?? null,
      battle.ended_at ?? null,
      battle.winner_id ?? null,
      battle.epoch_count ?? 0,
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

  if (setClauses.length === 0) return;

  values.push(id);
  await db
    .prepare(`UPDATE battles SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
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
      'INSERT INTO sponsorships (id, battle_id, agent_id, sponsor_address, amount, message, accepted) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      sponsorship.id,
      sponsorship.battle_id,
      sponsorship.agent_id,
      sponsorship.sponsor_address,
      sponsorship.amount,
      sponsorship.message,
      sponsorship.accepted,
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
