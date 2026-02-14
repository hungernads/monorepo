"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import type { AgentState, AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import { useBurnHnads, monadChain } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// Tier definitions (mirrors backend TIER_CONFIGS from src/betting/sponsorship.ts)
// ---------------------------------------------------------------------------

type SponsorTier =
  | "BREAD_RATION"
  | "MEDICINE_KIT"
  | "ARMOR_PLATING"
  | "WEAPON_CACHE"
  | "CORNUCOPIA";

interface TierOption {
  tier: SponsorTier;
  name: string;
  cost: number;
  hpBoost: number;
  freeDefend: boolean;
  attackBoost: number;
  description: string;
  icon: string;
  /** Tailwind text color class. */
  color: string;
  /** Tailwind ring/border color class. */
  ringColor: string;
  /** Tailwind bg accent class. */
  bgAccent: string;
}

const TIER_OPTIONS: TierOption[] = [
  {
    tier: "BREAD_RATION",
    name: "Bread Ration",
    cost: 10,
    hpBoost: 25,
    freeDefend: false,
    attackBoost: 0,
    description: "A humble offering. Keeps the gladiator fighting another round.",
    icon: "\uD83C\uDF5E",
    color: "text-amber-600",
    ringColor: "ring-amber-800/50 border-amber-800/50",
    bgAccent: "bg-amber-900/20",
  },
  {
    tier: "MEDICINE_KIT",
    name: "Medicine Kit",
    cost: 25,
    hpBoost: 75,
    freeDefend: false,
    attackBoost: 0,
    description: "Advanced healing. A second chance from a generous sponsor.",
    icon: "\uD83D\uDC8A",
    color: "text-green-400",
    ringColor: "ring-green-700/50 border-green-700/50",
    bgAccent: "bg-green-900/20",
  },
  {
    tier: "ARMOR_PLATING",
    name: "Armor Plating",
    cost: 50,
    hpBoost: 50,
    freeDefend: true,
    attackBoost: 0,
    description: "Reinforced armor. Defend without paying the blood price.",
    icon: "\uD83D\uDEE1\uFE0F",
    color: "text-blue-400",
    ringColor: "ring-blue-700/50 border-blue-700/50",
    bgAccent: "bg-blue-900/20",
  },
  {
    tier: "WEAPON_CACHE",
    name: "Weapon Cache",
    cost: 75,
    hpBoost: 25,
    freeDefend: false,
    attackBoost: 0.25,
    description: "Superior weaponry. +25% attack damage. The crowd demands blood.",
    icon: "\u2694\uFE0F",
    color: "text-blood-light",
    ringColor: "ring-blood-dark/50 border-blood-dark/50",
    bgAccent: "bg-blood/10",
  },
  {
    tier: "CORNUCOPIA",
    name: "Cornucopia",
    cost: 150,
    hpBoost: 150,
    freeDefend: true,
    attackBoost: 0.25,
    description:
      "The ultimate gift. Full restoration, free defense, and deadly weapons.",
    icon: "\uD83C\uDFC6",
    color: "text-gold",
    ringColor: "ring-gold-dark/50 border-gold-dark/50",
    bgAccent: "bg-gold/10",
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SponsorTierSelectorProps {
  /** Available agents to sponsor. */
  agents: AgentState[];
  /** Battle ID for the API call. */
  battleId: string;
  /** Current epoch number for tier effects. */
  currentEpoch: number;
  /** Callback fired on successful sponsorship submission. */
  onSuccess?: () => void;
  /** Callback to close the parent container/modal. */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SponsorTierSelector({
  agents,
  battleId,
  currentEpoch,
  onSuccess,
  onClose,
}: SponsorTierSelectorProps) {
  const { address, isConnected } = useAccount();
  const { burn, isPending: isBurning, isSuccess: burnSuccess, error: burnError, hash: burnTxHash } = useBurnHnads();

  const [selectedTier, setSelectedTier] = useState<SponsorTier | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [burnStep, setBurnStep] = useState<"idle" | "burning" | "confirming" | "complete">("idle");

  // Wait for burn transaction confirmation
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: burnTxHash,
    chainId: monadChain.id,
  });

  const aliveAgents = useMemo(() => agents.filter((a) => a.alive), [agents]);

  const selectedOption = useMemo(
    () => TIER_OPTIONS.find((t) => t.tier === selectedTier) ?? null,
    [selectedTier],
  );

  // Build effects preview for selected tier
  const effectsPreview = useMemo(() => {
    if (!selectedOption) return null;
    const parts: string[] = [];
    if (selectedOption.hpBoost > 0) parts.push(`+${selectedOption.hpBoost} HP`);
    if (selectedOption.freeDefend) parts.push("Free defend (no HP cost)");
    if (selectedOption.attackBoost > 0)
      parts.push(`+${Math.round(selectedOption.attackBoost * 100)}% ATK damage`);
    return parts;
  }, [selectedOption]);

  async function handleSponsor() {
    if (!selectedTier) {
      setError("Select a tier");
      return;
    }
    if (!selectedAgentId) {
      setError("Select a gladiator to sponsor");
      return;
    }
    if (!isConnected || !address) {
      setError("Connect your wallet first");
      return;
    }

    setError("");
    setSubmitting(true);
    setBurnStep("burning");

    try {
      // Step 1: Burn tokens (transfer to 0xdEaD) for non-BREAD_RATION tiers
      let txHash: string | undefined;
      if (selectedTier !== "BREAD_RATION") {
        burn({ amountHnads: selectedOption!.cost.toString() });

        // Wait for burn transaction to be initiated
        // The useWaitForTransactionReceipt hook will handle confirmation
        return; // Exit here, useEffect will continue after confirmation
      }

      // Step 2: Call API (for BREAD_RATION or after burn confirmation)
      await submitSponsorship(txHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      setBurnStep("idle");
    }
  }

  const submitSponsorship = useCallback(
    async (txHash?: string) => {
      try {
        setBurnStep("complete");

        const apiBase =
          process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

        const res = await fetch(`${apiBase}/sponsor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            battleId,
            agentId: selectedAgentId,
            sponsorAddress: address,
            amount: selectedOption!.cost,
            message: message || "",
            tier: selectedTier,
            epochNumber: currentEpoch + 1, // Tier effects apply next epoch
            txHash,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as Record<string, string>).error ?? `HTTP ${res.status}`,
          );
        }

        setSuccess(true);
        onSuccess?.();

        // Reset after brief success display
        setTimeout(() => {
          setSuccess(false);
          setSelectedTier(null);
          setSelectedAgentId("");
          setMessage("");
          setBurnStep("idle");
          onClose?.();
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [
      battleId,
      selectedAgentId,
      address,
      selectedOption,
      message,
      selectedTier,
      currentEpoch,
      onSuccess,
      onClose,
    ],
  );

  // Auto-submit after burn confirmation
  useEffect(() => {
    if (isConfirmed && burnTxHash && burnStep === "burning") {
      setBurnStep("confirming");
      submitSponsorship(burnTxHash);
    }
  }, [isConfirmed, burnTxHash, burnStep, submitSponsorship]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
          Choose Your Gift
        </h2>
        <p className="mt-0.5 text-[10px] text-gray-600">
          All tokens are 100% burned. The crowd&apos;s sacrifice fuels the arena.
        </p>
      </div>

      {/* Tier cards */}
      <div className="space-y-2">
        {TIER_OPTIONS.map((option) => {
          const isSelected = selectedTier === option.tier;
          return (
            <button
              key={option.tier}
              onClick={() => {
                setSelectedTier(isSelected ? null : option.tier);
                setError("");
              }}
              className={`w-full rounded border px-3 py-2.5 text-left transition-all ${
                isSelected
                  ? `${option.ringColor} ${option.bgAccent} ring-1`
                  : "border-colosseum-surface-light bg-colosseum-bg/50 hover:border-gray-600 hover:bg-colosseum-bg/80"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{option.icon}</span>
                  <div>
                    <span className={`text-xs font-bold ${option.color}`}>
                      {option.name}
                    </span>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                      {option.hpBoost > 0 && (
                        <span>+{option.hpBoost} HP</span>
                      )}
                      {option.freeDefend && <span>Free defend</span>}
                      {option.attackBoost > 0 && (
                        <span>
                          +{Math.round(option.attackBoost * 100)}% ATK
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span
                  className={`text-sm font-bold ${
                    isSelected ? option.color : "text-gold"
                  }`}
                >
                  {option.cost} $HNADS
                </span>
              </div>
              {isSelected && (
                <p className="mt-1.5 text-[11px] italic text-gray-500">
                  {option.description}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Agent selector */}
      {selectedTier && (
        <div className="space-y-3">
          {/* Effects preview */}
          {effectsPreview && effectsPreview.length > 0 && (
            <div
              className={`rounded border px-3 py-2 ${
                selectedOption?.bgAccent ?? "bg-colosseum-bg/50"
              } ${selectedOption?.ringColor ?? "border-colosseum-surface-light"}`}
            >
              <div className="text-[10px] uppercase tracking-wider text-gray-600">
                Effects (applied next epoch)
              </div>
              <ul className="mt-1 space-y-0.5">
                {effectsPreview.map((effect, i) => (
                  <li
                    key={i}
                    className={`text-xs ${selectedOption?.color ?? "text-white"}`}
                  >
                    {effect}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Agent dropdown */}
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-600">
              Gladiator
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => {
                setSelectedAgentId(e.target.value);
                setError("");
              }}
              className="w-full rounded border border-colosseum-surface-light bg-colosseum-bg px-3 py-2 text-sm text-white outline-none transition-colors focus:border-gold"
            >
              <option value="">-- select gladiator --</option>
              {aliveAgents.map((agent) => {
                const cfg = CLASS_CONFIG[agent.class as AgentClass];
                return (
                  <option key={agent.id} value={agent.id}>
                    {cfg.emoji} {agent.name} ({agent.class}) - {agent.hp}/
                    {agent.maxHp} HP
                  </option>
                );
              })}
            </select>
          </div>

          {/* Message */}
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-600">
              Message (optional)
            </label>
            <textarea
              rows={2}
              maxLength={120}
              placeholder="From your loyal fan..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full resize-none rounded border border-colosseum-surface-light bg-colosseum-bg px-3 py-2 text-sm text-white outline-none transition-colors focus:border-gold"
            />
          </div>

          {/* Cost summary */}
          <div className="flex items-center justify-between rounded bg-colosseum-bg/50 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-600">
              Total cost (burned)
            </span>
            <span className="text-sm font-bold text-gold">
              {selectedOption?.cost ?? 0} $HNADS
            </span>
          </div>

          {/* Error */}
          {error && <p className="text-xs text-blood">{error}</p>}

          {/* Burn error */}
          {burnError && (
            <p className="text-xs text-blood">
              Burn failed: {burnError.message}
            </p>
          )}

          {/* Burn status */}
          {burnStep === "burning" && !isConfirming && (
            <div className="rounded border border-gold/30 bg-gold/10 px-3 py-2 text-center text-xs text-gold">
              Confirm the token burn in your wallet...
            </div>
          )}
          {isConfirming && (
            <div className="rounded border border-gold/30 bg-gold/10 px-3 py-2 text-center text-xs text-gold">
              Burning tokens... waiting for confirmation
            </div>
          )}
          {burnTxHash && isConfirmed && (
            <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400">
              <div className="mb-1">Tokens burned successfully!</div>
              <a
                href={`https://testnet.monadexplorer.com/tx/${burnTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] underline hover:text-green-300"
              >
                View transaction {burnTxHash.slice(0, 8)}...{burnTxHash.slice(-6)}
              </a>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-center text-xs text-green-400">
              Sponsorship sent! The arena gods are pleased.
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            {onClose && (
              <button
                onClick={onClose}
                className="flex-1 rounded border border-colosseum-surface-light py-2.5 text-sm font-bold uppercase tracking-wider text-gray-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSponsor}
              disabled={submitting || success || !isConnected || isBurning || isConfirming}
              className={`flex-1 rounded py-2.5 text-sm font-bold uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-60 ${
                selectedOption
                  ? `${selectedOption.bgAccent} ${selectedOption.color} border ${selectedOption.ringColor} hover:brightness-110`
                  : "bg-gold text-colosseum-bg hover:bg-gold-light"
              }`}
            >
              {isBurning || isConfirming
                ? "Burning..."
                : submitting
                  ? "Sending..."
                  : success
                    ? "Sent!"
                    : `Send ${selectedOption?.name ?? "Gift"}`}
            </button>
          </div>

          {!isConnected && (
            <p className="text-center text-[10px] text-gray-600">
              Connect your wallet to sponsor a gladiator
            </p>
          )}
        </div>
      )}
    </div>
  );
}
