/**
 * HUNGERNADS - Contract Interaction
 *
 * Typed wagmi hooks for reading from and writing to HungernadsArena
 * and HungernadsBetting contracts on Monad testnet.
 *
 * Read hooks:
 *   useOdds         - per-agent pool sizes for a battle
 *   useUserBets     - the connected user's bets for a battle
 *   useBattlePool   - total pool size for a battle
 *   useClaimable    - claimable prize amount for connected user
 *   useClaimed      - whether connected user has already claimed
 *
 * Write hooks:
 *   usePlaceBet     - place a payable bet on an agent
 *   useSponsorAgent - send a payable sponsorship to an agent
 *   useClaimPrize   - claim winnings from a settled battle
 */

import { useReadContract, useWriteContract, useAccount } from 'wagmi';
import { parseEther, type Address, keccak256, encodePacked } from 'viem';
import { BETTING_ADDRESS } from './wallet';

// ─── ABI Subsets (user-facing functions only) ────────────────────────

/**
 * Minimal betting contract ABI. We only include the functions the
 * dashboard actually calls so the bundle stays small.
 */
const bettingAbi = [
  // ── Read ──
  {
    type: 'function',
    name: 'getBattlePool',
    stateMutability: 'view',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getUserBets',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getOdds',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'agentIds', type: 'uint256[]' },
    ],
    outputs: [{ name: 'pools', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'claimable',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimed',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  // ── Write ──
  {
    type: 'function',
    name: 'placeBet',
    stateMutability: 'payable',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sponsorAgent',
    stateMutability: 'payable',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimPrize',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [],
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Deterministic bytes32 hash from a human-readable battle ID.
 * Must match the backend's `battleIdToBytes32`.
 */
export function battleIdToBytes32(battleId: string): `0x${string}` {
  return keccak256(encodePacked(['string'], [battleId]));
}

// ─── Read Hooks ──────────────────────────────────────────────────────

/**
 * Fetch per-agent pool sizes for calculating live odds.
 *
 * @param battleId - Human-readable battle ID
 * @param agentIds - Numeric agent IDs to query
 */
export function useOdds(battleId: string, agentIds: number[]) {
  const battleBytes = battleIdToBytes32(battleId);
  return useReadContract({
    address: BETTING_ADDRESS,
    abi: bettingAbi,
    functionName: 'getOdds',
    args: [battleBytes, agentIds.map((id) => BigInt(id))],
    query: {
      enabled: agentIds.length > 0,
      refetchInterval: 15_000, // Re-poll every 15s for live odds
    },
  });
}

/**
 * Fetch the connected user's bets for a specific battle.
 *
 * @param battleId - Human-readable battle ID
 */
export function useUserBets(battleId: string) {
  const { address } = useAccount();
  const battleBytes = battleIdToBytes32(battleId);
  return useReadContract({
    address: BETTING_ADDRESS,
    abi: bettingAbi,
    functionName: 'getUserBets',
    args: [battleBytes, address as Address],
    query: {
      enabled: !!address,
      refetchInterval: 30_000,
    },
  });
}

/**
 * Fetch the total betting pool size for a battle.
 *
 * @param battleId - Human-readable battle ID
 */
export function useBattlePool(battleId: string) {
  const battleBytes = battleIdToBytes32(battleId);
  return useReadContract({
    address: BETTING_ADDRESS,
    abi: bettingAbi,
    functionName: 'getBattlePool',
    args: [battleBytes],
    query: {
      refetchInterval: 15_000,
    },
  });
}

/**
 * Fetch the claimable prize amount for the connected user.
 *
 * @param battleId - Human-readable battle ID
 */
export function useClaimable(battleId: string) {
  const { address } = useAccount();
  const battleBytes = battleIdToBytes32(battleId);
  return useReadContract({
    address: BETTING_ADDRESS,
    abi: bettingAbi,
    functionName: 'claimable',
    args: [battleBytes, address as Address],
    query: {
      enabled: !!address,
    },
  });
}

/**
 * Check whether the connected user has already claimed their prize.
 *
 * @param battleId - Human-readable battle ID
 */
export function useClaimed(battleId: string) {
  const { address } = useAccount();
  const battleBytes = battleIdToBytes32(battleId);
  return useReadContract({
    address: BETTING_ADDRESS,
    abi: bettingAbi,
    functionName: 'claimed',
    args: [battleBytes, address as Address],
    query: {
      enabled: !!address,
    },
  });
}

// ─── Write Hooks ─────────────────────────────────────────────────────

/**
 * Place a bet on an agent. Sends MON as msg.value.
 *
 * Usage:
 *   const { placeBet, isPending, isSuccess, error } = usePlaceBet();
 *   placeBet({ battleId: 'battle-1', agentId: 1, amountMon: '0.5' });
 */
export function usePlaceBet() {
  const { writeContract, isPending, isSuccess, error, data: hash } = useWriteContract();

  function placeBet({
    battleId,
    agentId,
    amountMon,
  }: {
    battleId: string;
    agentId: number;
    amountMon: string;
  }) {
    const battleBytes = battleIdToBytes32(battleId);
    writeContract({
      address: BETTING_ADDRESS,
      abi: bettingAbi,
      functionName: 'placeBet',
      args: [battleBytes, BigInt(agentId)],
      value: parseEther(amountMon),
    });
  }

  return { placeBet, isPending, isSuccess, error, hash };
}

/**
 * Sponsor an agent. Sends MON as msg.value with an optional message.
 *
 * Usage:
 *   const { sponsor, isPending } = useSponsorAgent();
 *   sponsor({ battleId, agentId: 3, amountMon: '1', message: 'Fight on!' });
 */
export function useSponsorAgent() {
  const { writeContract, isPending, isSuccess, error, data: hash } = useWriteContract();

  function sponsor({
    battleId,
    agentId,
    amountMon,
    message,
  }: {
    battleId: string;
    agentId: number;
    amountMon: string;
    message: string;
  }) {
    const battleBytes = battleIdToBytes32(battleId);
    writeContract({
      address: BETTING_ADDRESS,
      abi: bettingAbi,
      functionName: 'sponsorAgent',
      args: [battleBytes, BigInt(agentId), message],
      value: parseEther(amountMon),
    });
  }

  return { sponsor, isPending, isSuccess, error, hash };
}

/**
 * Claim prize from a settled battle.
 *
 * Usage:
 *   const { claim, isPending } = useClaimPrize();
 *   claim({ battleId: 'battle-1' });
 */
export function useClaimPrize() {
  const { writeContract, isPending, isSuccess, error, data: hash } = useWriteContract();

  function claim({ battleId }: { battleId: string }) {
    const battleBytes = battleIdToBytes32(battleId);
    writeContract({
      address: BETTING_ADDRESS,
      abi: bettingAbi,
      functionName: 'claimPrize',
      args: [battleBytes],
    });
  }

  return { claim, isPending, isSuccess, error, hash };
}
