/**
 * @keystone/crypto — Cryptographic primitives for the Keystone voting system.
 *
 * This package implements:
 * - Exponential ElGamal encryption for vote secrecy
 * - Chaum-Pedersen zero-knowledge proofs for vote validity
 * - Pedersen distributed key generation for trustee committees
 * - Semaphore identity management for voter eligibility/anonymity
 *
 * All operations are pure functions with no I/O or networking dependencies.
 * This package must NOT depend on Next.js, viem, or any web framework.
 */

// Curve abstraction
export {
  CURVE,
  pointAdd,
  pointSub,
  pointMul,
  pointNeg,
  scalarToPoint,
  randomScalar,
  bytesToReducedScalar,
  pointToBytes,
  isIdentity,
  assertValidPoint,
} from "./curve.js";
export type { ProjectivePoint } from "./curve.js";

// Hash utilities
export { hashBytesToScalar, hashPointsToScalar } from "./hash.js";

// ElGamal encryption
export {
  generateKeyPair,
  keyPairFromPrivate,
  encrypt,
  encryptWithRandomness,
  decrypt,
  homomorphicAdd,
  babyStepGiantStep,
} from "./elgamal.js";

// Chaum-Pedersen proofs
export {
  proveEncryptionOfIndex,
  verifyEncryptionProof,
} from "./chaum-pedersen.js";

// Pedersen DKG
export {
  generatePolynomial,
  computeCommitments,
  generateParticipant,
  computeShare,
  verifyShare,
  runDkg,
  lagrangeCoefficient,
  partialDecrypt,
  verifyDleq,
  combinePartialDecryptions,
  verifyPartials,
} from "./pedersen-dkg.js";

// Semaphore identity
export {
  generateVoterIdentity,
  generateVoterIdentityFromSecret,
  createVoterGroup,
  getMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  Identity,
  Group,
} from "./semaphore-identity.js";
export type { VoterIdentity } from "./semaphore-identity.js";

// Types
export type {
  ElGamalCiphertext,
  ElGamalKeyPair,
  ChaumPedersenProof,
  DleqProof,
  PartialDecryption,
  DkgParticipant,
  DkgResult,
} from "./types.js";