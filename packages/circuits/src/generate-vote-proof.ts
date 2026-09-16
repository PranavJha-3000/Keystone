/**
 * Vote-proof generation: a Semaphore membership proof bound to one encrypted ballot.
 *
 * WHAT IS BEING PROVED
 *
 * `generateVoteProof` produces a Semaphore v4 proof that the holder of `identity` is a
 * member of the voter registry (the `group` Merkle tree) without revealing which member.
 * The proof comes from Semaphore's audited circuit and its published trusted-setup
 * artifacts — Keystone writes no Circom here (ADR-0001).
 *
 * THE `message` FIELD IS THE BALLOT BINDING — READ THIS BEFORE CHANGING IT
 *
 * Semaphore's `message` input is free-form. Inside the circuit it is only squared
 * (`signal dummySquare <== message * message`), which adds a constraint that pins the
 * value into the public signals and makes the proof non-malleable; Semaphore then
 * checks `hash(message)` against those public signals during verification. So the
 * message cannot be altered after the fact without invalidating the proof.
 *
 * Keystone uses that slot to carry `ballotCommitment`: a hash over the ElGamal
 * ciphertext AND its Chaum-Pedersen validity proof, both produced by `@keystone/crypto`.
 * It is emphatically NOT the plaintext vote and NOT the candidate index — nothing that
 * could reveal a choice.
 *
 * WHY: the binding is what stops a ballot-swap attack. Without it, membership and ballot
 * would be independent artifacts, so anyone who observed a valid membership proof
 * (merkle root, nullifier, Groth16 points) could attach it to a DIFFERENT ciphertext and
 * the chain would see a genuine proof next to a ballot the voter never cast. With the
 * commitment inside the proof's public signals, a swapped ciphertext no longer matches
 * `hash(message)` and verification fails.
 *
 * CONSEQUENCE FOR CALLERS: the commitment must be computed over exactly the bytes that
 * get submitted on-chain. Any re-encoding in between — different ciphertext point
 * serialization, re-running the Chaum-Pedersen proof, reordering candidates — changes the
 * commitment and the proof will not verify. That is the intended failure mode: loud, and
 * it fails closed.
 *
 * LAYERING NOTE
 *
 * This package deliberately does NOT import `@keystone/crypto`. The commitment arrives as
 * an opaque scalar, which keeps the membership subsystem independent of the encryption
 * subsystem's curve (D-003 — those two currently sit on different curves, and this module
 * is unaffected by that).
 */

import type { Group, MerkleProof } from "@semaphore-protocol/group";
import type { Identity } from "@semaphore-protocol/identity";
import { generateProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import type { SnarkArtifacts } from "@zk-kit/artifacts";
import { electionScope, type ElectionId } from "./election-scope.js";

/**
 * Pinned Semaphore circuit / trusted-setup artifact version.
 *
 * This is the same version `generateProof` resolves when no artifacts are supplied,
 * recorded here so tests, docs and production pinning all cite one number. These
 * artifacts are the output of Semaphore's trusted-setup ceremony (400+ participants,
 * completed 2024-07-13); a version bump means a different setup, so it must be a
 * deliberate recorded change — never a silent `latest`.
 */
export const SEMAPHORE_ARTIFACTS_VERSION = "4.13.0";

/**
 * The commitment binding a membership proof to one specific encrypted ballot.
 *
 * Normally a `bigint` field element (a hash of the ciphertext plus its Chaum-Pedersen
 * proof). `string` and `Uint8Array` are accepted and forwarded because Semaphore's
 * `generateProof` normalizes them itself.
 */
export type BallotCommitment = bigint | string | Uint8Array;

/**
 * Generate an election-scoped Semaphore proof bound to a single encrypted ballot.
 *
 * @param identity - The voter's Semaphore identity; the secret never leaves the caller
 * @param groupOrMerkleProof - The voter registry group, or a Merkle proof pre-built for this voter
 * @param electionId - Election identifier; decides the scope, and therefore the nullifier
 * @param ballotCommitment - Hash of the ElGamal ciphertext + Chaum-Pedersen proof (NOT the plaintext vote)
 * @param merkleTreeDepth - Circuit depth; inferred from the group or Merkle proof when omitted
 * @param snarkArtifacts - Trusted-setup wasm + zkey; resolved to the pinned version when omitted
 * @returns The Semaphore proof — public signals are merkle root, nullifier, message and scope
 * @throws If the identity is not a member of the supplied group
 *
 * @example
 * ```ts
 * const proof = await generateVoteProof(identity, group, electionId, ballotCommitment);
 * // proof.nullifier is stable for this (identity, electionId) pair — see election-scope.ts
 * ```
 */
export async function generateVoteProof(
  identity: Identity,
  groupOrMerkleProof: Group | MerkleProof,
  electionId: ElectionId,
  ballotCommitment: BallotCommitment,
  merkleTreeDepth?: number,
  snarkArtifacts?: SnarkArtifacts
): Promise<SemaphoreProof> {
  assertMemberOfGroup(identity, groupOrMerkleProof);

  // `scope` is the entire reason this wrapper exists: electionScope(electionId) makes the
  // nullifier stable within one election and unlinkable across elections.
  return generateProof(
    identity,
    groupOrMerkleProof,
    ballotCommitment,
    electionScope(electionId),
    merkleTreeDepth,
    snarkArtifacts
  );
}

/**
 * Fail early and legibly when the identity is not in the registry.
 *
 * `generateProof` derives the Merkle proof from `group.indexOf(commitment)`; for a
 * non-member that index is -1 and the failure surfaces from deep inside snarkjs as an
 * opaque assertion error. A Merkle proof cannot be checked this way — it says nothing
 * about which identity it was built for — so it is passed through untouched.
 */
function assertMemberOfGroup(identity: Identity, groupOrMerkleProof: Group | MerkleProof): void {
  if ("siblings" in groupOrMerkleProof) {
    return;
  }
  if (groupOrMerkleProof.indexOf(identity.commitment) === -1) {
    throw new Error(
      "Identity is not a member of this group: its commitment does not appear in the voter registry"
    );
  }
}