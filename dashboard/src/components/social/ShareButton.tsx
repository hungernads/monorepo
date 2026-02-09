"use client";

import type { BattleAgent } from "@/components/battle/mock-data";

interface ShareButtonProps {
  battleId: string;
  winner?: { winnerName: string; totalEpochs: number } | null;
  agents: BattleAgent[];
}

/**
 * Generates a tweet-ready URL and opens X/Twitter share intent.
 * Auto-generates a battle summary with winner info and agent stats.
 */
export default function ShareButton({
  battleId,
  winner,
  agents,
}: ShareButtonProps) {
  const handleShare = () => {
    const aliveCount = agents.filter((a) => a.alive).length;
    const topKiller = agents.reduce((best, a) =>
      a.kills > (best?.kills ?? 0) ? a : best,
    );

    let text: string;

    if (winner) {
      // Battle finished
      text = [
        `BATTLE #${battleId} - FINISHED`,
        "",
        `${winner.winnerName} is the LAST NAD STANDING after ${winner.totalEpochs} epochs!`,
        topKiller.kills > 0
          ? `Top killer: ${topKiller.name} (${topKiller.kills} kills)`
          : "",
        "",
        "May the nads be ever in your favor.",
        "",
        "#HUNGERNADS #Monad @HungerNads",
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      // Battle in progress
      text = [
        `BATTLE #${battleId} - LIVE NOW`,
        "",
        `${aliveCount}/${agents.length} gladiators still standing!`,
        topKiller.kills > 0
          ? `Current top killer: ${topKiller.name} (${topKiller.kills} kills)`
          : "",
        "",
        "Watch the carnage live:",
        "",
        "#HUNGERNADS #Monad @HungerNads",
      ]
        .filter(Boolean)
        .join("\n");
    }

    // Construct the battle URL (current page)
    const battleUrl =
      typeof window !== "undefined"
        ? window.location.href
        : `https://hungernads.xyz/battle/${battleId}`;

    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(battleUrl)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer,width=550,height=420");
  };

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 rounded border border-colosseum-surface-light bg-colosseum-surface px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-gray-400 transition-all hover:border-gray-500 hover:text-white active:scale-[0.97]"
      title="Share to X / Twitter"
    >
      {/* X (Twitter) icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3.5 w-3.5"
      >
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      <span>Share</span>
    </button>
  );
}
