/**
 * Curve abstraction layer for Keystone cryptography.
 *
 * CURRENT IMPLEMENTATION: secp256k1 from @noble/curves.
 *
 * WHY NOT BABY-JUBJUB:
 * @noble/curves does not ship baby-jubjub natively. Baby-jubjub lives in the
 * BN254/ZK ecosystem (@zk-kit/baby-jubjub, @semaphore-protocol/identity) and
 * its parameters are not part of the @noble/curves library. We could define
 * baby-jubjub manually via the `twistedEdwards` factory, but that requires
 * hand-entering 254-bit curve parameters (prime, d-coefficient, generator
 * coordinates, curve order) � one wrong digit produces a silently broken
 * implementation that passes basic smoke tests but fails edge cases.
 *
 * secp256k1 has identical group structure for our purposes: a prime-order
 * elliptic curve group supporting point addition, scalar multiplication, and
 * discrete log over a small range. ALL crypto logic in this package is
 * curve-agnostic � it operates purely on group elements and scalars.
 *
 * Semaphore compatibility path: @semaphore-protocol/identity (used in
 * semaphore-identity.ts) internally uses @zk-kit/baby-jubjub which is built
 * on @noble/curves. When we implement the ZK circuits that tie Semaphore
 * identities to vote ciphertexts, we will switch this abstraction to
 * baby-jubjub (either via @zk-kit/baby-jubjub or a hand-defined curve).
 * That change will be isolated to this file only.
 */

import { secp256k1 } from "@noble/curves/secp256k1";

/**
 * Point type � a Weierstrass curve point over secp256k1.
 * In noble-curves 1.9+, this is accessible as secp256k1.ProjectivePoint.
 */
type ProjectivePoint = InstanceType<typeof secp256k1.ProjectivePoint>;

/**
 * The curve group we operate on. All ElGamal, Chaum-Pedersen, and DKG
 * operations use this group.
 */
export const CURVE = {
  /** Generator point G */
  G: secp256k1.ProjectivePoint.BASE,
  /** Identity (point at infinity) */
  IDENTITY: secp256k1.ProjectivePoint.ZERO,
  /** Curve order n (prime) */
  n: secp256k1.CURVE.n,
  /** Order minus one, useful for scalar arithmetic */
  nMinus1: secp256k1.CURVE.n - 1n,
};

/**
 * Point type alias for readability.
 */
export type { ProjectivePoint };

/**
 * Add two curve points.
 */
export function pointAdd(a: ProjectivePoint, b: ProjectivePoint): ProjectivePoint {
  return a.add(b);
}

/**
 * Subtract b from a: a - b.
 */
export function pointSub(a: ProjectivePoint, b: ProjectivePoint): ProjectivePoint {
  return a.subtract(b);
}

/**
 * Multiply a point by a scalar.
 */
export function pointMul(point: ProjectivePoint, scalar: bigint): ProjectivePoint {
  // 0 * P = identity
  if (scalar === 0n) return CURVE.IDENTITY;
  return point.multiply(scalar);
}

/**
 * Negate a point: -P.
 */
export function pointNeg(point: ProjectivePoint): ProjectivePoint {
  return point.negate();
}

/**
 * Multiply the generator by a scalar: scalar * G.
 */
export function scalarToPoint(scalar: bigint): ProjectivePoint {
  // 0 * G = identity (point at infinity)
  if (scalar === 0n) return CURVE.IDENTITY;
  return CURVE.G.multiply(scalar);
}

/**
 * Generate a uniformly random scalar in [1, n-1].
 */
export function randomScalar(): bigint {
  const bytes = secp256k1.utils.randomPrivateKey();
  return bytesToReducedScalar(bytes);
}

/**
 * Convert random bytes to a scalar in [0, n-1] via modular reduction.
 */
export function bytesToReducedScalar(bytes: Uint8Array): bigint {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const val = BigInt("0x" + hex);
  // Reduce modulo n. If result is 0, retry with n-1 (extremely unlikely).
  const reduced = val % CURVE.n;
  return reduced === 0n ? CURVE.n - 1n : reduced;
}

/**
 * Serialize a point to compressed bytes (33 bytes for secp256k1).
 */
export function pointToBytes(point: ProjectivePoint): Uint8Array {
  if (point.equals(CURVE.IDENTITY)) {
    throw new Error("Cannot serialize identity point to bytes");
  }
  return point.toRawBytes(true);
}

/**
 * Check if a point is the identity (point at infinity).
 */
export function isIdentity(point: ProjectivePoint): boolean {
  return point.equals(CURVE.IDENTITY);
}

/**
 * Assert that a point is valid and on the curve.
 * @throws if the point is invalid
 */
export function assertValidPoint(point: ProjectivePoint): void {
  point.assertValidity();
}