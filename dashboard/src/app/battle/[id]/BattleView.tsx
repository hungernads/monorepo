"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import {
  AgentCard,
  HexBattleArena,
  ActionFeed,
  EpochTimer,
  MarketTicker,
  PhaseIndicator,
  PrizeClaim,
  MOCK_AGENTS,
  MOCK_FEED,
  MOCK_AGENT_POSITIONS,
  MOCK_TILE_ITEMS,
} from "@/components/battle";
import type { BattleAgent, FeedEntry } from "@/components/battle";
import { BettingPanel, SponsorModal, SponsorFeed } from "@/components/betting";
import {
  BattleChat,
  ShareButton,
  ToastContainer,
  WatcherCount,
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
  SponsorBoostEvent,
  AgentMovedEvent,
  ItemSpawnedEvent,
  ItemPickedUpEvent,
  TrapTriggeredEvent,
  PhaseChangeEvent,
  StormDamageEvent,
  AgentTokenTradeEvent,
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
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: e.data.epochNumber,
          type: "MARKET",
          message: `Epoch ${e.data.epochNumber} begins. Market prices updated.`,
        },
      ];
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
        message: `${agentName} predicts ${e.data.prediction.asset} ${e.data.prediction.direction} -- stakes ${Math.round(e.data.prediction.stake * 100)}% HP. "${e.data.reasoning}"`,
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
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: latestEpoch,
          type: "PREDICTION",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName} prediction ${result}! (${hpStr}, now ${e.data.hpAfter} HP)`,
        },
      ];
    }

    case "combat_result": {
      const e = event as CombatResultEvent;
      const atkMeta = agentMeta.get(e.data.attackerId);
      const defMeta = agentMeta.get(e.data.defenderId);
      const attackerName = atkMeta?.name ?? e.data.attackerId;
      const defenderName = defMeta?.name ?? e.data.defenderId;
      const atkClass = atkMeta?.class;

      if (e.data.blocked) {
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
          message: `${attackerName} attacks ${defenderName} for ${e.data.damage} damage!`,
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

    case "agent_token_trade": {
      const e = event as AgentTokenTradeEvent;
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentName;
      const agentClass = meta?.class;
      const walletTag = e.data.agentWallet
        ? ` [${e.data.agentWallet.slice(0, 6)}...]`
        : '';
      const txSuffix = e.data.txHash
        ? ` (tx: ${e.data.txHash.slice(0, 10)}...)`
        : ' (tx pending)';
      return [
        {
          id: `ws-${index}`,
          timestamp: ts,
          epoch: e.data.epochNumber,
          type: "TOKEN_TRADE",
          agentId: e.data.agentId,
          agentName,
          agentClass,
          message: `${agentName}${walletTag} bought $HNADS for ${e.data.amount} MON. ${e.data.reason}${txSuffix}`,
        },
      ];
    }

    // epoch_end, battle_end, grid_state don't generate feed entries (handled by state)
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Epoch Phase Indicator
// ---------------------------------------------------------------------------

const EPOCH_PHASES = [
  { key: "PREDICT", label: "Predict", icon: "\u25B2\u25BC" },
  { key: "MOVE", label: "Move", icon: "\u2192" },
  { key: "FIGHT", label: "Fight", icon: "\u2694" },
  { key: "RESOLVE", label: "Resolve", icon: "\u2713" },
] as const;

/**
 * Animated phase stepper that cycles through epoch phases.
 * The backend processes all phases at once, so we animate through them
 * over a 12s cycle to give spectators a sense of progression.
 */
function EpochPhaseIndicator({ isFinished }: { isFinished: boolean }) {
  const [activePhase, setActivePhase] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isFinished || !mounted) return;
    const interval = setInterval(() => {
      setActivePhase((prev) => (prev + 1) % EPOCH_PHASES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [isFinished, mounted]);

  return (
    <div className="mt-3 flex items-center justify-center gap-1">
      {EPOCH_PHASES.map((phase, i) => {
        const isActive = !isFinished && i === activePhase;
        const isPast = !isFinished && i < activePhase;
        return (
          <div key={phase.key} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className="h-px w-3 sm:w-5"
                style={{
                  backgroundColor: isPast || isActive ? "#f59e0b" : "#252540",
                }}
              />
            )}
            <div
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-all duration-300 sm:px-2 sm:text-[10px]"
              style={{
                backgroundColor: isActive ? "#2a1f0a" : "transparent",
                color: isActive
                  ? "#f59e0b"
                  : isPast
                    ? "#b45309"
                    : "#3a3a5c",
                border: isActive ? "1px solid #f59e0b" : "1px solid transparent",
                boxShadow: isActive ? "0 0 8px rgba(245,158,11,0.2)" : "none",
              }}
            >
              <span>{phase.icon}</span>
              <span className="hidden sm:inline">{phase.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prediction Explainer (collapsible)
// ---------------------------------------------------------------------------

function PredictionExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-lg border"
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
        <span>How Predictions Work</span>
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
          className="border-t px-3 pb-3 pt-2 sm:px-4"
          style={{ borderColor: "#252540" }}
        >
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
      )}
    </div>
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
        latestCombat.set(e.data.attackerId, {
          attacking: true,
          attacked: false,
        });
        latestCombat.set(e.data.defenderId, {
          attacking: false,
          attacked: !e.data.blocked,
        });
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
          lastAction = `Predicted ${action.prediction.asset} ${action.prediction.direction} (stake: ${Math.round(action.prediction.stake * 100)}%)`;
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

  // Mobile sidebar tabs -- add "chat" tab
  type SidebarTab = "bets" | "sponsors" | "markets" | "chat";
  const [mobileSidebarTab, setMobileSidebarTab] = useState<SidebarTab>("bets");

  const sidebarTabs: { key: SidebarTab; label: string }[] = [
    { key: "bets", label: "Bets" },
    { key: "chat", label: "Chat" },
    { key: "sponsors", label: "Sponsors" },
    { key: "markets", label: "Markets" },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden sm:space-y-6">
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Battle header */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <h1 className="font-cinzel text-lg font-black tracking-wider text-gold sm:text-2xl">
            BATTLE #{battleId}
          </h1>
          {winner ? (
            <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold sm:text-xs">
              FINISHED
            </span>
          ) : (
            <span className="rounded bg-green-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-400 animate-pulse sm:text-xs">
              LIVE
            </span>
          )}
          {/* Connection status */}
          <span
            className={`hidden items-center gap-1 text-[10px] uppercase tracking-wider sm:flex ${
              connected ? "text-green-500" : "text-gray-600"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                connected ? "bg-green-500" : "bg-gray-600"
              }`}
            />
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500 sm:gap-4 sm:text-xs">
          {/* Watcher count */}
          <WatcherCount isLive={!winner} />
          <span className="hidden text-gray-700 sm:inline">|</span>
          <span>
            Epoch <span className="text-white">{currentEpoch}</span>
            {winner?.totalEpochs ? `/${winner.totalEpochs}` : ""}
          </span>
          <span>
            <span className="text-white">{aliveCount}</span> alive
          </span>
          <span className="hidden sm:inline text-gray-700">
            Pool: <span className="text-gold">-- $HNADS</span>
          </span>
          {/* Share button */}
          <ShareButton
            battleId={battleId}
            winner={winner}
            agents={agents}
          />
        </div>
      </div>

      {/* Winner announcement */}
      {winner && (
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-center sm:p-4">
          <div className="font-cinzel text-xl font-black tracking-widest text-gold sm:text-2xl">
            VICTORY
          </div>
          <div className="mt-1 text-xs text-white sm:text-sm">
            <span className="font-bold">{winner.winnerName}</span> is the last
            nad standing after {winner.totalEpochs} epochs!
          </div>
          <div className="mt-2 flex justify-center">
            <ShareButton
              battleId={battleId}
              winner={winner}
              agents={agents}
            />
          </div>
        </div>
      )}

      {/* Prize claim section (shown after battle completes) */}
      {winner && (
        <PrizeClaim
          battleId={battleId}
          winner={winner}
          agents={agents}
        />
      )}

      {/* Battle phase indicator (LOOT / HUNT / BLOOD / FINAL STAND) */}
      <PhaseIndicator
        currentPhase={phaseState?.phase ?? null}
        epochsRemaining={phaseState?.epochsRemaining ?? 0}
        phaseTotalEpochs={phaseState?.phaseTotalEpochs ?? 0}
        isComplete={!!winner}
        currentEpoch={currentEpoch}
      />

      {/* Cinematic top bar: epoch timer + pool + sponsor button */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
        <div className="card md:col-span-2">
          <EpochTimer
            currentEpoch={currentEpoch}
            isComplete={!!winner}
            winnerName={winner?.winnerName}
          />
          <EpochPhaseIndicator isFinished={!!winner} />
        </div>
        <div className="card">
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
            className="mt-3 w-full rounded border border-gold/30 bg-gold/10 py-2.5 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98] sm:py-1.5"
          >
            Sponsor a Gladiator
          </button>
        </div>
      </div>

      {/* Favorite agents bar */}
      {agents.length > 0 && (
        <div className="card">
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

      {/* Main layout: arena + sidebar */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-3">
        {/* Arena (full width on mobile, 2/3 on md+) */}
        <div className="card md:col-span-2">
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

        {/* Mobile-only agent cards — visible below hex grid on small screens */}
        {agents.length > 0 && (
          <div className="md:hidden">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">
              Gladiators
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        )}

        {/* Sidebar: desktop shows all panels stacked, mobile uses tabs */}
        <div className="flex flex-col gap-4">
          {/* Mobile tab bar for sidebar panels */}
          <div className="flex overflow-x-auto border-b border-colosseum-surface-light md:hidden">
            {sidebarTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setMobileSidebarTab(tab.key)}
                className={`relative flex-1 whitespace-nowrap px-3 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                  mobileSidebarTab === tab.key
                    ? "text-gold"
                    : "text-gray-600 hover:text-gray-400"
                }`}
              >
                {tab.label}
                {mobileSidebarTab === tab.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold" />
                )}
              </button>
            ))}
          </div>

          {/* Betting panel */}
          <div className={`card ${mobileSidebarTab !== "bets" ? "hidden md:block" : ""}`}>
            <BettingPanel agents={agents} battleId={battleId} winner={winner} />
          </div>

          {/* Battle chat */}
          <div className={`card ${mobileSidebarTab !== "chat" ? "hidden md:block" : ""}`}>
            <BattleChat
              battleId={battleId}
              isConnected={walletConnected}
              userDisplayName={userDisplayName}
            />
          </div>

          {/* Sponsor feed */}
          <div className={`card ${mobileSidebarTab !== "sponsors" ? "hidden md:block" : ""}`}>
            <SponsorFeed events={events} agentMeta={agentMeta} />
          </div>

          {/* Market ticker */}
          <div className={`card ${mobileSidebarTab !== "markets" ? "hidden md:block" : ""}`}>
            <MarketTicker />
          </div>

        </div>
      </div>

      {/* Battle Log -- full-width below arena for better readability */}
      <div
        className="card max-h-[300px] md:max-h-[380px]"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <ActionFeed entries={feed} />
      </div>

      {/* Prediction explainer */}
      <PredictionExplainer />

      {/* Bottom dramatic footer */}
      <div className="text-center text-[10px] uppercase tracking-[0.3em] text-gray-700">
        May the nads be ever in your favor
      </div>

      {/* Sponsor modal */}
      <SponsorModal
        open={sponsorModalOpen}
        onClose={() => setSponsorModalOpen(false)}
        agents={agents}
        battleId={battleId}
      />
    </div>
  );
}
