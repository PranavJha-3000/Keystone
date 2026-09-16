# Execution Flow

<!-- Document the flows you actually touch. A partial, accurate map beats a complete, stale one. -->

## Vote membership proof (generation + verification) · 2026-09-16

Entry: `packages/circuits/src/generate-vote-proof.ts → generateVoteProof()`

1. `packages/circuits/src/generate-vote-proof.ts → assertMemberOfGroup()` — registry membership
   pre-check; only runs for a `Group` (a Merkle proof cannot be checked this way, so it passes through)
2. `packages/circuits/src/election-scope.ts → electionScope()` — electionId → type-tagged encoding →
   keccak256 → right-shift 8 → 248-bit scope
3. `@semaphore-protocol/proof → generateProof()` — hashes message and scope, infers tree depth from the
   group, resolves the pinned trusted-setup artifacts (downloading them to the OS temp dir on first
   use), runs the audited `semaphore.circom`, returns the `SemaphoreProof`
4. `packages/circuits/src/verify-vote-proof.ts → verifyVoteProof()` — Groth16 verification over
   `[merkleTreeRoot, nullifier, hash(message), hash(scope)]` (tests, indexer; off-chain)
5. `packages/circuits/src/verify-vote-proof.ts → isProofForElection()` — MUST accompany step 4: the
   scope is prover-chosen, so a valid proof from another election passes Groth16 unchanged
6. `packages/circuits/src/verify-vote-proof.ts → toVoteProofCalldata()` — reshape into the Phase 3
   Solidity verifier's argument tuple `(merkleTreeRoot, nullifier, message, scope, uint256[8] points)`

Upstream (not changed by this flow, listed for context): voter identity commitments enter the group via
`packages/crypto/src/semaphore-identity.ts → createVoterGroup()`, and the ballot commitment is expected
to be a hash over the ElGamal ciphertext plus Chaum-Pedersen proof produced by `@keystone/crypto`.

Assumptions:
- The voter's identity commitment is already in the group's Merkle tree (or the caller supplied a valid
  Merkle proof for it)
- `ballotCommitment` is computed over exactly the bytes that will be submitted on-chain — any
  re-encoding between proving and submission breaks the binding (intended: fails closed)
- Proving artifacts are resolvable: cached in the OS temp dir, or supplied explicitly

Side effects:
- First run downloads the wasm + zkey (~3.7 MB at depth 3) into the OS temp directory; nothing else
  touches the network or disk. This package persists no state

Fragile:
- The message binding. Changing ciphertext serialization, re-running the Chaum-Pedersen proof, or
  reordering candidates invalidates the proof. Loud failure, but it will read as "the prove/verify
  code is broken" if the commitment is computed inconsistently on the two sides
- Cross-election replay: `verifyVoteProof()` alone ACCEPTS a valid proof generated for a different
  election. Always pair it with `isProofForElection()`, and have the contract check the scope itself
- Nullifier reuse is stateful and therefore NOT checkable here — that belongs to the Phase 3 contract's
  seen-nullifier set. This flow only guarantees the nullifier is stable per (identity, election)

Not yet wired (this flow stops at the proof object and its calldata):
`packages/contracts` (Phase 3 verifier + nullifier set), `services/indexer`, `apps/voter-web`.

## Election creation and registration window (ElectionRegistry) · 2026-09-16

Entry: `packages/contracts/src/ElectionRegistry.sol → createElection()`

1. `ElectionRegistry → _checkElectionAdmin()` — `hasRole(ELECTION_ADMIN_ROLE, msg.sender)`, else
   `Unauthorized(caller, role)`. Runs before any state read, so ids cannot be probed for existence.
2. `ElectionRegistry → createElection()` — reverts `ElectionAlreadyExists` if `_registered[id]`,
   otherwise stores the `Election` struct, sets `_registered[id] = true`, emits `ElectionCreated`.
3. *(registration window)* `ElectionRegistry → updateMerkleRoot()` — admin only, then
   `ElectionNotFound` if unknown, then `RegistrationClosed` if `block.timestamp >=
   eligibilityCloseAt`; otherwise writes the root and emits `MerkleRootUpdated(id, old, new)`.
4. `ElectionRegistry → getElection()` — reverts `ElectionNotFound` if unknown, else returns the struct.
5. `ElectionRegistry → semaphoreVerifier()` — returns the immutable verifier address pinned at deploy.

Upstream (not changed by this flow, listed for context): the root written in steps 2–3 is produced by
`packages/crypto/src/semaphore-identity.ts → createVoterGroup()`, and the id is the same value that
`packages/circuits/src/election-scope.ts → electionScope()` hashes off-chain to derive the proof scope.

Assumptions:
- The caller holds `ELECTION_ADMIN_ROLE`; the constructor grants it (and `DEFAULT_ADMIN_ROLE`) to the
  deployment admin, who can delegate via `grantRole`.
- `eligibilityCloseAt`/`votingCloseAt` are sane relative to each other — the registry does **not**
  check the ordering.
- `dkgPublicKey` is the affine `(x, y)` pair of the `@keystone/crypto` Pedersen DKG group key. The
  registry stores it opaquely and never validates it against a curve.

Side effects: storage writes for the struct plus the registration flag (create), one slot (root
update); two events. **No external calls anywhere**, so the registry cannot be re-entered and has no
dependency on the verifier actually being deployed and working.

Fragile:
- The update window closes permanently at `eligibilityCloseAt`. A mistyped timestamp freezes
  registration at creation and there is no recovery path — only a new election. Deliberate
  immutability, but it is the highest-consequence field in the struct.
- A proof built against a superseded root fails verification. After any root change, voters must
  re-prove, and the indexer must track the current root rather than a cached one.
- Nothing here verifies a proof or spends a nullifier. The Phase 3 ballot box must do all three of:
  Groth16 verify, scope-vs-election check, and seen-nullifier rejection.
- The verifier address is immutable, so a verifier upgrade means deploying a new registry and
  re-creating every election.

Not yet wired: the ballot box (`packages/contracts`, Phase 3), `services/indexer` consumption of
`ElectionCreated`/`MerkleRootUpdated`, `apps/admin-web` calls, and any deployment script — `script/`
is still empty.

## Ballot casting (BallotBox) · 2026-09-16

Entry: `packages/contracts/src/BallotBox.sol → castVote()`. Permissionless — a valid proof *is*
the authorisation.

Upstream, before this flow starts: `packages/circuits → generateVoteProof()` built the proof against
`electionScope(electionId)` (integer branch) with the voter's ballot commitment in the `message`
slot, and `packages/crypto` produced the ElGamal ciphertext and its Chaum-Pedersen proof.

1. `BallotBox → ElectionRegistry.getElection()` — reverts `ElectionNotFound` if the id is unknown.
2. `BallotBox → castVote()` — window check: `block.timestamp < votingCloseAt`, else `VotingClosed`.
3. Depth bounds from Semaphore's `Constants` (`MIN_DEPTH`/`MAX_DEPTH`) — the verifier indexes its
   verification key by depth, so an out-of-range depth is undefined behaviour, not a clean revert.
4. Commitment check — recomputes `keccak256(cpProof ++ ciphertext[0..3]) >> 8` and requires it to
   equal the proof's `message`, else `BallotCommitmentMismatch`. **This is the proof-swap defence.**
5. Scope check — requires `proof.scope == electionScope(electionId)`, else `ScopeMismatch`. Without
   it a second, differently-scoped proof would be a fresh nullifier, i.e. a double vote.
6. Root check — requires `proof.merkleTreeRoot == election.merkleRoot`, else `MerkleRootMismatch`.
7. Nullifier check — `NullifierAlreadyUsed` if this election has seen it.
8. `BallotBox → SemaphoreVerifier.verifyProof()` — Groth16, with `[root, nullifier, hash(message),
   hash(scope)]` as public signals and `hash` applied by this contract (verbatim from Semaphore's
   `Semaphore.sol`). Reverts `InvalidProof` on failure.
9. Marks the nullifier spent and emits `VoteCast(electionId, nullifier, commitment, ciphertext, cpProof)`.

Off-chain afterwards: `services/indexer` consumes `VoteCast` and is also what verifies the
Chaum-Pedersen proof — the contract binds it into the commitment but does not evaluate it.

Assumptions:
- **Election ids are integers.** The scope is derived from the numeric value of `bytes32`, matching
  `electionScope(BigInt(id))` off-chain. String ids produce a different scope and are rejected.
  Needs sign-off — see D-010 and the HANDOVER open item.
- The commitment formula is agreed on both sides and pinned by the fixture test.

Fragile:
- Two hash formulas (scope, commitment) each live in TypeScript and Solidity and are held together
  only by `test_ElectionScope_MatchesOffChainDerivation` and the fixture test. Domain separators are
  versioned so a bump is deliberate, but bumping invalidates every issued nullifier.
- Nothing stops a submitter pairing a *valid* proof with a ciphertext whose validity proof is
  garbage; the contract binds but does not verify it. The indexer must reject such ballots — and
  because the nullifier is already spent, that ballot is unrecoverable for that voter.
- A root change after ballots are cast would make past ballots unverifiable against the new root;
  the registry freezes the root at `eligibilityCloseAt`, which is what keeps this window safe.

Not yet wired: `services/indexer`, the tally service, `apps/voter-web`, and any deployment script.

<!-- ## <Flow name, e.g. "User login">
Entry: <file:function>

1. `auth/routes.ts → handleLogin()` — validates payload
2. `auth/service.ts → verifyCredentials()` — hits the user store
3. `session/issue.ts → issueToken()` — signs and sets cookie

Assumptions: <what must already be true for this path to work>
Side effects: <writes, emits, external calls>
Fragile: <where this has broken before>
-->