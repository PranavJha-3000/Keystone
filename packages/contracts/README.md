# @keystone/contracts

Solidity for the Keystone voting system, built with Foundry. Layout follows the standard `forge init`
structure: `src/`, `test/`, `script/`.

## Status

| Contract | State |
|---|---|
| `ElectionRegistry.sol` | Implemented — election configuration, the registration root and its closing window, and the Semaphore verifier pin. 24 tests, 100% line/branch/statement/function coverage |
| `BallotBox.sol` | Implemented — `castVote` with Groth16 verification, scope binding, nullifier spending, and ballot-commitment rebinding. 15 tests, 100% coverage, against **real circuit-generated proofs** from `../circuits/scripts/generate-contract-fixtures.mjs` |
| Tally | **Not written.** `services/indexer` must consume `VoteCast` and verify Chaum-Pedersen proofs, which this contract binds but does not verify |
| Deployment scripts | Not written — `script/` is empty |

## Prerequisites

`forge` on PATH, plus three dependencies. **`lib/` is gitignored**, so dependencies are not committed
and must be installed after a fresh clone:

```
forge install foundry-rs/forge-std@v1.16.2 --no-git --shallow --root packages/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git --shallow --root packages/contracts
forge install semaphore-protocol/semaphore@v4.14.3 --no-git --shallow --root packages/contracts
```

Pass `--root`: run from inside the repo, forge would otherwise treat the *git root* as the project
root and install into `Keystone/lib/`. `remappings.txt` wires all three into import paths
(`@openzeppelin/contracts/`, `@semaphore-protocol/contracts/`, `forge-std/`).

## Commands

| Command | Purpose |
|---|---|
| `forge build` | Compile — solc pinned to 0.8.28 in `foundry.toml` |
| `forge test` | 24 tests covering `ElectionRegistry` |
| `forge coverage --no-match-coverage "(lib\|test)/"` | Coverage with dependencies excluded — 100% on `ElectionRegistry.sol` |
| `forge fmt` / `forge fmt --check` | Format / verify formatting |
| `forge build --sizes` | Contract sizes — 2,688 runtime / 46,065 init bytes |

## Design notes

- **No Groth16 in this repo.** The audited Semaphore verifier is imported from
  `@semaphore-protocol/contracts/base/SemaphoreVerifier.sol` and its address is recorded at
  deployment; `ElectionRegistry` exposes it through `semaphoreVerifier()`. Keystone never
  reimplements pairing checks. See `docs/ai/DECISIONS.md` D-009.
- **Elections are immutable except the registration root.** `updateMerkleRoot` is permitted only while
  `block.timestamp < eligibilityCloseAt`, so late-registering eligible voters can still be added, and
  once registration closes the root is frozen permanently.
- **No root change is silent.** Every update emits `MerkleRootUpdated(electionId, oldRoot, newRoot)`,
  so an auditor reading only events can reconstruct which electorate each proof was checked against.
- **Existence is tracked separately from `merkleRoot`,** because the root of an empty Semaphore group
  is zero and would otherwise be indistinguishable from "not registered".
- **Custom errors, not revert strings** — `ElectionAlreadyExists`, `ElectionNotFound`,
  `RegistrationClosed`, `Unauthorized`.

See `docs/ai/FLOW.md` for the full election-creation and registration-window flow, and
`docs/ai/TEST-CHECKLIST.md` for the verification commands and their expected output.
