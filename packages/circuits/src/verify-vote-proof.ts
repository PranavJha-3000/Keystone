/**
 * Vote-proof verification: off-chain checks and the on-chain verifier's calldata shape.
 *
 * TWO CONSUMERS, ONE PROOF OBJECT
 *
 * 1. Off-chain (tests, indexer) — `verifyVoteProof(proof)` runs Semaphore's Groth16
 *    verification against the proof's public signals.
 * 2. On-chain (Phase 3, `packages/contracts`) — `toVoteProofCalldata(proof)` reshapes the
 *    same object into the argument tuple the Semaphore Solidity verifier takes:
 *    `(uint256 merkleTreeRoot, uint256 nullifier, uint256 message, uint256 scope, uint256[8] points)`.
 *    No translation layer is invented here; `points` is the packed Groth16 proof exactly as
 *    Semaphore packed it, and the four scalars are the public signals.
 *
 * WHAT VERIFICATION DOES — AND WHAT IT DOES NOT
 *
 * `verifyProof` checks that this is a valid Groth16 proof for
 * `[merkleTreeRoot, nullifier, hash(message), hash(scope)]`. It does NOT know which election
 * the proof was meant for, and it does NOT know whether the nullifier was already used.
 * Both are the caller's job:
 *
 *   - Election binding: `isProofForElection(proof, electionId)`. `scope` is an input the
 *     prover chooses, so a proof generated for election A is cryptographically VALID in
 *     election B. Accepting on `verifyVoteProof` alone would let a voter replay a ballot
 *     into a different election. Check both, and let the contract check the scope too.
 *   - Double voting: the nullifier. Rejecting a repeat needs state, so it belongs to the
 *     contract's seen-nullifier set (Phase 3) — not to a stateless proof check.
 *
 * Tampering with `message`, `scope`, `merkleTreeRoot` or `points` makes `verifyVoteProof`
 * return false rather than throw, which is what the tamper tests assert.
 */

import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { electionScope, type ElectionId } from "./election-scope.js";

/** A Groth16 proof packs to 8 field elements: pi_a (2) + pi_b (4) + pi_c (2). */
const GROTH16_PROOF_LENGTH = 8;

/**
 * Verify a vote proof's cryptographic validity.
 *
 * Thin wrapper over Semaphore's `verifyProof`, kept as our own named entry point so the
 * package's public surface does not re-export Semaphore's whole API, and so callers have
 * exactly one place to look for what is and is not being checked (see the module comment).
 *
 * @param proof - The Semaphore proof produced by `generateVoteProof`
 * @returns true iff the Groth16 proof is valid for the public signals it carries
 * @throws If the proof object is malformed (Semaphore validates field types)
 *
 * @example
 * ```ts
 * if (!(await verifyVoteProof(proof)) || !isProofForElection(proof, electionId)) {
 *   // reject before touching the chain
 * }
 * ```
 */
export async function verifyVoteProof(proof: SemaphoreProof): Promise<boolean> {
  return verifyProof(proof);
}

/**
 * Check that a proof was generated for a specific election.
 *
 * Must accompany `verifyVoteProof`: the scope is prover-chosen, so a valid proof from
 * another election passes Groth16 verification unchanged.
 *
 * @param proof - The Semaphore proof to inspect
 * @param electionId - The election the proof is being submitted for
 * @returns true iff the proof's scope is the one this election id derives
 */
export function isProofForElection(proof: SemaphoreProof, electionId: ElectionId): boolean {
  return BigInt(proof.scope) === electionScope(electionId);
}

/**
 * The Semaphore verifier's argument tuple, as `bigint`s.
 *
 * `bigint` rather than a hex string because that is what an ABI encoder (viem, ethers)
 * consumes directly; the values originate as hex, so either form encodes identically.
 */
export interface VoteProofCalldata {
  /** Public signal: Merkle root of the voter registry the proof was built against */
  merkleTreeRoot: bigint;
  /** Public signal: election-scoped nullifier — the double-vote key (Phase 3) */
  nullifier: bigint;
  /** Public signal: `hash(ballotCommitment)`, binding the proof to one ciphertext */
  message: bigint;
  /** Public signal: `hash(electionScope(electionId))` */
  scope: bigint;
  /** Packed Groth16 proof: pi_a (2) + pi_b (4) + pi_c (2) */
  points: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}

/**
 * Reshape a proof into the calldata the Solidity verifier expects (Phase 3 hand-off).
 *
 * Deliberately does no cryptography — it only converts the decimal strings Semaphore
 * returns into the `bigint`s an ABI encoder needs, and rejects a proof whose packed
 * points are not the expected 8 elements (a malformed proof should fail here, loudly,
 * rather than as a confusing revert on-chain).
 *
 * @param proof - The Semaphore proof produced by `generateVoteProof`
 * @returns The verifier's argument tuple
 * @throws If the packed Groth16 proof does not have 8 elements
 */
export function toVoteProofCalldata(proof: SemaphoreProof): VoteProofCalldata {
  if (proof.points.length !== GROTH16_PROOF_LENGTH) {
    throw new Error(
      `Expected a packed Groth16 proof of ${GROTH16_PROOF_LENGTH} elements, received ${proof.points.length}`
    );
  }

  const points = proof.points.map((value) => BigInt(value));

  return {
    merkleTreeRoot: BigInt(proof.merkleTreeRoot),
    nullifier: BigInt(proof.nullifier),
    message: BigInt(proof.message),
    scope: BigInt(proof.scope),
    // The length check above guarantees this; TypeScript cannot narrow an array's length
    // to a tuple type, so the assertion is the only way to express it.
    points: points as unknown as VoteProofCalldata["points"]
  };
}
