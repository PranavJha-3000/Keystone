# Keystone

End-to-end verifiable blockchain voting infrastructure.

---

## Architecture

<!-- PASTE ARCHITECTURE SUMMARY HERE -->

---

## Repository Map

```
keystone/
├── packages/
│   ├── config/          # Shared ESLint + Prettier configs
│   ├── crypto/          # Threshold ElGamal, Chaum-Pedersen proofs, DKG
│   ├── circuits/        # Semaphore ZK circuit bindings
│   ├── contracts/       # Solidity smart contracts (Foundry)
│   └── shared-types/    # TypeScript types shared across the monorepo
├── services/
│   ├── api/             # Fastify REST API (ballots, tallies, admin)
│   └── indexer/         # On-chain event indexer
├── apps/
│   ├── voter-web/       # Next.js 15 voter interface
│   ├── admin-web/       # Next.js 15 admin dashboard
│   └── verifier/        # Static Vite app — client-side verification
├── infra/
│   ├── docker/          # Docker Compose + Dockerfiles
│   └── ci/              # CI pipeline definitions
└── docs/
    ├── adr/             # Architecture Decision Records
    └── threat-model.md  # Threat model
```

## Getting Started

```bash
# Install dependencies
pnpm i

# Build all packages
pnpm build

# Run all dev servers
pnpm dev

# Lint everything
pnpm lint

# Type-check everything
pnpm typecheck
```

## Package Manager

This repo uses **pnpm** (v9+) with a Turborepo pipeline. Do not commit `package-lock.json` or `yarn.lock`.

## License

<!-- TBD -->

