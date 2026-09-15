/**
 * Semaphore identity management for Keystone voter eligibility.
 *
 * This module wraps @semaphore-protocol/identity and @semaphore-protocol/group
 * to provide a clean interface for generating voter identities and managing
 * the Merkle tree of identity commitments.
 *
 * Semaphore identities are used to prove eligibility (membership in the
 * voter registry) and anonymity (nullifier derivation) without revealing
 * which voter cast which ballot. The identity commitment is derived from
 * a secret that only the voter knows.
 *
 * NOTE: Semaphore internally uses baby-jubjub (via @zk-kit/baby-jubjub),
 * which is built on @noble/curves. This is the same curve we plan to
 * switch to for the ElGamal/Chaum-Pedersen operations when implementing
 * the ZK circuits that tie identities to vote ciphertexts.
 */

import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import type { LeanIMTMerkleProof } from "@zk-kit/lean-imt";

/**
 * A Semaphore voter identity.
 *
 * The identity contains a secret scalar from which the public key and
 * commitment are derived. The commitment is published to the voter registry
 * Merkle tree; the secret is kept private by the voter.
 */
export interface VoterIdentity {
  /** The underlying Semaphore identity */
  identity: Identity;
  /** The identity commitment (hash of the public key) */
  commitment: bigint;
  /** The secret scalar (private key component) */
  secretScalar: bigint;
  /** The public key as a Baby Jubjub point [x, y] */
  publicKey: [bigint, bigint];
}

/**
 * Generate a new random voter identity.
 *
 * @returns A new VoterIdentity with random secret
 *
 * @example
 * ```ts
 * const voter = generateVoterIdentity();
 * // voter.commitment goes into the Merkle tree
 * // voter.secretScalar is kept secret by the voter
 * ```
 */
export function generateVoterIdentity(): VoterIdentity {
  const identity = new Identity();
  const publicKey = identity.publicKey as [bigint, bigint];
  return {
    identity,
    commitment: identity.commitment,
    secretScalar: identity.secretScalar,
    publicKey: [publicKey[0], publicKey[1]],
  };
}

/**
 * Generate a voter identity from a known secret (for deterministic testing).
 *
 * @param secret - A secret string or hex value
 * @returns A VoterIdentity derived from the secret
 */
export function generateVoterIdentityFromSecret(secret: string): VoterIdentity {
  const identity = new Identity(secret);
  const publicKey = identity.publicKey as [bigint, bigint];
  return {
    identity,
    commitment: identity.commitment,
    secretScalar: identity.secretScalar,
    publicKey: [publicKey[0], publicKey[1]],
  };
}

/**
 * Create a Semaphore group (Merkle tree) from a list of identity commitments.
 *
 * @param commitments - Array of identity commitments
 * @returns A Group containing all commitments
 */
export function createVoterGroup(commitments: bigint[]): Group {
  // Group accepts BigNumber[] where BigNumber = bigint | string (@zk-kit/utils),
  // so bigint[] is directly assignable — no cast needed.
  const group = new Group(commitments);
  return group;
}

/**
 * Get the Merkle tree root for a set of commitments.
 *
 * @param commitments - Array of identity commitments
 * @returns The Merkle root
 */
export function getMerkleRoot(commitments: bigint[]): bigint {
  const group = createVoterGroup(commitments);
  return group.root;
}

/**
 * Generate a Merkle proof of membership for a commitment.
 *
 * @param commitments - All commitments in the tree
 * @param index - The index of the commitment to prove membership for
 * @returns The Merkle proof
 */
export function generateMerkleProof(
  commitments: bigint[],
  index: number
): LeanIMTMerkleProof<bigint> {
  const group = createVoterGroup(commitments);
  return group.generateMerkleProof(index);
}

/**
 * Verify a Merkle proof of membership.
 *
 * @param proof - The Merkle proof
 * @returns true if the proof is valid
 */
export function verifyMerkleProof(proof: LeanIMTMerkleProof<bigint>): boolean {
  const group = new Group();
  const leanIMT = group.leanIMT;
  return leanIMT.verifyProof(proof);
}

// Re-export Semaphore types for convenience
export { Identity, Group };
export type { LeanIMTMerkleProof };