#!/usr/bin/env node
/**
 * NIPA GLM API Token Monitor - Standalone Proxy
 *
 * OpenCode와 NIPA API 사이에서 동작하는 투명 프록시
 * - 모든 API 요청/응답 intercept
 * - usage 정보 실시간 추출 및 로깅
 * - 80% 도달 시 경고
 * - OpenCode 플러그인 시스템과 독립적으로 동작
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 중앙화된 모델 설정 로드
function loadModelConfig() {
  const configPath = path.join(process.env.HOME, '.config', 'opencode', 'nipa-model-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.current_model;
  } catch (e) {
    console.warn('Failed to load nipa-model-config.json, using defaults');
    return { context_limit: 262144, model_id: 'Kimi-K2.5' };
  }
}

const MODEL_CONFIG = loadModelConfig();

// 설정
const CONFIG = {
  PROXY_PORT: 10347,
  TARGET_HOST: 'proxy2.nipa2025.ktcloud.com',
  TARGET_PORT: 10261,
  CONTEXT_LIMIT: MODEL_CONFIG.context_limit,  // from nipa-model-config.json
  THRESHOLD: 0.8, // 80%
  LOG_DIR: path.join(process.env.HOME, '.config', 'opencode', 'logs'),
  LOG_FILE: 'nipa-token-monitor.log',
  USAGE_FILE: 'nipa-usage.json',  // 플러그인 브릿지용 usage 파일
  RESPONSE_LOG: 'nipa-responses.jsonl'  // assistant 응답 로그
};

// 세션별 토큰 추적
const sessionTokens = new Map();

// 로그 디렉토리 생성
if (!fs.existsSync(CONFIG.LOG_DIR)) {
  fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
}

const logFilePath = path.join(CONFIG.LOG_DIR, CONFIG.LOG_FILE);

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data })
  };

  const logLine = `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;

  // 파일 로그
  fs.appendFileSync(logFilePath, logLine, 'utf-8');

  // 콘솔 출력 (중요한 것만)
  if (level === 'WARN' || level === 'ERROR' || level === 'ALERT') {
    console.log(logLine.trim());
  }
}

function extractUsageFromResponse(responseBody) {
  try {
    const data = JSON.parse(responseBody);
    return data.usage || null;
  } catch (error) {
    return null;
  }
}

// 누적 요청 수
let requestCount = 0;

function writeUsageFile(usage) {
  try {
    const usageFilePath = path.join(CONFIG.LOG_DIR, CONFIG.USAGE_FILE);
    const data = {
      timestamp: new Date().toISOString(),
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      context_limit: CONFIG.CONTEXT_LIMIT,
      usage_percentage: (usage.prompt_tokens || 0) / CONFIG.CONTEXT_LIMIT,
      request_count: requestCount
    };
    fs.writeFileSync(usageFilePath, JSON.stringify(data, null, 2), 'utf-8');
    log('INFO', 'Usage file written', { path: usageFilePath, prompt_tokens: data.prompt_tokens });
  } catch (e) {
    log('ERROR', 'Failed to write usage file', { error: e.message });
  }
}

function trackTokenUsage(sessionId, usage) {
  if (!usage) return;

  const promptTokens = usage.prompt_tokens || 0;
  const usagePercentage = promptTokens / CONFIG.CONTEXT_LIMIT;

  sessionTokens.set(sessionId, {
    promptTokens,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    usagePercentage,
    timestamp: Date.now()
  });

  log('INFO', 'Token usage tracked', {
    sessionId,
    promptTokens,
    percentage: `${(usagePercentage * 100).toFixed(1)}%`,
    threshold: `${(CONFIG.THRESHOLD * 100).toFixed(0)}%`
  });

  // 파일 브릿지: usage JSON 기록
  writeUsageFile(usage);

  // 임계값 체크
  if (usagePercentage >= CONFIG.THRESHOLD) {
    log('ALERT', 'THRESHOLD REACHED! Compaction recommended!', {
      sessionId,
      promptTokens,
      percentage: `${(usagePercentage * 100).toFixed(1)}%`
    });
  } else if (usagePercentage >= CONFIG.THRESHOLD * 0.9) {
    log('WARN', 'Approaching threshold (90%)', {
      sessionId,
      promptTokens,
      percentage: `${(usagePercentage * 100).toFixed(1)}%`
    });
  }
}

// SSE 청크에서 assistant content 추출
function extractContentFromSSE(sseBuffer) {
  const lines = sseBuffer.split('\n');
  let content = '';
  let reasoningContent = '';

  for (const line of lines) {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try {
        const data = JSON.parse(line.slice(6));
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) content += delta.content;
        if (delta?.reasoning_content) reasoningContent += delta.reasoning_content;
      } catch (e) {}
    }
  }
  return { content, reasoning: reasoningContent };
}

// assistant 응답을 JSONL 파일에 기록
function logResponse(extracted, usage) {
  try {
    const responseLogPath = path.join(CONFIG.LOG_DIR, CONFIG.RESPONSE_LOG);
    const entry = {
      timestamp: new Date().toISOString(),
      reasoning: extracted.reasoning || undefined,
      content: extracted.content || undefined,
      tokens: usage ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens } : null,
      request_num: requestCount
    };
    fs.appendFileSync(responseLogPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    log('ERROR', 'Failed to write response log', { error: e.message });
  }
}

// SSE 청크에서 usage 추출
function extractUsageFromSSE(sseBuffer) {
  const lines = sseBuffer.split('\n');
  let lastUsage = null;

  for (const line of lines) {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.usage) {
          lastUsage = data.usage;
        }
      } catch (e) {
        // 파싱 불가한 청크 무시
      }
    }
  }
  return lastUsage;
}

// Proxy 서버 생성
const proxyServer = http.createServer((req, res) => {
  let requestBody = '';

  req.on('data', chunk => {
    requestBody += chunk.toString();
  });

  req.on('end', () => {
    let modifiedBody = requestBody;
    let modifiedHeaders = { ...req.headers };
    let isStreamingRequest = false;

    // 스트리밍 유지 + stream_options.include_usage 추가
    if (requestBody && req.url.includes('/chat/completions')) {
      try {
        const bodyData = JSON.parse(requestBody);
        isStreamingRequest = bodyData.stream === true;

        if (isStreamingRequest) {
          // usage를 스트리밍 마지막 청크에 포함시키도록 요청
          bodyData.stream_options = { include_usage: true };
          modifiedBody = JSON.stringify(bodyData);
          modifiedHeaders['content-length'] = Buffer.byteLength(modifiedBody);
        }

        log('DEBUG', 'Request intercepted', {
          streaming: isStreamingRequest,
          hasStreamOptions: !!bodyData.stream_options
        });
      } catch (e) {
        log('WARN', 'Failed to parse request body', { error: e.message });
      }
    }

    requestCount++;

    // NIPA 쿠키 주입 (환경변수에서 읽음)
    const nipaCookie = process.env.NIPA_COOKIE || '';
    if (nipaCookie) {
      modifiedHeaders['cookie'] = nipaCookie;
    }

    const options = {
      hostname: CONFIG.TARGET_HOST,
      port: CONFIG.TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...modifiedHeaders,
        host: CONFIG.TARGET_HOST
      },
      rejectUnauthorized: false  // NIPA 인증서 검증 스킵
    };

    const proxyReq = https.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isSSE = contentType.includes('text/event-stream');

      if (isSSE) {
        // === SSE 투명 전달 + usage 추출 ===
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        let sseBuffer = '';

        proxyRes.on('data', (chunk) => {
          // 클라이언트에 즉시 전달 (지연 없음)
          res.write(chunk);
          sseBuffer += chunk.toString();
        });

        proxyRes.on('end', () => {
          res.end();

          // 스트림 종료 후 usage 추출 + 응답 로깅
          const usage = extractUsageFromSSE(sseBuffer);
          const extracted = extractContentFromSSE(sseBuffer);
          if (extracted.content || extracted.reasoning) {
            logResponse(extracted, usage);
          }
          if (usage) {
            let sessionId = 'default';
            try {
              const reqData = JSON.parse(requestBody);
              sessionId = reqData.session_id || reqData.sessionId || 'default';
            } catch (e) {}
            trackTokenUsage(sessionId, usage);
            log('INFO', 'SSE usage extracted', { prompt_tokens: usage.prompt_tokens });
          } else {
            log('WARN', 'No usage in SSE stream (NIPA may not support stream_options.include_usage)');
          }
        });
      } else {
        // === 비스트리밍: 전체 응답 수집 ===
        let responseBody = '';
        proxyRes.on('data', chunk => { responseBody += chunk.toString(); });

        proxyRes.on('end', () => {
          const usage = extractUsageFromResponse(responseBody);
          // 비SSE 응답 로깅
          try {
            const resData = JSON.parse(responseBody);
            const msg = resData.choices?.[0]?.message;
            const extracted = { content: msg?.content || '', reasoning: msg?.reasoning_content || '' };
            if (extracted.content || extracted.reasoning) logResponse(extracted, usage);
          } catch (e) {}
          if (usage) {
            let sessionId = 'default';
            try {
              const reqData = JSON.parse(requestBody);
              sessionId = reqData.session_id || reqData.sessionId || 'default';
            } catch (e) {}
            trackTokenUsage(sessionId, usage);
          }

          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(responseBody);
        });
      }
    });

    proxyReq.on('error', (error) => {
      log('ERROR', 'Proxy request failed', { error: error.message });
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway: ' + error.message);
    });

    if (modifiedBody) {
      proxyReq.write(modifiedBody);
    }
    proxyReq.end();
  });
});

// 서버 시작
proxyServer.listen(CONFIG.PROXY_PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  NIPA Token Monitor Proxy                                    ║
╚══════════════════════════════════════════════════════════════╝

✅ Proxy server running on: http://localhost:${CONFIG.PROXY_PORT}
🎯 Target API: https://${CONFIG.TARGET_HOST}:${CONFIG.TARGET_PORT}
📊 Context limit: ${CONFIG.CONTEXT_LIMIT} tokens
⚠️  Threshold: ${(CONFIG.THRESHOLD * 100).toFixed(0)}%
📝 Log file: ${logFilePath}

📌 OpenCode Configuration:
   Update opencode.json:
   {
     "provider": {
       "nipa-glm-tool-calling": {
         "options": {
           "baseURL": "http://localhost:${CONFIG.PROXY_PORT}/v1"
         }
       }
     }
   }

Press Ctrl+C to stop
  `);

  log('INFO', 'Proxy server started', {
    port: CONFIG.PROXY_PORT,
    target: `${CONFIG.TARGET_HOST}:${CONFIG.TARGET_PORT}`
  });
});

// 종료 처리
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down proxy server...');
  log('INFO', 'Proxy server stopped');

  // 최종 통계 출력
  console.log('\n📊 Session Statistics:');
  for (const [sessionId, data] of sessionTokens.entries()) {
    console.log(`  ${sessionId}: ${data.totalTokens} tokens (${(data.usagePercentage * 100).toFixed(1)}%)`);
  }

  process.exit(0);
});

// 에러 처리
process.on('uncaughtException', (error) => {
  log('ERROR', 'Uncaught exception', { error: error.message, stack: error.stack });
  console.error('Fatal error:', error);
  process.exit(1);
});
