// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Test-only recipients for ZtphyMerkleDistributor (test/distributor.test.js); never under contracts/.

interface IDistributor {
    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) external;
    function sweep() external;
    function abort() external;
}

/// On receiving coins, tries to claim the same leaf again, then to sweep; records what happened.
contract ReenteringClaimer {
    IDistributor public d;
    uint256 public index;
    uint256 public amount;
    bytes32[] public proof;
    uint256 public received;
    uint256 public calls;
    bool public reentryPaid;
    bool public sweepWorked;
    bytes public reentryError;

    function arm(IDistributor d_, uint256 index_, uint256 amount_, bytes32[] calldata proof_) external {
        d = d_;
        index = index_;
        amount = amount_;
        proof = proof_;
    }

    receive() external payable {
        received += msg.value;
        calls++;
        if (calls > 1) return;
        try d.claim(index, address(this), amount, proof) { reentryPaid = true; } catch (bytes memory e) { reentryError = e; }
        try d.sweep() { sweepWorked = true; } catch {}
    }
}

/// Refuses coins.
contract RefusingClaimer {
    receive() external payable {
        revert("no");
    }
}

/// A returnTo that refuses coins (sweep must fail, keep the coins).
contract RefusingReturn {
    receive() external payable {
        revert("no");
    }
}
