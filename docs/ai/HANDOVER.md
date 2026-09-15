# Handover

## Current state
- Working: Monorepo scaffold (all 8 packages build) + `packages/crypto` vote-secrecy library implemented and fully tested — ElGamal (encrypt/decrypt, homomorphic add, BSGS discrete log), Chaum-Pedersen OR-proofs, Pedersen DKG (threshold combine), Semaphore v4 identity/Merkle wrappers. 34/34 tests pass; `pnpm build` 8/8
- In progress: Nothing — crypto library complete and threat-model reviewed (`docs/adr/0002-crypto-review.md`); awaiting sign-off on the curve deviation (D-003) and on fixing the 3 review defects
- Broken: None known. ADR-0002 lists 3 unfixed defects; none is reachable today because no point-deserialization path exists yet — see Open items
- Avoid: Don't add Tailwind `@tailwind` directives to CSS yet — PostCSS resolution breaks in the pnpm workspace (plain CSS only for now). Don't use ESM `export default` in Next.js config files (use `module.exports`). Don't use `fc.assume` — fast-check 3.x only ships `fc.pre`. Don't build circuits against secp256k1 — curves must be unified first.

## Open items
- [ ] **User sign-off needed (D-003):** secp256k1 used instead of instructed baby-jubjub — swap path isolated to `packages/crypto/src/curve.ts`
- [ ] Unify curves (baby-jubjub or SNARK-friendly equivalent) before any `packages/circuits` work; Semaphore side is already baby-jubjub
- [ ] Duplicated checklist files `docs/ai/TEST_CHECKLIST.md` + `docs/ai/TEST-CHECKLIST.md` both exist and drift — consolidate (owner decision needed)
- [ ] Re-enable Tailwind directives when implementing actual UI (fix PostCSS workspace resolution)
- [ ] Add `"type": "module"` to Next.js app package.json files to eliminate MODULE_TYPELESS_PACKAGE_JSON warnings
- [ ] Enforce `verifyPartials()` before `combinePartialDecryptions()` in the tally service (D-004) — document in FLOW.md when tally flow is written
- [ ] **ADR-0002 review findings — 3 defects found, NOT fixed (need go-ahead):** (1) `homomorphicAdd` never calls `assertValidPoint` on element 0 (asymmetric hole); (2) `combinePartialDecryptions` guard counts array length, not *distinct* trustees, so duplicate indices bypass it; (3) nothing enforces `verifyEncryptionProof` before aggregation — a bogus-but-on-curve ballot is accepted by `homomorphicAdd` and makes the whole aggregate undecryptable (demonstrated, not hypothetical). Details + evidence in `docs/adr/0002-crypto-review.md`
- [ ] **Decide coercion mitigation (ADR-0002 §1) before any non-pilot election:** recommend re-vote / last-vote-counts. Nothing in the package is receipt-free — a coerced voter can *prove* how they voted by revealing `r` (`encryptWithRandomness` is exported)
- [ ] Add election-scoped domain separation to Fiat-Shamir challenges and DLEQ proofs (ADR-0002 §4) once contracts define an election ID — currently two elections sharing a key would accept each other's ballots
- [ ] `shared-types` still has no domain types, so `semaphore-identity.ts` cannot re-export from it as the original spec asked (ADR-0002, deviation) — revisit when `Ballot`/`Vote` land
- [ ] `pnpm test` at repo root runs a placeholder in every package *except* crypto; wire real test scripts as packages gain code
- [x] **Lint is broken repo-wide (pre-existing):** FIXED — see D-006; preset now uses projectService typed-linting, `pnpm lint` exits 0 across all 10 packages
- [ ] Implement circuits, contracts, services, and apps

## Log

### 2026-09-14 · claude-opus-5
Did: Scaffolded complete pnpm + Turborepo monorepo — 8 workspace packages, root configs, all build successfully
Left: All packages are scaffolds awaiting implementation
Watch: Tailwind CSS directives break the Next.js build in pnpm workspace; process.env requires bracket notation with strict TS; turbo.json uses `tasks` not `pipeline` in v2.x
Next: Implement first feature per user request
Verified: `pnpm i` exits 0; `pnpm build` — 8 successful, 8 total; verifier dist uses relative paths (runs as static HTML)

### 2026-09-14 · claude-opus-5
Did: Implemented + tested `packages/crypto` vote-secrecy library. Fixed known bugs: removed placeholder DLEQ loop in `combinePartialDecryptions` (verified against identity point — threw on valid partials); fixed `runDkg` missing self-share `f_i(i)` (shares not on one polynomial → subset-dependent tally); removed broken Semaphore v4 re-exports (`ElGamalCiphertext`/`ElGamalKeyPair` never existed in shared-types; `Identity` has `secretScalar`/`publicKey`/`commitment`, not `nullifier`/`trapdoor`). Wrote `test/pedersen-dkg.test.ts` + `test/semaphore-identity.test.ts`. noble-curves 1.9.x fixes: `ProjectivePoint` type via `InstanceType<typeof secp256k1.ProjectivePoint>`, `multiply(0n)` and `toRawBytes()` on identity both throw → identity guards in `scalarToPoint`/`pointMul`/`pointToKey`/`hashPointsToScalar`; fixed BSGS giant-step scalar (was `s*(n-1)`, now `n - s mod n`). ElGamal homomorphism property bumped to 1000 runs per spec
Left: Nothing in packages/crypto. Curve unification (D-003) is the blocking decision for circuits
Watch: noble-curves 1.9 API breaks (no `ProjectivePoint` type export; 0-scalar and identity serialization throw); fast-check 3.x has `fc.pre` not `fc.assume`; `Group` constructor takes members array (no `addMembers` needed); PowerShell heredoc via `Set-Content` mangles files with BOMs/stray chars — prefer editor tool or `python -c "json.dumps"` for package.json; full crypto suite ~35s (1000-run property test ~32s of it)
Next: User decision on D-003, then start next feature (contracts or services per user request)
Verified: `pnpm i` exit 0; `pnpm build` — 8 successful, 8 total; `vitest run` in packages/crypto — 34 passed (34) across 4 files; no framework imports in packages/crypto (grep for next/react/viem/ethers/express/trpc/zod)

### 2026-09-14 · claude-opus-5
Did: Fixed repo-wide `pnpm lint` (was exit-2 everywhere; pre-existing, 3 stacked causes — D-006). Preset (`packages/config/eslint-preset.js`): projectService typed-linting, typed rules scoped to TS with `**/*.config.ts` exempt, `*.config.js` Node globals, ignores incl. generated `next-env.d.ts`. Next apps: dropped `eslint-config-next` (its @rushstack/eslint-patch cannot patch ESLint 9 jiti loading — verified across patch 1.16.1 and 1.10.3, CJS and ESM config syntax; also broke next build's lint step), wired `@next/eslint-plugin-next` + `eslint-plugin-react-hooks` flat configs directly (promoted from transitive to direct devDeps). Root eslint pinned `~9.17.0` (lockfile drifted to deprecated 9.39.5). Fixed real findings the working lint exposed: `as any[]` cast in semaphore-identity.ts (Group takes BigNumber = bigint|string — cast unneeded), unused imports in 4 crypto test files, added `verifyPartials()` assertion to DKG combine test (exercises D-004 contract)
Left: Nothing for this task. jsx-a11y / eslint-plugin-import / eslint-plugin-react rules not wired (came via eslint-config-next); add explicitly when the voter UI does real form work if wanted
Watch: `allowDefaultProject` globs must NOT contain `**` and conflict-error if a file is also in a package tsconfig; `require('@keystone/config/eslint-preset').default` — CJS require of the ESM preset yields a namespace, forgetting `.default` throws "baseConfig is not iterable"; app eslint.config.js files MUST stay CJS + plugin-direct (re-adding eslint-config-next reintroduces the crash); root `.eslintrc.js` is dead legacy config — flat config never loads it, delete on request
Next: User decision on D-003 (curve), then next feature
Verified: `pnpm lint` — 10 successful, 10 total (indexer has 1 pre-existing no-console warning, non-fatal); `pnpm build` — 8 successful, 8 total; crypto vitest — 34 passed (34); `pnpm i` exit 0

### 2026-09-15 · claude-opus-5
Did: Reviewed `packages/crypto` against the threat model; wrote `docs/adr/0002-crypto-review.md`. Confirmed by running code: `verifyEncryptionProof` rejects every garbage class tested (identity c1/c2, off-curve points, out-of-range ciphertexts, tampered responses, wrong `numCandidates`); threshold confidentiality holds (Shamir's perfect-secrecy theorem — information-theoretic, no computational assumption); replay protection is absent by design (nullifier's job, Phase 3). Found 3 defects but changed NO code — the algebra (ElGamal, DLEQ, CDM OR-proof, Lagrange, BSGS) re-derived line-by-line and is correct, so the "fix only if math bug" condition was not met. Defects: `homomorphicAdd` skips validation of element 0; `combinePartialDecryptions` counts array entries not distinct trustees; no enforced verify-before-aggregate step (demonstrated a one-ballot availability attack). Verified via a throwaway Vitest harness, since deleted — no permanent test added
Left: Nothing in code. 3 defects await authorization to fix (small, no API change). D-003 (curve) still the blocker for circuits
Watch: `packages/crypto` has **no point deserialization entry point** — every `ProjectivePoint` in play was built by noble's own arithmetic, which is the only reason the validation gaps are not yet reachable. Adding `pointFromBytes` for the wire format turns Defect 1 into a live bug: validate on deserialization from day one. noble 1.9.7 `assertValidity()` DOES reject identity for secp256k1 (`'bad point: ZERO'`) but `fromAffine` does NOT check the curve equation — the `try/catch` in `verifyEncryptionProof` is what makes that safe
Next: Get go-ahead to fix Defects 1+2, or start contracts (Phase 3) — the §3b verify-before-aggregate invariant must be designed into the contract, not bolted on
Verified: throwaway harness (deleted) — A0-A6 garbage-rejection table all as documented, B1/B2 validation asymmetry reproduced, C1-C3 availability attack reproduced, D1/D2 duplicate-index result reproduced; existing suite unchanged at 34 passed (34); no source/test file modified (mtimes unchanged)