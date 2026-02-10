"use client";

import { useMemo, useCallback, useState } from "react";
import { CLASS_CONFIG, type BattleAgent } from "./mock-data";
import type { AgentClass } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HexCoord {
  q: number;
  r: number;
}

export interface AgentPosition {
  agentId: string;
  hex: HexCoord;
}

export interface HexGridViewerProps {
  agents: BattleAgent[];
  /**
   * Map of agentId -> hex coordinate. When omitted, agents are auto-placed
   * around the grid in a deterministic pattern (outer ring first, then center).
   */
  positions?: AgentPosition[];
  /** Currently selected agent ID */
  selectedAgentId?: string;
  /** Callback when an agent hex is clicked */
  onSelectAgent?: (agentId: string) => void;
  /** Compact mode reduces padding and hides labels. Default: false. */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// 37-tile hex grid (mirrored from src/arena/hex-grid.ts)
// ---------------------------------------------------------------------------

type TileType = "NORMAL" | "CORNUCOPIA" | "EDGE";
type TileLevel = 1 | 2 | 3 | 4;

interface ArenaHex extends HexCoord {
  label: string;
  tileType: TileType;
  tileLevel: TileLevel;
}

const GRID_RADIUS = 3;

function classifyTile(q: number, r: number): TileType {
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist <= 1) return "CORNUCOPIA";
  if (dist >= 3) return "EDGE";
  return "NORMAL";
}

function getTileLevel(q: number, r: number): TileLevel {
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist === 0) return 4;
  if (dist === 1) return 3;
  if (dist === 2) return 2;
  return 1;
}

function tileLabel(q: number, r: number): string {
  if (q === 0 && r === 0) return "C";
  const s = -q - r;
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (dist === 1) {
    const labels: Record<string, string> = {
      "0,-1": "N", "1,-1": "NE", "1,0": "E",
      "0,1": "S", "-1,1": "SW", "-1,0": "W",
    };
    return labels[`${q},${r}`] || "";
  }
  return "";
}

function generateArenaHexes(): ArenaHex[] {
  const hexes: ArenaHex[] = [];
  for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
    for (let r = -GRID_RADIUS; r <= GRID_RADIUS; r++) {
      const s = -q - r;
      if (Math.abs(s) <= GRID_RADIUS) {
        hexes.push({ q, r, label: tileLabel(q, r), tileType: classifyTile(q, r), tileLevel: getTileLevel(q, r) });
      }
    }
  }
  return hexes;
}

const ARENA_HEXES = generateArenaHexes();

// Default placement order: spread across rings
const DEFAULT_PLACEMENT_ORDER: HexCoord[] = [
  { q: 2, r: -1 },  // Ring 2
  { q: -2, r: 1 },  // Ring 2
  { q: 0, r: -2 },  // Ring 2
  { q: 0, r: 2 },   // Ring 2
  { q: 1, r: 1 },   // Ring 2
  { q: -1, r: -1 }, // Ring 2
  { q: 0, r: 0 },   // CENTER
];

// ---------------------------------------------------------------------------
// Geometry helpers -- flat-top hexagons
// ---------------------------------------------------------------------------

const HEX_SIZE = 20; // Radius of each hex (corner-to-center) -- smaller for 37-tile minimap
const SQRT3 = Math.sqrt(3);

/** Convert axial (q, r) to pixel (x, y) for flat-top hexagons. */
function axialToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_SIZE * (3 / 2) * q;
  const y = HEX_SIZE * ((SQRT3 / 2) * q + SQRT3 * r);
  return { x, y };
}

/** Generate the 6-vertex polygon points string for a flat-top hex. */
function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i;
    const angleRad = (Math.PI / 180) * angleDeg;
    pts.push(
      `${cx + size * Math.cos(angleRad)},${cy + size * Math.sin(angleRad)}`,
    );
  }
  return pts.join(" ");
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function classHexFill(agentClass: AgentClass): string {
  const fills: Record<AgentClass, string> = {
    WARRIOR: "#1a0808",
    TRADER: "#08101a",
    SURVIVOR: "#081a0d",
    PARASITE: "#120a1f",
    GAMBLER: "#1a150a",
  };
  return fills[agentClass];
}

function classDotFill(agentClass: AgentClass): string {
  const fills: Record<AgentClass, string> = {
    WARRIOR: "#dc2626",
    TRADER: "#60a5fa",
    SURVIVOR: "#4ade80",
    PARASITE: "#a78bfa",
    GAMBLER: "#f59e0b",
  };
  return fills[agentClass];
}

function hpColor(hp: number, maxHp: number): string {
  const pct = (hp / maxHp) * 100;
  if (pct <= 0) return "#374151";
  if (pct <= 30) return "#dc2626";
  if (pct <= 60) return "#f59e0b";
  return "#22c55e";
}

const TILE_LEVEL_FILLS: Record<TileLevel, string> = {
  4: "#2a1f0a",
  3: "#1f1a0d",
  2: "#141428",
  1: "#0c0c18",
};

const TILE_LEVEL_STROKES: Record<TileLevel, { color: string; dash?: string; width?: number }> = {
  4: { color: "#f59e0b", width: 1.5 },
  3: { color: "#b45309" },
  2: { color: "#2a2a50" },
  1: { color: "#1e1e38", dash: "3,2" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HexCellProps {
  hex: ArenaHex;
  cx: number;
  cy: number;
  agent?: BattleAgent;
  isSelected: boolean;
  showLabel: boolean;
  onSelect?: (agentId: string) => void;
}

function HexCell({ hex, cx, cy, agent, isSelected, showLabel, onSelect }: HexCellProps) {
  const isEmpty = !agent;
  const isDead = agent && !agent.alive;

  const handleClick = useCallback(() => {
    if (agent && onSelect) {
      onSelect(agent.id);
    }
  }, [agent, onSelect]);

  // Hex polygon fill -- tile level based for empty, class based for occupied
  const tileFill = TILE_LEVEL_FILLS[hex.tileLevel];
  const tileStroke = TILE_LEVEL_STROKES[hex.tileLevel];

  let fill = tileFill;
  let strokeColor = tileStroke.color;
  let strokeWidth = tileStroke.width ?? 1;
  let strokeDash = tileStroke.dash;

  if (agent) {
    fill = classHexFill(agent.class);
    strokeColor = classDotFill(agent.class);
    strokeDash = undefined;
    if (isDead) {
      fill = "#141420";
      strokeColor = "#374151";
    }
  }

  if (isSelected) {
    strokeColor = "#f59e0b";
    strokeWidth = 2;
  }

  const cfg = agent ? CLASS_CONFIG[agent.class] : null;
  const hpPct = agent ? Math.max(0, (agent.hp / agent.maxHp) * 100) : 0;

  return (
    <g
      className={agent ? "cursor-pointer" : ""}
      onClick={handleClick}
      role={agent ? "button" : undefined}
      tabIndex={agent ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
    >
      {/* Hex outline */}
      <polygon
        points={hexPoints(cx, cy, HEX_SIZE - 1)}
        fill={fill}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDash}
        className="transition-all duration-200"
      />

      {/* Selected glow ring */}
      {isSelected && (
        <polygon
          points={hexPoints(cx, cy, HEX_SIZE + 2)}
          fill="none"
          stroke="rgba(245,158,11,0.5)"
          strokeWidth={1.5}
        />
      )}

      {agent && !isDead && (
        <>
          {/* HP ring */}
          <circle
            cx={cx}
            cy={cy}
            r={10}
            fill="none"
            stroke="#374151"
            strokeWidth={2}
          />
          <circle
            cx={cx}
            cy={cy}
            r={10}
            fill="none"
            stroke={hpColor(agent.hp, agent.maxHp)}
            strokeWidth={2}
            strokeDasharray={`${(hpPct / 100) * 2 * Math.PI * 10} ${2 * Math.PI * 10}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            className="transition-all duration-500"
          />

          {/* Agent portrait */}
          {(() => {
            const pSize = 14;
            return (
              <g className="pointer-events-none">
                <foreignObject
                  x={cx - pSize / 2}
                  y={cy - pSize / 2}
                  width={pSize}
                  height={pSize}
                  style={{ overflow: "hidden" }}
                >
                  <MiniPortrait
                    src={cfg?.image}
                    alt={agent.name}
                    emoji={cfg?.emoji}
                    size={pSize}
                  />
                </foreignObject>
              </g>
            );
          })()}

          {/* Agent name */}
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            fontSize={5}
            fontWeight="bold"
            fill="rgba(255,255,255,0.8)"
            letterSpacing="0.5"
            className="pointer-events-none select-none uppercase"
          >
            {agent.name.length > 6 ? agent.name.slice(0, 5) + "." : agent.name}
          </text>
        </>
      )}

      {/* Dead agent */}
      {agent && isDead && (
        <>
          <text
            x={cx}
            y={cy + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            className="pointer-events-none select-none"
            opacity={0.4}
          >
            {"\uD83D\uDC80"}
          </text>
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            fontSize={5}
            fontWeight="bold"
            fill="rgba(255,255,255,0.25)"
            letterSpacing="0.5"
            className="pointer-events-none select-none uppercase"
          >
            {agent.name.length > 6 ? agent.name.slice(0, 5) + "." : agent.name}
          </text>
        </>
      )}

      {/* Empty hex label */}
      {isEmpty && showLabel && hex.label && (
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={5}
          fill={hex.tileLevel >= 3 ? "rgba(245,158,11,0.4)" : "rgba(107,114,128,0.4)"}
          letterSpacing="1"
          className="pointer-events-none select-none uppercase"
        >
          {hex.label}
        </text>
      )}

      {/* Defending indicator */}
      {agent?.defending && !isDead && (
        <circle
          cx={cx}
          cy={cy}
          r={13}
          fill="none"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth={1}
          strokeDasharray="3 2"
          className="animate-spin"
          style={{ animationDuration: "4s" }}
        />
      )}

      {/* Attacking indicator */}
      {agent?.attacking && !isDead && (
        <circle
          cx={cx}
          cy={cy}
          r={13}
          fill="none"
          stroke="rgba(220,38,38,0.5)"
          strokeWidth={1}
          className="animate-ping"
          style={{ animationDuration: "1.5s" }}
        />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Portrait helper — uses React state so fallback survives re-renders
// ---------------------------------------------------------------------------

function MiniPortrait({ src, alt, emoji, size }: {
  src?: string; alt: string; emoji?: string; size: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

export default function HexGridViewer({
  agents,
  positions,
  selectedAgentId,
  onSelectAgent,
  compact = false,
}: HexGridViewerProps) {
  // Build the position map: agentId -> HexCoord
  const positionMap = useMemo(() => {
    const map = new Map<string, HexCoord>();

    if (positions && positions.length > 0) {
      for (const pos of positions) {
        map.set(pos.agentId, pos.hex);
      }
    } else {
      // Auto-place agents around the grid deterministically
      const aliveFirst = [...agents].sort((a, b) => {
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        return 0;
      });
      aliveFirst.forEach((agent, i) => {
        if (i < DEFAULT_PLACEMENT_ORDER.length) {
          map.set(agent.id, DEFAULT_PLACEMENT_ORDER[i]);
        }
      });
    }

    return map;
  }, [agents, positions]);

  // Build hex -> agent lookup
  const hexAgentMap = useMemo(() => {
    const map = new Map<string, BattleAgent>();
    for (const agent of agents) {
      const pos = positionMap.get(agent.id);
      if (pos) {
        map.set(`${pos.q},${pos.r}`, agent);
      }
    }
    return map;
  }, [agents, positionMap]);

  // Compute SVG viewBox
  const { viewBox, centers } = useMemo(() => {
    const c: { hex: ArenaHex; x: number; y: number }[] = ARENA_HEXES.map((hex) => {
      const { x, y } = axialToPixel(hex.q, hex.r);
      return { hex, x, y };
    });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { x, y } of c) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    const pad = HEX_SIZE + 12;
    return {
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`,
      centers: c,
    };
  }, []);

  const aliveCount = agents.filter((a) => a.alive).length;

  return (
    <div className={compact ? "w-full" : "w-full"}>
      {/* Header */}
      {!compact && (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Arena Map
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blood" />
            <span className="text-[9px] uppercase tracking-wider text-gray-600">
              {aliveCount}/{agents.length}
            </span>
          </div>
        </div>
      )}

      {/* SVG hex grid */}
      <svg
        viewBox={viewBox}
        className="mx-auto w-full"
        style={{ maxWidth: compact ? "220px" : "300px" }}
        role="img"
        aria-label={`Arena hex grid with ${agents.length} agents, ${aliveCount} alive`}
      >
        {/* Subtle center glow */}
        <defs>
          <radialGradient id="hex-grid-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(245,158,11,0.12)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <circle
          cx={0}
          cy={0}
          r={HEX_SIZE * 2.5}
          fill="url(#hex-grid-glow)"
        />

        {/* Adjacency lines */}
        {centers.map((a, i) =>
          centers
            .slice(i + 1)
            .filter((b) => {
              const dq = a.hex.q - b.hex.q;
              const dr = a.hex.r - b.hex.r;
              const ds = -(dq + dr);
              return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) === 1;
            })
            .map((b) => (
              <line
                key={`${a.hex.q},${a.hex.r}-${b.hex.q},${b.hex.r}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={
                  a.hex.tileLevel >= 3 && b.hex.tileLevel >= 3
                    ? "rgba(245,158,11,0.2)"
                    : "rgba(37,37,64,0.45)"
                }
                strokeWidth={0.5}
              />
            )),
        )}

        {/* Hex cells */}
        {centers.map(({ hex, x, y }) => {
          const key = `${hex.q},${hex.r}`;
          const agent = hexAgentMap.get(key);
          return (
            <HexCell
              key={key}
              hex={hex}
              cx={x}
              cy={y}
              agent={agent}
              isSelected={agent?.id === selectedAgentId}
              showLabel={!compact}
              onSelect={onSelectAgent}
            />
          );
        })}
      </svg>

      {/* Legend (non-compact only) */}
      {!compact && (
        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
          {(["WARRIOR", "TRADER", "SURVIVOR", "PARASITE", "GAMBLER"] as AgentClass[]).map(
            (cls) => {
              const hasAgent = agents.some((a) => a.class === cls && a.alive);
              if (!hasAgent) return null;
              return (
                <div key={cls} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: classDotFill(cls) }}
                  />
                  <span className="text-[8px] uppercase tracking-wider text-gray-600">
                    {cls}
                  </span>
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}
