# ADR-0001: Two-Subsystem Cryptographic Architecture

## Status

Accepted

## Context

An end-to-end verifiable voting system must simultaneously guarantee:

1. **Eligibility** — only registered voters may cast a ballot
2. **Anonymity** — no one can link a voter to their ballot
3. **Secrecy** — no one can learn an in-progress tally
4. **Verifiability** — anyone can verify the final tally is correct

These requirements pull in opposite directions. Eligibility wants identity; anonymity wants the opposite. Secrecy wants encryption; verifiability wants transparency. Any design must navigate this tension explicitly.

## Decision

We split the cryptographic design into two subsystems with clean boundaries:

### Subsystem 1 — Semaphore (Eligibility + Anonymity)

[SZK's Semaphore](https://semaphore.pse.dev/) provides a proven, audited framework for anonymous signaling. Voters register their identity commitment in a Merkle tree (the "group"). To cast a ballot, they generate a Semaphore proof that they are a group member without revealing *which* member they are.

This subsystem handles:
- Voter registration (identity commitment insertion into the group)
- Eligibility proof (zero-knowledge membership proof)
- Anonymity set (all group members are indistinguishable)

### Subsystem 2 — Threshold ElGamal + Chaum-Pedersen (Secrecy + Verifiability)

Votes are encrypted under a threshold ElGamal public key shared among a committee of trustees. No single trustee can decrypt individual votes; only a threshold of trustees working together can decrypt the final tally.

Each vote comes with a [Chaum-Pedersen proof](https://link.springer.com/chapter/10.1007/3-540-46885-4_26) demonstrating that the ciphertext encrypts a valid option (e.g., 0 or 1 for a yes/no question) without revealing which option was chosen. These proofs are homomorphically aggregated during tallying, so the final tally proof verifies that the decrypted sum is consistent with the encrypted votes.

This subsystem handles:
- Vote encryption (threshold ElGamal)
- Vote validity proof (Chaum-Pedersen DDH proof)
- Homomorphic aggregation (multiplying ciphertexts)
- Threshold decryption (trustees cooperate to decrypt only the tally)

## Rationale: Why Not Custom SNARKs for Vote Validity?

The naive approach is to write a single SNARK circuit that proves "I know a valid vote and a valid Semaphore membership, and I encrypted the vote correctly." We rejected this for three reasons:

1. **Audit surface.** Custom SNARK circuits for vote validity are unaudited by definition — no existing audited circuit does exactly what we need. Any bug in a custom circuit silently breaks the entire election. Semaphore's circuits have been audited multiple times. Chaum-Pedersen proofs are simple, well-understood discrete-log arguments with decades of scrutiny. We prefer composing two audited primitives over writing one custom circuit.

2. **Complexity budget.** A custom circuit would need to constrain both the Semaphore membership path *and* the ElGamal encryption *and* the vote range constraint inside a single R1CS/PLONK gate system. That is a large circuit with many constraints. Bugs in circuit wiring are hard to detect and harder to fix. By splitting the problem, each subsystem can be reasoned about and tested independently.

3. **Trust assumptions.** If the vote-validity circuit has a soundness bug, an attacker can forge votes — the worst possible failure mode. Chaum-Pedersen proofs have information-theoretic soundness in the random oracle model under the DDH assumption. The security reduction is tight and well-understood. We deliberately choose a construction whose failure mode is well-characterized.

## Consequences

- **Positive:** Each subsystem uses audited, widely-used cryptographic primitives. The security argument reduces to standard assumptions (DDH, hash function as random oracle, Semaphore soundness).
- **Positive:** The two subsystems can be developed, tested, and verified independently.
- **Positive:** Chaum-Pedersen proofs are transparent (no trusted setup) and efficient to verify on-chain.
- **Negative:** The system has more moving parts than a single-circuit design — two proof systems to implement and verify instead of one.
- **Negative:** Threshold decryption requires trustee coordination, introducing operational complexity.
- **Neutral:** On-chain verification uses Semaphore verifier contracts (existing) plus a Chaum-Pedersen verifier (to be implemented — simpler than a full SNARK verifier).

## References

- Semaphore: https://semaphore.pedersen/
- Chaum-Pedersen: Chaum, D., Pedersen, T.P. (1992). "Wallet Databases with Observers." CRYPTO '92.
- Threshold ElGamal: Gennaro, R., et al. "Secure Distributed Key Generation for Discrete-Log Based Cryptosystems."
