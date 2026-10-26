import type {
  RunSummary,
  TestItem,
  GraphData,
} from '../types';

export const FIXTURE_RUNS: RunSummary[] = [
  {
    id: 'run-auth-regression',
    project: 'auth-service',
    gitRevision: '9f3c82d7a1',
    gitBranch: 'feat/jwt-sessions',
    commitMessage: 'refactor(auth): migrate token validation to new session store',
    status: 'completed',
    startedAt: '2026-10-26T10:14:02.000Z',
    completedAt: '2026-10-26T10:14:02.420Z',
    durationMs: 420,
    isFixture: true,
    fixtureLabel: 'Sample data (fixture): auth-service regression',
    stats: {
      totalTests: 6,
      passed: 3,
      failed: 1,
      errored: 1,
      skipped: 1,
      totalNodes: 15,
      codeNodes: 10,
      modifiedNodes: 1,
      addedNodes: 4,
      totalChangedNodes: 5,
      coveragePct: 78.4,
    },
    limitations: [
      "Coverage tracing active only on project package 'auth/'. External site-packages and stdlib excluded.",
      'Observed, not proven cause: validate_token was modified in HEAD and executed during test_login_expired_token, but root cause has not been independently proven.',
      'Static AST analyzer does not resolve dynamic getattr() or sys.modules alterations.',
      'Asyncio task interleaving is captured as entry points, not wall-clock instruction steps.',
    ],
    notes: [
      'Fixture represents a real regression scenario in a token validation refactor.',
      'Replay comparison: same failure recurred in 3 of 3 recorded trials (FP-AUTH-TOK-52).',
    ],
  },
  {
    id: 'run-empty-scan',
    project: 'empty-repo',
    gitRevision: 'a1b2c3d4e5',
    gitBranch: 'main',
    commitMessage: 'initial repository skeleton',
    status: 'empty',
    startedAt: '2026-10-26T09:30:10.000Z',
    completedAt: '2026-10-26T09:30:10.045Z',
    durationMs: 45,
    isFixture: true,
    fixtureLabel: 'Sample data (fixture): empty test run',
    stats: {
      totalTests: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      skipped: 0,
      totalNodes: 0,
      modifiedNodes: 0,
      coveragePct: 0,
    },
    limitations: [
      'Scan completed with 0 test items discovered in directory tree.',
      'Searched patterns: test_*.py, *_test.py in tests/ and root.',
      'No pytest tests or execution evidence available for this revision.',
    ],
    notes: ['Used to verify empty state behavior and guidance UI.'],
  },
  {
    id: 'run-failed-harness',
    project: 'payment-gateway',
    gitRevision: '8e7d6c5b4a',
    gitBranch: 'fix/stripe-webhook',
    commitMessage: 'wip: update webhook signature verification',
    status: 'failed',
    startedAt: '2026-10-26T08:15:22.000Z',
    completedAt: '2026-10-26T08:15:22.140Z',
    durationMs: 140,
    isFixture: true,
    fixtureLabel: 'Sample data (fixture): collection failure',
    errorMessage:
      "pytest.CollectionError: ModuleNotFoundError: No module named 'pytest_mock'. Environment dependency is missing.",
    stats: {
      totalTests: 0,
      passed: 0,
      failed: 0,
      errored: 1,
      skipped: 0,
      totalNodes: 8,
      modifiedNodes: 1,
      coveragePct: 0,
    },
    limitations: [
      'Execution runner aborted during pytest collection phase.',
      'No runtime test traces could be collected.',
      'Only static AST structural nodes are visible in the repository graph.',
    ],
    notes: ['Used to verify harness error reporting and failure diagnostics.'],
  },
];

export const FIXTURE_TESTS: Record<string, TestItem[]> = {
  'run-auth-regression': [
    {
      id: 'tests/test_auth.py::test_login_expired_token',
      name: 'test_login_expired_token',
      file: 'tests/test_auth.py',
      status: 'fail',
      durationMs: 38,
      failureMessage:
        "AssertionError: assert False is True (Expected TokenExpiredError, but got InvalidClaimError: 'exp' claim is not numeric: 1718000000)",
      traceback: `Traceback (most recent call last):
  File "/workspace/auth-service/tests/test_auth.py", line 42, in test_login_expired_token
    result = login_with_token(expired_token)
  File "/workspace/auth-service/auth/service.py", line 64, in login_with_token
    claims = validate_token(token, leeway=0)
  File "/workspace/auth-service/auth/tokens.py", line 52, in validate_token
    raise InvalidClaimError(f"'exp' claim is not numeric: {claims['exp']}")
AssertionError: assert False is True`,
      rerunHistory: [
        {
          rerunIndex: 1,
          status: 'fail',
          durationMs: 39,
          timestamp: '2026-10-26T10:14:02.100Z',
          failureFingerprint: 'FP-AUTH-TOK-52',
          sameFailureRecurred: true,
          comparisonResult: 'identical_failure',
          message: 'Same failure fingerprint matched: InvalidClaimError at tokens.py:52',
        },
        {
          rerunIndex: 2,
          status: 'fail',
          durationMs: 36,
          timestamp: '2026-10-26T10:14:02.180Z',
          failureFingerprint: 'FP-AUTH-TOK-52',
          sameFailureRecurred: true,
          comparisonResult: 'identical_failure',
          message: 'Same failure fingerprint matched: InvalidClaimError at tokens.py:52',
        },
        {
          rerunIndex: 3,
          status: 'fail',
          durationMs: 41,
          timestamp: '2026-10-26T10:14:02.260Z',
          failureFingerprint: 'FP-AUTH-TOK-52',
          sameFailureRecurred: true,
          comparisonResult: 'identical_failure',
          message: 'Same failure fingerprint matched: InvalidClaimError at tokens.py:52',
        },
      ],
      exercisedNodeIds: [
        'tests/test_auth.py::test_login_expired_token',
        'auth/service.py::login_with_token',
        'auth/tokens.py::validate_token',
        'auth/tokens.py::decode_jwt_header',
        'auth/crypto.py::verify_signature',
        'auth/crypto.py::parse_public_key',
      ],
      unresolvedReferences: ['auth.tokens.audit_logger'],
    },
    {
      id: 'tests/test_auth.py::test_login_valid_token',
      name: 'test_login_valid_token',
      file: 'tests/test_auth.py',
      status: 'pass',
      durationMs: 18,
      rerunHistory: [],
      exercisedNodeIds: [
        'tests/test_auth.py::test_login_valid_token',
        'auth/service.py::login_with_token',
        'auth/tokens.py::validate_token',
        'auth/tokens.py::decode_jwt_header',
        'auth/crypto.py::verify_signature',
        'auth/crypto.py::parse_public_key',
      ],
    },
    {
      id: 'tests/test_sessions.py::test_session_create',
      name: 'test_session_create',
      file: 'tests/test_sessions.py',
      status: 'pass',
      durationMs: 24,
      rerunHistory: [],
      exercisedNodeIds: [
        'tests/test_sessions.py::test_session_create',
        'auth/sessions.py::create_session',
        'auth/sessions.py::SessionStore.put',
      ],
    },
    {
      id: 'tests/test_sessions.py::test_session_invalidation',
      name: 'test_session_invalidation',
      file: 'tests/test_sessions.py',
      status: 'pass',
      durationMs: 16,
      rerunHistory: [],
      exercisedNodeIds: [
        'tests/test_sessions.py::test_session_invalidation',
        'auth/sessions.py::SessionStore.invalidate',
      ],
    },
    {
      id: 'tests/test_auth.py::test_rate_limit_backend',
      name: 'test_rate_limit_backend',
      file: 'tests/test_auth.py',
      status: 'error',
      durationMs: 120,
      failureMessage:
        'ConnectionRefusedError: [Errno 61] Redis connection failed on 127.0.0.1:6379',
      traceback: `Traceback (most recent call last):
  File "/workspace/auth-service/tests/test_auth.py", line 98, in test_rate_limit_backend
    limiter = RedisRateLimiter(host="127.0.0.1", port=6379)
  File "/workspace/auth-service/auth/limiter.py", line 24, in __init__
    self._conn.ping()
ConnectionRefusedError: [Errno 61] Connection refused`,
      rerunHistory: [
        {
          rerunIndex: 1,
          status: 'error',
          durationMs: 110,
          timestamp: '2026-10-26T10:14:02.320Z',
          message: 'Redis connection failed (harness environment dependency missing)',
        },
      ],
      exercisedNodeIds: [
        'tests/test_auth.py::test_rate_limit_backend',
        'auth/limiter.py::RedisRateLimiter.__init__',
      ],
    },
    {
      id: 'tests/test_auth.py::test_oauth2_pkce_flow',
      name: 'test_oauth2_pkce_flow',
      file: 'tests/test_auth.py',
      status: 'skipped',
      durationMs: 2,
      failureMessage:
        'Skipped: PyCA/cryptography >= 42.0.0 required for PKCE hardware curve acceleration',
      rerunHistory: [],
      exercisedNodeIds: [],
    },
  ],
  'run-empty-scan': [],
  'run-failed-harness': [],
};

export const FIXTURE_GRAPH: Record<string, GraphData> = {
  'run-auth-regression': {
    nodes: [
      {
        id: 'tests/test_auth.py::test_login_expired_token',
        file: 'tests/test_auth.py',
        name: 'test_login_expired_token',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 38,
        lineEnd: 50,
        changeStatus: 'unchanged',
        sourceSnippet: `def test_login_expired_token():
    """Verify expired JWT token triggers TokenExpiredError."""
    expired_token = create_test_token(exp_offset=-3600)
    with pytest.raises(TokenExpiredError):
        login_with_token(expired_token)`,
      },
      {
        id: 'tests/test_auth.py::test_login_valid_token',
        file: 'tests/test_auth.py',
        name: 'test_login_valid_token',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 25,
        lineEnd: 36,
        changeStatus: 'unchanged',
        sourceSnippet: `def test_login_valid_token():
    """Ensure valid active token successfully logs in user."""
    token = create_test_token(exp_offset=3600)
    user = login_with_token(token)
    assert user.is_authenticated is True`,
      },
      {
        id: 'tests/test_sessions.py::test_session_create',
        file: 'tests/test_sessions.py',
        name: 'test_session_create',
        kind: 'function',
        parentModule: 'tests/test_sessions.py',
        lineStart: 10,
        lineEnd: 22,
        changeStatus: 'unchanged',
        sourceSnippet: `def test_session_create():
    sess = create_session("usr_998")
    assert sess.session_id.startswith("sess_")`,
      },
      {
        id: 'tests/test_sessions.py::test_session_invalidation',
        file: 'tests/test_sessions.py',
        name: 'test_session_invalidation',
        kind: 'function',
        parentModule: 'tests/test_sessions.py',
        lineStart: 24,
        lineEnd: 35,
        changeStatus: 'unchanged',
        sourceSnippet: `def test_session_invalidation():
    store = SessionStore()
    sess = store.put("usr_123")
    assert store.invalidate(sess.session_id) is True`,
      },
      {
        id: 'tests/test_auth.py::test_rate_limit_backend',
        file: 'tests/test_auth.py',
        name: 'test_rate_limit_backend',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 90,
        lineEnd: 104,
        changeStatus: 'unchanged',
        sourceSnippet: `def test_rate_limit_backend():
    limiter = RedisRateLimiter(host="127.0.0.1", port=6379)
    assert limiter.check("client_1") is True`,
      },
      {
        id: 'auth/service.py::login_with_token',
        file: 'auth/service.py',
        name: 'login_with_token',
        kind: 'function',
        parentModule: 'auth/service.py',
        lineStart: 55,
        lineEnd: 72,
        changeStatus: 'unchanged',
        sourceSnippet: `def login_with_token(token: str) -> UserSession:
    """Orchestrate token decode, validation, and session registration."""
    claims = validate_token(token, leeway=0)
    user_id = claims["sub"]
    return create_session(user_id)`,
      },
      {
        id: 'auth/tokens.py::validate_token',
        file: 'auth/tokens.py',
        name: 'validate_token',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 43,
        lineEnd: 59,
        changeStatus: 'modified',
        sourceSnippet: `def validate_token(token: str, leeway: int = 0) -> dict:
    """Validate token signature, expiration, and registered claims."""
    header = decode_jwt_header(token)
    claims = verify_signature(token, header["alg"])
    current_time = int(time.time())

    # MODIFIED: strict claim type check refactoring
    exp_val = claims.get("exp")
    if not isinstance(exp_val, (int, float)):
        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")

    if exp_val < (current_time - leeway):
        raise TokenExpiredError(f"Signature expired at {exp_val}")

    if "audit_logger" in globals():
        audit_logger.record(claims["sub"])
    return claims`,
        gitDiff: `--- a/auth/tokens.py
+++ b/auth/tokens.py
@@ -47,11 +47,14 @@ def validate_token(token: str, leeway: int = 0) -> dict:
     claims = verify_signature(token, header["alg"])
     current_time = int(time.time())
-    if claims.get("exp", 0) < (current_time - leeway):
-        raise TokenExpiredError("Token expired")
+
+    # MODIFIED: strict claim type check refactoring
+    exp_val = claims.get("exp")
+    if not isinstance(exp_val, (int, float)):
+        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")
+    if exp_val < (current_time - leeway):
+        raise TokenExpiredError(f"Signature expired at {exp_val}")
     return claims`,
      },
      {
        id: 'auth/tokens.py::decode_jwt_header',
        file: 'auth/tokens.py',
        name: 'decode_jwt_header',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 18,
        lineEnd: 33,
        changeStatus: 'unchanged',
        sourceSnippet: `def decode_jwt_header(token: str) -> dict:
    raw_header = token.split(".")[0]
    padded = raw_header + "=" * (-len(raw_header) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))`,
      },
      {
        id: 'auth/crypto.py::verify_signature',
        file: 'auth/crypto.py',
        name: 'verify_signature',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 40,
        lineEnd: 65,
        changeStatus: 'unchanged',
        sourceSnippet: `def verify_signature(token: str, alg: str) -> dict:
    parts = token.split(".")
    payload, sig = parts[1], parts[2]
    key = parse_public_key(alg)
    hmac_val = hmac.new(key, payload.encode(), hashlib.sha256).digest()
    return json.loads(base64.urlsafe_b64decode(payload + "=="))`,
      },
      {
        id: 'auth/crypto.py::parse_public_key',
        file: 'auth/crypto.py',
        name: 'parse_public_key',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 15,
        lineEnd: 38,
        changeStatus: 'unchanged',
        sourceSnippet: `def parse_public_key(alg: str) -> bytes:
    if alg != "HS256":
        raise ValueError(f"Unsupported algorithm: {alg}")
    return b"secret-development-signing-key"`,
      },
      {
        id: 'auth/sessions.py::create_session',
        file: 'auth/sessions.py',
        name: 'create_session',
        kind: 'function',
        parentModule: 'auth/sessions.py',
        lineStart: 12,
        lineEnd: 26,
        changeStatus: 'added',
        sourceSnippet: `def create_session(user_id: str) -> UserSession:
    """Allocate new session record and persist in active store."""
    store = SessionStore()
    return store.put(user_id)`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,15 @@
+def create_session(user_id: str) -> UserSession:
+    """Allocate new session record and persist in active store."""
+    store = SessionStore()
+    return store.put(user_id)`,
      },
      {
        id: 'auth/sessions.py::SessionStore',
        file: 'auth/sessions.py',
        name: 'SessionStore',
        kind: 'class',
        parentModule: 'auth/sessions.py',
        lineStart: 28,
        lineEnd: 60,
        changeStatus: 'added',
        sourceSnippet: `class SessionStore:
    def __init__(self):
        self._sessions = {}
        
    def put(self, user_id: str) -> UserSession:
        sid = f"sess_{secrets.token_hex(8)}"
        sess = UserSession(sid, user_id, time.time())
        self._sessions[sid] = sess
        return sess

    def invalidate(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,14 @@
+class SessionStore:
+    def __init__(self):
+        self._sessions = {}`,
      },
      {
        id: 'auth/sessions.py::SessionStore.put',
        file: 'auth/sessions.py',
        name: 'put',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 33,
        lineEnd: 42,
        changeStatus: 'added',
        sourceSnippet: `    def put(self, user_id: str) -> UserSession:
        sid = f"sess_{secrets.token_hex(8)}"
        sess = UserSession(sid, user_id, time.time())
        self._sessions[sid] = sess
        return sess`,
      },
      {
        id: 'auth/sessions.py::SessionStore.invalidate',
        file: 'auth/sessions.py',
        name: 'invalidate',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 44,
        lineEnd: 48,
        changeStatus: 'added',
        sourceSnippet: `    def invalidate(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None`,
      },
      {
        id: 'auth/limiter.py::RedisRateLimiter.__init__',
        file: 'auth/limiter.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/limiter.py',
        lineStart: 18,
        lineEnd: 26,
        changeStatus: 'unchanged',
        sourceSnippet: `    def __init__(self, host: str = "127.0.0.1", port: int = 6379):
        self._conn = redis.Redis(host=host, port=port)
        self._conn.ping()`,
      },
    ],
    edges: [
      // Runtime observed edges
      {
        id: 'e_test_fail_to_login',
        source: 'tests/test_auth.py::test_login_expired_token',
        target: 'auth/service.py::login_with_token',
        category: 'runtime_observed',
        provenance: 'pytest-trace: test_auth.py:42 -> service.py:55',
        observedCount: 1,
        testIds: ['tests/test_auth.py::test_login_expired_token'],
      },
      {
        id: 'e_test_pass_to_login',
        source: 'tests/test_auth.py::test_login_valid_token',
        target: 'auth/service.py::login_with_token',
        category: 'runtime_observed',
        provenance: 'pytest-trace: test_auth.py:28 -> service.py:55',
        observedCount: 1,
        testIds: ['tests/test_auth.py::test_login_valid_token'],
      },
      {
        id: 'e_login_to_validate',
        source: 'auth/service.py::login_with_token',
        target: 'auth/tokens.py::validate_token',
        category: 'runtime_observed',
        provenance: 'pytest-trace: service.py:64 -> tokens.py:43',
        observedCount: 2,
        testIds: [
          'tests/test_auth.py::test_login_expired_token',
          'tests/test_auth.py::test_login_valid_token',
        ],
      },
      {
        id: 'e_validate_to_header',
        source: 'auth/tokens.py::validate_token',
        target: 'auth/tokens.py::decode_jwt_header',
        category: 'runtime_observed',
        provenance: 'pytest-trace: tokens.py:45 -> tokens.py:18',
        observedCount: 2,
        testIds: [
          'tests/test_auth.py::test_login_expired_token',
          'tests/test_auth.py::test_login_valid_token',
        ],
      },
      {
        id: 'e_validate_to_crypto',
        source: 'auth/tokens.py::validate_token',
        target: 'auth/crypto.py::verify_signature',
        category: 'runtime_observed',
        provenance: 'pytest-trace: tokens.py:46 -> crypto.py:40',
        observedCount: 2,
        testIds: [
          'tests/test_auth.py::test_login_expired_token',
          'tests/test_auth.py::test_login_valid_token',
        ],
      },
      {
        id: 'e_crypto_to_parse_key',
        source: 'auth/crypto.py::verify_signature',
        target: 'auth/crypto.py::parse_public_key',
        category: 'runtime_observed',
        provenance: 'pytest-trace: crypto.py:44 -> crypto.py:15',
        observedCount: 2,
        testIds: [
          'tests/test_auth.py::test_login_expired_token',
          'tests/test_auth.py::test_login_valid_token',
        ],
      },
      {
        id: 'e_test_sess_create',
        source: 'tests/test_sessions.py::test_session_create',
        target: 'auth/sessions.py::create_session',
        category: 'runtime_observed',
        provenance: 'pytest-trace: test_sessions.py:11 -> sessions.py:12',
        observedCount: 1,
        testIds: ['tests/test_sessions.py::test_session_create'],
      },
      {
        id: 'e_create_sess_to_put',
        source: 'auth/sessions.py::create_session',
        target: 'auth/sessions.py::SessionStore.put',
        category: 'runtime_observed',
        provenance: 'pytest-trace: sessions.py:15 -> sessions.py:33',
        observedCount: 1,
        testIds: ['tests/test_sessions.py::test_session_create'],
      },
      {
        id: 'e_test_sess_inv',
        source: 'tests/test_sessions.py::test_session_invalidation',
        target: 'auth/sessions.py::SessionStore.invalidate',
        category: 'runtime_observed',
        provenance: 'pytest-trace: test_sessions.py:27 -> sessions.py:44',
        observedCount: 1,
        testIds: ['tests/test_sessions.py::test_session_invalidation'],
      },
      {
        id: 'e_test_limiter_init',
        source: 'tests/test_auth.py::test_rate_limit_backend',
        target: 'auth/limiter.py::RedisRateLimiter.__init__',
        category: 'runtime_observed',
        provenance: 'pytest-trace: test_auth.py:91 -> limiter.py:18',
        observedCount: 1,
        testIds: ['tests/test_auth.py::test_rate_limit_backend'],
      },
      // Static possibility edges (static AST call / import, not seen in failing test)
      {
        id: 'e_static_login_to_sessions',
        source: 'auth/service.py::login_with_token',
        target: 'auth/sessions.py::create_session',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(create_session)) in service.py:70',
      },
      {
        id: 'e_static_tokens_to_store',
        source: 'auth/tokens.py::validate_token',
        target: 'auth/sessions.py::SessionStore',
        category: 'static_import',
        provenance: 'ast-static: ImportFrom(sessions, SessionStore) in tokens.py:8',
      },
    ],
    unresolvedReferences: [
      {
        symbol: 'audit_logger',
        referencedFrom: 'auth/tokens.py:58',
        line: 58,
        reason: "Reference 'audit_logger' accessed in globals() but not statically declared in AST module scope.",
      },
      {
        symbol: 'legacy_ldap_sync',
        referencedFrom: 'auth/service.py:91',
        line: 91,
        reason: 'Static call to external or dynamic symbol not found in project AST index.',
      },
    ],
    parseErrors: [
      {
        file: 'auth/experimental/simd_parser.py',
        line: 14,
        message: 'SyntaxError: pattern matching syntax requires Python 3.10+ parser grammar config',
      },
    ],
  },
  'run-empty-scan': {
    nodes: [],
    edges: [],
    unresolvedReferences: [],
    parseErrors: [],
  },
  'run-failed-harness': {
    nodes: [
      {
        id: 'payment/webhook.py::handle_stripe_event',
        file: 'payment/webhook.py',
        name: 'handle_stripe_event',
        kind: 'function',
        parentModule: 'payment/webhook.py',
        lineStart: 10,
        lineEnd: 32,
        changeStatus: 'modified',
        sourceSnippet: `def handle_stripe_event(payload: bytes, sig_header: str) -> dict:
    event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    return event`,
      },
    ],
    edges: [],
    unresolvedReferences: [
      {
        symbol: 'pytest_mock',
        referencedFrom: 'tests/test_webhook.py:3',
        line: 3,
        reason: "Missing test harness module: 'pytest_mock'.",
      },
    ],
    parseErrors: [],
  },
};
