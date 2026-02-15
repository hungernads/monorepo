import Link from "next/link";
import type { AgentClass } from "@/types";

interface RecentResult {
  battleId: string;
  winnerName: string;
  winnerClass: AgentClass;
  killCount: number;
  durationEpochs: number;
  endedAt: number;
}

interface RecentResultsProps {
  results: RecentResult[];
}

const CLASS_BADGE: Record<AgentClass, string> = {
  WARRIOR: "badge-warrior",
  TRADER: "badge-trader",
  SURVIVOR: "badge-survivor",
  PARASITE: "badge-parasite",
  GAMBLER: "badge-gambler",
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function RecentResults({ results }: RecentResultsProps) {
  return (
    <div className="card">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500">
        Recent Battles
      </h2>
      <div className="space-y-3">
        {results.map((r) => (
          <div
            key={r.battleId}
            className="flex flex-col gap-1.5 rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href={`/battle/${r.battleId}`}
                className="text-xs text-gray-600 flex-shrink-0 hover:text-gold transition-colors"
              >
                #{r.battleId.slice(0, 8)}
              </Link>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-gray-200 truncate">
                  {r.winnerName}
                </span>
                <span className={`flex-shrink-0 ${CLASS_BADGE[r.winnerClass]}`}>
                  {r.winnerClass}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-gray-500 sm:gap-4 sm:text-xs">
              <span>{r.killCount} kills</span>
              <span>{r.durationEpochs} epochs</span>
              <span suppressHydrationWarning>{timeAgo(r.endedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { RecentResult };
