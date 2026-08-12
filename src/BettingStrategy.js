/**
 * BettingStrategy.js
 * 
 * This module implements optimal betting strategies for card counting.
 * It provides methods to calculate bet sizes based on the count,
 * bankroll management, and risk of ruin considerations.
 */

class BettingStrategy {
  /**
   * Create a new betting strategy
   * @param {Object} options - Configuration options
   * @param {number} options.bankroll - Player's total bankroll
   * @param {number} options.minBet - Table minimum bet
   * @param {number} options.maxBet - Table maximum bet
   * @param {number} options.betSpread - Maximum bet as a multiple of minimum bet
   * @param {string} options.riskTolerance - Risk tolerance ('low', 'medium', 'high')
   * @param {number} options.kelly - Kelly criterion fraction (0-1)
   */
  constructor(options = {}) {
    this.options = {
      bankroll: 1000,
      minBet: 10,
      maxBet: 500,
      betSpread: 12, // 1-12 spread
      riskTolerance: 'medium',
      kelly: 0.8, // Betting at 80% of Kelly for safety
      ...options
    };

    // Initialize risk of ruin parameters based on risk tolerance
    this.riskParameters = this._initializeRiskParameters();

    // Betting ramp maps true counts to bet multipliers
    this.bettingRamp = this._initializeBettingRamp();
  }

  /**
   * Initialize risk parameters based on risk tolerance
   * @returns {Object} Risk parameters
   * @private
   */
  _initializeRiskParameters() {
    switch (this.options.riskTolerance) {
      case 'low':
        return {
          targetRiskOfRuin: 0.01, // 1% risk of ruin
          bankrollUnits: 100,     // 100 units of minimum bet
          maxBetPercentage: 0.02  // Never bet more than 2% of bankroll
        };
      case 'high':
        return {
          targetRiskOfRuin: 0.05, // 5% risk of ruin
          bankrollUnits: 50,      // 50 units of minimum bet
          maxBetPercentage: 0.05  // Never bet more than 5% of bankroll
        };
      case 'medium':
      default:
        return {
          targetRiskOfRuin: 0.025, // 2.5% risk of ruin
          bankrollUnits: 75,       // 75 units of minimum bet
          maxBetPercentage: 0.03   // Never bet more than 3% of bankroll
        };
    }
  }

  /**
   * Initialize the betting ramp (true count to bet multiplier mapping)
   * @returns {Object} Betting ramp
   * @private
   */
  _initializeBettingRamp() {
    // Create a betting ramp based on the bet spread and risk tolerance
    // The ramp maps true count values to bet size multipliers
    const ramp = {
      "-6": 0.5,  // Betting below table minimum (wong out if possible)
      "-5": 0.5,
      "-4": 0.5,
      "-3": 0.5,
      "-2": 0.5,
      "-1": 0.5,
      "0": 1,     // Min bet at 0 count
      "1": 1,     // Min bet at +1 (conservative approach)
      "2": 2,     // Double bet at +2
      "3": 4,     // 4x at +3
      "4": 6,     // 6x at +4
      "5": 8,     // 8x at +5
      "6": 10,    // 10x at +6
      "7": 12,    // 12x at +7 (or max bet spread)
      "8": 12,
      "9": 12,
      "10": 12
    };

    // Adjust ramp based on betSpread option
    const maxMultiplier = this.options.betSpread;

    // If our max spread is less than 12, scale everything down
    if (maxMultiplier < 12) {
      const scale = maxMultiplier / 12;
      for (const count in ramp) {
        if (ramp[count] > 1) {
          ramp[count] = Math.max(1, Math.round(ramp[count] * scale));
        }
      }
    }

    // If our max spread is more than 12, extend the high count bets
    if (maxMultiplier > 12) {
      const extraSpread = maxMultiplier - 12;
      for (let count = 8; count <= 10; count++) {
        ramp[count] = 12 + ((count - 7) * (extraSpread / 3));
      }
    }

    return ramp;
  }

  /**
   * Get the optimal bet size based on the true count
   * @param {number} trueCount - The true count
   * @returns {number} The recommended bet amount
   */
  getOptimalBet(trueCount) {
    // Round the true count to the nearest integer for the betting ramp
    const roundedCount = Math.round(trueCount);

    // Limit the count range for the betting ramp
    const boundedCount = Math.min(10, Math.max(-6, roundedCount)).toString();

    // Get the base multiplier from the betting ramp
    const multiplier = this.bettingRamp[boundedCount] || 1;

    // Calculate the base bet
    let betAmount = this.options.minBet * multiplier;

    // Ensure bet is within table limits
    betAmount = Math.min(this.options.maxBet, Math.max(this.options.minBet, betAmount));

    // Apply bankroll management constraints
    const maxBetForBankroll = this.options.bankroll * this.riskParameters.maxBetPercentage;
    betAmount = Math.min(betAmount, maxBetForBankroll);

    // Round to the nearest standard bet increment (usually 5 or 10)
    const increment = this.options.minBet >= 25 ? 25 :
      this.options.minBet >= 10 ? 10 : 5;

    return Math.round(betAmount / increment) * increment;
  }

  /**
   * Get optimal bet size using Kelly criterion
   * @param {number} trueCount - The true count
   * @param {number} playerAdvantage - The player's advantage (as a decimal)
   * @returns {number} The Kelly-optimal bet amount
   */
  getKellyBet(trueCount, playerAdvantage) {
    // If we don't have an advantage, bet the minimum
    if (playerAdvantage <= 0) {
      return this.options.minBet;
    }

    // Kelly formula: f* = p/q * (b+1) - 1/b
    // In blackjack terms: f* = edge/1
    // Where f* is the fraction of bankroll to bet
    const kellyFraction = playerAdvantage;

    // Apply the Kelly fraction parameter (e.g., bet 80% of Kelly for safety)
    const adjustedFraction = kellyFraction * this.options.kelly;

    // Calculate the Kelly bet
    let betAmount = this.options.bankroll * adjustedFraction;

    // Apply table limits
    betAmount = Math.min(this.options.maxBet, Math.max(this.options.minBet, betAmount));

    // Round to the nearest standard bet increment
    const increment = this.options.minBet >= 25 ? 25 :
      this.options.minBet >= 10 ? 10 : 5;

    return Math.round(betAmount / increment) * increment;
  }

  /**
   * Calculate the risk of ruin with current bankroll and betting strategy
   * @param {number} expectedAdvantage - Expected player advantage (as a decimal)
   * @param {number} standardDeviation - Standard deviation of results (usually around 1.15 for blackjack)
   * @returns {number} The probability of ruin (0-1)
   */
  calculateRiskOfRuin(expectedAdvantage = 0.01, standardDeviation = 1.15) {
    if (expectedAdvantage <= 0) {
      return 1.0; // Guaranteed ruin with negative advantage
    }

    // Calculate risk of ruin using exponential formula
    // RoR = e^(-2*A*B/σ²)
    // Where A is the advantage per unit, B is the bankroll in units, and σ is the standard deviation

    const bankrollUnits = this.options.bankroll / this.options.minBet;
    const riskOfRuin = Math.exp((-2 * expectedAdvantage * bankrollUnits) / Math.pow(standardDeviation, 2));

    return riskOfRuin;
  }

  /**
   * Calculate the recommended bankroll for a given risk of ruin
   * @param {number} targetRisk - Target risk of ruin (0-1)
   * @param {number} expectedAdvantage - Expected player advantage (as a decimal)
   * @param {number} standardDeviation - Standard deviation of results
   * @returns {number} The recommended bankroll in betting units
   */
  getRecommendedBankroll(targetRisk = 0.05, expectedAdvantage = 0.01, standardDeviation = 1.15) {
    if (expectedAdvantage <= 0 || targetRisk <= 0 || targetRisk >= 1) {
      return Infinity; // Invalid parameters
    }

    // Solve for B in the risk of ruin formula
    // RoR = e^(-2*A*B/σ²)
    // ln(RoR) = -2*A*B/σ²
    // B = -ln(RoR)*σ²/(2*A)

    const recommendedUnits = -Math.log(targetRisk) * Math.pow(standardDeviation, 2) / (2 * expectedAdvantage);

    return Math.ceil(recommendedUnits);
  }

  /**
   * Calculate the expected hourly win rate
   * @param {number} handsPerHour - Average number of hands played per hour
   * @param {number} averageBet - Average bet size
   * @param {number} expectedAdvantage - Expected player advantage (as a decimal)
   * @returns {number} Expected hourly win rate
   */
  calculateHourlyWinRate(handsPerHour = 100, averageBet = 50, expectedAdvantage = 0.01) {
    return handsPerHour * averageBet * expectedAdvantage;
  }

  /**
   * Get the betting spread description
   * @returns {string} Description of the betting spread (e.g., "1-12")
   */
  getBetSpreadDescription() {
    return `1-${this.options.betSpread}`;
  }

  /**
   * Get the recommended bet for an insurance bet
   * @param {number} trueCount - The true count
   * @param {number} mainBet - The main bet amount
   * @returns {number} The recommended insurance bet (0 for no insurance)
   */
  getInsuranceBet(trueCount, mainBet) {
    // Insurance is profitable when true count is 3 or higher
    if (trueCount >= 3) {
      // Insurance bet is half the main bet
      return Math.min(mainBet / 2, this.options.bankroll * 0.01);
    }

    return 0; // Don't take insurance at lower counts
  }

  /**
   * Get a complete betting recommendation with detailed explanation
   * @param {number} trueCount - The true count
   * @param {number} playerAdvantage - The player's advantage (as a decimal)
   * @returns {Object} Detailed betting recommendation
   */
  getBettingRecommendation(trueCount, playerAdvantage) {
    const rampBet = this.getOptimalBet(trueCount);
    const kellyBet = this.getKellyBet(trueCount, playerAdvantage);
    const takingInsurance = trueCount >= 3;
    const riskOfRuin = this.calculateRiskOfRuin(playerAdvantage);

    // Decide on the recommended bet (more conservative of the two)
    const recommendedBet = Math.min(rampBet, kellyBet);

    // Calculate expected hourly win rate with this bet
    const hourlyWinRate = this.calculateHourlyWinRate(100, recommendedBet, playerAdvantage);

    return {
      trueCount,
      playerAdvantage: playerAdvantage * 100, // Convert to percentage
      recommendedBet,
      rampBet,
      kellyBet,
      betMultiplier: recommendedBet / this.options.minBet,
      takingInsurance,
      riskOfRuin: riskOfRuin * 100, // Convert to percentage
      hourlyWinRate,
      explanation: this._generateBettingExplanation(
        trueCount,
        playerAdvantage,
        recommendedBet,
        takingInsurance
      ),
      bankrollStatus: this._getBankrollStatus()
    };
  }

  /**
   * Generate a human-readable explanation of the betting recommendation
   * @param {number} trueCount - The true count
   * @param {number} playerAdvantage - The player's advantage (as a decimal)
   * @param {number} betAmount - The recommended bet amount
   * @param {boolean} takingInsurance - Whether insurance is recommended
   * @returns {string} Human-readable explanation
   * @private
   */
  _generateBettingExplanation(trueCount, playerAdvantage, betAmount, takingInsurance) {
    let explanation = '';

    if (trueCount <= 0) {
      explanation = `At a true count of ${trueCount}, the house has the advantage. Bet the minimum to minimize losses while waiting for better counts.`;
    } else if (trueCount === 1) {
      explanation = `At a true count of +1, you have a very slight advantage. Bet the minimum to minimize variance while waiting for better counts.`;
    } else if (trueCount <= 3) {
      explanation = `At a true count of +${trueCount}, you have a small but positive advantage of about ${(playerAdvantage * 100).toFixed(1)}%. Betting ${betAmount} (${(betAmount / this.options.minBet)}x minimum) is optimal for this count.`;
    } else {
      explanation = `At a true count of +${trueCount}, you have a significant advantage of about ${(playerAdvantage * 100).toFixed(1)}%. Betting ${betAmount} (${(betAmount / this.options.minBet)}x minimum) maximizes your expected win while managing risk.`;
    }

    if (takingInsurance) {
      explanation += ` Insurance is profitable at this count, so take insurance when offered.`;
    }

    return explanation;
  }

  /**
   * Get a status assessment of the current bankroll
   * @returns {Object} Bankroll status assessment
   * @private
   */
  _getBankrollStatus() {
    // Calculate the risk of ruin with current bankroll
    const ror = this.calculateRiskOfRuin(0.01);

    // Calculate the recommended bankroll for a 5% risk of ruin
    const recommendedUnits = this.getRecommendedBankroll(0.05, 0.01);
    const currentUnits = this.options.bankroll / this.options.minBet;

    // Determine bankroll status
    let status = '';
    let action = '';

    if (currentUnits < recommendedUnits * 0.5) {
      status = 'critical';
      action = `Your bankroll is critically low for your current betting level. Consider adding ${(recommendedUnits - currentUnits) * this.options.minBet} more or reducing your maximum bet.`;
    } else if (currentUnits < recommendedUnits * 0.75) {
      status = 'warning';
      action = `Your bankroll is below the recommended level. Consider adding ${(recommendedUnits - currentUnits) * this.options.minBet} more or slightly reducing your betting spread.`;
    } else if (currentUnits < recommendedUnits) {
      status = 'adequate';
      action = `Your bankroll is adequate but could be improved by adding ${(recommendedUnits - currentUnits) * this.options.minBet} more.`;
    } else {
      status = 'optimal';
      action = `Your bankroll is optimal for your current betting level. You have a good balance of risk and reward.`;
    }

    return {
      currentBankroll: this.options.bankroll,
      bankrollUnits: currentUnits,
      recommendedUnits,
      riskOfRuin: ror * 100, // Convert to percentage
      status,
      action
    };
  }

  /**
   * Update the bankroll
   * @param {number} newBankroll - The new bankroll amount
   */
  updateBankroll(newBankroll) {
    if (newBankroll > 0) {
      this.options.bankroll = newBankroll;
      return true;
    }
    return false;
  }

  /**
   * Adjust bet sizes for table conditions and cover
   * @param {number} recommendedBet - The mathematically optimal bet
   * @param {Object} options - Adjustment options 
   * @param {boolean} options.applyVariation - Whether to add bet variation
   * @param {boolean} options.applyCover - Whether to adjust bets to avoid detection
   * @returns {number} The adjusted bet amount
   */
  getAdjustedBet(recommendedBet, options = {}) {
    let adjustedBet = recommendedBet;

    // Apply random variations for cover
    if (options.applyVariation) {
      const variation = Math.random() * 0.2 - 0.1; // -10% to +10%
      adjustedBet = adjustedBet * (1 + variation);
    }

    // Apply cover adjustments to make betting pattern less obvious
    if (options.applyCover) {
      // Occasionally bet less than recommended for cover
      if (Math.random() < 0.1) {
        adjustedBet = adjustedBet * 0.7;
      }

      // Occasionally bet green chips instead of exact amounts
      if (Math.random() < 0.2) {
        adjustedBet = Math.ceil(adjustedBet / 25) * 25;
      }
    }

    // Ensure bet is within table limits
    adjustedBet = Math.min(this.options.maxBet, Math.max(this.options.minBet, adjustedBet));

    // Round to the nearest standard bet increment
    const increment = this.options.minBet >= 25 ? 25 :
      this.options.minBet >= 10 ? 10 : 5;

    return Math.round(adjustedBet / increment) * increment;
  }

  /**
   * Calculate the standard deviation of returns for a given bet size
   * @param {number} betSize - The bet size
   * @param {number} handsPerHour - Number of hands played per hour
   * @returns {number} The standard deviation of hourly returns
   */
  calculateHourlyStandardDeviation(betSize, handsPerHour = 100) {
    // Standard deviation for a single hand of blackjack is about 1.15 times the bet size
    const handStdDev = betSize * 1.15;

    // For multiple independent hands, standard deviation increases by sqrt(n)
    return handStdDev * Math.sqrt(handsPerHour);
  }

  /**
   * Calculate the probability of losing a certain amount in a session
   * @param {number} sessionLength - Length of session in hours
   * @param {number} averageBet - Average bet size
   * @param {number} targetLoss - Target loss amount to calculate probability for
   * @param {number} playerAdvantage - Player advantage (as a decimal)
   * @returns {number} Probability of losing the target amount or more
   */
  calculateSessionRisk(sessionLength = 4, averageBet = 50, targetLoss = 1000, playerAdvantage = 0.01) {
    // Calculate expected value and standard deviation for the session
    const handsPerHour = 100;
    const totalHands = handsPerHour * sessionLength;

    const expectedValue = totalHands * averageBet * playerAdvantage;
    const standardDeviation = this.calculateHourlyStandardDeviation(averageBet, handsPerHour) * Math.sqrt(sessionLength);

    // Calculate z-score for the target loss
    const zScore = ((-targetLoss) - expectedValue) / standardDeviation;

    // Calculate probability using the normal approximation to the binomial
    // This is the cumulative distribution function (CDF) of the standard normal distribution
    return this._normalCDF(zScore);
  }

  /**
   * Calculate the cumulative distribution function of the standard normal distribution
   * @param {number} z - Z-score
   * @returns {number} Probability
   * @private
   */
  _normalCDF(z) {
    // Simple approximation of the normal CDF
    if (z < -8.0) return 0.0;
    if (z > 8.0) return 1.0;

    let sum = 0.0;
    let term = z;
    for (let i = 3; sum + term !== sum; i += 2) {
      sum += term;
      term = term * z * z / i;
    }

    return 0.5 + sum * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  }
}

export default BettingStrategy;

