// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {HungernadsArena} from "../src/HungernadsArena.sol";
import {HungernadsBetting} from "../src/HungernadsBetting.sol";

/// @title Deploy
/// @notice Deploys UUPS proxy contracts for HungernadsArena and HungernadsBetting.
///         Each contract is deployed as: Implementation (logic) + ERC1967Proxy (state).
///         The proxy address is the permanent address used by all integrations.
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

        console2.log("=== HUNGERNADS Proxy Deployment ===");
        console2.log("Deployer: ", deployer);
        console2.log("Oracle:   ", oracle);
        console2.log("Treasury: ", treasury);
        console2.log("");

        vm.startBroadcast();

        // 1. Deploy Arena implementation (no constructor args — has _disableInitializers)
        HungernadsArena arenaImpl = new HungernadsArena();
        console2.log("Arena implementation:", address(arenaImpl));

        // 2. Deploy Arena proxy with initializer call
        ERC1967Proxy arenaProxy = new ERC1967Proxy(
            address(arenaImpl),
            abi.encodeCall(HungernadsArena.initialize, (oracle))
        );
        HungernadsArena arena = HungernadsArena(address(arenaProxy));
        console2.log("Arena proxy:         ", address(arena));
        console2.log("  owner: ", arena.owner());
        console2.log("  oracle:", arena.oracle());

        // 3. Deploy Betting implementation
        HungernadsBetting bettingImpl = new HungernadsBetting();
        console2.log("Betting implementation:", address(bettingImpl));

        // 4. Deploy Betting proxy with initializer call
        ERC1967Proxy bettingProxy = new ERC1967Proxy(
            address(bettingImpl),
            abi.encodeCall(HungernadsBetting.initialize, (oracle, treasury))
        );
        HungernadsBetting betting = HungernadsBetting(address(bettingProxy));
        console2.log("Betting proxy:       ", address(betting));
        console2.log("  owner:   ", betting.owner());
        console2.log("  oracle:  ", betting.oracle());
        console2.log("  treasury:", betting.treasury());

        vm.stopBroadcast();

        // --- Post-deployment instructions ---
        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("ARENA PROXY:   ", address(arena));
        console2.log("BETTING PROXY: ", address(betting));
        console2.log("");
        console2.log("These proxy addresses are PERMANENT. Future upgrades use upgradeTo().");
        console2.log("");
        console2.log("Next steps:");
        console2.log("  1. wrangler secret put ARENA_CONTRACT_ADDRESS  (use proxy address)");
        console2.log("  2. wrangler secret put BETTING_CONTRACT_ADDRESS (use proxy address)");
        console2.log("  3. Update dashboard .env.local with proxy addresses");
        console2.log("  4. Verify contracts on Monad explorer");
    }
}
