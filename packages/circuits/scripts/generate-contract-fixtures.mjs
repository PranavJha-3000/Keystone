/**
 * Generates the Solidity-side vote-proof fixtures for packages/contracts' Foundry tests.
 *
 * A Foundry test cannot run snarkjs, and hand-written uint256s prove nothing — so the proof is
 * produced here on the real Semaphore circuit and written out as data the Solidity test loads.
 * That makes the on-chain test a real end-to-end check: a proof this repo generated is accepted
 * by the real Semaphore verifier through BallotBox, against the same scope the contract derives
 * in Solidity.
 *
 * The fixture also pins the one agreement with no other way of being tested: the ballot
 * commitment. The contract recomputes it from calldata, so if the Solidity formula and this one
 * ever drift, every proof stops verifying — and the test says so.
 *
 * RUN: cd packages/circuits && pnpm build && node scripts/generate-contract-fixtures.mjs
 * (`pnpm build` first: this imports the compiled electionScope on purpose — deriving the scope
 * with the shipped implementation makes this a cross-language test, not two copies of a formula.)
 *
 * Needs network on first run: trusted-setup artifacts land in the OS temp dir (~3.7 MB, depth 3).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";

import { electionScope } from "../dist/index.js";

// 8 members -> LeanIMT depth 3 -> semaphore-3.* artifacts, matching the vitest suite.
const GROUP_SIZE = 8;

// INTEGER election ids, not the strings the vitest suite uses. Load-bearing: the contract holds
// `bytes32 electionId` and cannot recover a UTF-8 label from it, so it derives the scope through
// electionScope's *integer* branch. Convention: scope comes from the numeric id, so
// `bytes32(uint256(1001))` on-chain corresponds to `1001n` here. The two encodings must agree
// byte for byte or nothing verifies.
const ELECTION_A = 1001n;
const ELECTION_B = 1002n;

// Stand-ins for a real ElGamal ciphertext (2 curve points = 4 coordinates) and a Chaum-Pedersen
// proof blob. Opaque to the contract, which only hashes them.
const CT_1 = [0x11c0de5a1b2c3d4en, 0x2207f4b3a2c1d0e9n, 0x3333a1b2c3d4e5f6n, 0x4444b2c3d4e5f607n];
const CT_2 = [0x5555c3d4e5f60718n, 0x6666d4e5f6071829n, 0x7777e5f60718293an, 0x8888f60718293a4bn];
const CP_1 = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff);
const CP_2 = Uint8Array.from({ length: 64 }, (_, i) => (i * 11 + 5) & 0xff);

/** 32-byte big-endian encoding of a uint256. */
function word(value) {
  const bytes = new Uint8Array(32);
  let remaining = BigInt(value);
  for (let i = 31; i >= 0 && remaining > 0n; i -= 1) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * The ballot commitment, in exactly the shape BallotBox recomputes:
 *   uint256(keccak256(abi.encodePacked(cpProof, ct[0], ct[1], ct[2], ct[3]))) >> 8
 * `abi.encodePacked` is plain concatenation, so this is reproducible in both languages without
 * ABI-encoding offsets. `>> 8` keeps it inside the BN254 scalar field, matching how both
 * Semaphore's `_hash` and electionScope() trim to 248 bits.
 */
function ballotCommitment(cpProof, ciphertext) {
  const payload = new Uint8Array(cpProof.length + 32 * ciphertext.length);
  payload.set(cpProof, 0);
  ciphertext.forEach((w, index) => payload.set(word(w), cpProof.length + index * 32));
  return BigInt(`0x${bytesToHex(keccak_256(payload))}`) >> 8n;
}

const voters = Array.from({ length: GROUP_SIZE }, (_, i) => new Identity(`keystone-fixture-voter-${i}`));
const group = new Group(voters.map((voter) => voter.commitment));
const voter = voters[0];

const commitment1 = ballotCommitment(CP_1, CT_1);
const commitment2 = ballotCommitment(CP_2, CT_2);
const scopeA = electionScope(ELECTION_A);
const scopeB = electionScope(ELECTION_B);

const proofA1 = await generateProof(voter, group, commitment1, scopeA); // election A, ballot 1
const proofA2 = await generateProof(voter, group, commitment2, scopeA); // same election, new ballot
const proofB1 = await generateProof(voter, group, commitment1, scopeB); // ballot 1, other election

const serialize = (proof) => ({
  points: proof.points.map(String),
  merkleTreeRoot: String(proof.merkleTreeRoot),
  nullifier: String(proof.nullifier),
  message: String(proof.message),
  scope: String(proof.scope),
  merkleTreeDepth: String(proof.merkleTreeDepth),
});

const fixture = {
  groupSize: GROUP_SIZE,
  merkleTreeDepth: String(proofA1.merkleTreeDepth),
  merkleTreeRoot: String(proofA1.merkleTreeRoot),
  electionIdA: String(ELECTION_A),
  electionIdB: String(ELECTION_B),
  scopeA: String(scopeA),
  scopeB: String(scopeB),
  ciphertext1: CT_1.map(String),
  ciphertext2: CT_2.map(String),
  chaumPedersenProof1: `0x${bytesToHex(CP_1)}`,
  chaumPedersenProof2: `0x${bytesToHex(CP_2)}`,
  commitment1: String(commitment1),
  commitment2: String(commitment2),
  proofA1: serialize(proofA1),
  proofA2: serialize(proofA2),
  proofB1: serialize(proofB1),
};

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/test/fixtures/vote-proofs.json"
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);

// Silent on success: the written file IS the output, and the nullifier relationships the old
// stdout summary used to advertise are asserted properly by the Foundry suite that consumes it.