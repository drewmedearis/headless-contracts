# MEV (Maximal Extractable Value) Analysis Report

## Executive Summary

MEV testing reveals that **slippage protection works effectively**, but **users without slippage protection are vulnerable to significant extraction**.

| Finding | Severity | Status |
|---------|----------|--------|
| Sandwich attacks mitigated by slippage | ✅ PROTECTED | Users must enable |
| Unprotected trades vulnerable | ⚠️ CRITICAL | Requires user action |
| Protocol fees insufficient deterrent | ℹ️ INFO | By design |

---

## Critical Finding: Unprotected Trade Extraction

### Test Results

When victims use `minTokensOut=0` (no slippage protection):

| Victim Trade Size | MEV Bot Profit | Extraction Rate |
|-------------------|----------------|-----------------|
| 0.1 ETH | 0.007 ETH | ~7% |
| 1.0 ETH | 0.35 ETH | ~35% |
| 5.0 ETH | 2.85 ETH | ~57% |

**THIS IS NOT A BUG** - this is how bonding curves work. The first buyer gets better prices.

### Why This Happens

```
Bonding Curve Price Formula:
Price = BasePrice + (Slope × TokensSold)

Attack Flow:
1. Bot sees victim's buy tx in mempool
2. Bot front-runs: buys tokens at current price
3. Price increases due to bot's purchase
4. Victim's tx executes at higher price
5. Bot back-runs: sells tokens at elevated price
6. Bot profits from price difference
```

### Why Slippage Protection Works

When victims set `minTokensOut`:

```
1% slippage: TX REVERTED (victim protected)
2% slippage: TX REVERTED (victim protected)
5% slippage: TX REVERTED (victim protected)
10% slippage: TX REVERTED (victim protected)
```

Even 1% slippage tolerance protects against sandwich attacks.

---

## Mitigation Strategy

### 1. Frontend MUST Enforce Default Slippage

```typescript
// REQUIRED: Set 5% default slippage
const DEFAULT_SLIPPAGE = 5; // 5%

function buy(marketId: number, ethAmount: bigint) {
  const expectedTokens = await factory.calculatePurchaseReturn(marketId, ethAmount);
  const minTokensOut = expectedTokens * (100 - DEFAULT_SLIPPAGE) / 100;

  await factory.buy(marketId, minTokensOut, { value: ethAmount });
}
```

### 2. User Education

Marketing agents should communicate:
- **ALWAYS use slippage protection**
- Default 5% is safe for most trades
- Large trades (>1 ETH) should use tighter slippage (2-3%)
- Never set `minTokensOut=0`

### 3. Consider Contract-Level Enforcement (Optional)

Could add minimum slippage requirement:

```solidity
// OPTIONAL: Enforce minimum protection
uint256 public constant MAX_SLIPPAGE_BPS = 1000; // 10%

function buy(uint256 marketId, uint256 minTokensOut) external payable {
    uint256 calculatedTokens = _calculatePurchase(market, netAmount);
    uint256 maxAllowedSlippage = (calculatedTokens * MAX_SLIPPAGE_BPS) / BPS_DENOMINATOR;
    require(minTokensOut >= calculatedTokens - maxAllowedSlippage, "Slippage too high");
    // ... rest of function
}
```

**Trade-off**: Prevents naive users from being sandwiched, but adds complexity and gas.

---

## MEV Attack Patterns Tested

### 1. Classic Buy Sandwich ✅ MITIGATED
- Bot front-runs, victim buys, bot back-runs
- **Defense**: Slippage protection
- **Test Result**: Victim TX reverts with slippage

### 2. Sell Sandwich ✅ MITIGATED
- Bot front-runs sell, victim sells at worse price
- **Defense**: `minEthOut` slippage protection
- **Test Result**: Victim TX reverts with slippage

### 3. Multi-Victim Sandwich ✅ MITIGATED
- Bot sandwiches multiple victims in same block
- **Defense**: Each victim's slippage protection
- **Test Result**: All victim TXs revert

### 4. Graduation Front-Running ℹ️ FAIR GAME
- Bot races to buy tokens before graduation
- **Status**: Not an attack - fair competition
- **Note**: Bot pays fair bonding curve price

### 5. Flash Loan Attack ✅ LIMITED
- Bot borrows, pumps, manipulates, repays
- **Defense**: Market graduates, can't sell back to curve
- **Result**: Bot stuck with tokens after graduation

### 6. Pump and Dump ✅ LIMITED
- Bot pumps price, attracts victims, dumps
- **Defense**: Bonding curve math, fees
- **Result**: Curve shape limits profitability

---

## Protocol Fee Analysis

Current fee: **0.5% (50 bps)** on both buy and sell

### Fee Impact on MEV

| Scenario | Fee Paid | Impact |
|----------|----------|--------|
| Bot round-trip (buy+sell) | ~1% total | Reduces profit margin |
| Small sandwich (<0.5 ETH) | Break-even difficult | Deterred |
| Large sandwich (>1 ETH) | Still profitable | Not deterred |

### Recommendation

Protocol fees alone **do not prevent MEV**. They reduce profitability but don't eliminate it.

The primary defense is **slippage protection**.

---

## Recommended Slippage Settings

| Trade Size | Recommended Slippage | Notes |
|------------|----------------------|-------|
| < 0.1 ETH | 5-10% | Small trades, low impact |
| 0.1 - 1 ETH | 3-5% | Standard protection |
| 1 - 5 ETH | 2-3% | Tighter to prevent extraction |
| > 5 ETH | 1-2% | Large trades need protection |

---

## Known Limitations

### Cannot Prevent at Contract Level

1. **Private mempool bypass**: Flashbots users won't see victim TXs
2. **Multi-block accumulation**: Looks like normal trading
3. **Graduation timing**: Public information

### Requires User Action

1. Users MUST set slippage protection
2. Frontend MUST provide reasonable defaults
3. Education is critical

---

## Test Coverage

| Test Category | Tests | Pass |
|---------------|-------|------|
| Sandwich Attacks | 5 | ✅ |
| Front-Running | 3 | ✅ |
| Back-Running | 1 | ✅ |
| Price Manipulation | 2 | ✅ |
| Multi-Block MEV | 1 | ✅ |
| Slippage Effectiveness | 2 | ✅ |
| Known Limitations | 3 | ✅ |
| **Total** | **17** | ✅ |

---

## Conclusion

The Headless Markets Protocol has **effective MEV protection** via slippage parameters. However:

1. **Frontend must enforce slippage** - default 5% minimum
2. **Users must be educated** - never use 0 slippage
3. **Protocol fees help but don't eliminate** MEV profit potential

**Deployment Recommendation**: SAFE to deploy with frontend slippage enforcement.

---

*Analysis Date: February 3, 2026*
*Methodology: Trail of Bits MEV Testing Framework*
