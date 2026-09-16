/**
 * Election-scoped Semaphore scope derivation.
 *
 * WHY SCOPING EXISTS
 *
 * A Semaphore v4 proof exposes an output signal
 *
 *     nullifier <== Poseidon(2)([scope, secret])
 *
 * (verbatim from Semaphore's audited `semaphore.circom`). `scope` is the input that
 * decides *which* identifier a voter reveals, so it is the single knob controlling
 * linkability. Keystone derives it deterministically from the election id, which buys
 * both required properties at once:
 *
 *   - Same election + same voter  -> SAME nullifier. The on-chain seen-nullifier set
 *     rejects the second ballot. This is double-vote prevention (Phase 3 contracts).
 *   - Different election + same voter -> DIFFERENT nullifier. Two ballots from one
 *     voter cannot be joined by comparing nullifiers. This is cross-election
 *     unlinkability.
 *
 * A constant (or omitted) scope would keep the first property and silently lose the
 * second: every voter would carry one global pseudonym across every election they
 * ever vote in.
 *
 * WHAT THE RETURNED VALUE IS, AND WHAT IT IS NOT
 *
 * `electionScope()` returns the value to pass as the `scope` argument of
 * `@semaphore-protocol/proof`'s `generateProof`. That library hashes whatever it is
 * handed before the circuit sees it (`hash(scope)`: keccak256 over the 32-byte
 * big-endian encoding, shifted right 8 bits), so the value entering the nullifier is
 * `keccak256(electionScope(electionId))`. That extra hash is harmless here because
 * every step below is a pure function of the election id — determinism survives it.
 *
 * This module uses keccak256 for the same reason Semaphore does, and drops the top
 * 8 bits so the result is 248 bits: comfortably inside the BN254 scalar field, which
 * keeps it usable anywhere a field element is expected.
 *
 * NOTHING SECRET IS DERIVED HERE. The scope is public by construction — it is part of
 * the proof's public signals. The voter's secret never enters this file.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { utf8ToBytes } from "@noble/hashes/utils";

/**
 * Domain separator, versioned.
 *
 * Once it reaches the circuit the scope is a bare field element, so two systems that
 * both hash "an election id" into a scope could collide by accident. A stable,
 * versioned prefix makes that require a deliberate act rather than a coincidence.
 * Bump the version ONLY if the encoding below changes — doing so invalidates every
 * previously issued nullifier, which is exactly what versioning it protects against.
 */
export const SCOPE_DOMAIN = "keystone.election.scope.v1";

/**
 * Election identifier: a string label (e.g. "election-2026-general") or an on-chain
 * integer id.
 */
export type ElectionId = string | bigint;

/** 32-byte big-endian width used for integer election ids. */
const UINT256_BYTES = 32;

/** Largest integer election id accepted, so the 32-byte encoding can never truncate. */
const MAX_ELECTION_ID_INTEGER = (1n << 256n) - 1n;

/**
 * Derive the Semaphore scope for an election.
 *
 * Deterministic and collision-resistant: the same election id always yields the same
 * scope (nullifiers stay stable within an election), and a different election id
 * yields an unrelated scope (nullifiers cannot be correlated across elections).
 *
 * @param electionId - Stable identifier of the election (string label or integer id)
 * @returns The scope value to pass to `generateVoteProof`
 * @throws If a string id is empty, or an integer id is negative or wider than 256 bits
 *
 * @example
 * ```ts
 * const scope = electionScope("election-2026-general");
 * // generateVoteProof() derives the same value internally from the same id
 * ```
 */
export function electionScope(electionId: ElectionId): bigint {
  return bytesToBigInt(keccak_256(encodeElectionId(electionId))) >> 8n;
}

/**
 * Encode an election id to the exact bytes that get hashed.
 *
 * The two input types are tagged ("str" / "uint") so a string id can never encode to
 * the same bytes as an integer id — `electionScope("123")` and `electionScope(123n)`
 * are deliberately different scopes.
 */
function encodeElectionId(electionId: ElectionId): Uint8Array {
  if (typeof electionId === "string") {
    if (electionId.length === 0) {
      // An empty id would give every "unset" election one shared scope, silently
      // merging their nullifier spaces — the exact failure scoping exists to prevent.
      throw new Error("electionId must not be empty");
    }
    return utf8ToBytes(`${SCOPE_DOMAIN}:str:${electionId}`);
  }

  if (electionId < 0n) {
    throw new Error("electionId must not be negative");
  }
  if (electionId > MAX_ELECTION_ID_INTEGER) {
    throw new Error("electionId must fit in 256 bits");
  }

  const prefix = utf8ToBytes(`${SCOPE_DOMAIN}:uint:`);
  const encoded = new Uint8Array(prefix.length + UINT256_BYTES);
  encoded.set(prefix, 0);
  encoded.set(integerToBytes32(electionId), prefix.length);
  return encoded;
}

/**
 * Fixed-width big-endian encoding.
 *
 * Width is fixed so an id written as 123n and as 0x0000...7bn cannot produce two
 * different scopes for the same election.
 */
function integerToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(UINT256_BYTES);
  let remaining = value;
  for (let i = UINT256_BYTES - 1; i >= 0 && remaining > 0n; i -= 1) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Big-endian bytes to integer.
 *
 * Kept local rather than imported: the helper names for this differ between
 * @noble/hashes minor versions, and four lines are cheaper than a version constraint.
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return BigInt(`0x${hex}`);
}
