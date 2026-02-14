"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  AgentPortrait,
  HexBattleArena,
  CLASS_CONFIG,
  MOCK_AGENTS,
  MOCK_FEED,
} from "@/components/battle";
import type { BattleAgent, FeedEntry } from "@/components/battle";
import { useBattleStream } from "@/hooks/useBattleStream";
import type {
  BattleEvent,
  BattlePhase,
  AgentActionEvent,
  PredictionResultEvent,
  CombatResultEvent,
  AgentDeathEvent,
  EpochStartEvent,
  OddsUpdateEvent,
  BattleEndEvent,
  PhaseChangeEvent,
  StormDamageEvent,
  SponsorBoostEvent,
} from "@/lib/websocket";
import type { AgentClass } from "@/types";
import StreamHighlightBanner from "@/components/stream/HighlightBanner";
import StreamAgentBar from "@/components/stream/AgentBar";
import StreamActionFeed from "@/components/stream/ActionFeed";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StreamViewProps {
  battleId: string;
  transparent?: boolean;
  /** Layout mode: "full" | "arena-only" | "overlay" */
  layout?: string;
  showFeed?: boolean;
  showStats?: boolean;
  showHighlights?: boolean;
}

// ---------------------------------------------------------------------------
// Agent metadata helpers (shared with BattleView)
// ---------------------------------------------------------------------------

interface AgentMeta {
  name: string;
  class: AgentClass;
}

function buildAgentMeta(events: BattleEvent[]): Map<string, AgentMeta> {
  const meta = new Map<string, AgentMeta>();
  for (const event of events) {
    if (event.type === "agent_action") {
      const e = event as AgentActionEvent;
      meta.set(e.data.agentId, {
        name: e.data.agentName,
        class: (meta.get(e.data.agentId)?.class ?? "WARRIOR") as AgentClass,
      });
    }
    if (event.type === "agent_death") {
      const e = event as AgentDeathEvent;
      const existing = meta.get(e.data.agentId);
      if (existing) {
        existing.name = e.data.agentName;
      } else {
        meta.set(e.data.agentId, {
          name: e.data.agentName,
          class: "WARRIOR" as AgentClass,
        });
      }
    }
  }
  return meta;
}

function eventToFeedEntries(
  event: BattleEvent,
  index: number,
  agentMeta: Map<string, AgentMeta>,
  latestEpoch: number,
): FeedEntry[] {
  const ts = Date.now();

  switch (event.type) {
    case "epoch_start": {
      const e = event as EpochStartEvent;
      const entries: FeedEntry[] = [];
      if (e.data.epochNumber === 1) {
        entries.push({
          id: `ws-${index}-battle-start`,
          timestamp: ts,
          epoch: 1,
          type: "BATTLE_START",
          message: "BATTLE BEGINS — May the nads be ever in your favor.",
        });
      }
      entries.push({
        id: `ws-${index}`,
        timestamp: ts,
        epoch: e.data.epochNumber,
        type: "MARKET",
        message: `Epoch ${e.data.epochNumber} begins. Market prices updated.`,
      });
      return entries;
    }

    case "agent_action": {
      const e = event as AgentActionEvent;
      const entries: FeedEntry[] = [];
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentName;
      const agentClass = meta?.class;

      entries.push({
        id: `ws-${index}-pred`,
        timestamp: ts,
        epoch: latestEpoch,
        type: "PREDICTION",
        agentId: e.data.agentId,
        agentName,
        agentClass,
        message: `${agentName} predicts ${e.data.prediction.asset} ${e.data.prediction.direction} -- stakes ${e.data.prediction.stake}% HP.`,
      });

      if (e.data.attack) {
        const targetMeta = agentMeta.get(e.data.attack.target);
        const targetName = targetMeta?.name ?? e.data.attack.target;
        entries.push({
          id: `ws-${index}-atk`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "ATTACK",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} targets ${targetName} for attack!`,
        });
      }

      if (e.data.defend) {
        entries.push({
          id: `ws-${index}-def`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "DEFEND",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} raises defenses (-5% HP).`,
        });
      }

      return entries;
    }

    case "prediction_result": {
      const e = event as PredictionResultEvent;
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentId;
      const agentClass = meta?.class;
      const result = e.data.correct ? "CORRECT" : "WRONG";
      const hpStr =
        e.data.hpChange >= 0
          ? `+${e.data.hpChange} HP`
          : `${e.data.hpChange} HP`;
      const hpAfterStr = e.data.hpAfter != null ? `${Math.round(e.data.hpAfter)}` : "?";
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "PREDICTION",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} prediction ${result}! (${hpStr}, now ${hpAfterStr} HP)`,
        },
      ];
    }

    case "combat_result": {
      const e = event as CombatResultEvent;
      // Defensive: handle both new shape (defenderId) and legacy raw CombatResult (targetId)
      const rawData = e.data as Record<string, unknown>;
      const defenderId = e.data.defenderId ?? (rawData.targetId as string | undefined);
      const damage = e.data.damage ?? Math.abs(((rawData.hpChangeTarget as number) || 0));
      const blocked = e.data.blocked ?? (rawData.defended as boolean | undefined) ?? false;

      if (!defenderId) {
        // Skip combat events with no valid target
        return [];
      }

      const atkMeta = agentMeta.get(e.data.attackerId);
      const defMeta = agentMeta.get(defenderId);
      const attackerName = atkMeta?.name ?? e.data.attackerId;
      const defenderName = defMeta?.name ?? defenderId;
      const atkClass = atkMeta?.class;

      if (blocked) {
        return [
          {
            id: `ws-${index}`,
            timestamp: ts,
            epoch: latestEpoch,
            type: "ATTACK",
            agentId: e.data.attackerId,
            agentName: attackerName,
            agentClass: atkClass,
            message: `${attackerName} attacks ${defenderName} -- BLOCKED!`,
          },
        ];
      }

      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "ATTACK",
          agentId: e.data.attackerId,
          agentName: attackerName,
          agentClass: atkClass,
          message: `${attackerName} attacks ${defenderName} for ${damage} damage!`,
        },
      ];
    }

    case "agent_death": {
      const e = event as AgentDeathEvent;
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentName;
      const agentClass = meta?.class;
      const killerInfo = e.data.killedBy
        ? `Eliminated by ${agentMeta.get(e.data.killedBy)?.name ?? e.data.killedBy}.`
        : `Cause: ${e.data.cause}.`;
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: e.data.epochNumber,
          type: "DEATH",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} has been REKT! ${killerInfo}`,
        },
      ];
    }

    case "odds_update": {
      const e = event as OddsUpdateEvent;
      const agentNames = Object.keys(e.data.odds)
        .map((id) => agentMeta.get(id)?.name ?? id)
        .join(", ");
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "MARKET",
          message: `Odds updated for ${agentNames}.`,
        },
      ];
    }

    case "phase_change": {
      const e = event as PhaseChangeEvent;
      const phaseLabels: Record<string, string> = {
        LOOT: "LOOT PHASE",
        HUNT: "HUNT PHASE",
        BLOOD: "BLOOD PHASE",
        FINAL_STAND: "FINAL STAND",
      };
      const phaseDescriptions: Record<string, string> = {
        LOOT: "Race for cornucopia loot. No combat.",
        HUNT: "Combat enabled. Outer ring is now dangerous!",
        BLOOD: "Storm tightens. Forced fights!",
        FINAL_STAND: "Only center safe. Kill or die!",
      };
      const stormWarnings: Record<string, string> = {
        HUNT: "Storm closing -- Lv1 tiles become dangerous!",
        BLOOD: "Storm closing -- Lv2 tiles become dangerous next epoch!",
        FINAL_STAND: "Storm closing -- Only center tile is safe!",
      };
      const phaseEntries: FeedEntry[] = [
        {
          id: `ws-${index}-phase`,
          timestamp: ts,
          epoch: e.data.epochNumber,
          type: "PHASE_CHANGE",
          message: `${phaseLabels[e.data.phase] ?? e.data.phase} BEGINS -- ${phaseDescriptions[e.data.phase] ?? ""} (${e.data.epochsRemaining} epochs remaining)`,
        },
      ];
      const warning = stormWarnings[e.data.phase];
      if (warning) {
        phaseEntries.push({
          id: `ws-${index}-storm-warn`,
          timestamp: ts,
          epoch: e.data.epochNumber,
          type: "STORM",
          message: warning,
        });
      }
      return phaseEntries;
    }

    case "storm_damage": {
      const e = event as StormDamageEvent;
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentName;
      const agentClass = meta?.class;
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "STORM",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} takes ${Math.round(e.data.damage)} storm damage on (${e.data.tile.q},${e.data.tile.r})! (${Math.round(e.data.hpAfter)} HP remaining)`,
        },
      ];
    }

    case "battle_end": {
      const e = event as BattleEndEvent;
      const reason = e.data.reason ?? "Last nad standing";
      const isMutualRekt = reason.toLowerCase().includes("mutual rekt");
      const message = isMutualRekt
        ? `ALL REKT -- ${e.data.winnerName} wins! ${reason}`
        : `${e.data.winnerName} WINS after ${e.data.totalEpochs} epochs! ${reason}`;
      return [
        {
          id: `ws-${index}-battle-end`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "BATTLE_END",
          message,
        },
        {
          id: `ws-${index}-battle-over`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "BATTLE_END",
          message: "BATTLE OVER",
        },
      ];
    }

    case "sponsor_boost": {
      const e = event as SponsorBoostEvent;
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentId;
      const agentClass = meta?.class;
      const tierLabels: Record<string, string> = {
        BREAD_RATION: "Bread Ration",
        MEDICINE_KIT: "Medicine Kit",
        ARMOR_PLATING: "Armor Plating",
        WEAPON_CACHE: "Weapon Cache",
        CORNUCOPIA: "Cornucopia",
      };
      const tierLabel = tierLabels[e.data.tier] ?? e.data.tier;
      const effects: string[] = [];
      if (e.data.actualBoost > 0) effects.push(`+${Math.round(e.data.actualBoost)} HP`);
      if (e.data.freeDefend) effects.push("free defend");
      if (e.data.attackBoost > 0) effects.push(`+${Math.round(e.data.attackBoost * 100)}% attack`);
      const effectStr = effects.length > 0 ? ` (${effects.join(", ")})` : "";
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "SPONSOR",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} received ${tierLabel} from the crowd!${effectStr}`,
        },
      ];
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Highlight detection
// ---------------------------------------------------------------------------

export interface HighlightEvent {
  id: string;
  type: "DEATH" | "VICTORY" | "COMBAT" | "CLUTCH";
  title: string;
  subtitle: string;
  timestamp: number;
  agentClass?: AgentClass;
}

function detectHighlights(
  feed: FeedEntry[],
  agents: BattleAgent[],
  winner: BattleEndEvent["data"] | null,
): HighlightEvent[] {
  const highlights: HighlightEvent[] = [];

  // Death events
  const deathEntries = feed.filter((f) => f.type === "DEATH");
  for (const entry of deathEntries) {
    highlights.push({
      id: `hl-death-${entry.id}`,
      type: "DEATH",
      title: `${entry.agentName ?? "Agent"} REKT`,
      subtitle: entry.message,
      timestamp: entry.timestamp,
      agentClass: entry.agentClass,
    });
  }

  // Winner
  if (winner) {
    const isMutualRekt = winner.reason?.toLowerCase().includes("mutual rekt");
    highlights.push({
      id: "hl-victory",
      type: "VICTORY",
      title: isMutualRekt
        ? `ALL REKT -- ${winner.winnerName} WINS`
        : `${winner.winnerName} WINS`,
      subtitle: winner.reason ?? `Last nad standing after ${winner.totalEpochs} epochs!`,
      timestamp: Date.now(),
    });
  }

  // Clutch moments: agent at <= 15% HP survives an attack
  for (const agent of agents) {
    if (agent.alive && agent.hp > 0 && agent.hp / agent.maxHp <= 0.15) {
      if (agent.attacked || agent.defending) {
        highlights.push({
          id: `hl-clutch-${agent.id}-${Date.now()}`,
          type: "CLUTCH",
          title: `${agent.name} CLUTCH SURVIVAL`,
          subtitle: `${agent.hp}/${agent.maxHp} HP -- hanging on by a thread!`,
          timestamp: Date.now(),
          agentClass: agent.class,
        });
      }
    }
  }

  return highlights;
}

// ---------------------------------------------------------------------------
// Phase color config (mirrored from BattleView)
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<BattlePhase, { color: string; label: string }> = {
  LOOT: { color: "#22c55e", label: "LOOT" },
  HUNT: { color: "#f59e0b", label: "HUNT" },
  BLOOD: { color: "#dc2626", label: "BLOOD" },
  FINAL_STAND: { color: "#a855f7", label: "FINAL STAND" },
};

// ---------------------------------------------------------------------------
// Unified Stream Top Bar (mirrors BattleView's BattleTopBar for streaming)
// ---------------------------------------------------------------------------

function StreamTopBar({
  battleId,
  currentEpoch,
  currentPhase,
  epochsRemaining,
  aliveCount,
  totalAgents,
  agents,
  winner,
  connected,
  isComplete,
}: {
  battleId: string;
  currentEpoch: number;
  currentPhase: BattlePhase | null;
  epochsRemaining: number;
  aliveCount: number;
  totalAgents: number;
  agents: BattleAgent[];
  winner: { winnerId: string; winnerName: string; totalEpochs: number; reason?: string } | null;
  connected: boolean;
  isComplete: boolean;
}) {
  const phaseConfig = currentPhase ? PHASE_COLORS[currentPhase] : null;

  return (
    <div
      className="flex items-center justify-between border-b px-4 py-2 sm:px-6"
      style={{
        backgroundColor: "#0d0d1aCC",
        borderColor: phaseConfig ? `${phaseConfig.color}30` : "#252540",
        backdropFilter: "blur(8px)",
        minHeight: "48px",
        maxHeight: "56px",
      }}
    >
      {/* Left cluster: branding + status + phase + epoch */}
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="font-cinzel text-sm font-black tracking-widest text-gold sm:text-base">
          HUNGERNADS
        </span>

        <span className="h-4 w-px bg-gray-800" />

        {/* Live / GG indicator */}
        {isComplete ? (
          <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold">
            GG
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blood" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-blood">
              LIVE
            </span>
          </span>
        )}

        <span className="hidden text-[10px] text-gray-600 sm:inline">#{battleId}</span>

        <span className="hidden h-4 w-px bg-gray-800 sm:inline-block" />

        {/* Epoch number */}
        <span className="font-mono text-sm font-bold tabular-nums text-white sm:text-base">
          EPOCH {currentEpoch}
          {winner?.totalEpochs ? <span className="text-gray-600">/{winner.totalEpochs}</span> : ""}
        </span>

        {/* Phase badge */}
        {phaseConfig && !isComplete && (
          <>
            <span className="hidden h-4 w-px bg-gray-800 sm:inline-block" />
            <span
              className="hidden rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider sm:inline-block"
              style={{
                backgroundColor: `${phaseConfig.color}15`,
                color: phaseConfig.color,
                border: `1px solid ${phaseConfig.color}30`,
              }}
            >
              {phaseConfig.label}
            </span>
            {epochsRemaining > 0 && (
              <span className="hidden text-[10px] text-gray-600 sm:inline">
                {epochsRemaining} ep left
              </span>
            )}
          </>
        )}

        {/* Connection indicator */}
        {connected ? (
          <span className="hidden items-center gap-1 text-[9px] text-green-600 sm:flex">
            <span className="h-1 w-1 rounded-full bg-green-600" />
            WS
          </span>
        ) : (
          <span className="hidden items-center gap-1 text-[9px] text-gray-700 sm:flex">
            <span className="h-1 w-1 rounded-full bg-gray-700" />
            OFF
          </span>
        )}
      </div>

      {/* Center cluster: agent portrait thumbnails with HP rings */}
      <div className="hidden items-center gap-1 md:flex">
        {agents.map((agent) => {
          const config = CLASS_CONFIG[agent.class];
          const hpPct = agent.maxHp > 0 ? agent.hp / agent.maxHp : 0;
          const radius = 12;
          const circumference = 2 * Math.PI * radius;
          const strokeDash = hpPct * circumference;

          const hpColor =
            !agent.alive
              ? "#4a0000"
              : hpPct > 0.5
                ? "#22c55e"
                : hpPct > 0.25
                  ? "#f59e0b"
                  : "#dc2626";

          return (
            <div
              key={agent.id}
              className="relative"
              title={`${agent.name} (${agent.class}) - ${Math.round(agent.hp)} HP`}
            >
              <svg width="30" height="30" viewBox="0 0 30 30" className="flex-shrink-0">
                <circle cx="15" cy="15" r={radius} fill="none" stroke="#1a1a2e" strokeWidth="2" />
                <circle
                  cx="15"
                  cy="15"
                  r={radius}
                  fill="none"
                  stroke={hpColor}
                  strokeWidth="2"
                  strokeDasharray={`${strokeDash} ${circumference}`}
                  strokeLinecap="round"
                  transform="rotate(-90 15 15)"
                  style={{
                    transition: "stroke-dasharray 0.5s ease",
                    filter: agent.isWinner ? "drop-shadow(0 0 3px #f59e0b)" : undefined,
                  }}
                />
                <clipPath id={`stream-topbar-clip-${agent.id}`}>
                  <circle cx="15" cy="15" r="10" />
                </clipPath>
                <foreignObject
                  x="5"
                  y="5"
                  width="20"
                  height="20"
                  clipPath={`url(#stream-topbar-clip-${agent.id})`}
                >
                  <img
                    src={config.image}
                    alt={agent.name}
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "cover",
                      opacity: agent.alive ? 1 : 0.3,
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </foreignObject>
                {!agent.alive && (
                  <text
                    x="15"
                    y="17"
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill="#dc2626"
                    opacity="0.7"
                  >
                    X
                  </text>
                )}
              </svg>
            </div>
          );
        })}
        <span className="ml-1 text-[10px] text-gray-600">
          <span className="text-white">{aliveCount}</span>/{totalAgents}
        </span>
      </div>

      {/* Right cluster: alive count (mobile) */}
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="text-[10px] text-gray-600 md:hidden">
          <span className="text-white">{aliveCount}</span>/{totalAgents} alive
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV === "development";

export default function StreamView({
  battleId,
  transparent = false,
  layout = "full",
  showFeed = true,
  showStats = true,
  showHighlights = true,
}: StreamViewProps) {
  const { connected, events, agentStates, latestEpoch, winner, phaseState } =
    useBattleStream(battleId);

  // Build agent metadata from events
  const agentMeta = useMemo(() => {
    const meta = buildAgentMeta(events);
    for (const state of agentStates) {
      const existing = meta.get(state.id);
      if (existing) {
        existing.class = state.class as AgentClass;
        existing.name = state.name;
      } else {
        meta.set(state.id, {
          name: state.name,
          class: state.class as AgentClass,
        });
      }
    }
    return meta;
  }, [events, agentStates]);

  // Transform events to feed entries
  const feed: FeedEntry[] = useMemo(() => {
    if (!connected && events.length === 0 && isDev) return MOCK_FEED;
    return events.flatMap((event, i) =>
      eventToFeedEntries(event, i, agentMeta, latestEpoch),
    );
  }, [connected, events, agentMeta, latestEpoch]);

  // Transform agent states to BattleAgent[]
  const agents: BattleAgent[] = useMemo(() => {
    if (agentStates.length === 0 && isDev) return MOCK_AGENTS;
    if (agentStates.length === 0) return [];

    const recentEvents = events.slice(-20);
    const killCounts = new Map<string, number>();
    for (const event of events) {
      if (event.type === "agent_death") {
        const e = event as AgentDeathEvent;
        if (e.data.killedBy) {
          killCounts.set(
            e.data.killedBy,
            (killCounts.get(e.data.killedBy) ?? 0) + 1,
          );
        }
      }
    }

    const latestActions = new Map<string, AgentActionEvent["data"]>();
    const latestPredResults = new Map<
      string,
      PredictionResultEvent["data"]
    >();
    const latestCombat = new Map<
      string,
      { attacking: boolean; attacked: boolean }
    >();

    for (const event of recentEvents) {
      if (event.type === "agent_action") {
        const e = event as AgentActionEvent;
        latestActions.set(e.data.agentId, e.data);
      }
      if (event.type === "prediction_result") {
        const e = event as PredictionResultEvent;
        latestPredResults.set(e.data.agentId, e.data);
      }
      if (event.type === "combat_result") {
        const e = event as CombatResultEvent;
        const rawData = e.data as Record<string, unknown>;
        const defId = e.data.defenderId ?? (rawData.targetId as string | undefined);
        const wasBlocked = e.data.blocked ?? (rawData.defended as boolean | undefined) ?? false;

        latestCombat.set(e.data.attackerId, {
          attacking: true,
          attacked: false,
        });
        if (defId) {
          latestCombat.set(defId, {
            attacking: false,
            attacked: !wasBlocked,
          });
        }
      }
    }

    return agentStates.map((state) => {
      const action = latestActions.get(state.id);
      const predResult = latestPredResults.get(state.id);
      const combat = latestCombat.get(state.id);

      let lastAction: string | undefined;
      if (action) {
        if (action.defend) {
          lastAction = "Raised defenses";
        } else if (action.attack) {
          const targetName =
            agentMeta.get(action.attack.target)?.name ??
            action.attack.target;
          lastAction = `Attacked ${targetName}`;
        } else {
          lastAction = `Predicted ${action.prediction.asset} ${action.prediction.direction}`;
        }
      }

      return {
        id: state.id,
        name: state.name,
        class: state.class as AgentClass,
        hp: state.hp,
        maxHp: 1000,
        alive: state.isAlive,
        kills: killCounts.get(state.id) ?? 0,
        defending: action?.defend ?? false,
        lastAction,
        attacking: combat?.attacking,
        attacked: combat?.attacked,
        predictionResult: predResult
          ? predResult.correct
            ? "correct"
            : "wrong"
          : undefined,
        isWinner: winner?.winnerId === state.id,
      } satisfies BattleAgent;
    });
  }, [agentStates, events, agentMeta, winner]);

  const currentEpoch = latestEpoch || (isDev ? 3 : 0);
  const aliveCount = agents.filter((a) => a.alive).length;

  // Highlight detection
  const [activeHighlight, setActiveHighlight] =
    useState<HighlightEvent | null>(null);
  const highlightQueueRef = useRef<HighlightEvent[]>([]);
  const processedHighlightIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!showHighlights) return;

    const allHighlights = detectHighlights(feed, agents, winner);
    const newHighlights = allHighlights.filter(
      (h) => !processedHighlightIdsRef.current.has(h.id),
    );

    if (newHighlights.length > 0) {
      for (const h of newHighlights) {
        processedHighlightIdsRef.current.add(h.id);
        highlightQueueRef.current.push(h);
      }
    }
  }, [feed, agents, winner, showHighlights]);

  // Process highlight queue one at a time
  useEffect(() => {
    if (activeHighlight) return;
    if (highlightQueueRef.current.length === 0) return;

    const next = highlightQueueRef.current.shift()!;
    setActiveHighlight(next);

    const timer = setTimeout(() => {
      setActiveHighlight(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [activeHighlight, feed]);

  // Background class
  const bgClass = transparent
    ? "bg-transparent"
    : "bg-colosseum-bg";

  // Layout: arena-only shows just the hex arena
  if (layout === "arena-only") {
    return (
      <div className={`relative h-screen w-screen overflow-hidden ${bgClass}`}>
        <div className="flex h-full w-full items-center justify-center p-4">
          <div className="w-full max-w-[900px]">
            <HexBattleArena
              agents={agents}
              currentEpoch={currentEpoch}
              sponsorEventCount={0}
            />
          </div>
        </div>

        {/* Highlight banner */}
        {showHighlights && activeHighlight && (
          <StreamHighlightBanner highlight={activeHighlight} />
        )}
      </div>
    );
  }

  // Layout: overlay -- bottom bar only (agent stats + feed ticker)
  if (layout === "overlay") {
    const overlayPhaseConfig = phaseState?.phase ? PHASE_COLORS[phaseState.phase] : null;
    return (
      <div className={`relative h-screen w-screen overflow-hidden ${bgClass}`}>
        {/* Top: branding + status + phase */}
        <div className="absolute left-4 top-4 z-20 flex items-center gap-3">
          <div className="rounded-lg border border-gold/30 bg-colosseum-bg/80 px-3 py-1.5 backdrop-blur-sm">
            <span className="font-cinzel text-sm font-black tracking-widest text-gold">
              HUNGERNADS
            </span>
          </div>
          <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg/80 px-3 py-1.5 backdrop-blur-sm">
            <span className="text-xs text-gray-400">
              Battle #{battleId}
            </span>
            <span className="mx-2 text-gray-700">|</span>
            <span className="text-xs text-gray-400">
              Epoch{" "}
              <span className="font-bold text-white">{currentEpoch}</span>
              {winner?.totalEpochs ? <span className="text-gray-600">/{winner.totalEpochs}</span> : ""}
            </span>
            <span className="mx-2 text-gray-700">|</span>
            <span className="text-xs text-gray-400">
              <span className="text-white">{aliveCount}</span>/{agents.length} alive
            </span>
            {overlayPhaseConfig && !winner && (
              <>
                <span className="mx-2 text-gray-700">|</span>
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: `${overlayPhaseConfig.color}15`,
                    color: overlayPhaseConfig.color,
                    border: `1px solid ${overlayPhaseConfig.color}30`,
                  }}
                >
                  {overlayPhaseConfig.label}
                </span>
              </>
            )}
          </div>
          {winner ? (
            <span className="rounded-lg border border-gold/40 bg-gold/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gold backdrop-blur-sm">
              GG
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-lg border border-blood/40 bg-blood/20 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blood" />
              <span className="text-xs font-bold uppercase tracking-wider text-blood">
                LIVE
              </span>
            </span>
          )}
        </div>

        {/* Bottom: agent bar */}
        {showStats && (
          <div className="absolute bottom-0 left-0 right-0 z-20">
            <StreamAgentBar agents={agents} />
          </div>
        )}

        {/* Right side: action feed */}
        {showFeed && (
          <div className="absolute bottom-20 right-4 top-16 z-20 w-80">
            <StreamActionFeed entries={feed.slice(-15)} />
          </div>
        )}

        {/* Highlight banner */}
        {showHighlights && activeHighlight && (
          <StreamHighlightBanner highlight={activeHighlight} />
        )}
      </div>
    );
  }

  // Layout: full (default) -- unified top bar + 2fr/1fr grid (arena + feed) + agent bar
  return (
    <div className={`relative h-screen w-screen overflow-hidden ${bgClass} flex flex-col`}>
      {/* Unified top bar: phase + epoch + agent portraits (mirrors BattleView's BattleTopBar) */}
      <div className="z-20 flex-shrink-0">
        <StreamTopBar
          battleId={battleId}
          currentEpoch={currentEpoch}
          currentPhase={phaseState?.phase ?? null}
          epochsRemaining={phaseState?.epochsRemaining ?? 0}
          aliveCount={aliveCount}
          totalAgents={agents.length || 5}
          agents={agents}
          winner={winner}
          connected={connected}
          isComplete={!!winner}
        />
      </div>

      {/* Main content: 2fr/1fr grid layout (arena left, feed right) */}
      <div
        className="flex-1 grid grid-cols-1 overflow-hidden md:grid-cols-[2fr_1fr]"
        style={{ minHeight: 0 }}
      >
        {/* Left: Arena */}
        <div className="flex items-center justify-center p-4">
          <div className="w-full max-w-[800px]">
            <HexBattleArena
              agents={agents}
              currentEpoch={currentEpoch}
              sponsorEventCount={0}
            />
          </div>
        </div>

        {/* Right: Action feed sidebar */}
        {showFeed && (
          <div className="flex flex-col border-l border-colosseum-surface-light/30 bg-colosseum-bg/60 backdrop-blur-sm">
            <div className="flex-1 overflow-hidden p-3">
              <StreamActionFeed entries={feed.slice(-30)} />
            </div>
          </div>
        )}
      </div>

      {/* Bottom: agent status bar */}
      {showStats && (
        <div className="z-20 flex-shrink-0">
          <StreamAgentBar agents={agents} />
        </div>
      )}

      {/* Winner announcement overlay */}
      {winner && (() => {
        const victoryAgent = agents.find((a) => a.id === winner.winnerId);
        const victoryCfg = victoryAgent
          ? CLASS_CONFIG[victoryAgent.class as AgentClass] ?? CLASS_CONFIG.WARRIOR
          : CLASS_CONFIG.WARRIOR;
        const isMutualRekt = winner.reason?.toLowerCase().includes("mutual rekt");
        return (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="pointer-events-auto rounded-xl border-2 border-gold/60 bg-colosseum-bg/90 px-12 py-8 text-center shadow-2xl shadow-gold/20 backdrop-blur-md">
              <div className="font-cinzel text-4xl font-black tracking-[0.2em] text-gold animate-winner-glow">
                {isMutualRekt ? "ALL REKT" : "VICTORY"}
              </div>
              <div className="mt-4 flex items-center justify-center gap-4">
                <AgentPortrait
                  image={victoryCfg.image}
                  emoji={victoryCfg.emoji}
                  alt={winner.winnerName}
                  size="w-20 h-20"
                  className="text-5xl ring-2 ring-gold/40"
                />
              </div>
              <div className="mt-3 text-xl font-bold text-white">
                {winner.winnerName}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                {isMutualRekt
                  ? `Wins by tiebreak after ${winner.totalEpochs} epochs`
                  : `Last nad standing after ${winner.totalEpochs} epochs`}
              </div>
              {winner.reason && (
                <div className="mt-1.5 text-xs text-gold/70">
                  {winner.reason}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Highlight banner */}
      {showHighlights && activeHighlight && (
        <StreamHighlightBanner highlight={activeHighlight} />
      )}
    </div>
  );
}
