/**
 * Exponential ElGamal encryption for Keystone vote secrecy.
 *
 * In exponential ElGamal, a plaintext integer m is encoded as m*G (a curve
 * point). A ciphertext is a pair (c1, c2) where:
 *   c1 = r * G
 *   c2 = m * G + r * PK
 *
 * The scheme is additively homomorphic: adding ciphertexts component-wise
 * yields a ciphertext encrypting the sum of plaintexts. This is the property
 * that enables tallying without decrypting individual votes.
 *
 * Decryption recovers m*G = c2 - sk*c1, then solves the discrete log over a
 * small known range [0, maxRange] via baby-step-giant-step. This works because
 * we only ever decrypt SUMS of up to a few thousand votes, not individual
 * ciphertexts over the full group.
 */

import {
  CURVE,
  pointAdd,
  pointSub,
  pointMul,
  scalarToPoint,
  randomScalar,
  isIdentity,
  assertValidPoint,
  type ProjectivePoint,
} from "./curve.js";
import type { ElGamalCiphertext, ElGamalKeyPair } from "./types.js";

/**
 * Generate an ElGamal key pair.
 *
 * @returns A key pair with publicKey = privateKey * G
 *
 * @example
 * ```ts
 * const kp = generateKeyPair();
 * // kp.publicKey is a curve point
 * // kp.privateKey is a scalar in [1, n-1]
 * ```
 */
export function generateKeyPair(): ElGamalKeyPair {
  const privateKey = randomScalar();
  const publicKey = scalarToPoint(privateKey);
  return { publicKey, privateKey };
}

/**
 * Generate a key pair from a known private key (useful for testing and DKG).
 *
 * @param privateKey - The private key scalar
 * @returns A key pair with publicKey = privateKey * G
 */
export function keyPairFromPrivate(privateKey: bigint): ElGamalKeyPair {
  const publicKey = scalarToPoint(privateKey);
  return { publicKey, privateKey };
}

/**
 * Encrypt a plaintext integer using exponential ElGamal.
 *
 * @param publicKey - The recipient'\''s public key
 * @param plaintext - The plaintext integer to encrypt (must be non-negative)
 * @returns The ElGamal ciphertext (c1, c2)
 *
 * @example
 * ```ts
 * const kp = generateKeyPair();
 * const ct = encrypt(kp.publicKey, 3n); // encrypt candidate index 3
 * ```
 */
export function encrypt(publicKey: ProjectivePoint, plaintext: bigint): ElGamalCiphertext {
  if (plaintext < 0n) {
    throw new Error("Plaintext must be non-negative");
  }
  assertValidPoint(publicKey);

  const r = randomScalar();
  const c1 = scalarToPoint(r);
  const c2 = pointAdd(scalarToPoint(plaintext), pointMul(publicKey, r));

  return { c1, c2 };
}

/**
 * Encrypt with a specified randomness (useful for testing and proof generation).
 *
 * @param publicKey - The recipient'\''s public key
 * @param plaintext - The plaintext integer to encrypt
 * @param randomness - The encryption randomness r
 * @returns The ElGamal ciphertext (c1, c2)
 */
export function encryptWithRandomness(
  publicKey: ProjectivePoint,
  plaintext: bigint,
  randomness: bigint
): ElGamalCiphertext {
  if (plaintext < 0n) {
    throw new Error("Plaintext must be non-negative");
  }
  assertValidPoint(publicKey);

  const c1 = scalarToPoint(randomness);
  const c2 = pointAdd(scalarToPoint(plaintext), pointMul(publicKey, randomness));

  return { c1, c2 };
}

/**
 * Decrypt an ElGamal ciphertext to recover the plaintext integer.
 *
 * Uses baby-step-giant-step to solve the discrete log of m*G over the
 * range [0, maxRange]. This is efficient for small ranges (O(sqrt(maxRange))).
 *
 * @param privateKey - The recipient'\''s private key
 * @param ciphertext - The ciphertext to decrypt
 * @param maxRange - Upper bound for the plaintext (default: 10000)
 * @returns The decrypted plaintext integer
 * @throws If the plaintext is not found in [0, maxRange]
 *
 * @example
 * ```ts
 * const kp = generateKeyPair();
 * const ct = encrypt(kp.publicKey, 42n);
 * const m = decrypt(kp.privateKey, ct, 100n); // === 42n
 * ```
 */
export function decrypt(
  privateKey: bigint,
  ciphertext: ElGamalCiphertext,
  maxRange: number = 10000
): bigint {
  assertValidPoint(ciphertext.c1);
  assertValidPoint(ciphertext.c2);

  // m*G = c2 - sk*c1
  const mG = pointSub(ciphertext.c2, pointMul(ciphertext.c1, privateKey));

  // If m = 0, m*G is the identity
  if (isIdentity(mG)) {
    return 0n;
  }

  return babyStepGiantStep(mG, maxRange);
}

/**
 * Homomorphically add multiple ciphertexts.
 *
 * Given ciphertexts encrypting m1, m2, ..., mk, returns a ciphertext
 * encrypting m1 + m2 + ... + mk. This is done by component-wise point
 * addition:
 *   c1_sum = c1_1 + c1_2 + ... + c1_k
 *   c2_sum = c2_1 + c2_2 + ... + c2_k
 *
 * @param ciphertexts - Array of ciphertexts to sum
 * @returns A new ciphertext encrypting the sum of plaintexts
 *
 * @example
 * ```ts
 * const ct1 = encrypt(pk, 3n);
 * const ct2 = encrypt(pk, 5n);
 * const sum = homomorphicAdd([ct1, ct2]); // encrypts 8
 * ```
 */
export function homomorphicAdd(ciphertexts: ElGamalCiphertext[]): ElGamalCiphertext {
  if (ciphertexts.length === 0) {
    throw new Error("Cannot add empty array of ciphertexts");
  }

  let c1Sum = ciphertexts[0].c1;
  let c2Sum = ciphertexts[0].c2;

  for (let i = 1; i < ciphertexts.length; i++) {
    assertValidPoint(ciphertexts[i].c1);
    assertValidPoint(ciphertexts[i].c2);
    c1Sum = pointAdd(c1Sum, ciphertexts[i].c1);
    c2Sum = pointAdd(c2Sum, ciphertexts[i].c2);
  }

  return { c1: c1Sum, c2: c2Sum };
}

/**
 * Baby-step-giant-step algorithm for discrete log over a small range.
 *
 * Given a point P = m*G where m is in [0, maxRange], finds m.
 *
 * Algorithm:
 * 1. Compute s = ceil(sqrt(maxRange))
 * 2. Baby step: store j*G for j in [0, s-1] in a lookup table
 * 3. Giant step: compute P - i*s*G for i in [0, s-1], check if in table
 * 4. If P - i*s*G = j*G, then m = i*s + j
 *
 * Time: O(sqrt(maxRange)), Space: O(sqrt(maxRange))
 *
 * @param target - The point P = m*G to find the discrete log of
 * @param maxRange - Upper bound for m (inclusive)
 * @returns The discrete log m
 * @throws If m is not found in [0, maxRange]
 */
export function babyStepGiantStep(target: ProjectivePoint, maxRange: number): bigint {
  if (maxRange < 0) {
    throw new Error("maxRange must be non-negative");
  }

  const s = Math.ceil(Math.sqrt(maxRange + 1));

  // Baby step: build lookup table of j*G for j in [0, s-1]
  const table = new Map<string, number>();
  let babyPoint = CURVE.IDENTITY;
  for (let j = 0; j < s; j++) {
    table.set(pointToKey(babyPoint), j);
    babyPoint = pointAdd(babyPoint, CURVE.G);
  }

    // Giant step: compute (-s)*G = (n - s)*G
  const negGiantStep = pointMul(CURVE.G, CURVE.n - BigInt(s % Number(CURVE.n)));

  // Search: P + i*(-s*G) for i in [0, s-1]
  let gamma = target;
  for (let i = 0; i < s; i++) {
    const key = pointToKey(gamma);
    if (table.has(key)) {
      const j = table.get(key)!;
      const m = BigInt(i * s + j);
      if (m <= BigInt(maxRange)) {
        return m;
      }
    }
    gamma = pointAdd(gamma, negGiantStep);
  }

  throw new Error(`Discrete log not found in range [0, ${maxRange}]`);
}

/**
 * Convert a point to a string key for use in a Map.
 */
function pointToKey(point: ProjectivePoint): string {
  // Identity point (point at infinity) cannot be serialized as bytes
  if (point.equals(CURVE.IDENTITY)) {
    return "INFINITY";
  }
  const bytes = point.toRawBytes(true);
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}