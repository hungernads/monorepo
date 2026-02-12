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
  AgentActionEvent,
  PredictionResultEvent,
  CombatResultEvent,
  AgentDeathEvent,
  EpochStartEvent,
  OddsUpdateEvent,
  BattleEndEvent,
  PhaseChangeEvent,
  StormDamageEvent,
  AgentTokenTradeEvent,
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

    case "agent_token_trade": {
      const e = event as AgentTokenTradeEvent;
      const meta = agentMeta.get(e.data.agentId);
      const agentName = meta?.name ?? e.data.agentName;
      const agentClass = meta?.class;
      const verb = e.data.action === 'buy' ? 'bought' : 'panic-sold';
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
          message: `${agentName} ${verb} $HNADS for ${e.data.amount} MON. ${e.data.reason}${txSuffix}`,
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
    highlights.push({
      id: "hl-victory",
      type: "VICTORY",
      title: `${winner.winnerName} WINS`,
      subtitle: `Last nad standing after ${winner.totalEpochs} epochs!`,
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
  const { connected, events, agentStates, latestEpoch, winner } =
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
    return (
      <div className={`relative h-screen w-screen overflow-hidden ${bgClass}`}>
        {/* Top: branding + status */}
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
              Epoch <span className="text-white">{currentEpoch}</span>
            </span>
            <span className="mx-2 text-gray-700">|</span>
            <span className="text-xs text-gray-400">
              <span className="text-white">{aliveCount}</span>/{agents.length} alive
            </span>
          </div>
          {winner ? (
            <span className="rounded-lg border border-gold/40 bg-gold/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gold backdrop-blur-sm">
              FINISHED
            </span>
          ) : (
            <span className="rounded-lg border border-green-500/40 bg-green-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-green-400 backdrop-blur-sm animate-pulse">
              LIVE
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

  // Layout: full (default) -- arena + sidebar feed + agent bar
  return (
    <div className={`relative h-screen w-screen overflow-hidden ${bgClass}`}>
      {/* Top bar: branding + battle info */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-colosseum-surface-light/50 bg-colosseum-bg/80 px-6 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="font-cinzel text-base font-black tracking-widest text-gold">
            HUNGERNADS
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            AI Colosseum
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-500">
            Battle <span className="font-bold text-white">#{battleId}</span>
          </span>
          <span className="text-gray-700">|</span>
          <span className="text-gray-500">
            Epoch{" "}
            <span className="font-bold text-white">{currentEpoch}</span>/20
          </span>
          <span className="text-gray-700">|</span>
          <span className="text-gray-500">
            <span className="font-bold text-white">{aliveCount}</span>/
            {agents.length} alive
          </span>
          <span className="text-gray-700">|</span>
          {winner ? (
            <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
              FINISHED
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blood" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-blood">
                LIVE
              </span>
            </span>
          )}
          {connected ? (
            <span className="flex items-center gap-1 text-[10px] text-green-500">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              WS
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
              OFF
            </span>
          )}
        </div>
      </div>

      {/* Main content: arena + feed */}
      <div className="flex h-full pt-12">
        {/* Arena (center) */}
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-[800px]">
            <HexBattleArena
              agents={agents}
              currentEpoch={currentEpoch}
              sponsorEventCount={0}
            />
          </div>
        </div>

        {/* Right sidebar: action feed */}
        {showFeed && (
          <div className="flex w-80 flex-col border-l border-colosseum-surface-light/50 bg-colosseum-bg/60 backdrop-blur-sm">
            <div className="flex-1 overflow-hidden p-3">
              <StreamActionFeed entries={feed.slice(-30)} />
            </div>
          </div>
        )}
      </div>

      {/* Bottom: agent status bar */}
      {showStats && (
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <StreamAgentBar agents={agents} />
        </div>
      )}

      {/* Winner announcement overlay */}
      {winner && (() => {
        const victoryAgent = agents.find((a) => a.id === winner.winnerId);
        const victoryCfg = victoryAgent
          ? CLASS_CONFIG[victoryAgent.class as AgentClass] ?? CLASS_CONFIG.WARRIOR
          : CLASS_CONFIG.WARRIOR;
        return (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="pointer-events-auto rounded-xl border-2 border-gold/60 bg-colosseum-bg/90 px-12 py-8 text-center shadow-2xl shadow-gold/20 backdrop-blur-md">
              <div className="font-cinzel text-4xl font-black tracking-[0.2em] text-gold animate-winner-glow">
                VICTORY
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
                Last nad standing after {winner.totalEpochs} epochs
              </div>
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
