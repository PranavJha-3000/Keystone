import { describe, it, expect } from "vitest";
import {
  generateVoterIdentity,
  generateVoterIdentityFromSecret,
  getMerkleRoot,
  generateMerkleProof,
} from "../src/index.js";

describe("Semaphore Identity", () => {
  describe("generateVoterIdentity", () => {
    it("generates a valid identity with commitment", () => {
      const voter = generateVoterIdentity();
      expect(voter.commitment).toBeGreaterThan(0n);
      expect(voter.secretScalar).toBeGreaterThan(0n);
      expect(voter.publicKey).toBeDefined();
      expect(voter.publicKey[0]).toBeGreaterThan(0n);
      expect(voter.publicKey[1]).toBeGreaterThan(0n);
    });

    it("generates unique identities each time", () => {
      const v1 = generateVoterIdentity();
      const v2 = generateVoterIdentity();
      expect(v1.commitment).not.toBe(v2.commitment);
      expect(v1.secretScalar).not.toBe(v2.secretScalar);
    });
  });

  describe("generateVoterIdentityFromSecret", () => {
    it("generates deterministic identity from same secret", () => {
      const v1 = generateVoterIdentityFromSecret("test-secret-123");
      const v2 = generateVoterIdentityFromSecret("test-secret-123");
      expect(v1.commitment).toBe(v2.commitment);
      expect(v1.secretScalar).toBe(v2.secretScalar);
    });

    it("generates different identities for different secrets", () => {
      const v1 = generateVoterIdentityFromSecret("secret-a");
      const v2 = generateVoterIdentityFromSecret("secret-b");
      expect(v1.commitment).not.toBe(v2.commitment);
    });
  });

  describe("Merkle tree operations", () => {
        it("creates group and returns root", () => {
      const voters = Array.from({ length: 5 }, () => generateVoterIdentity());
      const commitments = voters.map(v => v.commitment);
      const root = getMerkleRoot(commitments);
      expect(root).toBeGreaterThan(0n);
    });

    it("generates merkle proof", () => {
      const voters = Array.from({ length: 8 }, () => generateVoterIdentity());
      const commitments = voters.map(v => v.commitment);
      const proof = generateMerkleProof(commitments, 3);
      expect(proof.root).toBe(getMerkleRoot(commitments));
      expect(proof.siblings).toBeDefined();
      expect(proof.siblings.length).toBeGreaterThan(0);
    });

    it("root changes when commitments change", () => {
      const v1 = Array.from({ length: 5 }, () => generateVoterIdentity());
      const v2 = Array.from({ length: 6 }, () => generateVoterIdentity());
      const root1 = getMerkleRoot(v1.map(v => v.commitment));
      const root2 = getMerkleRoot(v2.map(v => v.commitment));
      expect(root1).not.toBe(root2);
    });
  });
});