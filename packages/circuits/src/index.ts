/**
 * @keystone/circuits — ZK circuit definitions for the Keystone voting system.
 *
 * Wraps Semaphore circuits for eligibility/anonymity. Vote validity is proven
 * via Chaum-Pedersen proofs implemented in @keystone/crypto — NOT custom SNARKs.
 * See docs/adr/0001-crypto-architecture.md for the rationale.
 *
 * No implementation yet — this is a scaffold.
 */

export const CIRCUITS_VERSION = '0.1.0';
