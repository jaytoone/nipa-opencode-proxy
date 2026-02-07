# Basic Usage Guide

## Quick Start

### 1. Installation

```bash
git clone https://github.com/YOUR_USERNAME/nipa-opencode-proxy.git
cd nipa-opencode-proxy
npm install
```

### 2. Configure NIPA API Key

```bash
export NIPA_API_KEY="your-api-key-here"
```

### 3. Start the Proxy

```bash
npm start
```

You should see:
```
🚀 NIPA-OpenCode Proxy running on http://localhost:3456
📊 Dashboard available at http://localhost:3456/dashboard
```

### 4. Configure OpenCode

Create or edit `~/.config/opencode/settings.json`:

```json
{
  "proxy": {
    "url": "http://localhost:3456"
  }
}
```

Or set environment variable:

```bash
export OPENCODE_PROXY_URL=http://localhost:3456
```

### 5. Run OpenCode

```bash
opencode
```

## Verification

Check if proxy is working:

```bash
# Health check
curl http://localhost:3456/health

# View stats
curl http://localhost:3456/api/stats | jq

# Open dashboard
open http://localhost:3456/dashboard
```

## Configuration Options

### Token Estimation Strategy

Edit `config/opencode.json`:

```json
{
  "tokenEstimator": {
    "strategy": "adaptive",
    "adaptive": {
      "learningRate": 0.1,
      "windowSize": 10
    }
  }
}
```

Strategies:
- `static`: Fixed threshold
- `adaptive`: Learns from your usage patterns
- `predictive`: Uses trend analysis

### Compaction Modes

```json
{
  "compaction": {
    "mode": "smart",
    "smart": {
      "baseThreshold": 0.5,
      "minThreshold": 0.4,
      "maxThreshold": 0.7
    }
  }
}
```

Modes:
- `smart`: Balanced (recommended)
- `aggressive`: Maximum savings
- `conservative`: Maximum context preservation

## Common Use Cases

### Long Coding Sessions

For sessions longer than 2 hours, use adaptive strategy:

```json
{
  "tokenEstimator": {
    "strategy": "adaptive"
  },
  "compaction": {
    "mode": "smart"
  }
}
```

### Cost-Sensitive Projects

For maximum cost savings:

```json
{
  "compaction": {
    "mode": "aggressive",
    "preservePatterns": [
      "TODO|FIXME",
      "^import\\s+"
    ]
  }
}
```

### Context-Critical Work

When you need maximum context retention:

```json
{
  "compaction": {
    "mode": "conservative"
  },
  "tokenEstimator": {
    "strategy": "predictive"
  }
}
```

## Troubleshooting

### Proxy not starting

Check if port 3456 is available:
```bash
lsof -i :3456
```

Change port in `config/opencode.json`:
```json
{
  "proxy": {
    "port": 3457
  }
}
```

### OpenCode not using proxy

Verify environment variable:
```bash
echo $OPENCODE_PROXY_URL
```

### High memory usage

Enable aggressive compaction mode or restart proxy periodically.

## Next Steps

- Read [Advanced Compaction Guide](./advanced-compaction.md)
- Check [Benchmark Results](../benchmarks/results.md)
- Customize [Configuration](../config/opencode.json)
