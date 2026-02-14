/**
 * HUNGERNADS - 19-Tile Axial Coordinate Hex Grid System
 *
 * Compact arena: 3-ring honeycomb (radius 2) with 19 tiles.
 * Reduced from 37 tiles (radius 3) to force more combat proximity with 5-8 agents.
 *
 * Layout (flat-top hexagons, axial coordinates q,r):
 *
 *  Ring 2 (EDGE - outer 12 tiles):    Lv 1 - Sparse items, dim + dashed
 *  Ring 1 (NORMAL - middle 6 tiles):  Lv 2 - Standard spawn rates
 *  Ring 0 (CORNUCOPIA - center 1 tile): Lv 4 - Best loot (legendary)
 *
 * All functions are pure with no side effects.
 */

import type {
  HexCoord,
  HexTile,
  TileType,
  TileLevel,
  Direction,
  HexGridState,
} from './types/hex';
import type { BattlePhase } from './types/status';

// Re-export types for convenience
export type {
  HexCoord,
  HexTile,
  TileType,
  TileLevel,
  Direction,
  HexGridState,
  MovementAction,
  MovementResult,
  ItemDrop,
  ItemType,
} from './types/hex';
export type { BattlePhase } from './types/status';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grid radius. 0 = center only, 1 = 7 tiles, 2 = 19 tiles, 3 = 37 tiles.
 * Radius 3 (37 tiles) matches the dashboard grid display with 4 tile levels.
 * Storm system handles proximity by shrinking safe zones over time.
 */
export const GRID_RADIUS = 3;

/**
 * Axial direction offsets for the 6 hex neighbors (flat-top orientation).
 * Indexed by Direction enum for named access.
 */
export const DIRECTION_OFFSETS: Readonly<Record<Direction, HexCoord>> = {
  N:  { q: 0, r: -1 },
  NE: { q: 1, r: -1 },
  SE: { q: 1, r: 0 },
  S:  { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  NW: { q: -1, r: 0 },
} as const;

/** Direction offsets as an ordered array (clockwise from N). */
export const DIRECTION_LIST: readonly Direction[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

/** Cornucopia radius -- tiles within this distance from center are CORNUCOPIA. */
const CORNUCOPIA_RADIUS = 1;

// ---------------------------------------------------------------------------
// Coordinate Helpers
// ---------------------------------------------------------------------------

/** Unique string key for a hex coordinate. Used for Map/Set lookups. */
export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

/** Parse a hex key string back into a HexCoord. */
export function parseHexKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/** Check if two hex coordinates are equal. */
export function hexEquals(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

// ---------------------------------------------------------------------------
// Distance & Adjacency
// ---------------------------------------------------------------------------

/**
 * Hex distance between two coordinates.
 * Uses cube coordinate formula: max(|dq|, |dr|, |ds|) where s = -q - r.
 */
export function getDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -(dq + dr);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

/** True if two hexes are adjacent (distance === 1). */
export function isAdjacent(a: HexCoord, b: HexCoord): boolean {
  return getDistance(a, b) === 1;
}

// ---------------------------------------------------------------------------
// Grid Generation
// ---------------------------------------------------------------------------

/**
 * Determine tile type based on distance from center.
 * - Ring 0 + Ring 1 (distance <= 1): CORNUCOPIA
 * - Ring 2 (distance == 2): NORMAL
 * - Ring 3 (distance == 3): EDGE
 */
function classifyTile(coord: HexCoord): TileType {
  const dist = getDistance(coord, { q: 0, r: 0 });
  if (dist <= CORNUCOPIA_RADIUS) return 'CORNUCOPIA';
  if (dist >= GRID_RADIUS) return 'EDGE';
  return 'NORMAL';
}

/**
 * Determine tile level based on ring distance from center.
 * - Ring 0: Lv 4 (Legendary) — center tile, best loot
 * - Ring 1: Lv 3 (Epic) — inner ring, cornucopia loot
 * - Ring 2: Lv 2 (Common) — middle ring, standard spawns
 * - Ring 3: Lv 1 (Outer) — outer ring, sparse items
 */
export function getTileLevel(coord: HexCoord): TileLevel {
  const dist = getDistance(coord, { q: 0, r: 0 });
  if (dist === 0) return 4;
  if (dist === 1) return 3;
  if (dist === 2) return 2;
  return 1;
}

/**
 * Generate all hex coordinates within a given radius from the origin.
 * For radius 3, this produces 37 coordinates.
 */
function generateRingCoords(radius: number): HexCoord[] {
  const coords: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.abs(s) <= radius) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

/**
 * Create the 37-tile hex grid with typed tiles and levels.
 *
 * Returns a HexGridState with all tiles initialized:
 * - 7 CORNUCOPIA tiles (ring 0 + ring 1) — Lv 4 + Lv 3
 * - 12 NORMAL tiles (ring 2) — Lv 2
 * - 18 EDGE tiles (ring 3) — Lv 1
 * - All tiles empty (no occupants, no items)
 */
export function createGrid(radius: number = GRID_RADIUS): HexGridState {
  const coords = generateRingCoords(radius);
  const tiles = new Map<string, HexTile>();

  for (const coord of coords) {
    const tile: HexTile = {
      coord,
      type: classifyTile(coord),
      level: getTileLevel(coord),
      occupantId: null,
      items: [],
    };
    tiles.set(hexKey(coord), tile);
  }

  return { tiles, radius };
}

// ---------------------------------------------------------------------------
// Grid Queries
// ---------------------------------------------------------------------------

/** Check if a coordinate is within the grid bounds. */
export function isInGrid(coord: HexCoord, grid: HexGridState): boolean {
  return grid.tiles.has(hexKey(coord));
}

/** Get a tile by coordinate. Returns undefined if out of bounds. */
export function getTile(coord: HexCoord, grid: HexGridState): HexTile | undefined {
  return grid.tiles.get(hexKey(coord));
}

/**
 * Get all valid neighbors of a hex within the grid.
 * Returns only coordinates that exist in the grid.
 */
export function getNeighbors(coord: HexCoord, grid: HexGridState): HexCoord[] {
  const neighbors: HexCoord[] = [];
  for (const dir of DIRECTION_LIST) {
    const offset = DIRECTION_OFFSETS[dir];
    const neighbor: HexCoord = { q: coord.q + offset.q, r: coord.r + offset.r };
    if (isInGrid(neighbor, grid)) {
      neighbors.push(neighbor);
    }
  }
  return neighbors;
}

/** Get the neighbor in a specific direction. Returns null if outside grid. */
export function getNeighborInDirection(
  coord: HexCoord,
  direction: Direction,
  grid: HexGridState,
): HexCoord | null {
  const offset = DIRECTION_OFFSETS[direction];
  const neighbor: HexCoord = { q: coord.q + offset.q, r: coord.r + offset.r };
  return isInGrid(neighbor, grid) ? neighbor : null;
}

/**
 * Get all empty (unoccupied) tiles in the grid.
 */
export function getEmptyTiles(grid: HexGridState): HexTile[] {
  const empty: HexTile[] = [];
  for (const tile of grid.tiles.values()) {
    if (tile.occupantId === null) {
      empty.push(tile);
    }
  }
  return empty;
}

/**
 * Get all tiles within a given distance from a coordinate.
 * Includes the origin tile itself (distance 0).
 */
export function getTilesInRange(
  center: HexCoord,
  range: number,
  grid: HexGridState,
): HexTile[] {
  const results: HexTile[] = [];
  for (const tile of grid.tiles.values()) {
    if (getDistance(center, tile.coord) <= range) {
      results.push(tile);
    }
  }
  return results;
}

/**
 * Get all tiles of a specific type.
 */
export function getTilesByType(type: TileType, grid: HexGridState): HexTile[] {
  const results: HexTile[] = [];
  for (const tile of grid.tiles.values()) {
    if (tile.type === type) {
      results.push(tile);
    }
  }
  return results;
}

/**
 * Get all outer ring tiles (maximum distance from center = grid.radius).
 * For radius 2 grid: 12 EDGE tiles at distance 2.
 * For radius 3 grid: 18 EDGE tiles at distance 3.
 * Returns only empty (unoccupied) outer ring tiles for agent spawning.
 */
export function getOuterRingTiles(grid: HexGridState): HexTile[] {
  const center: HexCoord = { q: 0, r: 0 };
  const maxDistance = grid.radius;
  const results: HexTile[] = [];

  for (const tile of grid.tiles.values()) {
    const dist = getDistance(tile.coord, center);
    if (dist === maxDistance && tile.occupantId === null) {
      results.push(tile);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Pathfinding (BFS)
// ---------------------------------------------------------------------------

/**
 * Find the shortest path between two hexes using BFS.
 *
 * Returns an array of HexCoords from `start` to `end` (inclusive),
 * or null if no path exists (e.g., destination is out of grid).
 *
 * Options:
 * - `avoidOccupied`: if true, will not path through occupied tiles
 *   (destination can still be occupied -- only intermediate tiles are checked)
 */
export function findPath(
  start: HexCoord,
  end: HexCoord,
  grid: HexGridState,
  options: { avoidOccupied?: boolean } = {},
): HexCoord[] | null {
  const { avoidOccupied = false } = options;

  // Validate start and end
  if (!isInGrid(start, grid) || !isInGrid(end, grid)) {
    return null;
  }

  // Same tile -- trivial path
  if (hexEquals(start, end)) {
    return [start];
  }

  const startKey = hexKey(start);
  const endKey = hexKey(end);

  // BFS
  const visited = new Set<string>([startKey]);
  const parent = new Map<string, string>(); // key -> previous key
  const queue: HexCoord[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = hexKey(current);

    if (currentKey === endKey) {
      // Reconstruct path
      const path: HexCoord[] = [];
      let key: string | undefined = endKey;
      while (key !== undefined) {
        path.unshift(parseHexKey(key));
        key = parent.get(key);
      }
      return path;
    }

    const neighbors = getNeighbors(current, grid);
    for (const neighbor of neighbors) {
      const neighborKey = hexKey(neighbor);
      if (visited.has(neighborKey)) continue;

      // If avoiding occupied tiles, skip occupied neighbors (unless it's the destination)
      if (avoidOccupied && neighborKey !== endKey) {
        const tile = grid.tiles.get(neighborKey);
        if (tile && tile.occupantId !== null) continue;
      }

      visited.add(neighborKey);
      parent.set(neighborKey, currentKey);
      queue.push(neighbor);
    }
  }

  // No path found
  return null;
}

// ---------------------------------------------------------------------------
// Direction Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the direction from one hex to an adjacent hex.
 * Returns null if the hexes are not adjacent.
 */
export function getDirection(from: HexCoord, to: HexCoord): Direction | null {
  const dq = to.q - from.q;
  const dr = to.r - from.r;

  for (const dir of DIRECTION_LIST) {
    const offset = DIRECTION_OFFSETS[dir];
    if (offset.q === dq && offset.r === dr) {
      return dir;
    }
  }
  return null;
}

/**
 * Get the opposite direction.
 */
export function oppositeDirection(dir: Direction): Direction {
  const opposites: Record<Direction, Direction> = {
    N: 'S',
    NE: 'SW',
    SE: 'NW',
    S: 'N',
    SW: 'NE',
    NW: 'SE',
  };
  return opposites[dir];
}

// ---------------------------------------------------------------------------
// Grid Mutation Helpers (return new state, no side effects)
// ---------------------------------------------------------------------------

/**
 * Place an agent on a tile. Returns a new tiles Map with the update applied.
 * Does NOT check if the tile is already occupied -- caller must validate.
 */
export function placeAgent(
  agentId: string,
  coord: HexCoord,
  grid: HexGridState,
): HexGridState {
  const key = hexKey(coord);
  const tile = grid.tiles.get(key);
  if (!tile) return grid;

  const newTiles = new Map(grid.tiles);
  newTiles.set(key, { ...tile, occupantId: agentId });
  return { ...grid, tiles: newTiles };
}

/**
 * Remove an agent from a tile. Returns a new tiles Map.
 */
export function removeAgent(
  coord: HexCoord,
  grid: HexGridState,
): HexGridState {
  const key = hexKey(coord);
  const tile = grid.tiles.get(key);
  if (!tile) return grid;

  const newTiles = new Map(grid.tiles);
  newTiles.set(key, { ...tile, occupantId: null });
  return { ...grid, tiles: newTiles };
}

/**
 * Move an agent from one tile to another. Returns a new grid state.
 * Does NOT validate the move -- caller must check adjacency, occupancy, etc.
 */
export function moveAgent(
  agentId: string,
  from: HexCoord,
  to: HexCoord,
  grid: HexGridState,
): HexGridState {
  const fromKey = hexKey(from);
  const toKey = hexKey(to);
  const fromTile = grid.tiles.get(fromKey);
  const toTile = grid.tiles.get(toKey);
  if (!fromTile || !toTile) return grid;

  const newTiles = new Map(grid.tiles);
  newTiles.set(fromKey, { ...fromTile, occupantId: null });
  newTiles.set(toKey, { ...toTile, occupantId: agentId });
  return { ...grid, tiles: newTiles };
}

// ---------------------------------------------------------------------------
// Storm Mechanic (Battle Royale shrinking ring)
// ---------------------------------------------------------------------------

/**
 * Storm ring threshold per battle phase.
 *
 * A tile is in the storm if its distance from center >= the stormRing value.
 * For radius 3 grid (37 tiles):
 *   -1 = no storm (all 37 tiles safe)
 *    3 = ring 3 is storm (18 Lv1 EDGE tiles) -> 19 safe (Lv2+Lv3+Lv4)
 *    2 = ring 2+3 is storm (30 tiles) -> 7 safe (Lv3+Lv4 center cluster)
 *    1 = ring 1+2+3 is storm (36 tiles) -> 1 safe (Lv4 center only)
 */
const STORM_RING_BY_PHASE: Record<BattlePhase, number> = {
  LOOT: -1,
  HUNT: 3,
  BLOOD: 2,
  FINAL_STAND: 1,
};

/**
 * Get all tiles that are in the storm zone for a given battle phase.
 *
 * Storm tiles deal damage to agents standing on them each epoch.
 * The storm shrinks inward as phases progress (for radius 3 grid):
 *   LOOT:        no storm (empty array)
 *   HUNT:        ring 3 (Lv1 EDGE) = 18 tiles
 *   BLOOD:       ring 2+3 (Lv1+Lv2) = 30 tiles
 *   FINAL_STAND: ring 1+2+3 (Lv1+Lv2+Lv3) = 36 tiles
 */
export function getStormTiles(phase: BattlePhase, grid: HexGridState): HexTile[] {
  const stormRing = STORM_RING_BY_PHASE[phase];
  if (stormRing < 0) return []; // No storm during LOOT

  const results: HexTile[] = [];
  const center: HexCoord = { q: 0, r: 0 };

  for (const tile of grid.tiles.values()) {
    const dist = getDistance(tile.coord, center);
    if (dist >= stormRing) {
      results.push(tile);
    }
  }

  return results;
}

/**
 * Check if a specific tile coordinate is inside the storm for a given phase.
 *
 * Returns true if the tile is dangerous (agents take storm damage).
 */
export function isStormTile(coord: HexCoord, phase: BattlePhase): boolean {
  const stormRing = STORM_RING_BY_PHASE[phase];
  if (stormRing < 0) return false; // No storm

  const dist = getDistance(coord, { q: 0, r: 0 });
  return dist >= stormRing;
}

/**
 * Get all tiles that are safe (NOT in the storm) for a given phase.
 *
 * For radius 3 grid (37 tiles total):
 *   LOOT:        37 safe tiles (all)
 *   HUNT:        19 safe tiles (Lv2+Lv3+Lv4)
 *   BLOOD:         7 safe tiles (Lv3+Lv4 center cluster)
 *   FINAL_STAND:   1 safe tile  (Lv4 center only)
 */
export function getSafeTiles(phase: BattlePhase, grid: HexGridState): HexTile[] {
  const stormRing = STORM_RING_BY_PHASE[phase];
  if (stormRing < 0) {
    // No storm — all tiles are safe
    return Array.from(grid.tiles.values());
  }

  const results: HexTile[] = [];
  const center: HexCoord = { q: 0, r: 0 };

  for (const tile of grid.tiles.values()) {
    const dist = getDistance(tile.coord, center);
    if (dist < stormRing) {
      results.push(tile);
    }
  }

  return results;
}

/**
 * Get the storm tile coordinates as a flat array of {q, r} objects.
 * Useful for serialization into WebSocket events.
 */
export function getStormTileCoords(phase: BattlePhase, grid: HexGridState): HexCoord[] {
  return getStormTiles(phase, grid).map(tile => tile.coord);
}

// ---------------------------------------------------------------------------
// Movement Utility: Closest Neighbor
// ---------------------------------------------------------------------------

/**
 * From a set of candidate hex coordinates, return the one closest to the
 * given target. Ties are broken arbitrarily (first found).
 *
 * Returns null if candidates is empty.
 */
export function closestTo(candidates: HexCoord[], target: HexCoord): HexCoord | null {
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestDist = getDistance(best, target);

  for (let i = 1; i < candidates.length; i++) {
    const d = getDistance(candidates[i], target);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }

  return best;
}

/**
 * Find the nearest tile with an item from a given position.
 * Scans all tiles in the grid and returns the coordinate of the closest
 * tile that has at least one item. Returns null if no items exist.
 */
export function findNearestItemTile(
  from: HexCoord,
  grid: HexGridState,
): HexCoord | null {
  let best: HexCoord | null = null;
  let bestDist = Infinity;

  for (const tile of grid.tiles.values()) {
    if (tile.items.length > 0) {
      const d = getDistance(from, tile.coord);
      if (d < bestDist) {
        bestDist = d;
        best = tile.coord;
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Convert grid state to a plain object for JSON serialization. */
export function serializeGrid(grid: HexGridState): {
  radius: number;
  tiles: Array<{ coord: HexCoord; type: TileType; level: TileLevel; occupantId: string | null }>;
} {
  const tiles: Array<{ coord: HexCoord; type: TileType; level: TileLevel; occupantId: string | null }> = [];
  for (const tile of grid.tiles.values()) {
    tiles.push({
      coord: tile.coord,
      type: tile.type,
      level: tile.level,
      occupantId: tile.occupantId,
    });
  }
  return { radius: grid.radius, tiles };
}

/** Reconstruct grid state from serialized data. */
export function deserializeGrid(data: {
  radius: number;
  tiles: Array<{ coord: HexCoord; type: TileType; level?: TileLevel; occupantId: string | null }>;
}): HexGridState {
  const tiles = new Map<string, HexTile>();
  for (const t of data.tiles) {
    tiles.set(hexKey(t.coord), {
      coord: t.coord,
      type: t.type,
      level: t.level ?? getTileLevel(t.coord),
      occupantId: t.occupantId,
      items: [],
    });
  }
  return { tiles, radius: data.radius };
}
