/**
 * HUNGERNADS - 19-Tile Axial Coordinate Hex Grid System
 *
 * Expanded arena: 3-ring honeycomb (radius 2) with 19 tiles.
 *
 * Layout (flat-top hexagons, axial coordinates q,r):
 *
 *  Ring 2 (EDGE - outer 12 tiles):
 *            (-1,-1) (0,-2) (1,-2)
 *        (-2,0)                 (2,-2)
 *     (-2,1)                      (2,-1)
 *        (-2,2)                 (2,0)
 *            (-1,2)  (0,2)  (1,1)
 *
 *  Ring 1 (CORNUCOPIA - inner 6 tiles):
 *              (0,-1)  (1,-1)
 *           (-1,0)        (1,0)
 *              (-1,1)  (0,1)
 *
 *  Ring 0 (CORNUCOPIA - center):
 *                (0,0)
 *
 * All functions are pure with no side effects.
 */

import type {
  HexCoord,
  HexTile,
  TileType,
  Direction,
  HexGridState,
} from './types/hex';

// Re-export types for convenience
export type {
  HexCoord,
  HexTile,
  TileType,
  Direction,
  HexGridState,
  MovementAction,
  MovementResult,
  ItemDrop,
  ItemType,
} from './types/hex';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grid radius. 0 = center only, 1 = 7 tiles, 2 = 19 tiles. */
export const GRID_RADIUS = 2;

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
 * - Ring 2 (distance == 2): EDGE
 */
function classifyTile(coord: HexCoord): TileType {
  const dist = getDistance(coord, { q: 0, r: 0 });
  if (dist <= CORNUCOPIA_RADIUS) return 'CORNUCOPIA';
  return 'EDGE';
}

/**
 * Generate all hex coordinates within a given radius from the origin.
 * For radius 2, this produces 19 coordinates.
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
 * Create the 19-tile hex grid with typed tiles.
 *
 * Returns a HexGridState with all tiles initialized:
 * - 7 CORNUCOPIA tiles (center + inner ring)
 * - 12 EDGE tiles (outer ring)
 * - All tiles empty (no occupants, no items)
 */
export function createGrid(radius: number = GRID_RADIUS): HexGridState {
  const coords = generateRingCoords(radius);
  const tiles = new Map<string, HexTile>();

  for (const coord of coords) {
    const tile: HexTile = {
      coord,
      type: classifyTile(coord),
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
// Serialization
// ---------------------------------------------------------------------------

/** Convert grid state to a plain object for JSON serialization. */
export function serializeGrid(grid: HexGridState): {
  radius: number;
  tiles: Array<{ coord: HexCoord; type: TileType; occupantId: string | null }>;
} {
  const tiles: Array<{ coord: HexCoord; type: TileType; occupantId: string | null }> = [];
  for (const tile of grid.tiles.values()) {
    tiles.push({
      coord: tile.coord,
      type: tile.type,
      occupantId: tile.occupantId,
    });
  }
  return { radius: grid.radius, tiles };
}

/** Reconstruct grid state from serialized data. */
export function deserializeGrid(data: {
  radius: number;
  tiles: Array<{ coord: HexCoord; type: TileType; occupantId: string | null }>;
}): HexGridState {
  const tiles = new Map<string, HexTile>();
  for (const t of data.tiles) {
    tiles.set(hexKey(t.coord), {
      coord: t.coord,
      type: t.type,
      occupantId: t.occupantId,
      items: [],
    });
  }
  return { tiles, radius: data.radius };
}
