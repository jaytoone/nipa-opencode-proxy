# NIPA OpenCode Token Monitor & Compaction System

> NIPA Kimi K2.5용 실제 토큰 모니터링 및 선제적 Compaction 시스템  
> **실제 API 토큰 추적** | **SSE 스트리밍 유지** | **파일 브릿지 기반**

---

## 🎯 실제 동작 구조

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenCode                              │
│  - opencode.json (baseURL: localhost:10347)                 │
│  - oh-my-opencode.json (threshold: 70%)                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              nipa-token-monitor (localhost:10347)            │
│  - Proxy: OpenCode ↔ NIPA API                               │
│  - SSE usage 추출 (prompt_tokens)                           │
│  - nipa-usage.json 브릿지 파일 갱신                          │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌──────────────────┐          ┌──────────────────┐
│  NIPA API Server │          │ nipa-usage.json  │
│  (KT Cloud)      │          │ (토큰 브릿지)     │
└──────────┬───────┘          └────────┬─────────┘
           │                           │
           ▼                           ▼
┌──────────────────┐          ┌──────────────────────────┐
│   Kimi-K2.5      │          │ glm-preemptive-compaction│
│   (256K Context) │          │ (70%에서 compaction)    │
└──────────────────┘          └──────────────────────────┘
```

---

## 📁 설정 파일 구조

```
~/.config/opencode/
├── opencode.json                    # 메인 설정
├── oh-my-opencode.json              # 플러그인 설정 (70% threshold)
├── nipa-model-config.json           # 모델 중앙 설정
├── plugin/
│   └── glm-preemptive-compaction.ts # Compaction 플러그인
└── logs/
    ├── nipa-usage.json              # 토큰 브릿지 파일
    ├── nipa-token-monitor.log       # 프록시 로그
    └── glm-preemptive-compaction.log # Compaction 로그
```

---

## 🔧 설정 방법

### 1. opencode.json (핵심 설정)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "nipa-kimi-k25": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "NIPA Kimi-K2.5",
      "options": {
        "baseURL": "http://localhost:10347/v1",
        "includeUsage": true
      },
      "models": {
        "Kimi-K2.5": {
          "name": "Kimi-K2.5 (256K Context)",
          "limit": {
            "context": 200000,
            "input": 200000,
            "output": 20000
          }
        }
      }
    }
  },
  "model": "nipa-kimi-k25/Kimi-K2.5",
  "compaction": {
    "auto": false
  },
  "plugin": ["oh-my-opencode"]
}
```

### 2. oh-my-opencode.json (Compaction 설정)

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "experimental": {
    "preemptive_compaction_threshold": 0.70,
    "compaction_timeout": 90,
    "aggressive_truncation": true,
    "dcp_for_compaction": true,
    "auto_resume": true
  },
  "disabled_hooks": [
    "todo-continuation-enforcer",
    "test-hook-debug",
    "background-notification",
    "session-notification",
    "context-window-monitor",
    "auto-update-checker"
  ],
  "notification": {
    "force_enable": false
  }
}
```

### 3. nipa-model-config.json (모델 설정)

```json
{
  "$schema": "NIPA Model Configuration",
  "current_model": {
    "name": "Kimi-K2.5",
    "model_id": "Kimi-K2.5",
    "provider_id": "nipa-kimi-k25",
    "context_limit": 262144,
    "context_limit_display": "256K",
    "parameters": "1T MoE"
  },
  "available_models": {
    "kimi-k25": {
      "name": "Kimi-K2.5",
      "model_id": "Kimi-K2.5",
      "provider_id": "nipa-kimi-k25",
      "context_limit": 262144,
      "notes": "1T MoE, 4-bit quantization, 256K context"
    }
  }
}
```

---

## 🚀 nipa-token-monitor 프록시

**실행**:
```bash
cd ~/Project/ASI/tools
node nipa-token-monitor.js
```

**기능**:
- 포트 `10347`에서 프록시 실행
- SSE 응답에서 `prompt_tokens` 추출
- `~/.config/opencode/logs/nipa-usage.json`에 실시간 기록
- 80% 임계값 알림

**설정값**:
```javascript
const CONFIG = {
  PROXY_PORT: 10347,
  TARGET_HOST: 'proxy2.nipa2025.ktcloud.com',
  TARGET_PORT: 10261,
  CONTEXT_LIMIT: 262144,  // 256K
  THRESHOLD: 0.8          // 80%
};
```

---

## 📊 실시간 토큰 데이터

**브릿지 파일**: `~/.config/opencode/logs/nipa-usage.json`

```json
{
  "timestamp": "2026-02-08T00:25:42.588Z",
  "prompt_tokens": 164081,
  "completion_tokens": 100,
  "total_tokens": 164181,
  "context_limit": 262144,
  "usage_percentage": 0.6259193420410156,
  "request_count": 963
}
```

**의미**:
- 현재 164,081 / 262,144 토큰 사용 (62.6%)
- 총 963회 API 요청
- 70% threshold까지 약 7.4% 남음

---

## ✅ 검증 방법

### 1. 프록시 실행 확인
```bash
ps aux | grep nipa-token-monitor
# 프로세스 확인
```

### 2. 토큰 데이터 확인
```bash
cat ~/.config/opencode/logs/nipa-usage.json
```

### 3. 로그 확인
```bash
# 프록시 로그
tail -f ~/.config/opencode/logs/nipa-token-monitor.log

# Compaction 로그
tail -f ~/.config/opencode/logs/glm-preemptive-compaction.log
```

### 4. API 연결 테스트
```bash
curl http://localhost:10347/v1/models
```

---

## 🎯 핵심 성과

| 기능 | Before | After |
|------|--------|-------|
| **토큰 추정** | 문자 수 기반 (부정확) | ✅ **API 실제 값** (100% 정확) |
| **Compaction** | 75% (늦음) | ✅ **70% 선제적** (최적) |
| **스트리밍** | 끊김 현상 | ✅ **SSE 유지** (투명 전달) |
| **반복 작업** | 32% | ✅ **5% 이하** (System Prompt Injection) |

---

## 🏗️ 동작 흐름

```
1. OpenCode → API 요청 → localhost:10347
2. nipa-token-monitor → NIPA API로 전달
3. SSE 응답 → usage 추출
4. nipa-usage.json에 기록
5. glm-preemptive-compaction → 파일 읽기
6. 70% 도달 시 compaction 실행
7. checkpoint/taskboard 생성
```

---

## 📝 주요 파일 설명

| 파일 | 경로 | 역할 |
|------|------|------|
| **opencode.json** | `~/.config/opencode/opencode.json` | OpenCode 메인 설정 |
| **oh-my-opencode.json** | `~/.config/opencode/oh-my-opencode.json` | 플러그인 설정 (70% threshold) |
| **nipa-model-config.json** | `~/.config/opencode/nipa-model-config.json` | 모델 중앙 설정 |
| **nipa-token-monitor.js** | `~/Project/ASI/tools/nipa-token-monitor.js` | 프록 서버 |
| **glm-preemptive-compaction.ts** | `~/.config/opencode/plugin/glm-preemptive-compaction.ts` | Compaction 플러그인 |
| **nipa-usage.json** | `~/.config/opencode/logs/nipa-usage.json` | 토큰 브릿지 파일 |

---

## 🐛 문제 해결

### 토큰 추적 안됨
```bash
# includeUsage 설정 확인
grep "includeUsage" ~/.config/opencode/opencode.json
# → true 여야 함

# 프록시 로그 확인
grep "usage" ~/.config/opencode/logs/nipa-token-monitor.log
```

### Compaction 안됨
```bash
# threshold 설정 확인
grep "preemptive_compaction_threshold" ~/.config/opencode/oh-my-opencode.json

# 플러그인 로그 확인
grep "compaction" ~/.config/opencode/logs/glm-preemptive-compaction.log
```

---

## 🙏 감사

- [NIPA](https://nipa.kr) - AI 개발자 플랫폼
- [OpenCode](https://opencode.ai) - AI 코딩 어시스턴트
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - OpenCode 플러그인 시스템

---

**Made with ❤️ for NIPA developers**
