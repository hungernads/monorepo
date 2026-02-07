// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HungernadsBetting
/// @notice On-chain betting and sponsorship contract for HUNGERNADS AI gladiator battles.
/// @dev Withdraw pattern: winners claim prizes after settlement. 90/5/5 split (winners/treasury/burn).
contract HungernadsBetting is ReentrancyGuard {
    // ──────────────────────────────────────────────
    //  Constants
    // ──────────────────────────────────────────────

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public constant WINNERS_BPS = 9000; // 90%
    uint256 public constant TREASURY_BPS = 500; // 5%
    uint256 public constant BURN_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    address public oracle;
    address public treasury;

    struct Bet {
        uint256 agentId;
        uint256 amount;
    }

    struct Battle {
        bool exists;
        bool resolving; // locked for settlement
        bool settled;
        uint256 winnerId;
        uint256 totalPool;
        uint256 winnersPool; // 90% share allocated to winners after settlement
    }

    /// @dev battleId => Battle
    mapping(bytes32 => Battle) public battles;

    /// @dev battleId => agentId => total amount bet on that agent
    mapping(bytes32 => mapping(uint256 => uint256)) public agentPools;

    /// @dev battleId => user => array of bets placed
    mapping(bytes32 => mapping(address => Bet[])) internal _userBets;

    /// @dev battleId => user => claimable prize (set during settlement)
    mapping(bytes32 => mapping(address => uint256)) public claimable;

    /// @dev battleId => user => whether they already claimed
    mapping(bytes32 => mapping(address => bool)) public claimed;

    /// @dev battleId => list of unique bettors who bet on winning agent (used during settlement)
    mapping(bytes32 => mapping(uint256 => address[])) internal _agentBettors;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event BattleCreated(bytes32 indexed battleId);
    event BetPlaced(bytes32 indexed battleId, address indexed user, uint256 agentId, uint256 amount);
    event BattleSettled(bytes32 indexed battleId, uint256 winnerId, uint256 totalPool);
    event PrizeDistributed(bytes32 indexed battleId, address indexed user, uint256 amount);
    event SponsorshipSent(bytes32 indexed battleId, uint256 indexed agentId, address indexed user, uint256 amount, string message);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error OnlyOracle();
    error BattleDoesNotExist();
    error BattleAlreadyExists();
    error BattleAlreadySettled();
    error BattleIsResolving();
    error ZeroAmount();
    error NothingToClaim();
    error AlreadyClaimed();
    error TransferFailed();
    error InvalidWinner();

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOracle() {
        if (msg.sender != oracle) revert OnlyOracle();
        _;
    }

    modifier battleExists(bytes32 battleId) {
        if (!battles[battleId].exists) revert BattleDoesNotExist();
        _;
    }

    modifier battleOpen(bytes32 battleId) {
        Battle storage b = battles[battleId];
        if (!b.exists) revert BattleDoesNotExist();
        if (b.resolving) revert BattleIsResolving();
        if (b.settled) revert BattleAlreadySettled();
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /// @param _oracle Address authorized to create/settle battles
    /// @param _treasury Address that receives the 5% treasury cut
    constructor(address _oracle, address _treasury) {
        oracle = _oracle;
        treasury = _treasury;
    }

    // ──────────────────────────────────────────────
    //  Oracle Functions
    // ──────────────────────────────────────────────

    /// @notice Create a new battle. Only oracle can call.
    /// @param battleId Unique identifier for the battle
    function createBattle(bytes32 battleId) external onlyOracle {
        if (battles[battleId].exists) revert BattleAlreadyExists();
        battles[battleId].exists = true;
        emit BattleCreated(battleId);
    }

    /// @notice Settle a battle by declaring the winning agent. Distributes treasury and burn cuts immediately.
    ///         Winners must claim their prizes via claimPrize().
    /// @param battleId The battle to settle
    /// @param winnerId The winning agent's ID
    function settleBattle(bytes32 battleId, uint256 winnerId) external onlyOracle battleExists(battleId) {
        Battle storage b = battles[battleId];
        if (b.settled) revert BattleAlreadySettled();
        if (b.resolving) revert BattleIsResolving();

        b.resolving = true;
        b.winnerId = winnerId;

        uint256 pool = b.totalPool;

        if (pool > 0) {
            uint256 treasuryCut = (pool * TREASURY_BPS) / BPS_DENOMINATOR;
            uint256 burnCut = (pool * BURN_BPS) / BPS_DENOMINATOR;
            uint256 winnersCut = pool - treasuryCut - burnCut;
            b.winnersPool = winnersCut;

            // Compute claimable amounts for each winning bettor
            _distributeWinnings(battleId, winnerId, winnersCut);

            // Transfer treasury and burn cuts
            _safeTransfer(treasury, treasuryCut);
            _safeTransfer(BURN_ADDRESS, burnCut);
        }

        b.settled = true;
        b.resolving = false;

        emit BattleSettled(battleId, winnerId, pool);
    }

    // ──────────────────────────────────────────────
    //  User Functions
    // ──────────────────────────────────────────────

    /// @notice Place a bet on an agent in a battle.
    /// @param battleId The battle to bet on
    /// @param agentId The agent to bet on
    function placeBet(bytes32 battleId, uint256 agentId) external payable battleOpen(battleId) {
        if (msg.value == 0) revert ZeroAmount();

        Battle storage b = battles[battleId];
        b.totalPool += msg.value;
        agentPools[battleId][agentId] += msg.value;

        // Track if this is the user's first bet on this agent (for settlement iteration)
        if (_getUserBetOnAgent(battleId, msg.sender, agentId) == 0) {
            _agentBettors[battleId][agentId].push(msg.sender);
        }

        _userBets[battleId][msg.sender].push(Bet({agentId: agentId, amount: msg.value}));

        emit BetPlaced(battleId, msg.sender, agentId, msg.value);
    }

    /// @notice Claim winnings from a settled battle. Uses withdraw pattern with reentrancy guard.
    /// @param battleId The battle to claim from
    function claimPrize(bytes32 battleId) external nonReentrant battleExists(battleId) {
        Battle storage b = battles[battleId];
        if (!b.settled) revert BattleDoesNotExist(); // not settled yet
        if (claimed[battleId][msg.sender]) revert AlreadyClaimed();

        uint256 amount = claimable[battleId][msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimed[battleId][msg.sender] = true;
        claimable[battleId][msg.sender] = 0;

        _safeTransfer(msg.sender, amount);

        emit PrizeDistributed(battleId, msg.sender, amount);
    }

    /// @notice Sponsor an agent in a battle. Sponsorship amount goes to the battle pool.
    /// @param battleId The battle
    /// @param agentId The agent to sponsor
    /// @param message Public message from the sponsor
    function sponsorAgent(bytes32 battleId, uint256 agentId, string calldata message) external payable battleOpen(battleId) {
        if (msg.value == 0) revert ZeroAmount();

        Battle storage b = battles[battleId];
        b.totalPool += msg.value;

        emit SponsorshipSent(battleId, agentId, msg.sender, msg.value, message);
    }

    // ──────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────

    /// @notice Get total pool size for a battle.
    function getBattlePool(bytes32 battleId) external view returns (uint256) {
        return battles[battleId].totalPool;
    }

    /// @notice Get all bets placed by a user in a battle.
    function getUserBets(bytes32 battleId, address user) external view returns (Bet[] memory) {
        return _userBets[battleId][user];
    }

    /// @notice Get total amount bet on each agent. Returns parallel arrays of agentIds and their pools.
    /// @dev Since we don't track all agentIds, caller provides the agent IDs to query.
    function getOdds(bytes32 battleId, uint256[] calldata agentIds) external view returns (uint256[] memory pools) {
        pools = new uint256[](agentIds.length);
        for (uint256 i = 0; i < agentIds.length; i++) {
            pools[i] = agentPools[battleId][agentIds[i]];
        }
    }

    // ──────────────────────────────────────────────
    //  Internal
    // ──────────────────────────────────────────────

    /// @dev Distribute the winners' share among all bettors who backed the winning agent.
    ///      Extracted from settleBattle to avoid stack-too-deep errors.
    function _distributeWinnings(bytes32 battleId, uint256 winnerId, uint256 winnersCut) internal {
        uint256 winningAgentPool = agentPools[battleId][winnerId];
        if (winningAgentPool == 0) return; // No one bet on winner; winnersCut stays unclaimed

        address[] storage bettors = _agentBettors[battleId][winnerId];
        for (uint256 i = 0; i < bettors.length; i++) {
            address bettor = bettors[i];
            uint256 userWinBet = _getUserBetOnAgent(battleId, bettor, winnerId);
            if (userWinBet > 0) {
                claimable[battleId][bettor] = (winnersCut * userWinBet) / winningAgentPool;
            }
        }
    }

    /// @dev Sum all bets a user placed on a specific agent in a battle.
    function _getUserBetOnAgent(bytes32 battleId, address user, uint256 agentId) internal view returns (uint256 total) {
        Bet[] storage bets = _userBets[battleId][user];
        for (uint256 i = 0; i < bets.length; i++) {
            if (bets[i].agentId == agentId) {
                total += bets[i].amount;
            }
        }
    }

    /// @dev Transfer native token with revert on failure.
    function _safeTransfer(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
