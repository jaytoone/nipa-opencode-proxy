const http = require('http');
const https = require('https');
const url = require('url');
const { TokenEstimator } = require('./token-estimator');

/**
 * NIPA-OpenCode Proxy Server
 * 
 * Intercepts OpenCode requests to:
 * 1. Estimate token usage before sending to API
 * 2. Determine optimal compaction timing
 * 3. Track costs and usage analytics
 */
class NIPAProxy {
  constructor(config = {}) {
    this.config = {
      port: config.port || 3456,
      host: config.host || 'localhost',
      nipaBaseUrl: config.nipaBaseUrl || 'https://api.nipa.cloud',
      ...config
    };
    
    this.tokenEstimator = new TokenEstimator(config.tokenEstimator);
    this.stats = {
      requests: 0,
      tokens: { input: 0, output: 0 },
      cost: 0,
      compactions: 0
    };
  }

  start() {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    server.listen(this.config.port, this.config.host, () => {
      console.log(`🚀 NIPA-OpenCode Proxy running on http://${this.config.host}:${this.config.port}`);
      console.log(`📊 Dashboard available at http://${this.config.host}:${this.config.port}/dashboard`);
    });

    return server;
  }

  async handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    
    if (parsedUrl.pathname === '/dashboard') {
      return this.serveDashboard(req, res);
    }
    
    if (parsedUrl.pathname === '/api/stats') {
      return this.serveStats(req, res);
    }

    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    }

    await this.proxyToNIPA(req, res);
  }

  async proxyToNIPA(req, res) {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);
        
        const estimate = this.tokenEstimator.estimate(requestData.messages || requestData);
        
        console.log(`📊 Estimated tokens: ${estimate.tokens.toLocaleString()} (threshold: ${(estimate.threshold * 100).toFixed(1)}%)`);
        
        if (estimate.shouldCompact) {
          console.log(`⚠️  Compaction recommended at ${estimate.tokens.toLocaleString()} tokens`);
        }

        const options = {
          hostname: url.parse(this.config.nipaBaseUrl).hostname,
          port: 443,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            'host': url.parse(this.config.nipaBaseUrl).hostname
          }
        };

        const proxyReq = https.request(options, (proxyRes) => {
          let responseBody = '';
          
          proxyRes.on('data', (chunk) => {
            responseBody += chunk;
          });
          
          proxyRes.on('end', () => {
            try {
              const responseData = JSON.parse(responseBody);
              
              if (responseData.usage) {
                const actualTokens = responseData.usage.total_tokens;
                this.tokenEstimator.feedback(estimate.tokens, actualTokens);
                
                this.stats.requests++;
                this.stats.tokens.input += responseData.usage.prompt_tokens || 0;
                this.stats.tokens.output += responseData.usage.completion_tokens || 0;
                
                const cost = this.calculateCost(responseData.usage);
                this.stats.cost += cost;
                
                console.log(`✅ Actual tokens: ${actualTokens.toLocaleString()} (cost: $${cost.toFixed(4)})`);
              }
              
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              res.end(responseBody);
            } catch (e) {
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              res.end(responseBody);
            }
          });
        });

        proxyReq.on('error', (error) => {
          console.error('Proxy error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy error', message: error.message }));
        });

        proxyReq.write(JSON.stringify(requestData));
        proxyReq.end();
        
      } catch (error) {
        console.error('Request processing error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request', message: error.message }));
      }
    });
  }

  calculateCost(usage) {
    const inputCost = (usage.prompt_tokens || 0) * 0.000005;
    const outputCost = (usage.completion_tokens || 0) * 0.000015;
    return inputCost + outputCost;
  }

  serveStats(req, res) {
    const accuracy = this.tokenEstimator.getAccuracy();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      stats: this.stats,
      accuracy,
      config: {
        strategy: this.tokenEstimator.config.strategy,
        threshold: this.tokenEstimator.strategy.currentThreshold || this.tokenEstimator.strategy.threshold
      }
    }, null, 2));
  }

  serveDashboard(req, res) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>NIPA-OpenCode Proxy Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
    .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-value { font-size: 32px; font-weight: bold; color: #0066cc; }
    .stat-label { color: #666; margin-top: 5px; }
    .refresh { margin: 20px 0; }
    .refresh button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .refresh button:hover { background: #0052a3; }
  </style>
</head>
<body>
  <h1>🚀 NIPA-OpenCode Proxy Dashboard</h1>
  <div class="refresh">
    <button onclick="loadStats()">🔄 Refresh</button>
    <span>Auto-refresh every 5 seconds</span>
  </div>
  <div class="stats" id="stats">
    <div class="stat-card">
      <div class="stat-value" id="requests">-</div>
      <div class="stat-label">Total Requests</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="input-tokens">-</div>
      <div class="stat-label">Input Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="output-tokens">-</div>
      <div class="stat-label">Output Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="cost">-</div>
      <div class="stat-label">Estimated Cost</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="accuracy">-</div>
      <div class="stat-label">Estimation Accuracy</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="threshold">-</div>
      <div class="stat-label">Current Threshold</div>
    </div>
  </div>
  <script>
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('requests').textContent = data.stats.requests.toLocaleString();
        document.getElementById('input-tokens').textContent = data.stats.tokens.input.toLocaleString();
        document.getElementById('output-tokens').textContent = data.stats.tokens.output.toLocaleString();
        document.getElementById('cost').textContent = '$' + data.stats.cost.toFixed(4);
        document.getElementById('accuracy').textContent = data.accuracy.mape ? (100 - data.accuracy.mape).toFixed(1) + '%' : 'N/A';
        document.getElementById('threshold').textContent = ((data.config.threshold || 0.5) * 100).toFixed(0) + '%';
      } catch (e) {
        console.error('Failed to load stats:', e);
      }
    }
    
    loadStats();
    setInterval(loadStats, 5000);
  </script>
</body>
</html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
}

module.exports = { NIPAProxy };

if (require.main === module) {
  const proxy = new NIPAProxy();
  proxy.start();
}
