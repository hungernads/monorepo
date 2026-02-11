// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {HungernadsArena} from "../src/HungernadsArena.sol";
import {HungernadsBetting} from "../src/HungernadsBetting.sol";

/// @title Upgrade
/// @notice Template for upgrading UUPS proxy contracts.
///         Deploy a new implementation and call upgradeToAndCall on the proxy.
///
/// @dev Usage:
///   PROXY_ADDRESS=0x... forge script script/Upgrade.s.sol:UpgradeArena \
///     --rpc-url $MONAD_RPC_URL \
///     --broadcast \
///     --private-key $DEPLOYER_KEY \
///     -vvvv
contract UpgradeArena is Script {
    function run() external {
        address proxy = vm.envAddress("PROXY_ADDRESS");

        console2.log("=== Upgrade Arena ===");
        console2.log("Proxy:", proxy);

        vm.startBroadcast();

        // Deploy new implementation
        HungernadsArena newImpl = new HungernadsArena();
        console2.log("New implementation:", address(newImpl));

        // Upgrade proxy to new implementation (no migration data)
        UUPSUpgradeable(proxy).upgradeToAndCall(address(newImpl), "");
        console2.log("Upgrade complete!");

        vm.stopBroadcast();
    }
}

contract UpgradeBetting is Script {
    function run() external {
        address proxy = vm.envAddress("PROXY_ADDRESS");

        console2.log("=== Upgrade Betting ===");
        console2.log("Proxy:", proxy);

        vm.startBroadcast();

        // Deploy new implementation
        HungernadsBetting newImpl = new HungernadsBetting();
        console2.log("New implementation:", address(newImpl));

        // Upgrade proxy to new implementation (no migration data)
        UUPSUpgradeable(proxy).upgradeToAndCall(address(newImpl), "");
        console2.log("Upgrade complete!");

        vm.stopBroadcast();
    }
}
