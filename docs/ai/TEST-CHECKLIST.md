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