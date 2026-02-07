// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HungernadsArena} from "../src/HungernadsArena.sol";
import {HungernadsBetting} from "../src/HungernadsBetting.sol";

/// @title Deploy
/// @notice Deploys HungernadsArena and HungernadsBetting to Monad testnet
///         and wires them together (shared oracle, treasury config).
///
/// @dev Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $MONAD_RPC_URL \
///     --broadcast \
///     --private-key $DEPLOYER_KEY \
///     -vvvv
///
///   Environment variables:
///     ORACLE_ADDRESS   - Address authorized to write battle results (Worker wallet).
///                        Falls back to deployer if not set.
///     TREASURY_ADDRESS - Address receiving the 5% treasury cut.
///                        Falls back to deployer if not set.
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address oracle = vm.envOr("ORACLE_ADDRESS", deployer);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        console2.log("=== HUNGERNADS Deployment ===");
        console2.log("Deployer: ", deployer);
        console2.log("Oracle:   ", oracle);
        console2.log("Treasury: ", treasury);
        console2.log("");

        vm.startBroadcast();

        // 1. Deploy Arena (oracle writes results, deployer is Ownable owner)
        HungernadsArena arena = new HungernadsArena(oracle);
        console2.log("HungernadsArena deployed at:", address(arena));
        console2.log("  owner: ", arena.owner());
        console2.log("  oracle:", arena.oracle());

        // 2. Deploy Betting (oracle settles battles, treasury gets 5% cut)
        HungernadsBetting betting = new HungernadsBetting(oracle, treasury);
        console2.log("HungernadsBetting deployed at:", address(betting));
        console2.log("  oracle:  ", betting.oracle());
        console2.log("  treasury:", betting.treasury());

        vm.stopBroadcast();

        // --- Post-deployment instructions ---
        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("Arena:   ", address(arena));
        console2.log("Betting: ", address(betting));
        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. wrangler secret put ARENA_CONTRACT_ADDRESS");
        console2.log("  2. wrangler secret put BETTING_CONTRACT_ADDRESS");
        console2.log("  3. Fund Worker wallet on Monad testnet for gas");
    }
}
