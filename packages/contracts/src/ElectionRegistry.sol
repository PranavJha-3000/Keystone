// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";

/**
 * @title ElectionRegistry
 * @notice Records the on-chain configuration of every Keystone election, and owns the
 *         voter-registry root that membership proofs are checked against.
 *
 * @dev Scope: this contract stores election configuration and nothing else — no ballots, no
 * tallies, no nullifier set. Casting and proof verification belong to the Phase 3 ballot box,
 * which reads its configuration from here and spends the Semaphore nullifier.
 *
 * Why the Semaphore verifier appears here. Keystone does not implement Groth16 verification.
 * The audited verifier is imported from the `semaphore-protocol/contracts` package
 * (`base/SemaphoreVerifier.sol`) and its address is recorded once at deployment, so the ballot
 * box and off-chain clients resolve the exact verifier governing these elections from one
 * place rather than each hard-coding an address. This registry never calls `verifyProof` — it
 * pins the address that does.
 *
 * The editable window. Configuration is immutable once created, with one deliberate exception:
 * `updateMerkleRoot`, permitted only while registration is still open
 * (`block.timestamp < eligibilityCloseAt`). Voter registration legitimately runs past election
 * creation, so the root must be able to move. But a silently mutable root would let an operator
 * rewrite the electorate after the fact, so every change emits `MerkleRootUpdated` carrying
 * both the previous and the new root, and once `eligibilityCloseAt` passes the root is frozen
 * permanently.
 *
 * Existence is tracked separately from `merkleRoot`. The root of an empty Semaphore group is
 * zero, so `merkleRoot == bytes32(0)` is a legitimate value and cannot double as
 * "not registered".
 */
contract ElectionRegistry is AccessControl {
    /// @notice Role authorised to create elections and amend their registration root.
    bytes32 public constant ELECTION_ADMIN_ROLE = keccak256("ELECTION_ADMIN_ROLE");

    /**
     * @notice Configuration recorded for one election.
     * @dev Storage packing: `merkleRoot` fills a slot, `numCandidates` fills another, the two
     * timestamps share one, and the two key coordinates take one each — five slots total.
     * Timestamps are `uint64` because that is the natural width for Unix seconds (good past
     * year 584 billion) and it lets them pack together.
     */
    struct Election {
        /// @notice Root of the voter-registry Merkle tree that membership proofs are built against
        bytes32 merkleRoot;
        /// @notice Number of candidates on the ballot, fixed at creation
        uint256 numCandidates;
        /// @notice Unix timestamp (seconds) after which the voter registry is frozen
        uint64 eligibilityCloseAt;
        /// @notice Unix timestamp (seconds) after which ballots are no longer accepted
        uint64 votingCloseAt;
        /**
         * @notice Threshold ElGamal group public key as the affine pair (x, y)
         * @dev Stored opaquely: the coordinate field and point encoding are defined by
         * `@keystone/crypto`, not by this registry. Kept as two words so no compression
         * scheme has to be agreed on-chain, and so any curve narrower than 256 bits fits.
         */
        uint256[2] dkgPublicKey;
    }

    /// @dev Election configuration by election id.
    mapping(bytes32 electionId => Election) private _elections;

    /// @dev Registration flag, separate from the struct because a Merkle root of zero is valid.
    mapping(bytes32 electionId => bool) private _registered;

    /// @dev Audited Semaphore Groth16 verifier, fixed for the lifetime of this registry.
    ISemaphoreVerifier private immutable _semaphoreVerifier;

    /**
     * @notice Thrown when creating an election whose id is already registered.
     * @param electionId The id that collided
     */
    error ElectionAlreadyExists(bytes32 electionId);

    /**
     * @notice Thrown when reading or amending an election that was never created.
     * @param electionId The id that has no configuration
     */
    error ElectionNotFound(bytes32 electionId);

    /**
     * @notice Thrown when the registration window has closed, so the root can no longer move.
     * @param electionId The election whose window is shut
     * @param eligibilityCloseAt The timestamp that closed it
     */
    error RegistrationClosed(bytes32 electionId, uint64 eligibilityCloseAt);

    /**
     * @notice Thrown when a caller lacks the role an operation requires.
     * @param caller The address that was rejected
     * @param requiredRole The role it needed
     */
    error Unauthorized(address caller, bytes32 requiredRole);

    /**
     * @notice Emitted when an election's configuration is first recorded.
     * @param electionId Id of the new election
     * @param merkleRoot Initial voter-registry root, amendable until `eligibilityCloseAt`
     * @param numCandidates Number of candidates on the ballot
     * @param eligibilityCloseAt Timestamp that freezes the voter registry
     * @param votingCloseAt Timestamp that ends ballot acceptance
     * @param dkgPublicKey Threshold ElGamal group public key, as (x, y)
     */
    event ElectionCreated(
        bytes32 indexed electionId,
        bytes32 merkleRoot,
        uint256 numCandidates,
        uint64 eligibilityCloseAt,
        uint64 votingCloseAt,
        uint256[2] dkgPublicKey
    );

    /**
     * @notice Emitted on every registration-root change, so no change is silent.
     * @dev The old root is carried in the event precisely because the contract no longer holds
     * it. Reconstructing the pre-change electorate otherwise means replaying every prior
     * `MerkleRootUpdated`, which is the audit trail this event exists to make unnecessary.
     * @param electionId Id of the amended election
     * @param oldMerkleRoot The root that was replaced
     * @param newMerkleRoot The root that is now current
     */
    event MerkleRootUpdated(bytes32 indexed electionId, bytes32 oldMerkleRoot, bytes32 newMerkleRoot);

    /**
     * @notice Deploys the registry and installs its administrators.
     * @dev `admin` receives both `DEFAULT_ADMIN_ROLE` (the role that grants and revokes others)
     * and `ELECTION_ADMIN_ROLE`, so a single-key deployment is operable immediately. For
     * production, prefer granting `ELECTION_ADMIN_ROLE` to an operational key and leaving
     * `DEFAULT_ADMIN_ROLE` with a multisig.
     * @param semaphoreVerifier_ Address of the deployed Semaphore verifier this registry pins
     * @param admin Address granted both `DEFAULT_ADMIN_ROLE` and `ELECTION_ADMIN_ROLE`
     */
    constructor(address semaphoreVerifier_, address admin) {
        _semaphoreVerifier = ISemaphoreVerifier(semaphoreVerifier_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ELECTION_ADMIN_ROLE, admin);
    }

    /**
     * @notice Records a new election's configuration.
     * @dev Elections cannot be edited after creation except for their registration root, and
     * that only until `eligibilityCloseAt`. There is deliberately no delete or overwrite: an id
     * is spent once, so a proof scoped to it can never be pointed at different rules.
     *
     * Reverts with `Unauthorized` before any state is read, so an unauthorised caller cannot
     * probe which election ids exist.
     *
     * @param electionId Stable identifier, also the value the off-chain scope is derived from
     * @param merkleRoot Initial voter-registry root; amendable until `eligibilityCloseAt`
     * @param numCandidates Number of candidates on the ballot; immutable
     * @param eligibilityCloseAt Unix timestamp after which the voter registry is frozen
     * @param votingCloseAt Unix timestamp after which ballots are no longer accepted
     * @param dkgPublicKey Threshold ElGamal group public key, as (x, y)
     *
     * Emits {ElectionCreated}.
     */
    function createElection(
        bytes32 electionId,
        bytes32 merkleRoot,
        uint256 numCandidates,
        uint64 eligibilityCloseAt,
        uint64 votingCloseAt,
        uint256[2] calldata dkgPublicKey
    ) external {
        _checkElectionAdmin();

        if (_registered[electionId]) {
            revert ElectionAlreadyExists(electionId);
        }

        _elections[electionId] = Election({
            merkleRoot: merkleRoot,
            numCandidates: numCandidates,
            eligibilityCloseAt: eligibilityCloseAt,
            votingCloseAt: votingCloseAt,
            dkgPublicKey: dkgPublicKey
        });
        _registered[electionId] = true;

        emit ElectionCreated(electionId, merkleRoot, numCandidates, eligibilityCloseAt, votingCloseAt, dkgPublicKey);
    }

    /**
     * @notice Amends an election's voter-registry root while registration is still open.
     * @dev The only mutation this registry permits. It exists because registration continues
     * after an election is created and the root therefore has to track newly eligible voters.
     *
     * Two properties make the exception safe rather than a back door:
     *   1. It stops at `eligibilityCloseAt` — `block.timestamp >= eligibilityCloseAt` reverts,
     *      so the window is strictly "before close" and the root is frozen once voting opens.
     *   2. It is never silent. Every change emits {MerkleRootUpdated} with the previous root and
     *      the new one, so an auditor reading only events can reconstruct the exact electorate
     *      each proof was checked against.
     *
     * A proof built against a superseded root will fail verification, which is the intended
     * behaviour: the voter re-proves against the current root.
     *
     * Reverts with `Unauthorized` before any state is read, so an unauthorised caller cannot
     * probe which election ids exist.
     *
     * @param electionId Election to amend; must already exist
     * @param newMerkleRoot Replacement root; accepted even if equal to the current one, so the
     *        emitted event stays a faithful log of operator intent
     *
     * Emits {MerkleRootUpdated}.
     */
    function updateMerkleRoot(bytes32 electionId, bytes32 newMerkleRoot) external {
        _checkElectionAdmin();

        if (!_registered[electionId]) {
            revert ElectionNotFound(electionId);
        }

        Election storage election = _elections[electionId];
        uint64 eligibilityCloseAt = election.eligibilityCloseAt;

        if (block.timestamp >= eligibilityCloseAt) {
            revert RegistrationClosed(electionId, eligibilityCloseAt);
        }

        // Read before writing: the old root is the whole point of the event below.
        bytes32 oldMerkleRoot = election.merkleRoot;
        election.merkleRoot = newMerkleRoot;

        emit MerkleRootUpdated(electionId, oldMerkleRoot, newMerkleRoot);
    }

    /**
     * @notice Returns the full recorded configuration of an election.
     * @dev Reverts rather than returning an empty struct, so a caller can never mistake
     * "unregistered" for "registered with zero values".
     * @param electionId Election to read
     * @return election The election's configuration
     */
    function getElection(bytes32 electionId) external view returns (Election memory election) {
        if (!_registered[electionId]) {
            revert ElectionNotFound(electionId);
        }
        return _elections[electionId];
    }

    /**
     * @notice Returns the audited Semaphore verifier this registry pins for its elections.
     * @dev Exposed so the Phase 3 ballot box and off-chain clients can resolve the verifying
     * contract from the registry instead of hard-coding an address. The registry itself never
     * calls `verifyProof` — it imports `ISemaphoreVerifier` from the
     * `semaphore-protocol/contracts` package rather than Keystone implementing Groth16
     * verification itself.
     * @return verifier The Semaphore verifier address fixed at deployment
     */
    function semaphoreVerifier() external view returns (ISemaphoreVerifier verifier) {
        return _semaphoreVerifier;
    }

    /**
     * @dev Rejects callers without `ELECTION_ADMIN_ROLE`.
     *
     * OZ's `onlyRole` modifier would revert with `AccessControlUnauthorizedAccount`, but
     * Keystone's contract surface specifies a single `Unauthorized` error across its own
     * contracts, so the check is explicit and the message stays in our namespace. AccessControl
     * still owns role storage, granting, and revocation — only the rejection is ours.
     */
    function _checkElectionAdmin() private view {
        if (!hasRole(ELECTION_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized(msg.sender, ELECTION_ADMIN_ROLE);
        }
    }
}
