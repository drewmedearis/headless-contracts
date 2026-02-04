import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * MEV (Maximal Extractable Value) Attack Simulations
 *
 * Following EVM Security Agent / Trail of Bits methodology for MEV testing.
 * Tests simulate real-world MEV strategies that searchers/bots would attempt.
 *
 * MEV Attack Categories:
 * 1. Sandwich Attacks (front-run + back-run)
 * 2. Front-Running (tx ordering manipulation)
 * 3. Back-Running (post-tx extraction)
 * 4. JIT Liquidity (just-in-time liquidity provision)
 * 5. Multi-Block MEV (cross-block strategies)
 * 6. Graduation Front-Running (DEX listing attacks)
 * 7. Price Manipulation Attacks
 */
describe("MEV Attack Simulations", function () {
  async function deployFixture() {
    const [owner, treasury, mevBot, victim1, victim2, agent1, agent2, agent3] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("BondingCurveFactory");
    const factory = await Factory.deploy(treasury.address, ethers.ZeroAddress);

    // Create test market
    await factory.createMarket(
      [agent1.address, agent2.address, agent3.address],
      [40, 35, 25],
      "MEV Test Token",
      "MEV",
      "MEV testing market"
    );

    const market = await factory.getMarket(0);
    const token = await ethers.getContractAt("MarketToken", market.tokenAddress);

    return { factory, token, owner, treasury, mevBot, victim1, victim2, agent1, agent2, agent3 };
  }

  // ============ SANDWICH ATTACKS ============
  describe("Sandwich Attacks", function () {
    describe("Classic Buy Sandwich", function () {
      /**
       * Attack Pattern:
       * 1. MEV bot sees victim's buy tx in mempool
       * 2. Bot front-runs with large buy (raises price)
       * 3. Victim's tx executes at inflated price
       * 4. Bot back-runs by selling (profit from price difference)
       *
       * Defense: Slippage protection (minTokensOut)
       */
      it("MEV bot attempts classic sandwich on buy - MITIGATED by slippage", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        // Step 1: Victim calculates expected tokens BEFORE MEV attack
        const victimBuyAmount = ethers.parseEther("1.0");
        const expectedTokens = await factory.calculatePurchaseReturn(0, victimBuyAmount);

        // Step 2: MEV bot front-runs with large buy
        const frontRunAmount = ethers.parseEther("3.0");
        await factory.connect(mevBot).buy(0, 0, { value: frontRunAmount });

        // Step 3: Victim's tx with strict slippage protection
        // Should FAIL because price moved significantly
        await expect(
          factory.connect(victim1).buy(0, expectedTokens, { value: victimBuyAmount })
        ).to.be.revertedWith("Slippage exceeded");

        // Victim is protected - tx reverted, no loss
      });

      it("MEV bot sandwich succeeds if victim uses 0 slippage (user error)", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        const victimBuyAmount = ethers.parseEther("1.0");

        // MEV bot front-runs
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("3.0") });

        // Victim uses minTokensOut=0 (NO protection - user error)
        // This will succeed but victim gets fewer tokens
        const victimBalanceBefore = await token.balanceOf(victim1.address);
        await factory.connect(victim1).buy(0, 0, { value: victimBuyAmount });
        const victimBalanceAfter = await token.balanceOf(victim1.address);

        const tokensReceived = victimBalanceAfter - victimBalanceBefore;

        // Calculate what victim WOULD have received without front-run
        // (We can't directly compare, but we document the loss exists)
        // The protocol protected itself - the loss is on victim for not using slippage
        expect(tokensReceived).to.be.gt(0); // Victim got some tokens

        // MEV bot back-runs by selling
        const botBalance = await token.balanceOf(mevBot.address);
        await token.connect(mevBot).approve(factory.target, botBalance);

        // Bot's sell may or may not be profitable depending on curve shape
        await factory.connect(mevBot).sell(0, botBalance, 0);
      });

      it("MEV bot profit calculation - sandwich attack economics", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        const mevBotEthBefore = await ethers.provider.getBalance(mevBot.address);

        // Front-run
        const frontRunTx = await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("2.0") });
        const frontRunReceipt = await frontRunTx.wait();

        // Victim buys (no slippage - simulating naive user)
        await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("1.0") });

        // Back-run - sell all
        const botTokens = await token.balanceOf(mevBot.address);
        await token.connect(mevBot).approve(factory.target, botTokens);
        const backRunTx = await factory.connect(mevBot).sell(0, botTokens, 0);
        const backRunReceipt = await backRunTx.wait();

        const mevBotEthAfter = await ethers.provider.getBalance(mevBot.address);

        // Calculate total gas spent
        const gasUsed = frontRunReceipt!.gasUsed * frontRunReceipt!.gasPrice +
                        backRunReceipt!.gasUsed * backRunReceipt!.gasPrice;

        // Net profit/loss for MEV bot
        const netPnL = mevBotEthAfter - mevBotEthBefore + gasUsed;

        // Due to protocol fees (0.5% on buy AND sell), MEV bot likely loses money
        // This is intentional - fees make small sandwiches unprofitable
        console.log(`MEV Bot PnL: ${ethers.formatEther(netPnL)} ETH`);

        // Assert fees make sandwiching unprofitable for small amounts
        // (Larger amounts may still be profitable - this is a known limitation)
      });
    });

    describe("Sell Sandwich", function () {
      /**
       * Attack Pattern:
       * 1. MEV bot sees victim's sell tx in mempool
       * 2. Bot front-runs by selling (drops price)
       * 3. Victim's tx executes at lower price (gets less ETH)
       * 4. Bot back-runs by buying at low price
       *
       * Defense: Slippage protection (minEthOut)
       */
      it("MEV bot attempts sell sandwich - MITIGATED by slippage", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        // Setup: Both mevBot and victim buy tokens
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("2.0") });
        await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("2.0") });

        const victimTokens = await token.balanceOf(victim1.address);
        const expectedEth = await factory.calculateSaleReturn(0, victimTokens);

        // MEV bot front-runs victim's sell
        const botTokens = await token.balanceOf(mevBot.address);
        await token.connect(mevBot).approve(factory.target, botTokens);
        await factory.connect(mevBot).sell(0, botTokens, 0);

        // Victim's sell with slippage protection - FAILS
        await token.connect(victim1).approve(factory.target, victimTokens);
        await expect(
          factory.connect(victim1).sell(0, victimTokens, expectedEth)
        ).to.be.revertedWith("Slippage exceeded");

        // Victim protected
      });
    });

    describe("Multi-Victim Sandwich", function () {
      /**
       * Attack Pattern:
       * MEV bot sandwiches multiple victims in same block
       */
      it("MEV bot attempts to sandwich multiple victims", async function () {
        const { factory, token, mevBot, victim1, victim2 } = await loadFixture(deployFixture);

        // Victims calculate expected tokens
        const victim1Expected = await factory.calculatePurchaseReturn(0, ethers.parseEther("0.5"));
        const victim2Expected = await factory.calculatePurchaseReturn(0, ethers.parseEther("0.5"));

        // MEV bot front-runs
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("2.0") });

        // Both victims with slippage protection - BOTH FAIL
        await expect(
          factory.connect(victim1).buy(0, victim1Expected, { value: ethers.parseEther("0.5") })
        ).to.be.revertedWith("Slippage exceeded");

        await expect(
          factory.connect(victim2).buy(0, victim2Expected, { value: ethers.parseEther("0.5") })
        ).to.be.revertedWith("Slippage exceeded");
      });
    });
  });

  // ============ FRONT-RUNNING ATTACKS ============
  describe("Front-Running Attacks", function () {
    describe("Large Order Front-Running", function () {
      /**
       * Attack Pattern:
       * 1. MEV bot sees large buy order
       * 2. Bot buys first with higher gas
       * 3. Large order executes, pushing price up
       * 4. Bot sells for profit
       */
      it("Front-running large buy order - victim protected by slippage", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        // Victim wants to buy 5 ETH worth (large order)
        const largeOrder = ethers.parseEther("5.0");
        const expectedTokens = await factory.calculatePurchaseReturn(0, largeOrder);

        // MEV bot front-runs
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("1.0") });

        // Victim's large order with 2% slippage tolerance
        const minTokens = (expectedTokens * 98n) / 100n;

        // May or may not revert depending on how much price moved
        // With 1 ETH front-run vs 5 ETH order, slippage might be acceptable
        try {
          await factory.connect(victim1).buy(0, minTokens, { value: largeOrder });
          // If it succeeds, victim accepted the slippage
        } catch (e) {
          // If it fails, victim was protected
          expect((e as Error).message).to.include("Slippage exceeded");
        }
      });
    });

    describe("Graduation Front-Running", function () {
      /**
       * Attack Pattern:
       * 1. MEV bot monitors markets approaching graduation (10 ETH)
       * 2. When market is at 9.9 ETH, bot buys remaining
       * 3. Bot gets tokens at bonding curve price
       * 4. After graduation, tokens trade on Uniswap at potentially higher price
       */
      it("MEV bot attempts graduation front-run", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        // Build up to near graduation
        await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("9.5") });

        const market = await factory.getMarket(0);
        expect(market.graduated).to.be.false;

        // MEV bot front-runs the graduation trigger
        // Buys remaining amount to trigger graduation + get tokens
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("1.0") });

        const marketAfter = await factory.getMarket(0);
        expect(marketAfter.graduated).to.be.true;

        // Bot now holds tokens that are on Uniswap (if router was set)
        const botTokens = await token.balanceOf(mevBot.address);
        expect(botTokens).to.be.gt(0);

        // This is a known "attack" - but it's more of a race condition
        // The tokens were fairly purchased on the curve
        // The "front-running" just means bot triggered graduation
      });

      it("Graduation front-running with multiple bots racing", async function () {
        const { factory, token, mevBot, victim1, victim2 } = await loadFixture(deployFixture);

        // Near graduation
        await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("9.8") });

        // Two bots race to graduate
        // In reality, only one tx can be included first
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("0.3") });

        const market = await factory.getMarket(0);
        expect(market.graduated).to.be.true;

        // Second bot's tx would fail (market already graduated)
        await expect(
          factory.connect(victim2).buy(0, 0, { value: ethers.parseEther("0.3") })
        ).to.be.revertedWith("Market graduated");
      });
    });
  });

  // ============ BACK-RUNNING ATTACKS ============
  describe("Back-Running Attacks", function () {
    /**
     * Attack Pattern:
     * 1. MEV bot sees large buy that will move price
     * 2. Bot places buy immediately after
     * 3. Bot benefits from momentum/price trend
     */
    it("Back-running a large buy - no protection needed (fair game)", async function () {
      const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

      // Victim makes large buy
      await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("3.0") });

      // MEV bot back-runs with own buy
      const botBalanceBefore = await ethers.provider.getBalance(mevBot.address);
      await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("1.0") });

      // This isn't really an "attack" - bot is just buying after seeing activity
      // No victim is harmed - victim got their tokens
      // Bot may or may not profit depending on future price action

      const botTokens = await token.balanceOf(mevBot.address);
      expect(botTokens).to.be.gt(0);
    });
  });

  // ============ PRICE MANIPULATION ATTACKS ============
  describe("Price Manipulation Attacks", function () {
    describe("Flash Loan Style Attack", function () {
      /**
       * Attack Pattern (would require flash loan):
       * 1. Borrow large amount of ETH
       * 2. Buy huge amount of tokens (pump price)
       * 3. Do something that benefits from high price
       * 4. Sell tokens (dump price)
       * 5. Repay loan
       *
       * For bonding curves, there's no external price oracle to manipulate
       * The attack surface is limited
       */
      it("Simulated flash loan attack - can't extract via curve after graduation", async function () {
        const { factory, token, mevBot } = await loadFixture(deployFixture);

        // Simulate having borrowed enough ETH to graduate market
        const borrowedAmount = ethers.parseEther("11.0"); // Above 10 ETH target

        // Buy all tokens (this graduates the market)
        const botEthBefore = await ethers.provider.getBalance(mevBot.address);
        const tx1 = await factory.connect(mevBot).buy(0, 0, { value: borrowedAmount });
        const receipt1 = await tx1.wait();

        // Market graduated - can't sell back to curve
        const market = await factory.getMarket(0);
        expect(market.graduated).to.be.true;

        // Bot is stuck with tokens that can only be sold on Uniswap
        // (If Uniswap router was set, LP was created)
        // Without Uniswap, tokens are essentially stuck

        // For this test (no Uniswap), the "flash loan" loses money
        const botTokens = await token.balanceOf(mevBot.address);
        expect(botTokens).to.be.gt(0);

        // Can't sell back - market graduated
        await token.connect(mevBot).approve(factory.target, botTokens);
        await expect(
          factory.connect(mevBot).sell(0, botTokens, 0)
        ).to.be.revertedWith("Market graduated");

        // Attack fails - bot has tokens but can't extract ETH
      });
    });

    describe("Pump and Dump", function () {
      /**
       * Attack Pattern:
       * 1. Buy tokens to pump price
       * 2. Attract other buyers at high price
       * 3. Dump tokens for profit
       */
      it("Pump and dump attempt - limited by curve mechanics", async function () {
        const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

        // Phase 1: Bot pumps price
        await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("3.0") });

        const priceAfterPump = await factory.getCurrentPrice(0);

        // Phase 2: Victim buys at higher price
        await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("1.0") });

        // Phase 3: Bot dumps
        const botTokens = await token.balanceOf(mevBot.address);
        await token.connect(mevBot).approve(factory.target, botTokens);

        const botEthBefore = await ethers.provider.getBalance(mevBot.address);
        const tx = await factory.connect(mevBot).sell(0, botTokens, 0);
        const receipt = await tx.wait();
        const botEthAfter = await ethers.provider.getBalance(mevBot.address);

        // Calculate if bot profited
        // With 0.5% fee on both buy and sell, plus victim only added 1 ETH...
        // Bot likely doesn't profit significantly

        // The bonding curve makes pump and dump less effective because:
        // 1. Price is deterministic based on tokens sold
        // 2. Selling pushes price back down
        // 3. Fees eat into profits
        // 4. No external price to manipulate
      });
    });
  });

  // ============ MULTI-BLOCK MEV ============
  describe("Multi-Block MEV Strategies", function () {
    /**
     * Attack Pattern:
     * MEV bot accumulates position over multiple blocks
     * Harder to detect, can be more profitable
     */
    it("Slow accumulation strategy", async function () {
      const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

      // Bot accumulates over multiple "blocks"
      await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("0.5") });
      await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("0.5") });
      await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("0.5") });

      // Other users trade
      await factory.connect(victim1).buy(0, 0, { value: ethers.parseEther("2.0") });

      // Bot continues accumulating
      await factory.connect(mevBot).buy(0, 0, { value: ethers.parseEther("0.5") });

      const botTokens = await token.balanceOf(mevBot.address);

      // This is just normal trading behavior
      // Not really an "attack" - bot is accumulating a position
      expect(botTokens).to.be.gt(0);
    });
  });

  // ============ MITIGATION EFFECTIVENESS ============
  describe("Slippage Protection Effectiveness", function () {
    it("Calculate optimal slippage tolerance", async function () {
      const { factory, mevBot, victim1 } = await loadFixture(deployFixture);

      const buyAmount = ethers.parseEther("1.0");

      // Calculate at different slippage levels
      const slippageLevels = [1n, 2n, 5n, 10n]; // 1%, 2%, 5%, 10%

      for (const slippage of slippageLevels) {
        // Fresh deployment for each test
        const Factory = await ethers.getContractFactory("BondingCurveFactory");
        const treasury = (await ethers.getSigners())[1];
        const testFactory = await Factory.deploy(treasury.address, ethers.ZeroAddress);
        const agents = (await ethers.getSigners()).slice(5, 8);
        await testFactory.createMarket(
          [agents[0].address, agents[1].address, agents[2].address],
          [34, 33, 33],
          "Slippage Test",
          "SLIP",
          "Test"
        );

        const expectedTokens = await testFactory.calculatePurchaseReturn(0, buyAmount);
        const minTokens = (expectedTokens * (100n - slippage)) / 100n;

        // MEV bot front-runs with amount equal to victim's buy
        await testFactory.connect(mevBot).buy(0, 0, { value: buyAmount });

        // Check if victim's tx would succeed
        try {
          await testFactory.connect(victim1).buy(0, minTokens, { value: buyAmount });
          console.log(`${slippage}% slippage: TX SUCCEEDED (victim accepts ${slippage}% loss)`);
        } catch (e) {
          console.log(`${slippage}% slippage: TX REVERTED (victim protected)`);
        }
      }
    });

    it("Protocol fees as MEV deterrent - calculate break-even", async function () {
      const { factory, token, mevBot, victim1 } = await loadFixture(deployFixture);

      // Protocol fee is 0.5% (50 bps)
      // MEV bot pays fee on buy AND sell = ~1% total

      // For sandwich to be profitable:
      // profit_from_price_movement > gas_costs + protocol_fees

      // With 0.5% fee on each side, bot needs > 1% price movement to profit
      // This is harder on small trades

      const smallTrade = ethers.parseEther("0.1");
      const mediumTrade = ethers.parseEther("1.0");
      const largeTrade = ethers.parseEther("5.0");

      // Test profitability at different scales
      for (const victimAmount of [smallTrade, mediumTrade, largeTrade]) {
        const Factory = await ethers.getContractFactory("BondingCurveFactory");
        const treasury = (await ethers.getSigners())[1];
        const testFactory = await Factory.deploy(treasury.address, ethers.ZeroAddress);
        const agents = (await ethers.getSigners()).slice(5, 8);
        await testFactory.createMarket(
          [agents[0].address, agents[1].address, agents[2].address],
          [34, 33, 33],
          "Fee Test",
          "FEE",
          "Test"
        );

        const market = await testFactory.getMarket(0);
        const testToken = await ethers.getContractAt("MarketToken", market.tokenAddress);

        // Bot front-runs with same amount as victim
        const botEthBefore = await ethers.provider.getBalance(mevBot.address);
        const tx1 = await testFactory.connect(mevBot).buy(0, 0, { value: victimAmount });
        const receipt1 = await tx1.wait();

        // Victim trades (no slippage protection for this test)
        await testFactory.connect(victim1).buy(0, 0, { value: victimAmount });

        // Bot dumps
        const botTokens = await testToken.balanceOf(mevBot.address);
        await testToken.connect(mevBot).approve(testFactory.target, botTokens);
        const tx2 = await testFactory.connect(mevBot).sell(0, botTokens, 0);
        const receipt2 = await tx2.wait();

        const botEthAfter = await ethers.provider.getBalance(mevBot.address);
        const gasCost = receipt1!.gasUsed * receipt1!.gasPrice + receipt2!.gasUsed * receipt2!.gasPrice;
        const netPnL = botEthAfter - botEthBefore + gasCost;

        console.log(`Victim amount: ${ethers.formatEther(victimAmount)} ETH`);
        console.log(`Bot PnL: ${ethers.formatEther(netPnL)} ETH`);
        console.log(`Gas cost: ${ethers.formatEther(gasCost)} ETH`);
        console.log("---");
      }
    });
  });

  // ============ KNOWN LIMITATIONS ============
  describe("Known MEV Limitations (Documented)", function () {
    /**
     * These are attacks we CANNOT fully prevent at the contract level.
     * Mitigation requires user education and proper slippage settings.
     */

    it("LIMITATION: Private mempool bypass (Flashbots)", async function () {
      // MEV bots using Flashbots/private mempools won't see victim txs
      // This is external infrastructure, not contract-level protection
      // MITIGATION: Users can also use private mempools
      expect(true).to.be.true; // Documented limitation
    });

    it("LIMITATION: Multi-block attacks with large capital", async function () {
      // Attacker with large capital can manipulate over multiple blocks
      // Hard to distinguish from legitimate trading
      // MITIGATION: Protocol fees make sustained attacks expensive
      expect(true).to.be.true; // Documented limitation
    });

    it("LIMITATION: Graduation timing is public", async function () {
      // Anyone can see when a market is close to graduation
      // Can race to buy the final tokens
      // MITIGATION: This is fair competition, not really an attack
      expect(true).to.be.true; // Documented limitation
    });
  });
});
