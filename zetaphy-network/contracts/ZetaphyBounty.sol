// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Future proof-of-exploit verifiers (none exists yet; no ZK here). Given a report and a proof, says whether the
/// proof shows the exploit and what payout it supports (wei, capped by the bounty's maxPayout). It must be a pure
/// check: it is called with staticcall and can move nothing.
interface IExploitVerifier {
    function verify(uint256 reportId, bytes32 reportHash, address reporter, bytes calldata proof) external view returns (bool valid, uint256 amount);
}

/// @title ZetaphyBounty: a funded bug bounty for ZETAPHY itself, paid by a committee through a timelock
/// @notice TESTNET ONLY, not audited (docs/ANTI-ROLLBACK-OFFCHAIN.md, item U: make attacks not pay). Unlike BugBounty
///         (sponsored fuzz jobs that runners judge), this pool pays whoever privately reports a real hole in the chain,
///         bridge or contracts, so that reporting pays more, and more surely, than exploiting.
///
///         Reports, commit-reveal (the reporter is protected; the content never has to be on chain):
///           1. commit(commitment) + reportBond: commitment = commitmentOf(reportHash, reporter, salt), where reportHash
///              is keccak256 of the report the reporter sends privately (SECURITY.md). The time of the commit is the
///              reporter's proof of priority; nobody learns anything from it, and a copy is useless (bound to the
///              reporter's address).
///           2. reveal(id, reportHash, salt) within REVEAL_WINDOW: binds the commitment to the report the committee
///              holds. Publishing the report later lets anyone check the hash.
///           3. The committee (members, `threshold` of them) approves a payout `amount` <= maxPayout to THE REPORTER
///              ONLY (nobody can redirect it), or rejects. A payout is scheduled with eta = now + timelock; during the
///              timelock the committee can still reject it. Then anyone executes it: the reporter's bond and the amount
///              are credited and withdrawn by the reporter (pull).
///           4. proveExploit(id, proof): the hook for future proof-of-exploit verifiers (committee-set, timelocked).
///              A valid proof schedules the payout the verifier supports (capped), through the same timelock, the same
///              caps, and the committee's veto.
///
///         What cannot happen (invariants, test/zetaphybounty.test.js and audit/invariants/ZetaphyBounty.inv.t.sol):
///           - no admin key; nobody can move pool money anywhere but to a reporter's credit: there is no withdraw of
///             the pool, no sweep, no migration. Donations are final.
///           - no instant payout: every payout waits `timelock` (>= MIN_TIMELOCK) after the decision, and again after
///             an unpause (resumeAt), so a pause by any member buys time;
///           - at most maxPayout per report and periodCap per PERIOD in all (a captured committee drains slowly and in
///             public, not at once);
///           - the pool never promises more than it holds: scheduled payouts are reserved;
///           - committee members cannot report (no self-dealing by the obvious route), a committee change takes the
///             timelock and voids every approval collected before it.
///         Pause: any member pauses at once (a brake); unpausing takes `threshold` members. While paused nothing is
///         approved or paid; reports can still be committed and revealed (and rejections still work).
///         Bonds of rejected or expired reports stay in the pool (they fund bounties); a report the committee never
///         decides gets its bond back after DECISION_WINDOW.
///         Wiring: HackInsurance pays victims of an incident, this pays finders before one; they share no money
///         (an insurance deposit would give this contract withdrawable shares, so it never makes one).
contract ZetaphyBounty {
    enum State { None, Committed, Revealed, Scheduled, Paid, Rejected, Expired, Abandoned }
    enum Kind { Pay, Reject, Unpause, SetCommittee, SetVerifier, SetBond }

    struct Report {
        address reporter;
        uint64 committedAt;
        uint64 revealedAt;
        uint64 eta;            // Scheduled: when the payout may be executed
        State state;
        bool verified;         // scheduled by a proof-of-exploit verifier
        uint128 bond;
        uint128 amount;        // Scheduled / Paid: the payout
        uint64 period;         // the period the payout counts in
        bytes32 commitment;
        bytes32 reportHash;
    }

    uint64 public constant MIN_TIMELOCK = 2 days;
    uint64 public constant PERIOD = 30 days;
    uint64 public constant REVEAL_WINDOW = 90 days;
    uint64 public constant DECISION_WINDOW = 180 days;
    uint256 public constant MAX_MEMBERS = 16;

    uint256 public immutable maxPayout;    // per report
    uint256 public immutable periodCap;    // all payouts scheduled in one PERIOD
    uint64 public immutable timelock;

    address[] private _members;
    mapping(address => bool) public isMember;
    uint8 public threshold;
    uint64 public epoch;                   // committee version: approvals carry it, a new committee voids them
    uint128 public reportBond;
    IExploitVerifier public verifier;
    bool public paused;
    uint64 public pauseCount;
    uint64 public resumeAt;                // nothing is executed before this (an unpause adds the timelock)

    uint256 public reserved;               // scheduled, not yet executed
    uint256 public owedTotal;              // credited, not yet withdrawn
    uint256 public bondsHeld;              // bonds of reports still open
    uint256 public paidTotal;
    mapping(uint64 => uint256) public scheduledIn; // per period
    mapping(address => uint256) public owed;

    Report[] private _reports;
    mapping(bytes32 => mapping(address => bool)) public approvedBy;
    mapping(bytes32 => uint8) public approvals;
    mapping(bytes32 => uint64) public configEta; // a config action that reached the threshold: when it may apply
    uint256 private unlocked = 1;

    event Funded(address indexed from, uint256 amount);
    event Committed(uint256 indexed id, address indexed reporter, bytes32 commitment);
    event Revealed(uint256 indexed id, bytes32 reportHash);
    event Approved(bytes32 indexed action, address indexed member, Kind kind, uint8 approvals);
    event Scheduled(uint256 indexed id, address indexed reporter, uint256 amount, uint64 eta, bool verified);
    event Rejected(uint256 indexed id);
    event Paid(uint256 indexed id, address indexed reporter, uint256 amount);
    event Expired(uint256 indexed id);
    event Abandoned(uint256 indexed id);
    event Withdrawn(address indexed to, uint256 amount);
    event PausedBy(address indexed member);
    event Unpaused(uint64 resumeAt);
    event ConfigQueued(bytes32 indexed action, Kind kind, uint64 eta);
    event CommitteeSet(address[] members, uint8 threshold, uint64 epoch);
    event VerifierSet(address verifier);
    event BondSet(uint128 bond);

    error NotMember();
    error BadConfig();
    error BadValue();
    error BadReport();
    error BadState();
    error BadReveal();
    error TooEarly();
    error TooLate();
    error IsPaused();
    error NotPaused();
    error MemberCannotReport();
    error AlreadyApproved();
    error OverCap();
    error Underfunded();
    error NotQueued();
    error Nothing();
    error PayFailed();
    error Reentrancy();
    error NoVerifier();
    error NotProven();

    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember();
        _;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert Reentrancy();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(address[] memory members_, uint8 threshold_, uint256 maxPayout_, uint256 periodCap_, uint64 timelock_, uint128 reportBond_) {
        if (maxPayout_ == 0 || periodCap_ < maxPayout_ || timelock_ < MIN_TIMELOCK) revert BadConfig();
        maxPayout = maxPayout_;
        periodCap = periodCap_;
        timelock = timelock_;
        reportBond = reportBond_;
        _setCommittee(members_, threshold_);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function fund() external payable {
        if (msg.value == 0) revert BadValue();
        emit Funded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- reports

    function commitmentOf(bytes32 reportHash, address reporter, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode("zetaphy/bounty/v1", block.chainid, address(this), reportHash, reporter, salt));
    }

    function commit(bytes32 commitment) external payable returns (uint256 id) {
        if (isMember[msg.sender]) revert MemberCannotReport();
        if (commitment == bytes32(0) || msg.value != reportBond) revert BadValue();
        id = _reports.length;
        _reports.push(Report({ reporter: msg.sender, committedAt: uint64(block.timestamp), revealedAt: 0, eta: 0, state: State.Committed,
            verified: false, bond: uint128(msg.value), amount: 0, period: 0, commitment: commitment, reportHash: bytes32(0) }));
        bondsHeld += msg.value;
        emit Committed(id, msg.sender, commitment);
    }

    function reveal(uint256 id, bytes32 reportHash, bytes32 salt) external {
        Report storage r = _report(id);
        if (msg.sender != r.reporter) revert BadReport();
        if (r.state != State.Committed) revert BadState();
        if (block.timestamp > uint256(r.committedAt) + REVEAL_WINDOW) revert TooLate();
        if (reportHash == bytes32(0) || commitmentOf(reportHash, msg.sender, salt) != r.commitment) revert BadReveal();
        r.reportHash = reportHash;
        r.revealedAt = uint64(block.timestamp);
        r.state = State.Revealed;
        emit Revealed(id, reportHash);
    }

    /// Anyone: a commitment never revealed in REVEAL_WINDOW; its bond stays in the pool.
    function expire(uint256 id) external {
        Report storage r = _report(id);
        if (r.state != State.Committed) revert BadState();
        if (block.timestamp <= uint256(r.committedAt) + REVEAL_WINDOW) revert TooEarly();
        r.state = State.Expired;
        bondsHeld -= r.bond;
        emit Expired(id);
    }

    /// The reporter: a revealed report the committee left undecided for DECISION_WINDOW; the bond goes back.
    function abandon(uint256 id) external {
        Report storage r = _report(id);
        if (msg.sender != r.reporter) revert BadReport();
        if (r.state != State.Revealed) revert BadState();
        if (block.timestamp <= uint256(r.revealedAt) + DECISION_WINDOW) revert TooEarly();
        r.state = State.Abandoned;
        bondsHeld -= r.bond;
        _credit(r.reporter, r.bond);
        emit Abandoned(id);
    }

    // ---------------------------------------------------------------- committee decisions on reports

    /// A member approves paying report `id` `amount` (to its reporter). `threshold` approvals of the same amount schedule it.
    function approvePay(uint256 id, uint256 amount) external onlyMember {
        if (paused) revert IsPaused();
        Report storage r = _report(id);
        if (r.state != State.Revealed) revert BadState();
        if (amount == 0 || amount > maxPayout) revert OverCap();
        if (_approve(keccak256(abi.encode(epoch, Kind.Pay, id, amount)), Kind.Pay)) _schedule(id, r, amount, false);
    }

    /// `threshold` members reject a report (committed, revealed, or scheduled and not yet paid); its bond stays in the pool.
    function approveReject(uint256 id) external onlyMember {
        Report storage r = _report(id);
        if (r.state != State.Committed && r.state != State.Revealed && r.state != State.Scheduled) revert BadState();
        if (!_approve(keccak256(abi.encode(epoch, Kind.Reject, id)), Kind.Reject)) return;
        if (r.state == State.Scheduled) {
            reserved -= r.amount;
            scheduledIn[r.period] -= r.amount;
            r.amount = 0;
        }
        r.state = State.Rejected;
        bondsHeld -= r.bond;
        emit Rejected(id);
    }

    /// The proof-of-exploit hook: with a verifier set, a valid proof schedules the payout it supports (capped), through
    /// the same timelock and caps; the committee can still reject it before it is executed.
    function proveExploit(uint256 id, bytes calldata proof) external {
        if (paused) revert IsPaused();
        if (address(verifier) == address(0)) revert NoVerifier();
        Report storage r = _report(id);
        if (r.state != State.Revealed) revert BadState();
        (bool valid, uint256 amount) = verifier.verify(id, r.reportHash, r.reporter, proof);
        if (!valid || amount == 0) revert NotProven();
        if (amount > maxPayout) amount = maxPayout;
        r.verified = true;
        _schedule(id, r, amount, true);
    }

    /// Anyone, after the timelock (and after resumeAt): the payout and the bond are credited to the reporter.
    function execute(uint256 id) external {
        if (paused) revert IsPaused();
        Report storage r = _report(id);
        if (r.state != State.Scheduled) revert BadState();
        if (block.timestamp < r.eta || block.timestamp < resumeAt) revert TooEarly();
        r.state = State.Paid;
        uint256 a = r.amount;
        reserved -= a;
        bondsHeld -= r.bond;
        paidTotal += a;
        _credit(r.reporter, a + r.bond);
        emit Paid(id, r.reporter, a);
    }

    function withdraw() external nonReentrant {
        uint256 a = owed[msg.sender];
        if (a == 0) revert Nothing();
        owed[msg.sender] = 0;
        owedTotal -= a;
        emit Withdrawn(msg.sender, a);
        (bool ok, ) = msg.sender.call{value: a}("");
        if (!ok) revert PayFailed();
    }

    // ---------------------------------------------------------------- pause

    /// Any member, at once.
    function pause() external onlyMember {
        if (paused) revert IsPaused();
        paused = true;
        emit PausedBy(msg.sender);
    }

    /// `threshold` members; execution waits another timelock after it.
    function approveUnpause() external onlyMember {
        if (!paused) revert NotPaused();
        if (!_approve(keccak256(abi.encode(epoch, Kind.Unpause, pauseCount)), Kind.Unpause)) return;
        paused = false;
        pauseCount++;
        resumeAt = uint64(block.timestamp) + timelock;
        emit Unpaused(resumeAt);
    }

    // ---------------------------------------------------------------- configuration (threshold, then timelock)

    function approveCommittee(address[] calldata members_, uint8 threshold_) external onlyMember {
        _queue(keccak256(abi.encode(epoch, Kind.SetCommittee, members_, threshold_)), Kind.SetCommittee);
    }

    function applyCommittee(address[] calldata members_, uint8 threshold_) external {
        _due(keccak256(abi.encode(epoch, Kind.SetCommittee, members_, threshold_)));
        for (uint256 i = 0; i < _members.length; i++) isMember[_members[i]] = false;
        _setCommittee(members_, threshold_); // epoch + 1: every approval collected so far is void
    }

    function approveVerifier(address v) external onlyMember {
        _queue(keccak256(abi.encode(epoch, Kind.SetVerifier, v)), Kind.SetVerifier);
    }

    function applyVerifier(address v) external {
        _due(keccak256(abi.encode(epoch, Kind.SetVerifier, v)));
        verifier = IExploitVerifier(v);
        emit VerifierSet(v);
    }

    function approveBond(uint128 b) external onlyMember {
        _queue(keccak256(abi.encode(epoch, Kind.SetBond, b)), Kind.SetBond);
    }

    function applyBond(uint128 b) external {
        _due(keccak256(abi.encode(epoch, Kind.SetBond, b)));
        reportBond = b;
        emit BondSet(b);
    }

    // ---------------------------------------------------------------- reads

    /// What the pool can still promise: held minus reserved payouts, credits not withdrawn and open bonds.
    function available() public view returns (uint256) {
        uint256 held = address(this).balance;
        uint256 tied = reserved + owedTotal + bondsHeld;
        return held > tied ? held - tied : 0;
    }

    function currentPeriod() public view returns (uint64) {
        return uint64(block.timestamp / PERIOD);
    }

    /// What may still be scheduled in this period (periodCap minus what was scheduled in it).
    function periodLeft() public view returns (uint256) {
        uint256 used = scheduledIn[currentPeriod()];
        return used >= periodCap ? 0 : periodCap - used;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    function reportCount() external view returns (uint256) {
        return _reports.length;
    }

    function getReport(uint256 id) external view returns (Report memory) {
        return _report(id);
    }

    // ---------------------------------------------------------------- internals

    function _report(uint256 id) private view returns (Report storage) {
        if (id >= _reports.length) revert BadReport();
        return _reports[id];
    }

    function _schedule(uint256 id, Report storage r, uint256 amount, bool verified) private {
        uint64 p = currentPeriod();
        if (scheduledIn[p] + amount > periodCap) revert OverCap();
        if (amount > available()) revert Underfunded();
        scheduledIn[p] += amount;
        reserved += amount;
        r.amount = uint128(amount);
        r.period = p;
        r.eta = uint64(block.timestamp) + timelock;
        r.state = State.Scheduled;
        emit Scheduled(id, r.reporter, amount, r.eta, verified);
    }

    /// Records msg.sender's approval of `action`; true when this one reaches the threshold (once per action).
    function _approve(bytes32 action, Kind kind) private returns (bool reached) {
        if (approvedBy[action][msg.sender]) revert AlreadyApproved();
        approvedBy[action][msg.sender] = true;
        uint8 n = approvals[action] + 1;
        approvals[action] = n;
        emit Approved(action, msg.sender, kind, n);
        return n == threshold;
    }

    function _queue(bytes32 action, Kind kind) private {
        if (_approve(action, kind)) {
            uint64 eta = uint64(block.timestamp) + timelock;
            configEta[action] = eta;
            emit ConfigQueued(action, kind, eta);
        }
    }

    function _due(bytes32 action) private {
        uint64 eta = configEta[action];
        if (eta == 0) revert NotQueued();
        if (block.timestamp < eta) revert TooEarly();
        configEta[action] = 0;
    }

    function _setCommittee(address[] memory m, uint8 t) private {
        uint256 n = m.length;
        // a majority of at least one member: 1 <= t <= n and 2t > n
        if (n == 0 || n > MAX_MEMBERS || t == 0 || t > n || 2 * uint256(t) <= n) revert BadConfig();
        delete _members;
        for (uint256 i = 0; i < n; i++) {
            if (m[i] == address(0) || isMember[m[i]]) revert BadConfig();
            isMember[m[i]] = true;
            _members.push(m[i]);
        }
        threshold = t;
        epoch++;
        emit CommitteeSet(m, t, epoch);
    }

    function _credit(address to, uint256 a) private {
        owed[to] += a;
        owedTotal += a;
    }
}
