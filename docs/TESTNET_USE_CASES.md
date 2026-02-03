# Headless Markets Protocol - Testnet Use Cases

**Network:** Base Sepolia (Chain ID: 84532)
**Last Updated:** February 3, 2026
**Status:** Beta Testing

## Deployed Contracts

| Contract | Address | Verified |
|----------|---------|----------|
| BondingCurveFactory | [`0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1`](https://sepolia.basescan.org/address/0x2aA29fe97aeB0a079B241fd80BFAf64dc2273dF1#code) | Yes |
| QuorumGovernance | [`0x0EC0833743e04Ca57C0dA0EA4eCb625fb7abb92B`](https://sepolia.basescan.org/address/0x0EC0833743e04Ca57C0dA0EA4eCb625fb7abb92B#code) | Yes |

---

## Use Case 1: Creating an Agent Market

**Scenario:** A quorum of 3-5 AI agents wants to form a collective and launch a tokenized market.

### Prerequisites
- 3-10 agent wallet addresses
- Contribution weights that sum to 100
- Market thesis describing the collective's purpose

### Steps

```solidity
// 1. Define quorum agents and their weights
address[] memory agents = [agent1, agent2, agent3];
uint256[] memory weights = [34, 33, 33]; // Must sum to 100

// 2. Create the market
uint256 marketId = factory.createMarket(
    agents,
    weights,
    "Collective Token",      // Token name
    "COLL",                  // Token symbol
    "AI art collective focused on generative landscapes"  // Thesis
);
```

### Token Distribution
Upon market creation, tokens are automatically distributed:
- **30%** to founding quorum (split by weights)
- **60%** bonded to the curve (available for purchase)
- **10%** to protocol treasury

### Expected Result
- New ERC20 token deployed
- Quorum agents receive their allocation
- Market is active and ready for trading
- `MarketCreated` event emitted

### Validation
- Tested on Base Sepolia: [TX 0x34baaeaaa...](https://sepolia.basescan.org/tx/0x34baaeaaa51bb43df53894ee7fbea70b4856507d37e0eae114aa76cab0297512)
- Gas used: ~926,130

---

## Use Case 2: Buying Tokens from Bonding Curve

**Scenario:** A human investor wants to buy tokens from an active market.

### Prerequisites
- Active market ID
- ETH for purchase (minimum 0.001 ETH)
- Slippage tolerance calculated

### Steps

```solidity
// 1. Calculate expected tokens
uint256 expectedTokens = factory.calculatePurchaseReturn(marketId, ethAmount);

// 2. Set slippage tolerance (e.g., 5%)
uint256 minTokens = expectedTokens * 95 / 100;

// 3. Execute purchase
factory.buy{value: ethAmount}(marketId, minTokens);
```

### Bonding Curve Mechanics
Price follows a linear bonding curve:
```
Price = BasePrice + (Slope × TokensSold)
```

Default parameters:
- Base Price: 0.0001 ETH
- Slope: 0.00000001 ETH per token
- Target Raise: 10 ETH (triggers graduation)

### Expected Result
- Tokens transferred to buyer
- 0.5% protocol fee collected
- Price increases for next buyer
- `TokensPurchased` event emitted

### Validation
- Tested on Base Sepolia: [TX 0x519ce880...](https://sepolia.basescan.org/tx/0x519ce8803e189ab41af5d2be6eb4b5534df17d85dbf71b1df961b8421f397475)

---

## Use Case 3: Selling Tokens Back to Curve

**Scenario:** A token holder wants to sell their tokens back for ETH.

### Prerequisites
- Tokens purchased from the bonding curve
- Token approval for factory contract
- Slippage tolerance calculated

### Steps

```solidity
// 1. Approve factory to spend tokens
token.approve(factoryAddress, tokenAmount);

// 2. Calculate expected ETH
uint256 expectedEth = factory.calculateSaleReturn(marketId, tokenAmount);

// 3. Set slippage tolerance
uint256 minEth = expectedEth * 95 / 100;

// 4. Execute sale
factory.sell(marketId, tokenAmount, minEth);
```

### Important Notes
- Only tokens that came from the bonding curve can be sold back
- Quorum allocation tokens cannot be sold to the curve
- Price decreases after sell (bonding curve mechanics)

### Expected Result
- ETH transferred to seller (minus 0.5% fee)
- Tokens returned to factory
- `TokensSold` event emitted

### Validation
- Tested on Base Sepolia: [TX 0x55c15214...](https://sepolia.basescan.org/tx/0x55c15214a4867dc37de36c4f3912328fa7e06ccbe4458e32375be82c50a0d97d)

---

## Use Case 4: Slippage Protection (MEV Defense)

**Scenario:** Protect against front-running and sandwich attacks.

### The Problem
Without slippage protection, MEV bots can:
1. See your pending buy transaction
2. Front-run with their own buy (raising the price)
3. Let your transaction execute at a worse price
4. Back-run by selling (profiting from the price difference)

### The Solution
Both `buy()` and `sell()` include slippage parameters:

```solidity
// Buy with slippage protection
function buy(uint256 marketId, uint256 minTokensOut) external payable;

// Sell with slippage protection
function sell(uint256 marketId, uint256 tokenAmount, uint256 minEthOut) external;
```

### Recommended Slippage
- Low volatility: 1-2%
- Normal conditions: 3-5%
- High volatility: 5-10%

### Validation
- Slippage exceeded correctly reverts transaction
- Tested: Demanding 2x expected tokens → Transaction reverts with "Slippage exceeded"

---

## Use Case 5: Market Graduation

**Scenario:** A market reaches its target raise and graduates to Uniswap.

### Trigger Condition
When `currentRaised >= targetRaise` (default: 10 ETH), the market automatically graduates.

### What Happens
1. Market is marked as `graduated = true`
2. Trading on bonding curve stops
3. Liquidity is deployed to Uniswap V2 (future implementation)
4. `MarketGraduated` event emitted

### Current Status
- Graduation trigger: Implemented
- Uniswap integration: Planned for mainnet

---

## Use Case 6: Governance Proposals

**Scenario:** Quorum agents want to vote on treasury spend or membership changes.

### Proposal Types
- `AddAgent` - Add new agent to quorum
- `RemoveAgent` - Remove agent from quorum
- `TreasurySpend` - Spend from market treasury
- `AdjustFees` - Modify fee parameters
- `ForceGraduate` - Graduate market early

### Voting Parameters
- Voting Period: 3 days (259,200 seconds)
- Quorum Threshold: 66.66% (2/3 majority)
- Weight-based voting

### Validation
- Governance linked to Factory: Confirmed
- Voting period: 3 days
- [View Contract](https://sepolia.basescan.org/address/0x0EC0833743e04Ca57C0dA0EA4eCb625fb7abb92B#code)

---

## Use Case 7: Emergency Pause (Admin Only)

**Scenario:** Critical security issue requires pausing a market.

### Standard Pause (24-hour Timelock)
```solidity
// 1. Request pause (starts 24-hour timer)
factory.requestPause(marketId);

// 2. After 24 hours, execute pause
factory.executePause(marketId);

// 3. Unpause when issue resolved
factory.unpause(marketId);
```

### Emergency Pause (Immediate)
For critical security issues only:
```solidity
factory.emergencyPause(marketId);
```

### Validation
- Timelock prevents hasty decisions
- Users have 24 hours to exit before regular pause
- Emergency pause available for true emergencies

---

## Edge Cases Tested

| Test | Expected | Result |
|------|----------|--------|
| Quorum < 3 agents | Revert | PASS |
| Quorum > 10 agents | Revert | PASS |
| Weights don't sum to 100 | Revert | PASS |
| Purchase below 0.001 ETH | Revert | PASS |
| Slippage exceeded (buy) | Revert | PASS |
| Slippage exceeded (sell) | Revert | PASS |
| Buy from non-existent market | Revert | PASS |
| Sell more than curve liquidity | Revert | PASS |

---

## Test Markets Created

### Market #0 (First Test)
- Token: `0x...` (first deployment test)
- Status: Active

### Market #1 (Battle Test)
- Token: [`0x6f9B280F756ac2a35CfC60C5fbc34A2Cec10efBF`](https://sepolia.basescan.org/address/0x6f9B280F756ac2a35CfC60C5fbc34A2Cec10efBF)
- Thesis: "A test market for battle testing the protocol on testnet"
- Current Raised: ~0.03 ETH
- Status: Active

### Market #2 (Extended Test)
- Token: [`0x1c02Eb3Ae7750FBdBe131910E530ED6A1Db39605`](https://sepolia.basescan.org/address/0x1c02Eb3Ae7750FBdBe131910E530ED6A1Db39605)
- Thesis: "A test market for battle testing the protocol on testnet"
- Current Raised: ~0.07 ETH
- Status: Active

---

## Running Your Own Tests

### Prerequisites
```bash
cd contracts
npm install
```

### Configure Environment
```bash
cp .env.example .env
# Add your private key and Basescan API key
```

### Run Battle Test
```bash
npx hardhat run scripts/testnet-battle-test.ts --network base-sepolia
```

### Results
Test results are saved to `contracts/test-results/` as JSON files.

---

## Security Considerations

### Implemented Protections
1. **Slippage Protection** - Prevents MEV attacks
2. **Minimum Purchase** - Prevents dust attacks
3. **Reentrancy Guard** - Prevents reentrancy attacks
4. **Pause Timelock** - 24-hour delay for non-emergency pauses
5. **Weight Validation** - Ensures fair quorum distribution

### Audit Status
- Internal security review: Complete
- Professional audit: Scheduled for mainnet

---

## Feedback & Issues

Found a bug or have suggestions?

1. Create an issue on GitHub
2. Include transaction hash if applicable
3. Describe expected vs actual behavior

**Repository:** [drewmedearis/headless_mrkts](https://github.com/drewmedearis/headless_mrkts)
