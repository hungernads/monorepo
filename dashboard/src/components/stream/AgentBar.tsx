"use client";

import { CLASS_CONFIG, type BattleAgent } from "@/components/battle/mock-data";

interface StreamAgentBarProps {
  agents: BattleAgent[];
}

/**
 * Compact horizontal agent status bar for stream overlays.
 * Shows all agents in a single row with HP bars, class icons, and status.
 * Designed to sit at the bottom of the screen in OBS.
 */
export default function StreamAgentBar({ agents }: StreamAgentBarProps) {
  return (
    <div className="border-t border-colosseum-surface-light/50 bg-colosseum-bg/85 backdrop-blur-sm">
      <div className="flex items-stretch">
        {agents.map((agent) => {
          const cfg = CLASS_CONFIG[agent.class];
          const isDead = !agent.alive;
          const hpPct = Math.max(0, (agent.hp / agent.maxHp) * 100);

          // HP color
          let hpColor = "#22c55e";
          if (hpPct <= 30) hpColor = "#dc2626";
          else if (hpPct <= 60) hpColor = "#f59e0b";

          return (
            <div
              key={agent.id}
              className={`flex flex-1 items-center gap-2 border-r border-colosseum-surface-light/30 px-3 py-2 last:border-r-0 transition-all duration-300 ${
                isDead
                  ? "opacity-40"
                  : agent.isWinner
                    ? "bg-gold/10"
                    : agent.attacking
                      ? "bg-blood/5"
                      : agent.defending
                        ? "bg-accent/5"
                        : ""
              }`}
            >
              {/* Class icon */}
              <span className="text-lg">{cfg.emoji}</span>

              {/* Name + HP */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span
                    className={`truncate text-xs font-bold tracking-wider ${
                      isDead
                        ? "text-gray-600 line-through"
                        : agent.isWinner
                          ? "text-gold"
                          : "text-white"
                    }`}
                  >
                    {agent.name}
                  </span>
                  <div className="flex items-center gap-1.5 ml-1 shrink-0">
                    {agent.kills > 0 && (
                      <span className="text-[9px] text-blood font-bold">
                        {agent.kills}K
                      </span>
                    )}
                    {isDead && (
                      <span className="text-[8px] font-black tracking-widest text-blood">
                        REKT
                      </span>
                    )}
                    {agent.isWinner && (
                      <span className="text-sm">
                        {"\uD83D\uDC51"}
                      </span>
                    )}
                    {agent.defending && !isDead && (
                      <span className="text-[10px]">
                        {"\uD83D\uDEE1\uFE0F"}
                      </span>
                    )}
                    {agent.attacking && !isDead && (
                      <span className="text-[10px]">
                        {"\u2694\uFE0F"}
                      </span>
                    )}
                  </div>
                </div>

                {/* HP bar */}
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-colosseum-bg">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${hpPct}%`,
                      backgroundColor: hpColor,
                    }}
                  />
                </div>

                {/* HP number */}
                <div className="mt-0.5 text-[9px] font-mono text-gray-600">
                  {agent.hp}/{agent.maxHp}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
