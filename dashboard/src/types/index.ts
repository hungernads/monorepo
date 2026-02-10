/** Agent class archetypes */
export type AgentClass = "WARRIOR" | "TRADER" | "SURVIVOR" | "PARASITE" | "GAMBLER";

/** Tradable assets */
export type Asset = "ETH" | "BTC" | "SOL" | "MON";

/** Prediction direction */
export type Direction = "UP" | "DOWN";

/** Battle lifecycle status */
export type BattleStatus = "PENDING" | "LOBBY" | "COUNTDOWN" | "BETTING_OPEN" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "SETTLED";

/** Agent state within a battle */
export interface AgentState {
  id: string;
  name: string;
  class: AgentClass;
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  /** Rolling buffer of the agent's recent LLM reasoning snippets (thought feed). */
  thoughts?: string[];
}

/** Market prediction action */
export interface Prediction {
  asset: Asset;
  direction: Direction;
  stake: number;
}

/** Combat attack action */
export interface Attack {
  target: string;
  stake: number;
}

/** Full set of actions an agent takes per epoch */
export interface EpochActions {
  prediction: Prediction;
  attack?: Attack;
  defend?: boolean;
  reasoning: string;
}

/** Single epoch result */
export interface EpochResult {
  epochNumber: number;
  timestamp: number;
  actions: Record<string, EpochActions>;
  results: Record<string, EpochOutcome>;
  deaths: string[];
  marketPrices: Record<Asset, number>;
}

/** Outcome for one agent in one epoch */
export interface EpochOutcome {
  predictionCorrect: boolean;
  hpChange: number;
  hpAfter: number;
  attackResult?: {
    target: string;
    damage: number;
    blocked: boolean;
  };
}

/** Battle state */
export interface Battle {
  id: string;
  status: BattleStatus;
  agents: AgentState[];
  currentEpoch: number;
  epochs: EpochResult[];
  winner?: string;
  startedAt: number;
  endedAt?: number;
}

/** Agent lesson from a battle */
export interface Lesson {
  battleId: string;
  context: string;
  outcome: string;
  learning: string;
  applied: string;
}

/** Agent profile (cross-battle) */
export interface AgentProfile {
  id: string;
  name: string;
  class: AgentClass;
  totalBattles: number;
  wins: number;
  losses: number;
  totalKills: number;
  avgSurvivalEpochs: number;
  lessons: Lesson[];
  matchups: Record<AgentClass, { wins: number; losses: number }>;
}

/** Bet placed by a user */
export interface Bet {
  id: string;
  battleId: string;
  user: string;
  agentId: string;
  amount: number;
  placedAt: number;
}

/** Live odds for a battle */
export interface BattleOdds {
  battleId: string;
  odds: Record<string, number>;
  totalPool: number;
}

/** How an agent died */
export type DeathCause = "prediction" | "combat" | "bleed" | "multi";

/** Battle history entry for an agent */
export interface BattleHistoryEntry {
  battleId: string;
  date: string;
  result: "WON" | "LOST" | "REKT";
  epochsSurvived: number;
  hpRemaining: number;
  kills: number;
}

/** Extended agent profile with death stats, streak, and history */
export interface AgentProfileFull extends AgentProfile {
  currentStreak: number;
  deathCauses: Record<DeathCause, number>;
  battleHistory: BattleHistoryEntry[];
}

/** Sponsorship gift */
export interface Sponsorship {
  id: string;
  battleId: string;
  user: string;
  agentId: string;
  amount: number;
  message?: string;
  sentAt: number;
}

/** WebSocket event types */
export type WSEventType =
  | "BATTLE_START"
  | "EPOCH_RESULT"
  | "AGENT_DEATH"
  | "BATTLE_END"
  | "BET_PLACED"
  | "ODDS_UPDATE"
  | "SPONSORSHIP";

/** WebSocket event wrapper */
export interface WSEvent<T = unknown> {
  type: WSEventType;
  battleId: string;
  data: T;
  timestamp: number;
}
