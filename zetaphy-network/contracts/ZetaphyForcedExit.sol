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
    function forcedPay(address to, uint256 owed) external returns (uint256);
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
///             slot) and the multistore path of "evm" to that app hash. Exactly the proof the wallet keeps
///             (zetaphy-wallet: eth_getProof at a height it saw certified). Anyone may prove for any account; the
///             payout only ever goes to the account.
///           a LATER finalized height replaces an earlier one (anyone, until the account is paid): the newest proven
///             state wins, so a stale proof (an old balance since spent) is corrected by whoever holds a newer one,
///             e.g. any archive node, within `challengeWindow`;
///           finalize(account) after challengeWindow from its first proof: the lockbox pays the account its share
///             (pro rata against the last heartbeat's supply, once; HyperlaneLockBoxV2.forcedPay).
///
///         What it trusts: the light client (finality) and the proof code (ZetaphyBridgeInbox's IAVL / multistore
///         checks), the same as proven releases (SaphanReleaseVerifier). No admin. What it does not cover: releases
///         queued on the lockbox and locks ZETAPHY never minted (the validators' exit root covers those); one account's
///         stale claim needs someone with a newer proof of THAT account to be corrected (the pool's cap: never more
///         owed than the last heartbeat's supply, pro rata).
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
    error NotNewer(uint64 height);
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

    /// Anyone, once forced exits may begin: account's token(X) balance at a finalized ZETAPHY height. A first proof
    /// opens the account's claim; a proof at a later height replaces it (until it is paid).
    function prove(address account, uint64 height, uint256 balance, StateProof calldata sp) external {
        Claim storage k = claims[account];
        if (k.paid) revert Paid();
        if (k.height != 0 && height <= k.height) revert NotNewer(k.height);
        if (k.height == 0) k.readyAt = uint64(block.timestamp) + challengeWindow;
        k.height = height;
        k.balance = balance;
        emit Proven(account, height, balance, msg.sender);
        // the checks against the lockbox, the light client and the proof code come last: any failure reverts the
        // writes above (and no state changes after a call)
        _check(account, height, balance, sp);
    }

    function _check(address account, uint64 height, uint256 balance, StateProof calldata sp) private view {
        if (!lockbox.escaping()) revert NotEscaping();
        uint64 from = lockbox.forcedFrom();
        if (block.timestamp <= from) revert TooSoon(from);
        bytes32 app = lightClient.appHashAt(height);
        if (app == bytes32(0)) revert BadStateProof(0);
        bytes32 evmRoot = proofs.iavlRoot(storageKey(account), bytes32(balance), sp.iavlLeafPrefix, sp.iavlPath);
        if (proofs.storeRoot("evm", evmRoot, sp.storePath) != app) revert BadStateProof(1);
    }

    /// Anyone, after the account's challenge window: the lockbox pays the account (a zero balance just closes it).
    function finalize(address account) external returns (uint256 paid) {
        Claim storage k = claims[account];
        if (k.height == 0) revert NoClaim();
        if (k.paid) revert Paid();
        if (block.timestamp < k.readyAt) revert TooSoon(k.readyAt);
        k.paid = true;
        if (k.balance > 0) paid = lockbox.forcedPay(account, k.balance);
        emit Finalized(account, k.balance, paid);
    }
}
