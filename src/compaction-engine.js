const { TokenEstimator } = require('./token-estimator');

class CompactionEngine {
  constructor(config = {}) {
    this.config = {
      mode: config.mode || 'smart',
      baseThreshold: config.baseThreshold || 0.5,
      minThreshold: config.minThreshold || 0.4,
      maxThreshold: config.maxThreshold || 0.7,
      contextPreservation: config.contextPreservation || 'high',
      preservePatterns: config.preservePatterns || [],
      ...config
    };
    
    this.tokenEstimator = new TokenEstimator(config.tokenEstimator);
    this.compactionHistory = [];
  }

  shouldCompact(conversation, contextWindow = 1000000) {
    const estimate = this.tokenEstimator.estimate(conversation);
    
    const threshold = this.getDynamicThreshold();
    const shouldCompact = estimate.tokens > (threshold * contextWindow);
    
    return {
      shouldCompact,
      estimatedTokens: estimate.tokens,
      threshold: threshold * contextWindow,
      confidence: estimate.confidence,
      reason: shouldCompact ? `Token count (${estimate.tokens}) exceeds threshold (${Math.floor(threshold * contextWindow)})` : null
    };
  }

  getDynamicThreshold() {
    switch (this.config.mode) {
      case 'smart':
        return this.calculateSmartThreshold();
      case 'aggressive':
        return this.config.minThreshold;
      case 'conservative':
        return this.config.maxThreshold;
      default:
        return this.config.baseThreshold;
    }
  }

  calculateSmartThreshold() {
    const accuracy = this.tokenEstimator.getAccuracy();
    
    if (accuracy.samples < 10) {
      return this.config.baseThreshold;
    }
    
    const confidenceFactor = accuracy.confidence;
    const adjustedThreshold = this.config.baseThreshold * (0.8 + confidenceFactor * 0.4);
    
    return Math.max(
      this.config.minThreshold,
      Math.min(this.config.maxThreshold, adjustedThreshold)
    );
  }

  async compact(conversation, summaryModel) {
    const startTime = Date.now();
    const originalLength = JSON.stringify(conversation).length;
    
    const preservedMessages = this.extractPreservedMessages(conversation);
    const summarizableMessages = this.getSummarizableMessages(conversation);
    
    const summary = await this.generateSummary(summarizableMessages, summaryModel);
    
    const compacted = [
      ...preservedMessages,
      {
        role: 'system',
        content: `[Context Summary] ${summary}`,
        _compaction: {
          originalCount: summarizableMessages.length,
          timestamp: new Date().toISOString()
        }
      }
    ];
    
    const endTime = Date.now();
    const newLength = JSON.stringify(compacted).length;
    
    this.compactionHistory.push({
      timestamp: new Date().toISOString(),
      originalTokens: this.tokenEstimator.estimate(summarizableMessages).tokens,
      summaryTokens: this.tokenEstimator.estimate(summary).tokens,
      duration: endTime - startTime,
      compressionRatio: 1 - (newLength / originalLength)
    });
    
    return compacted;
  }

  extractPreservedMessages(conversation) {
    if (!Array.isArray(conversation)) return [];
    
    return conversation.filter(msg => {
      const content = msg.content || msg.text || '';
      return this.config.preservePatterns.some(pattern => {
        const regex = new RegExp(pattern, 'i');
        return regex.test(content);
      });
    });
  }

  getSummarizableMessages(conversation) {
    if (!Array.isArray(conversation)) return [];
    
    const preservedIndices = new Set(
      conversation
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg }) => {
          const content = msg.content || msg.text || '';
          return this.config.preservePatterns.some(pattern => {
            const regex = new RegExp(pattern, 'i');
            return regex.test(content);
          });
        })
        .map(({ idx }) => idx)
    );
    
    return conversation.filter((_, idx) => !preservedIndices.has(idx));
  }

  async generateSummary(messages, model) {
    if (!model) {
      return this.simpleSummarize(messages);
    }
    
    const prompt = this.buildSummaryPrompt(messages);
    
    try {
      const summary = await model.generate({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: this.config.maxSummaryTokens || 500
      });
      
      return summary.content || summary.text || this.simpleSummarize(messages);
    } catch (error) {
      console.warn('Summary generation failed, using fallback:', error.message);
      return this.simpleSummarize(messages);
    }
  }

  buildSummaryPrompt(messages) {
    const messageTexts = messages.map((m, i) => {
      const role = m.role || 'unknown';
      const content = (m.content || m.text || '').substring(0, 200);
      return `[${i + 1}] ${role}: ${content}`;
    }).join('\n');
    
    return `Summarize the following conversation, preserving key decisions, code changes, and action items:

${messageTexts}

Summary (be concise but comprehensive):`;
  }

  simpleSummarize(messages) {
    const keyPoints = messages
      .map(m => m.content || m.text || '')
      .filter(content => content.length > 0)
      .slice(-5)
      .map(content => content.substring(0, 100));
    
    return `Previous conversation covered: ${keyPoints.join('; ')}`;
  }

  getCompactionStats() {
    if (this.compactionHistory.length === 0) {
      return { count: 0, avgCompression: 0, totalTokensSaved: 0 };
    }
    
    const totalSaved = this.compactionHistory.reduce((sum, h) => 
      sum + (h.originalTokens - h.summaryTokens), 0);
    
    return {
      count: this.compactionHistory.length,
      avgCompression: this.compactionHistory.reduce((sum, h) => 
        sum + h.compressionRatio, 0) / this.compactionHistory.length,
      totalTokensSaved: totalSaved,
      avgDuration: this.compactionHistory.reduce((sum, h) => 
        sum + h.duration, 0) / this.compactionHistory.length
    };
  }
}

module.exports = { CompactionEngine };
