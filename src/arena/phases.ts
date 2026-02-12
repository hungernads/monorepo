/**
 * HUNGERNADS - Battle Phase System
 *
 * Manages the 4-phase battle royale progression:
 *   LOOT        -> No combat. Agents scramble for cornucopia loot.
 *   HUNT        -> Combat enabled. Storm closes outer ring.
 *   BLOOD       -> Storm tightens to Lv2+. Forced fights.
 *   FINAL_STAND -> Only center tiles safe. Kill or die.
 *
 * Phase boundaries scale with player count:
 *   5 agents: 4+4+4+4 = 16 epochs
 *   6 agents: 4+6+6+4 = 20 epochs
 *   7 agents: 4+6+6+8 = 24 epochs
 *   8 agents: 6+6+8+8 = 28 epochs
 *
 * All functions are pure with no side effects.
 */

import type { BattlePhase } from './types/status';

// Re-export for convenience
export type { BattlePhase } from './types/status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a single phase within a battle. */
export interface PhaseEntry {
  /** Phase name. */
  name: BattlePhase;
  /** First epoch of this phase (1-indexed, inclusive). */
  startEpoch: number;
  /** Last epoch of this phase (1-indexed, inclusive). */
  endEpoch: number;
  /** Whether agents can attack each other during this phase. */
  combatEnabled: boolean;
  /**
   * Storm ring level. Tiles at or below this level take storm damage.
   *   -1 = no storm (all tiles safe)
   *    3 = Lv1 outer ring is dangerous (12 tiles)
   *    2 = Lv1 + Lv2 dangerous (24 tiles, 13 safe)
   *    1 = Lv1 + Lv2 + Lv3 dangerous (only Lv4 center safe)
   */
  stormRing: number;
}

/** Complete phase configuration for a battle. */
export interface PhaseConfig {
  /** Total number of epochs for this battle. */
  totalEpochs: number;
  /** Ordered array of phase definitions. */
  phases: PhaseEntry[];
}

// ---------------------------------------------------------------------------
// Phase Computation
// ---------------------------------------------------------------------------

/** All phase names in order. */
const PHASE_ORDER: BattlePhase[] = ['LOOT', 'HUNT', 'BLOOD', 'FINAL_STAND'];

/** Storm ring values per phase. */
const STORM_RING: Record<BattlePhase, number> = {
  LOOT: -1,        // No storm
  HUNT: 3,         // Lv1 tiles are storm
  BLOOD: 2,        // Lv1 + Lv2 are storm
  FINAL_STAND: 1,  // Lv1 + Lv2 + Lv3 are storm (only center safe)
};

/** Combat enabled per phase. */
const COMBAT_ENABLED: Record<BattlePhase, boolean> = {
  LOOT: false,
  HUNT: true,
  BLOOD: true,
  FINAL_STAND: true,
};

/**
 * Compute the phase configuration for a battle based on player count.
 *
 * The base is 4 epochs per phase (16 total for 5 agents). Each additional
 * agent beyond 5 adds extra epochs distributed across phases to create
 * longer hunt and blood phases for more combat opportunities.
 *
 * Doubled epoch distribution:
 *   5 agents (extra=0): LOOT=4, HUNT=4, BLOOD=4, FINAL=4  -> 16 total
 *   6 agents (extra=1): LOOT=4, HUNT=6, BLOOD=6, FINAL=4  -> 20 total
 *   7 agents (extra=2): LOOT=4, HUNT=6, BLOOD=6, FINAL=8  -> 24 total
 *   8 agents (extra=3): LOOT=6, HUNT=6, BLOOD=8, FINAL=8  -> 28 total
 *
 * @param playerCount Number of agents in the battle (5-8, clamped)
 */
export function computePhaseConfig(playerCount: number): PhaseConfig {
  const clamped = Math.max(5, Math.min(8, playerCount));
  const extra = clamped - 5; // 0, 1, 2, or 3
  const base = 4;

  // Distribute extra epochs across phases using doubled breakdown.
  // Pattern: extra epochs favor HUNT and BLOOD first, then FINAL, then LOOT.
  const epochsPerPhase: Record<BattlePhase, number> = {
    LOOT:        base + (extra >= 3 ? 2 : 0),
    HUNT:        base + (extra >= 1 ? 2 : 0),
    BLOOD:       base + (extra >= 1 ? 2 : 0) + (extra >= 3 ? 2 : 0),
    FINAL_STAND: base + (extra >= 2 ? 4 : 0),
  };

  const totalEpochs = Object.values(epochsPerPhase).reduce((sum, n) => sum + n, 0);

  // Build phase entries with epoch boundaries
  const phases: PhaseEntry[] = [];
  let currentEpoch = 1;

  for (const phaseName of PHASE_ORDER) {
    const phaseEpochs = epochsPerPhase[phaseName];
    phases.push({
      name: phaseName,
      startEpoch: currentEpoch,
      endEpoch: currentEpoch + phaseEpochs - 1,
      combatEnabled: COMBAT_ENABLED[phaseName],
      stormRing: STORM_RING[phaseName],
    });
    currentEpoch += phaseEpochs;
  }

  return { totalEpochs, phases };
}

// ---------------------------------------------------------------------------
// Phase Queries
// ---------------------------------------------------------------------------

/**
 * Get the current phase entry for a given epoch number.
 *
 * @param epochNumber Current epoch (1-indexed)
 * @param config Phase configuration for this battle
 * @returns The PhaseEntry for the current epoch, or the last phase if past end
 */
export function getCurrentPhase(epochNumber: number, config: PhaseConfig): PhaseEntry {
  for (const phase of config.phases) {
    if (epochNumber >= phase.startEpoch && epochNumber <= phase.endEpoch) {
      return phase;
    }
  }
  // Past all phases — return the last one (FINAL_STAND)
  return config.phases[config.phases.length - 1];
}

/**
 * Get the phase entry for a specific phase name.
 *
 * @param phaseName The phase to look up
 * @param config Phase configuration
 * @returns The PhaseEntry, or undefined if not found
 */
export function getPhaseByName(phaseName: BattlePhase, config: PhaseConfig): PhaseEntry | undefined {
  return config.phases.find(p => p.name === phaseName);
}

/**
 * Check if a phase transition occurred between two consecutive epochs.
 *
 * @param previousEpoch The epoch that just completed (0 for the first epoch)
 * @param currentEpoch The current epoch number
 * @param config Phase configuration
 * @returns Phase transition info, or null if no transition
 */
export function detectPhaseTransition(
  previousEpoch: number,
  currentEpoch: number,
  config: PhaseConfig,
): { from: BattlePhase; to: BattlePhase; newPhase: PhaseEntry } | null {
  if (previousEpoch <= 0) {
    // First epoch — always "transitioning" into LOOT from nothing
    // But we treat epoch 1 as the initial phase, not a transition
    return null;
  }

  const prevPhase = getCurrentPhase(previousEpoch, config);
  const currPhase = getCurrentPhase(currentEpoch, config);

  if (prevPhase.name !== currPhase.name) {
    return {
      from: prevPhase.name,
      to: currPhase.name,
      newPhase: currPhase,
    };
  }

  return null;
}

/**
 * Get the number of epochs remaining in the current phase.
 *
 * @param epochNumber Current epoch (1-indexed)
 * @param config Phase configuration
 * @returns Epochs remaining in the current phase (including the current epoch)
 */
export function getEpochsRemainingInPhase(epochNumber: number, config: PhaseConfig): number {
  const phase = getCurrentPhase(epochNumber, config);
  return Math.max(0, phase.endEpoch - epochNumber + 1);
}

/**
 * Check if combat is enabled for the given epoch.
 *
 * @param epochNumber Current epoch (1-indexed)
 * @param config Phase configuration
 * @returns true if agents can attack each other
 */
export function isCombatEnabled(epochNumber: number, config: PhaseConfig): boolean {
  return getCurrentPhase(epochNumber, config).combatEnabled;
}
