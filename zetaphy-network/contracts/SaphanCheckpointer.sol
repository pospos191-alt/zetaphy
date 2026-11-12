// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICheckpointToken {
    function totalSupply() external view returns (uint256);
}

interface ICheckpointMailbox {
    function dispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes calldata messageBody) external payable returns (bytes32 messageId);
    function quoteDispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes calldata messageBody) external view returns (uint256 fee);
}

/// @title SaphanCheckpointer: ZETAPHY's heartbeat to one route's lockbox (the escape hatch's clock)
/// @notice On ZETAPHY, one per route. Anyone calls beat() (at most once per MIN_INTERVAL, paying the Mailbox fee):
///         it sends HyperlaneLockBoxV2 a heartbeat through ZETAPHY's Mailbox (our validators sign it like a release).
///         While heartbeats arrive, the lockbox stays out of escape; if ZETAPHY stops (halted, censored, cut off) for
///         the lockbox's ESCAPE_AFTER, holders can leave on the source chain (docs/SAPHAN-SAFETY.md).
///         No admin; everything it may do is fixed at deploy. Testnet only, not audited.
contract SaphanCheckpointer {
    bytes32 public constant HEARTBEAT_V2_TAG = keccak256("saphan/heartbeat/v2");
    uint64 public constant MIN_INTERVAL = 1 hours;

    ICheckpointMailbox public immutable mailbox;   // ZETAPHY's Mailbox
    uint32 public immutable destinationDomain;     // the source chain's Hyperlane domain
    bytes32 public immutable recipient;            // the route's HyperlaneLockBoxV2 there
    ICheckpointToken public immutable token;       // token(X): its supply rides on every heartbeat (proof of reserves)
    uint64 public seq;
    uint64 public lastAt;
    uint64 public lastHeight;                      // the ZETAPHY height the last heartbeat carried (the forced exit's snapshot)

    event Beat(uint64 indexed seq, bytes32 messageId);

    error TooSoon(uint64 next);
    error Fee(uint256 needed);

    constructor(ICheckpointMailbox mailbox_, uint32 destinationDomain_, bytes32 recipient_, ICheckpointToken token_) {
        require(address(mailbox_) != address(0) && recipient_ != bytes32(0) && address(token_) != address(0), "config");
        token = token_;
        mailbox = mailbox_;
        destinationDomain = destinationDomain_;
        recipient = recipient_;
    }

    /// The heartbeat body (224 bytes), as the lockbox reads it: with token(X)'s total supply now and this block's
    /// height. The height is the forced exit's snapshot (ZetaphyForcedExit): holders prove their balance in the state
    /// the light client finalized at that height (app hash of header `height`, the state this block starts from).
    function body(uint64 n) public view returns (bytes memory) {
        return abi.encode(HEARTBEAT_V2_TAG, block.chainid, address(this), n, uint64(block.timestamp), token.totalSupply(), uint64(block.number));
    }

    function quote() external view returns (uint256) { return mailbox.quoteDispatch(destinationDomain, recipient, body(seq + 1)); }

    /// Anyone: one heartbeat. msg.value: exactly the Mailbox fee (quote()).
    function beat() external payable returns (bytes32 messageId) {
        if (block.timestamp < uint256(lastAt) + MIN_INTERVAL) revert TooSoon(lastAt + MIN_INTERVAL);
        uint64 n = seq + 1;
        seq = n;
        lastAt = uint64(block.timestamp);
        lastHeight = uint64(block.number);
        bytes memory b = body(n);
        uint256 fee = mailbox.quoteDispatch(destinationDomain, recipient, b);
        if (msg.value != fee) revert Fee(fee);
        messageId = mailbox.dispatch{value: fee}(destinationDomain, recipient, b);
        emit Beat(n, messageId);
    }
}
