/**
 * HUNGERNADS - Prediction Resolution
 *
 * Pure functions for resolving agent market predictions against actual price movements.
 * No side effects - the caller is responsible for applying HP changes to agents.
 *
 * Prediction rules:
 * - Agent predicts an asset direction (UP/DOWN) and stakes a % of HP.
 * - Correct prediction: agent GAINS stake amount as HP.
 * - Wrong prediction: agent LOSES stake amount from HP.
 * - Flat price (< 0.01% absolute change): no gain/loss (stake returned).
 */

import type { Asset, MarketData } from '../agents/schemas';

// ─── Constants ───────────────────────────────────────────────────────

/** Absolute % change threshold below which a price is considered flat. */
const FLAT_THRESHOLD = 0.01;

// ─── Types ───────────────────────────────────────────────────────────

export interface PredictionInput {
  asset: Asset;
  direction: 'UP' | 'DOWN';
  stake: number; // absolute HP staked (already converted from % by caller)
}

export interface PredictionResult {
  agentId: string;
  asset: Asset;
  direction: 'UP' | 'DOWN';
  stake: number;
  /** Actual % change for the predicted asset between previous and current epoch. */
  actualChange: number;
  /** Whether the agent's directional prediction was correct. */
  correct: boolean;
  /** HP delta: +stake if correct, -stake if wrong, 0 if flat. */
  hpChange: number;
}

// ─── Core Function ───────────────────────────────────────────────────

/**
 * Resolve all agent predictions for an epoch against actual price movements.
 *
 * This is a pure function: it reads prediction inputs and market data, and
 * returns a list of PredictionResults. The caller must apply HP changes to
 * the actual agent objects.
 *
 * @param predictions - Map of agentId -> their prediction for this epoch
 * @param currentMarket - Market data at the END of this epoch
 * @param previousMarket - Market data at the END of the previous epoch
 * @returns Array of PredictionResults for all agents that made predictions
 */
export function resolvePredictions(
  predictions: Map<string, PredictionInput>,
  currentMarket: MarketData,
  previousMarket: MarketData,
): PredictionResult[] {
  const results: PredictionResult[] = [];

  for (const [agentId, prediction] of predictions) {
    const { asset, direction, stake } = prediction;

    const prevPrice = previousMarket.prices[asset] ?? 0;
    const currPrice = currentMarket.prices[asset] ?? 0;

    // Compute actual % change from raw prices (not relying on pre-computed changes
    // field, since we want to compare the exact two snapshots passed in).
    const actualChange = computePercentChange(prevPrice, currPrice);

    const hpChange = resolveHpChange(direction, actualChange, stake);

    results.push({
      agentId,
      asset,
      direction,
      stake,
      actualChange,
      correct: hpChange > 0,
      hpChange,
    });
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Compute percentage change between two prices.
 * Returns 0 if previous price is 0 or non-positive (avoids division by zero).
 */
function computePercentChange(prevPrice: number, currPrice: number): number {
  if (prevPrice <= 0) return 0;
  return ((currPrice - prevPrice) / prevPrice) * 100;
}

/**
 * Determine HP change for a single prediction.
 *
 * - If absolute change < FLAT_THRESHOLD: 0 (flat market, no gain/loss)
 * - If direction matches movement: +stake
 * - If direction opposes movement: -stake
 */
function resolveHpChange(
  direction: 'UP' | 'DOWN',
  actualChange: number,
  stake: number,
): number {
  // Flat price: no gain or loss
  if (Math.abs(actualChange) < FLAT_THRESHOLD) {
    return 0;
  }

  const priceWentUp = actualChange > 0;
  const predictedUp = direction === 'UP';

  const correct = priceWentUp === predictedUp;

  return correct ? stake : -stake;
}
