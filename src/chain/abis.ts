/**
 * HUNGERNADS - Contract ABIs
 *
 * ABI definitions for HungernadsArena and HungernadsBetting contracts.
 * Used by viem for type-safe contract interaction.
 *
 * These are hand-extracted from the Solidity sources to avoid importing
 * Foundry JSON artifacts into the Cloudflare Worker bundle.
 */

// ─── HungernadsArena ABI ──────────────────────────────────────────────

export const hungernadsArenaAbi = [
  // --- Events ---
  {
    type: 'event',
    name: 'OracleUpdated',
    inputs: [
      { name: 'previousOracle', type: 'address', indexed: true },
      { name: 'newOracle', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [{ name: 'agentId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'BattleCreated',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'agentIds', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BattleActivated',
    inputs: [{ name: 'battleId', type: 'bytes32', indexed: true }],
  },
  {
    type: 'event',
    name: 'AgentEliminated',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'finalHp', type: 'uint256', indexed: false },
      { name: 'kills', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BattleCompleted',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'winnerId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'EntryFeePaid',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FeesWithdrawn',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },

  // --- Errors ---
  { type: 'error', name: 'OnlyOracle', inputs: [] },
  {
    type: 'error',
    name: 'BattleAlreadyExists',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'BattleNotFound',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'InvalidBattleState',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'current', type: 'uint8' },
      { name: 'expected', type: 'uint8' },
    ],
  },
  { type: 'error', name: 'InvalidAgentCount', inputs: [] },
  {
    type: 'error',
    name: 'ResultAgentMismatch',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
  },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'IncorrectFeeAmount', inputs: [] },
  { type: 'error', name: 'AlreadyPaid', inputs: [] },
  { type: 'error', name: 'NoFeesToWithdraw', inputs: [] },
  { type: 'error', name: 'BattleNotCompleted', inputs: [] },
  { type: 'error', name: 'NoFeeRequired', inputs: [] },

  // --- Oracle-only Write Functions ---
  {
    type: 'function',
    name: 'registerBattle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_battleId', type: 'bytes32' },
      { name: '_agentIds', type: 'uint256[]' },
      { name: '_entryFee', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activateBattle',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recordResult',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_battleId', type: 'bytes32' },
      { name: '_winnerId', type: 'uint256' },
      {
        name: '_results',
        type: 'tuple[]',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'finalHp', type: 'uint256' },
          { name: 'kills', type: 'uint256' },
          { name: 'survivedEpochs', type: 'uint256' },
          { name: 'isWinner', type: 'bool' },
        ],
      },
    ],
    outputs: [],
  },

  // --- Admin Functions ---
  {
    type: 'function',
    name: 'setOracle',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_oracle', type: 'address' }],
    outputs: [],
  },

  // --- View Functions ---
  {
    type: 'function',
    name: 'oracle',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getBattle',
    stateMutability: 'view',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'battleId', type: 'bytes32' },
          { name: 'state', type: 'uint8' },
          { name: 'agentIds', type: 'uint256[]' },
          { name: 'winnerId', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'completedAt', type: 'uint256' },
          { name: 'entryFee', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getBattleResult',
    stateMutability: 'view',
    inputs: [
      { name: '_battleId', type: 'bytes32' },
      { name: '_agentId', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'finalHp', type: 'uint256' },
          { name: 'kills', type: 'uint256' },
          { name: 'survivedEpochs', type: 'uint256' },
          { name: 'isWinner', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getAgentStats',
    stateMutability: 'view',
    inputs: [{ name: '_agentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'wins', type: 'uint256' },
          { name: 'losses', type: 'uint256' },
          { name: 'kills', type: 'uint256' },
          { name: 'totalBattles', type: 'uint256' },
          { name: 'totalEpochsSurvived', type: 'uint256' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getBattleCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getBattleAgents',
    stateMutability: 'view',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getBattleIds',
    stateMutability: 'view',
    inputs: [
      { name: '_offset', type: 'uint256' },
      { name: '_limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  // --- Entry Fee Functions ---
  {
    type: 'function',
    name: 'payEntryFee',
    stateMutability: 'payable',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawFees',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'feePaid',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'feesCollected',
    stateMutability: 'view',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // --- Prize Distribution ---
  {
    type: 'event',
    name: 'PrizeDistributed',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'winner', type: 'address', indexed: true },
      { name: 'winnerAmount', type: 'uint256', indexed: false },
      { name: 'treasuryAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'distributePrize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_battleId', type: 'bytes32' },
      { name: '_winner', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'prizeDistributed',
    stateMutability: 'view',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'WINNER_SHARE_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'error', name: 'PrizeAlreadyDistributed', inputs: [] },
  { type: 'error', name: 'TreasuryNotSet', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },

  // --- $HNADS Fee Functions ---
  {
    type: 'event',
    name: 'HnadsFeeDeposited',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HnadsBurned',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HnadsTreasuryTransferred',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'hnadsFeePaid',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'hnadsFeesCollected',
    stateMutability: 'view',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'HnadsTransferFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'HnadsTokenNotSet',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InsufficientHnadsBalance',
    inputs: [],
  },

  // --- $HNADS Write Functions (oracle-only) ---
  {
    type: 'function',
    name: 'burnHnads',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'transferHnadsToTreasury',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_battleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'awardKillBonus',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_recipient', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'awardSurvivalBonus',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_recipient', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },

  // --- $HNADS Admin Events ---
  {
    type: 'event',
    name: 'HnadsTokenUpdated',
    inputs: [
      { name: 'previousToken', type: 'address', indexed: true },
      { name: 'newToken', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TreasuryUpdated',
    inputs: [
      { name: 'previousTreasury', type: 'address', indexed: true },
      { name: 'newTreasury', type: 'address', indexed: true },
    ],
  },
] as const;

// ─── HungernadsBetting ABI ───────────────────────────────────────────

export const hungernadsBettingAbi = [
  // --- Events ---
  {
    type: 'event',
    name: 'BattleCreated',
    inputs: [{ name: 'battleId', type: 'bytes32', indexed: true }],
  },
  {
    type: 'event',
    name: 'BetPlaced',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BattleSettled',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'winnerId', type: 'uint256', indexed: false },
      { name: 'totalPool', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PrizeDistributed',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SponsorshipSent',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'message', type: 'string', indexed: false },
    ],
  },

  // --- Errors ---
  { type: 'error', name: 'OnlyOracle', inputs: [] },
  { type: 'error', name: 'BattleDoesNotExist', inputs: [] },
  { type: 'error', name: 'BattleAlreadyExists', inputs: [] },
  { type: 'error', name: 'BattleAlreadySettled', inputs: [] },
  { type: 'error', name: 'BattleIsResolving', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'NothingToClaim', inputs: [] },
  { type: 'error', name: 'AlreadyClaimed', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  { type: 'error', name: 'InvalidWinner', inputs: [] },

  // --- Oracle-only Write Functions ---
  {
    type: 'function',
    name: 'createBattle',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settleBattle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'winnerId', type: 'uint256' },
    ],
    outputs: [],
  },

  // --- User Write Functions ---
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
    name: 'claimPrize',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
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

  // --- View Functions ---
  {
    type: 'function',
    name: 'oracle',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'treasury',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
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
  {
    type: 'function',
    name: 'battles',
    stateMutability: 'view',
    inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [
      { name: 'exists', type: 'bool' },
      { name: 'resolving', type: 'bool' },
      { name: 'settled', type: 'bool' },
      { name: 'winnerId', type: 'uint256' },
      { name: 'totalPool', type: 'uint256' },
      { name: 'winnersPool', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'agentPools',
    stateMutability: 'view',
    inputs: [
      { name: 'battleId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // --- Constants ---
  {
    type: 'function',
    name: 'BURN_ADDRESS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'WINNERS_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'TREASURY_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'BURN_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'JACKPOT_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'TOP_BETTOR_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'jackpotPool',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'BPS_DENOMINATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // --- New Events ---
  {
    type: 'event',
    name: 'JackpotAccumulated',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newJackpotPool', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TopBettorBonusAwarded',
    inputs: [
      { name: 'battleId', type: 'bytes32', indexed: true },
      { name: 'topBettor', type: 'address', indexed: true },
      { name: 'bonus', type: 'uint256', indexed: false },
    ],
  },
] as const;
