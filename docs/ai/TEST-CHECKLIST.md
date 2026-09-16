# Test Checklist

Run before any change counts as done.

| # | Command | Expected |
|---|---|---|
| 1 | `pnpm build` | All 8 packages build successfully (8 successful, 8 total) |
| 2 | `pnpm typecheck` | Exits 0, no errors across all packages |
| 3 | `pnpm lint` | 10 successful, 10 total (indexer carries 1 pre-existing `no-console` warning — non-fatal) |
| 4 | `pnpm test` | All pass — crypto has 34 real tests; other packages still placeholders |

## Verified (2026-09-14 scaffold)
- `pnpm i` — exits 0, all workspace dependencies resolved
- `pnpm build` — 8 successful, 8 total (shared-types, crypto, circuits, config, api, indexer, voter-web, admin-web, verifier)
- Verifier dist uses relative paths (`./assets/*.js`) — runs by opening `dist/index.html` directly

## Task-specific
Crypto package (`packages/crypto`) — run from repo root with the PATH prefix `$env:PATH = 'C:\Users\prana\AppData\Roaming\npm;' + $env:PATH`:

| Command | Expected |
|---|---|
| `pnpm --filter @keystone/crypto test` | `Test Files 4 passed (4)`, `Tests 34 passed (34)` — takes ~35s (1000-run ElGamal homomorphism property is ~32s of it) |
| `pnpm build` | crypto compiles clean against noble-curves 1.9.x / Semaphore v4 |
| grep `from "(next\|react\|viem\|ethers\|express\|@trpc\|zod)` in packages/crypto | No results — framework-import constraint holds |

Verified 2026-09-14 · claude-opus-5: build 8/8 ✓; typecheck 10/10 ✓; crypto vitest 34/34 ✓; import grep clean ✓. `pnpm lint` ✗ — PRE-EXISTING repo-wide config bug (typed-lint rule crashes without parserOptions.project; affects untouched scaffold files too; see HANDOVER Open items). Recorded as NOT VERIFIED for lint.

## Crypto threat-model review (ADR-0002) — 2026-09-15 · claude-opus-5

Documentation-only task; no code changed. Verification used a **throwaway** harness
(`packages/crypto/test/__review-tmp.test.ts`), run then deleted — do not expect it to exist.
To reproduce, recreate a test that logs the same probes.

| Probe | Expected | Observed |
|---|---|---|
| honest ciphertext + honest proof | `true` | `true` ✓ |
| `c2 = identity` | `false` | `false` ✓ |
| `c1 = identity` | `false` | `false` ✓ |
| off-curve point (`fromAffine({x:1n,y:1n})`) | `false` | `false` ✓ |
| ciphertext encrypting 5 with `numCandidates=3` | `false` | `false` ✓ |
| tampered response `s` | `false` | `false` ✓ |
| wrong `numCandidates` | `false` | `false` ✓ |
| bogus ciphertext as `homomorphicAdd` element **1** | throws | `bad point: ZERO` ✓ |
| bogus ciphertext as `homomorphicAdd` element **0** | throws (want) | **no throw** ✗ Defect 1 |
| aggregate of 2 honest + 1 bogus-on-curve ballot | decrypts to sum | `Discrete log not found in range [0,100]` ✗ Defect 3 |
| `combinePartialDecryptions([p1,p1], threshold=2)` | rejects duplicates | `Discrete log not found in range [0,100]` ✗ Defect 2 |
| `combinePartialDecryptions([p1,p2], threshold=2)` | `7n` | `7n` ✓ |

Non-executable conclusions (arguments, not test results — see ADR-0002 §2 for sources):
coercion resistance is **absent** (voter can prove their vote by revealing `r`); threshold
confidentiality rests on Shamir's perfect-secrecy theorem, which a sampling test cannot establish.

Repo-wide checks after the task: `pnpm build` 8/8 ✓; `pnpm typecheck` 10/10 ✓; crypto vitest
34/34 ✓ (unchanged — no test added or removed); source/test file mtimes unchanged ✓.

## Semaphore v4 circuit wiring (`packages/circuits`) — 2026-09-16 · solar-pro4

Real proofs, real verification. No mocks: the tamper rows are the evidence that Groth16 verification
is actually running, because a stubbed verifier could not return `false` for one row and `true` for
the next.

| Command / case | Expected | Observed |
|---|---|---|
| `pnpm --filter @keystone/circuits test` | `Test Files 1 passed (1)`, `Tests 23 passed (23)` | 23 passed (23) ✓ (~2.5s; ~4s under turbo) |
| valid proof (voter 0, election A, commitment 1) | `true` | `true` ✓ |
| proof re-pointed at a **different ballot commitment** | `false` | `false` ✓ |
| message nudged by +1 | `false` | `false` ✓ |
| scope replaced with another election's scope | `false` | `false` ✓ |
| Merkle root nudged by +1 | `false` | `false` ✓ |
| packed proof truncated to 4 points | throws `/8 elements/` | throws ✓ |
| 2nd proof, same identity + same electionId (different ballot) | **same** nullifier | same ✓ |
| same identity + same ballot in a different electionId | **different** nullifier | different ✓ |
| identity not in the group | rejects `/not a member/` | rejects ✓ |
| `electionScope("")` | throws `/empty/` | throws ✓ |
| `electionScope(-1n)` / `(1n << 256n)` | throws `/negative/` · `/256 bits/` | both throw ✓ |
| `electionScope("123")` vs `electionScope(123n)` | different (type-tagged encoding) | different ✓ |
| scope width | `< 2^248` (BN254-safe) | ✓ |
| proof `merkleTreeDepth` vs `group.depth` | equal (8 members → 3) | 3 = 3 ✓ |

First run downloads the proving artifacts (~3.7 MB at depth 3) to
`%TEMP%\snark-artifacts\semaphore\4.13.0\` and reuses them afterwards; **no network is needed on
subsequent runs**. `SEMAPHORE_ARTIFACTS_VERSION` is pinned to `4.13.0`, verified to match what the
installed `@semaphore-protocol/proof@4.14.3` resolves by default.

Repo-wide checks after the task: `pnpm build` 8/8 ✓ · `pnpm typecheck` 10/10 ✓ · `pnpm lint`
10/10 ✓ (2 pre-existing `no-console` warnings: indexer **and verifier** — note the docs previously
mentioned only indexer) · `pnpm test` 13/13 tasks, circuits 23/23 ✓, crypto 34/34 ✓.

NOT VERIFIED (honest list):
- On-chain verification. `toVoteProofCalldata()` is asserted to produce the right *shape* (8 `bigint`
  points + 4 scalars, round-tripped against the proof), but nothing in `packages/contracts` exists yet
  to consume it, so the Solidity verifier path is untested by construction. Phase 3.
- Browser/Next.js proof generation. The suite runs under Node, where artifact resolution returns local
  file paths. The browser build of `@zk-kit/artifacts` returns URLs instead and snarkjs fetches them —
  that path was NOT exercised here.
- Cross-election unlinkability beyond the nullifier. Tested at the proof level (different nullifiers).
  Whether an observer can correlate the two ballots through other metadata (submission timing, the
  ciphertext itself, the ballot commitment) is a system-level question the indexer must address.
- Nullifier reuse rejection. Stateless here by design; the seen-nullifier set is Phase 3 contract work.

## ElectionRegistry (`packages/contracts`) — 2026-09-16 · solar-pro4

Prerequisite: `forge` on PATH (v1.8.3, installed at `%USERPROFILE%\.foundry\bin`) and the three
Foundry dependencies in `packages/contracts/lib` — that directory is gitignored, so **a fresh clone
must install them before any of this runs**:

```
forge install foundry-rs/forge-std@v1.16.2 --no-git --shallow --root <packages/contracts>
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git --shallow --root <packages/contracts>
forge install semaphore-protocol/semaphore@v4.14.3 --no-git --shallow --root <packages/contracts>
```

(`--root` matters: run from inside the repo, `forge` would otherwise pick the git root and install
into `Keystone/lib/`.)

| Command | Expected | Observed |
|---|---|---|
| `forge build` | compiler run successful, exit 0 | exit 0 ✓ (7 files, solc 0.8.28) |
| `forge test` | 24 passed, 0 failed, exit 0 | 24 passed ✓ (exit 0) |
| `forge fmt --check` | no diff, exit 0 | exit 0 ✓ |
| `forge coverage --no-match-coverage "(lib\|test)/"` | `src/ElectionRegistry.sol` 100% on all four columns | lines 31/31, statements 24/24, branches 5/5, funcs 6/6 — **all 100.00%** ✓ |

The four cases the brief asked for, and where they live:

| Required case | Test(s) | Result |
|---|---|---|
| happy path | `test_CreateElection_StoresConfiguration`, `..._EmitsElectionCreated` | ✓ |
| unauthorized caller reverts | `test_CreateElection_RevertsWhenCallerIsNotAdmin`, `test_UpdateMerkleRoot_RevertsWhenCallerIsNotAdmin` — both assert `Unauthorized(caller, role)` exactly | ✓ |
| root update **after** `eligibilityCloseAt` reverts | `..._RevertsAfterEligibilityClose`, plus `..._RevertsAtExactEligibilityClose` for the boundary second — assert `RegistrationClosed(id, closeAt)` | ✓ |
| root update **before** it succeeds and emits correctly | `..._SucceedsBeforeEligibilityClose` expects `MerkleRootUpdated(id, ROOT_1, ROOT_2)`; `..._EmitsImmediatelyPreviousRootOnEachChange` proves the event carries the *immediately previous* root, not the original | ✓ |

Beyond the brief: `ElectionAlreadyExists` on a duplicate id **and** proof that the rejected call
wrote nothing; `ElectionNotFound` on unknown ids for both `getElection` and `updateMerkleRoot`; a
zero Merkle root is storable yet still distinguishable from unregistered; a root update moves no
other field; grant/revoke of `ELECTION_ADMIN_ROLE` changes who may act; and two fuzz tests (256 runs
each) covering full field round-trip and the window boundary from both sides.

Repo-wide checks after the task: `pnpm build` 8/8 ✓ · `pnpm typecheck` 10/10 ✓ · `pnpm lint` 10/10 ✓ ·
`pnpm test` 13/13 ✓ (crypto 34/34, circuits 23/23). Contracts is *not* in that pipeline — see below.

NOT VERIFIED (honest list):
- **No on-chain proof verification.** The registry never calls `verifyProof`, and no test feeds a real
  Groth16 proof (from `packages/circuits`) into `SemaphoreVerifier.verifyProof`. That end-to-end test
  is the natural Phase 3 deliverable and is NOT written.
- **No deployment.** `script/` is still empty; nothing has been deployed to a testnet or verified.
- **`forge test` is not wired into `pnpm test`.** `packages/contracts` has no `package.json`, so the
  root `pnpm test` / Turborepo run does not execute these 24 tests. They are green only when invoked
  directly — CI could pass with contracts broken.
- **No ordering validation** between `eligibilityCloseAt` and `votingCloseAt`; the contract does not
  enforce it, so there is nothing to test. Requires a decision first.
- Gas and size figures are simulator-only (`optimizer_runs = 200`, `via_ir = false`): deployment size
  `2,688` runtime / `46,065` init bytes from `forge build --sizes`.

## BallotBox (`packages/contracts`) — 2026-09-16 · solar-pro4

Same prerequisites as the ElectionRegistry section above (`forge` + three installs).

| Command | Expected | Observed |
|---|---|---|
| `forge test --match-contract BallotBoxTest` | 15 passed, 0 failed, exit 0 | 15 passed ✓ (exit 0) |
| `forge test` | 39 passed across 2 suites | 39 passed ✓ (24 registry + 15 ballot box) |
| `forge fmt --check` | no diff, exit 0 | exit 0 ✓ |
| `forge coverage --no-match-coverage "(lib\|test)/"` | `src/BallotBox.sol` 100% on all four columns | lines 35/35, statements 35/35, branches 7/7, funcs 8/8 — **all 100.00%** ✓ |
| `forge build --sizes` | BallotBox size | see `forge build --sizes` (regenerate; not re-measured after fmt) |

**The fixture is not hand-written.** `packages/circuits/scripts/generate-contract-fixtures.mjs`
generates real proofs on Semaphore's audited circuit and writes `test/fixtures/vote-proofs.json`,
which the tests load. Regenerate with:

```
cd packages/circuits && pnpm build && node scripts/generate-contract-fixtures.mjs
```

Silent on success — the written file is the output. First run needs network for the depth-3
artifacts (~3.7 MB into the OS temp dir). Groth16 proofs are randomised, so regeneration changes
the `points` but not the public signals (root, nullifiers, scopes); every test still passes.

`foundry.toml` needed `fs_permissions = [{ access = "read", path = "./test/fixtures" }]` for
`vm.readFile` — Foundry denies every path not listed there.

Properties actually tested (each against a real circuit proof, not a mock):

| Property | Test |
|---|---|
| a real proof verifies on-chain through the real verifier | `test_CastVote_AcceptsRealCircuitProof` |
| **TypeScript and Solidity agree on the scope** | `test_ElectionScope_MatchesOffChainDerivation` |
| a valid proof re-pointed at another ciphertext fails | `test_CastVote_RevertsOnSwappedBallotCommitment` |
| a valid proof for another election is rejected | `test_CastVote_RevertsWhenProofIsForAnotherElection` |
| second vote in one election → same nullifier → rejected | `test_CastVote_RejectsSecondVoteInSameElection` |
| same ballot, different election → accepted, distinct nullifier | `test_CastVote_AcceptsSameBallotInDifferentElection` |
| verifier is actually consulted, not assumed | `test_CastVote_RevertsOnTamperedGroth16Proof` |
| window, root, depth, unknown-election errors | four `Reverts...` tests |
| `VoteCast` emission | `test_CastVote_EmitsVoteCast` |

NOT VERIFIED (honest list):
- **The Chaum-Pedersen proof is never verified anywhere.** The contract binds it into the
  commitment; the off-chain verifier that would check it does not exist yet. Until the indexer
  lands, a garbage validity proof paired with a valid membership proof is accepted on-chain and the
  nullifier is spent.
- **Real ElGamal ciphertexts.** The fixture's ciphertexts are opaque stand-in words, so the
  ciphertext layout `@keystone/crypto` will produce is unexercised end-to-end.
- **String election ids are incompatible with the contract.** The circuits vitest suite uses
  `"election-2026-general"`; those proofs would fail `ScopeMismatch` on-chain. This is a convention
  decision awaiting sign-off (D-010), not a bug in either side.
- No deployment; `script/` remains empty.
- Gas figures are simulator-only.