export { default as AgentCard } from "./AgentCard";
export { default as AgentPortrait } from "./AgentPortrait";
export { default as ArenaLayout } from "./ArenaLayout";
export { default as HexBattleArena } from "./HexBattleArena";
export { default as ActionFeed } from "./ActionFeed";
export { default as EpochTimer } from "./EpochTimer";
export { default as MarketTicker } from "./MarketTicker";
export { default as HexGridViewer } from "./HexGridViewer";
export { default as PhaseIndicator } from "./PhaseIndicator";
export { default as PrizeClaim } from "./PrizeClaim";
export { default as ParticleEffects, useParticleEffects } from "./ParticleEffects";
export { useScreenShake } from "./useScreenShake";
export type { ShakeIntensity } from "./useScreenShake";

export {
  MOCK_AGENTS,
  MOCK_FEED,
  MOCK_AGENT_POSITIONS,
  MOCK_TILE_ITEMS,
  MOCK_GRID_STATE,
  CLASS_CONFIG,
} from "./mock-data";

export type { BattleAgent, FeedEntry, MarketPrice, MockItemType } from "./mock-data";
export type { AgentPosition, HexGridViewerProps } from "./HexGridViewer";
export type { ParticleEffect, ParticleEffectType, ParticleEffectsProps } from "./ParticleEffects";
export type { PhaseIndicatorProps } from "./PhaseIndicator";
