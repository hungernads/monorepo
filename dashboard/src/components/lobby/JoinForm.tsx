"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEther } from "viem";
import type { AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";
import { ARENA_ADDRESS, HNADS_TOKEN_ADDRESS, monadChain } from "@/lib/wallet";
import { battleIdToBytes32, useFeePaid, useHnadsFeePaid } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JoinFormProps {
  battleId: string;
  onJoined: (agentId: string) => void;
  disabled?: boolean; // true when lobby is full or user already joined
  feeAmount?: string; // MON entry fee (e.g. "10"), '0' or undefined = free
  hnadsFeeAmount?: string; // $HNADS entry fee (e.g. "100"), '0' or undefined = none
}

/** Short class descriptions shown under each class button */
const CLASS_DESCRIPTIONS: Record<AgentClass, string> = {
  WARRIOR: "Aggressive, high-risk stakes. Kills or dies trying.",
  TRADER: "TA-based prediction. Ignores combat.",
  SURVIVOR: "Tiny stakes, outlast everyone. Turtles to victory.",
  PARASITE: "Copies the best performer. Needs hosts alive.",
  GAMBLER: "Random everything. Wildcard chaos.",
};

const AGENT_CLASSES: AgentClass[] = [
  "WARRIOR",
  "TRADER",
  "SURVIVOR",
  "PARASITE",
  "GAMBLER",
];

const NAME_REGEX = /^[a-zA-Z0-9_]{1,12}$/;
const MAX_NAME_LENGTH = 12;

// ---------------------------------------------------------------------------
// ABIs (minimal, only functions used by this component)
// ---------------------------------------------------------------------------

/** Arena contract ABI: payEntryFee + depositHnadsFee + getBattleAgents */
const arenaFeeAbi = [
  {
    type: 'function' as const,
    name: 'payEntryFee' as const,
    stateMutability: 'payable' as const,
    inputs: [{ name: '_battleId', type: 'bytes32' as const }],
    outputs: [],
  },
  {
    type: 'function' as const,
    name: 'depositHnadsFee' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: '_battleId', type: 'bytes32' as const },
      { name: '_amount', type: 'uint256' as const },
    ],
    outputs: [],
  },
  {
    type: 'function' as const,
    name: 'getBattleAgents' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: '_battleId', type: 'bytes32' as const }],
    outputs: [{ name: '', type: 'uint256[]' as const }],
  },
] as const;

/** ERC20 approve ABI */
const erc20ApproveAbi = [
  {
    type: 'function' as const,
    name: 'approve' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'spender', type: 'address' as const },
      { name: 'amount', type: 'uint256' as const },
    ],
    outputs: [{ name: '', type: 'bool' as const }],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function formatTxError(txError: Error | null): string {
  if (!txError) return "";
  const msg = txError.message;
  if (msg.includes("User rejected") || msg.includes("user rejected")) {
    return "Transaction rejected";
  }
  if (msg.includes("insufficient") || msg.includes("exceeds balance")) {
    return "Insufficient balance";
  }
  return "Transaction failed. Try again.";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function JoinForm({
  battleId,
  onJoined,
  disabled = false,
  feeAmount = '0',
  hnadsFeeAmount = '0',
}: JoinFormProps) {
  const [selectedClass, setSelectedClass] = useState<AgentClass | null>(null);
  const [agentName, setAgentName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const hasMonFee = parseFloat(feeAmount) > 0;
  const hasHnadsFee = parseFloat(hnadsFeeAmount) > 0;
  const hasAnyFee = hasMonFee || hasHnadsFee;

  // ---- Wallet ----
  const { address: walletAddress, isConnected, chain } = useAccount();
  const wrongChain = isConnected && chain?.id !== monadChain.id;

  // ---- localStorage keys for saved tx hashes ----
  const getStorageKey = (step: 'mon' | 'approve' | 'deposit') => {
    return `hnads-fee-${battleId}-${walletAddress}-${step}`;
  };

  // ---- Read saved tx hashes on mount ----
  const [savedMonHash, setSavedMonHash] = useState<string | null>(null);
  const [savedApproveHash, setSavedApproveHash] = useState<string | null>(null);
  const [savedDepositHash, setSavedDepositHash] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) return;

    const monKey = getStorageKey('mon');
    const approveKey = getStorageKey('approve');
    const depositKey = getStorageKey('deposit');

    const savedMon = localStorage.getItem(monKey);
    const savedApprove = localStorage.getItem(approveKey);
    const savedDeposit = localStorage.getItem(depositKey);

    if (savedMon) setSavedMonHash(savedMon);
    if (savedApprove) setSavedApproveHash(savedApprove);
    if (savedDeposit) setSavedDepositHash(savedDeposit);
  }, [battleId, walletAddress]);

  // ---- On-chain battle registration check ----
  // Battle must be registered on-chain before payEntryFee / depositHnadsFee work.
  // Polls every 3s until registered. Returns agent IDs array (empty = not registered).
  const battleBytes = battleIdToBytes32(battleId);
  const { data: onChainAgents, error: regCheckError } = useReadContract({
    address: ARENA_ADDRESS,
    abi: arenaFeeAbi,
    functionName: 'getBattleAgents',
    args: [battleBytes],
    chainId: monadChain.id,
    query: {
      enabled: hasAnyFee && isConnected,
      refetchInterval: 3_000,
    },
  });
  const battleRegistered = !!onChainAgents && (onChainAgents as bigint[]).length > 0;

  // ---- On-chain fee status (survives page refresh) ----
  const { data: onChainMonPaid } = useFeePaid(battleId);
  const { data: onChainHnadsPaid } = useHnadsFeePaid(battleId);

  // ---- Step 1: MON fee payment (payEntryFee) ----
  const {
    writeContract: writeMonTx,
    data: monPaymentHash,
    isPending: isMonSending,
    error: monTxError,
    reset: resetMonTx,
  } = useWriteContract();
  const {
    isFetching: isMonConfirming,
    isSuccess: monTxConfirmed,
  } = useWaitForTransactionReceipt({
    hash: monPaymentHash,
    chainId: monadChain.id,
  });

  // Save MON payment hash to localStorage when available
  useEffect(() => {
    if (monPaymentHash && walletAddress) {
      const key = getStorageKey('mon');
      localStorage.setItem(key, monPaymentHash);
      setSavedMonHash(monPaymentHash);
    }
  }, [monPaymentHash, walletAddress, battleId]);

  // ---- Step 2: $HNADS approve ----
  const {
    writeContract: writeApproveTx,
    data: approveHash,
    isPending: isApproveSending,
    error: approveTxError,
    reset: resetApproveTx,
  } = useWriteContract();
  const {
    isSuccess: approveConfirmed,
    isFetching: isApproveConfirming,
  } = useWaitForTransactionReceipt({
    hash: approveHash,
    chainId: monadChain.id,
  });

  // Save approve hash to localStorage when available
  useEffect(() => {
    if (approveHash && walletAddress) {
      const key = getStorageKey('approve');
      localStorage.setItem(key, approveHash);
      setSavedApproveHash(approveHash);
    }
  }, [approveHash, walletAddress, battleId]);

  // ---- Step 3: $HNADS deposit (depositHnadsFee) ----
  const {
    writeContract: writeDepositTx,
    data: hnadsDepositHash,
    isPending: isDepositSending,
    error: depositTxError,
    reset: resetDepositTx,
  } = useWriteContract();
  const {
    isFetching: isDepositConfirming,
    isSuccess: depositConfirmed,
  } = useWaitForTransactionReceipt({
    hash: hnadsDepositHash,
    chainId: monadChain.id,
  });

  // Save deposit hash to localStorage when available
  useEffect(() => {
    if (hnadsDepositHash && walletAddress) {
      const key = getStorageKey('deposit');
      localStorage.setItem(key, hnadsDepositHash);
      setSavedDepositHash(hnadsDepositHash);
    }
  }, [hnadsDepositHash, walletAddress, battleId]);

  // ---- Derived fee state ----
  // Require on-chain confirmation (not just tx hash) before allowing submit
  const monFeePaid = !hasMonFee || !!onChainMonPaid || monTxConfirmed;
  // Approve must confirm on-chain before deposit can proceed
  const hnadsApproved = !hasHnadsFee || !!onChainHnadsPaid || approveConfirmed;
  // Deposit must be confirmed on-chain
  const hnadsDepositDone = !hasHnadsFee || !!onChainHnadsPaid || depositConfirmed;
  const allFeesPaid = monFeePaid && hnadsDepositDone;

  // ---- Derived state ----
  const nameIsValid = agentName.length > 0 && NAME_REGEX.test(agentName);
  const nameHasInvalidChars =
    agentName.length > 0 && !NAME_REGEX.test(agentName);
  const canSubmit =
    !disabled && !isPending && selectedClass !== null && nameIsValid && allFeesPaid;

  // Step indicator: 1=MON, 2=Approve, 3=Deposit, 4=Done
  const currentStep = !monFeePaid ? 1 : !hnadsApproved ? 2 : !hnadsDepositDone ? 3 : 4;
  // Total number of payment steps (for display)
  const totalSteps = (hasMonFee ? 1 : 0) + (hasHnadsFee ? 2 : 0);

  // ---- Handlers ----
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.slice(0, MAX_NAME_LENGTH);
      setAgentName(value);
      setError("");
    },
    [],
  );

  const handleImageUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setImageUrl(e.target.value);
      setImagePreviewFailed(false);
    },
    [],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedClass) return;

    setError("");
    setIsPending(true);

    const API_BASE =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

    try {
      const body: Record<string, string> = {
        agentClass: selectedClass,
        agentName,
      };
      if (imageUrl.trim()) {
        body.imageUrl = imageUrl.trim();
      }
      if (hasAnyFee && walletAddress) {
        body.walletAddress = walletAddress;
      }
      if (hasMonFee && monPaymentHash) {
        body.txHash = monPaymentHash;
      }
      if (hasHnadsFee && hnadsDepositHash) {
        body.hnadsTxHash = hnadsDepositHash;
      }

      const res = await fetch(`${API_BASE}/battle/${battleId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const serverError =
          (payload as Record<string, string>).error ?? `HTTP ${res.status}`;

        if (res.status === 402) {
          throw new Error(serverError);
        }
        if (res.status === 409) {
          const lower = serverError.toLowerCase();
          if (lower.includes("full")) {
            throw new Error("Arena is full!");
          }
          if (lower.includes("name") || lower.includes("duplicate")) {
            throw new Error("Name already taken!");
          }
        }

        throw new Error(serverError);
      }

      const data = (await res.json()) as { agentId: string };
      onJoined(data.agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPending(false);
    }
  }

  // ---- Render ----
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ---- Class Picker ---- */}
      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-400">
          Choose Your Class
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
          {AGENT_CLASSES.map((cls) => {
            const cfg = CLASS_CONFIG[cls];
            const isSelected = selectedClass === cls;
            return (
              <button
                key={cls}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setSelectedClass(cls);
                  setError("");
                }}
                className={`group relative flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-3 transition-all ${
                  isSelected
                    ? "scale-[1.03] border-gold bg-gold/10 shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                    : "border-colosseum-surface-light bg-colosseum-surface hover:border-gray-500"
                } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                title={CLASS_DESCRIPTIONS[cls]}
              >
                <AgentPortrait
                  image={cfg.image}
                  emoji={cfg.emoji}
                  alt={cls}
                  size={isSelected ? "w-12 h-12" : "w-10 h-10"}
                  className="transition-all"
                />
                <span
                  className={`text-[11px] font-bold tracking-wider ${
                    isSelected ? "text-gold" : "text-gray-300"
                  }`}
                >
                  {cls}
                </span>
                <span className="hidden text-[9px] leading-tight text-gray-500 sm:block">
                  {CLASS_DESCRIPTIONS[cls].split(".")[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Name Input ---- */}
      <div>
        <label
          htmlFor="agent-name"
          className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-400"
        >
          Gladiator Name
        </label>
        <div className="relative">
          <input
            id="agent-name"
            type="text"
            value={agentName}
            onChange={handleNameChange}
            disabled={disabled}
            maxLength={MAX_NAME_LENGTH}
            placeholder="BLOODFANG"
            autoComplete="off"
            className={`w-full rounded-lg border-2 bg-colosseum-surface px-3 py-2.5 font-mono text-sm uppercase text-gray-100 placeholder-gray-600 outline-none transition-colors ${
              nameHasInvalidChars
                ? "border-blood focus:border-blood"
                : "border-colosseum-surface-light focus:border-gold/60"
            } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">
            {agentName.length}/{MAX_NAME_LENGTH}
          </span>
        </div>
        {nameHasInvalidChars && (
          <p className="mt-1 text-[11px] text-blood-light">
            Letters, numbers, and underscores only
          </p>
        )}
      </div>

      {/* ---- Optional Image URL ---- */}
      <div>
        <label
          htmlFor="agent-image"
          className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-400"
        >
          Portrait URL{" "}
          <span className="font-normal normal-case text-gray-600">
            (optional)
          </span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="agent-image"
            type="url"
            value={imageUrl}
            onChange={handleImageUrlChange}
            disabled={disabled}
            placeholder="https://your-portrait.png"
            className={`flex-1 rounded-lg border-2 border-colosseum-surface-light bg-colosseum-surface px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors focus:border-gold/60 ${
              disabled ? "cursor-not-allowed opacity-50" : ""
            }`}
          />
          {/* Preview thumbnail */}
          {imageUrl.trim() && (
            <div className="flex-shrink-0">
              {imagePreviewFailed ? (
                selectedClass ? (
                  <AgentPortrait
                    image={CLASS_CONFIG[selectedClass].image}
                    emoji={CLASS_CONFIG[selectedClass].emoji}
                    alt="Fallback"
                    size="w-12 h-12"
                    className="rounded border border-colosseum-surface-light"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded border border-blood/40 bg-blood/10 text-[10px] text-blood-light">
                    Error
                  </div>
                )
              ) : (
                <img
                  src={imageUrl.trim()}
                  alt="Preview"
                  className="h-12 w-12 rounded border border-colosseum-surface-light object-cover"
                  onError={() => setImagePreviewFailed(true)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Entry Fee Section (dual-token flow) ---- */}
      {hasAnyFee && (
        <div className="space-y-4 rounded-lg border border-gold/30 bg-gold/5 p-4">
          {/* Fee summary */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Entry Fees
            </span>
            <div className="flex items-center gap-2">
              {hasMonFee && (
                <span className="text-sm font-bold text-gold">{feeAmount} MON</span>
              )}
              {hasMonFee && hasHnadsFee && (
                <span className="text-xs text-gray-500">+</span>
              )}
              {hasHnadsFee && (
                <span className="text-sm font-bold text-gold">{hnadsFeeAmount} $HNADS</span>
              )}
            </div>
          </div>

          {/* Wallet connection / chain gate */}
          {!isConnected ? (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button
                  type="button"
                  onClick={openConnectModal}
                  className="w-full rounded-lg border border-gold/50 bg-gold/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20 active:scale-[0.98]"
                >
                  Connect Wallet to Pay
                </button>
              )}
            </ConnectButton.Custom>
          ) : wrongChain ? (
            <ConnectButton.Custom>
              {({ openChainModal }) => (
                <button
                  type="button"
                  onClick={openChainModal}
                  className="w-full rounded-lg border border-blood/50 bg-blood/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-blood-light transition-all hover:bg-blood/20 active:scale-[0.98]"
                >
                  Switch to Monad Testnet
                </button>
              )}
            </ConnectButton.Custom>
          ) : (
            <div className="space-y-3">
              {/* Waiting for on-chain battle registration */}
              {!battleRegistered && (
                <div className="flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/5 p-2 text-[11px] text-gold">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Registering battle on-chain... payments enabled shortly
                </div>
              )}

              {/* Step progress indicator (only if multi-step) */}
              {totalSteps > 1 && (
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  {hasMonFee && (
                    <>
                      <span className={currentStep >= 2 ? 'text-green-400' : currentStep === 1 ? 'text-gold' : 'text-gray-600'}>
                        1. Pay MON
                      </span>
                      <span className="text-gray-700">&rarr;</span>
                    </>
                  )}
                  {hasHnadsFee && (
                    <>
                      <span className={currentStep >= 3 ? 'text-green-400' : currentStep === 2 ? 'text-gold' : 'text-gray-600'}>
                        {hasMonFee ? '2' : '1'}. Approve
                      </span>
                      <span className="text-gray-700">&rarr;</span>
                      <span className={currentStep >= 4 ? 'text-green-400' : currentStep === 3 ? 'text-gold' : 'text-gray-600'}>
                        {hasMonFee ? '3' : '2'}. Deposit
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* ---- Step 1: MON Fee Payment ---- */}
              {hasMonFee && (
                <div className={`rounded-lg border p-3 ${
                  monFeePaid
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-gold/20 bg-colosseum-surface'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      {totalSteps > 1 ? `Step ${hasMonFee ? '1' : ''}: ` : ''}MON Entry Fee
                    </span>
                    <span className="text-xs font-bold text-gold">{feeAmount} MON</span>
                  </div>

                  {onChainMonPaid ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-green-400">
                      <CheckIcon />
                      <span>
                        Paid on-chain
                        {savedMonHash && (
                          <> — <a
                            href={`https://testnet.monadexplorer.com/tx/${savedMonHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold hover:underline"
                          >
                            TX: {savedMonHash.slice(0, 10)}...{savedMonHash.slice(-6)}
                          </a></>
                        )}
                      </span>
                    </div>
                  ) : monPaymentHash ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-green-400">
                      <CheckIcon />
                      <span>
                        {monTxConfirmed ? "Confirmed" : "Sent"} — TX: {monPaymentHash.slice(0, 10)}...{monPaymentHash.slice(-6)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={disabled || !battleRegistered || isMonSending || isMonConfirming}
                        onClick={() => {
                          setError("");
                          resetMonTx();
                          writeMonTx({
                            address: ARENA_ADDRESS,
                            abi: arenaFeeAbi,
                            functionName: 'payEntryFee',
                            args: [battleIdToBytes32(battleId)],
                            value: parseEther(feeAmount),
                          });
                        }}
                        className={`mt-2 w-full rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                          isMonSending || isMonConfirming
                            ? "cursor-wait border border-gold/40 bg-gold/10 text-gold"
                            : !battleRegistered
                              ? "cursor-not-allowed border border-gray-700 bg-colosseum-surface text-gray-600"
                              : "border border-gold/50 bg-gold/10 text-gold hover:bg-gold/20 active:scale-[0.98]"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {!battleRegistered
                          ? "Waiting for on-chain registration..."
                          : isMonSending
                            ? "Confirm in Wallet..."
                            : isMonConfirming
                              ? "Confirming TX..."
                              : `Pay ${feeAmount} MON`}
                      </button>
                      {monTxError && (
                        <p className="mt-1 text-[11px] text-blood-light">
                          {formatTxError(monTxError)}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ---- Step 2: $HNADS Approve ---- */}
              {hasHnadsFee && (
                <div className={`rounded-lg border p-3 transition-all ${
                  hnadsApproved
                    ? 'border-green-500/30 bg-green-500/5'
                    : !monFeePaid
                      ? 'border-colosseum-surface-light bg-colosseum-surface opacity-40'
                      : 'border-gold/20 bg-colosseum-surface'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Step {hasMonFee ? '2' : '1'}: Approve $HNADS
                    </span>
                    <span className="text-xs font-bold text-gold">{hnadsFeeAmount} $HNADS</span>
                  </div>

                  {onChainHnadsPaid ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-green-400">
                      <CheckIcon />
                      <span>
                        Approved
                        {savedApproveHash && (
                          <> — <a
                            href={`https://testnet.monadexplorer.com/tx/${savedApproveHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold hover:underline"
                          >
                            TX: {savedApproveHash.slice(0, 10)}...{savedApproveHash.slice(-6)}
                          </a></>
                        )}
                      </span>
                    </div>
                  ) : approveHash ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-green-400">
                      <CheckIcon />
                      <span>
                        {approveConfirmed ? "Approved" : "Approving..."} — TX: {approveHash.slice(0, 10)}...{approveHash.slice(-6)}
                      </span>
                    </div>
                  ) : monFeePaid ? (
                    <>
                      <p className="mt-1 text-[10px] text-gray-500">
                        Allow the Arena contract to transfer your $HNADS tokens
                      </p>
                      <button
                        type="button"
                        disabled={disabled || isApproveSending || isApproveConfirming}
                        onClick={() => {
                          setError("");
                          resetApproveTx();
                          writeApproveTx({
                            address: HNADS_TOKEN_ADDRESS,
                            abi: erc20ApproveAbi,
                            functionName: 'approve',
                            args: [ARENA_ADDRESS, parseEther(hnadsFeeAmount)],
                          });
                        }}
                        className={`mt-2 w-full rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                          isApproveSending || isApproveConfirming
                            ? "cursor-wait border border-gold/40 bg-gold/10 text-gold"
                            : "border border-gold/50 bg-gold/10 text-gold hover:bg-gold/20 active:scale-[0.98]"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {isApproveSending
                          ? "Confirm in Wallet..."
                          : isApproveConfirming
                            ? "Confirming Approval..."
                            : `Approve ${hnadsFeeAmount} $HNADS`}
                      </button>
                      {approveTxError && (
                        <p className="mt-1 text-[11px] text-blood-light">
                          {formatTxError(approveTxError)}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[10px] text-gray-600">
                      Complete MON payment first
                    </p>
                  )}
                </div>
              )}

              {/* ---- Step 3: $HNADS Deposit ---- */}
              {hasHnadsFee && (
                <div className={`rounded-lg border p-3 transition-all ${
                  hnadsDepositDone
                    ? 'border-green-500/30 bg-green-500/5'
                    : !hnadsApproved
                      ? 'border-colosseum-surface-light bg-colosseum-surface opacity-40'
                      : 'border-gold/20 bg-colosseum-surface'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Step {hasMonFee ? '3' : '2'}: Deposit $HNADS
                    </span>
                    <span className="text-xs font-bold text-gold">{hnadsFeeAmount} $HNADS</span>
                  </div>

                  {onChainHnadsPaid ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-green-400">
                      <CheckIcon />
                      <span>
                        Deposited
                        {savedDepositHash && (
                          <> — <a
                            href={`https://testnet.monadexplorer.com/tx/${savedDepositHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold hover:underline"
                          >
                            TX: {savedDepositHash.slice(0, 10)}...{savedDepositHash.slice(-6)}
                          </a></>
                        )}
                      </span>
                    </div>
                  ) : hnadsDepositHash ? (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-green-400">
                      <CheckIcon />
                      <span>
                        {depositConfirmed ? "Deposited" : "Depositing..."} — TX: {hnadsDepositHash.slice(0, 10)}...{hnadsDepositHash.slice(-6)}
                      </span>
                    </div>
                  ) : hnadsApproved ? (
                    <>
                      <p className="mt-1 text-[10px] text-gray-500">
                        Deposit $HNADS into the Arena (50% burned, 50% treasury)
                      </p>
                      <button
                        type="button"
                        disabled={disabled || !battleRegistered || isDepositSending || isDepositConfirming}
                        onClick={() => {
                          setError("");
                          resetDepositTx();
                          writeDepositTx({
                            address: ARENA_ADDRESS,
                            abi: arenaFeeAbi,
                            functionName: 'depositHnadsFee',
                            args: [battleIdToBytes32(battleId), parseEther(hnadsFeeAmount)],
                          });
                        }}
                        className={`mt-2 w-full rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                          isDepositSending || isDepositConfirming
                            ? "cursor-wait border border-gold/40 bg-gold/10 text-gold"
                            : !battleRegistered
                              ? "cursor-not-allowed border border-gray-700 bg-colosseum-surface text-gray-600"
                              : "border border-gold/50 bg-gold/10 text-gold hover:bg-gold/20 active:scale-[0.98]"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {!battleRegistered
                          ? "Waiting for on-chain registration..."
                          : isDepositSending
                            ? "Confirm in Wallet..."
                            : isDepositConfirming
                              ? "Confirming Deposit..."
                              : `Deposit ${hnadsFeeAmount} $HNADS`}
                      </button>
                      {depositTxError && (
                        <p className="mt-1 text-[11px] text-blood-light">
                          {formatTxError(depositTxError)}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[10px] text-gray-600">
                      Complete $HNADS approval first
                    </p>
                  )}
                </div>
              )}

              {/* All fees paid */}
              {allFeesPaid && (
                <div className="flex items-center gap-2 text-[11px] text-green-400">
                  <CheckIcon />
                  <span className="font-bold">All fees paid — ready to enter!</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Error message ---- */}
      {error && (
        <div className="rounded-lg border border-blood/30 bg-blood/10 px-4 py-2.5 text-sm text-blood-light">
          {error}
        </div>
      )}

      {/* ---- Submit ---- */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`w-full rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-widest transition-all ${
          canSubmit
            ? "bg-gradient-to-r from-gold-dark via-gold to-gold-light text-colosseum-bg shadow-lg shadow-gold/20 hover:shadow-gold/40 active:scale-[0.98]"
            : "cursor-not-allowed border border-colosseum-surface-light bg-colosseum-surface text-gray-600"
        }`}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Entering Arena...
          </span>
        ) : hasAnyFee && !allFeesPaid ? (
          "Complete Payments First"
        ) : (
          "Enter the Arena"
        )}
      </button>
    </form>
  );
}
