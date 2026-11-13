// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ZtphyMerkleDistributor: a claim-based airdrop of the native coin (ZTPHY), one 32-byte root for any number of people
/// @notice docs/AIRDROP.md. The list (index, account, amount) is built and published off chain
///   (zetaphy-network/airdrop/cli.js `merkle`); this contract holds only its root.
///   - Leaf = keccak256(bytes.concat(keccak256(abi.encode(uint256 index, address account, uint256 amount)))) (the
///     double hash of OpenZeppelin's StandardMerkleTree: a leaf can never be read as an inner node). Inner nodes hash
///     the sorted pair, so a proof is just the sibling hashes (depth 17 for 100,000 leaves).
///   - Each index pays once (a bitmap: 256 claims per storage word). Anyone may submit a claim (a relayer, a
///     sponsor, the person), but the coins go only to the leaf's `account`.
///   - Funded by plain transfers (receive). Claims open at `claimStart` and close at `claimDeadline`; after the
///     deadline anyone may `sweep` what is left, and it can only go to `returnTo`, fixed at construction (the
///     community fund / governance).
///   - There is no owner: nobody can change the root, the dates or `returnTo`, or take the coins early.
///   - `guardian` (a fixed multisig, or address(0) for none) may `abort` ONLY while no claim has been paid. Why:
///     the expensive mistake is a wrong root funded with the pool; between funding and `claimStart` anyone can
///     recompute the root from the published list (cli.js `verify`), and if it is wrong the guardian ends the
///     round so that the coins go back to `returnTo` at once instead of being locked until the deadline. The
///     guardian can never redirect coins, pause, or stop claims once one has been paid (no censorship of a
///     live round).
contract ZtphyMerkleDistributor {
    bytes32 public immutable merkleRoot;
    uint64 public immutable claimStart;
    uint64 public immutable claimDeadline;
    address public immutable returnTo;
    address public immutable guardian;
    /// Sum of all amounts in the list and the number of leaves, as published: no claim can push the paid total past
    /// `totalAllocated` nor use an index >= `leafCount`, even with a wrong root.
    uint256 public immutable totalAllocated;
    uint256 public immutable leafCount;

    /// One slot: what has been paid, how many claims, and whether the round was aborted.
    uint128 public totalClaimed;
    uint64 public claimCount;
    bool public aborted;
    mapping(uint256 => uint256) private claimedBitMap;

    event Claimed(uint256 indexed index, address indexed account, uint256 amount, address indexed submitter);
    event Funded(address indexed from, uint256 amount);
    event Swept(address indexed to, uint256 amount);
    event Aborted(address indexed by);

    error AlreadyClaimed();
    error BadProof();
    error NotOpen();
    error Closed();
    error StillOpen();
    error NotGuardian();
    error ClaimsStarted();
    error OverAllocated();
    error NotFunded();
    error PayFailed();
    error BadConfig();

    constructor(
        bytes32 root_,
        uint256 totalAllocated_,
        uint256 leafCount_,
        uint64 claimStart_,
        uint64 claimDeadline_,
        address returnTo_,
        address guardian_
    ) payable {
        if (root_ == bytes32(0) || returnTo_ == address(0) || leafCount_ == 0 || totalAllocated_ == 0
            || totalAllocated_ > type(uint128).max || claimDeadline_ <= claimStart_ || claimDeadline_ <= block.timestamp) revert BadConfig();
        merkleRoot = root_;
        totalAllocated = totalAllocated_;
        leafCount = leafCount_;
        claimStart = claimStart_;
        claimDeadline = claimDeadline_;
        returnTo = returnTo_;
        guardian = guardian_;
        if (msg.value != 0) emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function isClaimed(uint256 index) public view returns (bool) {
        return (claimedBitMap[index >> 8] >> (index & 0xff)) & 1 == 1;
    }

    /// The leaf of (index, account, amount), as cli.js builds it.
    function leafOf(uint256 index, address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
    }

    /// True when the proof shows (index, account, amount) is in the list (says nothing about whether it was claimed).
    function verifyProof(uint256 index, address account, uint256 amount, bytes32[] calldata proof) public view returns (bool) {
        bytes32 h = leafOf(index, account, amount);
        for (uint256 i; i < proof.length; ++i) {
            bytes32 p = proof[i];
            assembly ("memory-safe") {
                switch lt(h, p)
                case 1 { mstore(0x00, h) mstore(0x20, p) }
                default { mstore(0x00, p) mstore(0x20, h) }
                h := keccak256(0x00, 0x40)
            }
        }
        return h == merkleRoot;
    }

    /// Pays `amount` to `account` for leaf `index`. Anyone may send it; the coins go to `account` only.
    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) external {
        _open();
        if (!_claim(index, account, amount, proof)) revert AlreadyClaimed();
    }

    struct Claim {
        uint256 index;
        address account;
        uint256 amount;
        bytes32[] proof;
    }

    /// Several claims in one transaction (a relayer or sponsor paying the gas for people who hold no ZTPHY yet).
    /// Already-claimed indices are skipped (someone claimed first), so a batch is not undone by one; a bad proof
    /// reverts all. Returns how many were paid.
    function claimMany(Claim[] calldata claims) external returns (uint256 paid) {
        _open();
        for (uint256 i; i < claims.length; ++i) {
            Claim calldata c = claims[i];
            if (_claim(c.index, c.account, c.amount, c.proof)) ++paid;
        }
    }

    /// After the deadline (or once aborted): everything left goes to `returnTo`. Anyone may call it.
    function sweep() external {
        if (!aborted && block.timestamp < claimDeadline) revert StillOpen();
        uint256 bal = address(this).balance;
        emit Swept(returnTo, bal);
        (bool ok, ) = returnTo.call{value: bal}("");
        if (!ok) revert PayFailed();
    }

    /// The guardian ends the round before any claim has been paid (a wrong list); the coins can then be swept to
    /// `returnTo` at once. Cannot be undone.
    function abort() external {
        if (msg.sender != guardian || guardian == address(0)) revert NotGuardian();
        if (claimCount != 0) revert ClaimsStarted();
        if (aborted) revert Closed();
        aborted = true;
        emit Aborted(msg.sender);
    }

    function _open() private view {
        if (aborted || block.timestamp >= claimDeadline) revert Closed();
        if (block.timestamp < claimStart) revert NotOpen();
    }

    /// false: already claimed. Effects before the transfer (checks-effects-interactions): a recipient that calls
    /// back finds its index already marked.
    function _claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) private returns (bool) {
        if (index >= leafCount) revert BadProof();
        uint256 word = index >> 8;
        uint256 bit = 1 << (index & 0xff);
        uint256 w = claimedBitMap[word];
        if (w & bit != 0) return false;
        if (!verifyProof(index, account, amount, proof)) revert BadProof();
        uint256 total = uint256(totalClaimed) + amount;
        if (total > totalAllocated) revert OverAllocated();
        if (address(this).balance < amount) revert NotFunded();
        claimedBitMap[word] = w | bit;
        totalClaimed = uint128(total);
        ++claimCount;
        emit Claimed(index, account, amount, msg.sender);
        (bool ok, ) = account.call{value: amount}("");
        if (!ok) revert PayFailed();
        return true;
    }
}
