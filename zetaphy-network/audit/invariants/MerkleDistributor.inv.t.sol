// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ZtphyMerkleDistributor} from "../../contracts/ZtphyMerkleDistributor.sol";

/// ZtphyMerkleDistributor (docs/AIRDROP.md). A real tree of N leaves (built here the way airdrop/distributor.js
/// builds it: double-hashed leaves, sorted pairs, the odd last node moved up) for N fixed accounts that start with
/// no coins. The handler claims (right and wrong proofs, amounts, accounts, indices, from random submitters),
/// batches, sweeps, aborts (guardian or not), sends more coins and moves time past start and deadline.
contract DistributorHandler is Test {
    ZtphyMerkleDistributor public d;
    uint256 public constant N = 13; // odd on purpose: the tree has promoted nodes
    address[N] public accounts;
    uint256[N] public amounts;
    bytes32[][] internal layers;
    address public immutable returnTo;
    address public immutable guardian;
    address[3] public submitters = [address(0x5B1), address(0x5B2), address(0x5B3)];

    uint256 public ghostFunded;
    uint256 public ghostPaid;
    uint256 public ghostSwept;
    mapping(uint256 => uint256) public paidCount;
    bool public wrongPaid;         // a claim that paid other than the leaf's amount to the leaf's account
    bool public sweptEarly;        // a sweep before the deadline of a round not aborted
    bool public abortedAfterClaim; // abort succeeded after a claim was paid
    bool public claimAfterClose;   // a claim paid after the deadline or abort
    mapping(bytes32 => uint256) public hits;

    constructor(address returnTo_, address guardian_) {
        returnTo = returnTo_;
        guardian = guardian_;
        for (uint256 i; i < N; i++) {
            accounts[i] = address(uint160(0xA0000 + i * 7919));
            amounts[i] = (i + 1) * 1 ether + i * 31337;
        }
        bytes32[] memory leaves = new bytes32[](N);
        for (uint256 i; i < N; i++) leaves[i] = keccak256(bytes.concat(keccak256(abi.encode(i, accounts[i], amounts[i]))));
        layers.push(leaves);
        while (layers[layers.length - 1].length > 1) {
            bytes32[] memory prev = layers[layers.length - 1];
            bytes32[] memory next = new bytes32[]((prev.length + 1) / 2);
            for (uint256 i; i < prev.length; i += 2) next[i / 2] = i + 1 < prev.length ? _pair(prev[i], prev[i + 1]) : prev[i];
            layers.push(next);
        }
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function root() external view returns (bytes32) {
        return layers[layers.length - 1][0];
    }

    function total() public view returns (uint256 t) {
        for (uint256 i; i < N; i++) t += amounts[i];
    }

    function setDistributor(ZtphyMerkleDistributor d_) external {
        d = d_;
    }

    function noteFunded(uint256 v) external {
        ghostFunded += v;
    }

    function proofOf(uint256 index) public view returns (bytes32[] memory proof) {
        uint256 n;
        for (uint256 l = 0; l + 1 < layers.length; l++) if (((index >> l) ^ 1) < layers[l].length) n++;
        proof = new bytes32[](n);
        uint256 k;
        for (uint256 l = 0; l + 1 < layers.length; l++) {
            uint256 sib = (index >> l) ^ 1;
            if (sib < layers[l].length) proof[k++] = layers[l][sib];
        }
    }

    function _bal() internal view returns (uint256[N] memory b) {
        for (uint256 i; i < N; i++) b[i] = accounts[i].balance;
    }

    function _checkPaid(uint256[N] memory before, uint256 index, uint256 amount) internal {
        for (uint256 i; i < N; i++) {
            uint256 got = accounts[i].balance - before[i];
            if (i == index ? got != amount || amount != amounts[i] : got != 0) wrongPaid = true;
        }
    }

    function claim(uint256 seed, uint256 mode, uint256 who) external {
        uint256 index = seed % N;
        address account = accounts[index];
        uint256 amount = amounts[index];
        bytes32[] memory proof = proofOf(index);
        uint256 m = mode % 6;
        if (m == 1) amount += 1 + (seed % 3);
        else if (m == 2) account = accounts[(index + 1) % N];
        else if (m == 3) index = (index + 1) % N;
        else if (m == 4 && proof.length > 0) proof[0] = bytes32(uint256(proof[0]) ^ 1);
        else if (m == 5) index = N + (seed % 300);
        bool closed = d.aborted() || block.timestamp >= d.claimDeadline();
        uint256[N] memory before = _bal();
        uint256 sb = submitters[who % 3].balance;
        vm.prank(submitters[who % 3]);
        try d.claim(index, account, amount, proof) {
            if (closed) claimAfterClose = true;
            paidCount[index]++;
            ghostPaid += amount;
            _checkPaid(before, index, amount);
            if (submitters[who % 3].balance != sb) wrongPaid = true;
            hits["claim"]++;
        } catch {
            hits["claimRevert"]++;
        }
    }

    function claimMany(uint256 seed, uint256 count, bool bad) external {
        count = bound(count, 1, 5);
        ZtphyMerkleDistributor.Claim[] memory cs = new ZtphyMerkleDistributor.Claim[](count);
        for (uint256 j; j < count; j++) {
            uint256 i = (seed + j * 5) % N;
            cs[j] = ZtphyMerkleDistributor.Claim(i, accounts[i], amounts[i] + (bad && j == count - 1 ? 1 : 0), proofOf(i));
        }
        bool[N] memory was;
        for (uint256 i; i < N; i++) was[i] = d.isClaimed(i);
        bool closed = d.aborted() || block.timestamp >= d.claimDeadline();
        uint256[N] memory before = _bal();
        vm.prank(submitters[seed % 3]);
        try d.claimMany(cs) returns (uint256) {
            if (closed) claimAfterClose = true;
            for (uint256 i; i < N; i++) {
                uint256 got = accounts[i].balance - before[i];
                if (!was[i] && d.isClaimed(i)) {
                    paidCount[i]++;
                    ghostPaid += got;
                    if (got != amounts[i]) wrongPaid = true;
                } else if (got != 0) wrongPaid = true;
            }
            hits["claimMany"]++;
        } catch {}
    }

    function sweep() external {
        bool early = !d.aborted() && block.timestamp < d.claimDeadline();
        uint256 bal = address(d).balance;
        uint256 rb = returnTo.balance;
        try d.sweep() {
            if (early) sweptEarly = true;
            if (returnTo.balance - rb != bal) wrongPaid = true;
            ghostSwept += bal;
            hits["sweep"]++;
        } catch {}
    }

    function abort(bool asGuardian) external {
        uint256 claimsBefore = d.claimCount();
        vm.prank(asGuardian ? guardian : submitters[0]);
        try d.abort() {
            if (!asGuardian || claimsBefore != 0) abortedAfterClaim = true;
            hits["abort"]++;
        } catch {}
    }

    function fund(uint256 v) external {
        v = bound(v, 1, 5 ether);
        vm.deal(address(this), v);
        (bool ok, ) = address(d).call{value: v}("");
        if (ok) ghostFunded += v;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 20 days));
    }
}

contract MerkleDistributorInvariants is Test {
    ZtphyMerkleDistributor d;
    DistributorHandler h;
    address constant RETURN_TO = address(0xF00D);
    address constant GUARDIAN = address(0x6A2D);

    function setUp() public {
        vm.warp(1_800_000_000);
        h = new DistributorHandler(RETURN_TO, GUARDIAN);
        uint256 t = h.total();
        d = new ZtphyMerkleDistributor(h.root(), t, h.N(), uint64(block.timestamp + 1 days), uint64(block.timestamp + 60 days), RETURN_TO, GUARDIAN);
        h.setDistributor(d);
        vm.deal(address(this), t);
        (bool ok, ) = address(d).call{value: t}("");
        require(ok);
        h.noteFunded(t);
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](6);
        sel[0] = h.claim.selector;
        sel[1] = h.claimMany.selector;
        sel[2] = h.sweep.selector;
        sel[3] = h.abort.selector;
        sel[4] = h.fund.selector;
        sel[5] = h.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// The handler's paths work as meant (a suite whose claims never succeed would prove nothing).
    function test_handlerPaths() public {
        h.claim(3, 0, 0);
        assertEq(h.hits("claim"), 0); // before claimStart
        h.warp(1 days);
        for (uint256 i; i < 13; i++) h.claim(i, 0, i);
        assertEq(h.hits("claim"), 13);
        for (uint256 m = 1; m < 6; m++) h.claim(5, m, 1);
        assertEq(h.hits("claim"), 13);
        h.abort(true);
        assertEq(h.hits("abort"), 0); // claims started
        h.warp(20 days); h.warp(20 days); h.warp(20 days);
        h.fund(1 ether);
        h.sweep();
        assertEq(h.hits("sweep"), 1);
        invariant_conservation();
        invariant_oncePerIndex();
        invariant_onlyLeafAccounts();
    }

    /// Coins are conserved: what was funded is either still here, paid to leaves, or swept to returnTo.
    function invariant_conservation() public view {
        assertEq(address(d).balance + h.ghostPaid() + h.ghostSwept(), h.ghostFunded());
        assertLe(h.ghostPaid(), h.total());
        assertEq(uint256(d.totalClaimed()), h.ghostPaid());
        assertLe(uint256(d.totalClaimed()), d.totalAllocated());
    }

    /// Each index is paid at most once, and exactly the claimed ones are marked; nothing exists beyond N.
    function invariant_oncePerIndex() public view {
        uint256 claimed;
        for (uint256 i; i < h.N(); i++) {
            assertLe(h.paidCount(i), 1);
            assertEq(d.isClaimed(i), h.paidCount(i) == 1);
            if (d.isClaimed(i)) claimed++;
        }
        assertEq(uint256(d.claimCount()), claimed);
        for (uint256 i = h.N(); i < h.N() + 300; i += 37) assertFalse(d.isClaimed(i));
    }

    /// Only the leaf's account receives, exactly its amount; submitters get nothing; returnTo only by sweep.
    function invariant_onlyLeafAccounts() public view {
        for (uint256 i; i < h.N(); i++) assertEq(h.accounts(i).balance, d.isClaimed(i) ? h.amounts(i) : 0);
        for (uint256 j; j < 3; j++) assertEq(h.submitters(j).balance, 0);
        assertEq(RETURN_TO.balance, h.ghostSwept());
        assertFalse(h.wrongPaid());
        assertFalse(h.sweptEarly());
        assertFalse(h.abortedAfterClaim());
        assertFalse(h.claimAfterClose());
    }
}
