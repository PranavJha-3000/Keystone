# Architecture

## Modules
| Module | Responsibility | Talks to |
|---|---|---|
| @keystone/shared-types | Domain types, contract ABIs, API DTOs | (none — leaf dependency) |
| @keystone/crypto | Threshold ElGamal, Chaum-Pedersen proofs, DKG | shared-types |
| @keystone/circuits | Semaphore ZK circuit bindings | shared-types |
| @keystone/contracts | Solidity election registry + ballot box (Foundry); tally pending | Semaphore verifier + OpenZeppelin (via `lib/`); on-chain only |
| @keystone/config | Shared ESLint + Prettier configs | (build tooling only) |
| @keystone/api | Fastify REST API (ballots, tallies, admin) | crypto, shared-types |
| @keystone/indexer | On-chain event indexer | shared-types |
| @keystone/voter-web | Next.js 15 voter interface | shared-types |
| @keystone/admin-web | Next.js 15 admin dashboard | shared-types |
| @keystone/verifier | Static Vite app — client-side verification | shared-types |

## Data movement
- Admin → registry: `ElectionRegistry.createElection()` writes election config on-chain; the
  registration root may move only until `eligibilityCloseAt`, each change emitting `MerkleRootUpdated`
- Voter casts ballot → voter-web → api → contracts (on-chain)
- Contracts emit events → indexer → database → api → voter-web/admin-web
- Anyone can verify → verifier (static, reads chain directly + public params)

## Boundaries
- apps/ must not import from services/ directly — all communication via api HTTP
- verifier must not depend on any server or backend — purely static + on-chain data
- crypto/ must not depend on contracts/ or circuits/ — it is a pure math library
- shared-types/ must not depend on any other keystone package — it is the foundation layer
- circuits/ must not depend on crypto/ — the ballot commitment crosses that boundary as an opaque
  scalar. Importing crypto would tie the membership subsystem (baby-jubjub) to the encryption
  subsystem's curve (see D-003) for no gain, and would drag two proof systems into one graph
- contracts/ must not reimplement Groth16 — the audited Semaphore verifier is imported
  (`ISemaphoreVerifier`) and its address pinned at deployment. Keystone owns election configuration,
  never pairing arithmetic
- contracts/ has no build-time relationship to the other packages: election ids, Merkle roots and the
  DKG public key all cross as opaque values, so no Solidity import of `@keystone/*` is expected