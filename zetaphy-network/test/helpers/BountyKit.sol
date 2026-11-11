// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Test-only proof-of-exploit verifier for ZetaphyBounty: proof 0x01 is "valid" and supports 50 ETH; anything else
/// is not. (No real verifier exists yet; this stands for a future one.)
contract MockExploitVerifier {
    function verify(uint256, bytes32, address, bytes calldata proof) external pure returns (bool valid, uint256 amount) {
        if (proof.length == 1 && proof[0] == 0x01) return (true, 50 ether);
        return (false, 0);
    }
}
