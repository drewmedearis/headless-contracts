// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBondingCurveFactory {
    function getMarket(uint256 marketId) external view returns (
        address tokenAddress,
        address[] memory quorumAgents,
        uint256[] memory agentWeights,
        uint256 targetRaise,
        uint256 currentRaised,
        uint256 tokensSold,
        bool graduated,
        bool active,
        string memory thesis
    );

    function createMarket(
        address[] calldata quorumAgents,
        uint256[] calldata weights,
        string calldata name,
        string calldata symbol,
        string calldata thesis
    ) external returns (uint256 marketId);
}

/**
 * @title QuorumGovernance
 * @dev Agent voting on treasury, membership, and market parameters
 *
 * Proposal Types:
 * - AddAgent: Add new agent to quorum
 * - RemoveAgent: Remove agent from quorum
 * - TreasurySpend: Spend from market treasury
 * - AdjustFees: Modify fee parameters
 * - ForceGraduate: Force market graduation
 * - ProposeQuorum: Propose new quorum formation (creates market)
 */
contract QuorumGovernance is Ownable, ReentrancyGuard {
    // ============ Enums ============

    enum ProposalType {
        AddAgent,
        RemoveAgent,
        TreasurySpend,
        AdjustFees,
        ForceGraduate,
        ProposeQuorum
    }

    enum ProposalStatus {
        Active,
        Passed,
        Failed,
        Executed,
        Cancelled
    }

    // ============ Structs ============

    struct Proposal {
        uint256 id;
        uint256 marketId;
        ProposalType pType;
        address target;          // Target address (for add/remove agent, treasury recipient)
        uint256 value;           // Value (for treasury spend, fee amount)
        bytes data;              // Additional data
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        ProposalStatus status;
        address proposer;
        string description;
    }

    struct QuorumProposal {
        uint256 id;
        address[] proposedAgents;
        uint256[] weights;
        string name;
        string symbol;
        string thesis;
        uint256 approvalCount;
        uint256 deadline;
        bool executed;
        mapping(address => bool) hasApproved;
    }

    // ============ State Variables ============

    IBondingCurveFactory public factory;

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    mapping(uint256 => QuorumProposal) public quorumProposals;
    uint256 public quorumProposalCount;

    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bool)) public isQuorumMember;

    // Local storage for voting weights (HM-06) - avoids external calls
    mapping(uint256 => mapping(address => uint256)) public agentWeight;
    mapping(uint256 => uint256) public marketTotalWeight;

    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant EXECUTION_WINDOW = 7 days;   // Time window to execute after voting ends (HM-05)
    uint256 public constant QUORUM_THRESHOLD_BPS = 6666; // 2/3 = 66.66%

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed marketId,
        ProposalType pType,
        address proposer,
        string description
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight
    );

    event ProposalExecuted(
        uint256 indexed proposalId,
        bool success
    );

    event QuorumProposalCreated(
        uint256 indexed proposalId,
        address[] agents,
        string thesis
    );

    event QuorumApproval(
        uint256 indexed proposalId,
        address indexed agent
    );

    event QuorumFormed(
        uint256 indexed proposalId,
        uint256 indexed marketId
    );

    event TreasurySpendApproved(
        uint256 indexed marketId,
        address indexed recipient,
        uint256 amount
    );

    event FeeAdjustmentApproved(
        uint256 indexed marketId,
        uint256 newFeeBps
    );

    event ForceGraduationApproved(
        uint256 indexed marketId
    );

    event AgentWeightUpdated(
        uint256 indexed marketId,
        address indexed agent,
        uint256 newWeight
    );

    // ============ Constructor ============

    constructor(address _factory) Ownable(msg.sender) {
        factory = IBondingCurveFactory(_factory);
    }

    // ============ Quorum Proposal Functions ============

    /**
     * @dev Propose formation of a new quorum
     * @param agents Array of agent addresses to form quorum
     * @param weights Contribution weights for each agent
     * @param name Token name for the market
     * @param symbol Token symbol
     * @param thesis Business thesis
     */
    function proposeQuorum(
        address[] calldata agents,
        uint256[] calldata weights,
        string calldata name,
        string calldata symbol,
        string calldata thesis
    ) external returns (uint256 proposalId) {
        require(agents.length >= 3 && agents.length <= 10, "Quorum size 3-10");
        require(agents.length == weights.length, "Weights mismatch");
        require(_sumWeights(weights) == 100, "Weights must sum to 100");
        require(!_hasDuplicates(agents), "Duplicate agents");
        require(_isInArray(msg.sender, agents), "Proposer must be in quorum");

        proposalId = quorumProposalCount++;

        QuorumProposal storage proposal = quorumProposals[proposalId];
        proposal.id = proposalId;
        proposal.proposedAgents = agents;
        proposal.weights = weights;
        proposal.name = name;
        proposal.symbol = symbol;
        proposal.thesis = thesis;
        proposal.approvalCount = 1; // Proposer auto-approves
        proposal.deadline = block.timestamp + VOTING_PERIOD;
        proposal.executed = false;
        proposal.hasApproved[msg.sender] = true;

        emit QuorumProposalCreated(proposalId, agents, thesis);
        emit QuorumApproval(proposalId, msg.sender);
    }

    /**
     * @dev Approve quorum formation proposal
     * @param proposalId The quorum proposal to approve
     */
    function approveQuorum(uint256 proposalId) external {
        QuorumProposal storage proposal = quorumProposals[proposalId];
        require(block.timestamp < proposal.deadline, "Voting ended");
        require(!proposal.executed, "Already executed");
        require(!proposal.hasApproved[msg.sender], "Already approved");
        require(_isInArray(msg.sender, proposal.proposedAgents), "Not in proposed quorum");

        proposal.hasApproved[msg.sender] = true;
        proposal.approvalCount++;

        emit QuorumApproval(proposalId, msg.sender);

        // If all agents approved, execute
        if (proposal.approvalCount == proposal.proposedAgents.length) {
            _executeQuorumProposal(proposalId);
        }
    }

    /**
     * @dev Execute quorum proposal (create market)
     */
    function _executeQuorumProposal(uint256 proposalId) internal {
        QuorumProposal storage proposal = quorumProposals[proposalId];
        require(!proposal.executed, "Already executed");
        require(
            proposal.approvalCount == proposal.proposedAgents.length,
            "Not all agents approved"
        );

        proposal.executed = true;

        // Create market through factory
        uint256 marketId = factory.createMarket(
            proposal.proposedAgents,
            proposal.weights,
            proposal.name,
            proposal.symbol,
            proposal.thesis
        );

        // Register quorum members and store weights locally (HM-06)
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < proposal.proposedAgents.length; i++) {
            address agent = proposal.proposedAgents[i];
            uint256 weight = proposal.weights[i];

            isQuorumMember[marketId][agent] = true;
            agentWeight[marketId][agent] = weight;
            totalWeight += weight;
        }
        marketTotalWeight[marketId] = totalWeight;

        emit QuorumFormed(proposalId, marketId);
    }

    // ============ Governance Proposal Functions ============

    /**
     * @dev Create a governance proposal for an existing market
     */
    function propose(
        uint256 marketId,
        ProposalType pType,
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description
    ) external returns (uint256 proposalId) {
        require(isQuorumMember[marketId][msg.sender], "Not quorum member");

        proposalId = proposalCount++;

        proposals[proposalId] = Proposal({
            id: proposalId,
            marketId: marketId,
            pType: pType,
            target: target,
            value: value,
            data: data,
            forVotes: 0,
            againstVotes: 0,
            deadline: block.timestamp + VOTING_PERIOD,
            status: ProposalStatus.Active,
            proposer: msg.sender,
            description: description
        });

        emit ProposalCreated(proposalId, marketId, pType, msg.sender, description);
    }

    /**
     * @dev Vote on a governance proposal
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.deadline, "Voting ended");
        require(proposal.status == ProposalStatus.Active, "Proposal not active");
        require(isQuorumMember[proposal.marketId][msg.sender], "Not quorum member");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        hasVoted[proposalId][msg.sender] = true;

        // Get voting weight from market
        uint256 weight = _getVotingWeight(proposal.marketId, msg.sender);

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /**
     * @dev Execute a passed proposal
     * @notice Must be executed within EXECUTION_WINDOW after voting ends
     */
    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.deadline, "Voting ongoing");
        require(block.timestamp <= proposal.deadline + EXECUTION_WINDOW, "Execution expired");
        require(proposal.status == ProposalStatus.Active, "Proposal not active");

        // Check quorum (2/3 participation)
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        uint256 totalWeight = _getTotalWeight(proposal.marketId);
        require(
            totalVotes * 10000 >= totalWeight * QUORUM_THRESHOLD_BPS,
            "Quorum not reached"
        );

        // Check majority
        if (proposal.forVotes > proposal.againstVotes) {
            proposal.status = ProposalStatus.Passed;
            bool success = _executeProposal(proposal);
            proposal.status = success ? ProposalStatus.Executed : ProposalStatus.Failed;
            emit ProposalExecuted(proposalId, success);
        } else {
            proposal.status = ProposalStatus.Failed;
            emit ProposalExecuted(proposalId, false);
        }
    }

    // ============ Internal Functions ============

    function _executeProposal(Proposal storage proposal) internal returns (bool) {
        if (proposal.pType == ProposalType.AddAgent) {
            // NEW-01 FIX: Assign voting weight from proposal.value
            isQuorumMember[proposal.marketId][proposal.target] = true;
            uint256 newWeight = proposal.value;
            if (newWeight > 0) {
                agentWeight[proposal.marketId][proposal.target] = newWeight;
                marketTotalWeight[proposal.marketId] += newWeight;
                emit AgentWeightUpdated(proposal.marketId, proposal.target, newWeight);
            }
            return true;
        } else if (proposal.pType == ProposalType.RemoveAgent) {
            // NEW-02 FIX: Clear weight and update total
            isQuorumMember[proposal.marketId][proposal.target] = false;
            uint256 oldWeight = agentWeight[proposal.marketId][proposal.target];
            if (oldWeight > 0) {
                agentWeight[proposal.marketId][proposal.target] = 0;
                marketTotalWeight[proposal.marketId] -= oldWeight;
                emit AgentWeightUpdated(proposal.marketId, proposal.target, 0);
            }
            return true;
        } else if (proposal.pType == ProposalType.TreasurySpend) {
            // Treasury spending is handled off-chain via proposal.target (recipient)
            // and proposal.value (amount). The actual transfer must be executed
            // by a separate treasury contract or multisig that monitors this event.
            // This allows flexible treasury management without holding funds in governance.
            emit TreasurySpendApproved(proposal.marketId, proposal.target, proposal.value);
            return true;
        } else if (proposal.pType == ProposalType.AdjustFees) {
            // Fee adjustments are recorded on-chain. The actual fee change must be
            // applied to the factory contract by the owner/admin based on this approval.
            // proposal.value contains the new fee in basis points
            emit FeeAdjustmentApproved(proposal.marketId, proposal.value);
            return true;
        } else if (proposal.pType == ProposalType.ForceGraduate) {
            // Force graduation signals that the quorum wants to graduate the market
            // even if the target raise hasn't been met. The factory must implement
            // a function to allow governance to trigger graduation.
            emit ForceGraduationApproved(proposal.marketId);
            return true;
        }
        return false;
    }

    /**
     * @dev Get voting weight for an agent (uses local storage - HM-06)
     * @param marketId The market ID
     * @param voter The agent address
     * @return The agent's voting weight
     */
    function _getVotingWeight(uint256 marketId, address voter) internal view returns (uint256) {
        return agentWeight[marketId][voter];
    }

    /**
     * @dev Get total voting weight for a market (uses local storage - HM-06)
     * @param marketId The market ID
     * @return The total voting weight
     */
    function _getTotalWeight(uint256 marketId) internal view returns (uint256) {
        return marketTotalWeight[marketId];
    }

    function _isInArray(address addr, address[] memory arr) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == addr) return true;
        }
        return false;
    }

    /**
     * @dev Sum weights array (NEW-04 FIX: early validation)
     */
    function _sumWeights(uint256[] calldata weights) internal pure returns (uint256 sum) {
        for (uint256 i = 0; i < weights.length; i++) {
            sum += weights[i];
        }
    }

    /**
     * @dev Check for duplicate addresses (NEW-04 FIX)
     */
    function _hasDuplicates(address[] calldata arr) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            for (uint256 j = i + 1; j < arr.length; j++) {
                if (arr[i] == arr[j]) return true;
            }
        }
        return false;
    }

    // ============ View Functions ============

    function getProposal(uint256 proposalId) external view returns (
        uint256 id,
        uint256 marketId,
        ProposalType pType,
        address target,
        uint256 value,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 deadline,
        ProposalStatus status,
        address proposer,
        string memory description
    ) {
        Proposal storage p = proposals[proposalId];
        return (
            p.id,
            p.marketId,
            p.pType,
            p.target,
            p.value,
            p.forVotes,
            p.againstVotes,
            p.deadline,
            p.status,
            p.proposer,
            p.description
        );
    }

    function getQuorumProposal(uint256 proposalId) external view returns (
        uint256 id,
        address[] memory proposedAgents,
        uint256[] memory weights,
        string memory name,
        string memory symbol,
        string memory thesis,
        uint256 approvalCount,
        uint256 deadline,
        bool executed
    ) {
        QuorumProposal storage p = quorumProposals[proposalId];
        return (
            p.id,
            p.proposedAgents,
            p.weights,
            p.name,
            p.symbol,
            p.thesis,
            p.approvalCount,
            p.deadline,
            p.executed
        );
    }

    // ============ Admin Functions ============

    function setFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "Zero address");
        factory = IBondingCurveFactory(_factory);
    }
}
