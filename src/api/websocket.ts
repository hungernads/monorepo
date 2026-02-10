/**
 * HUNGERNADS - WebSocket Event Streaming
 *
 * Defines the real-time event protocol for spectating battles.
 * Converts EpochResult objects into a sequence of typed BattleEvents
 * suitable for broadcasting to connected WebSocket clients.
 *
 * Event flow per epoch:
 *   epoch_start -> agent_action (x N) -> prediction_result (x N)
 *   -> combat_result (x M) -> agent_death (x D) -> epoch_end
 *   -> odds_update
 *
 * On battle completion: battle_end follows epoch_end.
 *
 * Uses the Durable Objects Hibernation API for WebSocket management.
 * The ArenaDO accepts connections and stores them via state.acceptWebSocket().
 * This module provides the event types and conversion utilities.
 */

import type { EpochResult } from '../arena/epoch';
import type { PredictionResult } from '../arena/prediction';
import type { CombatResult } from '../arena/combat';
import type { DeathEvent } from '../arena/death';
import type { MarketData, AllianceEvent as AllianceEventData } from '../agents/schemas';
import type { CurveEvent } from '../chain/nadfun';
import type { TileType, TileLevel, ItemType } from '../arena/types/hex';
import type { HexGridState } from '../arena/hex-grid';

// ─── Event Types ──────────────────────────────────────────────────────────────

export interface EpochStartEvent {
  type: 'epoch_start';
  data: {
    epochNumber: number;
    marketData: MarketData;
  };
}

export interface AgentActionEvent {
  type: 'agent_action';
  data: {
    agentId: string;
    agentName: string;
    prediction: {
      asset: string;
      direction: 'UP' | 'DOWN';
      stake: number;
    };
    /** Combat stance chosen: ATTACK, SABOTAGE, DEFEND, or NONE */
    combatStance: 'ATTACK' | 'SABOTAGE' | 'DEFEND' | 'NONE';
    /** Target agent name (for ATTACK/SABOTAGE) */
    combatTarget?: string;
    /** HP staked on combat (for ATTACK/SABOTAGE) */
    combatStake?: number;
    // Legacy fields kept for backward compat with existing dashboard
    attack?: {
      target: string;
      stake: number;
    };
    defend: boolean;
    reasoning: string;
  };
}

export interface PredictionResultEvent {
  type: 'prediction_result';
  data: PredictionResult;
}

export interface CombatResultEvent {
  type: 'combat_result';
  data: CombatResult;
}

export interface AgentDeathEvent {
  type: 'agent_death';
  data: DeathEvent;
}

export interface EpochEndEvent {
  type: 'epoch_end';
  data: {
    agentStates: {
      id: string;
      name: string;
      class: string;
      hp: number;
      isAlive: boolean;
      thoughts: string[];
    }[];
    battleComplete: boolean;
  };
}

export interface BattleEndEvent {
  type: 'battle_end';
  data: {
    winnerId: string;
    winnerName: string;
    totalEpochs: number;
  };
}

export interface OddsUpdateEvent {
  type: 'odds_update';
  data: {
    odds: Record<string, number>;
  };
}

// ─── Token / Curve Events (nad.fun streaming) ─────────────────────────────────

export interface TokenBuyEvent {
  type: 'token_buy';
  data: {
    sender: string;
    token: string;
    amountIn: string;   // MON spent (wei as string for JSON safety)
    amountOut: string;   // tokens received (wei as string)
    txHash: string;
    blockNumber: string;
  };
}

export interface TokenSellEvent {
  type: 'token_sell';
  data: {
    sender: string;
    token: string;
    amountIn: string;   // tokens sold (wei as string)
    amountOut: string;   // MON received (wei as string)
    txHash: string;
    blockNumber: string;
  };
}

export interface CurveUpdateEvent {
  type: 'curve_update';
  data: {
    eventKind: 'Create' | 'Sync' | 'Graduate' | 'TokenLocked';
    token: string;
    txHash: string;
    blockNumber: string;
    /** Extra payload varies by eventKind — kept as a flat key/value map. */
    details: Record<string, string>;
  };
}

export interface BetsSettledEvent {
  type: 'bets_settled';
  data: {
    battleId: string;
    winnerId: string;
    totalPool: number;
    payouts: {
      userAddress: string;
      betAmount: number;
      payout: number;
    }[];
    treasury: number;
    burn: number;
    /** 3% sent to Schadenfreude season pool. */
    schadenfreudeContribution?: number;
    /** Schadenfreude season info (null if accumulation failed). */
    schadenfreude?: {
      seasonNumber: number;
      poolTotal: number;
      battleCount: number;
      seasonEnded: boolean;
    } | null;
    /** Streak bonuses awarded this settlement. */
    streakBonuses?: {
      userAddress: string;
      streakLength: number;
      threshold: number;
      bonusPercent: number;
      bonusAmount: number;
    }[];
    /** Streak pool balance after this settlement. */
    streakPoolBalance?: number;
    /** @deprecated Use streakBonuses instead. Kept for backward compat. */
    topBettorBonus?: {
      userAddress: string;
      winningBetAmount: number;
      bonus: number;
    } | null;
  };
}

/**
 * Emitted when the betting phase transitions (OPEN -> LOCKED -> SETTLED).
 * Clients should use this to enable/disable bet placement UI.
 */
export interface BettingPhaseChangeEvent {
  type: 'betting_phase_change';
  data: {
    phase: 'OPEN' | 'LOCKED' | 'SETTLED';
    /** Epoch at which the transition occurred. */
    epoch: number;
    /** Human-readable reason for the transition. */
    reason: string;
  };
}

/**
 * Emitted when a battle reaches max epochs without a natural winner.
 * The agent with the highest HP among survivors is declared the winner.
 */
export interface TimeoutWinEvent {
  type: 'timeout_win';
  data: {
    winnerId: string;
    winnerName: string;
    winnerClass: string;
    winnerHp: number;
    totalEpochs: number;
    survivors: { id: string; name: string; class: string; hp: number }[];
  };
}

/**
 * Emitted when an alliance event occurs (formation, betrayal, break, expiration).
 * Creates dramatic spectator moments.
 */
export interface AllianceEvent {
  type: 'alliance_event';
  data: AllianceEventData;
}

/**
 * Emitted when a sponsor boost is applied to an agent during epoch processing.
 * Includes the tier, HP change, and any combat modifiers granted.
 */
export interface SponsorBoostEvent {
  type: 'sponsor_boost';
  data: {
    agentId: string;
    tier: string;
    hpBoost: number;
    actualBoost: number;
    hpBefore: number;
    hpAfter: number;
    freeDefend: boolean;
    attackBoost: number;
    message: string;
  };
}

// ─── Grid / Item Events ───────────────────────────────────────────────────────

/**
 * Full grid state snapshot. Sent on initial WebSocket connect and after each
 * epoch so spectators always have a consistent view of the 37-tile arena.
 *
 * tiles: flat array of all hex tiles with coords, type, level, occupant, and items.
 * agentPositions: agentId -> { q, r } mapping for quick lookup.
 */
export interface GridStateEvent {
  type: 'grid_state';
  data: {
    tiles: {
      q: number;
      r: number;
      type: TileType;
      level: number;
      occupantId: string | null;
      items: { id: string; type: ItemType }[];
    }[];
    agentPositions: Record<string, { q: number; r: number }>;
  };
}

/**
 * Emitted when an agent moves to a new hex during the movement phase.
 * Failed moves (collision, out-of-bounds) are also reported for spectator drama.
 */
export interface AgentMovedEvent {
  type: 'agent_moved';
  data: {
    agentId: string;
    agentName: string;
    from: { q: number; r: number };
    to: { q: number; r: number };
    success: boolean;
    reason?: string;
  };
}

/**
 * Emitted when new items spawn on the grid (after combat resolution).
 * One event per spawned item.
 */
export interface ItemSpawnedEvent {
  type: 'item_spawned';
  data: {
    itemId: string;
    itemType: ItemType;
    coord: { q: number; r: number };
    epochNumber: number;
    isCornucopia: boolean;
  };
}

/**
 * Emitted when an agent picks up an item from their current tile.
 */
export interface ItemPickedUpEvent {
  type: 'item_picked_up';
  data: {
    agentId: string;
    agentName: string;
    itemId: string;
    itemType: ItemType;
    coord: { q: number; r: number };
    effect: string;
    hpChange: number;
  };
}

/**
 * Emitted when an agent triggers a TRAP on a hex tile.
 */
export interface TrapTriggeredEvent {
  type: 'trap_triggered';
  data: {
    agentId: string;
    agentName: string;
    coord: { q: number; r: number };
    damage: number;
    itemId: string;
  };
}

/** Discriminated union of all events streamed to spectators. */
export type BattleEvent =
  | EpochStartEvent
  | AgentActionEvent
  | PredictionResultEvent
  | CombatResultEvent
  | AgentDeathEvent
  | EpochEndEvent
  | BattleEndEvent
  | OddsUpdateEvent
  | TokenBuyEvent
  | TokenSellEvent
  | CurveUpdateEvent
  | BetsSettledEvent
  | TimeoutWinEvent
  | BettingPhaseChangeEvent
  | SponsorBoostEvent
  | AllianceEvent
  | GridStateEvent
  | AgentMovedEvent
  | ItemSpawnedEvent
  | ItemPickedUpEvent
  | TrapTriggeredEvent;

// ─── Broadcast Helper ─────────────────────────────────────────────────────────

/**
 * Broadcast a BattleEvent to all connected WebSocket sessions.
 *
 * Silently swallows errors on individual sockets — they may be mid-close
 * or already disconnected. The Hibernation API will clean them up.
 */
export function broadcastEvent(sessions: WebSocket[], event: BattleEvent): void {
  const message = JSON.stringify(event);
  for (const ws of sessions) {
    try {
      ws.send(message);
    } catch {
      // Socket may be mid-close; safe to ignore.
      // The Hibernation API will fire webSocketClose/webSocketError
      // for cleanup.
    }
  }
}

/**
 * Broadcast multiple BattleEvents in sequence to all sessions.
 * Useful for replaying an entire epoch's events to spectators.
 */
export function broadcastEvents(sessions: WebSocket[], events: BattleEvent[]): void {
  for (const event of events) {
    broadcastEvent(sessions, event);
  }
}

// ─── CurveEvent -> BattleEvent Conversion ─────────────────────────────────────

/**
 * Convert a nad.fun SDK CurveEvent into a BattleEvent for WebSocket broadcast.
 *
 * Buy and Sell events are mapped to `token_buy` / `token_sell`.
 * All other events (Create, Sync, Graduate, TokenLocked) are mapped to
 * `curve_update` with the event-specific fields packed into `details`.
 */
export function curveEventToBattleEvent(evt: CurveEvent): BattleEvent {
  const base = {
    txHash: evt.transactionHash,
    blockNumber: evt.blockNumber.toString(),
  };

  switch (evt.type) {
    case 'Buy':
      return {
        type: 'token_buy',
        data: {
          sender: evt.sender,
          token: evt.token,
          amountIn: evt.amountIn.toString(),
          amountOut: evt.amountOut.toString(),
          ...base,
        },
      };

    case 'Sell':
      return {
        type: 'token_sell',
        data: {
          sender: evt.sender,
          token: evt.token,
          amountIn: evt.amountIn.toString(),
          amountOut: evt.amountOut.toString(),
          ...base,
        },
      };

    case 'Create':
      return {
        type: 'curve_update',
        data: {
          eventKind: 'Create',
          token: evt.token,
          ...base,
          details: {
            creator: evt.creator,
            pool: evt.pool,
            name: evt.name,
            symbol: evt.symbol,
            tokenURI: evt.tokenURI,
          },
        },
      };

    case 'Sync':
      return {
        type: 'curve_update',
        data: {
          eventKind: 'Sync',
          token: evt.token,
          ...base,
          details: {
            realMonReserve: evt.realMonReserve.toString(),
            realTokenReserve: evt.realTokenReserve.toString(),
            virtualMonReserve: evt.virtualMonReserve.toString(),
            virtualTokenReserve: evt.virtualTokenReserve.toString(),
          },
        },
      };

    case 'Graduate':
      return {
        type: 'curve_update',
        data: {
          eventKind: 'Graduate',
          token: evt.token,
          ...base,
          details: {
            pool: evt.pool,
          },
        },
      };

    case 'TokenLocked':
      return {
        type: 'curve_update',
        data: {
          eventKind: 'TokenLocked',
          token: evt.token,
          ...base,
          details: {},
        },
      };
  }
}

// ─── EpochResult -> BattleEvent[] Conversion ──────────────────────────────────

/**
 * Convert an EpochResult into an ordered sequence of BattleEvents
 * suitable for broadcasting to spectators.
 *
 * The returned array preserves the narrative order of an epoch:
 *   1. epoch_start   — market context for this epoch
 *   2. agent_action   (per agent) — what each agent decided
 *   3. prediction_result (per agent) — prediction outcomes
 *   4. combat_result  (per combat) — attack/defend outcomes
 *   5. agent_death    (per death) — agents that died this epoch
 *   6. epoch_end      — surviving agent states + completion flag
 *   7. battle_end     (if applicable) — winner announcement
 *
 * Note: odds_update is NOT included here. Odds should be computed
 * separately by the betting module and broadcast after epoch_end.
 */
export function epochToEvents(result: EpochResult): BattleEvent[] {
  const events: BattleEvent[] = [];

  // ── 1. Epoch start ────────────────────────────────────────────────
  events.push({
    type: 'epoch_start',
    data: {
      epochNumber: result.epochNumber,
      marketData: result.marketData,
    },
  });

  // ── 1.5. Sponsor boosts (parachute drops from the crowd) ───────────
  if (result.sponsorBoosts) {
    for (const boost of result.sponsorBoosts) {
      events.push({
        type: 'sponsor_boost',
        data: {
          agentId: boost.agentId,
          tier: boost.tier,
          hpBoost: boost.hpBoost,
          actualBoost: boost.actualBoost,
          hpBefore: boost.hpBefore,
          hpAfter: boost.hpAfter,
          freeDefend: boost.freeDefend,
          attackBoost: boost.attackBoost,
          message: boost.message,
        },
      });
    }
  }

  // ── 1.6. Movement events (agent repositioning) ─────────────────────
  if (result.moveResults) {
    // Build a name lookup from agentStates (always has id + name)
    const moveNameById = new Map<string, string>();
    for (const agent of result.agentStates) {
      moveNameById.set(agent.id, agent.name);
    }

    for (const move of result.moveResults) {
      events.push({
        type: 'agent_moved',
        data: {
          agentId: move.agentId,
          agentName: moveNameById.get(move.agentId) ?? move.agentId,
          from: { q: move.from.q, r: move.from.r },
          to: { q: move.to.q, r: move.to.r },
          success: move.success,
          reason: move.reason,
        },
      });
    }
  }

  // ── 1.7. Item pickups (after movement) ────────────────────────────
  if (result.itemPickups) {
    const pickupNameById = new Map<string, string>();
    for (const agent of result.agentStates) {
      pickupNameById.set(agent.id, agent.name);
    }

    for (const pickup of result.itemPickups) {
      events.push({
        type: 'item_picked_up',
        data: {
          agentId: pickup.agentId,
          agentName: pickupNameById.get(pickup.agentId) ?? pickup.agentId,
          itemId: pickup.item.id,
          itemType: pickup.item.type,
          coord: { q: pickup.item.coord.q, r: pickup.item.coord.r },
          effect: pickup.effect,
          hpChange: pickup.hpChange,
        },
      });
    }
  }

  // ── 1.8. Trap triggers (after movement) ───────────────────────────
  if (result.trapTriggers) {
    const trapNameById = new Map<string, string>();
    for (const agent of result.agentStates) {
      trapNameById.set(agent.id, agent.name);
    }

    for (const trap of result.trapTriggers) {
      events.push({
        type: 'trap_triggered',
        data: {
          agentId: trap.agentId,
          agentName: trapNameById.get(trap.agentId) ?? trap.agentId,
          coord: { q: trap.item.coord.q, r: trap.item.coord.r },
          damage: trap.damage,
          itemId: trap.item.id,
        },
      });
    }
  }

  // ── 2. Agent actions ──────────────────────────────────────────────
  // Build a name lookup from agentStates (always has id + name)
  const nameById = new Map<string, string>();
  for (const agent of result.agentStates) {
    nameById.set(agent.id, agent.name);
  }

  for (const [agentId, actions] of result.actions) {
    events.push({
      type: 'agent_action',
      data: {
        agentId,
        agentName: nameById.get(agentId) ?? agentId,
        prediction: {
          asset: actions.prediction.asset,
          direction: actions.prediction.direction,
          stake: actions.prediction.stake,
        },
        combatStance: actions.combatStance ?? 'NONE',
        combatTarget: actions.combatTarget,
        combatStake: actions.combatStake,
        // Legacy backward compat
        attack: actions.attack
          ? { target: actions.attack.target, stake: actions.attack.stake }
          : undefined,
        defend: actions.combatStance === 'DEFEND' || (actions.defend ?? false),
        reasoning: actions.reasoning,
      },
    });
  }

  // ── 2.5. Alliance events (proposals, formations, betrayals, breaks) ──
  if (result.allianceEvents) {
    for (const allianceEvt of result.allianceEvents) {
      events.push({
        type: 'alliance_event',
        data: allianceEvt,
      });
    }
  }

  // ── 3. Prediction results ─────────────────────────────────────────
  for (const predResult of result.predictionResults) {
    events.push({
      type: 'prediction_result',
      data: predResult,
    });
  }

  // ── 4. Combat results ─────────────────────────────────────────────
  for (const combatResult of result.combatResults) {
    events.push({
      type: 'combat_result',
      data: combatResult,
    });
  }

  // ── 4.5. Item spawns (after combat, items appear on the grid) ──────
  if (result.spawnedItems) {
    for (const item of result.spawnedItems) {
      events.push({
        type: 'item_spawned',
        data: {
          itemId: item.id,
          itemType: item.type,
          coord: { q: item.coord.q, r: item.coord.r },
          epochNumber: item.epochNumber,
          isCornucopia: item.isCornucopia,
        },
      });
    }
  }

  // ── 5. Agent deaths ───────────────────────────────────────────────
  for (const death of result.deaths) {
    events.push({
      type: 'agent_death',
      data: death,
    });
  }

  // ── 6. Epoch end ──────────────────────────────────────────────────
  events.push({
    type: 'epoch_end',
    data: {
      agentStates: result.agentStates,
      battleComplete: result.battleComplete,
    },
  });

  // ── 7. Battle end (only when battle is complete with a winner) ────
  if (result.battleComplete && result.winner) {
    events.push({
      type: 'battle_end',
      data: {
        winnerId: result.winner.id,
        winnerName: result.winner.name,
        totalEpochs: result.epochNumber,
      },
    });
  }

  return events;
}

// ─── Grid State Helper ────────────────────────────────────────────────────────

/**
 * Build a GridStateEvent from the current HexGridState.
 *
 * Used by ArenaDO to:
 *   1. Send an initial grid snapshot on WebSocket connect.
 *   2. Include a grid_state event at the end of each epoch's event sequence.
 *
 * The grid's tiles Map is flattened to a serializable array with occupant and
 * item info for each tile.
 */
export function gridStateToEvent(grid: HexGridState): GridStateEvent {
  const tiles: GridStateEvent['data']['tiles'] = [];
  const agentPositions: Record<string, { q: number; r: number }> = {};

  for (const tile of grid.tiles.values()) {
    tiles.push({
      q: tile.coord.q,
      r: tile.coord.r,
      type: tile.type,
      level: tile.level,
      occupantId: tile.occupantId,
      items: tile.items.map(item => ({ id: item.id, type: item.type })),
    });

    if (tile.occupantId) {
      agentPositions[tile.occupantId] = { q: tile.coord.q, r: tile.coord.r };
    }
  }

  return {
    type: 'grid_state',
    data: { tiles, agentPositions },
  };
}
