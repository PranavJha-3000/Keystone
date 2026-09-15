import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  generateKeyPair,
  encryptWithRandomness,
  randomScalar,
} from "../src/index.js";
import { proveEncryptionOfIndex, verifyEncryptionProof } from "../src/chaum-pedersen.js";

describe("Chaum-Pedersen", () => {
  describe("proveEncryptionOfIndex / verifyEncryptionProof", () => {
    it("produces valid proof for binary case (numCandidates=2)", () => {
      const kp = generateKeyPair();
      const r = randomScalar();
      const ct = encryptWithRandomness(kp.publicKey, 1n, r);
      const proof = proveEncryptionOfIndex(ct, 1n, kp.publicKey, r, 2);
      expect(verifyEncryptionProof(ct, proof, kp.publicKey, 2)).toBe(true);
    });

    it("produces valid proof for m=0", () => {
      const kp = generateKeyPair();
      const r = randomScalar();
      const ct = encryptWithRandomness(kp.publicKey, 0n, r);
      const proof = proveEncryptionOfIndex(ct, 0n, kp.publicKey, r, 3);
      expect(verifyEncryptionProof(ct, proof, kp.publicKey, 3)).toBe(true);
    });

    it("produces valid proof for last candidate", () => {
      const kp = generateKeyPair();
      const r = randomScalar();
      const ct = encryptWithRandomness(kp.publicKey, 4n, r);
      const proof = proveEncryptionOfIndex(ct, 4n, kp.publicKey, r, 5);
      expect(verifyEncryptionProof(ct, proof, kp.publicKey, 5)).toBe(true);
    });

    it("produces valid proof for many candidates (10)", () => {
      const kp = generateKeyPair();
      const r = randomScalar();
      const ct = encryptWithRandomness(kp.publicKey, 7n, r);
      const proof = proveEncryptionOfIndex(ct, 7n, kp.publicKey, r, 10);
      expect(verifyEncryptionProof(ct, proof, kp.publicKey, 10)).toBe(true);
    });

    it("throws for out-of-range plaintext", () => {
      const kp = generateKeyPair();
      const r = randomScalar();
      const ct = encryptWithRandomness(kp.publicKey, 5n, r);
      expect(() => proveEncryptionOfIndex(ct, 5n, kp.publicKey, r, 3)).toThrow();
    });

    it("fails verification with wrong public key", () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const r = randomScalar();
      const ct = encryptWithRandomness(kp1.publicKey, 2n, r);
      const proof = proveEncryptionOfIndex(ct, 2n, kp1.publicKey, r, 5);
      expect(verifyEncryptionProof(ct, proof, kp2.publicKey, 5)).toBe(false);
    });
  });

  describe("property: proofs verify for valid votes and fail for invalid", () => {
    it("proofs verify for valid candidate indices", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),
          fc.integer({ min: 0, max: 9 }),
          (numCandidates, plaintext) => {
            const m = BigInt(plaintext % numCandidates);
            const kp = generateKeyPair();
            const r = randomScalar();
            const ct = encryptWithRandomness(kp.publicKey, m, r);
            const proof = proveEncryptionOfIndex(ct, m, kp.publicKey, r, numCandidates);
            expect(verifyEncryptionProof(ct, proof, kp.publicKey, numCandidates)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("proofs fail for ciphertext encrypting out-of-range value", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 8 }),
          fc.integer({ min: 0, max: 7 }),
          (numCandidates, plaintext) => {
            // Encrypt a valid value
            const validM = BigInt(plaintext % numCandidates);
            const kp = generateKeyPair();
            const r = randomScalar();
            const ct = encryptWithRandomness(kp.publicKey, validM, r);

            // Create a proof for a DIFFERENT value (also in range)
            const otherM = (validM + 1n) % BigInt(numCandidates);
            const wrongProof = proveEncryptionOfIndex(ct, otherM, kp.publicKey, r, numCandidates);

            // This proof should NOT verify for the ciphertext
            // (because the proof is for otherM but the ciphertext encrypts validM)
            expect(verifyEncryptionProof(ct, wrongProof, kp.publicKey, numCandidates)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});