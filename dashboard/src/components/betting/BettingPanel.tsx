"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useAccount } from "wagmi";
import type { AgentState, AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";
import useFetch from "@/hooks/useFetch";
import OddsIndicator from "./OddsIndicator";
import OddsSparkline from "./OddsSparkline";
import BetSlip from "./BetSlip";
import type { BetSlipAgent } from "./BetSlip";
import SettlementView from "./SettlementView";
import type { SettlementTxs } from "./SettlementView";
import type { BattleEvent } from "@/lib/websocket";

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

/** GET /battle/:id/odds response */
interface OddsResponse {
  battleId: string;
  totalPool: number;
  perAgent: Record<string, number>;
  odds: Record<string, {
    probability: number;
    decimal: number;
    price: number;
    totalShares: number;
  }>;
  userShares?: Record<string, number>; // Optional: user's shares per agent when ?user=address is passed
}

/** GET /user/:address/bets response */
interface UserBetsResponse {
  userAddress: string;
  bets: UserBet[];
  count: number;
}

interface UserBet {
  id: string;
  battle_id: string;
  agent_id: string;
  amount: number;
  payout: number;
  settled: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BettingPanelProps {
  agents: AgentState[];
  battleId: string;
  /** Pass winner info to switch to settlement view when battle ends. */
  winner?: {
    winnerId: string;
    winnerName: string;
    totalEpochs: number;
  } | null;
  /** Lobby tier (optional, defaults to allow betting). */
  tier?: 'FREE' | 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD';
  /** WebSocket events stream (for listening to agent_death events). */
  events?: BattleEvent[];
  /** On-chain settlement transaction hashes (from battle_end event or API). */
  settlementTxs?: SettlementTxs;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BettingPanel({
  agents,
  battleId,
  winner,
  tier,
  events = [],
  settlementTxs,
}: BettingPanelProps) {
  // ── Wallet state ──
  const { address, isConnected } = useAccount();

  // ── Local UI state ──
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [betSuccess, setBetSuccess] = useState(false);

  // ── Odds history tracking ──
  const previousOddsRef = useRef<Record<string, number>>({});
  const oddsHistoryRef = useRef<Record<string, number[]>>({});

  // ── Fetch live odds from API (with user shares if connected) ──
  const oddsUrl = useMemo(() => {
    return isConnected && address
      ? `/battle/${battleId}/odds?user=${address}`
      : `/battle/${battleId}/odds`;
  }, [battleId, isConnected, address]);

  const { data: oddsData, loading: oddsLoading, refetch: refetchOdds } = useFetch<OddsResponse>(
    oddsUrl,
    { pollInterval: 15_000 },
  );

  // ── Fetch user bets from API ──
  const {
    data: userBetsData,
    loading: userBetsLoading,
    refetch: refetchUserBets,
  } = useFetch<UserBetsResponse>(
    `/user/${address}/bets?battleId=${battleId}`,
    { skip: !isConnected || !address },
  );

  const aliveAgents = useMemo(() => agents.filter((a) => a.alive), [agents]);
  const deadAgents = useMemo(() => agents.filter((a) => !a.alive), [agents]);

  // ── Tier-based betting check ──
  // Tier configs (hardcoded to match backend src/arena/tiers.ts)
  const TIER_BETTING_ENABLED: Record<string, boolean> = {
    FREE: true,
    IRON: true,
    BRONZE: true,
    SILVER: true,
    GOLD: true,
  };
  const bettingAllowed = tier ? TIER_BETTING_ENABLED[tier] ?? true : true;

  // ── Track alive count and refetch odds when an agent dies ──
  // Primary trigger: WebSocket agent_death events for immediate response.
  // Fallback trigger: aliveAgents.length change (epoch_end updates).
  // When an agent dies, refetch odds immediately to show updated probabilities
  // without waiting for the next 15s poll interval or epoch_end event.
  const lastDeathEventIndexRef = useRef(-1);
  useEffect(() => {
    // Find the latest agent_death event we haven't processed yet
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'agent_death' && i > lastDeathEventIndexRef.current) {
        // New death event detected — refetch odds immediately
        refetchOdds();
        lastDeathEventIndexRef.current = i;
        break;
      }
    }
  }, [events, refetchOdds]);

  // Fallback: Track alive count changes from epoch_end updates
  const aliveCountRef = useRef(aliveAgents.length);
  useEffect(() => {
    // Skip initial mount (first render when data loads)
    if (aliveCountRef.current === 0 && aliveAgents.length > 0) {
      aliveCountRef.current = aliveAgents.length;
      return;
    }

    // If alive count decreased, an agent died — refetch odds immediately
    if (aliveAgents.length < aliveCountRef.current) {
      refetchOdds();
    }

    aliveCountRef.current = aliveAgents.length;
  }, [aliveAgents.length, refetchOdds]);

  // ── Derive odds + track history ──
  const agentOdds = useMemo(() => {
    const apiOdds = oddsData?.odds ?? {};
    const userShares = oddsData?.userShares ?? {};
    // Dynamic fallback: equal odds = N alive agents (1/N probability)
    const equalOddsMultiplier = aliveAgents.length > 0 ? aliveAgents.length : 5.0;
    return aliveAgents.map((agent) => {
      const multiplier = apiOdds[agent.id]?.decimal ?? equalOddsMultiplier;
      const price = apiOdds[agent.id]?.price ?? (1 / equalOddsMultiplier);
      const totalShares = apiOdds[agent.id]?.totalShares ?? 0;
      return {
        ...agent,
        odds: multiplier,
        impliedProbability: (1 / multiplier) * 100,
        price,
        totalShares,
        userShares: userShares[agent.id] ?? 0,
      };
    });
  }, [aliveAgents, oddsData]);

  // Track previous odds and history when odds change
  useEffect(() => {
    if (!oddsData?.odds) return;

    const rawOdds = oddsData.odds;

    // Extract decimal multipliers into a flat map for tracking
    const currentDecimalOdds: Record<string, number> = {};
    for (const [agentId, entry] of Object.entries(rawOdds)) {
      currentDecimalOdds[agentId] = entry.decimal;
    }

    // Store previous odds before updating
    previousOddsRef.current = { ...currentDecimalOdds };

    // Append to history (cap at 20 data points)
    for (const [agentId, odds] of Object.entries(currentDecimalOdds)) {
      if (!oddsHistoryRef.current[agentId]) {
        oddsHistoryRef.current[agentId] = [];
      }
      const hist = oddsHistoryRef.current[agentId];
      // Only append if value actually changed or first entry
      if (hist.length === 0 || hist[hist.length - 1] !== odds) {
        hist.push(odds);
        if (hist.length > 20) hist.shift();
      }
    }
  }, [oddsData]);

  // ── Resolve user bets with agent names ──
  const myBets = useMemo(() => {
    if (!userBetsData?.bets) return [];
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    return userBetsData.bets.map((bet) => {
      const agent = agentMap.get(bet.agent_id);
      const agentOddsEntry = agentOdds.find((a) => a.id === bet.agent_id);
      return {
        ...bet,
        agentName: agent?.name ?? bet.agent_id.slice(0, 8),
        agentClass: agent?.class as AgentClass | undefined,
        currentOdds: agentOddsEntry?.odds ?? 1,
      };
    });
  }, [userBetsData, agents, agentOdds]);

  // ── Selected agent for bet slip ──
  const selectedBetSlipAgent: BetSlipAgent | null = useMemo(() => {
    if (!selectedAgentId) return null;
    const entry = agentOdds.find((a) => a.id === selectedAgentId);
    if (!entry) return null;
    return {
      id: entry.id,
      name: entry.name,
      class: entry.class,
      odds: entry.odds,
      impliedProbability: entry.impliedProbability,
      price: entry.price,
      totalShares: entry.totalShares,
      userShares: entry.userShares,
      hp: entry.hp,
      maxHp: entry.maxHp,
      alive: entry.alive,
    };
  }, [selectedAgentId, agentOdds]);

  // ── Handle bet success ──
  function handleBetSuccess() {
    setSelectedAgentId("");
    setBetSuccess(true);
    refetchUserBets();
    setTimeout(() => setBetSuccess(false), 3000);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SETTLEMENT VIEW (battle over)
  // ═══════════════════════════════════════════════════════════════════════
  if (winner) {
    return (
      <SettlementView
        winner={winner}
        agents={agents}
        bets={myBets.map((b) => ({
          id: b.id,
          agent_id: b.agent_id,
          agentName: b.agentName,
          agentClass: b.agentClass,
          amount: b.amount,
          payout: b.payout,
          settled: b.settled,
        }))}
        totalPool={oddsData?.totalPool ?? 0}
        settlementTxs={settlementTxs}
      />
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ACTIVE BATTLE VIEW
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* ------- ODDS TABLE with change indicators ------- */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
            Live Odds
          </h2>
          {oddsData && (
            <span className="text-[10px] text-gray-600">
              Pool: {oddsData.totalPool.toFixed(0)} $HNADS
            </span>
          )}
        </div>
        {oddsLoading && !oddsData ? (
          <p className="text-xs text-gray-600 animate-pulse">
            Loading odds...
          </p>
        ) : (
          <div className="space-y-1.5">
            {agentOdds.map((agent) => {
              const cfg = CLASS_CONFIG[agent.class];
              const prevOdds =
                previousOddsRef.current[agent.id] ?? null;
              const history =
                oddsHistoryRef.current[agent.id] ?? [];
              const isSelected = selectedAgentId === agent.id;

              return (
                <button
                  key={agent.id}
                  onClick={() =>
                    bettingAllowed && setSelectedAgentId(
                      isSelected ? "" : agent.id,
                    )
                  }
                  disabled={!bettingAllowed}
                  className={`w-full flex items-center justify-between rounded border px-3 py-3 text-xs transition-all sm:py-2 ${
                    isSelected
                      ? "border-gold/50 bg-gold/10 ring-1 ring-gold/20"
                      : !bettingAllowed
                        ? "border-colosseum-surface-light bg-colosseum-bg/30 opacity-60 cursor-not-allowed"
                        : "border-colosseum-surface-light bg-colosseum-bg/50 hover:border-gray-600 hover:bg-colosseum-bg/80"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentPortrait
                      image={cfg.image}
                      emoji={cfg.emoji}
                      alt={agent.name}
                      size="w-6 h-6"
                      className="text-base flex-shrink-0"
                    />
                    <span className="font-bold text-white truncate">
                      {agent.name}
                    </span>
                    <span className={`hidden sm:inline ${cfg.badgeClass}`}>
                      {agent.class}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 sm:gap-2">
                    {/* Odds sparkline (hidden on very small screens) */}
                    {history.length >= 2 && (
                      <span className="hidden sm:inline">
                        <OddsSparkline
                          history={history}
                          width={48}
                          height={16}
                        />
                      </span>
                    )}
                    {/* Change indicator */}
                    <OddsIndicator
                      currentOdds={agent.odds}
                      previousOdds={prevOdds}
                    />
                    {/* User shares (if any) */}
                    {agent.userShares > 0 && (
                      <span className="hidden text-xs text-green-400 sm:inline">
                        {agent.userShares.toFixed(0)} shares
                      </span>
                    )}
                    {/* Price (primary display) */}
                    <span className="min-w-[3.5rem] rounded bg-gold/20 px-2 py-0.5 text-center font-bold text-gold">
                      ${agent.price.toFixed(2)}
                    </span>
                    {/* Odds multiplier (secondary, smaller) */}
                    <span className="hidden text-[10px] text-gray-500 sm:inline">
                      {agent.odds.toFixed(1)}x
                    </span>
                  </div>
                </button>
              );
            })}

            {/* Eliminated agents */}
            {deadAgents.length > 0 && (
              <div className="mt-3 border-t border-colosseum-surface-light pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  Eliminated ({deadAgents.length})
                </p>
                <div className="space-y-1">
                  {deadAgents.map((agent) => {
                    const cfg = CLASS_CONFIG[agent.class];
                    return (
                      <div
                        key={agent.id}
                        className="flex w-full items-center justify-between rounded border border-colosseum-surface-light/50 bg-colosseum-bg/30 px-3 py-2 text-xs opacity-50"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <AgentPortrait
                            image={cfg.image}
                            emoji={cfg.emoji}
                            alt={agent.name}
                            size="w-6 h-6"
                            className="text-base flex-shrink-0 grayscale"
                          />
                          <span className="font-bold text-gray-500 truncate line-through">
                            {agent.name}
                          </span>
                        </div>
                        <span className="rounded bg-blood/20 px-2 py-0.5 text-[10px] font-bold uppercase text-blood">
                          REKT
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------- BET SLIP ------- */}
      <div className="border-t border-colosseum-surface-light pt-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-500">
          Bet Slip
        </h2>

        {betSuccess && (
          <div className="mb-2 rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-center text-xs text-green-400">
            Bet placed successfully!
          </div>
        )}

        {!bettingAllowed ? (
          <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg/30 p-4">
            <p className="text-center text-xs text-gray-600">
              Betting is not available for {tier} tier battles
            </p>
          </div>
        ) : (
          <BetSlip
            agent={selectedBetSlipAgent}
            battleId={battleId}
            onClear={() => setSelectedAgentId("")}
            onSuccess={handleBetSuccess}
          />
        )}
      </div>

      {/* ------- MY ACTIVE BETS ------- */}
      {isConnected && (
        <div className="border-t border-colosseum-surface-light pt-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-500">
            Your Bets
          </h2>
          {userBetsLoading ? (
            <p className="text-xs text-gray-600 animate-pulse">
              Loading bets...
            </p>
          ) : myBets.length === 0 ? (
            <p className="text-xs text-gray-600">No bets placed yet</p>
          ) : (
            <div className="space-y-1.5">
              {myBets.map((bet) => {
                const cfg = bet.agentClass
                  ? CLASS_CONFIG[bet.agentClass]
                  : null;
                const estimatedPayout = bet.amount * bet.currentOdds;
                return (
                  <div
                    key={bet.id}
                    className="rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {cfg && (
                          <AgentPortrait
                            image={cfg.image}
                            emoji={cfg.emoji}
                            alt={bet.agentName}
                            size="w-5 h-5"
                            className="text-sm"
                          />
                        )}
                        <span className="font-bold text-white">
                          {bet.agentName}
                        </span>
                      </div>
                      <span className="text-gold font-bold">
                        {bet.currentOdds.toFixed(2)}x
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-gray-600">
                      <span>Staked: {bet.amount} $HNADS</span>
                      <span className="text-gray-500">
                        Payout: {estimatedPayout.toFixed(0)} $HNADS
                      </span>
                    </div>
                  </div>
                );
              })}
              {/* Total wagered summary */}
              {myBets.length > 1 && (
                <div className="flex items-center justify-between rounded bg-colosseum-bg/30 px-3 py-1.5 text-[10px]">
                  <span className="uppercase tracking-wider text-gray-600">
                    Total wagered
                  </span>
                  <span className="font-bold text-gray-400">
                    {myBets
                      .reduce((sum, b) => sum + b.amount, 0)
                      .toFixed(0)}{" "}
                    $HNADS
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
