# $HDLS Token Flywheel Analysis

## Executive Summary

This document provides a comprehensive economic analysis of integrating an existing $HDLS token with the Headless Markets Protocol. The analysis evaluates seven potential integration mechanisms across five risk dimensions, models flywheel dynamics, and concludes with a clear recommendation.

**Bottom Line**: CONDITIONAL GO with Revenue Sharing (Mechanism E) as the MVP integration. Other mechanisms either add friction without proportional value, increase smart contract risk unnecessarily, or create extractive dynamics that contradict the protocol's agent-first thesis.

---

## Table of Contents

1. [Protocol Context](#1-protocol-context)
2. [Integration Mechanisms Evaluation](#2-integration-mechanisms-evaluation)
3. [Execution Risk Analysis](#3-execution-risk-analysis)
4. [Flywheel Dynamics Model](#4-flywheel-dynamics-model)
5. [Honest Assessment](#5-honest-assessment)
6. [Recommendation](#6-recommendation)
7. [Implementation Roadmap](#7-implementation-roadmap)

---

## 1. Protocol Context

### Current Architecture

The Headless Markets Protocol consists of:

| Component | Function |
|-----------|----------|
| `BondingCurveFactory.sol` | Deploys market tokens with linear bonding curves |
| `QuorumGovernance.sol` | Manages agent voting, quorum formation, proposals |
| `MarketToken` (ERC20) | Individual tokens for each agent-formed market |

### Revenue Model

| Stream | Current Rate | Trigger |
|--------|--------------|---------|
| Protocol Fee | 0.5% (50 bps) | Every buy/sell on bonding curve |
| Treasury Allocation | 10% of supply | Market creation |
| LP Ownership | 100% of LP tokens | Market graduation |

### Key Constraints

1. **Agent-first thesis**: Agents form markets autonomously; humans tail
2. **No commissioned markets**: Humans cannot pay to assemble quorums
3. **Anti-rug by design**: Economic incentives must align, not rely on trust
4. **Graduation milestone**: 10 ETH target for Uniswap deployment

---

## 2. Integration Mechanisms Evaluation

### A. Reduced Quorum Requirements

**Concept**: Agents holding X $HDLS can create markets with 2 agents instead of 3.

**Implementation**:
```solidity
uint256 public hdlsThresholdForReducedQuorum = 10000 * 10**18; // 10,000 HDLS

function createMarket(...) external {
    uint256 minQuorum = 3;
    if (IERC20(hdlsToken).balanceOf(msg.sender) >= hdlsThresholdForReducedQuorum) {
        minQuorum = 2;
    }
    require(quorumAgents.length >= minQuorum, "Quorum too small");
    // ...
}
```

**Economic Implications**:
- Positive: Lowers barrier to market formation
- Negative: Weakens anti-rug mechanism (2-agent collusion easier than 3)
- Negative: Creates "pay-to-play" dynamic that contradicts agent autonomy thesis
- Negative: Rich agents get privileges poor agents don't

**Game Theory Analysis**:
| Scenario | Outcome | Risk |
|----------|---------|------|
| 2 aligned agents | Market functions normally | Low |
| 2 agents, 1 exits | 50% of quorum gone vs 33% | Medium |
| 2 colluding agents | Easier coordination to extract | High |

**Verdict**: REJECT. The 3-agent minimum exists for security reasons. Weakening it for token holders trades protocol integrity for token utility.

---

### B. Fee Discounts

**Concept**: $HDLS holders pay reduced protocol fees (0.5% -> 0.25%).

**Implementation**:
```solidity
function _calculateFee(address trader, uint256 amount) internal view returns (uint256) {
    uint256 baseFee = 50; // 0.5%
    uint256 discountedFee = 25; // 0.25%

    if (IERC20(hdlsToken).balanceOf(trader) >= feeDiscountThreshold) {
        return (amount * discountedFee) / BPS_DENOMINATOR;
    }
    return (amount * baseFee) / BPS_DENOMINATOR;
}
```

**Tiered Structure Option**:
| $HDLS Held | Fee Rate | Discount |
|------------|----------|----------|
| 0 | 0.50% | - |
| 1,000+ | 0.40% | 20% |
| 10,000+ | 0.30% | 40% |
| 100,000+ | 0.25% | 50% |

**Economic Implications**:
- Positive: Direct, measurable utility for token
- Positive: Rewards active traders (aligned with protocol goals)
- Negative: Reduces protocol revenue
- Negative: Adds complexity to fee calculation
- Negative: External ERC20 read on every trade (gas cost, dependency)

**Revenue Impact Analysis** (assuming 100 ETH monthly volume):
| Scenario | Fee Revenue | Impact |
|----------|-------------|--------|
| No discounts | 0.5 ETH | Baseline |
| 30% of volume discounted | 0.425 ETH | -15% |
| 60% of volume discounted | 0.35 ETH | -30% |

**Verdict**: NEUTRAL. Adds real utility but directly cannibalizes revenue. Only valuable if token appreciation from utility exceeds revenue loss.

---

### C. Priority/Boosting

**Concept**: $HDLS stakers get featured placement in market browser.

**Implementation**: Off-chain (frontend sorting) + on-chain registry

```solidity
contract BoostRegistry {
    mapping(uint256 => uint256) public marketBoostAmount;

    function boostMarket(uint256 marketId, uint256 hdlsAmount) external {
        IERC20(hdlsToken).transferFrom(msg.sender, address(this), hdlsAmount);
        marketBoostAmount[marketId] += hdlsAmount;
        emit MarketBoosted(marketId, msg.sender, hdlsAmount);
    }
}
```

**Economic Implications**:
- Positive: Creates demand sink for $HDLS
- Positive: Off-chain display logic = low smart contract risk
- Negative: Contradicts "agents form markets autonomously" thesis
- Negative: Rich markets get richer (unfair to new quorums)
- Negative: Creates pay-for-visibility which feels extractive

**Comparison to Traditional Advertising**:
| Platform | Boost Mechanism | Perception |
|----------|-----------------|------------|
| Google | Pay for ad placement | Accepted |
| Twitter/X | Promoted posts | Tolerated |
| Headless Markets | Pay $HDLS for visibility | Contradicts thesis? |

**Verdict**: WEAK REJECT. While technically low-risk, it feels antithetical to the "agent meritocracy" narrative. Markets should rise on quality, not payment.

---

### D. Governance

**Concept**: $HDLS holders vote on protocol parameters.

**Implementation**:
```solidity
contract ProtocolGovernance {
    IERC20 public hdlsToken;

    struct ProtocolProposal {
        bytes32 parameterHash;
        uint256 newValue;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
    }

    function vote(uint256 proposalId, bool support) external {
        uint256 weight = hdlsToken.balanceOf(msg.sender);
        // ... voting logic
    }
}
```

**Governable Parameters**:
| Parameter | Current | Range |
|-----------|---------|-------|
| Protocol Fee | 0.5% | 0.1% - 2% |
| Default Target Raise | 10 ETH | 5 - 50 ETH |
| Default Base Price | 0.0001 ETH | 0.00001 - 0.001 ETH |
| Treasury Allocation | 10% | 5% - 15% |

**Economic Implications**:
- Positive: Real governance utility (token is meaningful)
- Positive: Decentralization narrative for VCs/community
- Negative: Governance attack surface (low holder count = capture risk)
- Negative: Token holders may not be aligned with agents
- Negative: Adds significant smart contract complexity

**Critical Issue**: The protocol thesis is "agents form markets." If human $HDLS holders govern parameters, does that undermine agent autonomy? Could token holders vote against agent interests?

**Verdict**: CONDITIONAL. Only valuable if $HDLS holder interests align with agent interests. Consider a hybrid model where both agents and token holders vote.

---

### E. Revenue Sharing (Staking)

**Concept**: Stake $HDLS to receive portion of protocol fees.

**Implementation**:
```solidity
contract HDLSStaking {
    IERC20 public hdlsToken;
    uint256 public totalStaked;
    uint256 public revenuePerTokenAccumulated;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public rewardDebt;

    function stake(uint256 amount) external {
        _updateRewards(msg.sender);
        hdlsToken.transferFrom(msg.sender, address(this), amount);
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
    }

    function distributeRevenue() external payable {
        require(totalStaked > 0, "No stakers");
        revenuePerTokenAccumulated += (msg.value * 1e18) / totalStaked;
    }

    function claim() external {
        _updateRewards(msg.sender);
        uint256 reward = pendingRewards[msg.sender];
        pendingRewards[msg.sender] = 0;
        payable(msg.sender).transfer(reward);
    }
}
```

**Revenue Distribution Model**:
| Protocol Fee Split | To Treasury | To Stakers |
|-------------------|-------------|------------|
| Conservative | 70% | 30% |
| Balanced | 50% | 50% |
| Aggressive | 30% | 70% |

**Yield Analysis** (assuming 1000 ETH annual volume):
| Total Staked $HDLS | Staker Share (50%) | APY (at $0.01 HDLS) |
|--------------------|-------------------|---------------------|
| 1M tokens | 2.5 ETH | 25% |
| 10M tokens | 2.5 ETH | 2.5% |
| 100M tokens | 2.5 ETH | 0.25% |

**Economic Implications**:
- Positive: Direct value accrual from protocol success
- Positive: Creates natural buy pressure (stake for yield)
- Positive: Aligns token holders with protocol volume growth
- Positive: Relatively simple implementation (proven pattern)
- Negative: Yield compression as more stake
- Negative: Requires constant volume or yields disappoint

**Flywheel Potential**: HIGH. This is the cleanest utility mechanism because:
1. Value flows directly from protocol success to token holders
2. No friction added to core protocol operations
3. Does not compromise agent autonomy or market formation rules

**Verdict**: STRONG ACCEPT. This is the recommended MVP integration.

---

### F. Collateral/Insurance

**Concept**: Lock $HDLS as collateral for market creation; slash for bad behavior.

**Implementation**:
```solidity
uint256 public constant COLLATERAL_REQUIREMENT = 5000 * 10**18; // 5,000 HDLS per market

mapping(uint256 => uint256) public marketCollateral;
mapping(uint256 => mapping(address => uint256)) public agentCollateral;

function createMarketWithCollateral(...) external {
    // Each agent must stake collateral
    hdlsToken.transferFrom(msg.sender, address(this), COLLATERAL_REQUIREMENT);
    agentCollateral[marketId][msg.sender] = COLLATERAL_REQUIREMENT;
    // ... create market
}

function slashAgent(uint256 marketId, address agent) external onlyGovernance {
    uint256 slashed = agentCollateral[marketId][agent];
    agentCollateral[marketId][agent] = 0;
    // Send to treasury or burn
}
```

**Slashing Conditions**:
| Offense | Slash % | Arbiter |
|---------|---------|---------|
| Agent abandonment | 50% | Quorum vote |
| Malicious dump | 100% | Protocol governance |
| Inactivity >30 days | 25% | Automated |

**Economic Implications**:
- Positive: Creates skin-in-the-game for agents
- Positive: Insurance pool for affected users
- Negative: Massive barrier to entry for agents
- Negative: Agents may not have/want $HDLS
- Negative: Contradicts "agents discover agents" autonomy
- Negative: Complex slashing arbitration

**Critical Issue**: This fundamentally changes the protocol from "agents can freely form quorums" to "agents with $HDLS can form quorums." This is extractive gatekeeping.

**Agent Economics at 5,000 HDLS requirement**:
| HDLS Price | Collateral Cost | Agent Break-even Time* |
|------------|-----------------|------------------------|
| $0.01 | $50 | 1-2 weeks |
| $0.10 | $500 | 2-3 months |
| $1.00 | $5,000 | 1+ year |

*Assuming $50/week agent earnings

**Verdict**: REJECT. Creates prohibitive barrier that contradicts the thesis of autonomous agent market formation.

---

### G. Bonding Curve Integration

**Concept**: Allow buying market tokens with $HDLS at a discount to ETH.

**Implementation**:
```solidity
// Option 1: HDLS as alternative payment
function buyWithHDLS(uint256 marketId, uint256 hdlsAmount, uint256 minTokensOut) external {
    uint256 hdlsValue = _getHDLSValue(hdlsAmount); // Oracle required
    uint256 discountedValue = hdlsValue * 110 / 100; // 10% bonus
    // ... purchase tokens with discountedValue
}

// Option 2: HDLS pairs (dual curve)
// Market tokens can be bought with ETH or HDLS
// Creates HDLS liquidity at graduation alongside ETH
```

**Economic Implications**:
- Positive: Creates utility/demand for $HDLS
- Positive: Alternative on-ramp for users with $HDLS
- Negative: Requires reliable HDLS/ETH price oracle
- Negative: Significantly increases smart contract complexity
- Negative: Dual liquidity fractures market depth
- Negative: Arbitrage complexity at graduation

**Oracle Dependency Analysis**:
| Oracle Type | Risk | Cost |
|-------------|------|------|
| Chainlink (if exists) | Low | Gas per call |
| Uniswap TWAP | Medium (manipulation) | Gas + computation |
| Centralized | High | Trust assumption |
| Fixed ratio | Medium (stale) | None |

**Verdict**: REJECT. The oracle dependency and complexity are not worth the marginal utility. Keep bonding curves simple: ETH in, tokens out.

---

## 3. Execution Risk Analysis

### Risk Matrix

| Mechanism | Tech Complexity | Smart Contract Risk | Regulatory Risk | User Friction | Value Accrual |
|-----------|-----------------|---------------------|-----------------|---------------|---------------|
| A. Reduced Quorum | 3/10 | 6/10 | 3/10 | 2/10 | 4/10 |
| B. Fee Discounts | 4/10 | 4/10 | 4/10 | 3/10 | 5/10 |
| C. Priority/Boost | 3/10 | 2/10 | 3/10 | 4/10 | 3/10 |
| D. Governance | 7/10 | 7/10 | 6/10 | 5/10 | 6/10 |
| **E. Revenue Share** | **4/10** | **3/10** | **4/10** | **2/10** | **8/10** |
| F. Collateral | 6/10 | 6/10 | 5/10 | 8/10 | 5/10 |
| G. Curve Integration | 8/10 | 8/10 | 5/10 | 6/10 | 6/10 |

### Risk Definitions

**Technical Complexity** (1-10):
- 1-3: Minor code additions, well-understood patterns
- 4-6: New contracts, moderate integration work
- 7-10: Novel mechanisms, complex state management

**Smart Contract Risk** (1-10):
- 1-3: Isolated from core protocol, proven patterns
- 4-6: Touches core contracts, testable edge cases
- 7-10: Complex interactions, potential for exploits

**Regulatory Risk** (1-10):
- 1-3: Utility-focused, no securities concerns
- 4-6: Could be construed as yield/staking (gray area)
- 7-10: Explicit profit sharing, governance tokens

**User Friction** (1-10):
- 1-3: Opt-in, doesn't affect non-holders
- 4-6: Requires additional steps for some users
- 7-10: Gatekeeping, mandatory for participation

**Value Accrual** (1-10):
- 1-3: Weak or indirect link to protocol success
- 4-6: Moderate correlation
- 7-10: Direct, strong correlation with protocol metrics

### Risk-Adjusted Ranking

| Mechanism | Avg Risk | Value Accrual | Net Score |
|-----------|----------|---------------|-----------|
| E. Revenue Share | 3.25 | 8 | **+4.75** |
| B. Fee Discounts | 3.75 | 5 | +1.25 |
| C. Priority/Boost | 3.0 | 3 | 0 |
| D. Governance | 6.25 | 6 | -0.25 |
| A. Reduced Quorum | 3.5 | 4 | +0.5 |
| F. Collateral | 6.25 | 5 | -1.25 |
| G. Curve Integration | 6.75 | 6 | -0.75 |

---

## 4. Flywheel Dynamics Model

### Theoretical Flywheel

```
                    +------------------+
                    |  Protocol        |
                    |  Success         |
                    | (Volume + Markets)|
                    +--------+---------+
                             |
              (0.5% of volume)
                             v
                    +--------+---------+
                    |  Fee Revenue     |
                    |  (ETH)           |
                    +--------+---------+
                             |
              (50% to stakers)
                             v
                    +--------+---------+
                    |  Staking Rewards |
                    |  (ETH yield)     |
                    +--------+---------+
                             |
              (APY attracts capital)
                             v
                    +--------+---------+
                    |  $HDLS Demand    |
                    |  (Buy pressure)  |
                    +--------+---------+
                             |
              (Price appreciation)
                             v
                    +--------+---------+
                    |  Price Increase  |
                    +--------+---------+
                             |
              (More agents want HDLS)
                             v
                    +--------+---------+
                    |  Agent Interest  |
                    +--------+---------+
                             |
              (More markets created)
                             v
                    +------------------+
                    |  Protocol        |
                    |  Success         |<----- Loop closes
                    +------------------+
```

### Where the Flywheel Could Break

**Break Point 1: Volume Stagnation**
```
If: Trading volume < 500 ETH/year
Then: Staking yields < 1%
Result: No incentive to stake, flywheel stops
```

**Break Point 2: Over-Staking**
```
If: 90% of HDLS supply staked
Then: APY compresses to <1%
Result: Diminishing returns, sellers emerge
```

**Break Point 3: Price Crash**
```
If: HDLS price drops 80%
Then: Yield in dollar terms drops 80%
Result: Stakers unstake, selling pressure, death spiral
```

**Break Point 4: Protocol Failure**
```
If: <5 markets, <$10/week agent earnings
Then: Agents leave, volume drops
Result: No fees, no yield, flywheel never starts
```

**Break Point 5: Misaligned Incentives**
```
If: HDLS holders vote against agent interests (governance)
Then: Agents exit protocol
Result: Markets collapse, token value goes to zero
```

### Flywheel Health Indicators

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Monthly Volume | >100 ETH | 50-100 ETH | <50 ETH |
| Staking APY | >10% | 5-10% | <5% |
| Stake Ratio | 30-60% | 10-30% or >80% | <10% or >90% |
| HDLS Price Stability | +/-10% monthly | +/-25% monthly | >50% swings |
| Active Markets | >20 | 10-20 | <10 |

### Quantitative Flywheel Model

**Assumptions**:
- 100 ETH monthly trading volume (baseline)
- 50% of fees to stakers
- 10M HDLS total supply
- 3M HDLS staked (30%)
- HDLS price: $0.10

**Monthly Economics**:
```
Trading Volume:     100 ETH
Protocol Fees:      0.5 ETH (0.5%)
To Stakers:         0.25 ETH (50%)
ETH Price:          $2,500
Staker Revenue:     $625/month

Staked HDLS Value:  3M x $0.10 = $300,000
Monthly Yield:      $625 / $300,000 = 0.21%
Annualized APY:     2.5%
```

**For 20% APY (attractive yield)**:
```
Required monthly staker revenue: $5,000
Required monthly volume: $5,000 / $2,500 * 100 ETH / 0.25 ETH = 800 ETH
```

**Conclusion**: Flywheel requires **800+ ETH monthly volume** for attractive yields at current assumptions. This is achievable but requires 80+ active, trading markets.

---

## 5. Honest Assessment

### Does Forcing $HDLS Integration Add Genuine Value or Just Friction?

**Honest Answer**: It depends entirely on the mechanism chosen.

| Mechanism | Value Add | Friction Add | Net |
|-----------|-----------|--------------|-----|
| Revenue Sharing | High (direct ETH yield) | Low (opt-in staking) | **Positive** |
| Fee Discounts | Medium (savings) | Medium (must hold token) | Neutral |
| Governance | Medium (control) | Medium (complexity) | Neutral |
| Collateral | Low (insurance) | High (barrier) | **Negative** |
| Boosting | Low (visibility) | Medium (pay-to-play) | **Negative** |
| Reduced Quorum | Low (convenience) | Medium (security trade) | **Negative** |
| Curve Integration | Medium (flexibility) | High (complexity) | **Negative** |

### Would Agents Naturally Want $HDLS or Is This Extractive?

**Extractive Mechanisms** (agents forced to acquire token):
- Collateral requirements
- Reduced quorum requirements
- Any mechanism that gates market creation

**Non-Extractive Mechanisms** (agents choose to participate):
- Revenue sharing (stake if you want yield)
- Fee discounts (hold if you trade frequently)
- Governance (participate if you care about protocol direction)

**Honest Assessment**: Agents will only naturally want $HDLS if holding it provides clear, measurable benefits without gatekeeping their core activity (forming markets). Revenue sharing is the only mechanism that passes this test cleanly.

### Is This "Token for Token's Sake" or Genuine Utility?

**Token for Token's Sake**:
- Boosting/priority (artificial scarcity)
- Reduced quorum (arbitrary privilege)
- Collateral (manufactured requirement)

**Genuine Utility**:
- Revenue sharing (real cash flows)
- Governance (real decision power)
- Fee discounts (real savings)

**Honest Assessment**: Revenue sharing is the only mechanism where token value directly correlates with protocol success without artificial constructs. Everything else feels like "we need to make the token useful" rather than "the token is naturally useful."

### What's the MVP Integration vs Over-Engineering?

**MVP (Recommended)**:
```
HDLSStaking.sol
- stake()
- unstake()
- distributeRevenue()
- claim()
~150 lines of battle-tested staking code
```

**Over-Engineering**:
- Multi-mechanism integration
- Complex governance
- Oracle dependencies
- Dual-currency bonding curves

**Honest Assessment**: Start with staking only. Add other mechanisms only if protocol achieves escape velocity (20+ markets, 500+ ETH monthly volume).

---

## 6. Recommendation

### Verdict: CONDITIONAL GO

**Condition**: Protocol must achieve minimum viability metrics before integration is valuable.

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Active Markets | >10 | Enough diversity for volume |
| Monthly Volume | >100 ETH | Minimum for meaningful yield |
| Agent Earnings | >$50/week avg | Proves thesis works |

**If thresholds met**: Proceed with Revenue Sharing (Mechanism E)

**If thresholds not met**: Focus on core protocol adoption; token integration is premature optimization.

### Why Revenue Sharing (Mechanism E)?

1. **Lowest risk**: Proven staking patterns, isolated from core contracts
2. **Highest value accrual**: Direct correlation with protocol success
3. **Non-extractive**: Doesn't gate agent activity
4. **Simple**: ~150 lines of code, no oracles, no complex interactions
5. **Aligned**: Token holders want volume; volume requires successful markets; successful markets require happy agents

### What NOT to Implement

| Mechanism | Reason to Avoid |
|-----------|-----------------|
| Reduced Quorum | Compromises security |
| Collateral | Gatekeeps agents |
| Curve Integration | Oracle dependency, complexity |
| Boosting | Contradicts meritocracy thesis |

### What to Consider Later (Phase 2+)

| Mechanism | Condition |
|-----------|-----------|
| Fee Discounts | If volume >1000 ETH/month (whale traders) |
| Governance | If >1000 HDLS holders (decentralization) |

---

## 7. Implementation Roadmap

### Prerequisites

Before any token integration:
1. [ ] Verify $HDLS contract is audited/secure
2. [ ] Confirm token distribution (circulating supply, whale concentration)
3. [ ] Establish baseline protocol metrics (volume, markets, agent earnings)
4. [ ] Legal review of staking mechanism (securities implications)

### Phase 1: MVP Staking (Week 1-2)

**Deliverables**:
- `HDLSStaking.sol` contract
- Integration with `BondingCurveFactory.sol` fee distribution
- Basic staking UI

**Contract Architecture**:
```
BondingCurveFactory.sol
    |
    | (fee split on buy/sell)
    v
+---+---+
|       |
v       v
Treasury    HDLSStaking.sol
(50%)       (50%)
            |
            | (pro-rata distribution)
            v
         Stakers
```

**Estimated Gas Costs**:
| Operation | Gas | Cost @ 10 gwei |
|-----------|-----|----------------|
| stake() | ~80,000 | ~$0.40 |
| unstake() | ~60,000 | ~$0.30 |
| claim() | ~50,000 | ~$0.25 |
| distributeRevenue() | ~30,000 | ~$0.15 |

**Security Considerations**:
- Use OpenZeppelin ReentrancyGuard
- Implement timelock on unstaking (7 days)
- Cap maximum stake per address (optional)
- Emergency pause functionality

### Phase 2: Monitoring & Optimization (Week 3-4)

**Metrics to Track**:
- Total staked
- Staking APY
- Stake/unstake velocity
- Yield claim frequency

**Adjustments**:
- Fee split ratio (if yields too high/low)
- Unstaking timelock (if speculation concerns)

### Phase 3: Expansion (Month 2+)

**Only if Phase 1 successful**:
- Fee discount tiers for large stakers
- Governance proposals for fee parameters
- Agent-specific staking incentives

### Decision Gates

| Gate | Criteria | Action if Failed |
|------|----------|------------------|
| G1 (Week 4) | >$1000 staked | Pause, reassess |
| G2 (Month 2) | >5% APY achieved | Adjust fee split |
| G3 (Month 3) | >10 unique stakers | Marketing push |

---

## Appendix A: Smart Contract Specification

### HDLSStaking.sol Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IHDLSStaking {
    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RevenueDistributed(uint256 amount);

    // Core functions
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function claim() external;
    function distributeRevenue() external payable;

    // View functions
    function stakedBalance(address user) external view returns (uint256);
    function pendingRewards(address user) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function stakingAPY() external view returns (uint256);
}
```

### Integration Point in BondingCurveFactory.sol

```solidity
// In buy() function, after fee calculation:
if (fee > 0) {
    uint256 toTreasury = fee / 2;
    uint256 toStakers = fee - toTreasury;

    (bool treasurySuccess, ) = protocolTreasury.call{value: toTreasury}("");
    require(treasurySuccess, "Treasury transfer failed");

    if (address(hdlsStaking) != address(0) && toStakers > 0) {
        IHDLSStaking(hdlsStaking).distributeRevenue{value: toStakers}();
    }
}
```

---

## Appendix B: Economic Sensitivity Analysis

### Yield vs Volume Table

| Monthly Volume | Fee Revenue | Staker Share (50%) | APY (3M staked) |
|----------------|-------------|-------------------|-----------------|
| 50 ETH | 0.25 ETH | 0.125 ETH | 5% |
| 100 ETH | 0.5 ETH | 0.25 ETH | 10% |
| 200 ETH | 1 ETH | 0.5 ETH | 20% |
| 500 ETH | 2.5 ETH | 1.25 ETH | 50% |
| 1000 ETH | 5 ETH | 2.5 ETH | 100% |

*Assumes 3M HDLS staked at $0.10, ETH at $2,500*

### Break-Even Analysis

For staking to be rational, APY must exceed opportunity cost (~5% risk-free + 10% risk premium = 15%).

**Minimum volume for 15% APY**:
```
Required monthly staker revenue: 3M * $0.10 * 15% / 12 = $3,750
In ETH: $3,750 / $2,500 = 1.5 ETH
Monthly volume needed: 1.5 ETH / 0.25% = 600 ETH
```

**Conclusion**: Protocol needs 600+ ETH monthly volume for staking to be economically attractive.

---

## Appendix C: Risk Mitigation Checklist

### Smart Contract Risks

- [ ] External audit before mainnet deployment
- [ ] Formal verification of staking math
- [ ] Emergency pause mechanism
- [ ] Upgrade path via proxy pattern
- [ ] Timelock on admin functions

### Economic Risks

- [ ] Model yield at various volume scenarios
- [ ] Stress test at 90% unstake scenario
- [ ] Plan for zero-volume periods
- [ ] Define yield floor/ceiling bounds

### Regulatory Risks

- [ ] Legal opinion on staking mechanism
- [ ] Avoid "investment contract" language
- [ ] Document utility-first narrative
- [ ] Geo-blocking if necessary

### Operational Risks

- [ ] Monitoring dashboards
- [ ] Alert thresholds for anomalies
- [ ] Runbook for common issues
- [ ] Communication plan for incidents

---

*Document Version: 1.0*
*Analysis Date: February 2026*
*Author: Cost Analysis Agent*

*"Value accrual should follow protocol success, not precede it."*
