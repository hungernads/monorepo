import { useState } from "react";
import type { AgentClass } from "@/types";
import { shortenAddress } from "@/lib/utils";

interface RankedAgent {
  rank: number;
  walletAddress: string;
  topClass: AgentClass;
  totalKills: number;
  winRate: number;
  totalBattles: number;
  totalPrizesMon: string;
  totalPrizesHnads: string;
}

interface AgentRankProps {
  agents: RankedAgent[];
}

const CLASS_BADGE: Record<AgentClass, string> = {
  WARRIOR: "badge-warrior",
  TRADER: "badge-trader",
  SURVIVOR: "badge-survivor",
  PARASITE: "badge-parasite",
  GAMBLER: "badge-gambler",
};

export default function AgentRank({ agents }: AgentRankProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyAddress = async (address: string, index: number) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500">
        Top Gladiators
      </h2>
      <div className="space-y-2">
        {agents.map((agent, index) => (
          <div
            key={agent.rank}
            className="flex items-center gap-3 rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2"
          >
            <span
              className={`w-5 text-center text-sm font-bold ${
                agent.rank === 1
                  ? "text-gold"
                  : agent.rank === 2
                    ? "text-gray-300"
                    : agent.rank === 3
                      ? "text-amber-700"
                      : "text-gray-600"
              }`}
            >
              {agent.rank}
            </span>
            <div className="flex-1">
              <button
                onClick={() => handleCopyAddress(agent.walletAddress, index)}
                className="text-sm font-bold text-gray-200 transition-colors hover:text-gold"
                title={`${agent.walletAddress} (click to copy)`}
              >
                {shortenAddress(agent.walletAddress)}
                {copiedIndex === index && (
                  <span className="ml-2 text-[10px] text-green-400">
                    Copied!
                  </span>
                )}
              </button>
              <span className={`ml-2 ${CLASS_BADGE[agent.topClass]}`}>
                {agent.topClass}
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gold">
                {agent.winRate}%
              </span>
              <span className="ml-1 text-[10px] text-gray-600">
                ({agent.totalBattles})
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { RankedAgent };
