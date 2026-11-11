// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ZetaphyBounty} from "../../contracts/ZetaphyBounty.sol";

/// Drives ZetaphyBounty (docs/ANTI-ROLLBACK-OFFCHAIN.md, item U) with random reports, committee decisions, pauses,
/// funding and time, and records what must never happen.
contract BountyHandler is Test {
    ZetaphyBounty public b;
    address[3] public ms = [address(0xA1), address(0xA2), address(0xA3)];
    address[3] public rs = [address(0xB1), address(0xB2), address(0xB3)];
    bytes32 constant SALT = bytes32(uint256(0x5a17));

    uint256 public ghostFunded;
    uint256 public ghostBonds;            // every bond ever paid in
    uint256 public ghostEarlyExecute;     // an execute before eta / resumeAt that went through
    uint256 public ghostOverMax;          // a report paid more than maxPayout
    uint256 public ghostPausedExecute;    // an execute while paused that went through
    uint256 public ghostExecuted;         // payouts that went through (the run did real work)
    mapping(uint64 => uint256) public paidIn; // amounts scheduled per period (from Scheduled reports)

    constructor(ZetaphyBounty b_) {
        b = b_;
        for (uint256 i; i < 3; i++) { vm.deal(rs[i], 1e30); vm.deal(ms[i], 1e30); }
        vm.deal(address(this), 1e30);
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 1, 50 ether);
        b.fund{value: amount}();
        ghostFunded += amount;
    }

    function report(uint256 who, uint256 tag) external {
        address r = rs[who % 3];
        bytes32 h = keccak256(abi.encode("report", tag));
        uint128 bond = b.reportBond();
        bytes32 cm = b.commitmentOf(h, r, SALT); // (before the prank: a nested call would use it up)
        vm.prank(r);
        uint256 id = b.commit{value: bond}(cm);
        ghostBonds += bond;
        vm.roll(block.number + 1);
        if (tag % 4 != 0) { vm.prank(r); b.reveal(id, h, SALT); } // some are never revealed
    }

    function approvePay(uint256 m, uint256 idSeed, uint256 amount) external {
        uint256 n = b.reportCount();
        if (n == 0) return;
        uint256 id = idSeed % n;
        // usually the amount members agree on for this report, sometimes another one (a split decision)
        amount = amount % 4 == 0 ? (amount % 3 + 1) * 2 ether : (id % 3 + 1) * 2 ether;
        vm.prank(ms[m % 3]);
        try b.approvePay(id, amount) {} catch {}
    }

    function approveReject(uint256 m, uint256 idSeed) external {
        uint256 n = b.reportCount();
        if (n == 0) return;
        vm.prank(ms[m % 3]);
        try b.approveReject(idSeed % n) {} catch {}
    }

    function execute(uint256 idSeed) external {
        uint256 n = b.reportCount();
        if (n == 0) return;
        uint256 id = idSeed % n;
        ZetaphyBounty.Report memory r = b.getReport(id);
        bool paused = b.paused();
        uint64 resume = b.resumeAt();
        try b.execute(id) {
            if (block.timestamp < r.eta || block.timestamp < resume) ghostEarlyExecute++;
            if (paused) ghostPausedExecute++;
            if (r.amount > b.maxPayout()) ghostOverMax++;
            ghostExecuted++;
        } catch {}
    }

    function withdraw(uint256 who) external {
        vm.prank(rs[who % 3]);
        try b.withdraw() {} catch {}
    }

    function expire(uint256 idSeed) external {
        uint256 n = b.reportCount();
        if (n == 0) return;
        try b.expire(idSeed % n) {} catch {}
    }

    function abandon(uint256 idSeed) external {
        uint256 n = b.reportCount();
        if (n == 0) return;
        uint256 id = idSeed % n;
        address reporter = b.getReport(id).reporter;
        vm.prank(reporter);
        try b.abandon(id) {} catch {}
    }

    function pause(uint256 m) external {
        vm.prank(ms[m % 3]);
        try b.pause() {} catch {}
    }

    function unpause(uint256 m) external {
        vm.prank(ms[m % 3]);
        try b.approveUnpause() {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 40 days));
        vm.roll(block.number + 1);
    }

    receive() external payable {}
}

contract ZetaphyBountyInvariants is Test {
    ZetaphyBounty b;
    BountyHandler h;

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(100);
        address[] memory m = new address[](3);
        m[0] = address(0xA1); m[1] = address(0xA2); m[2] = address(0xA3);
        b = new ZetaphyBounty(m, 2, 6 ether, 10 ether, 2 days, 0.1 ether);
        h = new BountyHandler(b);
        h.fund(40 ether);
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](11);
        sel[0] = h.fund.selector; sel[1] = h.report.selector; sel[2] = h.approvePay.selector; sel[3] = h.approveReject.selector;
        sel[4] = h.execute.selector; sel[5] = h.withdraw.selector; sel[6] = h.expire.selector; sel[7] = h.abandon.selector;
        sel[8] = h.pause.selector; sel[9] = h.unpause.selector; sel[10] = h.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    function test_handlerReachesPayout() public {
        h.report(0, 1);
        h.approvePay(0, 0, 0);
        h.approvePay(1, 0, 0);
        assertEq(uint8(b.getReport(0).state), uint8(ZetaphyBounty.State.Scheduled));
        h.execute(0);
        assertEq(uint8(b.getReport(0).state), uint8(ZetaphyBounty.State.Scheduled), "not before the timelock");
        h.warp(2 days);
        h.execute(0);
        assertEq(uint8(b.getReport(0).state), uint8(ZetaphyBounty.State.Paid));
        assertEq(b.owed(address(0xB1)), 2 ether + 0.1 ether); // report 0: (0 % 3 + 1) x 2
        h.withdraw(0);
        assertEq(b.owed(address(0xB1)), 0);
    }

    /// The pool never promises more than it holds.
    function invariant_solvent() public view {
        assertGe(address(b).balance, b.reserved() + b.owedTotal() + b.bondsHeld());
    }

    /// reserved = the Scheduled reports' amounts; bondsHeld = the bonds of open reports; nobody but reporters is owed.
    function invariant_accounting() public view {
        uint256 n = b.reportCount();
        uint256 res;
        uint256 bonds;
        for (uint256 i; i < n; i++) {
            ZetaphyBounty.Report memory r = b.getReport(i);
            if (r.state == ZetaphyBounty.State.Scheduled) res += r.amount;
            if (r.state == ZetaphyBounty.State.Committed || r.state == ZetaphyBounty.State.Revealed || r.state == ZetaphyBounty.State.Scheduled) bonds += r.bond;
            assertLe(r.amount, b.maxPayout());
        }
        assertEq(b.reserved(), res);
        assertEq(b.bondsHeld(), bonds);
        for (uint256 i; i < 3; i++) assertEq(b.owed(h.ms(i)), 0); // committee members are never credited
    }

    /// Money only leaves to reporters: everything that ever came in is still here or was withdrawn by a reporter.
    function invariant_noDrain() public view {
        uint256 owedReporters;
        for (uint256 i; i < 3; i++) owedReporters += b.owed(h.rs(i));
        assertEq(owedReporters, b.owedTotal());
        assertLe(b.paidTotal(), h.ghostFunded() + h.ghostBonds());
    }

    /// No instant payout, none while paused, none above the cap; per period at most periodCap scheduled.
    function invariant_timelockAndCaps() public view {
        assertEq(h.ghostEarlyExecute(), 0);
        assertEq(h.ghostPausedExecute(), 0);
        assertEq(h.ghostOverMax(), 0);
        assertLe(b.scheduledIn(b.currentPeriod()), b.periodCap());
    }
}
