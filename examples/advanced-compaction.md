# Advanced Compaction Guide

## Understanding Compaction Strategies

### How Compaction Works

1. **Token Estimation**: The proxy estimates tokens in real-time
2. **Threshold Check**: Compares against dynamic threshold
3. **Context Preservation**: Identifies critical messages to keep
4. **Summarization**: Condenses remaining conversation
5. **Replacement**: Substitutes old messages with summary

### Compaction Trigger Points

```
Conversation Growth
│
│        ┌─ Compaction happens here (dynamic)
│        ▼
██████████████████████████████████░░░░░░░░░░░░░░
│<─────────────── Context Window ──────────────>│
```

## Strategy Deep Dive

### Adaptive Strategy

The adaptive strategy learns from your usage:

```javascript
// Pseudo-code for adaptive threshold calculation
threshold = baseThreshold × (1 + (1 - accuracy) × 0.2)
```

Best for:
- Variable workloads
- Long-term usage
- Cost optimization focus

### Predictive Strategy

Uses trend analysis to predict when compaction is needed:

```javascript
// Predicts tokens after N more messages
predictedTokens = currentTokens × (growthRate ^ lookahead)
```

Best for:
- Consistent usage patterns
- Proactive optimization
- Large context windows

## Custom Patterns

### Preserving Critical Information

Edit `config/opencode.json`:

```json
{
  "compaction": {
    "preservePatterns": [
      "TODO|FIXME|NOTE|HACK",
      "^import\\s+",
      "^export\\s+",
      "^function\\s+\\w+",
      "^class\\s+\\w+",
      "error|exception|throw",
      "API_KEY|SECRET|PASSWORD",
      "@deprecated|@important"
    ]
  }
}
```

### Pattern Syntax

- Use regex patterns
- Case-insensitive by default
- Test patterns: `node -e "console.log(/pattern/.test('test string'))"`

## Performance Tuning

### Optimizing for Speed

```json
{
  "tokenEstimator": {
    "strategy": "static",
    "static": {
      "threshold": 0.6
    }
  }
}
```

### Optimizing for Cost

```json
{
  "compaction": {
    "mode": "aggressive",
    "smart": {
      "baseThreshold": 0.45
    }
  },
  "tokenEstimator": {
    "strategy": "adaptive",
    "adaptive": {
      "learningRate": 0.15
    }
  }
}
```

### Optimizing for Context Quality

```json
{
  "compaction": {
    "mode": "conservative",
    "preservePatterns": [
      ".*"
    ],
    "summarization": {
      "maxTokens": 1000
    }
  }
}
```

## Real-World Scenarios

### Scenario 1: Web Development Project

Long session with many file changes:

```json
{
  "compaction": {
    "mode": "smart",
    "preservePatterns": [
      "^import\\s+",
      "TODO|FIXME",
      "component|props|state"
    ]
  }
}
```

### Scenario 2: API Integration

Working with external APIs:

```json
{
  "compaction": {
    "preservePatterns": [
      "api|endpoint|url",
      "GET|POST|PUT|DELETE",
      "headers|authentication",
      "response|error"
    ]
  }
}
```

### Scenario 3: Refactoring

Large codebase refactoring:

```json
{
  "compaction": {
    "mode": "conservative",
    "preservePatterns": [
      "^class\\s+",
      "^function\\s+",
      "export|import",
      "interface|type\\s+",
      "@deprecated"
    ]
  }
}
```

## Monitoring and Analytics

### Dashboard Metrics

Access at `http://localhost:3456/dashboard`:

- **Total Requests**: Number of API calls
- **Input/Output Tokens**: Token breakdown
- **Estimated Cost**: Running cost estimate
- **Estimation Accuracy**: Token prediction accuracy
- **Current Threshold**: Active compaction threshold

### Programmatic Access

```bash
# Get current stats
curl http://localhost:3456/api/stats

# Example output:
{
  "stats": {
    "requests": 42,
    "tokens": {
      "input": 125000,
      "output": 45000
    },
    "cost": 1.23
  },
  "accuracy": {
    "samples": 42,
    "mape": 5.2,
    "confidence": 0.948
  }
}
```

### Custom Monitoring

```javascript
const axios = require('axios');

async function monitor() {
  const { data } = await axios.get('http://localhost:3456/api/stats');
  
  if (data.accuracy.mape > 10) {
    console.warn('Token estimation accuracy is degrading');
  }
  
  if (data.stats.cost > 10) {
    console.warn('Cost threshold exceeded');
  }
}

setInterval(monitor, 60000);
```

## Best Practices

### 1. Start Conservative

Begin with conservative settings and gradually optimize based on your usage patterns.

### 2. Monitor Accuracy

Keep estimation accuracy above 90% for optimal results.

### 3. Regular Reviews

Review compaction stats weekly:

```bash
npm run stats
```

### 4. Pattern Refinement

Adjust preserve patterns based on what information you find yourself needing.

### 5. Cost Tracking

Set up alerts for unexpected cost increases:

```javascript
// In your monitoring script
if (dailyCost > expectedCost * 1.5) {
  sendAlert('Cost spike detected');
}
```

## Common Pitfalls

### Too Aggressive Compaction

**Problem**: Losing important context
**Solution**: Add more preserve patterns or use conservative mode

### Too Conservative

**Problem**: High costs, slow performance
**Solution**: Switch to smart mode with adaptive threshold

### Poor Pattern Design

**Problem**: Preserving too much or too little
**Solution**: Test patterns with sample data

## Advanced Configuration

### Multi-Project Setup

Create project-specific configs:

```bash
config/
├── default.json        # Base configuration
├── project-a.json      # Web app settings
└── project-b.json      # API service settings
```

Switch configs:

```bash
OPENCODE_CONFIG=project-a npm start
```

### Integration with CI/CD

```yaml
# .github/workflows/compaction-check.yml
name: Compaction Check
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Start proxy
        run: npm start &
      - name: Run tests
        run: npm test
      - name: Check stats
        run: |
          sleep 5
          curl http://localhost:3456/api/stats
```

## Further Reading

- [OpenCode Context Management](https://opencode.ai/docs/context)
- [Kimi K2.5 Documentation](https://docs.moonshot.cn/)
- [Token Estimation Algorithms](../src/token-estimator.js)
