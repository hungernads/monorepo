/**
 * HUNGERNADS - Item System
 *
 * Hunger Games-style item drops across the hex arena.
 *
 * 5 item types:
 *   RATION  (40%) — Heal 50-150 HP instantly
 *   WEAPON  (25%) — +25% ATK damage for 3 epochs
 *   SHIELD  (20%) — Free defend (no HP cost) for 2 epochs
 *   TRAP    (10%) — Placed on hex, deals -100 HP to next agent that enters
 *   ORACLE  ( 5%) — See all agents' predictions for 1 epoch
 *
 * Cornucopia mechanic: At battle start, 7 items spawn on the center
 * CORNUCOPIA tiles (weighted toward WEAPON/SHIELD for dramatic early fights).
 * After epoch 3, cornucopia tiles lose their special status and revert to
 * normal spawn rules.
 *
 * Works with both:
 *   - 19-tile hex-grid (types/hex.ts, hex-grid.ts) — the primary system
 *   - 7-tile grid (grid.ts) — backward compat via standalone item map
 */

import type { HexCoord, ItemDrop, ItemType, HexTile, HexGridState } from './types/hex';
import {
  hexKey,
  getEmptyTiles,
  getTilesByType,
  getTile,
} from './hex-grid';

// Re-export item types for convenience
export type { ItemDrop, ItemType } from './types/hex';

// ---------------------------------------------------------------------------
// Item Buff Types (not in hex.ts — specific to the item system)
// ---------------------------------------------------------------------------

/** Result of an agent picking up (or triggering) an item. */
export interface ItemPickupResult {
  agentId: string;
  item: ItemDrop;
  /** What happened — heal amount, buff applied, trap damage, etc. */
  effect: string;
  /** Direct HP change (positive = heal, negative = damage). 0 for buff-only items. */
  hpChange: number;
  /** Buff applied to the agent (null for instant-effect items like RATION/TRAP). */
  buff: ItemBuff | null;
}

/** A timed buff on an agent from picking up an item. */
export interface ItemBuff {
  type: ItemType;
  /** Epochs remaining for this buff. Decremented each epoch by tickItemBuffs. */
  remainingEpochs: number;
  /** Source item ID (for logging). */
  sourceItemId: string;
}

/** Result of a trap triggering on an agent who entered the hex. */
export interface TrapTriggerResult {
  agentId: string;
  item: ItemDrop;
  damage: number;
  /** Descriptive message for spectator feed. */
  description: string;
}

/** Summary of buff tick results for an agent. */
export interface BuffTickResult {
  agentId: string;
  expired: ItemBuff[];
  active: ItemBuff[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Drop weight table for normal spawns (sums to 1.0). */
const NORMAL_DROP_WEIGHTS: { type: ItemType; weight: number }[] = [
  { type: 'RATION', weight: 0.40 },
  { type: 'WEAPON', weight: 0.25 },
  { type: 'SHIELD', weight: 0.20 },
  { type: 'TRAP',   weight: 0.10 },
  { type: 'ORACLE', weight: 0.05 },
];

/**
 * Cornucopia drop weights — heavier on WEAPON/SHIELD for early-game fights.
 * Minimal TRAPs in cornucopia (would punish first movers unfairly).
 */
const CORNUCOPIA_DROP_WEIGHTS: { type: ItemType; weight: number }[] = [
  { type: 'RATION', weight: 0.15 },
  { type: 'WEAPON', weight: 0.35 },
  { type: 'SHIELD', weight: 0.35 },
  { type: 'TRAP',   weight: 0.05 },
  { type: 'ORACLE', weight: 0.10 },
];

/** Trap damage is fixed at 100 HP. */
const TRAP_DAMAGE = 100;

/** Ration heal range: [min, max] inclusive. */
const RATION_HEAL_MIN = 50;
const RATION_HEAL_MAX = 150;

/** WEAPON buff: +25% ATK for 3 epochs. */
const WEAPON_BUFF_EPOCHS = 3;
export const WEAPON_ATK_BONUS = 0.25;

/** SHIELD buff: free defend for 2 epochs. */
const SHIELD_BUFF_EPOCHS = 2;

/** ORACLE buff: see predictions for 1 epoch. */
const ORACLE_BUFF_EPOCHS = 1;

/** Normal epoch spawn: 1-3 items. */
const SPAWN_MIN = 1;
const SPAWN_MAX = 3;

/** Cornucopia: 7 items (one per cornucopia tile). */
const CORNUCOPIA_ITEM_COUNT = 7;

/** Cornucopia tiles revert to normal after this epoch. */
export const CORNUCOPIA_END_EPOCH = 3;

// ---------------------------------------------------------------------------
// Item ID generation
// ---------------------------------------------------------------------------

let _itemCounter = 0;

/** Generate a unique item ID. Deterministic within a session. */
function nextItemId(): string {
  _itemCounter++;
  return `item-${_itemCounter}-${Date.now().toString(36)}`;
}

/** Reset the item counter (for testing). */
export function resetItemCounter(): void {
  _itemCounter = 0;
}

// ---------------------------------------------------------------------------
// Weighted random selection
// ---------------------------------------------------------------------------

/**
 * Pick a random item type from a weighted distribution.
 * Weights must sum to ~1.0.
 */
function rollItemType(weights: { type: ItemType; weight: number }[]): ItemType {
  const roll = Math.random();
  let cumulative = 0;
  for (const entry of weights) {
    cumulative += entry.weight;
    if (roll <= cumulative) {
      return entry.type;
    }
  }
  // Fallback (rounding edge case)
  return weights[weights.length - 1].type;
}

// ---------------------------------------------------------------------------
// Spawn Functions
// ---------------------------------------------------------------------------

/**
 * Spawn 1-3 items on empty (unoccupied, no existing item) tiles.
 *
 * Called once per epoch during the item phase. Only spawns on tiles that
 * are both unoccupied by agents AND don't already have an item.
 *
 * @param grid  - The hex grid state (19-tile system).
 * @param epoch - Current epoch number (for metadata).
 * @returns Array of newly spawned ItemDrops. Caller should add them to tiles.
 */
export function spawnItems(
  grid: HexGridState,
  epoch: number,
): ItemDrop[] {
  // Find empty tiles (no agent, no items already present)
  const candidates = getEmptyTiles(grid).filter(tile => tile.items.length === 0);

  if (candidates.length === 0) return [];

  // Roll how many items to spawn (1-3, capped by available tiles)
  const count = Math.min(
    SPAWN_MIN + Math.floor(Math.random() * (SPAWN_MAX - SPAWN_MIN + 1)),
    candidates.length,
  );

  // Shuffle and pick first `count` tiles
  const shuffled = shuffleArray([...candidates]);
  const spawned: ItemDrop[] = [];

  for (let i = 0; i < count; i++) {
    const tile = shuffled[i];
    const type = rollItemType(NORMAL_DROP_WEIGHTS);

    const item: ItemDrop = {
      id: nextItemId(),
      type,
      coord: { q: tile.coord.q, r: tile.coord.r },
      spawnedAtEpoch: epoch,
      isCornucopia: false,
    };

    spawned.push(item);
  }

  return spawned;
}

/**
 * Spawn cornucopia items at battle start.
 *
 * Places one item on each of the 7 CORNUCOPIA tiles (center + inner ring),
 * weighted toward WEAPON and SHIELD for dramatic early-game loot rushes.
 *
 * @param grid - The hex grid state. Only CORNUCOPIA-type tiles receive items.
 * @returns Array of ItemDrops (up to 7). Caller should add them to tiles.
 */
export function spawnCornucopiaItems(grid: HexGridState): ItemDrop[] {
  const cornucopiaTiles = getTilesByType('CORNUCOPIA', grid);
  const items: ItemDrop[] = [];

  const limit = Math.min(CORNUCOPIA_ITEM_COUNT, cornucopiaTiles.length);
  for (let i = 0; i < limit; i++) {
    const tile = cornucopiaTiles[i];
    const type = rollItemType(CORNUCOPIA_DROP_WEIGHTS);

    items.push({
      id: nextItemId(),
      type,
      coord: { q: tile.coord.q, r: tile.coord.r },
      spawnedAtEpoch: 0,
      isCornucopia: true,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Pickup & Trigger
// ---------------------------------------------------------------------------

/**
 * Agent picks up the item on their current hex.
 *
 * Applies the item effect immediately:
 * - RATION:  Heal 50-150 HP. Consumed on pickup.
 * - WEAPON:  Apply +25% ATK buff for 3 epochs.
 * - SHIELD:  Apply free-defend buff for 2 epochs.
 * - ORACLE:  Apply prediction-reveal buff for 1 epoch.
 * - TRAP:    Should be handled by checkTraps() on movement, but if called
 *            directly on a TRAP, applies damage as a safety fallback.
 *
 * @param agentId    - The agent picking up the item.
 * @param item       - The ItemDrop being picked up.
 * @param agentHp    - Agent's current HP (for heal capping).
 * @param agentMaxHp - Agent's max HP (for ration heal clamp).
 * @returns ItemPickupResult describing what happened.
 */
export function pickupItem(
  agentId: string,
  item: ItemDrop,
  agentHp: number,
  agentMaxHp: number,
): ItemPickupResult {
  switch (item.type) {
    case 'RATION': {
      const healAmount = RATION_HEAL_MIN +
        Math.floor(Math.random() * (RATION_HEAL_MAX - RATION_HEAL_MIN + 1));
      const actualHeal = Math.min(healAmount, agentMaxHp - agentHp);
      return {
        agentId,
        item,
        effect: `Consumed ration for ${actualHeal} HP (rolled ${healAmount})`,
        hpChange: actualHeal,
        buff: null,
      };
    }

    case 'WEAPON': {
      const buff: ItemBuff = {
        type: 'WEAPON',
        remainingEpochs: WEAPON_BUFF_EPOCHS,
        sourceItemId: item.id,
      };
      return {
        agentId,
        item,
        effect: `Picked up weapon! +${WEAPON_ATK_BONUS * 100}% ATK for ${WEAPON_BUFF_EPOCHS} epochs`,
        hpChange: 0,
        buff,
      };
    }

    case 'SHIELD': {
      const buff: ItemBuff = {
        type: 'SHIELD',
        remainingEpochs: SHIELD_BUFF_EPOCHS,
        sourceItemId: item.id,
      };
      return {
        agentId,
        item,
        effect: `Picked up shield! Free defend for ${SHIELD_BUFF_EPOCHS} epochs`,
        hpChange: 0,
        buff,
      };
    }

    case 'ORACLE': {
      const buff: ItemBuff = {
        type: 'ORACLE',
        remainingEpochs: ORACLE_BUFF_EPOCHS,
        sourceItemId: item.id,
      };
      return {
        agentId,
        item,
        effect: `Found oracle stone! Can see all predictions for ${ORACLE_BUFF_EPOCHS} epoch`,
        hpChange: 0,
        buff,
      };
    }

    case 'TRAP': {
      // Safety fallback — traps should be handled by checkTraps().
      return {
        agentId,
        item,
        effect: `Triggered a trap! Took ${TRAP_DAMAGE} damage`,
        hpChange: -TRAP_DAMAGE,
        buff: null,
      };
    }

    default: {
      const _exhaustive: never = item.type;
      throw new Error(`Unknown item type: ${_exhaustive}`);
    }
  }
}

/**
 * Check if an agent has stepped onto a trap.
 *
 * Called after movement resolution. If the agent's destination tile has a
 * TRAP item, it triggers and is consumed.
 *
 * Non-TRAP items on the tile are NOT consumed by this function — the agent
 * should pick them up via pickupItem() separately.
 *
 * @param agentId - The agent who just moved.
 * @param coord   - The hex the agent moved to.
 * @param grid    - Current grid state (items live on tiles).
 * @returns TrapTriggerResult if a trap was triggered, null otherwise.
 */
export function checkTraps(
  agentId: string,
  coord: HexCoord,
  grid: HexGridState,
): TrapTriggerResult | null {
  const tile = getTile(coord, grid);
  if (!tile) return null;

  const trap = tile.items.find(item => item.type === 'TRAP');
  if (!trap) return null;

  const key = hexKey(coord);
  return {
    agentId,
    item: trap,
    damage: TRAP_DAMAGE,
    description: `TRAP TRIGGERED! Agent stepped on a hidden trap at ${key} and took ${TRAP_DAMAGE} damage!`,
  };
}

// ---------------------------------------------------------------------------
// Buff Management
// ---------------------------------------------------------------------------

/**
 * Tick all active item buffs for all agents.
 *
 * Decrements remainingEpochs by 1. Removes expired buffs (remainingEpochs <= 0).
 * Called once per epoch at the end of the epoch, alongside skill cooldown ticks.
 *
 * @param agentBuffs - Map of agentId -> array of active ItemBuffs. Modified in place.
 * @returns Array of BuffTickResults for logging/broadcasting.
 */
export function tickItemBuffs(
  agentBuffs: Map<string, ItemBuff[]>,
): BuffTickResult[] {
  const results: BuffTickResult[] = [];

  for (const [agentId, buffs] of agentBuffs) {
    const expired: ItemBuff[] = [];
    const active: ItemBuff[] = [];

    for (const buff of buffs) {
      buff.remainingEpochs--;
      if (buff.remainingEpochs <= 0) {
        expired.push({ ...buff }); // snapshot before removal
      } else {
        active.push(buff);
      }
    }

    // Update the map in place with only active buffs
    agentBuffs.set(agentId, active);

    results.push({ agentId, expired, active });
  }

  return results;
}

/**
 * Check if an agent has an active buff of a specific type.
 *
 * @param agentId    - The agent to check.
 * @param buffType   - The item type to look for.
 * @param agentBuffs - Map of agentId -> active buffs.
 * @returns True if the agent has at least one active buff of that type.
 */
export function hasActiveBuff(
  agentId: string,
  buffType: ItemType,
  agentBuffs: Map<string, ItemBuff[]>,
): boolean {
  const buffs = agentBuffs.get(agentId);
  if (!buffs) return false;
  return buffs.some(b => b.type === buffType && b.remainingEpochs > 0);
}

/**
 * Get the total attack bonus from WEAPON buffs for an agent.
 * Multiple weapon pickups stack additively.
 *
 * @param agentId    - The agent to check.
 * @param agentBuffs - Map of agentId -> active buffs.
 * @returns Total attack bonus multiplier (e.g. 0.25 for one weapon, 0.50 for two).
 */
export function getWeaponBonus(
  agentId: string,
  agentBuffs: Map<string, ItemBuff[]>,
): number {
  const buffs = agentBuffs.get(agentId);
  if (!buffs) return 0;
  return buffs
    .filter(b => b.type === 'WEAPON' && b.remainingEpochs > 0)
    .length * WEAPON_ATK_BONUS;
}

/**
 * Check if an agent has an active SHIELD buff (free defend).
 *
 * When active, the agent's defend action costs 0 HP instead of the
 * normal 3% HP defend cost.
 */
export function hasShieldBuff(
  agentId: string,
  agentBuffs: Map<string, ItemBuff[]>,
): boolean {
  return hasActiveBuff(agentId, 'SHIELD', agentBuffs);
}

/**
 * Check if an agent has an active ORACLE buff (prediction visibility).
 *
 * When active, the agent can see other agents' predictions in their
 * LLM prompt context for the current epoch.
 */
export function hasOracleBuff(
  agentId: string,
  agentBuffs: Map<string, ItemBuff[]>,
): boolean {
  return hasActiveBuff(agentId, 'ORACLE', agentBuffs);
}

/**
 * Add a buff to an agent's buff array. Creates the array if it doesn't exist.
 *
 * @param agentId    - The agent receiving the buff.
 * @param buff       - The buff to add.
 * @param agentBuffs - Map of agentId -> active buffs (mutated in place).
 */
export function addBuff(
  agentId: string,
  buff: ItemBuff,
  agentBuffs: Map<string, ItemBuff[]>,
): void {
  const existing = agentBuffs.get(agentId) ?? [];
  existing.push(buff);
  agentBuffs.set(agentId, existing);
}

// ---------------------------------------------------------------------------
// Tile Item Helpers
// ---------------------------------------------------------------------------

/**
 * Add an item to a tile in the grid. Returns a new grid state (immutable).
 *
 * @param item - The item to add.
 * @param grid - Current grid state.
 * @returns New grid state with the item added to the tile.
 */
export function addItemToTile(
  item: ItemDrop,
  grid: HexGridState,
): HexGridState {
  const key = hexKey(item.coord);
  const tile = grid.tiles.get(key);
  if (!tile) return grid;

  const newTile: HexTile = {
    ...tile,
    items: [...tile.items, item],
  };

  const newTiles = new Map(grid.tiles);
  newTiles.set(key, newTile);
  return { ...grid, tiles: newTiles };
}

/**
 * Remove a specific item from a tile. Returns a new grid state (immutable).
 *
 * @param itemId - ID of the item to remove.
 * @param coord  - Hex coordinate of the tile.
 * @param grid   - Current grid state.
 * @returns New grid state with the item removed.
 */
export function removeItemFromTile(
  itemId: string,
  coord: HexCoord,
  grid: HexGridState,
): HexGridState {
  const key = hexKey(coord);
  const tile = grid.tiles.get(key);
  if (!tile) return grid;

  const newTile: HexTile = {
    ...tile,
    items: tile.items.filter(i => i.id !== itemId),
  };

  const newTiles = new Map(grid.tiles);
  newTiles.set(key, newTile);
  return { ...grid, tiles: newTiles };
}

/**
 * Batch-add multiple items to tiles. Returns a new grid state.
 *
 * @param items - Items to place on their respective tiles.
 * @param grid  - Current grid state.
 * @returns New grid state with all items added.
 */
export function addItemsToGrid(
  items: ItemDrop[],
  grid: HexGridState,
): HexGridState {
  let result = grid;
  for (const item of items) {
    result = addItemToTile(item, result);
  }
  return result;
}

/**
 * Get all items across the entire grid.
 */
export function getAllItems(grid: HexGridState): ItemDrop[] {
  const items: ItemDrop[] = [];
  for (const tile of grid.tiles.values()) {
    items.push(...tile.items);
  }
  return items;
}

/**
 * Get the non-TRAP items on a specific tile (pickupable items).
 */
export function getPickupableItems(
  coord: HexCoord,
  grid: HexGridState,
): ItemDrop[] {
  const tile = getTile(coord, grid);
  if (!tile) return [];
  return tile.items.filter(i => i.type !== 'TRAP');
}

// ---------------------------------------------------------------------------
// LLM Prompt Context
// ---------------------------------------------------------------------------

/**
 * Build a spatial item context string for an agent's LLM prompt.
 *
 * Tells the agent what items are visible on nearby hexes so they can
 * decide whether to move toward loot or avoid traps.
 *
 * Traps are hidden from the prompt (agents can't see them) unless the
 * agent has an ORACLE buff.
 *
 * @param agentId    - The agent to build context for.
 * @param grid       - Current grid state.
 * @param agentBuffs - Agent buff map (to check ORACLE visibility).
 * @returns Multi-line string for the LLM prompt, or empty string if no items.
 */
export function buildItemContext(
  agentId: string,
  grid: HexGridState,
  agentBuffs: Map<string, ItemBuff[]>,
): string {
  const allItems = getAllItems(grid);
  if (allItems.length === 0) return '';

  const canSeeTrap = hasOracleBuff(agentId, agentBuffs);
  const lines: string[] = ['ITEMS ON THE FIELD:'];
  let visibleCount = 0;

  for (const item of allItems) {
    // Hide traps unless agent has ORACLE buff
    if (item.type === 'TRAP' && !canSeeTrap) continue;

    const label = `(${item.coord.q},${item.coord.r})`;
    const typeLabel = item.type === 'TRAP' ? 'TRAP (!)' : item.type;
    lines.push(`  - ${typeLabel} at hex ${label}`);
    visibleCount++;
  }

  if (visibleCount === 0) return '';

  return lines.join('\n');
}

/**
 * Build a buff status string for an agent's LLM prompt.
 *
 * @param agentId    - The agent.
 * @param agentBuffs - Agent buff map.
 * @returns Multi-line string describing active buffs, or empty string if none.
 */
export function buildBuffContext(
  agentId: string,
  agentBuffs: Map<string, ItemBuff[]>,
): string {
  const buffs = agentBuffs.get(agentId);
  if (!buffs || buffs.length === 0) return '';

  const lines: string[] = ['ACTIVE ITEM BUFFS:'];
  for (const buff of buffs) {
    switch (buff.type) {
      case 'WEAPON':
        lines.push(`  - WEAPON: +${WEAPON_ATK_BONUS * 100}% ATK damage (${buff.remainingEpochs} epochs left)`);
        break;
      case 'SHIELD':
        lines.push(`  - SHIELD: Free defend (${buff.remainingEpochs} epochs left)`);
        break;
      case 'ORACLE':
        lines.push(`  - ORACLE: Can see all predictions (${buff.remainingEpochs} epochs left)`);
        break;
      default:
        lines.push(`  - ${buff.type}: ${buff.remainingEpochs} epochs left`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates shuffle (non-mutating). */
function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
