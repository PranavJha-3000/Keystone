import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  encrypt,
  runDkg,
  partialDecrypt,
  combinePartialDecryptions,
  verifyDleq,
  verifyPartials,
  randomScalar,
  scalarToPoint,
  pointAdd,
  babyStepGiantStep,
  CURVE,
  isIdentity,
} from "../src/index.js";
import type { ProjectivePoint } from "../src/curve.js";

describe("Pedersen DKG", () => {
  describe("runDkg", () => {
    it("generates valid group key with 3 trustees, threshold 2", () => {
      const result = runDkg(2, 3);
      expect(result.participants.length).toBe(3);
      expect(result.groupPublicKey).toBeDefined();
      expect(result.groupPublicKey.equals(CURVE.IDENTITY)).toBe(false);
    });

    it("each participant has a non-zero secret share", () => {
      const result = runDkg(2, 3);
      for (const p of result.participants) {
        expect(p.secretShare).toBeGreaterThan(0n);
        expect(p.secretShare).toBeLessThan(CURVE.n);
      }
    });

    it("public key share matches secret share", () => {
      const result = runDkg(2, 3);
      for (const p of result.participants) {
        const expected = scalarToPoint(p.secretShare);
        expect(p.publicKeyShare.equals(expected)).toBe(true);
      }
    });

    it("group key equals sum of first commitments", () => {
      const result = runDkg(3, 5);
      let expected = CURVE.IDENTITY;
      for (const p of result.participants) {
        expected = pointAdd(expected, p.commitments[0]);
      }
      expect(result.groupPublicKey.equals(expected)).toBe(true);
    });
  });

  describe("partialDecrypt", () => {
    it("produces partial decryption with valid DLEQ proof", () => {
      const dkg = runDkg(2, 3);
      const ct = encrypt(dkg.groupPublicKey, 5n);
      const trustee = dkg.participants[0];
      const partial = partialDecrypt(trustee.secretShare, trustee.publicKeyShare, ct, trustee.index);
      const valid = verifyDleq(
        CURVE.G,
        trustee.publicKeyShare,
        ct.c1,
        partial.partial,
        partial.proof
      );
      expect(valid).toBe(true);
    });

    it("produces invalid DLEQ proof for wrong share", () => {
      const dkg = runDkg(2, 3);
      const ct = encrypt(dkg.groupPublicKey, 5n);
      const trustee = dkg.participants[0];
      const wrongShare = randomScalar();
      const partial = partialDecrypt(wrongShare, trustee.publicKeyShare, ct, trustee.index);
      const valid = verifyDleq(
        CURVE.G,
        trustee.publicKeyShare,
        ct.c1,
        partial.partial,
        partial.proof
      );
      expect(valid).toBe(false);
    });
  });

  describe("combinePartialDecryptions with threshold", () => {
    it("recovers plaintext with threshold partials", () => {
      const dkg = runDkg(2, 3);
      const plaintext = 7n;
      const ct = encrypt(dkg.groupPublicKey, plaintext);

      const partials = dkg.participants.slice(0, 2).map(p =>
        partialDecrypt(p.secretShare, p.publicKeyShare, ct, p.index)
      );

      // D-004: verifyPartials() is the caller's mandatory pre-step before
      // combining — exercise it here so the contract stays tested.
      const shares = new Map<number, ProjectivePoint>(
        dkg.participants.slice(0, 2).map(p => [p.index, p.publicKeyShare] as [number, ProjectivePoint])
      );
      expect(verifyPartials(partials, shares, ct)).toBe(true);

      const mG = combinePartialDecryptions(partials, ct, 2);
      // mG = m * G, use BSGS to find m
      const recovered = isIdentity(mG) ? 0n : babyStepGiantStep(mG, 100);
      expect(recovered).toBe(plaintext);
    });

    it("throws with fewer than threshold partials", () => {
      const threshold = 3;
      const numTrustees = 5;
      const dkg = runDkg(threshold, numTrustees);
      const ct = encrypt(dkg.groupPublicKey, 4n);

      const partials = dkg.participants.map(p =>
        partialDecrypt(p.secretShare, p.publicKeyShare, ct, p.index)
      );

      const subset = partials.slice(0, threshold - 1);
      expect(() => combinePartialDecryptions(subset, ct, threshold)).toThrow();
    });
  });

  describe("property: DKG combine with qualifying subset", () => {
    it("recovers same plaintext with any qualifying subset", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 4 }),
          fc.integer({ min: 3, max: 6 }),
          fc.integer({ min: 0, max: 10 }),
          (threshold, numTrustees, plaintext) => {
            fc.pre(threshold <= numTrustees);
            const dkg = runDkg(threshold, numTrustees);
            const m = BigInt(plaintext);
            const ct = encrypt(dkg.groupPublicKey, m);

            const allPartials = dkg.participants.map(p =>
              partialDecrypt(p.secretShare, p.publicKeyShare, ct, p.index)
            );

            // Use first threshold participants
            const subset1 = allPartials.slice(0, threshold);
            // Use last threshold participants
            const subset2 = allPartials.slice(numTrustees - threshold, numTrustees);

            const mG1 = combinePartialDecryptions(subset1, ct, threshold);
            const mG2 = combinePartialDecryptions(subset2, ct, threshold);

            expect(mG1.equals(mG2)).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});