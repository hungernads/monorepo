"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import {
  AgentCard,
  AgentPortrait,
  HexBattleArena,
  ActionFeed,
  MarketTicker,
  PrizeClaim,
  CLASS_CONFIG,
  MOCK_AGENTS,
  MOCK_FEED,
  MOCK_AGENT_POSITIONS,
  MOCK_TILE_ITEMS,
} from "@/components/battle";
import type { BattleAgent, FeedEntry } from "@/components/battle";
import type { BattlePhase } from "@/lib/websocket";
import { BettingPanel, SponsorModal, SponsorFeed } from "@/components/betting";
import {
  BattleChat,
  ShareButton,
  ToastContainer,
  FavoriteButton,
} from "@/components/social";
import { useBattleStream } from "@/hooks/useBattleStream";
import { useFavoriteAgents } from "@/hooks/useFavoriteAgents";
import { useToast } from "@/hooks/useToast";
import { useBurnCounter } from "@/contexts/BurnCounterContext";
import type {
  BattleEvent,
  AgentActionEvent,
  PredictionResultEvent,
  CombatResultEvent,
  AgentDeathEvent,
  EpochStartEvent,
  OddsUpdateEvent,
  BattleEndEvent,
  SponsorBoostEvent,
  AgentMovedEvent,
  ItemSpawnedEvent,
  ItemPickedUpEvent,
  TrapTriggeredEvent,
  PhaseChangeEvent,
  StormDamageEvent,
} from "@/lib/websocket";
import type { AgentClass } from "@/types";

interface BattleViewProps {
  battleId: string;
}

// ---------------------------------------------------------------------------
// Event → FeedEntry transformers
// ---------------------------------------------------------------------------

/** Map of agent IDs to names/classes built from agent_action events */
interface AgentMeta {
  name: string;
  class: AgentClass;
}

function buildAgentMeta(events: BattleEvent[]): Map<string, AgentMeta> {
  const meta = new Map<string, AgentMeta>();
  for (const event of events) {
    if (event.type === "agent_action") {
      const e = event as AgentActionEvent;
      // We only have agentName from agent_action; class comes from epoch_end agentStates
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

      // Prediction entry
      entries.push({
        id: `ws-${index}-pred`,
        timestamp: ts,
        epoch: latestEpoch,
        type: "PREDICTION",
        agentId: e.data.agentId,
        agentName,
        agentClass,
        message: `${agentName} predicts ${e.data.prediction.asset} ${e.data.prediction.direction} -- stakes ${e.data.prediction.stake}% HP. "${e.data.reasoning}"`,
      });

      // Attack entry
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

      // Defend entry
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
            message: `${attackerName} attacks ${defenderName} -- BLOCKED! ${defenderName}'s defenses hold.`,
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
          message: `${agentName} has been REKT! ${killerInfo} HP reached 0.`,
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

    case "agent_moved": {
      const e = event as AgentMovedEvent;
      if (!e.data.success) {
        return [
          {
            id: `ws-${index}`,
            timestamp: ts,
            epoch: latestEpoch,
            type: "MARKET",
            agentId: e.data.agentId,
            agentName: e.data.agentName,
            agentClass: agentMeta.get(e.data.agentId)?.class,
            message: `${e.data.agentName} tried to move but failed: ${e.data.reason ?? "blocked"}.`,
          },
        ];
      }
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "MARKET",
          agentId: e.data.agentId,
          agentName: e.data.agentName,
          agentClass: agentMeta.get(e.data.agentId)?.class,
          message: `${e.data.agentName} moved to (${e.data.to.q},${e.data.to.r}).`,
        },
      ];
    }

    case "item_spawned": {
      const e = event as ItemSpawnedEvent;
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "MARKET",
          message: `${e.data.itemType} appeared at (${e.data.coord.q},${e.data.coord.r})${e.data.isCornucopia ? " [Cornucopia]" : ""}.`,
        },
      ];
    }

    case "item_picked_up": {
      const e = event as ItemPickedUpEvent;
      const hpStr =
        e.data.hpChange > 0
          ? ` (+${e.data.hpChange} HP)`
          : e.data.hpChange < 0
            ? ` (${e.data.hpChange} HP)`
            : "";
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "SPONSOR",
          agentId: e.data.agentId,
          agentName: e.data.agentName,
          agentClass: agentMeta.get(e.data.agentId)?.class,
          message: `${e.data.agentName} picked up ${e.data.itemType}${hpStr}. ${e.data.effect}`,
        },
      ];
    }

    case "trap_triggered": {
      const e = event as TrapTriggeredEvent;
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "ATTACK",
          agentId: e.data.agentId,
          agentName: e.data.agentName,
          agentClass: agentMeta.get(e.data.agentId)?.class,
          message: `${e.data.agentName} triggered a TRAP at (${e.data.coord.q},${e.data.coord.r}) for ${e.data.damage} damage!`,
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
      // Add storm warning for phases that introduce storm damage
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
      const msgQuote = e.data.message ? ` "${e.data.message}"` : "";
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "SPONSOR",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} received ${tierLabel} from the crowd!${effectStr}${msgQuote}`,
        },
      ];
    }

    // epoch_end, grid_state don't generate feed entries (handled by state)
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Phase color config for the unified top bar
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<BattlePhase, { color: string; label: string }> = {
  LOOT: { color: "#22c55e", label: "LOOT" },
  HUNT: { color: "#f59e0b", label: "HUNT" },
  BLOOD: { color: "#dc2626", label: "BLOOD" },
  FINAL_STAND: { color: "#a855f7", label: "FINAL STAND" },
};

// ---------------------------------------------------------------------------
// Unified Battle Top Bar
// ---------------------------------------------------------------------------

/**
 * Consolidated top bar: phase + epoch + countdown (left), agent portraits (center),
 * pool + share + markets (right). Height: 48-56px.
 */
function BattleTopBar({
  battleId,
  currentEpoch,
  currentPhase,
  aliveCount,
  totalAgents,
  agents,
  winner,
  connected,
  isComplete,
  epochDuration = 300,
}: {
  battleId: string;
  currentEpoch: number;
  currentPhase: BattlePhase | null;
  aliveCount: number;
  totalAgents: number;
  agents: BattleAgent[];
  winner: { winnerId: string; winnerName: string; totalEpochs: number; reason?: string } | null;
  connected: boolean;
  isComplete: boolean;
  epochDuration?: number;
}) {
  // Inline countdown timer
  const [remaining, setRemaining] = useState(() =>
    Math.floor(epochDuration * 0.62)
  );

  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 0) return epochDuration;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [epochDuration, isComplete]);

  // Reset timer on epoch change
  const prevEpochRef = useRef(currentEpoch);
  useEffect(() => {
    if (currentEpoch !== prevEpochRef.current) {
      prevEpochRef.current = currentEpoch;
      setRemaining(epochDuration);
    }
  }, [currentEpoch, epochDuration]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isUrgent = remaining <= 30;

  const phaseConfig = currentPhase ? PHASE_COLORS[currentPhase] : null;

  return (
    <div
      className="mb-3 flex items-center justify-between rounded-lg border px-3 py-2 sm:mb-4 sm:px-4"
      style={{
        backgroundColor: "#0d0d1a",
        borderColor: phaseConfig ? `${phaseConfig.color}30` : "#252540",
        minHeight: "48px",
        maxHeight: "56px",
      }}
    >
      {/* ── Left cluster: phase + epoch + countdown ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Battle ID + status dot */}
        <div className="flex items-center gap-1.5">
          {isComplete ? (
            <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold">
              GG
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-green-400">
                LIVE
              </span>
            </span>
          )}
          <span className="hidden text-[10px] text-gray-600 sm:inline">#{battleId}</span>
        </div>

        <span className="h-4 w-px bg-gray-800" />

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
          </>
        )}

        {/* Countdown */}
        {!isComplete && (
          <>
            <span className="hidden h-4 w-px bg-gray-800 sm:inline-block" />
            <span className="flex items-center gap-1">
              <span className="hidden text-[10px] text-gray-600 sm:inline">Next in</span>
              <span
                className={`font-mono text-sm font-bold tabular-nums ${
                  isUrgent ? "text-blood animate-pulse" : "text-gray-400"
                }`}
              >
                {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
              </span>
            </span>
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

      {/* ── Center cluster: agent portrait thumbnails with HP rings ── */}
      <div className="hidden items-center gap-1 md:flex">
        {agents.map((agent) => {
          const config = CLASS_CONFIG[agent.class];
          const hpPct = agent.maxHp > 0 ? agent.hp / agent.maxHp : 0;
          // SVG arc for HP ring (28px diameter circle)
          const radius = 12;
          const circumference = 2 * Math.PI * radius;
          const strokeDash = hpPct * circumference;

          // HP color: green > 50%, gold 25-50%, red < 25%
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
                {/* Background ring */}
                <circle
                  cx="15"
                  cy="15"
                  r={radius}
                  fill="none"
                  stroke="#1a1a2e"
                  strokeWidth="2"
                />
                {/* HP ring */}
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
                {/* Agent portrait (clipped circle) */}
                <clipPath id={`topbar-clip-${agent.id}`}>
                  <circle cx="15" cy="15" r="10" />
                </clipPath>
                <foreignObject
                  x="5"
                  y="5"
                  width="20"
                  height="20"
                  clipPath={`url(#topbar-clip-${agent.id})`}
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
                {/* Dead X overlay */}
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
        {/* Alive count */}
        <span className="ml-1 text-[10px] text-gray-600">
          <span className="text-white">{aliveCount}</span>/{totalAgents}
        </span>
      </div>

      {/* ── Right cluster: pool + share ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mobile alive count (shown only on small screens) */}
        <span className="text-[10px] text-gray-600 md:hidden">
          <span className="text-white">{aliveCount}</span>/{totalAgents} alive
        </span>

        {/* Pool */}
        <span className="hidden text-[10px] text-gray-600 lg:inline">
          Pool: <span className="font-bold text-gold">-- $HNADS</span>
        </span>

        {/* Share button */}
        <ShareButton
          battleId={battleId}
          winner={winner}
          agents={agents}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible sidebar panel wrapper
// ---------------------------------------------------------------------------

function CollapsiblePanel({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        backgroundColor: "#12121f",
        borderColor: "#252540",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest transition-colors hover:text-gold sm:px-4 sm:text-xs"
        style={{ color: "#a89870" }}
      >
        <span className="flex items-center gap-2">
          {title}
          {badge && <span className="text-[10px] font-normal text-gray-500">{badge}</span>}
        </span>
        <span
          className="text-xs transition-transform duration-200"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            color: "#f59e0b",
          }}
        >
          {"\u25BE"}
        </span>
      </button>

      {open && (
        <div
          className="border-t"
          style={{ borderColor: "#252540" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prediction Explainer (collapsible)
// ---------------------------------------------------------------------------

function PredictionExplainer() {
  return (
    <CollapsiblePanel title="How Predictions Work" defaultOpen={false}>
      <div className="px-3 pb-3 pt-2 sm:px-4">
        <div className="space-y-2 text-[10px] leading-relaxed sm:text-xs" style={{ color: "#d4c5a0" }}>
          <p>
            Each epoch, agents predict if an asset (
            <span style={{ color: "#f59e0b" }}>ETH</span>,{" "}
            <span style={{ color: "#f59e0b" }}>BTC</span>,{" "}
            <span style={{ color: "#f59e0b" }}>SOL</span>,{" "}
            <span style={{ color: "#f59e0b" }}>MON</span>) will go{" "}
            <span className="font-bold" style={{ color: "#22c55e" }}>UP</span> or{" "}
            <span className="font-bold" style={{ color: "#dc2626" }}>DOWN</span>.
          </p>
          <p>
            They stake{" "}
            <span className="font-bold" style={{ color: "#f59e0b" }}>5-50% of their HP</span>{" "}
            on the prediction.
          </p>
          <div
            className="flex gap-3 rounded px-2 py-1.5"
            style={{ backgroundColor: "#0f0f1a" }}
          >
            <div>
              <span className="font-bold" style={{ color: "#22c55e" }}>Correct</span>{" "}
              = gain staked HP back
            </div>
            <div>
              <span className="font-bold" style={{ color: "#dc2626" }}>Wrong</span>{" "}
              = lose staked HP
            </div>
          </div>
          <div className="space-y-1 pt-1">
            <div className="font-bold uppercase tracking-wider" style={{ color: "#a89870", fontSize: "9px" }}>
              Special Skills
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>
                <span className="font-bold" style={{ color: "#3b82f6" }}>Trader</span>{" "}
                INSIDER_INFO = forced success
              </span>
              <span>
                <span className="font-bold" style={{ color: "#f59e0b" }}>Gambler</span>{" "}
                ALL_IN = 2x stake
              </span>
              <span>
                <span className="font-bold" style={{ color: "#22c55e" }}>Survivor</span>{" "}
                FORTIFY = block losses
              </span>
            </div>
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV === "development";

export default function BattleView({ battleId }: BattleViewProps) {
  const {
    connected,
    events,
    agentStates,
    latestEpoch,
    winner,
    gridTiles,
    agentPositions: streamAgentPositions,
    recentMoves,
    phaseState,
    stormTiles,
    agentWallets,
  } = useBattleStream(battleId);

  const { address, isConnected: walletConnected } = useAccount();
  const { favorites, toggle: toggleFavorite, isFavorite } = useFavoriteAgents();

  // ── Fetch battle metadata (tier, etc.) ──
  const [battleTier, setBattleTier] = useState<'FREE' | 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD'>('IRON');
  const [bettingPhase, setBettingPhase] = useState<'OPEN' | 'LOCKED' | 'SETTLED'>('OPEN');
  const [prizeData, setPrizeData] = useState<any>(null);
  const [apiSettlementTxs, setApiSettlementTxs] = useState<any>(null);
  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
    fetch(`${API_BASE}/battle/${battleId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.tier) {
          setBattleTier(data.tier);
        }
        if (data.bettingPhase) {
          setBettingPhase(data.bettingPhase);
        }
        if (data.settlementTxs) {
          setApiSettlementTxs(data.settlementTxs);
        }
        // If battle is completed, fetch prize distribution
        if (data.status === 'COMPLETED') {
          fetch(`${API_BASE}/battle/${battleId}/prizes`)
            .then((res) => res.json())
            .then((prizes) => setPrizeData(prizes))
            .catch((err) => console.warn('Failed to fetch prize data:', err));
        }
      })
      .catch((err) => console.warn('Failed to fetch battle metadata:', err));
  }, [battleId]);

  // Listen for betting_phase_change WebSocket events
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'betting_phase_change') {
        const phase = (events[i].data as any)?.phase;
        if (phase) {
          setBettingPhase(phase);
          break;
        }
      }
    }
  }, [events]);
  const { toasts, addToast, removeToast } = useToast();
  const { addBurn } = useBurnCounter();
  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);

  // Wallet display name for chat
  const userDisplayName = useMemo(() => {
    if (!address) return "anon";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address]);

  // Push sponsor_boost WS events into the global burn counter
  const processedSponsorCountRef = useRef(0);
  useEffect(() => {
    const sponsorEvents = events.filter(
      (e): e is SponsorBoostEvent => e.type === "sponsor_boost",
    );
    // Only process new sponsor events (avoid double-counting on re-renders)
    const newEvents = sponsorEvents.slice(processedSponsorCountRef.current);
    for (const event of newEvents) {
      const amount =
        event.data.amount ??
        // Fallback: derive cost from tier if amount not present
        ({ BREAD_RATION: 10, MEDICINE_KIT: 25, ARMOR_PLATING: 50, WEAPON_CACHE: 75, CORNUCOPIA: 150 }[
          event.data.tier
        ] ?? 0);
      if (amount > 0) addBurn(amount);
    }
    processedSponsorCountRef.current = sponsorEvents.length;
  }, [events, addBurn]);

  // Build agent metadata lookup from events (for names/classes in feed)
  const agentMeta = useMemo(() => {
    const meta = buildAgentMeta(events);
    // Also enrich from agentStates (which includes class info)
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

  // ─── Transform events → FeedEntry[] ──────────────────────────────
  const feed: FeedEntry[] = useMemo(() => {
    if (!connected && events.length === 0 && isDev) return MOCK_FEED;
    return events.flatMap((event, i) =>
      eventToFeedEntries(event, i, agentMeta, latestEpoch),
    );
  }, [connected, events, agentMeta, latestEpoch]);

  // ─── Transform agentStates → BattleAgent[] ──────────────────────
  const agents: BattleAgent[] = useMemo(() => {
    if (agentStates.length === 0 && isDev) return MOCK_AGENTS;
    if (agentStates.length === 0) return [];

    // Compute transient states from recent events
    // (look at the last N events for animation cues)
    const recentEvents = events.slice(-20);

    // Track kills per agent
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

    // Latest agent_action per agent (for defending, lastAction)
    const latestActions = new Map<string, AgentActionEvent["data"]>();
    // Latest prediction_result per agent
    const latestPredResults = new Map<
      string,
      PredictionResultEvent["data"]
    >();
    // Latest combat involvement per agent
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
          lastAction = `Attacked ${targetName} for ${action.attack.stake} stake`;
        } else {
          lastAction = `Predicted ${action.prediction.asset} ${action.prediction.direction} (stake: ${action.prediction.stake}%)`;
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
        walletAddress: agentWallets[state.id],
      } satisfies BattleAgent;
    });
  }, [agentStates, events, agentMeta, winner, agentWallets]);

  // ─── Transform grid state → Map<agentId, HexCoord> + Map<hexKey, TileItem[]>
  // TileItem type from HexBattleArena: { id: string; type: ItemType }
  // where ItemType = "RATION" | "WEAPON" | "SHIELD" | "TRAP" | "ORACLE"
  type HexItemType = "RATION" | "WEAPON" | "SHIELD" | "TRAP" | "ORACLE";
  type HexTileItem = { id: string; type: HexItemType };

  const { hexAgentPositions, hexTileItems } = useMemo(() => {
    // Use WebSocket stream data if available
    const hasStreamData = Object.keys(streamAgentPositions).length > 0;
    if (hasStreamData) {
      const positions = new Map<string, { q: number; r: number }>();
      for (const [agentId, coord] of Object.entries(streamAgentPositions)) {
        positions.set(agentId, coord);
      }
      const items = new Map<string, HexTileItem[]>();
      for (const tile of gridTiles) {
        if (tile.items.length > 0) {
          items.set(
            `${tile.q},${tile.r}`,
            tile.items.map((i) => ({ id: i.id, type: i.type as HexItemType })),
          );
        }
      }
      return { hexAgentPositions: positions, hexTileItems: items };
    }

    // Fall back to mock data in dev mode
    if (isDev) {
      return {
        hexAgentPositions: MOCK_AGENT_POSITIONS,
        hexTileItems: MOCK_TILE_ITEMS as Map<string, HexTileItem[]>,
      };
    }

    return {
      hexAgentPositions: new Map<string, { q: number; r: number }>(),
      hexTileItems: new Map<string, HexTileItem[]>(),
    };
  }, [streamAgentPositions, gridTiles]);

  const currentEpoch = latestEpoch || (isDev ? 3 : 0);
  const aliveCount = agents.filter((a) => a.alive).length;

  // Count sponsor events for particle effects
  const sponsorEventCount = useMemo(
    () => feed.filter((f) => f.type === "SPONSOR").length,
    [feed],
  );

  // ─── Favorite agent toast notifications ────────────────────────────
  // Track feed length to detect new entries and fire toasts for favorites
  const prevFeedLenRef = useRef(feed.length);

  useEffect(() => {
    if (favorites.size === 0) return;
    if (feed.length <= prevFeedLenRef.current) {
      prevFeedLenRef.current = feed.length;
      return;
    }

    // Process only the new feed entries since last check
    const newEntries = feed.slice(prevFeedLenRef.current);
    prevFeedLenRef.current = feed.length;

    for (const entry of newEntries) {
      if (!entry.agentId || !isFavorite(entry.agentId)) continue;

      const name = entry.agentName ?? "Your favorite";

      switch (entry.type) {
        case "ATTACK":
          addToast(`${name} is in combat!`, "danger");
          break;
        case "DEFEND":
          addToast(`${name} raised defenses!`, "info");
          break;
        case "DEATH":
          addToast(`${name} has been REKT!`, "danger");
          break;
        case "PREDICTION":
          if (entry.message.includes("CORRECT")) {
            addToast(`${name} nailed the prediction!`, "success");
          }
          break;
        case "STORM":
          addToast(`${name} is taking storm damage!`, "danger");
          break;
        default:
          break;
      }
    }
  }, [feed, favorites, isFavorite, addToast]);

  // Fire toast when a favorite agent wins
  const prevWinnerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!winner) return;
    if (prevWinnerRef.current === winner.winnerId) return;
    prevWinnerRef.current = winner.winnerId;

    if (isFavorite(winner.winnerId)) {
      addToast(`${winner.winnerName} WINS THE BATTLE!`, "gold");
    }
  }, [winner, isFavorite, addToast]);

  // Mobile sidebar tabs (4-tab layout per spec: Log | Bets | Chat | More)
  type SidebarTab = "log" | "bets" | "chat" | "more";
  const [mobileSidebarTab, setMobileSidebarTab] = useState<SidebarTab>("log");

  const sidebarTabs: { key: SidebarTab; label: string }[] = [
    { key: "log", label: "Log" },
    { key: "bets", label: "Bets" },
    { key: "chat", label: "Chat" },
    { key: "more", label: "More" },
  ];

  return (
    <div className="overflow-x-hidden">
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Unified top bar: epoch + phase + countdown | agent portraits | pool + share */}
      <BattleTopBar
        battleId={battleId}
        currentEpoch={currentEpoch}
        currentPhase={phaseState?.phase ?? null}
        aliveCount={aliveCount}
        totalAgents={agents.length || 5}
        agents={agents}
        winner={winner}
        connected={connected}
        isComplete={!!winner}
      />

      {/* Winner announcement + prize claim (unified) */}
      {winner && (
        <PrizeClaim
          battleId={battleId}
          winner={winner}
          agents={agents}
          settlementTxs={winner?.settlementTxs ?? apiSettlementTxs}
          shareButton={<ShareButton battleId={battleId} winner={winner} agents={agents} />}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          Main 2fr/1fr grid layout: Arena (left) + Sidebar (right)
          Desktop: side-by-side. Mobile: stacked.
          ═══════════════════════════════════════════════════════════════ */}
      <div
        className="grid grid-cols-1 items-start gap-4 md:grid-cols-[2fr_1fr]"
        style={{ minHeight: "min(calc(100vh - 52px), 100%)" }}
      >
        {/* ─── Left column: Arena ─── */}
        <div className="flex flex-col gap-4 md:sticky md:top-4">
          {/* Hex battle arena */}
          <div className="card flex-1">
            <HexBattleArena
              agents={agents}
              currentEpoch={currentEpoch}
              sponsorEventCount={sponsorEventCount}
              agentPositions={hexAgentPositions}
              tileItems={hexTileItems}
              recentMoves={recentMoves}
              stormTiles={stormTiles}
              currentPhase={phaseState?.phase ?? null}
            />
          </div>

          {/* Mobile-only agent cards -- visible below hex grid on small screens */}
          {agents.length > 0 && (
            <div className="md:hidden">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                Gladiators
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {/* Favorite agents bar (desktop) */}
          {agents.length > 0 && (
            <div className="card hidden md:block">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                Favorite Gladiators
              </div>
              <div className="flex flex-wrap gap-2">
                {agents.map((agent) => {
                  const fav = isFavorite(agent.id);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => {
                        const added = toggleFavorite(agent.id);
                        if (added) {
                          addToast(`${agent.name} added to favorites`, "gold");
                        }
                      }}
                      className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition-all ${
                        fav
                          ? "border-blood/40 bg-blood/10 text-blood-light"
                          : "border-colosseum-surface-light bg-colosseum-surface text-gray-500 hover:border-gray-500 hover:text-gray-300"
                      }`}
                    >
                      <FavoriteButton
                        agentId={agent.id}
                        isFavorite={fav}
                        onToggle={toggleFavorite}
                        size="sm"
                      />
                      <span className={`font-bold ${fav ? "text-white" : ""}`}>
                        {agent.name}
                      </span>
                      {!agent.alive && (
                        <span className="text-[9px] font-bold tracking-wider text-blood/60">
                          REKT
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right column: Sidebar with collapsible panels ─── */}
        <div className="flex flex-col gap-3">
          {/* Mobile tab bar for sidebar panels */}
          <div
            className="sticky top-0 z-10 flex border-b border-colosseum-surface-light md:hidden"
            style={{ backgroundColor: "#0a0a14" }}
          >
            {sidebarTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setMobileSidebarTab(tab.key)}
                className={`relative flex-1 whitespace-nowrap px-2 py-3.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                  mobileSidebarTab === tab.key
                    ? "text-gold"
                    : "text-gray-600 active:text-gray-400"
                }`}
                style={{ minHeight: "48px" }}
              >
                {tab.label}
                {mobileSidebarTab === tab.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold" />
                )}
              </button>
            ))}
          </div>

          {/* Battle Log (first in sidebar) */}
          <div className={`${mobileSidebarTab !== "log" ? "hidden md:block" : ""}`}>
            <CollapsiblePanel title="Battle Log" defaultOpen={true}>
              <div
                className="max-h-[300px] md:max-h-[380px]"
                style={{ display: "flex", flexDirection: "column" }}
              >
                <ActionFeed entries={feed} />
              </div>
            </CollapsiblePanel>
          </div>

          {/* Betting panel */}
          <div className={`${mobileSidebarTab !== "bets" ? "hidden md:block" : ""}`}>
            <CollapsiblePanel title="Bets" defaultOpen={false}>
              <div className="p-3">
                <BettingPanel agents={agents} battleId={battleId} winner={winner} tier={battleTier} bettingPhase={bettingPhase} events={events} settlementTxs={winner?.settlementTxs ?? apiSettlementTxs} />
              </div>
            </CollapsiblePanel>
          </div>

          {/* Sponsor feed (visible on desktop always, on mobile under "more" tab) */}
          <div className={`${mobileSidebarTab !== "more" ? "hidden md:block" : ""}`}>
            <CollapsiblePanel title="Sponsor Feed" defaultOpen={false}>
              <div className="p-3">
                <SponsorFeed events={events} agentMeta={agentMeta} />
              </div>
            </CollapsiblePanel>
          </div>

          {/* Battle chat */}
          <div className={`${mobileSidebarTab !== "chat" ? "hidden md:block" : ""}`}>
            <CollapsiblePanel title="Spectator Chat" defaultOpen={false}>
              <div className="p-3">
                <BattleChat
                  battleId={battleId}
                  isConnected={walletConnected}
                  userDisplayName={userDisplayName}
                />
              </div>
            </CollapsiblePanel>
          </div>

          {/* Pool + Sponsor CTA (visible on desktop always, on mobile under "more" tab) */}
          <div className={`${mobileSidebarTab !== "more" ? "hidden md:block" : ""}`}>
            <CollapsiblePanel title="Prize Pool" defaultOpen={true}>
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
                    Pool
                  </h2>
                  <span className="text-lg font-bold text-gold">-- $HNADS</span>
                </div>
                <div className="mt-2 h-px w-full bg-colosseum-surface-light" />
                <div className="mt-2 flex justify-between text-[10px] text-gray-600">
                  <span>Bettors: --</span>
                  <span>Sponsors: --</span>
                </div>
                <button
                  onClick={() => setSponsorModalOpen(true)}
                  className="mt-3 w-full rounded border border-gold/30 bg-gold/10 py-2.5 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98]"
                  style={{ minHeight: "44px" }}
                >
                  Sponsor a Gladiator
                </button>
              </div>
            </CollapsiblePanel>
          </div>

          {/* Market ticker (visible on desktop always, on mobile under "more" tab) */}
          <div className={`${mobileSidebarTab !== "more" ? "hidden md:block" : ""}`}>
            <CollapsiblePanel title="Markets" defaultOpen={false}>
              <div className="p-3">
                <MarketTicker />
              </div>
            </CollapsiblePanel>
          </div>

          {/* Prediction explainer (visible on desktop always, on mobile under "more" tab) */}
          <div className={`${mobileSidebarTab !== "more" ? "hidden md:block" : ""}`}>
            <PredictionExplainer />
          </div>
        </div>
      </div>

      {/* Favorite agents bar (mobile only) */}
      {agents.length > 0 && (
        <div className="mt-4 card md:hidden">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">
            Favorite Gladiators
          </div>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => {
              const fav = isFavorite(agent.id);
              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    const added = toggleFavorite(agent.id);
                    if (added) {
                      addToast(`${agent.name} added to favorites`, "gold");
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded border px-3 py-2 text-xs transition-all ${
                    fav
                      ? "border-blood/40 bg-blood/10 text-blood-light"
                      : "border-colosseum-surface-light bg-colosseum-surface text-gray-500 active:border-gray-500 active:text-gray-300"
                  }`}
                  style={{ minHeight: "44px" }}
                >
                  <FavoriteButton
                    agentId={agent.id}
                    isFavorite={fav}
                    onToggle={toggleFavorite}
                    size="sm"
                  />
                  <span className={`font-bold ${fav ? "text-white" : ""}`}>
                    {agent.name}
                  </span>
                  {!agent.alive && (
                    <span className="text-[9px] font-bold tracking-wider text-blood/60">
                      REKT
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom dramatic footer */}
      <div className="mt-4 text-center text-[10px] uppercase tracking-[0.3em] text-gray-700">
        May the nads be ever in your favor
      </div>

      {/* Sponsor modal */}
      <SponsorModal
        open={sponsorModalOpen}
        onClose={() => setSponsorModalOpen(false)}
        agents={agents}
        battleId={battleId}
        currentEpoch={currentEpoch}
      />
    </div>
  );
}
