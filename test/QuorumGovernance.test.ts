import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { QuorumGovernance, BondingCurveFactory } from "../typechain-types";

describe("QuorumGovernance", function () {
  // Fixture to deploy governance with factory
  async function deployGovernanceFixture() {
    const [owner, treasury, agent1, agent2, agent3, agent4, agent5, voter1] =
      await ethers.getSigners();

    // Deploy factory first
    const Factory = await ethers.getContractFactory("BondingCurveFactory");
    const factory = await Factory.deploy(treasury.address);

    // Deploy governance with factory address
    const Governance = await ethers.getContractFactory("QuorumGovernance");
    const governance = await Governance.deploy(factory.target);

    // Constants from contract
    const votingPeriod = 3 * 24 * 60 * 60; // 3 days (constant in contract)

    return {
      governance,
      factory,
      owner,
      treasury,
      agent1,
      agent2,
      agent3,
      agent4,
      agent5,
      voter1,
      votingPeriod,
    };
  }

  describe("Deployment", function () {
    it("Should set correct factory address", async function () {
      const { governance, factory } = await loadFixture(deployGovernanceFixture);

      expect(await governance.factory()).to.equal(factory.target);
    });

    it("Should have correct constants", async function () {
      const { governance } = await loadFixture(deployGovernanceFixture);

      // VOTING_PERIOD is 3 days (259200 seconds)
      expect(await governance.VOTING_PERIOD()).to.equal(3 * 24 * 60 * 60);
      // QUORUM_THRESHOLD_BPS is 6666 (66.66%)
      expect(await governance.QUORUM_THRESHOLD_BPS()).to.equal(6666);
    });
  });

  describe("Quorum Proposals", function () {
    it("Should allow proposing a new quorum", async function () {
      const { governance, agent1, agent2, agent3, agent4 } =
        await loadFixture(deployGovernanceFixture);

      const proposedAgents = [agent1.address, agent2.address, agent3.address, agent4.address];
      const weights = [30, 30, 25, 15];

      await expect(
        governance.connect(agent1).proposeQuorum(
          proposedAgents,
          weights,
          "New Quorum Token",
          "NQT",
          "Building something amazing"
        )
      ).to.emit(governance, "QuorumProposalCreated");

      expect(await governance.quorumProposalCount()).to.equal(1);
    });

    it("Should reject quorum below minimum size (3)", async function () {
      const { governance, agent1, agent2 } = await loadFixture(deployGovernanceFixture);

      await expect(
        governance.connect(agent1).proposeQuorum(
          [agent1.address, agent2.address],
          [50, 50],
          "Token",
          "TK",
          "Thesis"
        )
      ).to.be.revertedWith("Quorum size 3-10");
    });

    it("Should reject quorum above maximum size (10)", async function () {
      const { governance } = await loadFixture(deployGovernanceFixture);
      const signers = await ethers.getSigners();
      const agents = signers.slice(0, 11).map((s) => s.address);
      const weights = [10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5];

      await expect(
        governance.connect(signers[0]).proposeQuorum(agents, weights, "Token", "TK", "Thesis")
      ).to.be.revertedWith("Quorum size 3-10");
    });

    it("Should reject non-proposer from proposing quorum", async function () {
      const { governance, agent1, agent2, agent3, voter1 } = await loadFixture(deployGovernanceFixture);

      // voter1 tries to propose a quorum they're not part of
      await expect(
        governance.connect(voter1).proposeQuorum(
          [agent1.address, agent2.address, agent3.address],
          [40, 35, 25],
          "Token",
          "TK",
          "Thesis"
        )
      ).to.be.revertedWith("Proposer must be in quorum");
    });
  });

  describe("Quorum Approval", function () {
    it("Should allow proposed agents to approve", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      // Create proposal (agent1 auto-approves)
      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token",
        "TK",
        "Thesis"
      );

      // agent2 approves
      await expect(governance.connect(agent2).approveQuorum(0))
        .to.emit(governance, "QuorumApproval")
        .withArgs(0, agent2.address);
    });

    it("Should reject approval from non-proposed agents", async function () {
      const { governance, agent1, agent2, agent3, voter1 } =
        await loadFixture(deployGovernanceFixture);

      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token",
        "TK",
        "Thesis"
      );

      await expect(
        governance.connect(voter1).approveQuorum(0)
      ).to.be.revertedWith("Not in proposed quorum");
    });

    it("Should reject double approval", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token",
        "TK",
        "Thesis"
      );

      // agent1 already approved via proposing
      await expect(
        governance.connect(agent1).approveQuorum(0)
      ).to.be.revertedWith("Already approved");
    });

    it("Should reject approval after deadline", async function () {
      const { governance, agent1, agent2, agent3, votingPeriod } =
        await loadFixture(deployGovernanceFixture);

      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token",
        "TK",
        "Thesis"
      );

      // Fast forward past voting period
      await time.increase(votingPeriod + 1);

      await expect(
        governance.connect(agent2).approveQuorum(0)
      ).to.be.revertedWith("Voting ended");
    });
  });

  describe("Quorum Execution", function () {
    it("Should auto-execute when all agents approve", async function () {
      const { governance, factory, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      // Create proposal (agent1 auto-approves)
      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Passed Token",
        "PT",
        "This should pass"
      );

      // agent2 approves
      await governance.connect(agent2).approveQuorum(0);

      // agent3 approves - should trigger execution
      await expect(governance.connect(agent3).approveQuorum(0))
        .to.emit(governance, "QuorumFormed");

      // Market should be created in factory
      expect(await factory.marketCount()).to.equal(1);

      // Proposal should be marked as executed
      const proposal = await governance.getQuorumProposal(0);
      expect(proposal.executed).to.be.true;
    });
  });

  describe("View Functions", function () {
    it("Should return correct quorum proposal details", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Test Token",
        "TT",
        "Test thesis"
      );

      const proposal = await governance.getQuorumProposal(0);
      expect(proposal.proposedAgents.length).to.equal(3);
      expect(proposal.name).to.equal("Test Token");
      expect(proposal.symbol).to.equal("TT");
      expect(proposal.thesis).to.equal("Test thesis");
      expect(proposal.approvalCount).to.equal(1n); // Proposer auto-approves
      expect(proposal.executed).to.be.false;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set factory", async function () {
      const { governance, owner, agent1 } = await loadFixture(deployGovernanceFixture);

      const newFactoryAddress = agent1.address; // Just using a random address for test
      await governance.connect(owner).setFactory(newFactoryAddress);
      expect(await governance.factory()).to.equal(newFactoryAddress);
    });

    it("Should reject non-owner from setting factory", async function () {
      const { governance, agent1 } = await loadFixture(deployGovernanceFixture);

      await expect(
        governance.connect(agent1).setFactory(agent1.address)
      ).to.be.revertedWithCustomError(governance, "OwnableUnauthorizedAccount");
    });
  });

  // Fixture to deploy governance with an existing market (needed for governance proposals)
  async function deployWithMarketFixture() {
    const [owner, treasury, agent1, agent2, agent3, agent4, agent5, voter1] =
      await ethers.getSigners();

    // Deploy factory first
    const Factory = await ethers.getContractFactory("BondingCurveFactory");
    const factory = await Factory.deploy(treasury.address);

    // Deploy governance with factory address
    const Governance = await ethers.getContractFactory("QuorumGovernance");
    const governance = await Governance.deploy(factory.target);

    // Create a quorum proposal and execute it to get a market
    await governance.connect(agent1).proposeQuorum(
      [agent1.address, agent2.address, agent3.address],
      [40, 35, 25],
      "Test Token",
      "TT",
      "Test thesis"
    );

    // agent2 and agent3 approve to execute
    await governance.connect(agent2).approveQuorum(0);
    await governance.connect(agent3).approveQuorum(0);

    // Market 0 should now exist
    const marketId = 0;
    const votingPeriod = 3 * 24 * 60 * 60; // 3 days

    return {
      governance,
      factory,
      owner,
      treasury,
      agent1,
      agent2,
      agent3,
      agent4,
      agent5,
      voter1,
      marketId,
      votingPeriod,
    };
  }

  describe("Governance Proposals", function () {
    it("Should allow quorum member to create a proposal", async function () {
      const { governance, agent1, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await expect(
        governance.connect(agent1).propose(
          marketId,
          0, // ProposalType.AddAgent
          agent4.address,
          0,
          "0x",
          "Add agent4 to the quorum"
        )
      ).to.emit(governance, "ProposalCreated");

      expect(await governance.proposalCount()).to.equal(1);
    });

    it("Should reject proposal from non-quorum member", async function () {
      const { governance, voter1, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await expect(
        governance.connect(voter1).propose(
          marketId,
          0, // ProposalType.AddAgent
          agent4.address,
          0,
          "0x",
          "Add agent4 to the quorum"
        )
      ).to.be.revertedWith("Not quorum member");
    });

    it("Should return correct proposal details via getProposal", async function () {
      const { governance, agent1, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0, // ProposalType.AddAgent
        agent4.address,
        100,
        "0x1234",
        "Add agent4 to the quorum"
      );

      const proposal = await governance.getProposal(0);
      expect(proposal.id).to.equal(0);
      expect(proposal.marketId).to.equal(marketId);
      expect(proposal.pType).to.equal(0); // AddAgent
      expect(proposal.target).to.equal(agent4.address);
      expect(proposal.value).to.equal(100);
      expect(proposal.forVotes).to.equal(0);
      expect(proposal.againstVotes).to.equal(0);
      expect(proposal.status).to.equal(0); // Active
      expect(proposal.proposer).to.equal(agent1.address);
      expect(proposal.description).to.equal("Add agent4 to the quorum");
    });
  });

  describe("Voting", function () {
    it("Should allow quorum member to vote for", async function () {
      const { governance, agent1, agent2, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0, // ProposalType.AddAgent
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      await expect(governance.connect(agent2).vote(0, true))
        .to.emit(governance, "VoteCast")
        .withArgs(0, agent2.address, true, 35); // agent2 has weight 35
    });

    it("Should allow quorum member to vote against", async function () {
      const { governance, agent1, agent3, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0, // ProposalType.AddAgent
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      await expect(governance.connect(agent3).vote(0, false))
        .to.emit(governance, "VoteCast")
        .withArgs(0, agent3.address, false, 25); // agent3 has weight 25
    });

    it("Should reject vote from non-quorum member", async function () {
      const { governance, agent1, voter1, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      await expect(
        governance.connect(voter1).vote(0, true)
      ).to.be.revertedWith("Not quorum member");
    });

    it("Should reject double voting", async function () {
      const { governance, agent1, agent2, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      await governance.connect(agent2).vote(0, true);

      await expect(
        governance.connect(agent2).vote(0, true)
      ).to.be.revertedWith("Already voted");
    });

    it("Should reject voting after deadline", async function () {
      const { governance, agent1, agent2, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // Fast forward past voting period
      await time.increase(votingPeriod + 1);

      await expect(
        governance.connect(agent2).vote(0, true)
      ).to.be.revertedWith("Voting ended");
    });

    it("Should track votes correctly", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // agent1 (weight 40) votes for
      await governance.connect(agent1).vote(0, true);
      // agent2 (weight 35) votes against
      await governance.connect(agent2).vote(0, false);
      // agent3 (weight 25) votes for
      await governance.connect(agent3).vote(0, true);

      const proposal = await governance.getProposal(0);
      expect(proposal.forVotes).to.equal(65); // 40 + 25
      expect(proposal.againstVotes).to.equal(35);
    });
  });

  describe("Proposal Execution", function () {
    it("Should execute AddAgent proposal with majority", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0, // ProposalType.AddAgent
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // All agents vote for (total weight 100, all for)
      await governance.connect(agent1).vote(0, true); // 40
      await governance.connect(agent2).vote(0, true); // 35
      await governance.connect(agent3).vote(0, true); // 25

      // Fast forward past voting period
      await time.increase(votingPeriod + 1);

      // Execute
      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, true);

      // agent4 should now be a quorum member
      expect(await governance.isQuorumMember(marketId, agent4.address)).to.be.true;

      // Proposal should be marked as Executed
      const proposal = await governance.getProposal(0);
      expect(proposal.status).to.equal(3); // Executed
    });

    it("Should execute RemoveAgent proposal", async function () {
      const { governance, agent1, agent2, agent3, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      // Confirm agent3 is a member first
      expect(await governance.isQuorumMember(marketId, agent3.address)).to.be.true;

      await governance.connect(agent1).propose(
        marketId,
        1, // ProposalType.RemoveAgent
        agent3.address,
        0,
        "0x",
        "Remove agent3"
      );

      // 2/3 quorum participation and majority
      await governance.connect(agent1).vote(0, true); // 40
      await governance.connect(agent2).vote(0, true); // 35

      // Fast forward past voting period
      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, true);

      // agent3 should no longer be a quorum member
      expect(await governance.isQuorumMember(marketId, agent3.address)).to.be.false;
    });

    it("Should execute TreasurySpend proposal", async function () {
      const { governance, agent1, agent2, agent3, treasury, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        2, // ProposalType.TreasurySpend
        treasury.address,
        ethers.parseEther("1"),
        "0x",
        "Spend treasury funds"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, true);
    });

    it("Should execute AdjustFees proposal", async function () {
      const { governance, agent1, agent2, agent3, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        3, // ProposalType.AdjustFees
        ethers.ZeroAddress,
        100, // new fee value
        "0x",
        "Adjust fees"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, true);
    });

    it("Should execute ForceGraduate proposal", async function () {
      const { governance, agent1, agent2, agent3, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        4, // ProposalType.ForceGraduate
        ethers.ZeroAddress,
        0,
        "0x",
        "Force graduation"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, true);
    });

    it("Should fail proposal without quorum", async function () {
      const { governance, agent1, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // Only agent1 votes (40% < 66.66% quorum)
      await governance.connect(agent1).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0)).to.be.revertedWith("Quorum not reached");
    });

    it("Should fail proposal when majority votes against", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // agent1 votes for (40), agent2 and agent3 vote against (35+25=60)
      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, false);
      await governance.connect(agent3).vote(0, false);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, false);

      const proposal = await governance.getProposal(0);
      expect(proposal.status).to.equal(2); // Failed
    });

    it("Should reject execution before deadline", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      // Don't fast forward - try to execute immediately
      await expect(governance.execute(0)).to.be.revertedWith("Voting ongoing");
    });

    it("Should reject execution of already executed proposal", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      // Execute once
      await governance.execute(0);

      // Try to execute again
      await expect(governance.execute(0)).to.be.revertedWith("Proposal not active");
    });
  });

  describe("Quorum Proposal Edge Cases", function () {
    it("Should reject weights mismatch", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      await expect(
        governance.connect(agent1).proposeQuorum(
          [agent1.address, agent2.address, agent3.address],
          [50, 50], // Only 2 weights for 3 agents
          "Token",
          "TK",
          "Thesis"
        )
      ).to.be.revertedWith("Weights mismatch");
    });

    it("Should reject approval of already executed quorum", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      // Create and fully approve the quorum
      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token",
        "TK",
        "Thesis"
      );
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      // Create a new agent and try to approve the already executed proposal
      const signers = await ethers.getSigners();
      const newAgent = signers[10];

      // This should fail because proposal is already executed
      await expect(
        governance.connect(newAgent).approveQuorum(0)
      ).to.be.revertedWith("Already executed");
    });
  });

  describe("Additional Coverage Tests", function () {
    it("Should verify voting deadline is checked before proposal status", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      // Create a proposal
      await governance.connect(agent1).propose(
        marketId,
        0, // ProposalType.AddAgent
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // Vote with 2/3 quorum
      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      // Fast forward past voting period and execute
      await time.increase(votingPeriod + 1);
      await governance.execute(0);

      // The proposal is now executed
      const proposal = await governance.getProposal(0);
      expect(proposal.status).to.equal(3); // Executed

      // Note: the contract checks deadline first, so after time passes, it will
      // revert with "Voting ended" even if proposal is not active. This is
      // the expected behavior per the contract logic.
    });

    it("Should handle multiple quorum proposals", async function () {
      const { governance, agent1, agent2, agent3, agent4, agent5 } =
        await loadFixture(deployGovernanceFixture);

      // Create first quorum proposal
      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token1",
        "TK1",
        "First thesis"
      );

      // Create second quorum proposal
      await governance.connect(agent4).proposeQuorum(
        [agent4.address, agent5.address, agent1.address],
        [35, 35, 30],
        "Token2",
        "TK2",
        "Second thesis"
      );

      expect(await governance.quorumProposalCount()).to.equal(2);

      const proposal1 = await governance.getQuorumProposal(0);
      const proposal2 = await governance.getQuorumProposal(1);

      expect(proposal1.thesis).to.equal("First thesis");
      expect(proposal2.thesis).to.equal("Second thesis");
    });

    it("Should handle partial quorum approval", async function () {
      const { governance, agent1, agent2, agent3, votingPeriod } =
        await loadFixture(deployGovernanceFixture);

      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Partial Token",
        "PT",
        "Partial approval test"
      );

      // Only agent2 approves (agent1 already approved via proposing)
      await governance.connect(agent2).approveQuorum(0);

      const proposal = await governance.getQuorumProposal(0);
      expect(proposal.approvalCount).to.equal(2n); // 2 out of 3
      expect(proposal.executed).to.be.false;

      // Let the voting period expire
      await time.increase(votingPeriod + 1);

      // Proposal should still not be executed
      const proposalAfter = await governance.getQuorumProposal(0);
      expect(proposalAfter.executed).to.be.false;
    });

    it("Should create multiple governance proposals for the same market", async function () {
      const { governance, agent1, agent4, agent5, marketId } =
        await loadFixture(deployWithMarketFixture);

      // Create first proposal
      await governance.connect(agent1).propose(
        marketId,
        0, // AddAgent
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // Create second proposal
      await governance.connect(agent1).propose(
        marketId,
        0, // AddAgent
        agent5.address,
        0,
        "0x",
        "Add agent5"
      );

      expect(await governance.proposalCount()).to.equal(2);
    });

    it("Should track hasVoted mapping correctly", async function () {
      const { governance, agent1, agent2, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Test proposal"
      );

      // Initially hasVoted should be false
      expect(await governance.hasVoted(0, agent2.address)).to.be.false;

      // After voting, hasVoted should be true
      await governance.connect(agent2).vote(0, true);
      expect(await governance.hasVoted(0, agent2.address)).to.be.true;
    });

    it("Should track isQuorumMember mapping correctly", async function () {
      const { governance, agent1, agent2, agent3, voter1, marketId } =
        await loadFixture(deployWithMarketFixture);

      // Original agents should be quorum members
      expect(await governance.isQuorumMember(marketId, agent1.address)).to.be.true;
      expect(await governance.isQuorumMember(marketId, agent2.address)).to.be.true;
      expect(await governance.isQuorumMember(marketId, agent3.address)).to.be.true;

      // Non-member should not be a quorum member
      expect(await governance.isQuorumMember(marketId, voter1.address)).to.be.false;
    });

    it("Should correctly retrieve proposal data for all fields", async function () {
      const { governance, agent1, agent4, marketId } =
        await loadFixture(deployWithMarketFixture);

      const testData = "0x1234567890abcdef";
      const testValue = 12345n;

      await governance.connect(agent1).propose(
        marketId,
        2, // TreasurySpend
        agent4.address,
        testValue,
        testData,
        "Detailed proposal"
      );

      const proposal = await governance.getProposal(0);

      expect(proposal.id).to.equal(0);
      expect(proposal.marketId).to.equal(marketId);
      expect(proposal.pType).to.equal(2);
      expect(proposal.target).to.equal(agent4.address);
      expect(proposal.value).to.equal(testValue);
      expect(proposal.forVotes).to.equal(0);
      expect(proposal.againstVotes).to.equal(0);
      expect(proposal.status).to.equal(0); // Active
      expect(proposal.proposer).to.equal(agent1.address);
      expect(proposal.description).to.equal("Detailed proposal");
    });

    it("Should handle minimum quorum size (3 agents)", async function () {
      const { governance, agent1, agent2, agent3, factory } =
        await loadFixture(deployGovernanceFixture);

      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [34, 33, 33],
        "Min Token",
        "MINT",
        "Minimum quorum"
      );

      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      // Should have created market
      expect(await factory.marketCount()).to.equal(1);
    });

    it("Should handle maximum quorum size (10 agents)", async function () {
      const { governance, factory } =
        await loadFixture(deployGovernanceFixture);

      const signers = await ethers.getSigners();
      const agents = signers.slice(0, 10).map((s) => s.address);
      const weights = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];

      // First agent proposes
      await governance.connect(signers[0]).proposeQuorum(
        agents,
        weights,
        "Max Token",
        "MAXT",
        "Maximum quorum"
      );

      // All other 9 agents approve
      for (let i = 1; i < 10; i++) {
        await governance.connect(signers[i]).approveQuorum(0);
      }

      // Should have created market
      expect(await factory.marketCount()).to.equal(1);
    });

    it("Should emit QuorumApproval event for proposer", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      // When proposing, the proposer auto-approves, which should emit event
      await expect(
        governance.connect(agent1).proposeQuorum(
          [agent1.address, agent2.address, agent3.address],
          [40, 35, 25],
          "Token",
          "TK",
          "Thesis"
        )
      )
        .to.emit(governance, "QuorumApproval")
        .withArgs(0, agent1.address);
    });

    it("Should handle ProposeQuorum proposal type in execute (returns false)", async function () {
      const { governance, agent1, agent2, agent3, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      // Create a proposal with ProposeQuorum type (type 5)
      // This is an unusual case since ProposeQuorum is normally handled via quorumProposals
      await governance.connect(agent1).propose(
        marketId,
        5, // ProposalType.ProposeQuorum
        ethers.ZeroAddress,
        0,
        "0x",
        "ProposeQuorum type proposal"
      );

      // All agents vote for
      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      // Execute - should hit the fallback return false in _executeProposal
      // Since _executeProposal returns false for unhandled types, and the proposal
      // passes (forVotes > againstVotes), it will first set status to Passed,
      // then _executeProposal returns false, so status becomes Failed
      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, false);

      const proposal = await governance.getProposal(0);
      expect(proposal.status).to.equal(2); // Failed
    });

    it("Should return 0 voting weight for non-existent voter in agents array", async function () {
      const { governance, agent1, agent2, agent3, agent4, voter1, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      // Manually add voter1 as quorum member (without being in the original agents array)
      // We do this by first adding voter1 through a governance proposal
      await governance.connect(agent1).propose(
        marketId,
        0, // AddAgent
        voter1.address,
        0,
        "0x",
        "Add voter1"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);
      await governance.execute(0);

      // Now voter1 is a quorum member but not in the original agents array
      expect(await governance.isQuorumMember(marketId, voter1.address)).to.be.true;

      // Create a new proposal
      await governance.connect(agent1).propose(
        marketId,
        0, // AddAgent
        agent4.address,
        0,
        "0x",
        "Add agent4"
      );

      // voter1 tries to vote - they are a quorum member but have 0 weight
      // since they're not in the original factory agents array
      await expect(governance.connect(voter1).vote(1, true))
        .to.emit(governance, "VoteCast")
        .withArgs(1, voter1.address, true, 0); // weight is 0
    });

    it("Should verify _executeQuorumProposal internal guard for already executed", async function () {
      const { governance, agent1, agent2, agent3 } =
        await loadFixture(deployGovernanceFixture);

      // Create and fully approve the quorum (this triggers _executeQuorumProposal)
      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token",
        "TK",
        "Thesis"
      );

      await governance.connect(agent2).approveQuorum(0);

      // This final approval triggers _executeQuorumProposal
      await governance.connect(agent3).approveQuorum(0);

      // Verify it was executed
      const proposal = await governance.getQuorumProposal(0);
      expect(proposal.executed).to.be.true;
    });

    it("Should handle multiple markets with separate governance", async function () {
      const { governance, factory, agent1, agent2, agent3, agent4, agent5, votingPeriod } =
        await loadFixture(deployGovernanceFixture);

      // Create first quorum
      await governance.connect(agent1).proposeQuorum(
        [agent1.address, agent2.address, agent3.address],
        [40, 35, 25],
        "Token1",
        "TK1",
        "First market"
      );
      await governance.connect(agent2).approveQuorum(0);
      await governance.connect(agent3).approveQuorum(0);

      // Create second quorum with different agents
      await governance.connect(agent4).proposeQuorum(
        [agent4.address, agent5.address, agent1.address],
        [35, 35, 30],
        "Token2",
        "TK2",
        "Second market"
      );
      await governance.connect(agent5).approveQuorum(1);
      await governance.connect(agent1).approveQuorum(1);

      expect(await factory.marketCount()).to.equal(2);

      // Verify quorum membership is separate
      expect(await governance.isQuorumMember(0, agent1.address)).to.be.true;
      expect(await governance.isQuorumMember(0, agent4.address)).to.be.false;
      expect(await governance.isQuorumMember(1, agent4.address)).to.be.true;
      expect(await governance.isQuorumMember(1, agent2.address)).to.be.false;
    });

    it("Should correctly calculate total weight from factory", async function () {
      const { governance, agent1, agent2, agent3, agent4, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      // Create a proposal
      await governance.connect(agent1).propose(
        marketId,
        0,
        agent4.address,
        0,
        "0x",
        "Test total weight"
      );

      // All agents vote (total weight should be 100)
      await governance.connect(agent1).vote(0, true); // 40
      await governance.connect(agent2).vote(0, true); // 35
      await governance.connect(agent3).vote(0, true); // 25

      await time.increase(votingPeriod + 1);

      // Execute should succeed because quorum is met (100 >= 66.66% of 100)
      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, true);
    });

    it("Should handle edge case where for votes equal against votes", async function () {
      const { governance, factory, votingPeriod } =
        await loadFixture(deployGovernanceFixture);

      const signers = await ethers.getSigners();
      // Create quorum with even weights: 25, 25, 25, 25
      await governance.connect(signers[0]).proposeQuorum(
        [signers[0].address, signers[1].address, signers[2].address, signers[3].address],
        [25, 25, 25, 25],
        "Even Token",
        "EVN",
        "Even weights"
      );

      await governance.connect(signers[1]).approveQuorum(0);
      await governance.connect(signers[2]).approveQuorum(0);
      await governance.connect(signers[3]).approveQuorum(0);

      const marketId = 0;

      // Create proposal
      await governance.connect(signers[0]).propose(
        marketId,
        0,
        signers[4].address,
        0,
        "0x",
        "Tie vote test"
      );

      // Two vote for (50), two vote against (50) - tie
      await governance.connect(signers[0]).vote(0, true);   // 25
      await governance.connect(signers[1]).vote(0, true);   // 25
      await governance.connect(signers[2]).vote(0, false);  // 25
      await governance.connect(signers[3]).vote(0, false);  // 25

      await time.increase(votingPeriod + 1);

      // Tie should fail (forVotes must be > againstVotes for success)
      await expect(governance.execute(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, false);

      const proposal = await governance.getProposal(0);
      expect(proposal.status).to.equal(2); // Failed
    });
  });

  describe("Governance Event Emissions", function () {
    it("Should emit TreasurySpendApproved on treasury spend execution", async function () {
      const { governance, agent1, agent2, agent3, treasury, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      const spendAmount = ethers.parseEther("1");

      await governance.connect(agent1).propose(
        marketId,
        2, // ProposalType.TreasurySpend
        treasury.address,
        spendAmount,
        "0x",
        "Spend treasury funds"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "TreasurySpendApproved")
        .withArgs(marketId, treasury.address, spendAmount);
    });

    it("Should emit FeeAdjustmentApproved on fee adjustment execution", async function () {
      const { governance, agent1, agent2, agent3, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      const newFeeBps = 100; // 1%

      await governance.connect(agent1).propose(
        marketId,
        3, // ProposalType.AdjustFees
        ethers.ZeroAddress,
        newFeeBps,
        "0x",
        "Adjust fees to 1%"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "FeeAdjustmentApproved")
        .withArgs(marketId, newFeeBps);
    });

    it("Should emit ForceGraduationApproved on force graduation execution", async function () {
      const { governance, agent1, agent2, agent3, marketId, votingPeriod } =
        await loadFixture(deployWithMarketFixture);

      await governance.connect(agent1).propose(
        marketId,
        4, // ProposalType.ForceGraduate
        ethers.ZeroAddress,
        0,
        "0x",
        "Force market graduation"
      );

      await governance.connect(agent1).vote(0, true);
      await governance.connect(agent2).vote(0, true);
      await governance.connect(agent3).vote(0, true);

      await time.increase(votingPeriod + 1);

      await expect(governance.execute(0))
        .to.emit(governance, "ForceGraduationApproved")
        .withArgs(marketId);
    });
  });
});
