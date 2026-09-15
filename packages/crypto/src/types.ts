/**
 * Shared cryptographic types for Keystone.
 */

import type { ProjectivePoint } from "./curve.js";

/**
 * ElGamal ciphertext: (c1, c2) where c1 = r*G, c2 = m*G + r*PK.
 */
export interface ElGamalCiphertext {
  /** First component: r*G */
  c1: ProjectivePoint;
  /** Second component: m*G + r*PK */
  c2: ProjectivePoint;
}

/**
 * ElGamal key pair. The private key is a scalar; the public key is a point.
 */
export interface ElGamalKeyPair {
  /** Public key: privateKey * G */
  publicKey: ProjectivePoint;
  /** Private key scalar */
  privateKey: bigint;
}

/**
 * Chaum-Pedersen proof that a ciphertext encrypts a plaintext in a given set.
 */
export interface ChaumPedersenProof {
  /** Per-candidate commitments a_i = s_i * G + c_i * c1 */
  a: ProjectivePoint[];
  /** Per-candidate commitments b_i = s_i * PK + c_i * (c2 - i*G) */
  b: ProjectivePoint[];
  /** Per-candidate responses s_i */
  s: bigint[];
  /** Per-candidate challenges c_i */
  c: bigint[];
}

/**
 * Partial decryption from a single trustee.
 */
export interface PartialDecryption {
  /** Trustee index */
  trusteeIndex: number;
  /** Partial decryption: share_i * c1 */
  partial: ProjectivePoint;
  /** Chaum-Pedersen proof that partial = share_i * c1 and pubkeyShare_i = share_i * G */
  proof: DleqProof;
}

/**
 * DLEQ (Discrete Log Equality) proof: proves log_G(A) = log_B(C).
 * Used for partial decryption correctness proofs.
 */
export interface DleqProof {
  /** Commitment: r * G */
  a1: ProjectivePoint;
  /** Commitment: r * B (where B = c1 for partial decryption) */
  a2: ProjectivePoint;
  /** Challenge */
  c: bigint;
  /** Response: r - c * x (where x is the secret) */
  s: bigint;
}

/**
 * DKG participant state during the key generation ceremony.
 */
export interface DkgParticipant {
  /** Participant index (1-based) */
  index: number;
  /** Polynomial coefficients [a_0, a_1, ..., a_{t-1}] */
  coefficients: bigint[];
  /** Commitments to coefficients [a_0*G, a_1*G, ..., a_{t-1}*G] */
  commitments: ProjectivePoint[];
  /** Secret shares received from other participants: Map<fromIndex, share> */
  receivedShares: Map<number, bigint>;
  /** Final secret share: sum of all received shares */
  secretShare: bigint;
  /** Public key share: secretShare * G */
  publicKeyShare: ProjectivePoint;
}

/**
 * DKG output: the combined group key and all participants' data.
 */
export interface DkgResult {
  /** Group public key: sum of all a_{i,0} * G */
  groupPublicKey: ProjectivePoint;
  /** All participants with their final shares */
  participants: DkgParticipant[];
}