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

/** Item types from the arena system */
type ItemType = "RATION" | "WEAPON" | "SHIELD" | "TRAP" | "ORACLE";

/** An item present on a tile */
interface TileItem {
  id: string;
  type: ItemType;
}

/** Extended hex definition for the 19-tile grid */
interface ArenaHex extends HexCoord {
  label: string;
  tileType: TileType;
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
}

// ---------------------------------------------------------------------------
// Constants -- 19-tile hex grid geometry (flat-top, radius 2)
// ---------------------------------------------------------------------------

/**
 * Flat-top hex size (outer radius = center to vertex).
 * Reduced from 70 to 55 to fit 19 tiles in ~700x600 SVG.
 */
const HEX_SIZE = 55;
const SQRT3 = Math.sqrt(3);
const GRID_RADIUS = 2;

/**
 * Determine tile type by distance from center.
 * Ring 0 + Ring 1 (distance <= 1) = CORNUCOPIA
 * Ring 2 (distance == 2) = EDGE
 */
function classifyTile(q: number, r: number): TileType {
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist <= 1) return "CORNUCOPIA";
  return "EDGE";
}

/** Direction labels for hex tiles based on their position */
function tileLabel(q: number, r: number): string {
  if (q === 0 && r === 0) return "CENTER";
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist === 1) {
    // Inner ring labels
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
  // Outer ring: abbreviated coordinates
  return `${q},${r}`;
}

/**
 * Generate all 19 hex coordinates for radius-2 grid.
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
        });
      }
    }
  }
  return hexes;
}

/** The 19-tile arena in axial coords */
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
 * Deterministic agent-to-hex assignment for 19-tile grid.
 * Spreads 5 agents across the grid: one center, four on ring 1 edges.
 */
function assignDefaultPositions(agentIds: string[]): Map<string, HexCoord> {
  const positions = new Map<string, HexCoord>();
  // Strategic placement: center + 4 ring-1 positions (N, E, S, W)
  const defaultSlots: HexCoord[] = [
    { q: 0, r: 0 },   // CENTER
    { q: 0, r: -1 },  // N (ring 1)
    { q: 1, r: 0 },   // E (ring 1)
    { q: 0, r: 1 },   // S (ring 1)
    { q: -1, r: 0 },  // W (ring 1)
    { q: 1, r: -1 },  // NE (ring 1)
    { q: -1, r: 1 },  // SW (ring 1)
  ];
  for (let i = 0; i < agentIds.length && i < defaultSlots.length; i++) {
    positions.set(agentIds[i], defaultSlots[i]);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const CLASS_HEX_COLORS: Record<AgentClass, { fill: string; stroke: string; glow: string }> = {
  WARRIOR: { fill: "rgba(220,38,38,0.15)", stroke: "#dc2626", glow: "rgba(220,38,38,0.4)" },
  TRADER: { fill: "rgba(59,130,246,0.15)", stroke: "#3b82f6", glow: "rgba(59,130,246,0.4)" },
  SURVIVOR: { fill: "rgba(34,197,94,0.15)", stroke: "#22c55e", glow: "rgba(34,197,94,0.4)" },
  PARASITE: { fill: "rgba(124,58,237,0.15)", stroke: "#7c3aed", glow: "rgba(124,58,237,0.4)" },
  GAMBLER: { fill: "rgba(245,158,11,0.15)", stroke: "#f59e0b", glow: "rgba(245,158,11,0.4)" },
};

const DEAD_COLORS = { fill: "rgba(30,30,40,0.6)", stroke: "#333", glow: "none" };

/** Tile type visual config */
const TILE_COLORS: Record<TileType, { fill: string; stroke: string; strokeWidth: number; dashArray?: string }> = {
  NORMAL: {
    fill: "rgba(26,26,46,0.4)",
    stroke: "rgba(37,37,64,0.6)",
    strokeWidth: 1,
  },
  CORNUCOPIA: {
    fill: "rgba(245,158,11,0.06)",
    stroke: "rgba(245,158,11,0.25)",
    strokeWidth: 1,
  },
  EDGE: {
    fill: "rgba(15,15,25,0.5)",
    stroke: "rgba(37,37,64,0.4)",
    strokeWidth: 1,
    dashArray: "6,3",
  },
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
  const offsetR = 18;
  const ix = cx + offsetR * Math.cos(angle);
  const iy = cy + offsetR * Math.sin(angle);

  return (
    <g>
      {/* Item background circle */}
      <circle cx={ix} cy={iy} r="7" fill="rgba(0,0,0,0.6)" stroke={cfg.color} strokeWidth="1" opacity="0.8" />
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
      fill: "rgba(245,158,11,0.2)",
      stroke: "#fbbf24",
      glow: "rgba(245,158,11,0.6)",
    };
  }

  // Base tile styling from tile type
  const tileCfg = TILE_COLORS[hex.tileType];
  // If occupied, blend agent color with tile
  const baseFill = occupied ? agentColors.fill : tileCfg.fill;
  const baseStroke = occupied ? agentColors.stroke : tileCfg.stroke;
  const baseStrokeWidth = occupied ? 2 : tileCfg.strokeWidth;
  const baseDash = occupied ? undefined : tileCfg.dashArray;

  const vertices = hexVertices(center.x, center.y, HEX_SIZE - 2);
  const innerVertices = hexVertices(center.x, center.y, HEX_SIZE - 6);

  // HP bar dimensions
  const barWidth = HEX_SIZE * 0.9;
  const barHeight = 4;
  const barX = center.x - barWidth / 2;
  const barY = center.y + 18;
  const hpPct = agent ? Math.max(0, agent.hp / agent.maxHp) : 0;

  // HP color
  let hpColor = "#22c55e";
  if (hpPct <= 0.3) hpColor = "#dc2626";
  else if (hpPct <= 0.6) hpColor = "#f59e0b";

  const cfg = agent ? CLASS_CONFIG[agent.class] : null;

  return (
    <g>
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

      {/* Main hex shape — tile-type colored background */}
      <polygon
        points={vertices}
        fill={baseFill}
        stroke={baseStroke}
        strokeWidth={baseStrokeWidth}
        strokeDasharray={baseDash}
        opacity={isGhost ? 0.5 : 1}
      />

      {/* Cornucopia center glow */}
      {hex.tileType === "CORNUCOPIA" && !occupied && (
        <polygon
          points={hexVertices(center.x, center.y, HEX_SIZE - 12)}
          fill="rgba(245,158,11,0.03)"
          stroke="none"
        />
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
          fill={hex.tileType === "CORNUCOPIA" ? "rgba(245,158,11,0.2)" : "rgba(100,100,130,0.2)"}
          fontSize="8"
          fontFamily="monospace"
          letterSpacing="0.1em"
        >
          {hex.label}
        </text>
      )}

      {/* Agent content with class-colored glow */}
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

        const agentContent = (
          <>
            {/* Agent portrait (hex-clipped pixel art with emoji fallback) */}
            {(() => {
              const portraitSize = 30;
              const clipId = `hex-clip-${agent.id}`;
              return (
                <g>
                  <defs>
                    <clipPath id={clipId}>
                      <polygon
                        points={hexVertices(center.x, center.y - 10, portraitSize / 2)}
                      />
                    </clipPath>
                  </defs>
                  <image
                    href={cfg?.image}
                    x={center.x - portraitSize / 2}
                    y={center.y - 10 - portraitSize / 2}
                    width={portraitSize}
                    height={portraitSize}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  {/* Hex border around portrait */}
                  <polygon
                    points={hexVertices(center.x, center.y - 10, portraitSize / 2)}
                    fill="none"
                    stroke={agentColors.stroke}
                    strokeWidth="1"
                    opacity="0.5"
                  />
                </g>
              );
            })()}

            {/* Agent name */}
            <text
              x={center.x}
              y={center.y + 8}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isWinner ? "#fbbf24" : isGhost ? "#555" : "#e0e0e0"}
              fontSize="8"
              fontWeight="bold"
              fontFamily="monospace"
              letterSpacing="0.05em"
            >
              {agent.name.length > 8
                ? agent.name.slice(0, 7) + ".."
                : agent.name}
            </text>

            {/* HP bar background */}
            <rect
              x={barX}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx="2"
              fill="rgba(10,10,15,0.8)"
            />

            {/* HP bar fill */}
            <motion.rect
              x={barX}
              y={barY}
              animate={{ width: barWidth * hpPct }}
              transition={{ type: "spring", visualDuration: 0.5, bounce: 0.25 }}
              height={barHeight}
              rx="2"
              fill={hpColor}
            />

            {/* HP text */}
            <text
              x={center.x}
              y={barY + barHeight + 9}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isGhost ? "#555" : "#888"}
              fontSize="7"
              fontFamily="monospace"
            >
              {agent.hp}/{agent.maxHp}
            </text>

            {/* Kill count */}
            {agent.kills > 0 && (
              <g>
                <text
                  x={center.x + barWidth / 2 - 2}
                  y={center.y - 24}
                  textAnchor="end"
                  fill="#dc2626"
                  fontSize="8"
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
                cy={center.y - 26}
                r="4"
                fill={
                  agent.predictionResult === "correct"
                    ? "rgba(34,197,94,0.8)"
                    : "rgba(220,38,38,0.8)"
                }
              >
                <animate
                  attributeName="r"
                  values="4;6;4"
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
                y={center.y - 25}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="6"
                fontWeight="bold"
              >
                {agent.predictionResult === "correct" ? "\u2713" : "\u2717"}
              </text>
            )}
          </>
        );

        // Dying agent: full multi-step death choreography (~1.5s)
        if (isDying) {
          return (
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
                fontSize="16"
                fontWeight="900"
                fontFamily="monospace"
                letterSpacing="0.2em"
                style={{ transformOrigin: `${center.x}px ${center.y - 2}px` }}
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
                animate={{ opacity: 0.15 }}
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
        }

        // Ghost agent: final resting state — fully faded, grayscale, non-interactive
        if (isGhost) {
          return (
            <g
              opacity={0.15}
              style={{ filter: "grayscale(1)", pointerEvents: "none" }}
            >
              {agentContent}
            </g>
          );
        }

        // Low HP (<25%): pulsing glow via motion.g
        if (isLowHp) {
          return (
            <motion.g
              style={{ filter: glowFilter }}
              animate={{ filter: [glowFilter, glowFilterIntense, glowFilter] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              {agentContent}
            </motion.g>
          );
        }

        // Normal alive agent: static class-colored glow
        return (
          <g
            opacity={1}
            style={{ filter: glowFilter }}
          >
            {agentContent}
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
            fontSize="16"
            fontWeight="900"
            fontFamily="monospace"
            letterSpacing="0.2em"
            opacity="0.85"
            transform={`rotate(-12, ${center.x}, ${center.y})`}
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
          y={center.y - 32}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="16"
        >
          <animate
            attributeName="y"
            values={`${center.y - 32};${center.y - 36};${center.y - 32}`}
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
// Main component
// ---------------------------------------------------------------------------

export default function HexBattleArena({
  agents,
  currentEpoch,
  agentPositions: externalPositions,
  tileItems: externalTileItems,
  sponsorEventCount = 0,
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

  // Compute hex pixel centers for all 19 tiles
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
      return externalPositions;
    }
    return assignDefaultPositions(agents.map((a) => a.id));
  }, [agents, externalPositions]);

  // Track previous positions for movement animation
  const prevPositionsRef = useRef<Map<string, HexCoord>>(new Map());

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
    // Update previous positions ref
    prevPositionsRef.current = new Map(positions);
    return map;
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
      const pad = HEX_SIZE + 50;
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

  // Compute SVG viewBox to fit all 19 hexes with padding
  const viewBox = useMemo(() => {
    const allPoints = ARENA_HEXES.map((h) => axialToPixel(h.q, h.r));
    const pad = HEX_SIZE + 40;
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

  return (
    <ShakeWrapper>
    <div className="relative">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
            The Arena
          </h2>
          <span className="rounded bg-blood/20 px-2 py-0.5 text-xs font-medium text-blood">
            EPOCH {currentEpoch}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="text-white">{aliveCount}</span>/{agents.length}{" "}
          alive
          <span className="ml-2 text-[9px] text-gray-700">19 tiles</span>
        </div>
      </div>

      {/* SVG Arena */}
      <div className="relative mx-auto w-full" style={{ maxWidth: "700px" }}>
        {/* Background ambient glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-48 w-48 rounded-full bg-blood/5 blur-3xl" />
        </div>

        <svg
          viewBox={viewBox}
          className="w-full"
          style={{ minHeight: "420px" }}
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

            {/* Cornucopia center radial glow */}
            <radialGradient id="cornucopia-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(245,158,11,0.06)" />
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
                      hex.tileType === "CORNUCOPIA" && other.tileType === "CORNUCOPIA"
                        ? "rgba(245,158,11,0.1)"
                        : "rgba(37,37,64,0.2)"
                    }
                    strokeWidth="1"
                  />
                );
              });
          })}

          {/* Hex tiles — all 19 */}
          {ARENA_HEXES.map((hex) => {
            const key = `${hex.q},${hex.r}`;
            const center = hexCenters.get(key)!;
            const agent = hexToAgent.get(key);
            const items = externalTileItems?.get(key);

            // Derive death transition states
            const agentIsDead = agent && !agent.alive;
            const agentIsDying = !!agentIsDead && dyingAgents.has(agent!.id);
            const agentIsGhost = !!agentIsDead && !agentIsDying;

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
              />
            );
          })}

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
      <div className="mt-4 grid grid-cols-1 gap-2 min-[375px]:grid-cols-2 sm:grid-cols-3 lg:hidden">
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
              className={`rounded border p-3 text-center text-xs transition-all duration-1000 sm:p-2 ${
                mobileIsGhost
                  ? "pointer-events-none border-gray-800 bg-colosseum-surface/50 opacity-[0.15] grayscale"
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
                <div className="mt-0.5 text-[9px] font-bold tracking-wider text-blood">
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

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[9px] uppercase tracking-wider text-gray-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-blood/40" />
          Attack
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm border border-accent/60 bg-accent/20" />
          Defend
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-green-500/30" />
          Correct
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-blood/30" />
          Wrong
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-gray-700/50" />
          REKT
        </span>
        <span className="ml-2 flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }} />
          Cornucopia
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "rgba(15,15,25,0.5)", border: "1px dashed rgba(37,37,64,0.4)" }} />
          Edge
        </span>
      </div>
    </div>
    </ShakeWrapper>
  );
}
