/**
 * Pedersen'\''s Distributed Key Generation (DKG) for Keystone.
 *
 * This module implements Pedersen'\''s DKG protocol for generating a shared
 * ElGamal public key among a committee of trustees, such that no single
 * trustee knows the full private key. Any threshold of trustees can
 * collaboratively decrypt, but fewer than threshold learn nothing.
 *
 * PROTOCOL OVERVIEW:
 * 1. Each trustee t generates a random Shamir polynomial of degree (threshold-1):
 *      f_t(x) = a_{t,0} + a_{t,1}*x + ... + a_{t,k-1}*x^{k-1}
 *    where a_{t,0} is the secret contribution.
 * 2. Each trustee broadcasts Pedersen commitments to polynomial coefficients:
 *      A_{t,j} = a_{t,j} * G
 * 3. Each trustee computes shares s_{t,u} = f_t(u) for every other trustee u,
 *    and sends them privately.
 * 4. Each trustee verifies received shares against broadcast commitments:
 *      s_{u,t} * G == sum_{j=0}^{k-1} A_{u,j} * t^j
 * 5. Each trustee computes their final secret share: x_t = sum_u s_{u,t}
 * 6. The group public key is: PK = sum_t A_{t,0}
 *
 * PARTIAL DECRYPTION:
 * Given a ciphertext (c1, c2), trustee t computes:
 *   d_t = x_t * c1
 * and provides a DLEQ proof that:
 *   log_G(X_t) = log_{c1}(d_t)
 * where X_t = x_t * G is the trustee'\''s public key share.
 *
 * This proves the partial decryption is correct WITHOUT revealing x_t.
 *
 * COMBINING PARTIALS:
 * Given k >= threshold partial decryptions with valid proofs, Lagrange
 * interpolation in the exponent recovers:
 *   sum_i lambda_i * d_i = sum_i lambda_i * x_i * c1 = x * c1
 * where x = sum_i lambda_i * x_i is the full secret key.
 *
 * SECURITY: Information-theoretically secure against passive adversaries
 * corrupting fewer than threshold trustees (Pedersen'\''s original proof).
 *
 * PURE FUNCTIONS: This module contains no I/O or networking. The ceremony
 * orchestration (message passing between trustees) is a separate concern
 * handled by a service layer.
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
import type {
  ElGamalCiphertext,
  DleqProof,
  PartialDecryption,
  DkgParticipant,
  DkgResult,
} from "./types.js";

/**
 * Evaluate a polynomial at a point x, given its coefficients.
 *
 * @param coefficients - [a_0, a_1, ..., a_{k-1}] where f(x) = a_0 + a_1*x + ... + a_{k-1}*x^{k-1}
 * @param x - The point at which to evaluate
 * @returns f(x) mod n
 */
function evalPolynomial(coefficients: bigint[], x: bigint): bigint {
  const n = CURVE.n;
  let result = 0n;
  let xPower = 1n;
  for (const coeff of coefficients) {
    result = (result + coeff * xPower) % n;
    xPower = (xPower * x) % n;
  }
  return result;
}

/**
 * Generate random polynomial coefficients for DKG.
 *
 * @param threshold - The threshold (degree + 1)
 * @returns Array of [a_0, a_1, ..., a_{threshold-1}] where a_0 is the secret
 */
export function generatePolynomial(threshold: number): bigint[] {
  const coefficients: bigint[] = [];
  for (let i = 0; i < threshold; i++) {
    coefficients.push(randomScalar());
  }
  return coefficients;
}

/**
 * Compute Pedersen commitments to polynomial coefficients.
 *
 * @param coefficients - The polynomial coefficients
 * @returns Array of commitments [a_0*G, a_1*G, ...]
 */
export function computeCommitments(coefficients: bigint[]): ProjectivePoint[] {
  return coefficients.map(c => scalarToPoint(c));
}

/**
 * Generate a DKG participant with their polynomial and commitments.
 *
 * @param index - The participant'\''s 1-based index
 * @param threshold - The threshold for the scheme
 * @returns A DKG participant with polynomial and commitments
 */
export function generateParticipant(index: number, threshold: number): DkgParticipant {
  const coefficients = generatePolynomial(threshold);
  const commitments = computeCommitments(coefficients);
  return {
    index,
    coefficients,
    commitments,
    receivedShares: new Map(),
    secretShare: 0n,
    publicKeyShare: CURVE.IDENTITY,
  };
}

/**
 * Compute a secret share from one participant to another.
 *
 * @param from - The sender participant
 * @param toIndex - The recipient'\''s 1-based index
 * @returns The secret share f_from(toIndex)
 */
export function computeShare(from: DkgParticipant, toIndex: number): bigint {
  return evalPolynomial(from.coefficients, BigInt(toIndex));
}

/**
 * Verify a received share against the sender'\''s broadcast commitments.
 *
 * Checks that: share * G == sum_{j=0}^{k-1} commitment_j * index^j
 *
 * @param share - The received share
 * @param fromIndex - The sender'\''s 1-based index
 * @param toIndex - The recipient'\''s 1-based index (the evaluation point)
 * @param commitments - The sender'\''s broadcast commitments
 * @returns true if the share is valid
 */
export function verifyShare(
  share: bigint,
  _fromIndex: number,
  toIndex: number,
  commitments: ProjectivePoint[]
): boolean {
  const n = CURVE.n;
  const x = BigInt(toIndex);

  // Compute RHS: sum_{j=0}^{k-1} A_j * x^j
  let rhs = CURVE.IDENTITY;
  let xPower = 1n;
  for (let j = 0; j < commitments.length; j++) {
    rhs = pointAdd(rhs, pointMul(commitments[j], xPower));
    xPower = (xPower * x) % n;
  }

  // Compute LHS: share * G
  const lhs = scalarToPoint(share);

  return lhs.equals(rhs);
}

/**
 * Run the full DKG ceremony (simulated, no networking).
 *
 * Each participant generates a polynomial, broadcasts commitments,
 * sends shares to others, verifies shares, and computes their final
 * secret share and public key share.
 *
 * @param threshold - The threshold (minimum trustees needed to decrypt)
 * @param numTrustees - The total number of trustees
 * @returns The DKG result with group public key and all participants
 */
export function runDkg(threshold: number, numTrustees: number): DkgResult {
  if (threshold < 1 || threshold > numTrustees) {
    throw new Error("Invalid threshold");
  }

  // Step 1: Each participant generates their polynomial
  const participants: DkgParticipant[] = [];
  for (let i = 1; i <= numTrustees; i++) {
    participants.push(generateParticipant(i, threshold));
  }

  // Step 2: Each participant sends shares to every other participant.
  // i === j is INCLUDED: a dealer also deals to themselves. Without the
  // self-share f_i(i), each participant's final share is missing their own
  // polynomial term and the collected shares no longer lie on a single
  // degree-(threshold-1) polynomial — Lagrange combination then yields
  // different results per subset.
  for (let i = 0; i < numTrustees; i++) {
    for (let j = 0; j < numTrustees; j++) {
      const share = computeShare(participants[i], participants[j].index);
      participants[j].receivedShares.set(participants[i].index, share);
    }
  }

  // Step 3: Each participant verifies shares and computes final share
  for (let j = 0; j < numTrustees; j++) {
    const p = participants[j];
    for (const [fromIndex, share] of p.receivedShares) {
      const sender = participants.find(pp => pp.index === fromIndex)!;
      if (!verifyShare(share, fromIndex, p.index, sender.commitments)) {
        throw new Error(`Invalid share from trustee ${fromIndex} to ${p.index}`);
      }
    }

    // Final secret share: sum of received shares (own included), i.e. f(p.index)
    let secretShare = 0n;
    for (const share of p.receivedShares.values()) {
      secretShare = (secretShare + share) % CURVE.n;
    }
    p.secretShare = secretShare;
    p.publicKeyShare = scalarToPoint(secretShare);
  }

  // Step 4: Group public key: sum of all a_{i,0} * G (first commitments)
  let groupPublicKey = CURVE.IDENTITY;
  for (const p of participants) {
    groupPublicKey = pointAdd(groupPublicKey, p.commitments[0]);
  }

  return { groupPublicKey, participants };
}

/**
 * Compute the Lagrange interpolation coefficient for a trustee at x=0.
 *
 * lambda_i = prod_{j in S, j != i} (0 - j) / (i - j) mod n
 *
 * @param trusteeIndex - The trustee'\''s 1-based index
 * @param allIndices - The set of trustee indices participating
 * @returns The Lagrange coefficient
 */
export function lagrangeCoefficient(trusteeIndex: number, allIndices: number[]): bigint {
  const n = CURVE.n;
  let lambda = 1n;
  const i = BigInt(trusteeIndex);

  for (const j of allIndices) {
    if (j !== trusteeIndex) {
      const jBig = BigInt(j);
      // numerator = (0 - j) = -j mod n
      const num = (n - jBig) % n;
      // denominator = (i - j) mod n
      const denom = (i - jBig + n) % n;
      // lambda *= num * denom^(-1) mod n
      const denomInv = modInverse(denom, n);
      lambda = (lambda * num % n) * denomInv % n;
    }
  }

  return lambda;
}

/**
 * Compute modular inverse using Fermat'\''s little theorem.
 *
 * @param a - The value to invert
 * @param p - The prime modulus
 * @returns a^(-1) mod p
 */
function modInverse(a: bigint, p: bigint): bigint {
  if (a === 0n) throw new Error("Cannot invert zero");
  return modPow(a, p - 2n, p);
}

/**
 * Modular exponentiation.
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = result * base % mod;
    }
    exp = exp >> 1n;
    base = base * base % mod;
  }
  return result;
}

/**
 * Create a partial decryption of a ciphertext using a trustee'\''s share.
 *
 * Computes d = share * c1 and creates a DLEQ proof that:
 * log_G(publicKeyShare) = log_{c1}(d)
 *
 * @param share - The trustee'\''s secret share
 * @param publicKeyShare - The trustee'\''s public key share (share * G)
 * @param ciphertext - The ciphertext to partially decrypt
 * @param trusteeIndex - The trustee'\''s 1-based index
 * @returns A partial decryption with DLEQ proof
 */
export function partialDecrypt(
  share: bigint,
  publicKeyShare: ProjectivePoint,
  ciphertext: ElGamalCiphertext,
  trusteeIndex: number
): PartialDecryption {
  assertValidPoint(ciphertext.c1);
  assertValidPoint(publicKeyShare);

  // d = share * c1
  const partial = pointMul(ciphertext.c1, share);

  // DLEQ proof: log_G(publicKeyShare) = log_{c1}(partial)
  const proof = proveDleq(CURVE.G, publicKeyShare, ciphertext.c1, partial, share);

  return { trusteeIndex, partial, proof };
}

/**
 * Generate a DLEQ proof: proves log_base1(point1) == log_base2(point2).
 *
 * @param base1 - First base (G)
 * @param point1 - First point (publicKeyShare = share * G)
 * @param base2 - Second base (c1)
 * @param point2 - Second point (partial = share * c1)
 * @param secret - The secret (share)
 * @returns A DLEQ proof
 */
function proveDleq(
  base1: ProjectivePoint,
  point1: ProjectivePoint,
  base2: ProjectivePoint,
  point2: ProjectivePoint,
  secret: bigint
): DleqProof {
  const w = randomScalar();
  const a1 = pointMul(base1, w);
  const a2 = pointMul(base2, w);

  const c = hashPointsToScalar([
    { label: "base1", point: base1 },
    { label: "point1", point: point1 },
    { label: "base2", point: base2 },
    { label: "point2", point: point2 },
    { label: "a1", point: a1 },
    { label: "a2", point: a2 },
  ]);

  const s = (w - c * secret % CURVE.n + CURVE.n) % CURVE.n;

  return { a1, a2, c, s };
}

/**
 * Verify a DLEQ proof.
 *
 * @param base1 - First base
 * @param point1 - First point
 * @param base2 - Second base
 * @param point2 - Second point
 * @param proof - The DLEQ proof
 * @returns true if the proof is valid
 */
export function verifyDleq(
  base1: ProjectivePoint,
  point1: ProjectivePoint,
  base2: ProjectivePoint,
  point2: ProjectivePoint,
  proof: DleqProof
): boolean {
  try {
    const c = hashPointsToScalar([
      { label: "base1", point: base1 },
      { label: "point1", point: point1 },
      { label: "base2", point: base2 },
      { label: "point2", point: point2 },
      { label: "a1", point: proof.a1 },
      { label: "a2", point: proof.a2 },
    ]);

    if (c !== proof.c) return false;

    // Check a1 == s * base1 + c * point1
    const expectedA1 = pointAdd(pointMul(base1, proof.s), pointMul(point1, proof.c));
    if (!proof.a1.equals(expectedA1)) return false;

    // Check a2 == s * base2 + c * point2
    const expectedA2 = pointAdd(pointMul(base2, proof.s), pointMul(point2, proof.c));
    if (!proof.a2.equals(expectedA2)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Combine partial decryptions to recover the decrypted plaintext point.
 *
 * Uses Lagrange interpolation in the exponent:
 *   M = sum_i lambda_i * d_i = sum_i lambda_i * x_i * c1 = x * c1
 *
 * Then m*G = c2 - M.
 *
 * @param partials - Array of partial decryptions (must be >= threshold valid ones)
 * @param ciphertext - The ciphertext being decrypted
 * @param threshold - The threshold
 * @returns The decrypted plaintext point m*G
 * @throws If fewer than threshold partials are provided
 */
export function combinePartialDecryptions(
  partials: PartialDecryption[],
  ciphertext: ElGamalCiphertext,
  threshold: number
): ProjectivePoint {
  if (partials.length < threshold) {
    throw new Error(`Need at least ${threshold} partials, got ${partials.length}`);
  }

  const indices = partials.map(p => p.trusteeIndex);

  // NOTE: This function does NOT verify the partials' DLEQ proofs — it has no
  // access to the trustees' public key shares. Callers MUST call verifyPartials()
  // (which takes the publicKeyShares map) before combining. Combining unverified
  // partials would let a malicious trustee corrupt the tally.

  // Lagrange interpolation in the exponent
  let result = CURVE.IDENTITY;
  for (const p of partials) {
    const lambda = lagrangeCoefficient(p.trusteeIndex, indices);
    result = pointAdd(result, pointMul(p.partial, lambda));
  }

  // m*G = c2 - result
  return pointSub(ciphertext.c2, result);
}

/**
 * Verify partial decryptions before combining.
 *
 * @param partials - Array of partial decryptions
 * @param publicKeyShares - Map of trustee index to public key share
 * @param ciphertext - The ciphertext being decrypted
 * @returns true if all proofs are valid
 */
export function verifyPartials(
  partials: PartialDecryption[],
  publicKeyShares: Map<number, ProjectivePoint>,
  ciphertext: ElGamalCiphertext
): boolean {
  for (const p of partials) {
    const pkShare = publicKeyShares.get(p.trusteeIndex);
    if (!pkShare) return false;

    if (!verifyDleq(
      CURVE.G,
      pkShare,
      ciphertext.c1,
      p.partial,
      p.proof
    )) {
      return false;
    }
  }
  return true;
}