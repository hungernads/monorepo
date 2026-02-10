"use client";

import type { AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LobbyAgentData {
  id: string;
  name: string;
  class: string;
  imageUrl?: string;
  position: number;
}

interface LobbyAgentSlotProps {
  /** The agent occupying this slot, or null if empty. */
  agent: LobbyAgentData | null;
  /** 1-based slot number. */
  slotNumber: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LobbyAgentSlot({
  agent,
  slotNumber,
}: LobbyAgentSlotProps) {
  if (!agent) {
    return (
      <div className="group flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-colosseum-surface-light bg-colosseum-surface/50 px-3 py-5 transition-colors hover:border-gray-600">
        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full border border-colosseum-surface-light bg-colosseum-bg/50">
          <span className="text-2xl text-gray-700">?</span>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">
          Slot #{slotNumber}
        </span>
        <span className="mt-0.5 text-[10px] text-gray-700">
          Awaiting gladiator...
        </span>
      </div>
    );
  }

  const agentClass = agent.class as AgentClass;
  const cfg = CLASS_CONFIG[agentClass] ?? CLASS_CONFIG.WARRIOR;

  return (
    <div
      className={`group relative flex flex-col items-center rounded-lg border-2 ${cfg.borderColor} ${cfg.bgColor} px-3 py-5 transition-all duration-300`}
      style={{
        animation: "feed-enter 0.4s ease-out forwards",
      }}
    >
      {/* Glow effect on the border */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg opacity-30"
        style={{
          boxShadow: `inset 0 0 20px rgba(245,158,11,0.1), 0 0 12px rgba(245,158,11,0.08)`,
        }}
      />

      {/* Portrait */}
      <div className="relative mb-2">
        {agent.imageUrl ? (
          <img
            src={agent.imageUrl}
            alt={agent.name}
            className="h-14 w-14 rounded-full border-2 border-gold/40 object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <div className={agent.imageUrl ? "hidden" : ""}>
          <AgentPortrait
            image={cfg.image}
            emoji={cfg.emoji}
            alt={agent.name}
            size="w-14 h-14"
            className="rounded-full border-2 border-gold/40"
          />
        </div>
      </div>

      {/* Name */}
      <span className="mb-1 max-w-full truncate text-sm font-bold uppercase tracking-wide text-gray-100">
        {agent.name}
      </span>

      {/* Class badge */}
      <span
        className={`${cfg.badgeClass} inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase`}
      >
        {agentClass}
      </span>

      {/* Slot number */}
      <span className="mt-1.5 text-[9px] text-gray-600">
        #{slotNumber}
      </span>
    </div>
  );
}
