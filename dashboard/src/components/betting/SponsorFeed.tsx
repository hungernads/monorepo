"use client";

import { useMemo, useRef, useEffect } from "react";
import type { AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";
import type { BattleEvent, SponsorBoostEvent } from "@/lib/websocket";

// ---------------------------------------------------------------------------
// Tier visual config (mirrors backend TIER_CONFIGS)
// ---------------------------------------------------------------------------

type SponsorTier =
  | "BREAD_RATION"
  | "MEDICINE_KIT"
  | "ARMOR_PLATING"
  | "WEAPON_CACHE"
  | "CORNUCOPIA";

interface TierVisual {
  name: string;
  cost: number;
  icon: string;
  color: string;
  bgClass: string;
  borderClass: string;
}

const TIER_VISUALS: Record<SponsorTier, TierVisual> = {
  BREAD_RATION: {
    name: "Bread Ration",
    cost: 10,
    icon: "\uD83C\uDF5E", // bread
    color: "text-amber-600",
    bgClass: "bg-amber-900/20",
    borderClass: "border-amber-800/40",
  },
  MEDICINE_KIT: {
    name: "Medicine Kit",
    cost: 25,
    icon: "\uD83D\uDC8A", // pill
    color: "text-green-400",
    bgClass: "bg-green-900/20",
    borderClass: "border-green-700/40",
  },
  ARMOR_PLATING: {
    name: "Armor Plating",
    cost: 50,
    icon: "\uD83D\uDEE1\uFE0F", // shield
    color: "text-blue-400",
    bgClass: "bg-blue-900/20",
    borderClass: "border-blue-700/40",
  },
  WEAPON_CACHE: {
    name: "Weapon Cache",
    cost: 75,
    icon: "\u2694\uFE0F", // swords
    color: "text-blood-light",
    bgClass: "bg-blood/10",
    borderClass: "border-blood-dark/40",
  },
  CORNUCOPIA: {
    name: "Cornucopia",
    cost: 150,
    icon: "\uD83C\uDFC6", // trophy
    color: "text-gold",
    bgClass: "bg-gold/10",
    borderClass: "border-gold-dark/40",
  },
};

function getTierVisual(tier: string): TierVisual {
  return (
    TIER_VISUALS[tier as SponsorTier] ?? {
      name: tier,
      cost: 0,
      icon: "\uD83C\uDF81",
      color: "text-gray-400",
      bgClass: "bg-gray-800/20",
      borderClass: "border-gray-700/40",
    }
  );
}

// ---------------------------------------------------------------------------
// Sponsor feed entry type
// ---------------------------------------------------------------------------

interface SponsorEntry {
  id: string;
  sponsor: string;
  agentId: string;
  agentName: string;
  agentClass?: AgentClass;
  tier: string;
  amount: number;
  hpBoost: number;
  freeDefend: boolean;
  attackBoost: number;
  message?: string;
  timestamp: number;
  isNew?: boolean;
}

// ---------------------------------------------------------------------------
// Mock data (dev fallback)
// ---------------------------------------------------------------------------

const mockNow = new Date("2026-02-08T12:00:00Z").getTime();

const MOCK_SPONSORS: SponsorEntry[] = [
  {
    id: "s-1",
    sponsor: "0xdead...beef",
    agentId: "agent-5",
    agentName: "MADLAD",
    agentClass: "GAMBLER",
    tier: "WEAPON_CACHE",
    amount: 75,
    hpBoost: 25,
    freeDefend: false,
    attackBoost: 0.25,
    message: "Let the chaos reign!",
    timestamp: mockNow - 230_000,
  },
  {
    id: "s-2",
    sponsor: "0x1234...abcd",
    agentId: "agent-1",
    agentName: "BLOODFANG",
    agentClass: "WARRIOR",
    tier: "CORNUCOPIA",
    amount: 150,
    hpBoost: 150,
    freeDefend: true,
    attackBoost: 0.25,
    message: "Destroy them all.",
    timestamp: mockNow - 480_000,
  },
  {
    id: "s-3",
    sponsor: "0xfade...7777",
    agentId: "agent-3",
    agentName: "IRONSHELL",
    agentClass: "SURVIVOR",
    tier: "ARMOR_PLATING",
    amount: 50,
    hpBoost: 50,
    freeDefend: true,
    attackBoost: 0,
    timestamp: mockNow - 720_000,
  },
  {
    id: "s-4",
    sponsor: "0xc0de...0000",
    agentId: "agent-2",
    agentName: "ALPHABOT",
    agentClass: "TRADER",
    tier: "BREAD_RATION",
    amount: 10,
    hpBoost: 25,
    freeDefend: false,
    attackBoost: 0,
    message: "Trust the data.",
    timestamp: mockNow - 900_000,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function truncateAddress(addr: string): string {
  if (addr.includes("...")) return addr;
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Build effect summary string for a sponsor entry. */
function effectsSummary(entry: SponsorEntry): string {
  const parts: string[] = [];
  if (entry.hpBoost > 0) parts.push(`+${entry.hpBoost} HP`);
  if (entry.freeDefend) parts.push("Free defend");
  if (entry.attackBoost > 0) parts.push(`+${Math.round(entry.attackBoost * 100)}% ATK`);
  return parts.join(" / ");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SponsorFeedProps {
  /** WebSocket events to extract sponsor_boost from. */
  events?: BattleEvent[];
  /** Agent metadata for resolving names/classes. */
  agentMeta?: Map<string, { name: string; class: AgentClass }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SponsorFeed({ events, agentMeta }: SponsorFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDev = process.env.NODE_ENV === "development";

  // Extract sponsor entries from WebSocket events
  const entries: SponsorEntry[] = useMemo(() => {
    if (!events || events.length === 0) {
      if (isDev) return MOCK_SPONSORS;
      return [];
    }

    const sponsorEvents = events.filter(
      (e): e is SponsorBoostEvent => e.type === "sponsor_boost",
    );

    if (sponsorEvents.length === 0 && isDev) return MOCK_SPONSORS;

    return sponsorEvents.map((event, i) => {
      const meta = agentMeta?.get(event.data.agentId);
      return {
        id: `sponsor-ws-${i}`,
        sponsor: event.data.sponsorAddress
          ? truncateAddress(event.data.sponsorAddress)
          : "Anonymous",
        agentId: event.data.agentId,
        agentName: meta?.name ?? event.data.agentId.slice(0, 8),
        agentClass: meta?.class as AgentClass | undefined,
        tier: event.data.tier,
        amount: event.data.amount ?? getTierVisual(event.data.tier).cost,
        hpBoost: event.data.actualBoost,
        freeDefend: event.data.freeDefend,
        attackBoost: event.data.attackBoost,
        message: event.data.message || undefined,
        timestamp: Date.now() - (sponsorEvents.length - i) * 1000,
        isNew: i === sponsorEvents.length - 1,
      };
    });
  }, [events, agentMeta, isDev]);

  // Total burned
  const totalBurned = useMemo(
    () => entries.reduce((sum, e) => sum + e.amount, 0),
    [entries],
  );

  // Auto-scroll to top when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  return (
    <div>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-600">
          No sponsorships yet. Be the first to send a parachute drop!
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-56 space-y-2 overflow-y-auto scrollbar-thin"
        >
          {[...entries].reverse().map((entry) => {
            const tierVis = getTierVisual(entry.tier);
            const agentCfg = entry.agentClass
              ? CLASS_CONFIG[entry.agentClass]
              : null;
            const effects = effectsSummary(entry);

            return (
              <div
                key={entry.id}
                className={`rounded border px-3 py-2 transition-all ${
                  entry.isNew
                    ? `animate-sponsor-enter ${tierVis.borderClass} ${tierVis.bgClass}`
                    : "border-colosseum-surface-light bg-colosseum-bg/50"
                }`}
              >
                {/* Row 1: tier icon + amount + agent name + time */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {/* Tier badge */}
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${tierVis.bgClass} ${tierVis.color}`}
                    >
                      <span>{tierVis.icon}</span>
                      <span>{tierVis.name}</span>
                    </span>
                    <span className="text-gray-600">to</span>
                    <span
                      className={`font-bold ${agentCfg?.color ?? "text-white"}`}
                    >
                      {agentCfg && (
                        <AgentPortrait
                          image={agentCfg.image}
                          emoji={agentCfg.emoji}
                          alt={entry.agentName}
                          size="w-4 h-4"
                          className="mr-0.5 inline-block text-xs"
                        />
                      )}
                      {entry.agentName}
                    </span>
                  </div>
                  <span
                    className="text-[10px] text-gray-700"
                    suppressHydrationWarning
                  >
                    {timeAgo(entry.timestamp)}
                  </span>
                </div>

                {/* Row 2: burn amount + effects + sponsor address */}
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="font-bold text-gold">
                      {entry.amount} $HNADS
                    </span>
                    {effects && (
                      <span className="text-gray-500">{effects}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-600">
                    from {entry.sponsor}
                  </span>
                </div>

                {/* Row 3: message (if any) */}
                {entry.message && (
                  <p className="mt-1 text-[11px] italic text-gray-500">
                    &quot;{entry.message}&quot;
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
