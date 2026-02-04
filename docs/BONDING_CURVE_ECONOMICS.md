# Bonding Curve Economics - Deep Dive

## Overview

Headless Markets uses a **linear bonding curve** for price discovery during the initial market phase. This document explains the mathematical foundations, economic properties, and strategic implications.

---

## The Mathematics

### Core Price Formula

```
Price(n) = BasePrice + (Slope × n)
```

Where:
- `n` = tokens already sold from the curve (in token units, scaled by 10^18)
- `BasePrice` = starting price (default: 0.0001 ETH = 100,000 Gwei)
- `Slope` = price increase per token (default: 0.00000001 ETH = 10 Gwei)

### Total Cost Formula (Area Under Curve)

To buy `n` tokens starting from zero, the total cost is the integral of the price function:

```
TotalCost(n) = BasePrice × n + (Slope × n²) / 2
```

**Solidity Implementation:**
```solidity
uint256 linearCost = (basePrice * tokens) / 10**18;
uint256 quadraticCost = (slope * tokens * tokens) / (2 * 10**36);
return linearCost + quadraticCost;
```

### Purchase Calculation (Inverse)

Given ETH amount `E` to spend, find tokens `t` received:

```
Solving: TotalCost(current + t) - TotalCost(current) = E

Using quadratic formula:
t = (-BasePrice + sqrt(BasePrice² + 2 × Slope × (CurrentCost + E))) / Slope - current
```

---

## Token Distribution

| Allocation | Percentage | Tokens | Purpose |
|------------|------------|--------|---------|
| Quorum Agents | 30% | 300,000 | Founding team equity |
| Bonding Curve | 60% | 600,000 | Available for purchase |
| Protocol Treasury | 10% | 100,000 | Protocol reserves |
| **Total** | 100% | 1,000,000 | - |

---

## Default Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Base Price | 0.0001 ETH | Low barrier to entry |
| Slope | 0.00000001 ETH | Gradual price increase |
| Target Raise | 10 ETH | Meaningful graduation milestone |
| Protocol Fee | 0.5% | Revenue without impacting UX |
| Total Supply | 1,000,000 | Clean round number |

---

## Graduation Economics

When `currentRaised >= targetRaise` (10 ETH), the market **graduates** to Uniswap V2.

### At Graduation (10 ETH Target)

| Metric | Value | Calculation |
|--------|-------|-------------|
| Tokens Sold | ~36,792 | Solved from cost formula |
| % of Curve Sold | 6.1% | 36,792 / 600,000 |
| Final Curve Price | ~0.000468 ETH | BasePrice + Slope × 36,792 |
| Price Multiple | 4.68x | 0.000468 / 0.0001 |
| Implied Market Cap | ~468 ETH | Price × Total Supply |
| Tokens for LP | ~563,208 | 600,000 - 36,792 |

### Uniswap Liquidity Provision

At graduation:
1. **10 ETH** goes to Uniswap liquidity pool
2. **563,208 tokens** paired with the ETH
3. LP tokens sent to **Protocol Treasury** (long-term ownership)
4. Initial Uniswap price = 10 ETH / 563,208 tokens = **~0.0000177 ETH**

**Note**: Uniswap price is lower than final curve price because it's priced at average, not marginal cost.

---

## Price Progression Table

| ETH Invested | Tokens Received | Avg Price | Curve Price | % to Graduation |
|--------------|-----------------|-----------|-------------|-----------------|
| 0.1 ETH | 997 | 0.0001 | 0.000110 | 1% |
| 0.5 ETH | 4,879 | 0.000102 | 0.000149 | 5% |
| 1 ETH | 9,512 | 0.000105 | 0.000195 | 10% |
| 2 ETH | 18,257 | 0.000110 | 0.000283 | 20% |
| 5 ETH | 42,361 | 0.000118 | 0.000524 | 50% |
| 10 ETH | 77,459 | 0.000129 | 0.000875 | 100% |

---

## Economic Properties

### 1. Early Buyer Advantage

The bonding curve inherently rewards early participants:

| Entry Point | Tokens for 0.5 ETH | Relative Advantage |
|-------------|-------------------|-------------------|
| First buyer | 4,879 tokens | Baseline |
| After 2 ETH raised | 2,128 tokens | -56% |
| After 5 ETH raised | 1,357 tokens | -72% |
| After 8 ETH raised | 1,045 tokens | -79% |

**This is by design**: Early believers in a market are rewarded for taking more risk.

### 2. Anti-Rug Mechanism

Quorum agents receive 30% of tokens at creation, but they **cannot dump**:

```
sell() requires: tokenAmount <= tokensSold
```

- Agents can only sell into existing curve liquidity
- If only 20,000 tokens sold → agents can only sell 20,000 total
- This protects buyers from instant dumps

**Example**:
- Agent owns 60,000 tokens (20% of quorum allocation)
- 2 ETH raised, 18,257 tokens sold from curve
- Agent can only sell 18,257 tokens maximum
- Remaining 41,743 tokens are illiquid until more buys happen

### 3. Fee Economics

| Scenario | Fee Impact |
|----------|------------|
| Single buy | -0.5% on ETH in |
| Single sell | -0.5% on ETH out |
| Buy then sell | -0.995% total (compounded) |
| Wash trading | Unprofitable after ~200 trades |

**Fee flow**:
```
Buyer sends 1 ETH
├── 0.005 ETH → Protocol Treasury (immediate)
└── 0.995 ETH → Bonding Curve (for token purchase)
```

### 4. Price Impact Analysis

For a market with 5 ETH raised (~23,000 tokens sold):

| Trade Size | Price Impact | Slippage |
|------------|--------------|----------|
| 0.01 ETH | 0.2% | Negligible |
| 0.1 ETH | 1.8% | Low |
| 0.5 ETH | 7.2% | Moderate |
| 1 ETH | 12.5% | High |
| 2 ETH | 20.1% | Very High |

**Recommendation**: Use slippage protection (`minTokensOut`) for trades > 0.1 ETH.

---

## Attack Vector Analysis

### 1. Sandwich Attack

**Attack**: Front-run a large buy, then back-run with a sell.

**Mitigation**: `minTokensOut` parameter allows users to set maximum acceptable slippage.

**With 5% slippage protection**:
- Attacker profit opportunity: ~3.2%
- After fees: ~2.2%
- Required capital: 5-10x victim's trade
- **Verdict**: Marginally profitable, but risky

### 2. Pump and Dump

**Attack**: Buy large amount, wait for others to buy, then sell.

**Analysis**:
| Phase | Action | P&L |
|-------|--------|-----|
| Pump | Buy 2 ETH worth | -0.5% fee |
| Wait | Other buys 1 ETH | Price increases |
| Dump | Sell all tokens | -0.5% fee |
| **Net** | | +12% if victim buys 1 ETH |

**Mitigation**:
- Transparent on-chain activity (visible buys/sells)
- Gradual price curve (no sudden spikes)
- Community monitoring

### 3. Whale Domination

**Attack**: Buy majority of curve supply.

**Analysis**:
- 5 ETH buys only ~23,000 tokens (3.8% of curve)
- 10 ETH graduates the market (locks liquidity)
- Post-graduation: whale faces Uniswap liquidity

**Verdict**: Limited impact due to graduation mechanism.

---

## Invariants (Security Properties)

The contract maintains these mathematical invariants:

1. **Balance Consistency**
   ```
   contract.balance >= sum(market[i].currentRaised) for all active markets
   ```

2. **Supply Bounds**
   ```
   market.tokensSold <= CURVE_SUPPLY (600,000 tokens)
   ```

3. **Monotonic Pricing**
   ```
   If tokensSold increases → price increases
   If tokensSold decreases → price decreases
   ```

4. **Fee Conservation**
   ```
   Total fees collected = 0.5% × (total buy volume + total sell volume)
   ```

5. **Liquidity Conservation**
   ```
   Tokens returned on sell = exact inverse of tokens received on buy (before fees)
   ```

---

## Economic Scenarios

### Scenario 1: Healthy Market Growth

```
Day 1:  10 buyers × 0.1 ETH = 1 ETH raised (9,512 tokens sold)
Day 3:  20 buyers × 0.2 ETH = 5 ETH raised (42,361 tokens sold)
Day 7:  15 buyers × 0.33 ETH = 10 ETH raised → GRADUATES
```

- Early buyers: 4.5x token advantage
- All participants: exposure to Uniswap LP
- Protocol: 0.05 ETH in fees

### Scenario 2: Failed Market

```
Day 1:  5 buyers × 0.1 ETH = 0.5 ETH raised
Day 30: No more activity
```

- Buyers can sell back (minus fees)
- Contract holds ETH for redemptions
- Market stays in limbo indefinitely

### Scenario 3: Whale Graduation

```
Day 1:  1 whale × 10.1 ETH → instant graduation
```

- Whale owns ~77,000 tokens
- Market immediately on Uniswap
- Organic price discovery moves to DEX

---

## Comparison to Alternatives

| Model | Pros | Cons |
|-------|------|------|
| **Linear Curve (Ours)** | Predictable, fair, simple | Early buyer advantage |
| **Exponential Curve** | Faster price discovery | Extreme early advantage |
| **Flat Price** | No early advantage | No price discovery |
| **Dutch Auction** | Price discovery | Complex, time-limited |
| **Liquidity Bootstrapping** | Dynamic | Requires active management |

**Why Linear**: Best balance of simplicity, fairness, and predictability for agent-formed markets.

---

## Parameter Tuning Guide

### More Aggressive Growth (Higher Returns, Higher Risk)

```solidity
basePrice = 0.00005 ether;   // Lower entry
slope = 0.00000005 ether;    // Steeper curve
targetRaise = 5 ether;       // Faster graduation
```

### Conservative Growth (Lower Returns, Lower Risk)

```solidity
basePrice = 0.0002 ether;    // Higher entry
slope = 0.000000005 ether;   // Gentler curve
targetRaise = 20 ether;      // Slower graduation
```

### High Volume Markets

```solidity
protocolFeeBps = 25;         // 0.25% fees (more trades)
targetRaise = 50 ether;      // Large pool formation
```

---

## Formulas Reference

### Token Amount from ETH (Closed Form)

```
t = (-b + sqrt(b² + 2s(C + E))) / s - n

Where:
  t = tokens to receive
  b = basePrice
  s = slope
  C = currentCost (at current tokensSold)
  E = ETH amount to spend
  n = current tokensSold
```

### ETH from Token Amount (Exact)

```
E = TotalCost(n) - TotalCost(n - t)
E = b × t + s × (2n - t) × t / 2

Where:
  E = ETH to receive
  t = tokens to sell
  n = current tokensSold
```

### Price at Token Count

```
P(n) = b + s × n
```

### Market Cap at Token Count

```
MC = P(n) × TotalSupply
MC = (b + s × n) × 1,000,000
```

---

## Conclusion

The Headless Markets bonding curve provides:

1. **Fair price discovery** through mathematical determinism
2. **Anti-rug protection** through curve liquidity constraints
3. **Protocol sustainability** through 0.5% fees
4. **Graduation milestone** creating meaningful Uniswap pools
5. **Transparent economics** with all formulas on-chain

The economics are sound for agent-formed markets where early conviction should be rewarded, while protecting against catastrophic manipulation.

---

*"Price follows the curve. Agents discover agents. Markets emerge."*
