/**
 * HUNGERNADS - On-chain Client
 *
 * Viem-based client for interacting with HungernadsArena and HungernadsBetting
 * contracts on Monad testnet. Used by the Cloudflare Worker oracle to register
 * battles, record results, and settle bets.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { hungernadsArenaAbi, hungernadsBettingAbi } from './abis';

// ─── Monad Testnet Chain Definition ─────────────────────────────────

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
  testnet: true,
});

// ─── Types ──────────────────────────────────────────────────────────

export interface ChainConfig {
  rpcUrl: string;
  privateKey: Hex;
  arenaAddress: Address;
  bettingAddress: Address;
}

export interface AgentResult {
  agentId: bigint;
  finalHp: bigint;
  kills: bigint;
  survivedEpochs: bigint;
  isWinner: boolean;
}

export interface OnChainBattle {
  battleId: Hex;
  state: number; // 0=None, 1=Created, 2=Active, 3=Completed
  agentIds: readonly bigint[];
  winnerId: bigint;
  createdAt: bigint;
  completedAt: bigint;
}

export interface OnChainAgentStats {
  wins: bigint;
  losses: bigint;
  kills: bigint;
  totalBattles: bigint;
  totalEpochsSurvived: bigint;
  exists: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/** Convert a string battle ID to a bytes32 hash deterministically. */
export function battleIdToBytes32(battleId: string): Hex {
  return keccak256(encodeAbiParameters([{ type: 'string' }], [battleId]));
}

/** Sleep helper for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for transaction submission. Retries on transient errors
 * (network issues, nonce conflicts) but not on revert errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);

      // Don't retry on contract reverts -- those won't succeed on retry
      if (
        msg.includes('revert') ||
        msg.includes('execution reverted') ||
        msg.includes('OnlyOracle') ||
        msg.includes('BattleAlreadyExists') ||
        msg.includes('InvalidBattleState')
      ) {
        throw error;
      }

      console.warn(
        `[chain] ${label} attempt ${attempt}/${retries} failed: ${msg}`,
      );
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

// ─── Chain Client ───────────────────────────────────────────────────

export class HungernadsChainClient {
  private publicClient: PublicClient<Transport, Chain>;
  private walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
  private account: PrivateKeyAccount;
  private arenaAddress: Address;
  private bettingAddress: Address;

  constructor(config: ChainConfig) {
    this.arenaAddress = config.arenaAddress;
    this.bettingAddress = config.bettingAddress;
    this.account = privateKeyToAccount(config.privateKey);

    const chain = {
      ...monadTestnet,
      rpcUrls: {
        default: {
          http: [config.rpcUrl],
        },
      },
    } as const;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient<Transport, Chain>;

    this.walletClient = createWalletClient({
      chain,
      transport: http(config.rpcUrl),
      account: this.account,
    }) as WalletClient<Transport, Chain, PrivateKeyAccount>;
  }

  /** The oracle wallet address. */
  get oracleAddress(): Address {
    return this.account.address;
  }

  // ─── Arena Write Functions ──────────────────────────────────────

  /**
   * Register a new battle on-chain with the given agents.
   * Calls HungernadsArena.registerBattle(bytes32, uint256[]).
   *
   * @param battleId - Human-readable battle ID (hashed to bytes32)
   * @param agentIds - Numeric agent IDs participating in the battle
   * @returns Transaction hash
   */
  async registerBattle(battleId: string, agentIds: number[]): Promise<Hash> {
    const battleBytes = battleIdToBytes32(battleId);
    const agentBigInts = agentIds.map(id => BigInt(id));

    return withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.arenaAddress,
        abi: hungernadsArenaAbi,
        functionName: 'registerBattle',
        args: [battleBytes, agentBigInts],
      });

      console.log(`[chain] registerBattle tx: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    }, `registerBattle(${battleId})`);
  }

  /**
   * Activate a battle (transition from Created to Active).
   * Calls HungernadsArena.activateBattle(bytes32).
   */
  async activateBattle(battleId: string): Promise<Hash> {
    const battleBytes = battleIdToBytes32(battleId);

    return withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.arenaAddress,
        abi: hungernadsArenaAbi,
        functionName: 'activateBattle',
        args: [battleBytes],
      });

      console.log(`[chain] activateBattle tx: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    }, `activateBattle(${battleId})`);
  }

  /**
   * Record battle results on-chain.
   * Calls HungernadsArena.recordResult(bytes32, uint256, AgentResult[]).
   *
   * @param battleId - Human-readable battle ID
   * @param winnerId - Numeric ID of the winning agent
   * @param results  - Per-agent results array
   * @returns Transaction hash
   */
  async recordResult(
    battleId: string,
    winnerId: number,
    results: AgentResult[],
  ): Promise<Hash> {
    const battleBytes = battleIdToBytes32(battleId);

    return withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.arenaAddress,
        abi: hungernadsArenaAbi,
        functionName: 'recordResult',
        args: [battleBytes, BigInt(winnerId), results],
      });

      console.log(`[chain] recordResult tx: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    }, `recordResult(${battleId})`);
  }

  // ─── Betting Write Functions ────────────────────────────────────

  /**
   * Create a betting pool for a battle.
   * Calls HungernadsBetting.createBattle(bytes32).
   */
  async createBettingPool(battleId: string): Promise<Hash> {
    const battleBytes = battleIdToBytes32(battleId);

    return withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.bettingAddress,
        abi: hungernadsBettingAbi,
        functionName: 'createBattle',
        args: [battleBytes],
      });

      console.log(`[chain] createBettingPool tx: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    }, `createBettingPool(${battleId})`);
  }

  /**
   * Settle a battle's betting pool by declaring the winner.
   * Calls HungernadsBetting.settleBattle(bytes32, uint256).
   *
   * @param battleId - Human-readable battle ID
   * @param winnerId - Numeric ID of the winning agent
   * @returns Transaction hash
   */
  async settleBets(battleId: string, winnerId: number): Promise<Hash> {
    const battleBytes = battleIdToBytes32(battleId);

    return withRetry(async () => {
      const hash = await this.walletClient.writeContract({
        address: this.bettingAddress,
        abi: hungernadsBettingAbi,
        functionName: 'settleBattle',
        args: [battleBytes, BigInt(winnerId)],
      });

      console.log(`[chain] settleBets tx: ${hash}`);
      await this.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    }, `settleBets(${battleId})`);
  }

  // ─── Arena Read Functions ───────────────────────────────────────

  /** Get full battle data from the Arena contract. */
  async getBattle(battleId: string): Promise<OnChainBattle> {
    const battleBytes = battleIdToBytes32(battleId);
    const result = (await this.publicClient.readContract({
      address: this.arenaAddress,
      abi: hungernadsArenaAbi,
      functionName: 'getBattle',
      args: [battleBytes],
    })) as {
      battleId: Hex;
      state: number;
      agentIds: readonly bigint[];
      winnerId: bigint;
      createdAt: bigint;
      completedAt: bigint;
    };

    return {
      battleId: result.battleId,
      state: result.state,
      agentIds: result.agentIds,
      winnerId: result.winnerId,
      createdAt: result.createdAt,
      completedAt: result.completedAt,
    };
  }

  /** Get cumulative stats for an agent from the Arena contract. */
  async getAgentStats(agentId: number): Promise<OnChainAgentStats> {
    const result = (await this.publicClient.readContract({
      address: this.arenaAddress,
      abi: hungernadsArenaAbi,
      functionName: 'getAgentStats',
      args: [BigInt(agentId)],
    })) as {
      wins: bigint;
      losses: bigint;
      kills: bigint;
      totalBattles: bigint;
      totalEpochsSurvived: bigint;
      exists: boolean;
    };

    return {
      wins: result.wins,
      losses: result.losses,
      kills: result.kills,
      totalBattles: result.totalBattles,
      totalEpochsSurvived: result.totalEpochsSurvived,
      exists: result.exists,
    };
  }

  /** Get total number of registered battles. */
  async getBattleCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.arenaAddress,
      abi: hungernadsArenaAbi,
      functionName: 'getBattleCount',
    })) as bigint;
  }

  // ─── Betting Read Functions ─────────────────────────────────────

  /** Get the total betting pool size for a battle. */
  async getBattlePool(battleId: string): Promise<bigint> {
    const battleBytes = battleIdToBytes32(battleId);
    return (await this.publicClient.readContract({
      address: this.bettingAddress,
      abi: hungernadsBettingAbi,
      functionName: 'getBattlePool',
      args: [battleBytes],
    })) as bigint;
  }

  /** Get per-agent pool sizes (for calculating odds). */
  async getOdds(
    battleId: string,
    agentIds: number[],
  ): Promise<readonly bigint[]> {
    const battleBytes = battleIdToBytes32(battleId);
    return (await this.publicClient.readContract({
      address: this.bettingAddress,
      abi: hungernadsBettingAbi,
      functionName: 'getOdds',
      args: [battleBytes, agentIds.map(id => BigInt(id))],
    })) as readonly bigint[];
  }

  /** Check if a battle's betting pool has been settled. */
  async isBattleSettled(battleId: string): Promise<boolean> {
    const battleBytes = battleIdToBytes32(battleId);
    const result = (await this.publicClient.readContract({
      address: this.bettingAddress,
      abi: hungernadsBettingAbi,
      functionName: 'battles',
      args: [battleBytes],
    })) as readonly [boolean, boolean, boolean, bigint, bigint, bigint];
    // battles() returns [exists, resolving, settled, winnerId, totalPool, winnersPool]
    return result[2]; // settled
  }
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create a HungernadsChainClient from Cloudflare Worker environment variables.
 * Returns null if required env vars are missing (allows graceful degradation
 * when running without chain integration, e.g. local dev).
 */
export function createChainClient(env: {
  MONAD_RPC_URL?: string;
  PRIVATE_KEY?: string;
  ARENA_CONTRACT_ADDRESS?: string;
  BETTING_CONTRACT_ADDRESS?: string;
}): HungernadsChainClient | null {
  const { MONAD_RPC_URL, PRIVATE_KEY, ARENA_CONTRACT_ADDRESS, BETTING_CONTRACT_ADDRESS } = env;

  if (!MONAD_RPC_URL || !PRIVATE_KEY || !ARENA_CONTRACT_ADDRESS || !BETTING_CONTRACT_ADDRESS) {
    const missing = [
      !MONAD_RPC_URL && 'MONAD_RPC_URL',
      !PRIVATE_KEY && 'PRIVATE_KEY',
      !ARENA_CONTRACT_ADDRESS && 'ARENA_CONTRACT_ADDRESS',
      !BETTING_CONTRACT_ADDRESS && 'BETTING_CONTRACT_ADDRESS',
    ].filter(Boolean);
    console.warn(
      `[chain] Chain client disabled -- missing env vars: ${missing.join(', ')}`,
    );
    return null;
  }

  return new HungernadsChainClient({
    rpcUrl: MONAD_RPC_URL,
    privateKey: PRIVATE_KEY as Hex,
    arenaAddress: ARENA_CONTRACT_ADDRESS as Address,
    bettingAddress: BETTING_CONTRACT_ADDRESS as Address,
  });
}
