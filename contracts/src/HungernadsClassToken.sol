// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HungernadsClassToken
/// @notice ERC20 sub-token for a specific HUNGERNADS agent class ($WARRIOR, $SURVIVOR, etc.).
///         Each class has its own token. Token holders sponsor that class, vote on strategy
///         adjustments, and share in class-specific rewards.
/// @dev    In production, these tokens would be launched on nad.fun. This contract is the
///         reference implementation that the ClassTokenManager orchestrates.
contract HungernadsClassToken is ERC20, Ownable {
    /// @notice The class ID this token represents (0=WARRIOR, 1=TRADER, 2=SURVIVOR, 3=PARASITE, 4=GAMBLER).
    uint8 public immutable classId;

    /// @notice Human-readable class name.
    string public className;

    /// @notice The ClassTokenManager that controls minting and burning.
    address public manager;

    error OnlyManager();
    error ZeroAddress();

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    /// @param _name Token name (e.g., "Hungernads Warrior")
    /// @param _symbol Token symbol (e.g., "WARRIOR")
    /// @param _classId Numeric class identifier
    /// @param _className Human-readable class name (e.g., "WARRIOR")
    /// @param _manager Address of the ClassTokenManager contract
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _classId,
        string memory _className,
        address _manager
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        if (_manager == address(0)) revert ZeroAddress();
        classId = _classId;
        className = _className;
        manager = _manager;
    }

    /// @notice Mint tokens. Only callable by the manager contract.
    /// @param to Recipient address
    /// @param amount Amount to mint
    function mint(address to, uint256 amount) external onlyManager {
        _mint(to, amount);
    }

    /// @notice Burn tokens from a holder (requires allowance). Only callable by the manager.
    /// @param from Address to burn from
    /// @param amount Amount to burn
    function burnFrom(address from, uint256 amount) external onlyManager {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    /// @notice Burn own tokens (anyone can burn their own).
    /// @param amount Amount to burn
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Update the manager address. Only callable by owner.
    /// @param _manager New manager address
    function setManager(address _manager) external onlyOwner {
        if (_manager == address(0)) revert ZeroAddress();
        manager = _manager;
    }
}
