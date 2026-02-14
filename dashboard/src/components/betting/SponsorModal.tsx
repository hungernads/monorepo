"use client";

import { useEffect, useCallback } from "react";
import type { AgentState } from "@/types";
import SponsorTierSelector from "./SponsorTierSelector";

interface SponsorModalProps {
  open: boolean;
  onClose: () => void;
  agents: AgentState[];
  battleId: string;
  currentEpoch: number;
}

export default function SponsorModal({
  open,
  onClose,
  agents,
  battleId,
  currentEpoch,
}: SponsorModalProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    },
    [open, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal - slides up as bottom sheet on mobile, centered on desktop */}
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-colosseum-surface-light bg-colosseum-surface p-5 shadow-2xl scrollbar-thin sm:max-w-md sm:rounded-lg sm:p-6">
        {/* Drag handle on mobile */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-colosseum-surface-light sm:hidden" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 p-1 text-gray-600 transition-colors hover:text-white sm:p-0"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <h2 className="mb-1 text-lg font-bold tracking-wider text-gold">
          SPONSOR A GLADIATOR
        </h2>
        <p className="mb-5 text-xs text-gray-500">
          Send a parachute drop to keep your champion alive. All tokens are
          burned -- the crowd&apos;s sacrifice is eternal.
        </p>

        {/* Tier selector (replaces legacy amount input) */}
        <SponsorTierSelector
          agents={agents}
          battleId={battleId}
          currentEpoch={currentEpoch}
          onSuccess={onClose}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
