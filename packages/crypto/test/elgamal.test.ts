import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  generateKeyPair,
  encrypt,
  decrypt,
  homomorphicAdd,
  babyStepGiantStep,
  scalarToPoint,
  CURVE,
} from "../src/index.js";

describe("ElGamal", () => {
  describe("generateKeyPair", () => {
    it("generates a valid key pair", () => {
      const kp = generateKeyPair();
      expect(kp.privateKey).toBeGreaterThan(0n);
      expect(kp.privateKey).toBeLessThan(CURVE.n);
      const expected = scalarToPoint(kp.privateKey);
      expect(kp.publicKey.equals(expected)).toBe(true);
    });
  });

  describe("encrypt/decrypt", () => {
    it("encrypts and decrypts 0", () => {
      const kp = generateKeyPair();
      const ct = encrypt(kp.publicKey, 0n);
      const m = decrypt(kp.privateKey, ct, 100);
      expect(m).toBe(0n);
    });

    it("encrypts and decrypts small values", () => {
      const kp = generateKeyPair();
      for (const plaintext of [1n, 2n, 5n, 10n, 42n, 100n]) {
        const ct = encrypt(kp.publicKey, plaintext);
        const m = decrypt(kp.privateKey, ct, 200);
        expect(m).toBe(plaintext);
      }
    });

    it("produces different ciphertexts for same plaintext", () => {
      const kp = generateKeyPair();
      const ct1 = encrypt(kp.publicKey, 5n);
      const ct2 = encrypt(kp.publicKey, 5n);
      expect(ct1.c1.equals(ct2.c1)).toBe(false);
    });

    it("throws for negative plaintext", () => {
      const kp = generateKeyPair();
      expect(() => encrypt(kp.publicKey, -1n)).toThrow();
    });
  });

  describe("homomorphicAdd", () => {
    it("adds two ciphertexts correctly", () => {
      const kp = generateKeyPair();
      const ct1 = encrypt(kp.publicKey, 3n);
      const ct2 = encrypt(kp.publicKey, 5n);
      const sum = homomorphicAdd([ct1, ct2]);
      const m = decrypt(kp.privateKey, sum, 100);
      expect(m).toBe(8n);
    });

    it("adds many ciphertexts correctly", () => {
      const kp = generateKeyPair();
      const plaintexts = [1n, 2n, 3n, 4n, 5n];
      const cts = plaintexts.map(p => encrypt(kp.publicKey, p));
      const sum = homomorphicAdd(cts);
      const m = decrypt(kp.privateKey, sum, 100);
      expect(m).toBe(15n);
    });
  });

  describe("babyStepGiantStep", () => {
    it("finds discrete log for small values", () => {
      for (let i = 0; i <= 100; i++) {
        const point = scalarToPoint(BigInt(i));
        const m = babyStepGiantStep(point, 100);
        expect(m).toBe(BigInt(i));
      }
    });

    it("throws for out-of-range values", () => {
      const point = scalarToPoint(200n);
      expect(() => babyStepGiantStep(point, 100)).toThrow();
    });
  });

  describe("property: homomorphism over random additions", () => {
    it("ElGamal homomorphism holds", () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 50 }),
          (plaintexts) => {
            const kp = generateKeyPair();
            const cts = plaintexts.map(p => encrypt(kp.publicKey, BigInt(p)));
            const sum = homomorphicAdd(cts);
            const expectedSum = BigInt(plaintexts.reduce((a, b) => a + b, 0));
            const maxRange = Math.max(100, Number(expectedSum) + 10);
            const m = decrypt(kp.privateKey, sum, maxRange);
            expect(m).toBe(expectedSum);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });
});