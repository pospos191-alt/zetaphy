// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HyperlaneLockBoxV2, ISaphanMailbox, ISaphanIsm} from "../../contracts/HyperlaneLockBoxV2.sol";
import {ZetaphyForcedExit, IFELightClient, IFEProofs, IFELockbox} from "../../contracts/ZetaphyForcedExit.sol";
import {MockMailbox} from "../../contracts/MockMailbox.sol";

/// HyperlaneLockBoxV2's forced exit (docs/ANTI-ROLLBACK-OFFCHAIN.md, item Q). The handler plays the route's
/// ZetaphyForcedExit (whatever balances it claims: the lockbox must stay safe even if the proofs lied), locks,
/// heartbeats with any supply and height (and the older body without a height), and time.
contract ForcedExitHandler is Test {
    HyperlaneLockBoxV2 public box;
    MockMailbox public mailbox;
    bytes32 public constant CP = bytes32(uint256(uint160(address(0xC0FFEE))));
    address[4] public users = [address(0xD1), address(0xD2), address(0xD3), address(0xD4)];
    uint64 public seq;
    uint64 public zHeight = 100;

    uint256 public ghostLocked;
    uint256 public ghostPaid;
    uint256 public ghostPaidTwice;
    uint256 public ghostEarly;          // a forced payout before forcedFrom / while not escaping
    uint256 public ghostWrongHeight;    // a forced payout of a height other than the last heartbeat's
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

    function heartbeat(uint256 supply, uint256 blocks) external {
        supply = bound(supply, 0, 200 ether);
        zHeight += uint64(bound(blocks, 1, 1000));
        bytes memory body = abi.encode(box.HEARTBEAT_V2_TAG(), box.zetaphyChainId(), address(0xC0FFEE), seq + 1, uint64(block.timestamp), supply, zHeight);
        try mailbox.deliver(77390, CP, address(box), body) { seq++; } catch {}
    }

    /// The older 192-byte heartbeat (no height): keeps the route alive, clears the snapshot.
    function legacyHeartbeat(uint256 supply) external {
        supply = bound(supply, 0, 200 ether);
        bytes memory body = abi.encode(box.HEARTBEAT_TAG(), box.zetaphyChainId(), address(0xC0FFEE), seq + 1, uint64(block.timestamp), supply);
        try mailbox.deliver(77390, CP, address(box), body) { seq++; } catch {}
    }

    function forcedPay(uint256 who, uint256 owed, uint256 heightPick) external {
        address to = users[who % 4];
        owed = bound(owed, 1, 300 ether);
        uint64 snap = box.snapshotHeight();
        uint64 h = heightPick % 3 == 0 ? snap : heightPick % 3 == 1 ? uint64(bound(heightPick, 0, zHeight + 10)) : snap + 1;
        bool ok = box.escaping() && block.timestamp > box.forcedFrom();
        uint256 before = to.balance;
        try box.forcedPay(to, owed, h) returns (uint256 pay) {
            if (!ok) ghostEarly++;
            if (h == 0 || h != snap) ghostWrongHeight++;
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
        h.heartbeat(10 ether, 1);
        uint64 snap = box.snapshotHeight();
        assertEq(snap, 101);
        h.warp(10 days);
        h.warp(10 days);
        h.warp(2 days);
        vm.prank(address(h));
        vm.expectRevert(abi.encodeWithSelector(HyperlaneLockBoxV2.WrongHeight.selector, snap));
        box.forcedPay(address(0xD1), 1 ether, snap + 1);   // a later height than the snapshot: refused
        vm.prank(address(h));
        vm.expectRevert(abi.encodeWithSelector(HyperlaneLockBoxV2.WrongHeight.selector, snap));
        box.forcedPay(address(0xD1), 1 ether, snap - 1);   // an earlier one too
        h.forcedPay(0, 4 ether, 0);
        assertTrue(box.forced());
        assertEq(h.ghostPaid(), 4 ether);
        h.forcedPay(0, 1 ether, 0); // the same address again: refused
        assertEq(h.ghostPaidTwice(), 0);
        assertEq(h.ghostWrongHeight(), 0);
    }

    function test_legacyHeartbeatClearsTheSnapshot() public {
        h.lock(0, 10 ether);
        h.heartbeat(10 ether, 5);
        assertEq(box.snapshotHeight(), 105);
        h.legacyHeartbeat(10 ether);
        assertEq(box.snapshotHeight(), 0);
        vm.warp(block.timestamp + 22 days);
        vm.prank(address(h));
        vm.expectRevert(abi.encodeWithSelector(HyperlaneLockBoxV2.WrongHeight.selector, uint64(0)));
        box.forcedPay(address(0xD1), 1 ether, 0);
        assertFalse(box.forced());
    }

    /// Forced payouts never owe more than the last heartbeat's supply and never pay more than the pool; the lockbox
    /// always holds exactly `locked`.
    function invariant_forcedBounded() public view {
        assertLe(box.forcedOwed(), box.forced() ? box.exitTotal() : 0);
        if (box.forced()) assertLe(h.ghostPaid(), box.exitPool());
        assertEq(address(box).balance, box.locked());
        assertEq(box.locked(), h.ghostLocked() - h.ghostPaid());
    }

    /// Never before escaping + FORCE_AFTER, never twice to one address, never of a height other than the snapshot;
    /// forced mode and the Merkle exit never mix.
    function invariant_forcedOnlyWhenDue() public view {
        assertEq(h.ghostEarly(), 0);
        assertEq(h.ghostPaidTwice(), 0);
        assertEq(h.ghostWrongHeight(), 0);
        if (box.forced()) assertEq(box.exitRoot(), box.FORCED_ROOT());
        if (box.forced()) assertGt(box.snapshotHeight(), 0);
    }
}

// ---- end to end: the real ZetaphyForcedExit against a modelled ZETAPHY (internal review 2026-11-12, Z-43) ----

/// One app hash per height, set once (like StarkLightClient). Zero: not finalized.
contract ModelLightClient {
    mapping(uint64 => bytes32) public appHashAt;
    function set(uint64 height, bytes32 root) external { if (appHashAt[height] == bytes32(0)) appHashAt[height] = root; }
}

/// Stands in for the IAVL / multistore proof code: the "proof" names a state root (leafPrefix = abi.encode(root)) and
/// passes only if that state holds `value` under `key`; then it hashes to that root, else to garbage.
contract ModelProofs {
    mapping(bytes32 => mapping(bytes32 => uint256)) public valuePlusOne;
    function put(bytes32 root, bytes memory key, uint256 v) external { valuePlusOne[root][keccak256(key)] = v + 1; }
    function iavlRoot(bytes memory key, bytes32 value, bytes calldata leafPrefix, IFEProofs.InnerOp[] calldata) external view returns (bytes32) {
        bytes32 root = abi.decode(leafPrefix, (bytes32));
        return valuePlusOne[root][keccak256(key)] == uint256(value) + 1 ? root : keccak256("no such leaf");
    }
    function storeRoot(bytes memory, bytes32 root, IFEProofs.InnerOp[] calldata) external pure returns (bytes32) { return root; }
}

/// ZETAPHY (token(X) balances per height, supply fixed), its heartbeats, finality of its heights, finalized heights
/// that are not ZETAPHY's (far ahead of it), and proofs at any of these heights.
contract ShuffleHandler is Test {
    uint256 public constant TOTAL = 100 ether;
    uint64 public constant FAKE_BASE = 1_000_000_000;
    HyperlaneLockBoxV2 public box;
    ZetaphyForcedExit public fe;
    MockMailbox public mailbox;
    ModelLightClient public lc;
    ModelProofs public proofs;
    bytes32 public constant CP = bytes32(uint256(uint160(address(0xC0FFEE))));
    address[4] public users = [address(0xE1), address(0xE2), address(0xE3), address(0xE4)];

    uint64 public height = 100;            // ZETAPHY's current height
    uint256[4] public bal;                  // balances now
    mapping(uint64 => uint256[4]) internal honest; // balances at each committed height
    uint64[] public fakes;                  // fabricated heights the light client finalized
    uint64 public seq;

    uint256 public ghostWrongOwed;          // a payout whose owed is not the account's honest balance at the snapshot
    uint256 public ghostFinalized;
    uint256 public ghostOwedTotal;

    constructor(HyperlaneLockBoxV2 b, ZetaphyForcedExit f, MockMailbox m, ModelLightClient l, ModelProofs p) {
        box = b; fe = f; mailbox = m; lc = l; proofs = p;
        bal = [uint256(10 ether), 20 ether, 30 ether, 40 ether];
        _commit();
    }

    function honestRoot(uint64 h) public pure returns (bytes32) { return keccak256(abi.encode("honest", h)); }
    function fakeRoot(uint64 h) public pure returns (bytes32) { return keccak256(abi.encode("fake", h)); }
    function honestAt(uint64 h, uint256 i) external view returns (uint256) { return honest[h][i]; }

    function _commit() private {
        honest[height] = bal;
        for (uint256 i; i < 4; i++) proofs.put(honestRoot(height), fe.storageKey(users[i]), bal[i]);
    }

    /// The same tokens move between accounts; each move is a new height, which the light client finalizes.
    function transfer(uint256 from, uint256 to, uint256 amount) external {
        from %= 4; to %= 4;
        amount = bound(amount, 0, bal[from]);
        bal[from] -= amount;
        bal[to] += amount;
        height++;
        _commit();
        lc.set(height, honestRoot(height));
    }

    /// A heartbeat of the current height and supply; relayers finalize that height in the light client. A few per
    /// run (each one ends an escape: with many, the fuzzer would rarely see a forced exit at all).
    function heartbeat() external {
        if (seq >= 3) return;
        bytes memory body = abi.encode(box.HEARTBEAT_V2_TAG(), box.zetaphyChainId(), address(0xC0FFEE), seq + 1, uint64(block.timestamp), TOTAL, height);
        try mailbox.deliver(77390, CP, address(box), body) { seq++; lc.set(height, honestRoot(height)); } catch {}
    }

    /// Honest finality of any height already committed.
    function finalizeHonest(uint256 pick) external {
        uint64 h = uint64(bound(pick, 100, height));
        lc.set(h, honestRoot(h));
    }

    /// A finalized later height that is not ZETAPHY's state: `who` holds the whole supply there.
    function fabricate(uint256 off, uint256 who) external {
        uint64 h = FAKE_BASE + height + uint64(bound(off, 0, 1000));
        for (uint256 i; i < 4; i++) proofs.put(fakeRoot(h), fe.storageKey(users[i]), i == who % 4 ? TOTAL : 0);
        lc.set(h, fakeRoot(h));
        fakes.push(h);
    }

    /// A holder (or anyone) proves an account at the snapshot height, at the committed height where some account held
    /// the most (among the last 64), or at a height that is not ZETAPHY's.
    function prove(uint256 who, uint256 pick) external {
        who %= 4;
        uint64 h;
        uint256 v;
        bytes32 root;
        uint256 mode = pick % 3;
        if (mode == 1) {
            uint256 best;
            h = height;
            for (uint64 x = height > 163 ? height - 63 : 100; x <= height; x++) {
                for (uint256 i; i < 4; i++) if (honest[x][i] > best) { best = honest[x][i]; h = x; who = i; }
            }
            v = best;
            root = honestRoot(h);
        } else if (mode == 2 && fakes.length > 0) {
            h = fakes[pick % fakes.length];
            root = fakeRoot(h);
            uint256 p1 = proofs.valuePlusOne(root, keccak256(fe.storageKey(users[who])));
            v = p1 > 0 ? p1 - 1 : 0;
        } else {
            h = box.snapshotHeight();
            root = honestRoot(h);
            v = honest[h][who];
        }
        ZetaphyForcedExit.StateProof memory sp;
        sp.iavlLeafPrefix = abi.encode(root);
        try fe.prove(users[who], h, v, sp) {} catch {}
    }

    /// Anyone finalizes every account whose claim is due.
    function finalizeAll() external {
        for (uint256 who; who < 4; who++) {
            try fe.finalize(users[who]) {
                (uint64 kh,, bool paid, uint256 owed) = fe.claims(users[who]);
                uint64 snap = box.snapshotHeight();
                if (paid || owed > 0) {
                    if (kh != snap || owed != honest[snap][who]) ghostWrongOwed++;
                    ghostOwedTotal += owed;
                }
                ghostFinalized++;
            } catch {}
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 12 days));
    }
}

contract ForcedExitShuffleInvariants is Test {
    HyperlaneLockBoxV2 box;
    ZetaphyForcedExit fe;
    ShuffleHandler h;
    ModelLightClient lc;
    ModelProofs proofs;
    address gov = address(0x60F);
    address constant TOKEN = address(0x70C3);

    function setUp() public {
        vm.warp(1_700_000_000);
        MockMailbox m = new MockMailbox(11155111);
        box = new HyperlaneLockBoxV2(ISaphanMailbox(address(m)), 77390, 77390, bytes32(uint256(0x1A)), bytes32(uint256(0x1B)), address(0),
            ISaphanIsm(address(0x15A)), gov, address(0x6A), 30 ether, 1 hours);
        lc = new ModelLightClient();
        proofs = new ModelProofs();
        fe = new ZetaphyForcedExit(IFELightClient(address(lc)), IFEProofs(address(proofs)), IFELockbox(address(box)), TOKEN, 3, 3 days);
        h = new ShuffleHandler(box, fe, m, lc, proofs);
        vm.startPrank(gov);
        box.setCheckpointer(h.CP());
        box.setForcedExit(address(fe));
        vm.stopPrank();
        // the ETH behind ZETAPHY's 100 token(X): locked once, as the bridge did
        vm.deal(address(this), 100 ether);
        box.lock{value: 100 ether}(address(this), 100 ether);
        h.heartbeat();
        vm.warp(block.timestamp + 21 days + 1);   // ZETAPHY silent since: forced exits are due from the start
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](7);
        sel[0] = ShuffleHandler.transfer.selector;
        sel[1] = ShuffleHandler.heartbeat.selector;
        sel[2] = ShuffleHandler.finalizeHonest.selector;
        sel[3] = ShuffleHandler.fabricate.selector;
        sel[4] = ShuffleHandler.prove.selector;
        sel[5] = ShuffleHandler.finalizeAll.selector;
        sel[6] = ShuffleHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// Every forced payout owes exactly the account's balance in the snapshot state (one height for all), so the
    /// claims add up to at most that state's supply: no account counts at two heights, no fabricated height counts.
    function invariant_claimsAreOfTheSnapshot() public view {
        assertEq(h.ghostWrongOwed(), 0);
        assertLe(h.ghostOwedTotal(), h.TOTAL());
        assertLe(box.forcedOwed(), h.TOTAL());
        assertEq(address(box).balance, box.locked());
    }

    // ---- the two paths, step by step ----

    function _escape() internal { vm.warp(block.timestamp + 21 days + 1); }

    function _proof(bytes32 root) internal pure returns (ZetaphyForcedExit.StateProof memory sp) { sp.iavlLeafPrefix = abi.encode(root); }

    /// Tokens moved between accounts across finalized heights: only the snapshot height counts, each account once.
    function test_shuffleAcrossHeightsCannotExceedSupply() public {
        uint64 snap = box.snapshotHeight();
        assertEq(snap, 100);
        address e1 = h.users(0); address e2 = h.users(1); address e4 = h.users(3);
        // after the snapshot: E4 sends its 40 to E1, then E1 sends 50 to E2 (heights 101, 102), all finalized
        h.transfer(3, 0, 40 ether);
        h.transfer(0, 1, 50 ether);
        h.finalizeHonest(101);
        h.finalizeHonest(102);
        _escape();
        ZetaphyForcedExit.StateProof memory p101 = _proof(h.honestRoot(101));
        ZetaphyForcedExit.StateProof memory p102 = _proof(h.honestRoot(102));
        ZetaphyForcedExit.StateProof memory pSnap = _proof(h.honestRoot(snap));
        vm.expectRevert(abi.encodeWithSelector(ZetaphyForcedExit.WrongHeight.selector, snap));
        fe.prove(e1, 101, 50 ether, p101);
        vm.expectRevert(abi.encodeWithSelector(ZetaphyForcedExit.WrongHeight.selector, snap));
        fe.prove(e2, 102, 70 ether, p102);
        // at the snapshot: each once
        for (uint256 i; i < 4; i++) fe.prove(h.users(i), snap, h.honestAt(snap, i), _proof(h.honestRoot(snap)));
        vm.expectRevert(ZetaphyForcedExit.AlreadyProven.selector);
        fe.prove(e4, snap, 40 ether, pSnap);
        vm.warp(block.timestamp + 3 days);
        uint256 paid;
        for (uint256 i; i < 4; i++) paid += fe.finalize(h.users(i));
        assertEq(paid, 100 ether);
        assertEq(box.forcedOwed(), 100 ether);
        assertEq(e1.balance + e2.balance + e4.balance + h.users(2).balance, 100 ether);
    }

    /// A finalized height above the snapshot is refused, whatever it shows.
    function test_fabricatedLaterHeightRefused() public {
        uint64 snap = box.snapshotHeight();
        h.fabricate(0, 2);
        uint64 fake = h.fakes(0);
        assertGt(fake, snap);
        _escape();
        ZetaphyForcedExit.StateProof memory pFake = _proof(h.fakeRoot(fake));
        address e3 = h.users(2);
        vm.expectRevert(abi.encodeWithSelector(ZetaphyForcedExit.WrongHeight.selector, snap));
        fe.prove(e3, fake, 100 ether, pFake);
        // the honest holder at the snapshot is paid in full
        fe.prove(h.users(3), snap, 40 ether, _proof(h.honestRoot(snap)));
        vm.warp(block.timestamp + 3 days);
        assertEq(fe.finalize(h.users(3)), 40 ether);
    }

    /// A heartbeat between two silences moves the snapshot: a claim of the old one is never paid, a proof at the new one
    /// replaces it.
    function test_newSnapshotReplacesOldClaims() public {
        uint64 s1 = box.snapshotHeight();
        _escape();
        fe.prove(h.users(0), s1, 10 ether, _proof(h.honestRoot(s1)));
        h.transfer(0, 1, 10 ether);
        h.heartbeat();                     // ZETAPHY is back: the escape ends, the snapshot moves
        uint64 s2 = box.snapshotHeight();
        assertGt(s2, s1);
        _escape();
        address e1 = h.users(0);
        vm.expectRevert(abi.encodeWithSelector(ZetaphyForcedExit.WrongHeight.selector, s2));
        fe.finalize(e1);
        fe.prove(h.users(0), s2, 0, _proof(h.honestRoot(s2)));
        fe.prove(h.users(1), s2, 30 ether, _proof(h.honestRoot(s2)));
        vm.warp(block.timestamp + 3 days);
        assertEq(fe.finalize(h.users(0)), 0);
        assertEq(fe.finalize(h.users(1)), 30 ether);
    }
}
