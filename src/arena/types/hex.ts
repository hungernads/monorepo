/**
 * HUNGERNADS - Hex Grid Type Definitions
 *
 * Types for the 37-tile axial coordinate hex grid system.
 * 4 rings: center (1) + ring 1 (6) + ring 2 (12) + ring 3 (18) = 37 tiles.
 *
 * Axial coordinate system (q, r) with flat-top hexagons.
 * Third coordinate s = -q - r is implicit (cube coordinates).
 */

// ---------------------------------------------------------------------------
// Core Coordinate Types
// ---------------------------------------------------------------------------

/** Axial hex coordinate. s = -q - r is derived when needed. */
export interface HexCoord {
  readonly q: number;
  readonly r: number;
}

/** Compass direction for hex movement (flat-top orientation). */
export type Direction = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';

// ---------------------------------------------------------------------------
// Tile Types & Levels
// ---------------------------------------------------------------------------

/**
 * Tile classification determines terrain effects and item spawn rules.
 *
 * - CORNUCOPIA: Center 7 tiles (ring 0 + ring 1). High-value area with
 *   better item spawns. Hunger Games reference -- the golden horn of plenty.
 * - NORMAL: Ring 2 tiles (12 tiles). Standard terrain.
 * - EDGE: Outer ring 3 tiles (18 tiles). Dangerous perimeter with bleed
 *   amplification and fewer resources.
 */
export type TileType = 'NORMAL' | 'CORNUCOPIA' | 'EDGE';

/**
 * Tile level determines loot quality and visual presentation.
 *
 * - Lv 4 (Legendary): Ring 0 center tile. Gold, thick border, best loot.
 * - Lv 3 (Epic):      Ring 1 inner tiles. Amber, good cornucopia loot.
 * - Lv 2 (Common):    Ring 2 tiles. Default dark, standard spawn rates.
 * - Lv 1 (Outer):     Ring 3 outer tiles. Dim, dashed, sparse items.
 */
export type TileLevel = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Tile Definition
// ---------------------------------------------------------------------------

/** A single hex tile in the arena grid. */
export interface HexTile {
  readonly coord: HexCoord;
  readonly type: TileType;
  /** Tile level (1-4) determines loot quality and visual style. */
  readonly level: TileLevel;
  /** Optional occupant agent ID. null = empty tile. */
  occupantId: string | null;
  /** Items currently on this tile. */
  items: ItemDrop[];
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * 5 item types in the arena, Hunger Games style:
 *
 * - RATION  (40% drop): Heal 50-150 HP instantly. Consumed on pickup.
 * - WEAPON  (25% drop): +25% ATK damage for 3 epochs.
 * - SHIELD  (20% drop): Free defend (no HP cost) for 2 epochs.
 * - TRAP    (10% drop): Placed on hex, deals 100 HP to next agent that enters.
 * - ORACLE  ( 5% drop): See all agents' predictions for 1 epoch.
 */
export type ItemType = 'RATION' | 'WEAPON' | 'SHIELD' | 'TRAP' | 'ORACLE';

/** An item placed on a hex tile. */
export interface ItemDrop {
  readonly id: string;
  readonly type: ItemType;
  readonly coord: HexCoord;
  /** Epoch when this item was placed. Used for expiration / logging. */
  readonly spawnedAtEpoch: number;
  /** True if this item was part of the initial cornucopia spawn. */
  readonly isCornucopia: boolean;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** An agent's movement action for a given epoch. */
export interface MovementAction {
  readonly agentId: string;
  readonly from: HexCoord;
  readonly to: HexCoord;
  readonly direction: Direction;
}

/** Result of attempting a movement action. */
export interface MovementResult {
  readonly action: MovementAction;
  readonly success: boolean;
  readonly reason?: string;
  /** Item picked up at destination, if any. */
  readonly itemPickedUp?: ItemDrop;
}

// ---------------------------------------------------------------------------
// Grid State
// ---------------------------------------------------------------------------

/** Full grid state, representing all 37 tiles and their current state. */
export interface HexGridState {
  readonly tiles: ReadonlyMap<string, HexTile>;
  readonly radius: number;
}
