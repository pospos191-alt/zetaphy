// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IFELightClient {
    function appHashAt(uint64 height) external view returns (bytes32);
}

/// The pure proof functions of ZetaphyBridgeInbox (any deployed instance: they read no state).
interface IFEProofs {
    struct InnerOp { bytes prefix; bytes suffix; }
    function iavlRoot(bytes memory key, bytes32 value, bytes calldata leafPrefix, InnerOp[] calldata path) external pure returns (bytes32);
    function storeRoot(bytes memory name, bytes32 root, InnerOp[] calldata path) external pure returns (bytes32);
}

interface IFELockbox {
    function escaping() external view returns (bool);
    function forcedFrom() external view returns (uint64);
    function snapshotHeight() external view returns (uint64);
    function forcedPay(address to, uint256 owed, uint64 height) external returns (uint256);
}

/// @title ZetaphyForcedExit: holders leave a stopped, censoring or rolled-back ZETAPHY with the proof they hold
/// @notice On the source chain X, next to the route's HyperlaneLockBoxV2 (docs/ANTI-ROLLBACK-OFFCHAIN.md, item Q).
///         Testnet only, not audited.
///
///         The escape hatch needs ZETAPHY's validators to sign an exit root. If they do not (gone, censoring,
///         captured) within the lockbox's FORCE_AFTER, holders exit on their own proof instead:
///           prove(account, height, balance, proof): token(X)'s storage slot balanceOf[account] = balance in ZETAPHY's
///             state at `height`, whose app hash the light client finalized (StarkLightClient: a STARK of > 2/3 of the
///             validators' ML-DSA-44 votes): the IAVL path of the evm store key 0x02 || token || keccak256(account,
///             slot) and the multistore path of "evm" to that app hash. `height` must be the lockbox's snapshotHeight:
///             the ZETAPHY height its last heartbeat carried, the state whose supply caps the pool. One state for every
///             claim, so each account counts once and the claims add up to that state's balances; no other height,
///             earlier or later, is accepted (internal review 2026-11-12, Z-43). The proof is eth_getProof of
///             token(X) at that height (any archive node, or the holder's own copy). Anyone may prove for any account;
///             the payout only ever goes to the account. A claim of an older snapshot (a heartbeat came since, then
///             ZETAPHY went silent again) is replaced by a proof at the new one;
///           finalize(account) after challengeWindow from its proof: the lockbox pays the account its share (pro
///             rata against the last heartbeat's supply, once; HyperlaneLockBoxV2.forcedPay, which checks the height
///             again).
///
///         What it trusts: the light client (finality) and the proof code (ZetaphyBridgeInbox's IAVL / multistore
///         checks), the same as proven releases (SaphanReleaseVerifier), and that the light client's app hash at the
///         snapshot height is ZETAPHY's (one app hash per height; a conflicting one freezes it). No admin. What it does
///         not cover: releases queued on the lockbox and locks ZETAPHY never minted (the validators' exit root covers
///         those). The pool's cap stays: never more owed than the last heartbeat's supply, pro rata.
contract ZetaphyForcedExit {
    struct StateProof {
        bytes iavlLeafPrefix;
        IFEProofs.InnerOp[] iavlPath;    // evm store, leaf to root
        IFEProofs.InnerOp[] storePath;   // multistore, evm store root to app hash
    }

    struct Claim {
        uint64 height;       // zero: none
        uint64 readyAt;
        bool paid;
        uint256 balance;
    }

    IFELightClient public immutable lightClient;
    IFEProofs public immutable proofs;
    IFELockbox public immutable lockbox;
    address public immutable token;         // token(X) on ZETAPHY (BridgedToken)
    uint256 public immutable balanceSlot;   // its balanceOf mapping's slot (BridgedToken: 3)
    uint64 public immutable challengeWindow;

    mapping(address => Claim) public claims;

    event Proven(address indexed account, uint64 height, uint256 balance, address indexed by);
    event Finalized(address indexed account, uint256 balance, uint256 paid);

    error NotEscaping();
    error TooSoon(uint64 at);
    error WrongHeight(uint64 snapshotHeight);
    error AlreadyProven();
    error BadStateProof(uint256 step);
    error NoClaim();
    error Paid();

    constructor(IFELightClient lc, IFEProofs proofs_, IFELockbox lockbox_, address token_, uint256 balanceSlot_, uint64 challengeWindow_) {
        require(address(lc) != address(0) && address(proofs_) != address(0) && address(lockbox_) != address(0) && token_ != address(0)
            && challengeWindow_ >= 3 days, "config");
        lightClient = lc;
        proofs = proofs_;
        lockbox = lockbox_;
        token = token_;
        balanceSlot = balanceSlot_;
        challengeWindow = challengeWindow_;
    }

    /// The evm-store key of balanceOf[account] (cosmos/evm x/vm: 0x02 || contract || slot).
    function storageKey(address account) public view returns (bytes memory) {
        return abi.encodePacked(uint8(2), token, keccak256(abi.encode(account, balanceSlot)));
    }

    /// The height every claim must be of: the lockbox's last heartbeat's ZETAPHY height (zero: none yet).
    function snapshotHeight() public view returns (uint64) {
        return lockbox.snapshotHeight();
    }

    /// Anyone, once forced exits may begin: account's token(X) balance at the snapshot height. Once per account and
    /// snapshot (a balance at one height has one value); a claim of an older snapshot is replaced.
    function prove(address account, uint64 height, uint256 balance, StateProof calldata sp) external {
        Claim storage k = claims[account];
        if (k.paid) revert Paid();
        uint64 before = k.height;
        k.readyAt = uint64(block.timestamp) + challengeWindow;
        k.height = height;
        k.balance = balance;
        emit Proven(account, height, balance, msg.sender);
        // the checks against the lockbox (the snapshot height first), the light client and the proof code come last:
        // any failure reverts the writes above (and no state changes after a call)
        _check(account, height, balance, sp, before);
    }

    function _check(address account, uint64 height, uint256 balance, StateProof calldata sp, uint64 before) private view {
        uint64 snap = lockbox.snapshotHeight();
        if (height == 0 || height != snap) revert WrongHeight(snap);
        if (before == height) revert AlreadyProven();   // once per account and snapshot
        if (!lockbox.escaping()) revert NotEscaping();
        uint64 from = lockbox.forcedFrom();
        if (block.timestamp <= from) revert TooSoon(from);
        bytes32 app = lightClient.appHashAt(height);
        if (app == bytes32(0)) revert BadStateProof(0);
        bytes32 evmRoot = proofs.iavlRoot(storageKey(account), bytes32(balance), sp.iavlLeafPrefix, sp.iavlPath);
        if (proofs.storeRoot("evm", evmRoot, sp.storePath) != app) revert BadStateProof(1);
    }

    /// Anyone, after the account's challenge window: the lockbox pays the account. Only a claim of the current
    /// snapshot counts; a zero balance pays nothing and just clears the claim.
    function finalize(address account) external returns (uint256 paid) {
        Claim storage k = claims[account];
        if (k.height == 0) revert NoClaim();
        if (k.paid) revert Paid();
        if (block.timestamp < k.readyAt) revert TooSoon(k.readyAt);
        uint64 height = k.height;
        uint256 balance = k.balance;
        if (balance == 0) delete claims[account];
        else k.paid = true;
        // the calls come last (a failure reverts the writes above): only a claim of the current snapshot counts, and
        // the lockbox checks the height again
        uint64 snap = lockbox.snapshotHeight();
        if (height != snap) revert WrongHeight(snap);
        if (balance > 0) paid = lockbox.forcedPay(account, balance, height);
        emit Finalized(account, balance, paid);
    }
}
