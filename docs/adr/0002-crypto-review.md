# ADR-0002: Crypto Library Review Against the Threat Model

## Status

Accepted (review record). Three defects are listed under "Additional defects found" and are
**not fixed** — they need explicit authorization (see "Follow-ups").

## Scope and method

Reviewed `packages/crypto` against the four attack scenarios requested. Every claim below was
checked against the source at the cited line, and the behavioural claims were confirmed by
running a throwaway Vitest harness (`packages/crypto/test/__review-tmp.test.ts`, since deleted —
no permanent test or source change was made in this task).

Curve: secp256k1 (`src/curve.ts:28`), pending D-003. Nothing below depends on that choice.

---

## 1. Coercion resistance — OPEN RISK, accepted for pilots

**Question:** can a voter prove to a coercer how they voted?

**Yes.** The scheme has no receipt-freeness, and this is structural, not a bug:

- `encryptWithRandomness(publicKey, plaintext, r)` is exported (`src/elgamal.ts:95`, re-exported
  `src/index.ts:38`). A voter who keeps `r` can hand it to a coercer, who then recomputes
  `c1 == r*G` and `c2 == m*G + r*PK` and confirms `m` for any candidate index. That is a
  *proof of how they voted*, not merely an assertion.
- Even without `r`, the plaintext is low-entropy (a handful of candidates), and the real
  sub-proof is distinguishable in principle because simulated sub-challenges/responses are drawn
  from `[1, n-1]` via `randomScalar()` while the real challenge `c_m` can be `0`
  (`src/chaum-pedersen.ts:113-114,135`). Distinguishing advantage is ~1/n ≈ 2⁻²⁵⁶ — negligible,
  but it means the proof is not a zero-knowledge argument for *receipt-freeness* purposes.
- The verifier app (`apps/verifier`) makes coercion *cheaper*, not harder: it is designed to let
  anyone check a ballot given its openings.

**Status:** open risk, consciously accepted. This is normal for Helios-class systems.

**Mitigation options (decide before any high-stakes election — not before university/DAO pilots,
where coercion pressure is low):**

1. **Re-voting / last-vote-counts.** Allow unlimited re-submission keyed by a per-voter
   nullifier; the coercer cannot tell whether the last ciphertext is the one they extracted a
   receipt for. Cheapest to implement — needs *no* crypto change, only the registry nullifier and
   a "last vote wins" rule in Phase 3. This is the standard Helios answer.
2. **Designated-verifier re-encryption.** The voter re-encrypts under the verifier's key before
   casting, so the coercion receipt no longer matches the on-chain ciphertext. Strongest, but
   adds a trusted verifier plus a re-encryption proof (a DLEQ-style argument this package does
   not yet have).
3. **Do nothing, and say so in the election notice.** Acceptable only where the threat model
   already puts coercion out of scope.

Option 1 is recommended. Do not build 2 until there is a concrete requirement.

## 2. Trustee collusion below threshold — CONFIRMED SAFE

**Verdict: confidentiality holds.** With fewer than `threshold` distinct shares the secret key
cannot be recovered. Two independent reasons:

1. **Shamir's theorem (perfect secrecy).** `generatePolynomial` (`src/pedersen-dkg.ts:88`) makes a
   degree-`(threshold-1)` polynomial `f_i(x) = Σ_j a_{i,j} x^j` with `a_{i,0}` the secret. Shamir
   (1979, *How to share a secret*, CACM 22(11):612-613) proves the `(k, n)` threshold scheme is
   *perfect*: given any `k-1` shares, every candidate secret is equally likely, so the posterior
   distribution of `f_i(0)` equals the prior. The bound is information-theoretic and independent
   of the adversary's computing power — no hardness assumption is needed at all. Pedersen (1991,
   *A threshold cryptosystem without a trusted party*) extends this to the no-dealer setting used
   here.
2. **The function cannot be the leak.** `combinePartialDecryptions` (`src/pedersen-dkg.ts:414`)
   is a pure function of the partials *handed to it*. Collusion happens outside it: colluders
   would run their own Lagrange interpolation over their own `< k` shares, which by (1) yields a
   uniformly random value rather than `s = f(0)`. Deleting the length guard entirely would still
   not let two of three trustees recover a `(2,3)` key. The guard exists for *correctness*, not
   for confidentiality.

What the commitments do and do not give: `verifyShare` (`src/pedersen-dkg.ts:148`) and
`verifyPartials` (`:449`) catch *active* misbehaviour (a dealer handing out an inconsistent share,
a trustee returning a wrong partial). They are not what provides confidentiality, and this
section's conclusion holds without them.

**Caveat — the code is correct only for distinct indices** (Defect 2 below). This does not weaken
statement (1); it affects whether errors surface cleanly.

---

## 3. Malicious ciphertext — primitive CONFIRMED, ordering UNENFORCED

**Question asked:** does `verifyEncryptionProof` reject garbage, and is that check done *before*
homomorphic addition anywhere it is used?

### 3a. Does `verifyEncryptionProof` reject garbage? — YES, confirmed empirically

`verifyEncryptionProof` (`src/chaum-pedersen.ts:152`) wraps every point assertion in `try/catch`
and returns `false` (`:207-209`). Measured results:

| Garbage class | Result | Why |
|---|---|---|
| honest ciphertext + honest proof | `true` | control |
| `c2 = identity` | `false` | `assertValidPoint` → noble `'bad point: ZERO'` |
| `c1 = identity` | `false` | same |
| off-curve point (`x=1,y=1`) | `false` | `'bad point: equation left != right'` |
| ciphertext encrypting out-of-range value (5, `numCandidates=3`) | `false` | DLEQ relation unsatisfiable for every `i` |
| tampered response `s` | `false` | commitment equation fails |
| wrong `numCandidates` | `false` | array-length check `:166` + challenge mismatch |

Relevant detail: noble 1.9.7's `assertValidity()` **does** reject the identity point for
secp256k1 (`allowInfinityPoint` unset → `throw 'bad point: ZERO'`), so our `assertValidPoint`
(`src/curve.ts:135`) rejects it. The converse trap matters: noble's `ProjectivePoint.fromAffine`
does *not* check the curve equation, so off-curve points are constructible and only
`assertValidity()` catches them — which is exactly why the `try/catch` is load-bearing.

### 3b. Is verification done before aggregation? — NO. This is an OPEN RISK.

`homomorphicAdd` (`src/elgamal.ts:168`) takes `ElGamalCiphertext[]` only. **It has no access to
proofs and cannot verify them.** No caller exists in the repo yet (services are scaffolds), so the
ordering invariant is stated nowhere in code and enforced nowhere.

Demonstrated consequence — a bogus ciphertext built from **perfectly valid curve points**
(`c1 = r*G`, `c2` = an unrelated valid point) passes point validation and poisons the tally:

```
C1 control decrypt (2 honest ballots)        -> 2n          (correct)
C2 homomorphicAdd ACCEPTED bogus ciphertext  -> no error, no proof check
C3 decrypt(polluted aggregate)               -> THREW "Discrete log not found in range [0,100]"
```

This is an availability attack, not a nuisance: one malformed ballot makes the *entire aggregate*
undecryptable, and the failure surfaces at tally time as an opaque BSGS error with no attribution
to the offending ballot. Point-validation cannot catch it — only the Chaum-Pedersen proof can,
because the ciphertext *is* a well-formed point. The `c2 = identity` variant also throws, which is
safer but still a DoS.

**Required invariant (must be enforced in the tally service, Phase 3):**

> For every ciphertext `c` included in the aggregate, `verifyEncryptionProof(c, proof, PK,
> numCandidates)` must return `true` *before* `c` is passed to `homomorphicAdd`. Ballots that fail
> verification must be rejected individually (recorded, attributed, excluded) — never allowed to
> reach the aggregation step.

On-chain this must be a `require` in the contract, not merely a service-layer check, since the
service is not in the voter's trust boundary.

---

## 4. Replay — OUT OF SCOPE BY DESIGN

**Confirmed: nothing in `packages/crypto` prevents replay.** Nor should it. Inspecting the
package: there is no nonce, no nullifier, no timestamp, no sequence number, and no per-election
scope in any signature or proof. The same `(ciphertext, proof)` pair is valid forever and can be
submitted any number of times; a second submission simply adds the vote again.

Domain separation note: the Fiat-Shamir challenges hash `G, PK, c1, c2, {a_i, b_i}`
(`src/chaum-pedersen.ts:217-235`, `src/pedersen-dkg.ts:343-350`) but **not** an election ID or
chain ID. Two elections sharing a key would accept each other's ballots. Election-scoped challenge
prefixes should be added when the contracts define an election ID.

**Where replay protection belongs:** the Semaphore nullifier. A voter proves membership *and*
reveals a nullifier `H(secretScalar, electionId)`; the contract stores seen nullifiers and rejects
duplicates, giving one-vote-per-voter. That is Phase 3 (contracts) work, and it is also the
mechanism that makes "re-voting / last vote counts" (see §1) expressible.

**Consequence to carry into the contracts design:** replay protection and coercion mitigation
interact. A naive nullifier (reject any repeat) forbids re-voting; the mitigation in §1 requires
permitting re-votes while still capping the *counted* ballot at one. These must be decided
together, not sequentially.

**Note:** the DLEQ proofs in `partialDecrypt` (`src/pedersen-dkg.ts:304`) have the same property —
they are bound to `(c1, partial)` but carry no election or round identifier, so a partial from one
tally round is replayable in another if the ciphertexts coincide. Low practical risk (ciphertexts
differ per round in practice), but worth the same domain-separation treatment.

---

## Additional defects found (NOT fixed — awaiting authorization)

The prompt restricted this task to documentation unless a *math* bug was found. The algebra
(ElGamal, DLEQ, CDM OR-proof, Lagrange interpolation, BSGS) was re-derived line by line and is
**correct**. The three issues below are input-validation and ordering defects, not algebra errors,
so no code was changed. They are ranked by severity.

### Defect 1 — `homomorphicAdd` skips validation of element 0

`src/elgamal.ts:173-181`: the loop starts at `i = 1`, and `assertValidPoint` is never called on
`ciphertexts[0]`. The result is an asymmetric hole — the same object throws or doesn't depending on
its array position:

```
B1 bogus c2 as index 1 -> THREW: bad point: ZERO
B2 bogus c2 as index 0 -> no throw          <-- defect
```

*Severity: low today.* Noble's own arithmetic only produces valid points, so reaching this requires
a caller who already holds an invalid `ProjectivePoint`. But it is a latent trap the moment a
deserialization path is added (and §3b implies one is coming), and it makes the function's contract
incoherent. Fix: validate all elements in one loop, plus a regression test.

### Defect 2 — `combinePartialDecryptions` threshold guard counts array entries, not distinct trustees

`src/pedersen-dkg.ts:419` guards on `partials.length < threshold`, but Lagrange interpolation
requires **distinct** interpolation points. Duplicated indices are not rejected:
`lagrangeCoefficient(1, [1,1])` skips both `j === i` iterations and returns `1`, so the function
returns `2·d₁` instead of `d₁`.

Measured:

```
D1 [p1, p1] with threshold=2 -> THREW "Discrete log not found in range [0,100]"  (expected 7)
D2 two distinct trustees     -> 7n                                               (correct)
```

*Severity: medium.* It does **not** break confidentiality (§2 — duplicating a share yields no new
information). The failure is loud rather than silently wrong: interpolation yields
`(m + r·(s − 2x₁))·G`, a coefficient that lands in `[0, maxRange]` only with probability
~maxRange/n, so BSGS throws. But the error is misleading (it blames the range, not the duplicate
inputs), and callers are told the guard means "≥ threshold partials" when it does not.
`verifyPartials` (`:449`) also lets duplicates through, since it verifies the same trustee twice.
Fix: dedupe by `trusteeIndex` and require `distinct >= threshold`, plus a regression test.

### Defect 3 — no enforced "verify proofs before aggregating" step

Covered in §3b. Not a defect in an isolated function — rather the absence of the plumbing that makes
the invariant true. Deliberately deferred to the tally service/contract, because `homomorphicAdd`
should stay a pure point-arithmetic function (D-004). Listed so it is not lost.

### Non-blocking hardening notes

- `proveEncryptionOfIndex` simulates sub-proofs with `c_i, s_i ∈ [1, n-1]` (`randomScalar()` never
  returns 0), whereas the real `c_m` may be 0. Textbook CDM draws from `[0, n-1]`. Distinguishing
  advantage ~2⁻²⁵⁶ — not exploitable, but worth a comment or a `randomScalarIncludingZero` helper.
- `proveEncryptionOfIndex` does not check that `(plaintext, randomness)` are consistent with the
  ciphertext. A caller passing mismatched values gets a proof that fails verification rather than an
  error — acceptable, but a footgun.
- `encrypt` rejects negative plaintexts (`:75`) but not `plaintext >= n`; a plaintext ≥ n would wrap
  modulo n and decrypt to a wrong value. Unreachable for candidate indices, but the guard is
  asymmetric.

### Deviation from the original crypto-package spec

The original request asked `semaphore-identity.ts` to "re-export types from `shared-types`". This is
currently **not** done: `packages/shared-types/src/index.ts` still contains only
`SHARED_TYPES_VERSION` and no domain types, so there is nothing meaningful to re-export. Deferred
until `shared-types` gains `Ballot`/`Vote`/etc. Tracked here rather than silently dropped.

---

## What was verified, and what was not

**Verified by running code** (throwaway harness, since deleted — no permanent test was added):

- All seven rows of the §3a table: honest proof verifies `true`; identity `c1`/`c2`, off-curve
  points, out-of-range ciphertexts, tampered responses, and wrong `numCandidates` all `false`.
- The B1/B2 asymmetry in Defect 1.
- The C1-C3 availability attack: a bogus-but-on-curve ciphertext is accepted by `homomorphicAdd`
  and makes the aggregate undecryptable.
- The D1/D2 duplicate-index behaviour in Defect 2.
- Existing suite still green: 34 tests across 4 files (unchanged by this task).

**Not verified:**

- The coercion threat in §1 is a design-property argument, not a test result. No test in this
  package can make it false.
- The §2 confidentiality argument rests on the literature (Shamir 1979, Pedersen 1991), not on
  execution. A property test can only sample `k-1` subsets; it cannot prove perfect secrecy.
- `verifyPartials` / `combinePartialDecryptions` are not exercised end-to-end against a real
  multi-trustee ceremony, because no service orchestrates one yet.
- On-chain parity (matching an on-chain Lagrange / proof verifier) is untested — no contracts yet.
- Nobody has audited this package. This review is a self-review by the implementing model. It is not
  a substitute for an external audit, and §1 and §3b are exactly what an auditor should be pointed
  at first.

## Follow-ups (proposed, in dependency order)

1. **Fix Defect 1** (one line + regression test) and **Defect 2** (dedupe + regression test). Small,
   low-risk, no API change. *Needs your go-ahead — out of scope for this documentation task.*
2. Record the §3b invariant as a hard requirement in the Phase 3 contracts design, and add
   election-scoped domain separation to the Fiat-Shamir challenges (§4) at the same time.
3. Decide §1 (recommended: re-vote / last-vote-counts) before any non-pilot election, jointly with
   the nullifier design in §4.
4. Revisit D-003 (curve choice) before any circuit work, per ADR-0001.
5. External audit before any real election. Point the auditor at §1, §3b, and Defect 2.
