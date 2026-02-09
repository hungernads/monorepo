/**
 * HUNGERNADS - Arena Module
 *
 * Battle management, epoch processing, combat resolution, death mechanics.
 */

// Arena Manager (battle lifecycle)
export { ArenaManager, DEFAULT_BATTLE_CONFIG } from './arena';
export type {
  BattleStatus,
  BattleState,
  BattleConfig,
  BattleRecord,
  EliminationRecord,
} from './arena';

// Epoch processing
export { processEpoch } from './epoch';
export type { EpochResult } from './epoch';

// Combat resolution
export { resolveCombat, applyBleed } from './combat';
export type { CombatResult, CombatOutcome, BleedResult, DefendCostResult, CombatAgentState } from './combat';

// Death mechanics
export { checkDeaths, determineCause } from './death';
export type { DeathEvent, DeathCause, PredictionResult as DeathPredictionResult, GenerateFinalWords } from './death';

// Prediction resolution
export { resolvePredictions } from './prediction';
export type { PredictionResult, PredictionInput } from './prediction';

// Hex grid positioning
export {
  ARENA_HEXES,
  HEX_DIRECTIONS,
  hexKey,
  parseHexKey,
  hexEquals,
  hexDistance,
  isAdjacent,
  isValidHex,
  getHexLabel,
  getNeighbors,
  getNeighborInDirection,
  assignInitialPositions,
  getOccupant,
  isHexOccupied,
  getAdjacentAgents,
  validateMove,
  executeMove,
  buildSpatialContext,
} from './grid';
export type { HexCoord, ArenaHex, MoveResult } from './grid';

// 19-tile hex grid (expanded arena with tile types, pathfinding, items)
export {
  GRID_RADIUS,
  DIRECTION_OFFSETS,
  DIRECTION_LIST,
  createGrid,
  isInGrid,
  getTile,
  getEmptyTiles,
  getTilesInRange,
  getTilesByType,
  findPath,
  getDirection,
  oppositeDirection,
  placeAgent,
  removeAgent,
  moveAgent,
  serializeGrid,
  deserializeGrid,
  // Re-exported coordinate helpers (also available from ./grid)
  hexKey as hexGridKey,
  parseHexKey as hexGridParseKey,
  hexEquals as hexGridEquals,
  getDistance,
  isAdjacent as hexGridIsAdjacent,
  getNeighbors as hexGridGetNeighbors,
  getNeighborInDirection as hexGridGetNeighborInDirection,
} from './hex-grid';
export type {
  HexCoord as HexGridCoord,
  HexTile,
  TileType,
  Direction as HexDirection,
  HexGridState,
  MovementAction,
  MovementResult,
  ItemDrop,
  ItemType,
} from './hex-grid';

// Item system (rations, weapons, shields, traps, oracle)
export {
  spawnItems,
  spawnCornucopiaItems,
  pickupItem,
  checkTraps,
  tickItemBuffs,
  hasActiveBuff,
  getWeaponBonus,
  hasShieldBuff,
  hasOracleBuff,
  addBuff,
  addItemToTile,
  removeItemFromTile,
  addItemsToGrid,
  getAllItems,
  getPickupableItems,
  buildItemContext,
  buildBuffContext,
  resetItemCounter,
  WEAPON_ATK_BONUS,
  CORNUCOPIA_END_EPOCH,
} from './items';
export type {
  ItemPickupResult,
  ItemBuff,
  TrapTriggerResult,
  BuffTickResult,
} from './items';

// Price feed
export { PriceFeed, ASSETS } from './price-feed';
export type { Asset, MarketData as PriceFeedMarketData } from './price-feed';
