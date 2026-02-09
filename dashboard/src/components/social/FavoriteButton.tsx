"use client";

interface FavoriteButtonProps {
  agentId: string;
  isFavorite: boolean;
  onToggle: (agentId: string) => void;
  /** Optional size variant. Defaults to "sm". */
  size?: "sm" | "md";
}

/**
 * Heart icon button for favoriting an agent.
 * Filled red when active, outline when inactive.
 */
export default function FavoriteButton({
  agentId,
  isFavorite,
  onToggle,
  size = "sm",
}: FavoriteButtonProps) {
  const sizeClass = size === "md" ? "h-6 w-6" : "h-4 w-4";
  const btnPad = size === "md" ? "p-1.5" : "p-1";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(agentId);
      }}
      className={`${btnPad} rounded transition-all duration-200 hover:scale-110 active:scale-95 ${
        isFavorite
          ? "text-blood hover:text-blood-light"
          : "text-gray-600 hover:text-gray-400"
      }`}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorite ? "Unfavorite agent" : "Favorite agent"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className={sizeClass}
        fill={isFavorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
        />
      </svg>
    </button>
  );
}
