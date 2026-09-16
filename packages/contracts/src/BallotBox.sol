// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MAX_DEPTH, MIN_DEPTH} from "@semaphore-protocol/contracts/base/Constants.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {ElectionRegistry} from "./ElectionRegistry.sol";

/**
 * @title BallotBox
 * @notice Accepts an encrypted ballot together with the Semaphore membership proof that
 *         authorises it, and is the only contract that spends a nullifier.
 *
 * @dev The three checks this contract performs are a set, not alternatives. Removing any one
 *      of them leaves a hole:
 *
 *      1. Groth16 verification (`SemaphoreVerifier`, audited, imported — never reimplemented)
 *         proves the voter is in the registry. On its own it proves nothing else: a proof is
 *         replayable and belongs to whatever election its scope names.
 *      2. The scope check pins the proof to exactly one election. Without it a voter who has
 *         already voted could mint a second, differently-scoped proof for the same election
 *         and receive a fresh nullifier — a double vote no nullifier check would catch.
 *      3. The nullifier set makes each voter's proof single-use.
 *
 *      The ballot commitment binds the proof to one specific encrypted ballot, so a valid proof
 *      cannot be re-pointed at a different ciphertext after the fact. This contract recomputes
 *      that commitment from calldata rather than trusting the submitter.
 *
 *      Deliberately NOT done here: verifying the Chaum-Pedersen proof or any curve arithmetic.
 *      The ciphertext and its validity proof are opaque bytes; their correctness is established
 *      off-chain by the indexer, which also does threshold decryption. secp256k1 verification
 *      is not affordable on-chain, and coupling the ballot box to a curve decision (D-003) it
 *      does not need to make would be a poor trade.
 *
 *      Storage is limited to nullifiers. The ballot itself travels in {VoteCast}, which the
 *      indexer consumes; duplicating ciphertexts in state would cost four slots per ballot and
 *      buy nothing the event does not already record.
 */
contract BallotBox {
    /**
     * @notice A Semaphore proof, in the shape its public inputs take on-chain.
     * @dev Field order mirrors Semaphore's own `Semaphore.sol`: the verifier is called with
     *      `[merkleTreeRoot, nullifier, hash(message), hash(scope)]` as the public signals, and
     *      `message` and `scope` are hashed by the CALLER (`_hash`, below) before they reach
     *      the verifier. `points` is the flattened (pA, pB, pC) Groth16 proof.
     */
    struct SemaphoreProof {
        uint256 merkleTreeRoot;
        uint256 nullifier;
        uint256 message;
        uint256 scope;
        uint256[8] points;
        uint256 merkleTreeDepth;
    }

    /// @dev The registry this box reads election configuration from; fixed at deployment.
    ElectionRegistry private immutable _registry;

    /// @dev Nullifiers already spent, per election. Keyed by election because a nullifier
    ///      encodes its scope, so the same voter's nullifier differs per election by
    ///      construction — the per-election key keeps the accounting readable without
    ///      weakening the guarantee.
    mapping(bytes32 electionId => mapping(uint256 nullifier => bool used)) private _usedNullifiers;

    /**
     * @notice Thrown when a ballot arrives after the election's voting window has closed.
     * @param electionId The election that is no longer accepting ballots
     * @param votingCloseAt The timestamp that closed it
     */
    error VotingClosed(bytes32 electionId, uint64 votingCloseAt);

    /**
     * @notice Thrown when the commitment recomputed from calldata differs from the one the
     *         proof was generated against.
     * @dev This is the check that makes proof-swapping fail: without it, a valid proof could
     *      be submitted alongside someone else's ciphertext.
     * @param recomputed The commitment derived from the submitted ciphertext and validity proof
     * @param supplied The commitment carried in the proof's `message` field
     */
    error BallotCommitmentMismatch(uint256 recomputed, uint256 supplied);

    /**
     * @notice Thrown when the proof's scope does not match the one derived from the election id.
     * @dev A proof for another election is valid Groth16 and would pass verification; this is
     *      the check that stops it being counted here.
     * @param electionId The election being voted in
     * @param expected The scope `electionScope(electionId)` derives
     * @param supplied The scope carried in the proof
     */
    error ScopeMismatch(bytes32 electionId, uint256 expected, uint256 supplied);

    /**
     * @notice Thrown when the proof was built against a root other than the election's current
     *         voter-registry root.
     * @param electionRoot The root currently recorded in the registry
     * @param supplied The root the proof was built against
     */
    error MerkleRootMismatch(bytes32 electionRoot, uint256 supplied);

    /**
     * @notice Thrown when a nullifier has already been spent in this election.
     * @param electionId The election whose ballot box rejected it
     * @param nullifier The nullifier being reused
     */
    error NullifierAlreadyUsed(bytes32 electionId, uint256 nullifier);

    /**
     * @notice Thrown when a proof claims a tree depth outside the verifier's supported range.
     * @param depth The depth the proof claims
     * @param minDepth Smallest depth the Semaphore verifier supports
     * @param maxDepth Largest depth the Semaphore verifier supports
     */
    error MerkleTreeDepthUnsupported(uint256 depth, uint256 minDepth, uint256 maxDepth);

    /**
     * @notice Thrown when the Semaphore verifier rejects the proof.
     * @dev Reached only after every cheaper check has passed, so an invalid proof costs the
     *      caller its verification gas rather than a cheap revert.
     */
    error InvalidProof();

    /**
     * @notice Emitted for every accepted ballot.
     * @dev The full ballot rides in the event rather than in storage: the indexer consuming
     *      {VoteCast} is what feeds tallying, and the ciphertext has to be public anyway for
     *      anyone to re-derive the tally.
     * @param electionId The election the ballot was cast in
     * @param nullifier The spent nullifier, for the indexer's per-voter accounting
     * @param ballotCommitment The commitment the proof was bound to
     * @param ciphertext The encrypted ballot, as the four coordinates of two curve points
     * @param chaumPedersenProof The ballot's validity proof, verified off-chain
     */
    event VoteCast(
        bytes32 indexed electionId,
        uint256 indexed nullifier,
        uint256 indexed ballotCommitment,
        uint256[4] ciphertext,
        bytes chaumPedersenProof
    );

    /**
     * @notice Pins the election registry whose configuration governs every ballot cast here.
     * @param electionRegistry_ The deployed {ElectionRegistry}. Its pinned Semaphore verifier is
     *        the one every proof is checked against, so the two contracts cannot drift apart.
     */
    constructor(ElectionRegistry electionRegistry_) {
        _registry = electionRegistry_;
    }

    /**
     * @notice Casts an encrypted ballot in an election, spending the proof's nullifier.
     *
     * @dev Permissionless: anyone may submit a voter's ballot, because a valid proof is the
     *      authorisation and a spent nullifier is the only thing that can be abused, which is
     *      rejected below.
     *
     *      Checks run cheapest-first so that a voter who simply mistyped their ballot does not
     *      pay for a Groth16 pairing. The expensive verifier call is deliberately last.
     *
     * @param electionId The election to vote in; must exist in the registry
     * @param ciphertext The encrypted ballot, as the four coordinates of two curve points. The
     *        coordinate layout is owned by the crypto package; this contract treats it as opaque
     * @param chaumPedersenProof The ballot's validity proof, hashed into the commitment and
     *        verified off-chain. Its exact serialization is owned by the crypto package
     * @param proof The Semaphore membership proof, as produced by `generateVoteProof`
     *
     * Emits {VoteCast}.
     */
    function castVote(
        bytes32 electionId,
        uint256[4] calldata ciphertext,
        bytes calldata chaumPedersenProof,
        SemaphoreProof calldata proof
    ) external {
        ElectionRegistry.Election memory election = _registry.getElection(electionId);

        if (block.timestamp >= election.votingCloseAt) {
            revert VotingClosed(electionId, election.votingCloseAt);
        }

        // Bounding the depth before calling the verifier: the verifier indexes its verification
        // key by depth, and an out-of-range depth is undefined behaviour rather than a clean
        // revert. MIN_DEPTH/MAX_DEPTH are Semaphore's own, so the bound cannot drift.
        if (proof.merkleTreeDepth < MIN_DEPTH || proof.merkleTreeDepth > MAX_DEPTH) {
            revert MerkleTreeDepthUnsupported(proof.merkleTreeDepth, MIN_DEPTH, MAX_DEPTH);
        }

        uint256 recomputedCommitment = _ballotCommitment(ciphertext, chaumPedersenProof);
        if (recomputedCommitment != proof.message) {
            revert BallotCommitmentMismatch(recomputedCommitment, proof.message);
        }

        uint256 expectedScope = electionScope(electionId);
        if (proof.scope != expectedScope) {
            revert ScopeMismatch(electionId, expectedScope, proof.scope);
        }

        bytes32 electionRoot = election.merkleRoot;
        if (proof.merkleTreeRoot != uint256(electionRoot)) {
            revert MerkleRootMismatch(electionRoot, proof.merkleTreeRoot);
        }

        if (_usedNullifiers[electionId][proof.nullifier]) {
            revert NullifierAlreadyUsed(electionId, proof.nullifier);
        }

        if (!_registry.semaphoreVerifier()
                .verifyProof(
                    [proof.points[0], proof.points[1]],
                    [[proof.points[2], proof.points[3]], [proof.points[4], proof.points[5]]],
                    [proof.points[6], proof.points[7]],
                    [proof.merkleTreeRoot, proof.nullifier, _hash(proof.message), _hash(proof.scope)],
                    proof.merkleTreeDepth
                )) {
            revert InvalidProof();
        }

        _usedNullifiers[electionId][proof.nullifier] = true;

        emit VoteCast(electionId, proof.nullifier, proof.message, ciphertext, chaumPedersenProof);
    }

    /// @dev `election-scope.ts`'s domain separator plus its integer tag. Not imported from that
    ///      module (Solidity cannot import TypeScript); the fixture test pins the two to agree.
    string private constant SCOPE_PREFIX = "keystone.election.scope.v1:uint:";

    /**
     * @notice Returns the election registry this box reads configuration from.
     * @return reg The registry pinned at deployment, whose verifier every proof is checked against
     */
    function registry() external view returns (ElectionRegistry reg) {
        return _registry;
    }

    /**
     * @notice Returns whether a nullifier has already been spent in an election.
     * @dev Off-chain use: the voter client can pre-check before submitting, and the indexer can
     *      cross-check what it observes on-chain.
     * @param electionId The election to query
     * @param nullifier The nullifier to look up
     * @return used True if a ballot with this nullifier has already been accepted
     */
    function isNullifierUsed(bytes32 electionId, uint256 nullifier) external view returns (bool used) {
        return _usedNullifiers[electionId][nullifier];
    }

    /**
     * @notice Returns the Semaphore scope that a proof for this election must carry.
     *
     * @dev Mirror of `electionScope()` in `packages/circuits/src/election-scope.ts`, integer
     *      branch: `uint256(keccak256(SCOPE_PREFIX ++ bytes32(electionId))) >> 8`, where the
     *      prefix is that module's domain separator plus its `":uint:"` tag.
     *
     *      The on-chain election id is `bytes32` and cannot be turned back into the UTF-8 label
     *      the off-chain module's *string* branch would use, so the convention is fixed here:
     *      election ids are integers, and the scope is always derived from the numeric value.
     *      Off-chain callers must call `electionScope(BigInt(electionId))` — the string branch
     *      yields a different scope and every proof would be rejected by {ScopeMismatch}.
     *
     *      Bumping the domain separator invalidates every previously issued nullifier, which is
     *      exactly why it is versioned in `election-scope.ts`.
     *
     * @param electionId The election whose scope is wanted
     * @return scope The 248-bit scope value proofs must carry
     */
    function electionScope(bytes32 electionId) public pure returns (uint256 scope) {
        return _expectedScope(electionId);
    }

    /**
     * @dev The ballot commitment: keccak256 over the validity proof followed by the four
     *      ciphertext coordinates, tightly packed, trimmed to 248 bits. `abi.encodePacked` is
     *      plain concatenation here, so the TypeScript side reproduces it byte for byte without
     *      ABI-encoding offsets — `generate-contract-fixtures.mjs` computes it the same way and
     *      the fixture test fails if the two ever disagree.
     */
    function _ballotCommitment(uint256[4] calldata ciphertext, bytes calldata chaumPedersenProof)
        private
        pure
        returns (uint256)
    {
        return uint256(
            keccak256(abi.encodePacked(chaumPedersenProof, ciphertext[0], ciphertext[1], ciphertext[2], ciphertext[3]))
        ) >> 8;
    }

    function _expectedScope(bytes32 electionId) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(SCOPE_PREFIX, electionId))) >> 8;
    }

    /**
     * @dev Verbatim from Semaphore's `Semaphore.sol` — `message` and `scope` reach the verifier
     *      hashed, so the caller must apply the same hash. Changing this breaks every proof.
     */
    function _hash(uint256 value) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(value))) >> 8;
    }
}
