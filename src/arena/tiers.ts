/**
 * HUNGERNADS - Tier Configuration System
 *
 * Defines tiered lobby system with dual-token economy (MON + $HNADS).
 * Each tier requires:
 * - MON entry fee → forms prize pool
 * - $HNADS entry fee → 50% burned, 50% treasury
 *
 * All tiers use same agent base stats (fair competition).
 * Higher tiers offer bigger prizes, longer battles, and bonus rewards.
 */

export type LobbyTier = 'FREE' | 'BRONZE' | 'SILVER' | 'GOLD';

/** Epoch threshold at which survival bonuses are awarded (agents alive at this epoch get the bonus). */
export const SURVIVAL_BONUS_EPOCH = 50;

export interface TierConfig {
  tier: LobbyTier;
  /** MON entry fee (forms prize pool). */
  monFee: string;
  /** $HNADS entry fee (50% burned, 50% treasury). */
  hnadsFee: string;
  /** Maximum players allowed in lobby. */
  maxPlayers: number;
  /** Maximum epochs before battle auto-ends. */
  maxEpochs: number;
  /** Percentage of MON pool awarded to winner (0.8 = 80%). */
  winnerShare: number;
  /** Percentage of $HNADS burned (0.5 = 50%). */
  hnadsBurnRate: number;
  /** Optional $HNADS bonus awarded per kill. */
  killBonus?: string;
  /** Optional $HNADS bonus awarded if alive at epoch 50. */
  survivalBonus?: string;
  /** Display label. */
  label: string;
  /** Description text. */
  description: string;
}

/**
 * Tier configuration constants.
 * FREE tier is for onboarding/practice (no stakes).
 * BRONZE/SILVER/GOLD require dual-token entry fees.
 */
export const TIER_CONFIGS: Record<LobbyTier, TierConfig> = {
  FREE: {
    tier: 'FREE',
    monFee: '0',
    hnadsFee: '0',
    maxPlayers: 8,
    maxEpochs: 20,
    winnerShare: 0,
    hnadsBurnRate: 0,
    label: 'Free Arena',
    description: 'Practice battles with no stakes',
  },
  BRONZE: {
    tier: 'BRONZE',
    monFee: '10',
    hnadsFee: '100',
    maxPlayers: 8,
    maxEpochs: 50,
    winnerShare: 0.8,
    hnadsBurnRate: 0.5,
    label: 'Bronze Arena',
    description: 'Entry: 10 MON + 100 $HNADS • Winner takes 80% of prize pool',
  },
  SILVER: {
    tier: 'SILVER',
    monFee: '50',
    hnadsFee: '500',
    maxPlayers: 8,
    maxEpochs: 75,
    winnerShare: 0.8,
    hnadsBurnRate: 0.5,
    killBonus: '25',
    label: 'Silver Arena',
    description: 'Entry: 50 MON + 500 $HNADS • Winner takes 80% • 25 $HNADS per kill',
  },
  GOLD: {
    tier: 'GOLD',
    monFee: '100',
    hnadsFee: '1000',
    maxPlayers: 8,
    maxEpochs: 100,
    winnerShare: 0.85,
    hnadsBurnRate: 0.5,
    killBonus: '50',
    survivalBonus: '100',
    label: 'Gold Arena',
    description: 'Entry: 100 MON + 1000 $HNADS • Winner takes 85% • 50 $HNADS per kill • 100 $HNADS survival bonus',
  },
};

/**
 * Get tier configuration by tier name.
 */
export function getTierConfig(tier: LobbyTier): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Calculate prize pool distribution for a given tier and player count.
 * Returns MON and $HNADS breakdowns.
 *
 * MON distribution:
 * - Winner gets (total MON collected) × winnerShare
 * - Treasury gets the rest
 *
 * $HNADS distribution:
 * - 50% burned to 0xdEaD
 * - 50% to treasury (for bonuses/ops)
 */
export function calculatePrizePool(tier: LobbyTier, playerCount: number): {
  totalMon: string;
  winnerPayout: string;
  treasuryMon: string;
  totalHnads: string;
  hnadsBurned: string;
  hnadsTreasury: string;
} {
  const config = getTierConfig(tier);

  // MON calculations
  const totalMon = parseFloat(config.monFee) * playerCount;
  const winnerPayout = totalMon * config.winnerShare;
  const treasuryMon = totalMon - winnerPayout;

  // $HNADS calculations
  const totalHnads = parseFloat(config.hnadsFee) * playerCount;
  const hnadsBurned = totalHnads * config.hnadsBurnRate;
  const hnadsTreasury = totalHnads - hnadsBurned;

  return {
    totalMon: totalMon.toFixed(6),
    winnerPayout: winnerPayout.toFixed(6),
    treasuryMon: treasuryMon.toFixed(6),
    totalHnads: totalHnads.toFixed(6),
    hnadsBurned: hnadsBurned.toFixed(6),
    hnadsTreasury: hnadsTreasury.toFixed(6),
  };
}

/**
 * Validate tier name.
 */
export function isValidTier(tier: string): tier is LobbyTier {
  return ['FREE', 'BRONZE', 'SILVER', 'GOLD'].includes(tier);
}

/**
 * Get all tiers sorted by entry fee (ascending).
 */
export function getAllTiers(): LobbyTier[] {
  return ['FREE', 'BRONZE', 'SILVER', 'GOLD'];
}

/**
 * Calculate kill bonus for a tier.
 * Returns 0 if tier has no kill bonus.
 */
export function getKillBonus(tier: LobbyTier): number {
  const config = getTierConfig(tier);
  return config.killBonus ? parseFloat(config.killBonus) : 0;
}

/**
 * Calculate survival bonus for a tier.
 * Returns 0 if tier has no survival bonus.
 */
export function getSurvivalBonus(tier: LobbyTier): number {
  const config = getTierConfig(tier);
  return config.survivalBonus ? parseFloat(config.survivalBonus) : 0;
}
