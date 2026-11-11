// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HyperlaneLockBoxV2, ISaphanMailbox, ISaphanIsm} from "../../contracts/HyperlaneLockBoxV2.sol";
import {MockMailbox} from "../../contracts/MockMailbox.sol";

/// HyperlaneLockBoxV2's forced exit (docs/ANTI-ROLLBACK-OFFCHAIN.md, item Q). The handler plays the route's
/// ZetaphyForcedExit (whatever balances it claims: the lockbox must stay safe even if the proofs lied), locks,
/// heartbeats with any supply, and time.
contract ForcedExitHandler is Test {
    HyperlaneLockBoxV2 public box;
    MockMailbox public mailbox;
    bytes32 public constant CP = bytes32(uint256(uint160(address(0xC0FFEE))));
    address[4] public users = [address(0xD1), address(0xD2), address(0xD3), address(0xD4)];
    uint64 public seq;

    uint256 public ghostLocked;
    uint256 public ghostPaid;
    uint256 public ghostPaidTwice;
    uint256 public ghostEarly;          // a forced payout before forcedFrom / while not escaping
    mapping(address => uint256) public paidTo;

    constructor(HyperlaneLockBoxV2 b, MockMailbox m) {
        box = b;
        mailbox = m;
        for (uint256 i; i < 4; i++) vm.deal(users[i], 1e30);
    }

    function lock(uint256 who, uint256 amount) external {
        amount = bound(amount, 1, 40 ether);
        vm.prank(users[who % 4]);
        try box.lock{value: amount}(users[who % 4], amount) { ghostLocked += amount; } catch {}
    }

    function heartbeat(uint256 supply) external {
        supply = bound(supply, 0, 200 ether);
        bytes memory body = abi.encode(box.HEARTBEAT_TAG(), box.zetaphyChainId(), address(0xC0FFEE), seq + 1, uint64(block.timestamp), supply);
        try mailbox.deliver(77390, CP, address(box), body) { seq++; } catch {}
    }

    function forcedPay(uint256 who, uint256 owed) external {
        address to = users[who % 4];
        owed = bound(owed, 1, 300 ether);
        bool ok = box.escaping() && block.timestamp > box.forcedFrom();
        uint256 before = to.balance;
        try box.forcedPay(to, owed) returns (uint256 pay) {
            if (!ok) ghostEarly++;
            if (paidTo[to] > 0) ghostPaidTwice++;
            require(to.balance - before == pay, "paid what it said");
            paidTo[to] += pay == 0 ? 1 : pay;
            ghostPaid += pay;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 10 days));
    }
}

contract ForcedExitInvariants is Test {
    HyperlaneLockBoxV2 box;
    ForcedExitHandler h;
    address gov = address(0x60F);

    function setUp() public {
        vm.warp(1_700_000_000);
        MockMailbox m = new MockMailbox(11155111);
        box = new HyperlaneLockBoxV2(ISaphanMailbox(address(m)), 77390, 77390, bytes32(uint256(0x1A)), bytes32(uint256(0x1B)), address(0),
            ISaphanIsm(address(0x15A)), gov, address(0x6A), 30 ether, 1 hours);
        h = new ForcedExitHandler(box, m);
        vm.startPrank(gov);
        box.setCheckpointer(h.CP());
        box.setForcedExit(address(h));
        vm.stopPrank();
        targetContract(address(h));
    }

    function test_handlerReachesForcedPay() public {
        h.lock(0, 10 ether);
        h.heartbeat(10 ether);
        h.warp(10 days);
        h.warp(10 days);
        h.warp(2 days);
        h.forcedPay(0, 4 ether);
        assertTrue(box.forced());
        assertEq(h.ghostPaid(), 4 ether);
        h.forcedPay(0, 1 ether); // the same address again: refused
        assertEq(h.ghostPaidTwice(), 0);
    }

    /// Forced payouts never owe more than the last heartbeat's supply and never pay more than the pool; the lockbox
    /// always holds exactly `locked`.
    function invariant_forcedBounded() public view {
        assertLe(box.forcedOwed(), box.forced() ? box.exitTotal() : 0);
        if (box.forced()) assertLe(h.ghostPaid(), box.exitPool());
        assertEq(address(box).balance, box.locked());
        assertEq(box.locked(), h.ghostLocked() - h.ghostPaid());
    }

    /// Never before escaping + FORCE_AFTER, never twice to one address; forced mode and the Merkle exit never mix.
    function invariant_forcedOnlyWhenDue() public view {
        assertEq(h.ghostEarly(), 0);
        assertEq(h.ghostPaidTwice(), 0);
        if (box.forced()) assertEq(box.exitRoot(), box.FORCED_ROOT());
    }
}
