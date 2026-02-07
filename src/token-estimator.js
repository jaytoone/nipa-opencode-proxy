/**
 * Token Estimator Module
 * 
 * Provides accurate token estimation for NIPA Kimi K2.5 model.
 * Supports multiple estimation strategies: static, adaptive, and predictive.
 */

class TokenEstimator {
  constructor(config = {}) {
    this.config = {
      strategy: config.strategy || 'adaptive',
      ...config
    };
    
    this.history = [];
    this.estimates = [];
    this.actuals = [];
    
    this.initStrategy();
  }

  initStrategy() {
    switch (this.config.strategy) {
      case 'static':
        this.strategy = new StaticStrategy(this.config.static);
        break;
      case 'adaptive':
        this.strategy = new AdaptiveStrategy(this.config.adaptive);
        break;
      case 'predictive':
        this.strategy = new PredictiveStrategy(this.config.predictive);
        break;
      default:
        this.strategy = new AdaptiveStrategy();
    }
  }

  /**
   * Estimate tokens for a given text or conversation
   * @param {string|Object} content - Text or conversation object
   * @returns {Object} Token estimate with confidence
   */
  estimate(content) {
    const text = typeof content === 'string' ? content : this.serializeConversation(content);
    const estimate = this.strategy.estimate(text, this.history);
    
    this.estimates.push({
      timestamp: Date.now(),
      estimated: estimate.tokens,
      text: text.substring(0, 100)
    });
    
    return estimate;
  }

  /**
   * Update with actual token count for learning
   * @param {number} estimated - Previously estimated tokens
   * @param {number} actual - Actual token count from API
   */
  feedback(estimated, actual) {
    this.actuals.push({
      timestamp: Date.now(),
      estimated,
      actual,
      error: Math.abs(estimated - actual) / actual
    });
    
    if (this.strategy.learn) {
      this.strategy.learn(estimated, actual);
    }
    
    this.history.push({ estimated, actual });
    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  /**
   * Get accuracy statistics
   * @returns {Object} Accuracy metrics
   */
  getAccuracy() {
    if (this.actuals.length === 0) {
      return { samples: 0, mape: null, confidence: 0 };
    }
    
    const errors = this.actuals.map(a => Math.abs(a.estimated - a.actual) / a.actual);
    const mape = errors.reduce((a, b) => a + b, 0) / errors.length;
    
    return {
      samples: this.actuals.length,
      mape: mape * 100,
      confidence: Math.max(0, 1 - mape),
      avgError: errors.reduce((a, b) => a + b, 0) / errors.length * 100
    };
  }

  serializeConversation(conversation) {
    if (Array.isArray(conversation)) {
      return conversation.map(m => m.content || m.text || '').join('\n');
    }
    return JSON.stringify(conversation);
  }
}

/**
 * Static threshold strategy
 */
class StaticStrategy {
  constructor(config = {}) {
    this.threshold = config.threshold || 0.6;
  }

  estimate(text) {
    const tokens = this.countTokens(text);
    return {
      tokens,
      shouldCompact: tokens > (this.threshold * 1000000),
      threshold: this.threshold,
      confidence: 1.0
    };
  }

  countTokens(text) {
    if (!text) return 0;
    
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const english = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/\d+/g) || []).length;
    const spaces = (text.match(/\s+/g) || []).length;
    const special = text.length - chinese - english - numbers - spaces;
    
    return Math.ceil(chinese + english * 0.3 + numbers * 0.25 + spaces * 0.1 + special * 0.5);
  }
}

/**
 * Adaptive strategy that learns from history
 */
class AdaptiveStrategy {
  constructor(config = {}) {
    this.learningRate = config.learningRate || 0.1;
    this.windowSize = config.windowSize || 10;
    this.confidenceThreshold = config.confidenceThreshold || 0.8;
    this.baseThreshold = 0.5;
    this.currentThreshold = this.baseThreshold;
  }

  estimate(text, history = []) {
    const tokens = this.countTokens(text);
    
    const recentHistory = history.slice(-this.windowSize);
    if (recentHistory.length > 0) {
      const avgRatio = recentHistory.reduce((sum, h) => 
        sum + (h.actual / h.estimated), 0) / recentHistory.length;
      
      this.currentThreshold = this.baseThreshold * (1 + (1 - avgRatio) * 0.2);
      this.currentThreshold = Math.max(0.3, Math.min(0.8, this.currentThreshold));
    }
    
    return {
      tokens,
      shouldCompact: tokens > (this.currentThreshold * 1000000),
      threshold: this.currentThreshold,
      confidence: this.calculateConfidence(history)
    };
  }

  learn(estimated, actual) {
    const error = (actual - estimated) / estimated;
    this.baseThreshold += error * this.learningRate;
    this.baseThreshold = Math.max(0.3, Math.min(0.8, this.baseThreshold));
  }

  calculateConfidence(history) {
    if (history.length < 5) return 0.5;
    
    const errors = history.slice(-10).map(h => 
      Math.abs(h.estimated - h.actual) / h.actual);
    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    
    return Math.max(0, Math.min(1, 1 - avgError));
  }

  countTokens(text) {
    if (!text) return 0;
    
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const english = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/\d+/g) || []).length;
    const spaces = (text.match(/\s+/g) || []).length;
    const special = text.length - chinese - english - numbers - spaces;
    
    return Math.ceil(chinese + english * 0.3 + numbers * 0.25 + spaces * 0.1 + special * 0.5);
  }
}

/**
 * Predictive strategy using trend analysis
 */
class PredictiveStrategy {
  constructor(config = {}) {
    this.lookahead = config.lookahead || 3;
  }

  estimate(text, history = []) {
    const currentTokens = this.countTokens(text);
    
    const predictedTokens = this.predict(history, currentTokens);
    
    return {
      tokens: currentTokens,
      predictedTokens,
      shouldCompact: predictedTokens > (0.6 * 1000000),
      threshold: 0.6,
      confidence: this.calculateConfidence(history)
    };
  }

  predict(history, current) {
    if (history.length < 3) return current * 1.2;
    
    const recent = history.slice(-5);
    const growthRates = [];
    
    for (let i = 1; i < recent.length; i++) {
      const rate = recent[i].actual / recent[i-1].actual;
      if (!isNaN(rate) && isFinite(rate)) {
        growthRates.push(rate);
      }
    }
    
    if (growthRates.length === 0) return current * 1.2;
    
    const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
    return current * Math.pow(avgGrowth, this.lookahead);
  }

  calculateConfidence(history) {
    if (history.length < 5) return 0.5;
    return 0.8;
  }

  countTokens(text) {
    if (!text) return 0;
    
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const english = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/\d+/g) || []).length;
    const spaces = (text.match(/\s+/g) || []).length;
    const special = text.length - chinese - english - numbers - spaces;
    
    return Math.ceil(chinese + english * 0.3 + numbers * 0.25 + spaces * 0.1 + special * 0.5);
  }
}

module.exports = {
  TokenEstimator,
  StaticStrategy,
  AdaptiveStrategy,
  PredictiveStrategy
};
