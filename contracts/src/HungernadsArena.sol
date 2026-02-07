// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HungernadsArena
/// @notice On-chain battle registry and result recorder for the HUNGERNADS colosseum.
///         An authorized oracle (the off-chain worker) registers battles and records
///         outcomes. All battle history and agent stats are publicly queryable.
/// @dev    Targeting Monad testnet (EVM-compatible, standard Solidity).
contract HungernadsArena is Ownable {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum BattleState {
        None,       // default / non-existent
        Created,
        Active,
        Completed
    }

    /// @notice Per-agent result for a completed battle.
    struct AgentResult {
        uint256 agentId;
        uint256 finalHp;
        uint256 kills;
        uint256 survivedEpochs;
        bool isWinner;
    }

    struct Battle {
        bytes32 battleId;
        BattleState state;
        uint256[] agentIds;
        uint256 winnerId;
        uint256 createdAt;
        uint256 completedAt;
    }

    /// @notice Cumulative on-chain stats for a registered agent.
    struct AgentStats {
        uint256 wins;
        uint256 losses;
        uint256 kills;
        uint256 totalBattles;
        uint256 totalEpochsSurvived;
        bool exists;
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// @notice Authorized oracle address (worker that writes results).
    address public oracle;

    /// @notice battleId => Battle metadata.
    mapping(bytes32 => Battle) public battles;

    /// @notice battleId => agentId => AgentResult (only populated after completion).
    mapping(bytes32 => mapping(uint256 => AgentResult)) public battleResults;

    /// @notice agentId => cumulative AgentStats.
    mapping(uint256 => AgentStats) public agentStats;

    /// @notice Ordered list of all battle IDs for enumeration.
    bytes32[] public battleIds;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event OracleUpdated(address indexed previousOracle, address indexed newOracle);
    event AgentRegistered(uint256 indexed agentId);
    event BattleCreated(bytes32 indexed battleId, uint256[] agentIds);
    event BattleActivated(bytes32 indexed battleId);
    event AgentEliminated(bytes32 indexed battleId, uint256 indexed agentId, uint256 finalHp, uint256 kills);
    event BattleCompleted(bytes32 indexed battleId, uint256 indexed winnerId);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error OnlyOracle();
    error BattleAlreadyExists(bytes32 battleId);
    error BattleNotFound(bytes32 battleId);
    error InvalidBattleState(bytes32 battleId, BattleState current, BattleState expected);
    error InvalidAgentCount();
    error ResultAgentMismatch(bytes32 battleId);
    error ZeroAddress();

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyOracle() {
        if (msg.sender != oracle) revert OnlyOracle();
        _;
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param _oracle Initial oracle address that can register battles and record results.
    constructor(address _oracle) Ownable(msg.sender) {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
        emit OracleUpdated(address(0), _oracle);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /// @notice Update the oracle address. Only callable by owner.
    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        address previous = oracle;
        oracle = _oracle;
        emit OracleUpdated(previous, _oracle);
    }

    // -----------------------------------------------------------------------
    // Battle Lifecycle (oracle-only)
    // -----------------------------------------------------------------------

    /// @notice Register a new battle with the given agent IDs. Creates the battle
    ///         in `Created` state. Agents that haven't been seen before are auto-registered.
    /// @param _battleId Unique identifier for the battle.
    /// @param _agentIds Array of agent IDs participating (must be >= 2).
    function registerBattle(bytes32 _battleId, uint256[] calldata _agentIds) external onlyOracle {
        if (battles[_battleId].state != BattleState.None) {
            revert BattleAlreadyExists(_battleId);
        }
        if (_agentIds.length < 2) revert InvalidAgentCount();

        battles[_battleId] = Battle({
            battleId: _battleId,
            state: BattleState.Created,
            agentIds: _agentIds,
            winnerId: 0,
            createdAt: block.timestamp,
            completedAt: 0
        });
        battleIds.push(_battleId);

        // Auto-register agents that haven't been seen before
        for (uint256 i = 0; i < _agentIds.length; i++) {
            if (!agentStats[_agentIds[i]].exists) {
                agentStats[_agentIds[i]].exists = true;
                emit AgentRegistered(_agentIds[i]);
            }
        }

        emit BattleCreated(_battleId, _agentIds);
    }

    /// @notice Transition a battle from Created to Active.
    /// @param _battleId The battle to activate.
    function activateBattle(bytes32 _battleId) external onlyOracle {
        Battle storage b = battles[_battleId];
        if (b.state == BattleState.None) revert BattleNotFound(_battleId);
        if (b.state != BattleState.Created) {
            revert InvalidBattleState(_battleId, b.state, BattleState.Created);
        }
        b.state = BattleState.Active;
        emit BattleActivated(_battleId);
    }

    /// @notice Record the outcome of a battle. Transitions from Active to Completed.
    /// @param _battleId The battle to complete.
    /// @param _winnerId The agent that won.
    /// @param _results Per-agent results (must match the registered agent set).
    function recordResult(
        bytes32 _battleId,
        uint256 _winnerId,
        AgentResult[] calldata _results
    ) external onlyOracle {
        Battle storage b = battles[_battleId];
        if (b.state == BattleState.None) revert BattleNotFound(_battleId);
        if (b.state != BattleState.Active) {
            revert InvalidBattleState(_battleId, b.state, BattleState.Active);
        }
        if (_results.length != b.agentIds.length) {
            revert ResultAgentMismatch(_battleId);
        }

        b.state = BattleState.Completed;
        b.winnerId = _winnerId;
        b.completedAt = block.timestamp;

        for (uint256 i = 0; i < _results.length; i++) {
            AgentResult calldata r = _results[i];
            battleResults[_battleId][r.agentId] = r;

            // Update cumulative agent stats
            AgentStats storage stats = agentStats[r.agentId];
            stats.totalBattles++;
            stats.kills += r.kills;
            stats.totalEpochsSurvived += r.survivedEpochs;

            if (r.isWinner) {
                stats.wins++;
            } else {
                stats.losses++;
                emit AgentEliminated(_battleId, r.agentId, r.finalHp, r.kills);
            }
        }

        emit BattleCompleted(_battleId, _winnerId);
    }

    // -----------------------------------------------------------------------
    // View Functions
    // -----------------------------------------------------------------------

    /// @notice Get full battle data including agent IDs.
    function getBattle(bytes32 _battleId) external view returns (Battle memory) {
        return battles[_battleId];
    }

    /// @notice Get the per-agent result for a specific battle.
    function getBattleResult(bytes32 _battleId, uint256 _agentId) external view returns (AgentResult memory) {
        return battleResults[_battleId][_agentId];
    }

    /// @notice Get cumulative stats for an agent.
    function getAgentStats(uint256 _agentId) external view returns (AgentStats memory) {
        return agentStats[_agentId];
    }

    /// @notice Total number of battles registered.
    function getBattleCount() external view returns (uint256) {
        return battleIds.length;
    }

    /// @notice Get agent IDs for a battle.
    function getBattleAgents(bytes32 _battleId) external view returns (uint256[] memory) {
        return battles[_battleId].agentIds;
    }

    /// @notice Get a page of battle IDs for enumeration.
    /// @param _offset Starting index.
    /// @param _limit Max number of IDs to return.
    function getBattleIds(uint256 _offset, uint256 _limit) external view returns (bytes32[] memory) {
        uint256 total = battleIds.length;
        if (_offset >= total) {
            return new bytes32[](0);
        }
        uint256 end = _offset + _limit;
        if (end > total) end = total;
        uint256 count = end - _offset;

        bytes32[] memory ids = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = battleIds[_offset + i];
        }
        return ids;
    }
}
