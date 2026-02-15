"use client";

import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { CLASS_CONFIG, type BattleAgent } from "./mock-data";
import type { AgentClass } from "@/types";
import ParticleEffects, { useParticleEffects } from "./ParticleEffects";
import { useScreenShake } from "./useScreenShake";
import { motion } from "motion/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HexCoord {
  q: number;
  r: number;
}

interface PixelPoint {
  x: number;
  y: number;
}

interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  createdAt: number;
}

/** Tile classification — matches backend src/arena/types/hex.ts */
type TileType = "NORMAL" | "CORNUCOPIA" | "EDGE";

/** Tile level (1-4) determines loot quality and visual style. */
type TileLevel = 1 | 2 | 3 | 4;

/** Item types from the arena system */
type ItemType = "RATION" | "WEAPON" | "SHIELD" | "TRAP" | "ORACLE";

/** An item present on a tile */
interface TileItem {
  id: string;
  type: ItemType;
}

/** Recent movement for trail rendering */
interface RecentMove {
  agentId: string;
  agentName: string;
  from: { q: number; r: number };
  to: { q: number; r: number };
  success: boolean;
  /** Epoch number when this move occurred, used for trail age / opacity calculation. */
  epoch: number;
}

/** Battle phase — mirrors backend BattlePhase type. */
type BattlePhase = "LOOT" | "HUNT" | "BLOOD" | "FINAL_STAND";

/** Extended hex definition for the 37-tile grid */
interface ArenaHex extends HexCoord {
  label: string;
  tileType: TileType;
  tileLevel: TileLevel;
}

interface HexBattleArenaProps {
  agents: BattleAgent[];
  currentEpoch: number;
  /** Optional: Map of agentId -> HexCoord from backend. Falls back to auto-assignment. */
  agentPositions?: Map<string, HexCoord>;
  /** Optional: Map of hex key "q,r" -> items on that tile. */
  tileItems?: Map<string, TileItem[]>;
  /** Number of sponsor events seen so far. Increment to trigger gold rain effect. */
  sponsorEventCount?: number;
  /** Recent agent movements for drawing movement trail arrows. */
  recentMoves?: RecentMove[];
  /** Storm tile coordinates from the backend. Empty during LOOT phase. */
  stormTiles?: HexCoord[];
  /** Current battle phase (null if phase data not yet available). */
  currentPhase?: BattlePhase | null;
}

// ---------------------------------------------------------------------------
// Constants -- 37-tile hex grid geometry (flat-top, radius 3)
// ---------------------------------------------------------------------------

/**
 * Flat-top hex size (outer radius = center to vertex).
 * 48px gives agents enough room for visible portraits + names + HP bars.
 */
const HEX_SIZE = 48;
const SQRT3 = Math.sqrt(3);
const GRID_RADIUS = 3;

/**
 * Determine tile type by distance from center (4-tier system).
 * Ring 0 + Ring 1 (distance <= 1) = CORNUCOPIA
 * Ring 2 (distance == 2) = NORMAL
 * Ring 3 (distance == 3) = EDGE
 */
function classifyTile(q: number, r: number): TileType {
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist <= 1) return "CORNUCOPIA";
  if (dist >= 3) return "EDGE";
  return "NORMAL";
}

/**
 * Determine tile level (1-4) based on ring distance.
 * Ring 0 = Lv 4 (Legendary), Ring 1 = Lv 3 (Epic),
 * Ring 2 = Lv 2 (Common), Ring 3 = Lv 1 (Outer)
 */
function getTileLevel(q: number, r: number): TileLevel {
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist === 0) return 4;
  if (dist === 1) return 3;
  if (dist === 2) return 2;
  return 1;
}

/** Direction labels for hex tiles based on their position */
function tileLabel(q: number, r: number): string {
  if (q === 0 && r === 0) return "CENTER";
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist === 1) {
    const labels: Record<string, string> = {
      "0,-1": "N",
      "1,-1": "NE",
      "1,0": "E",
      "0,1": "S",
      "-1,1": "SW",
      "-1,0": "W",
    };
    return labels[`${q},${r}`] || "";
  }
  if (dist === 2) return `${q},${r}`;
  // Ring 3: abbreviated coordinates
  return `${q},${r}`;
}

/**
 * Generate all 37 hex coordinates for radius-3 grid.
 * For radius R, generates all (q,r) where max(|q|,|r|,|-q-r|) <= R.
 */
function generateArenaHexes(): ArenaHex[] {
  const hexes: ArenaHex[] = [];
  for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
    for (let r = -GRID_RADIUS; r <= GRID_RADIUS; r++) {
      const s = -q - r;
      if (Math.abs(s) <= GRID_RADIUS) {
        hexes.push({
          q,
          r,
          label: tileLabel(q, r),
          tileType: classifyTile(q, r),
          tileLevel: getTileLevel(q, r),
        });
      }
    }
  }
  return hexes;
}

/** The 37-tile arena in axial coords */
const ARENA_HEXES = generateArenaHexes();

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Convert axial (q, r) to pixel (x, y) for flat-top hexagons. */
function axialToPixel(q: number, r: number): PixelPoint {
  const x = HEX_SIZE * (3 / 2) * q;
  const y = HEX_SIZE * ((SQRT3 / 2) * q + SQRT3 * r);
  return { x, y };
}

/** Generate the 6 vertices of a flat-top hexagon centered at (cx, cy). */
function hexVertices(cx: number, cy: number, size: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i;
    const angleRad = (Math.PI / 180) * angleDeg;
    const px = cx + size * Math.cos(angleRad);
    const py = cy + size * Math.sin(angleRad);
    points.push(`${px},${py}`);
  }
  return points.join(" ");
}

/**
 * Deterministic agent-to-hex assignment for 37-tile grid.
 * Spreads agents across ring 1 first (6 tiles), then ring 2 (12 tiles),
 * then center as a last resort. Avoids stacking everyone at (0,0).
 */
function assignDefaultPositions(agentIds: string[]): Map<string, HexCoord> {
  const positions = new Map<string, HexCoord>();
  // Ring 1 tiles (6 hexes around center) — visually spread out
  const ring1: HexCoord[] = [
    { q: 0, r: -1 },  // N
    { q: 1, r: -1 },  // NE
    { q: 1, r: 0 },   // SE
    { q: 0, r: 1 },   // S
    { q: -1, r: 1 },  // SW
    { q: -1, r: 0 },  // NW
  ];
  // Ring 2 tiles (12 hexes) — overflow for 7+ agents
  const ring2: HexCoord[] = [
    { q: 0, r: -2 },  // N far
    { q: 1, r: -2 },  // NNE
    { q: 2, r: -2 },  // NE far
    { q: 2, r: -1 },  // ENE
    { q: 2, r: 0 },   // E far
    { q: 1, r: 1 },   // ESE
    { q: 0, r: 2 },   // S far
    { q: -1, r: 2 },  // SSW
    { q: -2, r: 2 },  // SW far
    { q: -2, r: 1 },  // WSW
    { q: -2, r: 0 },  // W far
    { q: -1, r: -1 }, // WNW
  ];
  const defaultSlots: HexCoord[] = [...ring1, ...ring2, { q: 0, r: 0 }];
  for (let i = 0; i < agentIds.length && i < defaultSlots.length; i++) {
    positions.set(agentIds[i], defaultSlots[i]);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const CLASS_HEX_COLORS: Record<AgentClass, { fill: string; stroke: string; glow: string }> = {
  WARRIOR: { fill: "#1a0808", stroke: "#dc2626", glow: "rgba(220,38,38,0.5)" },
  TRADER: { fill: "#08101a", stroke: "#3b82f6", glow: "rgba(59,130,246,0.5)" },
  SURVIVOR: { fill: "#081a0d", stroke: "#22c55e", glow: "rgba(34,197,94,0.5)" },
  PARASITE: { fill: "#120a1f", stroke: "#7c3aed", glow: "rgba(124,58,237,0.5)" },
  GAMBLER: { fill: "#1a150a", stroke: "#f59e0b", glow: "rgba(245,158,11,0.5)" },
};

const DEAD_COLORS = { fill: "#141420", stroke: "#333", glow: "none" };

/** Tile level visual config (4-tier system) */
const TILE_LEVEL_COLORS: Record<TileLevel, { fill: string; stroke: string; strokeWidth: number; dashArray?: string }> = {
  4: { // Legendary (center) — dark gold, thick border
    fill: "#2a1f0a",
    stroke: "#f59e0b",
    strokeWidth: 2.5,
  },
  3: { // Epic (ring 1) — warm amber
    fill: "#1f1a0d",
    stroke: "#b45309",
    strokeWidth: 1.5,
  },
  2: { // Common (ring 2) — deep indigo
    fill: "#141428",
    stroke: "#2a2a50",
    strokeWidth: 1,
  },
  1: { // Outer (ring 3) — near-black, dashed
    fill: "#0c0c18",
    stroke: "#1e1e38",
    strokeWidth: 1,
    dashArray: "5,3",
  },
};

/** Level label + color for badge display */
const LEVEL_BADGE: Record<TileLevel, { label: string; color: string }> = {
  4: { label: "Lv4", color: "#f59e0b" },
  3: { label: "Lv3", color: "#b45309" },
  2: { label: "Lv2", color: "#4a4a6a" },
  1: { label: "Lv1", color: "#3a3a55" },
};

// ---------------------------------------------------------------------------
// Storm visual config — colors and animation classes per battle phase
// ---------------------------------------------------------------------------

/** Storm overlay fill + pulse animation per phase. */
const STORM_PHASE_VISUALS: Record<BattlePhase, {
  fill: string;
  stroke: string;
  animClass: string;
  /** Safe zone glow (applied to non-storm tiles). null = no glow. */
  safeGlow: string | null;
}> = {
  LOOT: {
    fill: "transparent",
    stroke: "transparent",
    animClass: "",
    safeGlow: null,
  },
  HUNT: {
    fill: "rgba(245, 158, 11, 0.12)",
    stroke: "rgba(245, 158, 11, 0.35)",
    animClass: "storm-pulse-hunt",
    safeGlow: null,
  },
  BLOOD: {
    fill: "rgba(220, 38, 38, 0.18)",
    stroke: "rgba(220, 38, 38, 0.45)",
    animClass: "storm-pulse-blood",
    safeGlow: "rgba(34, 197, 94, 0.08)",
  },
  FINAL_STAND: {
    fill: "rgba(124, 58, 237, 0.22)",
    stroke: "rgba(124, 58, 237, 0.50)",
    animClass: "storm-pulse-final",
    safeGlow: "rgba(34, 197, 94, 0.12)",
  },
};

// ---------------------------------------------------------------------------
// Per-tile terrain styling — storm / safe / cornucopia fill+stroke overrides
// ---------------------------------------------------------------------------

/** Storm tile fill+stroke per phase (applied to the base hex polygon). */
const STORM_TILE_STYLE: Record<BattlePhase, {
  fill: string;
  stroke: string;
  strokeWidth: number;
  animClass: string;
}> = {
  LOOT: { fill: "", stroke: "", strokeWidth: 0, animClass: "" },
  HUNT: {
    fill: "#1a0f08",
    stroke: "rgba(245, 158, 11, 0.5)",
    strokeWidth: 2,
    animClass: "tile-storm-hunt",
  },
  BLOOD: {
    fill: "#1a0808",
    stroke: "rgba(220, 38, 38, 0.6)",
    strokeWidth: 2,
    animClass: "tile-storm-blood",
  },
  FINAL_STAND: {
    fill: "#140a1f",
    stroke: "rgba(124, 58, 237, 0.7)",
    strokeWidth: 2.5,
    animClass: "tile-storm-final",
  },
};

/** Safe zone tile stroke per phase (applied when storm is active). */
const SAFE_TILE_STYLE: Record<BattlePhase, {
  stroke: string;
  strokeWidth: number;
}> = {
  LOOT: { stroke: "", strokeWidth: 0 },
  HUNT: { stroke: "rgba(34, 197, 94, 0.25)", strokeWidth: 1.5 },
  BLOOD: { stroke: "rgba(34, 197, 94, 0.35)", strokeWidth: 1.5 },
  FINAL_STAND: { stroke: "rgba(34, 197, 94, 0.5)", strokeWidth: 2 },
};

// ---------------------------------------------------------------------------
// Item icon SVG renderer (inline icons on tiles)
// ---------------------------------------------------------------------------

const ITEM_ICONS: Record<ItemType, { color: string; label: string }> = {
  RATION:  { color: "#22c55e", label: "+" },
  WEAPON:  { color: "#dc2626", label: "\u2694" },
  SHIELD:  { color: "#3b82f6", label: "\u25C6" },
  TRAP:    { color: "#f59e0b", label: "!" },
  ORACLE:  { color: "#a855f6", label: "\u25C9" },
};

function ItemIcon({ item, cx, cy, index }: { item: TileItem; cx: number; cy: number; index: number }) {
  const cfg = ITEM_ICONS[item.type];
  // Offset items in a small cluster around tile center
  const angle = (index * 120 + 30) * (Math.PI / 180);
  const offsetR = 22;
  const ix = cx + offsetR * Math.cos(angle);
  const iy = cy + offsetR * Math.sin(angle);

  return (
    <g>
      {/* Item background circle */}
      <circle cx={ix} cy={iy} r="7" fill="#0a0a12" stroke={cfg.color} strokeWidth="1.5" opacity="1" />
      {/* Item icon */}
      <text
        x={ix}
        y={iy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={cfg.color}
        fontSize="8"
        fontWeight="bold"
        fontFamily="monospace"
      >
        {cfg.label}
      </text>
      {/* Subtle pulse for visibility */}
      {item.type !== "TRAP" && (
        <circle cx={ix} cy={iy} r="7" fill="none" stroke={cfg.color} strokeWidth="0.5" opacity="0.4">
          <animate attributeName="r" values="7;10;7" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (rendered inside SVG)
// ---------------------------------------------------------------------------

/** A single hex tile. Empty or occupied by an agent. */
function HexTile({
  hex,
  center,
  agent,
  items,
  isAttackSource,
  isAttackTarget,
  isDying = false,
  isGhost = false,
  animOffset,
  isStormTile = false,
  isSafeZone = false,
  effectivePhase = "LOOT",
}: {
  hex: ArenaHex;
  center: PixelPoint;
  agent?: BattleAgent;
  items?: TileItem[];
  isAttackSource: boolean;
  isAttackTarget: boolean;
  /** Agent is in the dying animation transition (1s window after death). */
  isDying?: boolean;
  /** Agent has finished dying and is now a ghost (final resting state). */
  isGhost?: boolean;
  /** Pixel offset for movement animation. Agent renders at center + offset, transitions to (0,0). */
  animOffset?: { x: number; y: number };
  /** Whether this tile is in the storm zone. */
  isStormTile?: boolean;
  /** Whether this tile is in the safe zone (and storm is active). */
  isSafeZone?: boolean;
  /** Current battle phase for terrain styling. */
  effectivePhase?: BattlePhase;
}) {
  const occupied = !!agent;
  const isDead = agent && !agent.alive;
  const isDefending = agent?.defending;
  const isWinner = agent?.isWinner;

  // Determine hex colors — dying agents keep class colors, only ghosts go dead
  let agentColors = { fill: "none", stroke: "none", glow: "none" };
  if (agent) {
    if (isGhost) {
      agentColors = DEAD_COLORS;
    } else {
      agentColors = CLASS_HEX_COLORS[agent.class];
    }
  }

  // Winner override
  if (isWinner) {
    agentColors = {
      fill: "#2a1f0a",
      stroke: "#fbbf24",
      glow: "rgba(245,158,11,0.7)",
    };
  }

  // Base tile styling from tile level (4-tier)
  const tileCfg = TILE_LEVEL_COLORS[hex.tileLevel];
  // Determine if this is the cornucopia center tile (q=0, r=0)
  const isCornucopiaCenter = hex.q === 0 && hex.r === 0;

  // Compute per-tile terrain styling (storm / safe / cornucopia)
  let baseFill: string;
  let baseStroke: string;
  let baseStrokeWidth: number;
  let baseDash: string | undefined;
  let tileAnimClass = "";

  if (occupied) {
    baseFill = agentColors.fill;
    baseStroke = agentColors.stroke;
    baseStrokeWidth = 2;
    baseDash = undefined;
  } else if (isStormTile && effectivePhase !== "LOOT") {
    // Storm zone: dark tinted fill + colored pulsing border
    const stormStyle = STORM_TILE_STYLE[effectivePhase];
    baseFill = stormStyle.fill;
    baseStroke = stormStyle.stroke;
    baseStrokeWidth = stormStyle.strokeWidth;
    baseDash = "6,3";
    tileAnimClass = stormStyle.animClass;
  } else if (isSafeZone && effectivePhase !== "LOOT") {
    // Safe zone: keep tile-level fill, add green border
    const safeStyle = SAFE_TILE_STYLE[effectivePhase];
    baseFill = tileCfg.fill;
    baseStroke = safeStyle.stroke;
    baseStrokeWidth = safeStyle.strokeWidth;
    baseDash = undefined;
  } else {
    // Default: use tile level colors
    baseFill = tileCfg.fill;
    baseStroke = tileCfg.stroke;
    baseStrokeWidth = tileCfg.strokeWidth;
    baseDash = tileCfg.dashArray;
  }

  const vertices = hexVertices(center.x, center.y, HEX_SIZE - 2);
  const innerVertices = hexVertices(center.x, center.y, HEX_SIZE - 6);

  // HP bar dimensions
  const barWidth = HEX_SIZE * 0.85;
  const barHeight = 5;
  const barX = center.x - barWidth / 2;
  const barY = center.y + 27;
  const hpPct = agent ? Math.max(0, agent.hp / agent.maxHp) : 0;

  // HP color
  let hpColor = "#22c55e";
  if (hpPct <= 0.3) hpColor = "#dc2626";
  else if (hpPct <= 0.6) hpColor = "#f59e0b";

  const cfg = agent ? CLASS_CONFIG[agent.class] ?? CLASS_CONFIG.WARRIOR : null;

  return (
    <g
      style={{
        ...(isWinner
          ? {
              filter: "url(#winner-glow)",
              transform: `translate(${center.x}px, ${center.y}px) scale(1.15) translate(${-center.x}px, ${-center.y}px)`,
              transition:
                "transform 0.6s ease-out, filter 0.6s ease-out",
            }
          : {}),
        ...(occupied ? { cursor: "pointer" } : {}),
      }}
      role={occupied ? "button" : undefined}
      tabIndex={occupied ? 0 : undefined}
      aria-label={
        agent
          ? `${agent.name} - ${agent.class} - ${agent.hp}/${agent.maxHp} HP`
          : undefined
      }
    >
      {/* Invisible touch target: ensures >= 44px tap area on mobile */}
      {occupied && (
        <circle
          cx={center.x}
          cy={center.y}
          r={Math.max(HEX_SIZE, 37)}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: "all" }}
        />
      )}

      {/* Glow filter for active states */}
      {(isDefending || isWinner || isAttackSource) && (
        <polygon
          points={hexVertices(center.x, center.y, HEX_SIZE + 4)}
          fill="none"
          stroke={
            isWinner
              ? "rgba(245,158,11,0.3)"
              : isDefending
                ? "rgba(124,58,237,0.3)"
                : "rgba(220,38,38,0.3)"
          }
          strokeWidth="3"
          opacity="0.6"
        >
          <animate
            attributeName="opacity"
            values="0.3;0.7;0.3"
            dur={isWinner ? "1.5s" : "1s"}
            repeatCount="indefinite"
          />
        </polygon>
      )}

      {/* Defend shield hex (outer) */}
      {isDefending && !isDead && (
        <polygon
          points={hexVertices(center.x, center.y, HEX_SIZE + 2)}
          fill="none"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="1.5"
          strokeDasharray="6,3"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="18"
            dur="1.5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="stroke"
            values="rgba(124,58,237,0.3);rgba(167,139,250,0.7);rgba(124,58,237,0.3)"
            dur="2s"
            repeatCount="indefinite"
          />
        </polygon>
      )}

      {/* Main hex shape — tile-type colored background with terrain styling */}
      <polygon
        points={vertices}
        fill={baseFill}
        stroke={baseStroke}
        strokeWidth={baseStrokeWidth}
        strokeDasharray={baseDash}
        opacity={isGhost ? 0.5 : 1}
        className={tileAnimClass || undefined}
      />

      {/* Cornucopia center tile (q=0, r=0) — persistent gold glow */}
      {isCornucopiaCenter && !occupied && (
        <>
          {/* Outer gold halo */}
          <polygon
            points={hexVertices(center.x, center.y, HEX_SIZE + 3)}
            fill="none"
            stroke="rgba(245, 158, 11, 0.25)"
            strokeWidth="2"
            className="tile-cornucopia-glow"
          />
          {/* Inner gold radial fill */}
          <polygon
            points={hexVertices(center.x, center.y, HEX_SIZE - 8)}
            fill="rgba(245, 158, 11, 0.15)"
            stroke="none"
            className="tile-cornucopia-inner"
          />
        </>
      )}

      {/* Legendary / Epic center glow (non-center cornucopia tiles) */}
      {hex.tileLevel >= 3 && !isCornucopiaCenter && !occupied && (
        <polygon
          points={hexVertices(center.x, center.y, HEX_SIZE - 10)}
          fill={hex.tileLevel === 4 ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.06)"}
          stroke="none"
        />
      )}

      {/* Level badge (bottom-right of tile) */}
      {!occupied && (
        <text
          x={center.x + HEX_SIZE * 0.35}
          y={center.y + HEX_SIZE * 0.55}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={LEVEL_BADGE[hex.tileLevel].color}
          fontSize="7"
          fontFamily="monospace"
          fontWeight="bold"
        >
          {LEVEL_BADGE[hex.tileLevel].label}
        </text>
      )}

      {/* Inner hex accent line */}
      {occupied && !isGhost && (
        <polygon
          points={innerVertices}
          fill="none"
          stroke={baseStroke}
          strokeWidth="0.5"
          opacity="0.3"
        />
      )}

      {/* Attack target flash */}
      {isAttackTarget && !isDead && (
        <polygon points={vertices} fill="rgba(220,38,38,0.2)" stroke="none">
          <animate
            attributeName="fill"
            values="rgba(220,38,38,0.3);rgba(255,255,255,0.15);rgba(220,38,38,0.05)"
            dur="0.6s"
            repeatCount="3"
          />
        </polygon>
      )}

      {/* Items on tile (rendered behind agents for non-occupied tiles) */}
      {items && items.length > 0 && !occupied && (
        <g>
          {items.slice(0, 3).map((item, i) => (
            <ItemIcon key={item.id} item={item} cx={center.x} cy={center.y} index={i} />
          ))}
        </g>
      )}

      {/* Empty hex label */}
      {!occupied && (!items || items.length === 0) && (
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={hex.tileLevel >= 3 ? "rgba(245,158,11,0.35)" : "rgba(100,100,130,0.3)"}
          fontSize="8"
          fontFamily="monospace"
          letterSpacing="0.1em"
        >
          {hex.label}
        </text>
      )}

      {/* Agent content with class-colored glow + movement animation */}
      {agent && (() => {
        // Glow: class-colored drop-shadow, intensity inversely proportional to HP
        const agentGlowColor = isGhost ? null : agentColors.stroke;
        const glowBlur = isGhost ? 0 : Math.round(2 + (1 - hpPct) * 4); // 2px full HP -> 6px near death
        const isLowHp = !isDead && hpPct > 0 && hpPct < 0.25;
        const glowFilter = agentGlowColor
          ? `drop-shadow(0 0 ${glowBlur}px ${agentGlowColor})`
          : "none";
        const glowFilterIntense = agentGlowColor
          ? `drop-shadow(0 0 ${glowBlur + 4}px ${agentGlowColor}) drop-shadow(0 0 ${glowBlur + 2}px ${agentGlowColor})`
          : "none";

        // Movement animation: offset from old tile, CSS transition slides to (0,0)
        const ox = animOffset?.x ?? 0;
        const oy = animOffset?.y ?? 0;
        const moveTransform = `translate(${ox}px, ${oy}px)`;
        const moveTransition = "transform 300ms ease-out";

        const agentContent = (
          <>
            {/* Agent portrait (foreignObject for reliable image loading) */}
            {(() => {
              const portraitSize = 38;
              const px = center.x - portraitSize / 2;
              const py = center.y - 14 - portraitSize / 2;
              return (
                <g>
                  <foreignObject
                    x={px}
                    y={py}
                    width={portraitSize}
                    height={portraitSize}
                    style={{ overflow: "hidden" }}
                  >
                    <HexPortrait
                      src={cfg?.image}
                      alt={agent.name}
                      emoji={cfg?.emoji}
                      size={portraitSize}
                      clipPath="polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)"
                    />
                  </foreignObject>
                  {/* Hex border around portrait */}
                  <polygon
                    points={hexVertices(center.x, center.y - 14, portraitSize / 2 + 1)}
                    fill="none"
                    stroke={agentColors.stroke}
                    strokeWidth="1.5"
                    opacity="0.7"
                  />
                </g>
              );
            })()}

            {/* Agent name */}
            <text
              x={center.x}
              y={center.y + 10}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isWinner ? "#fbbf24" : isGhost ? "#555" : "#fff"}
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
              letterSpacing="0.04em"
            >
              {agent.name.length > 10
                ? agent.name.slice(0, 9) + ".."
                : agent.name}
            </text>

            {/* Class badge (colored pill below name) */}
            {(() => {
              const badgeY = center.y + 20;
              const badgeText = agent.class;
              const badgeWidth = 40;
              const badgeHeight = 11;
              return (
                <g>
                  <rect
                    x={center.x - badgeWidth / 2}
                    y={badgeY - badgeHeight / 2}
                    width={badgeWidth}
                    height={badgeHeight}
                    rx="3"
                    fill={agentColors.stroke}
                    opacity="0.3"
                  />
                  <text
                    x={center.x}
                    y={badgeY + 0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={agentColors.stroke}
                    fontSize="7"
                    fontWeight="bold"
                    fontFamily="monospace"
                    letterSpacing="0.06em"
                  >
                    {badgeText}
                  </text>
                </g>
              );
            })()}

            {/* HP bar background */}
            <rect
              x={barX}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx="2"
              fill="#0a0a10"
              stroke="#222"
              strokeWidth="0.5"
            />

            {/* HP bar fill */}
            <rect
              x={barX}
              y={barY}
              width={barWidth * hpPct}
              height={barHeight}
              rx="2"
              fill={hpColor}
              style={{ transition: "width 0.5s ease-out" }}
            />

            {/* HP text */}
            <text
              x={center.x}
              y={barY + barHeight + 10}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isGhost ? "#555" : "#999"}
              fontSize="8"
              fontFamily="monospace"
            >
              {agent.hp}/{agent.maxHp}
            </text>

            {/* Kill count */}
            {agent.kills > 0 && (
              <g>
                <text
                  x={center.x + barWidth / 2 - 2}
                  y={center.y - 30}
                  textAnchor="end"
                  fill="#dc2626"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {agent.kills}K
                </text>
              </g>
            )}

            {/* Prediction result indicator */}
            {agent.predictionResult && !isDead && (
              <circle
                cx={center.x - barWidth / 2 + 5}
                cy={center.y - 32}
                r="5"
                fill={
                  agent.predictionResult === "correct"
                    ? "rgba(34,197,94,0.8)"
                    : "rgba(220,38,38,0.8)"
                }
              >
                <animate
                  attributeName="r"
                  values="5;7;5"
                  dur="0.8s"
                  repeatCount="2"
                />
                <animate
                  attributeName="opacity"
                  values="1;0.5;1"
                  dur="0.8s"
                  repeatCount="2"
                />
              </circle>
            )}
            {agent.predictionResult && !isDead && (
              <text
                x={center.x - barWidth / 2 + 5}
                y={center.y - 31}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="7"
                fontWeight="bold"
              >
                {agent.predictionResult === "correct" ? "\u2713" : "\u2717"}
              </text>
            )}
          </>
        );

        // Determine agent visual variant (dying/ghost/lowHP/normal)
        let agentVisual: React.ReactNode;

        // Dying agent: full multi-step death choreography (~1.5s)
        if (isDying) {
          agentVisual = (
            <>
              {/* Phase 1: Red flash overlay (~200ms) */}
              <motion.polygon
                points={vertices}
                fill="rgba(220,38,38,0.6)"
                stroke="none"
                initial={{ opacity: 0.6 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />

              {/* Phase 2: REKT text spring-in (~400ms, delayed 150ms) */}
              <motion.text
                x={center.x}
                y={center.y - 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#dc2626"
                fontSize="18"
                fontWeight="900"
                fontFamily="monospace"
                letterSpacing="0.2em"
                style={{ transformOrigin: `${center.x}px ${center.y - 2}px`, textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.7)' }}
                initial={{ scale: 0, rotate: -30, opacity: 0 }}
                animate={{ scale: 1, rotate: -12, opacity: 0.85 }}
                transition={{
                  type: "spring",
                  stiffness: 280,
                  damping: 14,
                  delay: 0.15,
                }}
              >
                REKT
              </motion.text>

              {/* Phase 3a: Agent content transitioning to ghost (~600ms, delayed 600ms) */}
              <motion.g
                initial={{ opacity: 1 }}
                animate={{ opacity: 0.4 }}
                transition={{ duration: 0.6, delay: 0.6, ease: "easeOut" }}
                style={{ filter: glowFilter }}
              >
                {agentContent}
              </motion.g>

              {/* Phase 3b: ELIMINATED text fades in (delayed 800ms) */}
              <motion.text
                x={center.x}
                y={center.y + 38}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#666"
                fontSize="6"
                fontFamily="monospace"
                fontWeight="bold"
                letterSpacing="0.15em"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                transition={{ duration: 0.4, delay: 0.8 }}
              >
                ELIMINATED
              </motion.text>

              {/* Death X marks (fade in during ghost transition) */}
              <motion.line
                x1={center.x - 16}
                y1={center.y - 4}
                x2={center.x + 16}
                y2={center.y + 4}
                stroke="rgba(220,38,38,0.4)"
                strokeWidth="2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.5 }}
              />
              <motion.line
                x1={center.x + 16}
                y1={center.y - 4}
                x2={center.x - 16}
                y2={center.y + 4}
                stroke="rgba(220,38,38,0.4)"
                strokeWidth="2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.5 }}
              />
            </>
          );
        } else if (isGhost) {
          // Ghost agent: final resting state — fully faded, grayscale, non-interactive
          agentVisual = (
            <g
              opacity={0.4}
              style={{ filter: "grayscale(1)", pointerEvents: "none" }}
            >
              {agentContent}
            </g>
          );
        } else if (isLowHp) {
          // Low HP (<25%): pulsing glow via motion.g
          agentVisual = (
            <motion.g
              style={{ filter: glowFilter }}
              animate={{ filter: [glowFilter, glowFilterIntense, glowFilter] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              {agentContent}
            </motion.g>
          );
        } else {
          // Normal alive agent: floating glow to distinguish from empty tiles
          agentVisual = (
            <motion.g
              style={{ filter: glowFilter }}
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
              {agentContent}
            </motion.g>
          );
        }

        // Wrap in movement animation <g> — offsets agent from old tile, CSS transition slides to new tile
        return (
          <g style={{
            transform: moveTransform,
            transition: moveTransition,
          }}>
            {agentVisual}
          </g>
        );
      })()}

      {/* REKT overlay — only in ghost state, not during dying transition */}
      {isGhost && (
        <g>
          {/* Death X marks */}
          <line
            x1={center.x - 16}
            y1={center.y - 4}
            x2={center.x + 16}
            y2={center.y + 4}
            stroke="rgba(220,38,38,0.4)"
            strokeWidth="2"
          />
          <line
            x1={center.x + 16}
            y1={center.y - 4}
            x2={center.x - 16}
            y2={center.y + 4}
            stroke="rgba(220,38,38,0.4)"
            strokeWidth="2"
          />
          <text
            x={center.x}
            y={center.y - 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#dc2626"
            fontSize="18"
            fontWeight="900"
            fontFamily="monospace"
            letterSpacing="0.2em"
            opacity="0.85"
            transform={`rotate(-12, ${center.x}, ${center.y})`}
            style={{ textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.7)' }}
          >
            REKT
          </text>
          <text
            x={center.x}
            y={center.y + 38}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#666"
            fontSize="6"
            fontFamily="monospace"
            fontWeight="bold"
            letterSpacing="0.15em"
            opacity="0.6"
          >
            ELIMINATED
          </text>
        </g>
      )}

      {/* Winner crown */}
      {isWinner && (
        <text
          x={center.x}
          y={center.y - 38}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="18"
        >
          <animate
            attributeName="y"
            values={`${center.y - 38};${center.y - 42};${center.y - 38}`}
            dur="1.5s"
            repeatCount="indefinite"
          />
          {"\uD83D\uDC51"}
        </text>
      )}
    </g>
  );
}

/** Animated attack line between two hex centers. */
function AttackLine({
  from,
  to,
  blocked,
}: {
  from: PixelPoint;
  to: PixelPoint;
  blocked: boolean;
}) {
  // Calculate a point slightly offset from the target for the arrowhead
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / len;
  const ny = dy / len;

  // Stop the line at the hex edge (HEX_SIZE away from center)
  const endX = to.x - nx * (HEX_SIZE - 5);
  const endY = to.y - ny * (HEX_SIZE - 5);
  const startX = from.x + nx * (HEX_SIZE - 5);
  const startY = from.y + ny * (HEX_SIZE - 5);

  // Arrowhead
  const arrowSize = 7;
  const arrowAngle = Math.atan2(dy, dx);
  const a1x = endX - arrowSize * Math.cos(arrowAngle - 0.4);
  const a1y = endY - arrowSize * Math.sin(arrowAngle - 0.4);
  const a2x = endX - arrowSize * Math.cos(arrowAngle + 0.4);
  const a2y = endY - arrowSize * Math.sin(arrowAngle + 0.4);

  const lineColor = blocked ? "rgba(124,58,237,0.6)" : "rgba(220,38,38,0.8)";
  const glowColor = blocked ? "rgba(124,58,237,0.3)" : "rgba(220,38,38,0.4)";

  return (
    <g>
      {/* Glow line */}
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={glowColor}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Main attack line */}
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={lineColor}
        strokeWidth="2"
        strokeDasharray={blocked ? "6,4" : "none"}
        strokeLinecap="round"
      >
        {!blocked && (
          <animate
            attributeName="stroke-dashoffset"
            from="20"
            to="0"
            dur="0.3s"
            fill="freeze"
          />
        )}
      </line>

      {/* Arrowhead */}
      <polygon
        points={`${endX},${endY} ${a1x},${a1y} ${a2x},${a2y}`}
        fill={lineColor}
      />

      {/* Blocked indicator (shield burst) */}
      {blocked && (
        <g>
          <circle cx={endX} cy={endY} r="8" fill="none" stroke="rgba(124,58,237,0.6)" strokeWidth="1.5">
            <animate attributeName="r" values="5;12;5" dur="0.8s" repeatCount="3" />
            <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="3" />
          </circle>
          <text
            x={endX}
            y={endY - 14}
            textAnchor="middle"
            fill="#a78bfa"
            fontSize="8"
            fontWeight="bold"
            fontFamily="monospace"
          >
            BLOCKED
          </text>
        </g>
      )}

      {/* Impact sparks at target (non-blocked) */}
      {!blocked && (
        <g>
          {[0, 60, 120, 180, 240, 300].map((angle) => {
            const rad = (angle * Math.PI) / 180;
            const sparkLen = 10;
            return (
              <line
                key={angle}
                x1={endX}
                y1={endY}
                x2={endX + sparkLen * Math.cos(rad)}
                y2={endY + sparkLen * Math.sin(rad)}
                stroke="rgba(245,158,11,0.7)"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <animate
                  attributeName="x2"
                  from={String(endX)}
                  to={String(endX + sparkLen * Math.cos(rad))}
                  dur="0.4s"
                  fill="freeze"
                />
                <animate
                  attributeName="y2"
                  from={String(endY)}
                  to={String(endY + sparkLen * Math.sin(rad))}
                  dur="0.4s"
                  fill="freeze"
                />
                <animate
                  attributeName="opacity"
                  values="1;0"
                  dur="0.6s"
                  fill="freeze"
                />
              </line>
            );
          })}
        </g>
      )}
    </g>
  );
}

/** Floating damage/heal number that drifts upward and fades. */
function FloatingNumber({
  text,
  x,
  y,
  color,
}: {
  text: string;
  x: number;
  y: number;
  color: string;
}) {
  return (
    <motion.text
      x={x}
      textAnchor="middle"
      fill={color}
      fontSize="13"
      fontWeight="900"
      fontFamily="monospace"
      style={{ transformOrigin: "center center" }}
      initial={{ y, opacity: 1, scale: 1.5 }}
      animate={{ y: y - 45, opacity: 0, scale: 1 }}
      transition={{
        y: { type: "spring", stiffness: 80, damping: 12 },
        opacity: { duration: 1.4, ease: "easeOut" },
        scale: { type: "spring", stiffness: 200, damping: 10, bounce: 0.4 },
      }}
    >
      {text}
    </motion.text>
  );
}

// ---------------------------------------------------------------------------
// Movement trail arrow — animated dashed line from old tile to new tile
// ---------------------------------------------------------------------------

function MovementTrail({
  from,
  to,
  color,
  success,
  trailOpacity = 1,
}: {
  from: PixelPoint;
  to: PixelPoint;
  color: string;
  success: boolean;
  /** Opacity multiplier based on trail age: 1.0 = current epoch, 0.5 = 1 epoch old. */
  trailOpacity?: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;

  const nx = dx / len;
  const ny = dy / len;

  // Shorten line to not overlap hex shapes
  const startX = from.x + nx * (HEX_SIZE * 0.5);
  const startY = from.y + ny * (HEX_SIZE * 0.5);
  const endX = to.x - nx * (HEX_SIZE * 0.5);
  const endY = to.y - ny * (HEX_SIZE * 0.5);

  // Arrowhead
  const arrowSize = 5;
  const arrowAngle = Math.atan2(dy, dx);
  const a1x = endX - arrowSize * Math.cos(arrowAngle - 0.4);
  const a1y = endY - arrowSize * Math.sin(arrowAngle - 0.4);
  const a2x = endX - arrowSize * Math.cos(arrowAngle + 0.4);
  const a2y = endY - arrowSize * Math.sin(arrowAngle + 0.4);

  const lineColor = success ? color : "rgba(220,38,38,0.5)";
  const isCurrent = trailOpacity >= 1;

  return (
    <g opacity={trailOpacity}>
      {/* Trail line */}
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={lineColor}
        strokeWidth={isCurrent ? 2 : 1.5}
        strokeDasharray="4,3"
        opacity="0.5"
        strokeLinecap="round"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="14"
          to="0"
          dur="0.8s"
          repeatCount="indefinite"
        />
        {/* Current epoch trails fade out; older trails stay at their reduced opacity */}
        {isCurrent && (
          <animate
            attributeName="opacity"
            values="0.6;0.3;0"
            dur="2s"
            fill="freeze"
          />
        )}
      </line>

      {/* Arrow head */}
      {success && (
        <polygon
          points={`${endX},${endY} ${a1x},${a1y} ${a2x},${a2y}`}
          fill={lineColor}
          opacity="0.5"
        >
          {isCurrent && (
            <animate
              attributeName="opacity"
              values="0.6;0.3;0"
              dur="2s"
              fill="freeze"
            />
          )}
        </polygon>
      )}

      {/* Failed move: red X at target */}
      {!success && (
        <g>
          <line
            x1={to.x - 5}
            y1={to.y - 5}
            x2={to.x + 5}
            y2={to.y + 5}
            stroke="rgba(220,38,38,0.6)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {isCurrent && (
              <animate attributeName="opacity" values="0.8;0;0" dur="2s" fill="freeze" />
            )}
          </line>
          <line
            x1={to.x + 5}
            y1={to.y - 5}
            x2={to.x - 5}
            y2={to.y + 5}
            stroke="rgba(220,38,38,0.6)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {isCurrent && (
              <animate attributeName="opacity" values="0.8;0;0" dur="2s" fill="freeze" />
            )}
          </line>
        </g>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Storm overlay — semi-transparent hex polygon on storm tiles
// ---------------------------------------------------------------------------

/** Render a storm overlay polygon on a single hex tile. Uses CSS class for pulse animation. */
function StormHexOverlay({
  center,
  phase,
}: {
  center: PixelPoint;
  phase: BattlePhase;
}) {
  const visual = STORM_PHASE_VISUALS[phase];
  if (!visual.fill || visual.fill === "transparent") return null;

  const vertices = hexVertices(center.x, center.y, HEX_SIZE - 2);
  return (
    <polygon
      points={vertices}
      fill={visual.fill}
      stroke="none"
      className={visual.animClass}
      style={{ pointerEvents: "none" }}
    />
  );
}

/** Render a safe-zone glow on a non-storm hex tile. Only shown in BLOOD/FINAL_STAND. */
function SafeZoneGlow({
  center,
  phase,
}: {
  center: PixelPoint;
  phase: BattlePhase;
}) {
  const visual = STORM_PHASE_VISUALS[phase];
  if (!visual.safeGlow) return null;

  const vertices = hexVertices(center.x, center.y, HEX_SIZE - 2);
  return (
    <polygon
      points={vertices}
      fill={visual.safeGlow}
      stroke="rgba(34, 197, 94, 0.2)"
      strokeWidth="1"
      className="safe-zone-glow"
      style={{ pointerEvents: "none" }}
    />
  );
}

/**
 * Compute the boundary edges between storm and safe tiles.
 * Returns an array of line segments (pairs of pixel points) on the shared hex edges.
 *
 * For flat-top hexagons, the 6 edge midpoints correspond to the 6 axial neighbors.
 * We draw a line segment along the hex edge (vertex[i] to vertex[(i+1)%6]) for each
 * edge where one side is storm and the other is safe.
 */
function computeStormBoundaryEdges(
  stormKeySet: Set<string>,
  hexCenters: Map<string, PixelPoint>,
  arenaHexes: ArenaHex[],
): { x1: number; y1: number; x2: number; y2: number }[] {
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];

  // Axial neighbor directions for flat-top hex
  const AXIAL_DIRS: [number, number][] = [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1],
  ];

  // For flat-top hexes, neighbor direction i shares the edge between vertex i and vertex (i+1)%6
  // But the mapping between axial direction index and vertex index depends on orientation.
  // For flat-top: direction 0 (+q) shares edge between vertex 0 (right) and vertex 5 (bottom-right)
  // Actually let me compute precisely.
  //
  // Flat-top vertex angles: 0, 60, 120, 180, 240, 300 degrees
  // Vertex 0 is at 0 deg (right), vertex 1 at 60 deg, etc.
  //
  // Neighbor directions (axial):
  //   dir 0: (+1, 0)  -> neighbor is to the right   -> shared edge: vertex 5 to vertex 0
  //   dir 1: (+1,-1)  -> neighbor is upper-right     -> shared edge: vertex 0 to vertex 1
  //   dir 2: (0, -1)  -> neighbor is upper-left      -> shared edge: vertex 1 to vertex 2
  //   dir 3: (-1, 0)  -> neighbor is to the left     -> shared edge: vertex 2 to vertex 3
  //   dir 4: (-1,+1)  -> neighbor is lower-left      -> shared edge: vertex 3 to vertex 4
  //   dir 5: (0, +1)  -> neighbor is lower-right     -> shared edge: vertex 4 to vertex 5
  const DIR_TO_EDGE: [number, number][] = [
    [5, 0], // dir 0: right
    [0, 1], // dir 1: upper-right
    [1, 2], // dir 2: upper-left
    [2, 3], // dir 3: left
    [3, 4], // dir 4: lower-left
    [4, 5], // dir 5: lower-right
  ];

  for (const hex of arenaHexes) {
    const key = `${hex.q},${hex.r}`;
    const isStorm = stormKeySet.has(key);
    if (!isStorm) continue; // Only process storm tiles looking outward to safe neighbors

    const center = hexCenters.get(key);
    if (!center) continue;

    for (let d = 0; d < 6; d++) {
      const [dq, dr] = AXIAL_DIRS[d];
      const nq = hex.q + dq;
      const nr = hex.r + dr;
      const neighborKey = `${nq},${nr}`;

      // Boundary exists if neighbor is safe (exists and not in storm set)
      // OR neighbor is outside the grid (we don't draw boundary at grid edge)
      const neighborExists = hexCenters.has(neighborKey);
      if (!neighborExists) continue; // Don't draw boundary at grid edge
      if (stormKeySet.has(neighborKey)) continue; // Both storm — no boundary

      // Draw edge segment: vertices of the storm hex on the shared side
      const [v1Idx, v2Idx] = DIR_TO_EDGE[d];
      const size = HEX_SIZE - 2; // Match the tile polygon size
      const v1Angle = (v1Idx * 60) * (Math.PI / 180);
      const v2Angle = (v2Idx * 60) * (Math.PI / 180);

      edges.push({
        x1: center.x + size * Math.cos(v1Angle),
        y1: center.y + size * Math.sin(v1Angle),
        x2: center.x + size * Math.cos(v2Angle),
        y2: center.y + size * Math.sin(v2Angle),
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Portrait helper — uses React state so fallback survives re-renders
// ---------------------------------------------------------------------------

function HexPortrait({ src, alt, emoji, size, clipPath }: {
  src?: string; alt: string; emoji?: string; size: number; clipPath?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ width: size, height: size, clipPath, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {!failed && src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} width={size} height={size}
          style={{ objectFit: "cover", width: "100%", height: "100%" }}
          onError={() => setFailed(true)} />
      ) : (
        <span style={{ fontSize: size * 0.6, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
          {emoji}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HexBattleArena({
  agents,
  currentEpoch,
  agentPositions: externalPositions,
  tileItems: externalTileItems,
  sponsorEventCount = 0,
  recentMoves = [],
  stormTiles: externalStormTiles = [],
  currentPhase = null,
}: HexBattleArenaProps) {
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);

  // ---------------------------------------------------------------------------
  // Death transition state machine: alive -> dying (1s) -> ghost
  // ---------------------------------------------------------------------------

  /** Track previous alive state per agent to detect alive->dead transitions. */
  const prevAliveRef = useRef<Map<string, boolean>>(new Map());

  /** Set of agent IDs currently in the dying animation (~1.5s window). */
  const [dyingAgents, setDyingAgents] = useState<Set<string>>(new Set());

  // Particle effects system
  const {
    effects: particleEffects,
    removeEffect,
    spawnAttack,
    spawnDefend,
    spawnDeath,
    spawnSponsor,
    spawnPredictionWin,
    spawnPredictionLoss,
  } = useParticleEffects();

  // Screen shake for combat feedback
  const { ShakeWrapper, triggerShake } = useScreenShake();

  // Compute hex pixel centers for all 37 tiles
  const hexCenters = useMemo(() => {
    const centers = new Map<string, PixelPoint>();
    for (const hex of ARENA_HEXES) {
      centers.set(`${hex.q},${hex.r}`, axialToPixel(hex.q, hex.r));
    }
    return centers;
  }, []);

  // Assign agents to hexes
  const positions = useMemo(() => {
    if (externalPositions && externalPositions.size > 0) {
      // Check if all agents have positions — fill missing ones with defaults
      const missingAgents = agents.filter((a) => !externalPositions.has(a.id));
      if (missingAgents.length === 0) return externalPositions;

      // Merge: keep existing positions, assign defaults for missing agents
      const merged = new Map(externalPositions);
      const occupiedKeys = new Set(
        [...externalPositions.values()].map((c) => `${c.q},${c.r}`),
      );
      const defaults = assignDefaultPositions(missingAgents.map((a) => a.id));
      for (const [agentId, coord] of defaults) {
        const key = `${coord.q},${coord.r}`;
        if (!occupiedKeys.has(key)) {
          merged.set(agentId, coord);
          occupiedKeys.add(key);
        } else {
          // Slot taken — find any unoccupied tile
          for (const hex of ARENA_HEXES) {
            const hk = `${hex.q},${hex.r}`;
            if (!occupiedKeys.has(hk)) {
              merged.set(agentId, { q: hex.q, r: hex.r });
              occupiedKeys.add(hk);
              break;
            }
          }
        }
      }
      return merged;
    }
    return assignDefaultPositions(agents.map((a) => a.id));
  }, [agents, externalPositions]);

  // Track previous positions for movement animation
  const prevPositionsRef = useRef<Map<string, HexCoord>>(new Map());

  // ---------------------------------------------------------------------------
  // Movement animation offset state
  // ---------------------------------------------------------------------------

  /**
   * Pixel offsets for agents currently animating between tiles.
   * Key: agentId, Value: pixel offset from new tile center.
   * Starts as (oldPixel - newPixel), transitions to (0,0) via CSS transition.
   */
  const [animOffsets, setAnimOffsets] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Build lookup: agentId -> pixel center (with motion animation support)
  const agentPixelPositions = useMemo(() => {
    const map = new Map<string, PixelPoint>();
    for (const [agentId, coord] of positions) {
      const key = `${coord.q},${coord.r}`;
      const center = hexCenters.get(key);
      if (center) {
        map.set(agentId, center);
      }
    }
    return map;
  }, [positions, hexCenters]);

  // Detect position changes and trigger movement animation offsets
  useEffect(() => {
    const prevPositions = prevPositionsRef.current;
    const newOffsets = new Map<string, { x: number; y: number }>();

    for (const [agentId, newCoord] of positions) {
      const oldCoord = prevPositions.get(agentId);
      if (!oldCoord) continue; // First render, no animation
      // Check if position actually changed
      if (oldCoord.q === newCoord.q && oldCoord.r === newCoord.r) continue;

      const oldKey = `${oldCoord.q},${oldCoord.r}`;
      const newKey = `${newCoord.q},${newCoord.r}`;
      const oldPixel = hexCenters.get(oldKey);
      const newPixel = hexCenters.get(newKey);
      if (!oldPixel || !newPixel) continue;

      // Set initial offset: old position relative to new position
      newOffsets.set(agentId, {
        x: oldPixel.x - newPixel.x,
        y: oldPixel.y - newPixel.y,
      });
    }

    // Update previous positions ref for next comparison
    prevPositionsRef.current = new Map(positions);

    if (newOffsets.size === 0) return;

    // Set offsets (agents render at new tile but visually start at old tile)
    setAnimOffsets(newOffsets);

    // Double-rAF: ensure the browser paints the offset before we clear it.
    // First rAF waits for commit, second rAF triggers the transition to (0,0).
    let innerRafId = 0;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        setAnimOffsets(new Map());
      });
    });

    return () => {
      cancelAnimationFrame(outerRafId);
      if (innerRafId) cancelAnimationFrame(innerRafId);
    };
  }, [positions, hexCenters]);

  // Build lookup: hex key -> agent
  const hexToAgent = useMemo(() => {
    const map = new Map<string, BattleAgent>();
    for (const agent of agents) {
      const coord = positions.get(agent.id);
      if (coord) {
        map.set(`${coord.q},${coord.r}`, agent);
      }
    }
    return map;
  }, [agents, positions]);

  // Determine attack relationships for drawing lines
  const attackLines = useMemo(() => {
    const lines: { from: PixelPoint; to: PixelPoint; blocked: boolean }[] = [];

    for (const agent of agents) {
      if (!agent.attacking || !agent.alive) continue;

      const attackerPos = agentPixelPositions.get(agent.id);
      if (!attackerPos) continue;

      for (const target of agents) {
        if (target.id === agent.id) continue;
        if (target.attacked) {
          const targetPos = agentPixelPositions.get(target.id);
          if (targetPos) {
            lines.push({
              from: attackerPos,
              to: targetPos,
              blocked: target.defending,
            });
          }
        }
      }
    }

    return lines;
  }, [agents, agentPixelPositions]);

  // ---------------------------------------------------------------------------
  // SVG-to-normalized coordinate conversion for particle effects
  // ---------------------------------------------------------------------------

  /** Convert an SVG pixel position to a normalized (0-1) position within the container. */
  const svgToNormalized = useCallback(
    (svgX: number, svgY: number): { nx: number; ny: number } => {
      const allPoints = ARENA_HEXES.map((h) => axialToPixel(h.q, h.r));
      const pad = HEX_SIZE + 60;
      const minX = Math.min(...allPoints.map((p) => p.x)) - pad;
      const minY = Math.min(...allPoints.map((p) => p.y)) - pad;
      const maxX = Math.max(...allPoints.map((p) => p.x)) + pad;
      const maxY = Math.max(...allPoints.map((p) => p.y)) + pad;
      const vbWidth = maxX - minX;
      const vbHeight = maxY - minY;

      return {
        nx: (svgX - minX) / vbWidth,
        ny: (svgY - minY) / vbHeight,
      };
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Death sequence: detect alive->dead transitions, trigger choreography
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const newDying: string[] = [];

    for (const agent of agents) {
      const wasAlive = prevAliveRef.current.get(agent.id);
      const isDead = !agent.alive;

      // Detect alive -> dead transition (skip first render where wasAlive is undefined)
      if (wasAlive === true && isDead) {
        newDying.push(agent.id);
      }

      prevAliveRef.current.set(agent.id, agent.alive);
    }

    if (newDying.length > 0) {
      setDyingAgents((prev) => {
        const next = new Set(prev);
        for (const id of newDying) next.add(id);
        return next;
      });

      // 1. Heavy screen shake
      triggerShake("heavy");

      // 2. Death particle explosion for each dying agent
      for (const id of newDying) {
        const pos = agentPixelPositions.get(id);
        if (pos) {
          const { nx, ny } = svgToNormalized(pos.x, pos.y);
          const dyingAgent = agents.find((a) => a.id === id);
          spawnDeath(nx, ny, dyingAgent?.class);
        }
      }

      // After 1.5s, transition dying -> ghost (matches choreography duration)
      const timeout = setTimeout(() => {
        setDyingAgents((prev) => {
          const next = new Set(prev);
          for (const id of newDying) next.delete(id);
          return next;
        });
      }, 1500);

      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  // ---------------------------------------------------------------------------
  // Particle effect triggering based on agent state changes
  // ---------------------------------------------------------------------------

  // Track previous agent states to detect transitions
  const prevAgentStateRef = useRef<string>("");

  // Serialized key of all transient agent states for particle triggering
  const particleStateKey = agents
    .map(
      (a) =>
        `${a.id}:${a.alive ? 1 : 0}:${a.attacking ? 1 : 0}:${a.attacked ? 1 : 0}:${a.defending ? 1 : 0}:${a.predictionResult ?? ""}:${a.isWinner ? 1 : 0}`,
    )
    .join("|");

  useEffect(() => {
    if (particleStateKey === prevAgentStateRef.current) return;
    prevAgentStateRef.current = particleStateKey;

    for (const agent of agents) {
      const pos = agentPixelPositions.get(agent.id);
      if (!pos) continue;
      const { nx, ny } = svgToNormalized(pos.x, pos.y);

      // Attack: spawn red burst from attacker + screen shake
      if (agent.attacking && agent.alive) {
        const target = agents.find((a) => a.attacked && a.id !== agent.id);
        if (target) {
          const targetPos = agentPixelPositions.get(target.id);
          if (targetPos) {
            const { nx: toNx, ny: toNy } = svgToNormalized(
              targetPos.x,
              targetPos.y,
            );
            spawnAttack(nx, ny, toNx, toNy, agent.class);
          }
        } else {
          spawnAttack(nx, ny, nx + 0.1, ny, agent.class);
        }
        triggerShake("medium");
      }

      // Defend: spawn shield shimmer
      if (agent.defending && agent.alive) {
        spawnDefend(nx, ny, agent.class);
      }

      // Prediction win: green confetti
      if (agent.predictionResult === "correct" && agent.alive) {
        spawnPredictionWin(nx, ny);
      }

      // Prediction loss: red fade
      if (agent.predictionResult === "wrong" && agent.alive) {
        spawnPredictionLoss(nx, ny);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particleStateKey]);

  // Trigger gold rain when a sponsorship event occurs
  const prevSponsorCountRef = useRef(0);
  useEffect(() => {
    if (sponsorEventCount > prevSponsorCountRef.current) {
      spawnSponsor();
      prevSponsorCountRef.current = sponsorEventCount;
    }
  }, [sponsorEventCount, spawnSponsor]);

  // Generate floating damage numbers when agents get attacked
  const spawnFloatingText = useCallback(
    (agentId: string, text: string, color: string) => {
      const pos = agentPixelPositions.get(agentId);
      if (!pos) return;

      const id = `float-${Date.now()}-${Math.random()}`;
      setFloatingTexts((prev) => [
        ...prev,
        {
          id,
          x: pos.x + (Math.random() - 0.5) * 16,
          y: pos.y - 16,
          text,
          color,
          createdAt: Date.now(),
        },
      ]);
    },
    [agentPixelPositions],
  );

  // Serialized key for floating text triggers
  const floatingTextKey = agents
    .map(
      (a) =>
        `${a.id}:${a.attacked ? 1 : 0}:${a.predictionResult ?? ""}`,
    )
    .join("|");

  // Spawn floating damage texts for attacked agents
  useEffect(() => {
    for (const agent of agents) {
      if (agent.attacked && agent.alive) {
        spawnFloatingText(agent.id, "HIT!", "#dc2626");
      }
      if (agent.predictionResult === "correct") {
        spawnFloatingText(agent.id, "+HP", "#22c55e");
      }
      if (agent.predictionResult === "wrong") {
        spawnFloatingText(agent.id, "-HP", "#dc2626");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingTextKey]);

  // Clean up old floating texts
  useEffect(() => {
    const interval = setInterval(() => {
      setFloatingTexts((prev) =>
        prev.filter((t) => Date.now() - t.createdAt < 2000),
      );
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Compute SVG viewBox to fit all 37 hexes with padding
  const viewBox = useMemo(() => {
    const allPoints = ARENA_HEXES.map((h) => axialToPixel(h.q, h.r));
    const pad = HEX_SIZE + 50;
    const minX = Math.min(...allPoints.map((p) => p.x)) - pad;
    const minY = Math.min(...allPoints.map((p) => p.y)) - pad;
    const maxX = Math.max(...allPoints.map((p) => p.x)) + pad;
    const maxY = Math.max(...allPoints.map((p) => p.y)) + pad;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, []);

  const aliveCount = agents.filter((a) => a.alive).length;

  // Identify attacking/targeted agents for hex highlighting
  const attackingIds = new Set(
    agents.filter((a) => a.attacking && a.alive).map((a) => a.id),
  );
  const attackedIds = new Set(
    agents.filter((a) => a.attacked).map((a) => a.id),
  );

  // Compute movement trail pixel positions
  const movementTrails = useMemo(() => {
    return recentMoves.map((move) => {
      const fromKey = `${move.from.q},${move.from.r}`;
      const toKey = `${move.to.q},${move.to.r}`;
      const fromCenter = hexCenters.get(fromKey);
      const toCenter = hexCenters.get(toKey);
      const agent = agents.find((a) => a.id === move.agentId);
      const agentColor = agent ? CLASS_HEX_COLORS[agent.class].stroke : "#888";
      // Trail opacity: 100% for current epoch, 50% for 1 epoch old
      const epochAge = currentEpoch - (move.epoch ?? currentEpoch);
      const trailOpacity = epochAge <= 0 ? 1 : 0.5;
      return {
        from: fromCenter,
        to: toCenter,
        color: agentColor,
        success: move.success,
        agentId: move.agentId,
        trailOpacity,
        epoch: move.epoch,
      };
    }).filter((t) => t.from && t.to);
  }, [recentMoves, hexCenters, agents, currentEpoch]);

  // ---------------------------------------------------------------------------
  // Storm overlay data — derive set of storm tile keys + boundary edges
  // ---------------------------------------------------------------------------

  const stormKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const tile of externalStormTiles) {
      set.add(`${tile.q},${tile.r}`);
    }
    return set;
  }, [externalStormTiles]);

  const stormBoundaryEdges = useMemo(() => {
    if (stormKeySet.size === 0) return [];
    return computeStormBoundaryEdges(stormKeySet, hexCenters, ARENA_HEXES);
  }, [stormKeySet, hexCenters]);

  /** Effective phase for visuals (fall back to LOOT if unknown). */
  const effectivePhase: BattlePhase = currentPhase ?? "LOOT";

  return (
    <ShakeWrapper>
    <div className="relative">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between sm:mb-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 sm:text-sm">
            The Arena
          </h2>
          <span className="rounded bg-blood/20 px-1.5 py-0.5 text-[10px] font-medium text-blood sm:px-2 sm:text-xs">
            EPOCH {currentEpoch}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-600 sm:gap-2 sm:text-xs">
          <span className="text-white">{aliveCount}</span>/{agents.length}{" "}
          alive
          <span className="ml-1 hidden text-[9px] text-gray-700 sm:ml-2 sm:inline">37 tiles</span>
        </div>
      </div>

      {/* SVG Arena */}
      <div className="relative mx-auto w-full max-w-[820px] overflow-hidden">
        {/* Background ambient glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-32 rounded-full bg-blood/5 blur-3xl sm:h-48 sm:w-48" />
        </div>

        <svg
          viewBox={viewBox}
          className="w-full touch-manipulation"
          preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* SVG Defs: filters and gradients */}
          <defs>
            {/* Glow filter for active hexes */}
            <filter id="hex-glow-red" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor="#dc2626" floodOpacity="0.3" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="hex-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor="#7c3aed" floodOpacity="0.3" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="hex-glow-gold" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feFlood floodColor="#f59e0b" floodOpacity="0.4" />
              <feComposite in2="blur" operator="in" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Winner gold glow — layered feDropShadow for prominent ring */}
            <filter id="winner-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FFD700" floodOpacity="0.6" />
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#FFD700" floodOpacity="0.3" />
            </filter>

            {/* Cornucopia center radial glow */}
            <radialGradient id="cornucopia-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(245,158,11,0.12)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>

            {/* Animated dash pattern for attack lines */}
            <pattern
              id="attack-dash"
              patternUnits="userSpaceOnUse"
              width="12"
              height="1"
            >
              <rect width="8" height="1" fill="#dc2626" />
            </pattern>
          </defs>

          {/* Cornucopia center ambient glow (covers ring 0+1) */}
          <circle
            cx={0}
            cy={0}
            r={HEX_SIZE * 2.2}
            fill="url(#cornucopia-glow)"
          />

          {/* Ambient hex grid connection lines (subtle) */}
          {ARENA_HEXES.map((hex) => {
            const center = hexCenters.get(`${hex.q},${hex.r}`)!;
            return ARENA_HEXES.filter(
              (other) =>
                (other.q !== hex.q || other.r !== hex.r) &&
                `${other.q},${other.r}` > `${hex.q},${hex.r}`,
            )
              .filter((other) => {
                // Only adjacent hexes (distance = 1)
                const dq = hex.q - other.q;
                const dr = hex.r - other.r;
                const ds = -(dq + dr);
                return (
                  Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) === 1
                );
              })
              .map((other) => {
                const otherCenter = hexCenters.get(
                  `${other.q},${other.r}`,
                )!;
                return (
                  <line
                    key={`conn-${hex.q},${hex.r}-${other.q},${other.r}`}
                    x1={center.x}
                    y1={center.y}
                    x2={otherCenter.x}
                    y2={otherCenter.y}
                    stroke={
                      hex.tileLevel >= 3 && other.tileLevel >= 3
                        ? "rgba(245,158,11,0.2)"
                        : "rgba(37,37,64,0.35)"
                    }
                    strokeWidth="1"
                  />
                );
              });
          })}

          {/* Hex tiles — all 37 with per-tile terrain styling */}
          {ARENA_HEXES.map((hex) => {
            const key = `${hex.q},${hex.r}`;
            const center = hexCenters.get(key)!;
            const agent = hexToAgent.get(key);
            const items = externalTileItems?.get(key);

            // Derive death transition states
            const agentIsDead = agent && !agent.alive;
            const agentIsDying = !!agentIsDead && dyingAgents.has(agent!.id);
            const agentIsGhost = !!agentIsDead && !agentIsDying;

            // Movement animation offset for this agent (if currently sliding)
            const agentAnimOffset = agent ? animOffsets.get(agent.id) : undefined;

            // Per-tile terrain classification
            const tileIsStorm = stormKeySet.has(key);
            const tileIsSafe = stormKeySet.size > 0 && !tileIsStorm;

            return (
              <HexTile
                key={key}
                hex={hex}
                center={center}
                agent={agent}
                items={items}
                isAttackSource={!!agent && attackingIds.has(agent.id)}
                isAttackTarget={!!agent && attackedIds.has(agent.id)}
                isDying={agentIsDying}
                isGhost={agentIsGhost}
                animOffset={agentAnimOffset}
                isStormTile={tileIsStorm}
                isSafeZone={tileIsSafe}
                effectivePhase={effectivePhase}
              />
            );
          })}

          {/* Storm overlays — rendered on top of hex tiles, below agents */}
          {stormKeySet.size > 0 && effectivePhase !== "LOOT" && (
            <>
              {/* Storm tile overlays */}
              {ARENA_HEXES.map((hex) => {
                const key = `${hex.q},${hex.r}`;
                const center = hexCenters.get(key)!;
                const isStorm = stormKeySet.has(key);

                if (isStorm) {
                  return (
                    <StormHexOverlay
                      key={`storm-${key}`}
                      center={center}
                      phase={effectivePhase}
                    />
                  );
                }

                // Safe zone glow (only in BLOOD/FINAL_STAND)
                return (
                  <SafeZoneGlow
                    key={`safe-${key}`}
                    center={center}
                    phase={effectivePhase}
                  />
                );
              })}

              {/* Storm boundary — thick dashed red line between safe and storm zones */}
              {stormBoundaryEdges.map((edge, i) => (
                <line
                  key={`storm-boundary-${i}`}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={STORM_PHASE_VISUALS[effectivePhase].stroke}
                  strokeWidth="3"
                  strokeDasharray="6,4"
                  strokeLinecap="round"
                  className="storm-boundary-line"
                  style={{ pointerEvents: "none" }}
                />
              ))}
            </>
          )}

          {/* Movement trails (persisted for 2 epochs with opacity fade) */}
          {movementTrails.map((trail, i) => (
            <MovementTrail
              key={`trail-${trail.agentId}-${trail.epoch}-${i}`}
              from={trail.from!}
              to={trail.to!}
              color={trail.color}
              success={trail.success}
              trailOpacity={trail.trailOpacity}
            />
          ))}

          {/* Attack lines */}
          {attackLines.map((line, i) => (
            <AttackLine
              key={`atk-${i}`}
              from={line.from}
              to={line.to}
              blocked={line.blocked}
            />
          ))}

          {/* Floating damage numbers */}
          {floatingTexts.map((ft) => (
            <FloatingNumber
              key={ft.id}
              text={ft.text}
              x={ft.x}
              y={ft.y}
              color={ft.color}
            />
          ))}
        </svg>

        {/* Particle effects overlay */}
        <ParticleEffects
          effects={particleEffects}
          onEffectComplete={removeEffect}
        />
      </div>

      {/* Mobile agent list (compact fallback below hex view) */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:mt-4 sm:grid-cols-3 sm:gap-2 lg:hidden">
        {agents.map((agent) => {
          const cfg = CLASS_CONFIG[agent.class];
          const isDead = !agent.alive;
          const mobileIsDying = isDead && dyingAgents.has(agent.id);
          const mobileIsGhost = isDead && !mobileIsDying;
          const hpPct = Math.max(0, (agent.hp / agent.maxHp) * 100);
          let hpColor = "bg-green-500";
          if (hpPct <= 30) hpColor = "bg-blood";
          else if (hpPct <= 60) hpColor = "bg-gold";

          return (
            <div
              key={agent.id}
              className={`min-h-[44px] rounded border p-2 text-center text-xs transition-all duration-1000 sm:p-3 ${
                mobileIsGhost
                  ? "pointer-events-none border-gray-800 bg-colosseum-surface/50 opacity-[0.4] grayscale"
                  : mobileIsDying
                    ? "border-blood bg-blood/10 opacity-50"
                    : agent.isWinner
                      ? "border-gold bg-gold/10"
                      : agent.defending
                        ? "border-accent bg-accent/10"
                        : agent.attacking
                          ? "border-blood bg-blood/5"
                          : "border-colosseum-surface-light bg-colosseum-surface"
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <img
                  src={cfg.image}
                  alt={agent.class}
                  className="h-5 w-5 rounded object-cover"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = "none";
                    const fallback = document.createElement("span");
                    fallback.textContent = cfg.emoji;
                    target.parentNode?.insertBefore(fallback, target);
                  }}
                />
                <span
                  className={`font-bold ${
                    mobileIsGhost
                      ? "text-gray-600"
                      : agent.isWinner
                        ? "text-gold"
                        : "text-white"
                  }`}
                >
                  {agent.name}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-colosseum-bg">
                <div
                  className={`h-full rounded-full ${hpColor}`}
                  style={{ width: `${hpPct}%` }}
                />
              </div>
              <div className="mt-0.5 text-[9px] text-gray-600">
                {agent.hp}/{agent.maxHp} HP
                {agent.kills > 0 && (
                  <span className="ml-1 text-blood">{agent.kills}K</span>
                )}
              </div>
              {mobileIsGhost && (
                <div className="mt-0.5 text-[10px] font-bold tracking-wider text-blood [text-shadow:_0_0_8px_rgba(0,0,0,0.9)]">
                  REKT
                </div>
              )}
              {mobileIsDying && (
                <div className="mt-0.5 animate-pulse text-[9px] font-bold tracking-wider text-blood">
                  DYING...
                </div>
              )}
              {agent.isWinner && (
                <div className="mt-0.5 text-[9px] font-bold tracking-wider text-gold">
                  WINNER
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend -- compact on mobile, full on sm+ */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[8px] uppercase tracking-wider text-gray-600 sm:mt-3 sm:gap-x-4 sm:text-[9px]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-blood/60 sm:w-4" />
          Attack
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm border border-accent bg-accent/30 sm:w-4" />
          Defend
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-green-500/50 sm:w-4" />
          Correct
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-blood/50 sm:w-4" />
          Wrong
        </span>
        <span className="flex items-center gap-1 [text-shadow:_0_0_8px_rgba(0,0,0,0.9)]">
          <span className="inline-block h-2 w-3 rounded-sm bg-gray-700 sm:w-4" />
          REKT
        </span>
        {/* Tile level legend -- hidden on smallest screens */}
        <span className="ml-2 hidden items-center gap-1 sm:flex">
          <span className="tile-cornucopia-glow inline-block h-2 w-4 rounded-sm" style={{ background: "#2a1f0a", border: "2px solid #f59e0b", boxShadow: "0 0 4px rgba(245,158,11,0.4)" }} />
          Center
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "#1f1a0d", border: "1px solid #b45309" }} />
          Lv3
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "#141428", border: "1px solid #2a2a50" }} />
          Lv2
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "#0c0c18", border: "1px dashed #1e1e38" }} />
          Lv1
        </span>
        {stormKeySet.size > 0 && (
          <>
            <span className="ml-2 flex items-center gap-1">
              <span className="storm-pulse-hunt inline-block h-2 w-4 rounded-sm" style={{ background: "rgba(220,38,38,0.25)", border: "2px dashed rgba(220,38,38,0.5)" }} />
              Storm
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }} />
              Safe
            </span>
          </>
        )}
      </div>
    </div>
    </ShakeWrapper>
  );
}
