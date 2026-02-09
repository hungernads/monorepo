// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HungernadsClassToken} from "./HungernadsClassToken.sol";

/// @title HungernadsClassTokenManager
/// @notice Orchestrates the agent-per-token expansion (Virtuals model). Each of the 5 agent
///         classes has its own ERC20 sub-token. Token holders can:
///         1. Buy class tokens (linear bonding curve)
///         2. Burn tokens to sponsor their class (deflationary tribalism)
///         3. Vote on strategy adjustments (token-weighted governance)
///         4. Claim class-specific rewards when their class wins battles
///
///         Creates financial tribalism: $WARRIOR vs $SURVIVOR vs $TRADER vs $PARASITE vs $GAMBLER.
///
/// @dev    Post-hackathon expansion. Ref: Virtuals Protocol agent tokenization.
contract HungernadsClassTokenManager is Ownable, ReentrancyGuard {
    // ──────────────────────────────────────────────
    //  Constants
    // ──────────────────────────────────────────────

    uint8 public constant NUM_CLASSES = 5;
    uint8 public constant WARRIOR = 0;
    uint8 public constant TRADER = 1;
    uint8 public constant SURVIVOR = 2;
    uint8 public constant PARASITE = 3;
    uint8 public constant GAMBLER = 4;

    /// @notice Base price for the bonding curve (price of the first token in wei).
    uint256 public constant BASE_PRICE = 0.001 ether;

    /// @notice Price increment per token in the bonding curve (wei per token of supply).
    uint256 public constant PRICE_INCREMENT = 0.0000001 ether;

    /// @notice Minimum voting period in seconds (3 days).
    uint256 public constant MIN_VOTING_PERIOD = 3 days;

    /// @notice Burn address for class sponsorship burns.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ──────────────────────────────────────────────
    //  Types
    // ──────────────────────────────────────────────

    /// @notice Strategy parameters that token holders can vote on.
    struct StrategyParams {
        /// @dev 0-100 scale. Higher = more aggressive predictions and attacks.
        uint8 aggressionLevel;
        /// @dev 0-100 scale. Higher = bigger stakes.
        uint8 riskTolerance;
        /// @dev 0-100 scale. Higher = more defensive play.
        uint8 defensePreference;
    }

    /// @notice A strategy proposal submitted by a token holder.
    struct Proposal {
        uint256 id;
        uint8 classId;
        address proposer;
        StrategyParams params;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 createdAt;
        uint256 votingEndsAt;
        bool executed;
        bool canceled;
    }

    /// @notice Reward epoch for distributing class-specific rewards.
    struct RewardEpoch {
        uint256 epochId;
        uint8 classId;
        uint256 totalReward;
        uint256 totalSupplyAtSnapshot;
        uint256 claimedAmount;
        uint256 createdAt;
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice Oracle address authorized to record battle results and fund rewards.
    address public oracle;

    /// @notice Class token contracts (indexed by class ID).
    HungernadsClassToken[NUM_CLASSES] public classTokens;

    /// @notice Whether all class tokens have been deployed.
    bool public initialized;

    /// @notice Current strategy parameters per class.
    mapping(uint8 => StrategyParams) public classStrategies;

    /// @notice Total ETH accumulated in each class's reward pool (unclaimed).
    mapping(uint8 => uint256) public classRewardPools;

    /// @notice Total ETH earned by each class historically.
    mapping(uint8 => uint256) public classTotalEarnings;

    /// @notice Total sponsorship burns per class (in class tokens).
    mapping(uint8 => uint256) public classSponsorshipBurns;

    /// @notice Battle win count per class.
    mapping(uint8 => uint256) public classWins;

    // ── Proposals ──
    uint256 public nextProposalId;
    mapping(uint256 => Proposal) public proposals;
    /// @dev proposalId => voter => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // ── Reward Epochs ──
    uint256 public nextRewardEpochId;
    /// @dev epochId => RewardEpoch
    mapping(uint256 => RewardEpoch) public rewardEpochs;
    /// @dev epochId => user => claimed
    mapping(uint256 => mapping(address => bool)) public rewardClaimed;
    /// @dev classId => list of reward epoch IDs
    mapping(uint8 => uint256[]) public classRewardEpochIds;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event ClassTokenDeployed(uint8 indexed classId, address indexed tokenAddress, string symbol);
    event TokensPurchased(uint8 indexed classId, address indexed buyer, uint256 amount, uint256 cost);
    event ClassSponsorship(uint8 indexed classId, address indexed sponsor, uint256 tokensBurned, string message);
    event ClassRewardFunded(uint8 indexed classId, uint256 amount, uint256 newPoolTotal);
    event ClassRewardClaimed(uint8 indexed classId, uint256 indexed epochId, address indexed claimer, uint256 amount);
    event ProposalCreated(uint256 indexed proposalId, uint8 indexed classId, address indexed proposer);
    event ProposalVoted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId, uint8 indexed classId);
    event ProposalCanceled(uint256 indexed proposalId);
    event StrategyUpdated(uint8 indexed classId, uint8 aggression, uint8 risk, uint8 defense);
    event BattleWinRecorded(uint8 indexed classId, bytes32 indexed battleId, uint256 reward);
    event OracleUpdated(address indexed previousOracle, address indexed newOracle);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error OnlyOracle();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidClassId(uint8 classId);
    error ZeroAmount();
    error InsufficientPayment(uint256 required, uint256 sent);
    error InsufficientTokenBalance(uint256 required, uint256 balance);
    error ProposalNotFound(uint256 proposalId);
    error VotingNotEnded(uint256 proposalId);
    error VotingEnded(uint256 proposalId);
    error AlreadyVoted(uint256 proposalId, address voter);
    error ProposalAlreadyExecuted(uint256 proposalId);
    error ProposalCanceledError(uint256 proposalId);
    error ProposalFailed(uint256 proposalId);
    error InvalidStrategyParam(string param, uint8 value);
    error RewardEpochNotFound(uint256 epochId);
    error RewardAlreadyClaimed(uint256 epochId, address claimer);
    error NoRewardAvailable();
    error TransferFailed();
    error ZeroAddress();

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOracle() {
        if (msg.sender != oracle) revert OnlyOracle();
        _;
    }

    modifier onlyInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    modifier validClass(uint8 classId) {
        if (classId >= NUM_CLASSES) revert InvalidClassId(classId);
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /// @param _oracle Oracle authorized to record wins and fund rewards
    constructor(address _oracle) Ownable(msg.sender) {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
        emit OracleUpdated(address(0), _oracle);
    }

    // ──────────────────────────────────────────────
    //  Initialization
    // ──────────────────────────────────────────────

    /// @notice Deploy all 5 class token contracts. Can only be called once.
    function initialize() external onlyOwner {
        if (initialized) revert AlreadyInitialized();

        string[NUM_CLASSES] memory names = [
            "Hungernads Warrior",
            "Hungernads Trader",
            "Hungernads Survivor",
            "Hungernads Parasite",
            "Hungernads Gambler"
        ];

        string[NUM_CLASSES] memory symbols = [
            "WARRIOR",
            "TRADER",
            "SURVIVOR",
            "PARASITE",
            "GAMBLER"
        ];

        string[NUM_CLASSES] memory classNames = [
            "WARRIOR",
            "TRADER",
            "SURVIVOR",
            "PARASITE",
            "GAMBLER"
        ];

        for (uint8 i = 0; i < NUM_CLASSES; i++) {
            HungernadsClassToken token = new HungernadsClassToken(
                names[i],
                symbols[i],
                i,
                classNames[i],
                address(this)
            );
            classTokens[i] = token;

            // Set default strategy: balanced (50/50/50)
            classStrategies[i] = StrategyParams({
                aggressionLevel: 50,
                riskTolerance: 50,
                defensePreference: 50
            });

            emit ClassTokenDeployed(i, address(token), symbols[i]);
        }

        initialized = true;
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    /// @notice Update the oracle address.
    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        address prev = oracle;
        oracle = _oracle;
        emit OracleUpdated(prev, _oracle);
    }

    // ──────────────────────────────────────────────
    //  Token Purchase (Bonding Curve)
    // ──────────────────────────────────────────────

    /// @notice Buy class tokens using a linear bonding curve.
    ///         Price = BASE_PRICE + (currentSupply * PRICE_INCREMENT) per token.
    ///         The total cost for `amount` tokens is the integral under the curve.
    /// @param classId The class to buy tokens for
    /// @param amount Number of tokens to buy (in whole tokens, scaled to 18 decimals internally)
    function buyTokens(uint8 classId, uint256 amount) external payable nonReentrant onlyInitialized validClass(classId) {
        if (amount == 0) revert ZeroAmount();

        uint256 cost = getBuyCost(classId, amount);
        if (msg.value < cost) revert InsufficientPayment(cost, msg.value);

        // Mint tokens to buyer
        classTokens[classId].mint(msg.sender, amount * 1e18);

        // Refund excess ETH
        uint256 excess = msg.value - cost;
        if (excess > 0) {
            _safeTransfer(msg.sender, excess);
        }

        emit TokensPurchased(classId, msg.sender, amount, cost);
    }

    /// @notice Calculate the cost to buy `amount` tokens for a class.
    ///         Uses trapezoidal integration over the linear bonding curve.
    /// @param classId The class
    /// @param amount Number of whole tokens to buy
    /// @return Total cost in wei
    function getBuyCost(uint8 classId, uint256 amount) public view onlyInitialized validClass(classId) returns (uint256) {
        uint256 currentSupply = classTokens[classId].totalSupply() / 1e18;
        // Cost = sum from i=0 to amount-1 of (BASE_PRICE + (currentSupply + i) * PRICE_INCREMENT)
        // = amount * BASE_PRICE + PRICE_INCREMENT * (amount * currentSupply + amount*(amount-1)/2)
        uint256 baseCost = amount * BASE_PRICE;
        uint256 incrementalCost = PRICE_INCREMENT * (amount * currentSupply + (amount * (amount - 1)) / 2);
        return baseCost + incrementalCost;
    }

    // ──────────────────────────────────────────────
    //  Class Sponsorship (Burn-to-Boost)
    // ──────────────────────────────────────────────

    /// @notice Burn class tokens to sponsor/boost that agent class.
    ///         Creates deflationary pressure and shows tribal loyalty.
    ///         Tokens are burned (permanently removed from supply).
    /// @param classId The class to sponsor
    /// @param tokenAmount Amount of class tokens to burn (in 18-decimal units)
    /// @param message Public sponsorship message
    function sponsorClass(
        uint8 classId,
        uint256 tokenAmount,
        string calldata message
    ) external onlyInitialized validClass(classId) {
        if (tokenAmount == 0) revert ZeroAmount();

        HungernadsClassToken token = classTokens[classId];
        uint256 balance = token.balanceOf(msg.sender);
        if (balance < tokenAmount) revert InsufficientTokenBalance(tokenAmount, balance);

        // Burn the tokens (requires caller to have approved this contract)
        token.burnFrom(msg.sender, tokenAmount);
        classSponsorshipBurns[classId] += tokenAmount;

        emit ClassSponsorship(classId, msg.sender, tokenAmount, message);
    }

    // ──────────────────────────────────────────────
    //  Battle Rewards (Oracle-funded)
    // ──────────────────────────────────────────────

    /// @notice Record a class battle win and fund the class reward pool.
    ///         Called by the oracle after a battle is settled.
    /// @param classId The winning class
    /// @param battleId The battle that was won
    function recordClassWin(
        uint8 classId,
        bytes32 battleId
    ) external payable onlyOracle onlyInitialized validClass(classId) {
        classWins[classId]++;

        if (msg.value > 0) {
            classRewardPools[classId] += msg.value;
            classTotalEarnings[classId] += msg.value;

            // Create a reward epoch for this distribution
            uint256 epochId = nextRewardEpochId++;
            uint256 supply = classTokens[classId].totalSupply();

            rewardEpochs[epochId] = RewardEpoch({
                epochId: epochId,
                classId: classId,
                totalReward: msg.value,
                totalSupplyAtSnapshot: supply,
                claimedAmount: 0,
                createdAt: block.timestamp
            });
            classRewardEpochIds[classId].push(epochId);

            emit ClassRewardFunded(classId, msg.value, classRewardPools[classId]);
        }

        emit BattleWinRecorded(classId, battleId, msg.value);
    }

    /// @notice Claim rewards from a specific reward epoch.
    ///         Payout is proportional to token balance vs total supply at snapshot.
    /// @param epochId The reward epoch to claim from
    function claimReward(uint256 epochId) external nonReentrant onlyInitialized {
        RewardEpoch storage epoch = rewardEpochs[epochId];
        if (epoch.createdAt == 0) revert RewardEpochNotFound(epochId);
        if (rewardClaimed[epochId][msg.sender]) revert RewardAlreadyClaimed(epochId, msg.sender);

        uint8 classId = epoch.classId;
        HungernadsClassToken token = classTokens[classId];
        uint256 holderBalance = token.balanceOf(msg.sender);

        if (holderBalance == 0 || epoch.totalSupplyAtSnapshot == 0) revert NoRewardAvailable();

        // Calculate proportional reward
        uint256 reward = (epoch.totalReward * holderBalance) / epoch.totalSupplyAtSnapshot;
        if (reward == 0) revert NoRewardAvailable();

        // Cap at remaining pool
        uint256 remaining = epoch.totalReward - epoch.claimedAmount;
        if (reward > remaining) {
            reward = remaining;
        }

        rewardClaimed[epochId][msg.sender] = true;
        epoch.claimedAmount += reward;
        classRewardPools[classId] -= reward;

        _safeTransfer(msg.sender, reward);

        emit ClassRewardClaimed(classId, epochId, msg.sender, reward);
    }

    // ──────────────────────────────────────────────
    //  Strategy Voting
    // ──────────────────────────────────────────────

    /// @notice Create a strategy proposal for a class. Must hold class tokens.
    /// @param classId The class to propose for
    /// @param params The proposed strategy parameters
    /// @param votingDuration How long voting lasts (seconds, minimum MIN_VOTING_PERIOD)
    /// @return proposalId The created proposal's ID
    function createProposal(
        uint8 classId,
        StrategyParams calldata params,
        uint256 votingDuration
    ) external onlyInitialized validClass(classId) returns (uint256) {
        // Validate strategy params are in 0-100 range
        if (params.aggressionLevel > 100) revert InvalidStrategyParam("aggressionLevel", params.aggressionLevel);
        if (params.riskTolerance > 100) revert InvalidStrategyParam("riskTolerance", params.riskTolerance);
        if (params.defensePreference > 100) revert InvalidStrategyParam("defensePreference", params.defensePreference);

        // Must hold tokens to propose
        uint256 balance = classTokens[classId].balanceOf(msg.sender);
        if (balance == 0) revert InsufficientTokenBalance(1, 0);

        if (votingDuration < MIN_VOTING_PERIOD) {
            votingDuration = MIN_VOTING_PERIOD;
        }

        uint256 proposalId = nextProposalId++;
        proposals[proposalId] = Proposal({
            id: proposalId,
            classId: classId,
            proposer: msg.sender,
            params: params,
            votesFor: 0,
            votesAgainst: 0,
            createdAt: block.timestamp,
            votingEndsAt: block.timestamp + votingDuration,
            executed: false,
            canceled: false
        });

        emit ProposalCreated(proposalId, classId, msg.sender);
        return proposalId;
    }

    /// @notice Vote on a strategy proposal. Weight = token balance.
    /// @param proposalId The proposal to vote on
    /// @param support True = vote for, false = vote against
    function vote(uint256 proposalId, bool support) external onlyInitialized {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        if (p.canceled) revert ProposalCanceledError(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        if (block.timestamp >= p.votingEndsAt) revert VotingEnded(proposalId);
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted(proposalId, msg.sender);

        uint256 weight = classTokens[p.classId].balanceOf(msg.sender);
        if (weight == 0) revert InsufficientTokenBalance(1, 0);

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit ProposalVoted(proposalId, msg.sender, support, weight);
    }

    /// @notice Execute a proposal after voting ends (if it passed).
    /// @param proposalId The proposal to execute
    function executeProposal(uint256 proposalId) external onlyInitialized {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        if (p.canceled) revert ProposalCanceledError(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        if (block.timestamp < p.votingEndsAt) revert VotingNotEnded(proposalId);
        if (p.votesFor <= p.votesAgainst) revert ProposalFailed(proposalId);

        p.executed = true;
        classStrategies[p.classId] = p.params;

        emit ProposalExecuted(proposalId, p.classId);
        emit StrategyUpdated(
            p.classId,
            p.params.aggressionLevel,
            p.params.riskTolerance,
            p.params.defensePreference
        );
    }

    /// @notice Cancel a proposal. Only proposer or owner can cancel.
    /// @param proposalId The proposal to cancel
    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        require(msg.sender == p.proposer || msg.sender == owner(), "Not authorized");

        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    // ──────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────

    /// @notice Get the token address for a class.
    function getClassToken(uint8 classId) external view validClass(classId) returns (address) {
        return address(classTokens[classId]);
    }

    /// @notice Get current strategy parameters for a class.
    function getClassStrategy(uint8 classId) external view validClass(classId) returns (StrategyParams memory) {
        return classStrategies[classId];
    }

    /// @notice Get class stats: wins, total earnings, current reward pool, sponsorship burns.
    function getClassStats(uint8 classId) external view validClass(classId) returns (
        uint256 wins,
        uint256 totalEarnings,
        uint256 currentRewardPool,
        uint256 totalSponsorshipBurns,
        uint256 tokenSupply
    ) {
        wins = classWins[classId];
        totalEarnings = classTotalEarnings[classId];
        currentRewardPool = classRewardPools[classId];
        totalSponsorshipBurns = classSponsorshipBurns[classId];
        tokenSupply = initialized ? classTokens[classId].totalSupply() : 0;
    }

    /// @notice Get reward epoch IDs for a class.
    function getClassRewardEpochIds(uint8 classId) external view validClass(classId) returns (uint256[] memory) {
        return classRewardEpochIds[classId];
    }

    /// @notice Get a reward epoch's details.
    function getRewardEpoch(uint256 epochId) external view returns (RewardEpoch memory) {
        return rewardEpochs[epochId];
    }

    /// @notice Calculate a user's claimable reward for a specific epoch.
    function getClaimableReward(uint256 epochId, address user) external view returns (uint256) {
        RewardEpoch storage epoch = rewardEpochs[epochId];
        if (epoch.createdAt == 0) return 0;
        if (rewardClaimed[epochId][user]) return 0;

        uint256 balance = classTokens[epoch.classId].balanceOf(user);
        if (balance == 0 || epoch.totalSupplyAtSnapshot == 0) return 0;

        uint256 reward = (epoch.totalReward * balance) / epoch.totalSupplyAtSnapshot;
        uint256 remaining = epoch.totalReward - epoch.claimedAmount;
        return reward > remaining ? remaining : reward;
    }

    /// @notice Get a proposal's details.
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /// @notice Get the current token price for a class (price of the next token).
    function getCurrentPrice(uint8 classId) external view onlyInitialized validClass(classId) returns (uint256) {
        uint256 currentSupply = classTokens[classId].totalSupply() / 1e18;
        return BASE_PRICE + currentSupply * PRICE_INCREMENT;
    }

    // ──────────────────────────────────────────────
    //  Internal
    // ──────────────────────────────────────────────

    function _safeTransfer(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Allow contract to receive ETH for reward funding.
    receive() external payable {}
}
