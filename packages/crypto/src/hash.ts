/**
 * Hash utilities for Fiat-Shamir transform and challenge derivation.
 *
 * We hash elliptic curve points by serializing them to compressed bytes,
 * then reducing the hash output modulo the curve order. This gives a
 * uniform challenge in Z_n suitable for Fiat-Shamir.
 */

import { sha256 } from "@noble/hashes/sha256";
import { CURVE, type ProjectivePoint } from "./curve.js";

/**
 * Hash arbitrary bytes to a scalar in [0, n-1].
 */
export function hashBytesToScalar(...bytes: Uint8Array[]): bigint {
  const combined = new Uint8Array(bytes.reduce((acc, b) => acc + b.length, 0));
  let offset = 0;
  for (const b of bytes) {
    combined.set(b, offset);
    offset += b.length;
  }
  const digest = sha256(combined);
  const hex = Array.from(digest).map(x => x.toString(16).padStart(2, "0")).join("");
  return BigInt("0x" + hex) % CURVE.n;
}

/**
 * Hash a set of points and labels to a scalar challenge.
 * Each point is prefixed with its label to prevent type confusion.
 *
 * @param items - Pairs of (label, point) to hash in order
 * @returns Challenge scalar in [0, n-1]
 */
export function hashPointsToScalar(
  items: Array<{ label: string; point: ProjectivePoint }>
): bigint {
  const parts: Uint8Array[] = [];
  for (const { label, point } of items) {
    const labelBytes = new TextEncoder().encode(label);
    const lenBytes = new Uint8Array(4);
    new DataView(lenBytes.buffer).setUint32(0, labelBytes.length, false);
    // Serialize point safely (identity point gets zero bytes)
    let pointBytes: Uint8Array;
    if (point.equals(CURVE.IDENTITY)) {
      pointBytes = new Uint8Array(33); // zero-filled
    } else {
      pointBytes = point.toRawBytes(true);
    }
    parts.push(lenBytes, labelBytes, pointBytes);
  }
  return hashBytesToScalar(...parts);
}