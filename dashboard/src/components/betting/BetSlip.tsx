"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BetSlipAgent {
  id: string;
  name: string;
  class: AgentClass;
  odds: number;
  impliedProbability: number;
  price: number; // Share price ($0.XX format)
  totalShares: number; // Total shares bought for this agent
  userShares: number; // User's current shares for this agent
  hp: number;
  maxHp: number;
  alive: boolean;
}

interface BetSlipProps {
  agent: BetSlipAgent | null;
  battleId: string;
  onClear: () => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Quick amount presets
// ---------------------------------------------------------------------------
const QUICK_AMOUNTS = [10, 25, 50, 100];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function BetSlip({
  agent,
  battleId,
  onClear,
  onSuccess,
}: BetSlipProps) {
  const { address, isConnected } = useAccount();

  const [betAmount, setBetAmount] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [lastBetShares, setLastBetShares] = useState<number | null>(null);

  const parsedAmount = parseFloat(betAmount);

  // Calculate shares: amount / price
  const shares = agent && !isNaN(parsedAmount) && parsedAmount > 0
    ? parsedAmount / agent.price
    : 0;

  // Estimated payout: shares * $1.00 (full payout if agent wins)
  const estimatedPayout = shares * 1.0;

  // Legacy odds-based payout (for comparison/validation)
  const potentialPayout =
    agent && !isNaN(parsedAmount) && parsedAmount > 0
      ? parsedAmount * agent.odds
      : 0;
  const netProfit = potentialPayout - (isNaN(parsedAmount) ? 0 : parsedAmount);

  const validate = useCallback((): boolean => {
    if (!agent) {
      setError("Select a gladiator first");
      return false;
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a valid bet amount");
      return false;
    }
    if (parsedAmount < 1) {
      setError("Minimum bet is 1 $HNADS");
      return false;
    }
    setError("");
    return true;
  }, [agent, parsedAmount]);

  function handlePlaceBet() {
    if (!validate()) return;
    setShowConfirm(true);
  }

  async function confirmBet() {
    setError("");
    setIsPending(true);
    const API_BASE =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
    const currentShares = shares; // Capture shares before clearing
    try {
      const res = await fetch(`${API_BASE}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          battleId,
          userAddress: address,
          agentId: agent!.id,
          amount: parsedAmount,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? `HTTP ${res.status}`,
        );
      }

      setLastBetShares(currentShares); // Store shares for success message
      setBetAmount("");
      setShowConfirm(false);
      onSuccess();
      // Clear shares message after 5s
      setTimeout(() => setLastBetShares(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setShowConfirm(false);
    } finally {
      setIsPending(false);
    }
  }

  const isSubmitting = isPending;

  // ── Empty state ──
  if (!agent) {
    return (
      <div className="rounded-lg border border-dashed border-colosseum-surface-light bg-colosseum-bg/30 p-4">
        <p className="text-center text-xs text-gray-600">
          Select a gladiator from the odds table to place a bet
        </p>
      </div>
    );
  }

  const cfg = CLASS_CONFIG[agent.class];

  return (
    <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-surface/50 overflow-hidden">
      {/* Header with agent info */}
      <div className="flex items-center justify-between border-b border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <AgentPortrait
            image={cfg.image}
            emoji={cfg.emoji}
            alt={agent.name}
            size="w-6 h-6"
            className="text-base"
          />
          <div>
            <div className="text-xs font-bold text-white">{agent.name}</div>
            <div className={`text-[10px] ${cfg.color}`}>{agent.class}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-gold/20 px-2 py-0.5 text-xs font-bold text-gold">
            ${agent.price.toFixed(2)}
          </span>
          <span className="text-[10px] text-gray-500">
            {agent.odds.toFixed(1)}x
          </span>
          <button
            onClick={() => {
              onClear();
              setBetAmount("");
              setError("");
              setShowConfirm(false);
            }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] -m-2 text-gray-600 transition-colors hover:text-white"
            aria-label="Remove selection"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
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
        </div>
      </div>

      {/* Bet form */}
      <div className="p-3 space-y-3">
        {/* Success message with shares */}
        {lastBetShares !== null && (
          <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-center text-xs text-green-400">
            Bet placed! You received <span className="font-bold">{lastBetShares.toFixed(2)} shares</span>
          </div>
        )}

        {/* Amount input */}
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-600">
            Stake ($HNADS)
          </label>
          <div className="relative">
            <input
              type="number"
              min="1"
              step="1"
              placeholder="0"
              value={betAmount}
              onChange={(e) => {
                setBetAmount(e.target.value);
                setError("");
                setShowConfirm(false);
              }}
              className="w-full rounded border border-colosseum-surface-light bg-colosseum-bg px-3 min-h-[44px] py-2 pr-16 text-base text-white outline-none focus:border-gold transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-gray-600">
              $HNADS
            </span>
          </div>
        </div>

        {/* Quick amount buttons */}
        <div className="flex gap-1.5">
          {QUICK_AMOUNTS.map((amt) => (
            <button
              key={amt}
              onClick={() => {
                setBetAmount(String(amt));
                setError("");
                setShowConfirm(false);
              }}
              className={`flex-1 rounded border min-h-[44px] py-2.5 text-xs font-bold uppercase tracking-wider transition-colors sm:min-h-0 sm:py-1.5 sm:text-[10px] ${
                betAmount === String(amt)
                  ? "border-gold bg-gold/20 text-gold"
                  : "border-colosseum-surface-light bg-colosseum-bg text-gray-500 hover:border-gray-600 hover:text-gray-400"
              }`}
            >
              {amt}
            </button>
          ))}
        </div>

        {/* Shares & Payout breakdown */}
        {shares > 0 && agent && (
          <div className="space-y-1 rounded bg-colosseum-bg/80 px-3 py-2">
            <div className="flex items-center justify-between text-[10px] text-gray-500">
              <span>Stake</span>
              <span>{parsedAmount.toFixed(0)} $HNADS</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-500">
              <span>Price per share</span>
              <span>${agent.price.toFixed(2)}</span>
            </div>
            <div className="h-px bg-colosseum-surface-light" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">You'll receive</span>
              <span className="font-bold text-gold">
                {shares.toFixed(2)} shares
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-600">Estimated payout</span>
              <span className="font-bold text-green-400">
                {estimatedPayout.toFixed(2)} $HNADS
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-600">Profit if won</span>
              <span className="font-bold text-green-400">
                +{(estimatedPayout - parsedAmount).toFixed(2)} $HNADS
              </span>
            </div>
            {/* Show current user shares if any */}
            {agent.userShares > 0 && (
              <div className="flex items-center justify-between text-[10px] text-blue-400 pt-1 border-t border-colosseum-surface-light">
                <span>Your current shares</span>
                <span className="font-bold">{agent.userShares.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-blood">{error}</p>}

        {/* Confirmation step */}
        {showConfirm ? (
          <div className="space-y-2">
            <p className="text-center text-[10px] text-gray-400">
              Confirm {parsedAmount} $HNADS on{" "}
              <span className="font-bold text-white">{agent.name}</span>
              <br />
              <span className="text-gold">{shares.toFixed(2)} shares</span> at{" "}
              <span className="text-gold">${agent.price.toFixed(2)}</span> each?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded border border-colosseum-surface-light min-h-[44px] py-3 text-xs font-bold uppercase tracking-wider text-gray-500 transition-colors hover:text-white sm:min-h-0 sm:py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmBet}
                disabled={isSubmitting}
                className="flex-1 rounded bg-green-600 min-h-[44px] py-3 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-green-700 active:scale-[0.98] disabled:opacity-60 sm:min-h-0 sm:py-2"
              >
                {isSubmitting ? "Placing..." : "Confirm"}
              </button>
            </div>
          </div>
        ) : isConnected ? (
          <button
            onClick={handlePlaceBet}
            disabled={isSubmitting}
            className="w-full rounded bg-green-600 min-h-[44px] py-3.5 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-green-700 active:scale-[0.98] disabled:opacity-60 sm:min-h-0 sm:py-2.5"
          >
            {isSubmitting ? "Placing..." : "Place Bet"}
          </button>
        ) : (
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button
                onClick={openConnectModal}
                className="w-full rounded bg-gold/20 min-h-[44px] py-3.5 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/30 sm:min-h-0 sm:py-2.5"
              >
                Connect Wallet
              </button>
            )}
          </ConnectButton.Custom>
        )}
      </div>
    </div>
  );
}
