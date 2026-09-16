/**
 * @keystone/circuits — Semaphore v4 integration for Keystone's election-scoped membership proofs.
 *
 * Scope of this package: bind a voter's registry membership to exactly one encrypted ballot,
 * with a nullifier that is stable within an election and unlinkable across elections. Vote
 * validity itself is proven by Chaum-Pedersen proofs in @keystone/crypto — no custom Circom is
 * written here; Semaphore's audited circuit and trusted-setup artifacts are used as published.
 * See docs/adr/0001-crypto-architecture.md for the rationale.
 *
 * Voter flow:
 *   1. registry — voter identity commitment into a group (@keystone/crypto)
 *   2. ballot   — ElGamal encryption + Chaum-Pedersen validity proof (@keystone/crypto)
 *   3. proof    — generateVoteProof(identity, group, electionId, ballotCommitment)
 *   4. check    — verifyVoteProof(proof) + isProofForElection(proof, electionId)
 *   5. submit   — toVoteProofCalldata(proof) into the Phase 3 contract
 */

export { electionScope, SCOPE_DOMAIN } from "./election-scope.js";
export type { ElectionId } from "./election-scope.js";

export { generateVoteProof, SEMAPHORE_ARTIFACTS_VERSION } from "./generate-vote-proof.js";
export type { BallotCommitment } from "./generate-vote-proof.js";

export { verifyVoteProof, isProofForElection, toVoteProofCalldata } from "./verify-vote-proof.js";
export type { VoteProofCalldata } from "./verify-vote-proof.js";

/**
 * The Semaphore proof type, re-exported because it is the return type of
 * `generateVoteProof` and the argument to the verification helpers — callers need it to
 * hold a proof at all, and should not have to reach into the Semaphore package for it.
 */
export type { SemaphoreProof } from "@semaphore-protocol/proof";

export const CIRCUITS_VERSION = "0.1.0";
