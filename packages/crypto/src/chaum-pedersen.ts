/**
 * Chaum-Pedersen zero-knowledge proofs for Keystone vote validity.
 *
 * This module implements the Cramer-Damgard-Schoenmakers (CDM) disjunctive
 * Chaum-Pedersen proof construction, as used in Helios and other verifiable
 * voting systems. It proves that an ElGamal ciphertext encrypts EXACTLY ONE
 * of the valid candidate indices {0, 1, ..., numCandidates-1}, without revealing
 * which one.
 *
 * The proof is a non-interactive OR-composition of DLEQ (Discrete Log Equality)
 * proofs via the Fiat-Shamir heuristic. For numCandidates candidates, the proof
 * consists of numCandidates sub-proofs, where exactly one is "real" (generated
 * using the actual encryption randomness) and the rest are "simulated" (generated
 * with random challenges and responses). The verifier checks that the sum of
 * all sub-challenges equals the overall Fiat-Shamir challenge.
 *
 * CONSTRUCTION (CDM OR-proof):
 * Given ciphertext (c1, c2) encrypting plaintext m with randomness r:
 * - For each candidate i in {0, ..., numCandidates-1}:
 *   - If i == m (the real proof):
 *     1. Choose random w
 *     2. a_i = w*G, b_i = w*PK
 *     3. c_i = challenge (computed later)
 *     4. s_i = w - c_i * r
 *   - If i != m (simulated proof):
 *     1. Choose random c_i, s_i
 *     2. a_i = s_i*G + c_i*c1
 *     3. b_i = s_i*PK + c_i*(c2 - i*G)
 * - Overall challenge: C = H(G, PK, c1, c2, all a_i, b_i)
 * - Real challenge: c_m = C - sum_{i!=m} c_i (mod n)
 * - Real response: s_m = w - c_m * r
 *
 * VERIFICATION:
 * 1. Recompute C = H(G, PK, c1, c2, all a_i, b_i)
 * 2. Check: sum(c_i) == C (mod n)
 * 3. For each i: check a_i == s_i*G + c_i*c1
 * 4. For each i: check b_i == s_i*PK + c_i*(c2 - i*G)
 *
 * REFERENCES:
 * - Cramer, Damgard, Schoenmakers: "Proofs of Partial Knowledge and Simplified
 *   Design of Witness Hiding Protocols", CRYPTO 1994
 * - Helios: https://vote.heliosvoting.org/ (adapted for exponential ElGamal)
 */

import {
  CURVE,
  pointAdd,
  pointSub,
  pointMul,
  scalarToPoint,
  randomScalar,
  assertValidPoint,
  type ProjectivePoint,
} from "./curve.js";
import { hashPointsToScalar } from "./hash.js";
import type { ElGamalCiphertext, ChaumPedersenProof } from "./types.js";

/**
 * Prove that a ciphertext encrypts a valid candidate index.
 *
 * Implements the CDM disjunctive Chaum-Pedersen proof showing that
 * (c1, c2) encrypts exactly one of {0, 1, ..., numCandidates-1}.
 *
 * @param ciphertext - The ElGamal ciphertext to prove about
 * @param plaintext - The actual plaintext (candidate index) that the ciphertext encrypts
 * @param publicKey - The public key used for encryption
 * @param encryptionRandomness - The randomness r used during encryption (c1 = r*G)
 * @param numCandidates - The number of valid candidates (plaintext must be in [0, numCandidates-1])
 * @returns A Chaum-Pedersen proof
 * @throws If plaintext is out of range [0, numCandidates-1]
 *
 * @example
 * ```ts
 * const kp = generateKeyPair();
 * const r = randomScalar();
 * const ct = encryptWithRandomness(kp.publicKey, 2n, r);
 * const proof = proveEncryptionOfIndex(ct, 2n, kp.publicKey, r, 5);
 * const valid = verifyEncryptionProof(ct, proof, kp.publicKey, 5); // true
 * ```
 */
export function proveEncryptionOfIndex(
  ciphertext: ElGamalCiphertext,
  plaintext: bigint,
  publicKey: ProjectivePoint,
  encryptionRandomness: bigint,
  numCandidates: number
): ChaumPedersenProof {
  if (plaintext < 0n || plaintext >= BigInt(numCandidates)) {
    throw new Error(`Plaintext ${plaintext} out of range [0, ${numCandidates - 1}]`);
  }
  assertValidPoint(ciphertext.c1);
  assertValidPoint(ciphertext.c2);
  assertValidPoint(publicKey);

  const m = Number(plaintext);
  const n = CURVE.n;

  const a: ProjectivePoint[] = new Array(numCandidates);
  const b: ProjectivePoint[] = new Array(numCandidates);
  const s: bigint[] = new Array(numCandidates);
  const c: bigint[] = new Array(numCandidates);

  // Choose random w for the real proof
  const w = randomScalar();

  // Real commitments (before knowing the challenge)
  a[m] = scalarToPoint(w);
  b[m] = pointMul(publicKey, w);

  // Simulate proofs for all i != m
  for (let i = 0; i < numCandidates; i++) {
    if (i !== m) {
      c[i] = randomScalar();
      s[i] = randomScalar();

      // a_i = s_i * G + c_i * c1
      a[i] = pointAdd(scalarToPoint(s[i]), pointMul(ciphertext.c1, c[i]));

      // b_i = s_i * PK + c_i * (c2 - i*G)
      const c2MinusIG = pointSub(ciphertext.c2, scalarToPoint(BigInt(i)));
      b[i] = pointAdd(pointMul(publicKey, s[i]), pointMul(c2MinusIG, c[i]));
    }
  }

  // Compute overall Fiat-Shamir challenge
  const challenge = computeOverallChallenge(publicKey, ciphertext, a, b);

  // Real challenge: c_m = C - sum_{i!=m} c_i (mod n)
  let cSumOthers = 0n;
  for (let i = 0; i < numCandidates; i++) {
    if (i !== m) {
      cSumOthers = (cSumOthers + c[i]) % n;
    }
  }
  c[m] = (challenge - cSumOthers + n) % n;

  // Real response: s_m = w - c_m * r (mod n)
  s[m] = (w - c[m] * encryptionRandomness % n + n) % n;

  return { a, b, s, c };
}

/**
 * Verify a Chaum-Pedersen proof that a ciphertext encrypts a valid candidate index.
 *
 * @param ciphertext - The ElGamal ciphertext
 * @param proof - The Chaum-Pedersen proof to verify
 * @param publicKey - The public key used for encryption
 * @param numCandidates - The number of valid candidates
 * @returns true if the proof is valid, false otherwise
 */
export function verifyEncryptionProof(
  ciphertext: ElGamalCiphertext,
  proof: ChaumPedersenProof,
  publicKey: ProjectivePoint,
  numCandidates: number
): boolean {
  try {
    assertValidPoint(ciphertext.c1);
    assertValidPoint(ciphertext.c2);
    assertValidPoint(publicKey);

    const { a, b, s, c } = proof;

    // Check array lengths
    if (a.length !== numCandidates || b.length !== numCandidates ||
        s.length !== numCandidates || c.length !== numCandidates) {
      return false;
    }

    // Check all points are valid
    for (let i = 0; i < numCandidates; i++) {
      assertValidPoint(a[i]);
      assertValidPoint(b[i]);
    }

    // Recompute overall challenge
    const challenge = computeOverallChallenge(publicKey, ciphertext, a, b);

    // Check: sum(c_i) == C (mod n)
    const n = CURVE.n;
    let cSum = 0n;
    for (let i = 0; i < numCandidates; i++) {
      cSum = (cSum + c[i]) % n;
    }
    if (cSum !== challenge) {
      return false;
    }

    // Verify each sub-proof
    for (let i = 0; i < numCandidates; i++) {
      // Check a_i == s_i * G + c_i * c1
      const expectedA = pointAdd(scalarToPoint(s[i]), pointMul(ciphertext.c1, c[i]));
      if (!a[i].equals(expectedA)) {
        return false;
      }

      // Check b_i == s_i * PK + c_i * (c2 - i*G)
      const c2MinusIG = pointSub(ciphertext.c2, scalarToPoint(BigInt(i)));
      const expectedB = pointAdd(pointMul(publicKey, s[i]), pointMul(c2MinusIG, c[i]));
      if (!b[i].equals(expectedB)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the overall Fiat-Shamir challenge for the disjunctive proof.
 *
 * Hashes all public data and commitments into a single scalar challenge.
 */
function computeOverallChallenge(
  publicKey: ProjectivePoint,
  ciphertext: ElGamalCiphertext,
  a: ProjectivePoint[],
  b: ProjectivePoint[]
): bigint {
  const items: Array<{ label: string; point: ProjectivePoint }> = [
    { label: "G", point: CURVE.G },
    { label: "PK", point: publicKey },
    { label: "c1", point: ciphertext.c1 },
    { label: "c2", point: ciphertext.c2 },
  ];

  for (let i = 0; i < a.length; i++) {
    items.push({ label: `a${i}`, point: a[i] });
    items.push({ label: `b${i}`, point: b[i] });
  }

  return hashPointsToScalar(items);
}