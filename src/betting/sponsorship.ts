/**
 * HUNGERNADS - Hunger Games Style Sponsorship (Tiered)
 *
 * "Parachute drops" from the crowd. Users send support to agents mid-battle.
 * 5 tiers of sponsorship with escalating costs and strategic effects:
 *
 *   1. BREAD_RATION   (10 HNADS)  → +25 HP
 *   2. MEDICINE_KIT    (25 HNADS)  → +75 HP
 *   3. ARMOR_PLATING   (50 HNADS)  → +50 HP + free defend (no cost this epoch)
 *   4. WEAPON_CACHE    (75 HNADS)  → +25 HP + 25% attack damage boost
 *   5. CORNUCOPIA      (150 HNADS) → +150 HP + 25% attack boost + free defend
 *
 * Rules:
 *   - 1 sponsorship per agent per epoch (cap enforced in DB)
 *   - All tokens 100% burned (sent to 0xdEaD on-chain)
 *   - Effects apply during the NEXT epoch after sponsorship is placed
 *   - HP boosts are capped at maxHp (1000)
 *
 * For MVP, agents always accept sponsorships immediately.
 */

import {
  insertSponsorship,
  acceptSponsorship,
  getSponsorshipsByBattle,
  getSponsorshipsByAgent,
  getSponsorshipsByEpoch,
  hasAgentSponsorshipForEpoch,
  type SponsorshipRow,
} from '../db/schema';

// ─── Sponsor Tier Enum ──────────────────────────────────────────

export const SPONSOR_TIERS = [
  'BREAD_RATION',
  'MEDICINE_KIT',
  'ARMOR_PLATING',
  'WEAPON_CACHE',
  'CORNUCOPIA',
] as const;

export type SponsorTier = (typeof SPONSOR_TIERS)[number];

// ─── Tier Configuration ─────────────────────────────────────────

export interface TierConfig {
  tier: SponsorTier;
  /** Display name for the UI / feed. */
  name: string;
  /** Cost in HNADS tokens (burned). */
  cost: number;
  /** HP restored on application. */
  hpBoost: number;
  /** If true, the agent's defend cost is waived this epoch. */
  freeDefend: boolean;
  /** Multiplicative attack damage boost (0.25 = +25%). 0 = no boost. */
  attackBoost: number;
  /** Flavor text for the spectator feed. */
  description: string;
}

export const TIER_CONFIGS: Record<SponsorTier, TierConfig> = {
  BREAD_RATION: {
    tier: 'BREAD_RATION',
    name: 'Bread Ration',
    cost: 10,
    hpBoost: 25,
    freeDefend: false,
    attackBoost: 0,
    description: 'A humble offering. Keeps the gladiator fighting another round.',
  },
  MEDICINE_KIT: {
    tier: 'MEDICINE_KIT',
    name: 'Medicine Kit',
    cost: 25,
    hpBoost: 75,
    freeDefend: false,
    attackBoost: 0,
    description: 'Advanced healing. A second chance from a generous sponsor.',
  },
  ARMOR_PLATING: {
    tier: 'ARMOR_PLATING',
    name: 'Armor Plating',
    cost: 50,
    hpBoost: 50,
    freeDefend: true,
    attackBoost: 0,
    description: 'Reinforced armor. Defend without paying the blood price.',
  },
  WEAPON_CACHE: {
    tier: 'WEAPON_CACHE',
    name: 'Weapon Cache',
    cost: 75,
    hpBoost: 25,
    freeDefend: false,
    attackBoost: 0.25,
    description: 'Superior weaponry. +25% attack damage. The crowd demands blood.',
  },
  CORNUCOPIA: {
    tier: 'CORNUCOPIA',
    name: 'Cornucopia',
    cost: 150,
    hpBoost: 150,
    freeDefend: true,
    attackBoost: 0.25,
    description: 'The ultimate gift. Full restoration, free defense, and deadly weapons.',
  },
};

// ─── Constants ──────────────────────────────────────────────────

/** Absolute HP ceiling — agents cannot exceed this. */
export const MAX_HP_CAP = 1000;

/** Minimum sponsorship amount (for legacy non-tiered flow). */
export const MIN_SPONSORSHIP_AMOUNT = 1;

/** Maximum HP a single non-tiered sponsorship can restore (legacy). */
export const MAX_HP_BOOST = 200;

// ─── Types ──────────────────────────────────────────────────────

export interface Sponsorship {
  id: string;
  battleId: string;
  agentId: string;
  sponsorAddress: string;
  amount: number;
  message: string;
  accepted: boolean;
  hpBoost: number;
  /** Sponsorship tokens are burned on-chain (sent to 0xdEaD), not added to the betting pool. */
  burned: boolean;
  /** Tier selected by the sponsor. Null for legacy non-tiered sponsorships. */
  tier: SponsorTier | null;
  /** Epoch this sponsorship targets. Null for legacy flow. */
  epochNumber: number | null;
}

/**
 * Active combat effects from a sponsorship, applied during epoch processing.
 * One per agent per epoch (at most).
 */
export interface SponsorEffect {
  agentId: string;
  tier: SponsorTier;
  hpBoost: number;
  /** Waive the 3% defend cost for this epoch. */
  freeDefend: boolean;
  /** Additional attack damage multiplier (additive with class modifier). */
  attackBoost: number;
  /** Sponsorship ID for traceability. */
  sponsorshipId: string;
  /** Sponsor's display message. */
  message: string;
}

export interface SponsorshipResult {
  sponsorship: Sponsorship;
  hpBefore: number;
  hpAfter: number;
  actualBoost: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Validate a tier string. Returns the SponsorTier or null if invalid.
 */
export function parseSponsorTier(tierStr: string | null | undefined): SponsorTier | null {
  if (!tierStr) return null;
  const upper = tierStr.toUpperCase() as SponsorTier;
  return SPONSOR_TIERS.includes(upper) ? upper : null;
}

/**
 * Get the tier config, or null for invalid tier.
 */
export function getTierConfig(tier: SponsorTier): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Calculate HP boost from a raw sponsorship amount (legacy non-tiered flow).
 * Scales linearly: 1 amount = 1 HP, capped at MAX_HP_BOOST.
 */
export function calculateHpBoost(amount: number, tier?: SponsorTier | null): number {
  if (tier) {
    return TIER_CONFIGS[tier].hpBoost;
  }
  // Legacy: linear scaling
  if (amount <= 0) return 0;
  return Math.min(Math.floor(amount), MAX_HP_BOOST);
}

/**
 * Convert a DB row to the public Sponsorship shape.
 */
function rowToSponsorship(row: SponsorshipRow): Sponsorship {
  const tier = parseSponsorTier(row.tier);
  return {
    id: row.id,
    battleId: row.battle_id,
    agentId: row.agent_id,
    sponsorAddress: row.sponsor_address,
    amount: row.amount,
    message: row.message ?? '',
    accepted: row.accepted === 1,
    hpBoost: calculateHpBoost(row.amount, tier),
    burned: true, // All sponsorships are burned on-chain (sent to 0xdEaD)
    tier,
    epochNumber: row.epoch_number,
  };
}

/**
 * Convert a DB row for a tiered sponsorship into a SponsorEffect for combat resolution.
 */
function rowToSponsorEffect(row: SponsorshipRow): SponsorEffect | null {
  const tier = parseSponsorTier(row.tier);
  if (!tier) return null;

  const config = TIER_CONFIGS[tier];
  return {
    agentId: row.agent_id,
    tier,
    hpBoost: config.hpBoost,
    freeDefend: config.freeDefend,
    attackBoost: config.attackBoost,
    sponsorshipId: row.id,
    message: row.message ?? '',
  };
}

// ─── Manager ────────────────────────────────────────────────────

export class SponsorshipManager {
  constructor(private db: D1Database) {}

  /**
   * Send a tiered sponsorship to an agent in a battle.
   *
   * Validates the tier, enforces 1-per-agent-per-epoch cap, and records
   * the sponsorship. The amount MUST match the tier cost exactly.
   *
   * @param battleId      Target battle
   * @param agentId       Target agent
   * @param sponsorAddress Sponsor's wallet address
   * @param amount         Token amount (must match tier cost)
   * @param message        Public message from the sponsor
   * @param tier           Sponsorship tier
   * @param epochNumber    Target epoch (effects apply during this epoch)
   * @param txHash         On-chain burn transaction hash (optional for DEMO tier)
   */
  async sponsorTiered(
    battleId: string,
    agentId: string,
    sponsorAddress: string,
    amount: number,
    message: string,
    tier: SponsorTier,
    epochNumber: number,
    txHash?: string | null,
  ): Promise<Sponsorship> {
    const config = TIER_CONFIGS[tier];

    // Validate amount matches tier cost
    if (amount < config.cost) {
      throw new Error(
        `${config.name} requires ${config.cost} HNADS, got ${amount}`,
      );
    }

    // Enforce 1-per-agent-per-epoch cap
    const alreadySponsored = await hasAgentSponsorshipForEpoch(
      this.db,
      battleId,
      agentId,
      epochNumber,
    );
    if (alreadySponsored) {
      throw new Error(
        `Agent ${agentId} already has a sponsorship for epoch ${epochNumber}. Limit: 1 per agent per epoch.`,
      );
    }

    const id = generateId();

    const row: SponsorshipRow = {
      id,
      battle_id: battleId,
      agent_id: agentId,
      sponsor_address: sponsorAddress,
      amount,
      message: message || null,
      accepted: 1, // MVP: always accept
      tier,
      epoch_number: epochNumber,
      tx_hash: txHash || null,
    };

    await insertSponsorship(this.db, row);
    await acceptSponsorship(this.db, id);

    return {
      id,
      battleId,
      agentId,
      sponsorAddress,
      amount,
      message: message || '',
      accepted: true,
      hpBoost: config.hpBoost,
      burned: true,
      tier,
      epochNumber,
    };
  }

  /**
   * Send a legacy (non-tiered) sponsorship to an agent in a battle.
   *
   * Kept for backward compatibility. New code should use sponsorTiered().
   */
  async sponsor(
    battleId: string,
    agentId: string,
    sponsorAddress: string,
    amount: number,
    message: string,
    txHash?: string | null,
  ): Promise<Sponsorship> {
    if (amount < MIN_SPONSORSHIP_AMOUNT) {
      throw new Error(
        `Sponsorship amount must be at least ${MIN_SPONSORSHIP_AMOUNT}`,
      );
    }

    const id = generateId();
    const hpBoost = calculateHpBoost(amount);

    const row: SponsorshipRow = {
      id,
      battle_id: battleId,
      agent_id: agentId,
      sponsor_address: sponsorAddress,
      amount,
      message: message || null,
      accepted: 1, // MVP: always accept
      tier: null,
      epoch_number: null,
      tx_hash: txHash || null,
    };

    await insertSponsorship(this.db, row);
    await acceptSponsorship(this.db, id);

    return {
      id,
      battleId,
      agentId,
      sponsorAddress,
      amount,
      message: message || '',
      accepted: true,
      hpBoost,
      burned: true,
      tier: null,
      epochNumber: null,
    };
  }

  /**
   * Get active sponsor effects for a given epoch.
   *
   * Called by the epoch processor to resolve HP boosts and combat modifiers.
   * Returns a map of agentId -> SponsorEffect (one per agent max).
   */
  async getEpochEffects(
    battleId: string,
    epochNumber: number,
  ): Promise<Map<string, SponsorEffect>> {
    const rows = await getSponsorshipsByEpoch(this.db, battleId, epochNumber);
    const effects = new Map<string, SponsorEffect>();

    for (const row of rows) {
      const effect = rowToSponsorEffect(row);
      if (effect) {
        // First sponsorship per agent wins (cap is enforced at creation, but be safe)
        if (!effects.has(effect.agentId)) {
          effects.set(effect.agentId, effect);
        }
      }
    }

    return effects;
  }

  /**
   * Process acceptance/rejection of a sponsorship.
   *
   * For MVP this is a no-op since we auto-accept, but the interface
   * is here for future LLM-driven agent decisions.
   */
  async processAcceptance(
    sponsorshipId: string,
    accepted: boolean,
  ): Promise<void> {
    if (accepted) {
      await acceptSponsorship(this.db, sponsorshipId);
    }
  }

  /**
   * Get all sponsorships for a battle, newest first.
   */
  async getBattleSponsorships(battleId: string): Promise<Sponsorship[]> {
    const rows = await getSponsorshipsByBattle(this.db, battleId);
    return rows.map(rowToSponsorship);
  }

  /**
   * Get sponsorships for a specific agent in a battle.
   */
  async getAgentSponsorships(
    battleId: string,
    agentId: string,
  ): Promise<Sponsorship[]> {
    const rows = await getSponsorshipsByAgent(this.db, agentId);
    return rows.filter((r) => r.battle_id === battleId).map(rowToSponsorship);
  }

  /**
   * Convenience: sponsor + apply HP boost to an agent in one call.
   *
   * Returns the sponsorship and the actual HP change (which may be
   * less than hpBoost if the agent is near max HP).
   */
  async sponsorAndApply(
    battleId: string,
    agentId: string,
    sponsorAddress: string,
    amount: number,
    message: string,
    agentHp: number,
    agentMaxHp: number = MAX_HP_CAP,
  ): Promise<SponsorshipResult> {
    const sponsorship = await this.sponsor(
      battleId,
      agentId,
      sponsorAddress,
      amount,
      message,
    );

    const headroom = agentMaxHp - agentHp;
    const actualBoost = Math.min(sponsorship.hpBoost, headroom);

    return {
      sponsorship,
      hpBefore: agentHp,
      hpAfter: agentHp + actualBoost,
      actualBoost,
    };
  }
}
