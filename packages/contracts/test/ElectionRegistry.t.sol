// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ElectionRegistry} from "../src/ElectionRegistry.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";

// Keystone's election registry: configuration storage, the single mutable field (the
// registration root) and its closing window, and the role gate on both.
//
// The Semaphore verifier is deployed for real rather than faked. The registry only stores and
// returns its address, so a dummy address would exercise the same lines — but deploying the
// imported implementation also proves that the pinned `semaphore-protocol/contracts` release
// compiles, deploys, and satisfies the interface the registry expects. That is the whole point
// of referencing it instead of reimplementing Groth16.
contract ElectionRegistryTest is Test {
    SemaphoreVerifier internal semaphoreVerifier;
    ElectionRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal stranger = makeAddr("stranger");
    address internal operator = makeAddr("operator");

    bytes32 internal constant ELECTION_A = keccak256("keystone-election-A");
    bytes32 internal constant ELECTION_B = keccak256("keystone-election-B");
    bytes32 internal constant UNKNOWN_ELECTION = keccak256("keystone-election-never-created");

    bytes32 internal constant ROOT_1 = keccak256("voter-registry-root-1");
    bytes32 internal constant ROOT_2 = keccak256("voter-registry-root-2");

    uint256 internal constant NUM_CANDIDATES = 3;

    // Timestamps are chosen well clear of both the default forge timestamp and each other, so
    // the "before / at / after close" tests cannot drift into each other.
    uint64 internal constant NOW = 1_900_000_000;
    uint64 internal constant ELIGIBILITY_CLOSE = 2_000_000_000;
    uint64 internal constant VOTING_CLOSE = 2_000_086_400;

    function setUp() public {
        vm.warp(NOW);
        semaphoreVerifier = new SemaphoreVerifier();
        registry = new ElectionRegistry(address(semaphoreVerifier), admin);
    }

    // Two distinct keys, so tests can show the stored key is the one that was passed in and
    // that a root update leaves it alone.
    function _keyA() internal pure returns (uint256[2] memory) {
        return [uint256(0xA11CE), uint256(0xB0B)];
    }

    function _keyB() internal pure returns (uint256[2] memory) {
        return [uint256(0xC0FFEE), uint256(0xF00D)];
    }

    // Registers ELECTION_A as the admin, at the fixture values. Used by the root-update tests
    // so each one starts from an existing election.
    function _createElectionA() internal {
        vm.prank(admin);
        registry.createElection(ELECTION_A, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());
    }

    // --- constructor ----------------------------------------------------------------

    function test_Constructor_GrantsBothRolesToAdmin() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ELECTION_ADMIN_ROLE(), admin));
    }

    function test_Constructor_GrantsNoRolesToOtherAddresses() public view {
        assertFalse(registry.hasRole(registry.ELECTION_ADMIN_ROLE(), stranger));
        assertFalse(registry.hasRole(registry.ELECTION_ADMIN_ROLE(), operator));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), stranger));
    }

    function test_Constructor_PinsSemaphoreVerifier() public view {
        assertEq(address(registry.semaphoreVerifier()), address(semaphoreVerifier));
    }

    function test_Constructor_PinnedVerifierIsRealContract() public view {
        // A non-zero code size means an implementation really is deployed at the pinned
        // address. If the Semaphore import ever pointed at nothing, this fails.
        assertGt(address(registry.semaphoreVerifier()).code.length, 0);
    }

    // --- createElection: happy path -------------------------------------------------

    function test_CreateElection_StoresConfiguration() public {
        vm.prank(admin);
        registry.createElection(ELECTION_A, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());

        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_1);
        assertEq(election.numCandidates, NUM_CANDIDATES);
        assertEq(election.eligibilityCloseAt, ELIGIBILITY_CLOSE);
        assertEq(election.votingCloseAt, VOTING_CLOSE);
        assertEq(election.dkgPublicKey[0], _keyA()[0]);
        assertEq(election.dkgPublicKey[1], _keyA()[1]);
    }

    function test_CreateElection_EmitsElectionCreated() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit ElectionRegistry.ElectionCreated(
            ELECTION_A, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA()
        );

        vm.prank(admin);
        registry.createElection(ELECTION_A, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());
    }

    function test_CreateElection_AllowsDistinctElectionIds() public {
        _createElectionA();

        vm.prank(admin);
        registry.createElection(ELECTION_B, ROOT_2, NUM_CANDIDATES + 1, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyB());

        ElectionRegistry.Election memory a = registry.getElection(ELECTION_A);
        ElectionRegistry.Election memory b = registry.getElection(ELECTION_B);

        assertEq(a.merkleRoot, ROOT_1);
        assertEq(b.merkleRoot, ROOT_2);
        // Distinct configurations stay distinct — no cross-talk between ids.
        assertEq(b.numCandidates, NUM_CANDIDATES + 1);
        assertEq(b.dkgPublicKey[0], _keyB()[0]);
        assertTrue(a.dkgPublicKey[0] != b.dkgPublicKey[0]);
    }

    function test_CreateElection_AcceptsZeroMerkleRoot() public {
        // An empty Semaphore group has a root of zero, so zero must be a storable value rather
        // than a sentinel for "absent". This is why existence is a separate flag.
        vm.prank(admin);
        registry.createElection(ELECTION_A, bytes32(0), NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());

        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, bytes32(0));

        // A different id with the same (zero) root is still reported as absent, which would be
        // impossible if absence were inferred from the root.
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.ElectionNotFound.selector, ELECTION_B));
        registry.getElection(ELECTION_B);
    }

    // --- createElection: revert paths ------------------------------------------------

    function test_CreateElection_RevertsWhenCallerIsNotAdmin() public {
        // The role getter is an external call and `vm.prank` is spent on the next call whatever
        // it is, so every external read must be hoisted above the prank — otherwise the getter
        // swallows the prank and the revert names the default sender instead of `stranger`.
        bytes32 requiredRole = registry.ELECTION_ADMIN_ROLE();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.Unauthorized.selector, stranger, requiredRole));
        registry.createElection(ELECTION_A, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());
    }

    function test_CreateElection_RevertsWhenIdAlreadyExists() public {
        _createElectionA();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.ElectionAlreadyExists.selector, ELECTION_A));
        registry.createElection(ELECTION_A, ROOT_2, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyB());
    }

    function test_CreateElection_OriginalConfigurationSurvivesDuplicateAttempt() public {
        // The rejected second call must not have partially written. ROOT_2 and _keyB() are
        // what the failed attempt carried; neither may appear.
        _createElectionA();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.ElectionAlreadyExists.selector, ELECTION_A));
        registry.createElection(ELECTION_A, ROOT_2, NUM_CANDIDATES + 5, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyB());

        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_1);
        assertEq(election.numCandidates, NUM_CANDIDATES);
        assertEq(election.dkgPublicKey[0], _keyA()[0]);
    }

    // --- getElection ----------------------------------------------------------------

    function test_GetElection_RevertsWhenUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.ElectionNotFound.selector, UNKNOWN_ELECTION));
        registry.getElection(UNKNOWN_ELECTION);
    }

    // --- updateMerkleRoot: happy path ------------------------------------------------

    function test_UpdateMerkleRoot_SucceedsBeforeEligibilityClose() public {
        _createElectionA();

        vm.expectEmit(true, true, true, true, address(registry));
        emit ElectionRegistry.MerkleRootUpdated(ELECTION_A, ROOT_1, ROOT_2);

        vm.prank(admin);
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);

        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_2);
    }

    function test_UpdateMerkleRoot_EmitsImmediatelyPreviousRootOnEachChange() public {
        _createElectionA();

        vm.prank(admin);
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);

        // The second change must report ROOT_2 as the old root, not the original ROOT_1.
        // Without this, an auditor replaying the log could reconstruct the wrong electorate.
        vm.expectEmit(true, true, true, true, address(registry));
        emit ElectionRegistry.MerkleRootUpdated(ELECTION_A, ROOT_2, ROOT_1);

        vm.prank(admin);
        registry.updateMerkleRoot(ELECTION_A, ROOT_1);

        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_1);
    }

    function test_UpdateMerkleRoot_LeavesEveryOtherFieldUntouched() public {
        _createElectionA();

        vm.prank(admin);
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);

        // "Immutable except the root" is the promise the registry makes; this is the assertion
        // that only the root actually moved.
        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_2);
        assertEq(election.numCandidates, NUM_CANDIDATES);
        assertEq(election.eligibilityCloseAt, ELIGIBILITY_CLOSE);
        assertEq(election.votingCloseAt, VOTING_CLOSE);
        assertEq(election.dkgPublicKey[0], _keyA()[0]);
        assertEq(election.dkgPublicKey[1], _keyA()[1]);
    }

    // --- updateMerkleRoot: revert paths ----------------------------------------------

    function test_UpdateMerkleRoot_RevertsAtExactEligibilityClose() public {
        _createElectionA();

        // The window is strictly "before close". Landing exactly on the close timestamp is
        // already closed, so a root cannot move in the same second voting opens.
        vm.warp(ELIGIBILITY_CLOSE);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ElectionRegistry.RegistrationClosed.selector, ELECTION_A, ELIGIBILITY_CLOSE)
        );
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);
    }

    function test_UpdateMerkleRoot_RevertsAfterEligibilityClose() public {
        _createElectionA();
        vm.warp(ELIGIBILITY_CLOSE + 1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ElectionRegistry.RegistrationClosed.selector, ELECTION_A, ELIGIBILITY_CLOSE)
        );
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);

        // The root really is frozen: still the original after the rejected attempt.
        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_1);
    }

    function test_UpdateMerkleRoot_RevertsWhenCallerIsNotAdmin() public {
        _createElectionA();

        // Hoisted above the prank — see test_CreateElection_RevertsWhenCallerIsNotAdmin.
        bytes32 requiredRole = registry.ELECTION_ADMIN_ROLE();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.Unauthorized.selector, stranger, requiredRole));
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);

        // Unauthorised attempts cannot rewrite the electorate.
        ElectionRegistry.Election memory election = registry.getElection(ELECTION_A);
        assertEq(election.merkleRoot, ROOT_1);
    }

    function test_UpdateMerkleRoot_RevertsWhenElectionUnknown() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ElectionRegistry.ElectionNotFound.selector, UNKNOWN_ELECTION));
        registry.updateMerkleRoot(UNKNOWN_ELECTION, ROOT_2);
    }

    // --- role management --------------------------------------------------------------

    function test_GrantRole_AllowsDelegatedOperatorToManageElections() public {
        // Hoisted for the same reason as the revert test below: a role getter is an external
        // call and would consume the prank.
        bytes32 electionAdminRole = registry.ELECTION_ADMIN_ROLE();

        vm.prank(admin);
        registry.grantRole(electionAdminRole, operator);
        assertTrue(registry.hasRole(electionAdminRole, operator));

        vm.startPrank(operator);
        registry.createElection(ELECTION_B, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());
        registry.updateMerkleRoot(ELECTION_B, ROOT_2);
        vm.stopPrank();

        ElectionRegistry.Election memory election = registry.getElection(ELECTION_B);
        assertEq(election.merkleRoot, ROOT_2);
    }

    function test_RevokeRole_BlocksFormerAdminFromCreatingAndUpdating() public {
        // Revoking only ELECTION_ADMIN_ROLE leaves DEFAULT_ADMIN_ROLE intact, so this is
        // specifically the operational role being withdrawn.
        vm.startPrank(admin);
        registry.revokeRole(registry.ELECTION_ADMIN_ROLE(), admin);
        assertFalse(registry.hasRole(registry.ELECTION_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));

        vm.expectRevert(
            abi.encodeWithSelector(ElectionRegistry.Unauthorized.selector, admin, registry.ELECTION_ADMIN_ROLE())
        );
        registry.createElection(ELECTION_A, ROOT_1, NUM_CANDIDATES, ELIGIBILITY_CLOSE, VOTING_CLOSE, _keyA());

        vm.expectRevert(
            abi.encodeWithSelector(ElectionRegistry.Unauthorized.selector, admin, registry.ELECTION_ADMIN_ROLE())
        );
        registry.updateMerkleRoot(ELECTION_A, ROOT_2);
        vm.stopPrank();
    }

    function test_GrantRole_RevertsForCallerWithoutDefaultAdminRole() public {
        // Role administration itself stays with OpenZeppelin's own gate and error — Keystone
        // only overrides the error for the election operations it owns.
        //
        // Both getters are hoisted above the prank: evaluated inside the `expectRevert`
        // argument they would each be an external call, and the last one would swallow the
        // prank, letting the assertion pass for the wrong reason.
        bytes32 electionAdminRole = registry.ELECTION_ADMIN_ROLE();
        bytes32 defaultAdminRole = registry.DEFAULT_ADMIN_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, defaultAdminRole)
        );
        registry.grantRole(electionAdminRole, stranger);
    }

    // --- fuzz -------------------------------------------------------------------------

    function testFuzz_CreateElection_RoundTripsEveryField(
        bytes32 electionId,
        bytes32 merkleRoot,
        uint256 numCandidates,
        uint64 eligibilityCloseAt,
        uint64 votingCloseAt,
        uint256 keyX,
        uint256 keyY
    ) public {
        uint256[2] memory dkgPublicKey = [keyX, keyY];

        vm.prank(admin);
        registry.createElection(electionId, merkleRoot, numCandidates, eligibilityCloseAt, votingCloseAt, dkgPublicKey);

        ElectionRegistry.Election memory election = registry.getElection(electionId);
        assertEq(election.merkleRoot, merkleRoot);
        assertEq(election.numCandidates, numCandidates);
        assertEq(election.eligibilityCloseAt, eligibilityCloseAt);
        assertEq(election.votingCloseAt, votingCloseAt);
        assertEq(election.dkgPublicKey[0], keyX);
        assertEq(election.dkgPublicKey[1], keyY);
    }

    function testFuzz_UpdateMerkleRoot_AppliesOnlyBeforeClose(
        bytes32 electionId,
        bytes32 rootBefore,
        bytes32 rootAfter,
        uint64 eligibilityCloseAt,
        uint64 warpTo
    ) public {
        // Fuzzes the window boundary from both sides rather than picking a timestamp: the
        // interesting inputs are warpTo == eligibilityCloseAt and one second either side.
        vm.prank(admin);
        registry.createElection(electionId, rootBefore, NUM_CANDIDATES, eligibilityCloseAt, VOTING_CLOSE, _keyA());

        vm.warp(warpTo);

        if (warpTo >= eligibilityCloseAt) {
            vm.prank(admin);
            vm.expectRevert(
                abi.encodeWithSelector(ElectionRegistry.RegistrationClosed.selector, electionId, eligibilityCloseAt)
            );
            registry.updateMerkleRoot(electionId, rootAfter);

            ElectionRegistry.Election memory frozen = registry.getElection(electionId);
            assertEq(frozen.merkleRoot, rootBefore);
        } else {
            vm.prank(admin);
            registry.updateMerkleRoot(electionId, rootAfter);

            ElectionRegistry.Election memory updated = registry.getElection(electionId);
            assertEq(updated.merkleRoot, rootAfter);
        }
    }
}
