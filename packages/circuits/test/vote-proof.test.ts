/**
 * Integration tests for election-scoped Semaphore vote proofs.
 *
 * These run the REAL Semaphore circuit — no mocks, no stubbed verifier. A Groth16 proving
 * operation is the only way to establish that the message/scope wiring actually holds,
 * because both values are consumed inside the circuit.
 *
 * The three claims worth the proving time:
 *   - a valid proof verifies, and a proof re-pointed at a different ballot commitment does not
 *   - a second vote in the same election yields the SAME nullifier (double-vote rejection can work)
 *   - the same ballot in a different election yields a DIFFERENT nullifier (no cross-election link)
 *
 * FIRST RUN NEEDS NETWORK: the trusted-setup artifacts are not vendored. Semaphore resolves them
 * itself, downloading the wasm + zkey (~3.7 MB at depth 3) into the OS temp directory once and
 * reusing them afterwards.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import {
  electionScope,
  generateVoteProof,
  isProofForElection,
  SEMAPHORE_ARTIFACTS_VERSION,
  toVoteProofCalldata,
  verifyVoteProof,
  type SemaphoreProof,
} from "../src/index.js";

// 8 members -> LeanIMT depth 3 -> semaphore-3.* artifacts. Deliberately not smaller:
// Semaphore documents that groups of one or two members provide no anonymity, and this
// fixture should not normalize a non-anonymous group.
const GROUP_SIZE = 8;

const ELECTION_A = "election-2026-general";
const ELECTION_B = "election-2027-general";

// Stand-ins for "hash(ElGamal ciphertext + Chaum-Pedersen proof)" from @keystone/crypto.
// The two values model one voter changing their ballot. Neither encodes a candidate index
// — that is the point of hashing a ciphertext into this slot.
const BALLOT_COMMITMENT_1 = 0xa17f3c2e5b8d4190637e0f1a2c4b6d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8n;
const BALLOT_COMMITMENT_2 = 0xb28e4d3f6c9e5201748f1a2b3c5d7e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9n;

const voters = Array.from({ length: GROUP_SIZE }, (_, index) => new Identity(`keystone-test-voter-${index}`));
const group = new Group(voters.map((voter) => voter.commitment));

/** The voter whose proofs are exercised throughout. */
const voter = voters[0];

/** A well-formed identity that was never registered — for the negative membership test. */
const nonMember = new Identity("keystone-test-unregistered-voter");

let proofA1!: SemaphoreProof; // voter, election A, ballot 1
let proofA2!: SemaphoreProof; // voter, election A, ballot 2 — a second vote in the same election
let proofB!: SemaphoreProof; // voter, election B, ballot 1 — the same ballot in another election

/**
 * Copy a proof with fields replaced, standing in for an attacker editing it in transit.
 *
 * Takes `Record<string, string>` rather than `Partial<SemaphoreProof>` so a test can put a
 * plainly wrong value in a `NumericString` field without fighting the template literal type.
 */
function tamper(proof: SemaphoreProof, changes: Record<string, string>): SemaphoreProof {
  return { ...proof, ...changes };
}

beforeAll(async () => {
  // Artifacts are left to Semaphore's own resolution: at the pinned version it downloads the
  // wasm + zkey into the OS temp directory on first use and hands snarkjs local paths from then
  // on. The tree depth is inferred from the group, so circuit depth and artifacts cannot disagree.
  proofA1 = await generateVoteProof(voter, group, ELECTION_A, BALLOT_COMMITMENT_1);
  proofA2 = await generateVoteProof(voter, group, ELECTION_A, BALLOT_COMMITMENT_2);
  proofB = await generateVoteProof(voter, group, ELECTION_B, BALLOT_COMMITMENT_1);
});

describe("electionScope", () => {
  it("derives the same scope from the same election id", () => {
    expect(electionScope(ELECTION_A)).toBe(electionScope(ELECTION_A));
    expect(electionScope(42n)).toBe(electionScope(42n));
  });

  it("derives unrelated scopes for different elections", () => {
    expect(electionScope(ELECTION_A)).not.toBe(electionScope(ELECTION_B));
    expect(electionScope(42n)).not.toBe(electionScope(43n));
  });

  it("treats a string id and the same digits as an integer id as different elections", () => {
    // The encoding is type-tagged, so these cannot collide into one nullifier space.
    expect(electionScope("123")).not.toBe(electionScope(123n));
  });

  it("rejects an empty election id", () => {
    // An empty id would give every unset election one shared nullifier space.
    expect(() => electionScope("")).toThrow(/empty/);
  });

  it("rejects integer ids outside the 256-bit range", () => {
    expect(() => electionScope(-1n)).toThrow(/negative/);
    expect(() => electionScope(1n << 256n)).toThrow(/256 bits/);
  });

  it("returns a 248-bit value, inside the BN254 scalar field", () => {
    expect(electionScope(ELECTION_A)).toBeLessThan(1n << 248n);
  });
});

describe("vote proof generation", () => {
  it("builds a depth-3 group and proves at that depth", () => {
    // 8 members -> LeanIMT depth 3. Asserting the proof's depth pins the claim that the
    // circuit depth and the artifact set agree.
    expect(group.depth).toBe(3);
    expect(proofA1.merkleTreeDepth).toBe(group.depth);
  });

  it("pins the trusted-setup version Semaphore resolves by default", () => {
    // Guard, not an assertion about the library: it catches an accidental edit to our pin.
    // The artifacts come from one ceremony, so a version change silently swaps the
    // proving and verification keys under every voter.
    expect(SEMAPHORE_ARTIFACTS_VERSION).toBe("4.13.0");
  });

  it("binds the ballot commitment into the proof's message field", () => {
    expect(BigInt(proofA1.message)).toBe(BALLOT_COMMITMENT_1);
  });

  it("refuses to prove for an identity that is not in the group", async () => {
    await expect(generateVoteProof(nonMember, group, ELECTION_A, BALLOT_COMMITMENT_1)).rejects.toThrow(
      /not a member/,
    );
  });
});

describe("vote proof verification", () => {
  it("verifies a valid proof", async () => {
    await expect(verifyVoteProof(proofA1)).resolves.toBe(true);
  });

  it("rejects a proof re-pointed at a different ballot commitment", async () => {
    // The ballot-swap attack: keep the genuine membership proof, replace the ciphertext it
    // was bound to. This must fail, or a proof could be reused for a ballot nobody cast.
    const swapped = tamper(proofA1, { message: BALLOT_COMMITMENT_2.toString() });

    await expect(verifyVoteProof(swapped)).resolves.toBe(false);
  });

  it("rejects a proof whose message was nudged by one", async () => {
    const nudged = tamper(proofA1, { message: (BigInt(proofA1.message) + 1n).toString() });

    await expect(verifyVoteProof(nudged)).resolves.toBe(false);
  });

  it("rejects a proof whose scope was replaced with another election's", async () => {
    const rescoped = tamper(proofA1, { scope: electionScope(ELECTION_B).toString() });

    await expect(verifyVoteProof(rescoped)).resolves.toBe(false);
  });

  it("rejects a proof whose Merkle root was replaced", async () => {
    const reroooted = tamper(proofA1, { merkleTreeRoot: (BigInt(proofA1.merkleTreeRoot) + 1n).toString() });

    await expect(verifyVoteProof(reroooted)).resolves.toBe(false);
  });
});

describe("nullifier behaviour (double-vote rejection and cross-election unlinkability)", () => {
  it("repeats the nullifier for a second vote in the same election", async () => {
    // Both proofs must be genuine, or comparing nullifiers proves nothing.
    await expect(verifyVoteProof(proofA2)).resolves.toBe(true);

    // Different ballot, same election -> the contract's seen-nullifier set can reject the
    // second ballot as a double vote.
    expect(proofA1.nullifier).toBe(proofA2.nullifier);
    expect(BigInt(proofA2.message)).toBe(BALLOT_COMMITMENT_2);
  });

  it("produces a different nullifier in a different election", async () => {
    await expect(verifyVoteProof(proofB)).resolves.toBe(true);

    // Same voter, same ballot commitment, other election -> unlinkable across elections.
    expect(proofA1.nullifier).not.toBe(proofB.nullifier);
  });

  it("keeps the ballot commitment identical across elections", () => {
    // Isolates the variable in the test above: the scope changed, the ballot did not.
    expect(BigInt(proofB.message)).toBe(BigInt(proofA1.message));
  });
});

describe("election binding", () => {
  it("recognises a proof as belonging to its own election", () => {
    expect(isProofForElection(proofA1, ELECTION_A)).toBe(true);
  });

  it("reports a proof as not belonging to another election", () => {
    // A proof is cryptographically valid but still wrong for this election: the scope is
    // prover-chosen, so Groth16 verification alone cannot catch this.
    expect(isProofForElection(proofA1, ELECTION_B)).toBe(false);
  });
});

describe("calldata for the Solidity verifier (Phase 3)", () => {
  it("converts a proof into the verifier's argument tuple", () => {
    const calldata = toVoteProofCalldata(proofA1);

    expect(calldata.merkleTreeRoot).toBe(BigInt(proofA1.merkleTreeRoot));
    expect(calldata.nullifier).toBe(BigInt(proofA1.nullifier));
    expect(calldata.message).toBe(BALLOT_COMMITMENT_1);
    // The scope survives the round trip through the proof unchanged, which is what lets the
    // contract recompute and compare it.
    expect(calldata.scope).toBe(electionScope(ELECTION_A));
  });

  it("carries the 8 packed Groth16 elements", () => {
    const calldata = toVoteProofCalldata(proofA1);

    expect(calldata.points).toHaveLength(8);
    for (const point of calldata.points) {
      expect(typeof point).toBe("bigint");
    }
  });

  it("refuses a malformed packed proof", () => {
    const truncated = { ...proofA1, points: proofA1.points.slice(0, 4) } as SemaphoreProof;

    expect(() => toVoteProofCalldata(truncated)).toThrow(/8 elements/);
  });
});
