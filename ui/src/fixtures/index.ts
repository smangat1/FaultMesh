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
      totalNodes: 62,
      codeNodes: 52,
      modifiedNodes: 1,
      addedNodes: 16,
      totalChangedNodes: 17,
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
      callTracingAvailable: true,
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
        'auth/sessions.py::create_session',
        'auth/sessions.py::SessionStore.put',
        'auth/models.py::UserSession',
      ],
      callTracingAvailable: true,
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
        'auth/models.py::UserSession',
      ],
      callTracingAvailable: true,
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
      callTracingAvailable: true,
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
      callTracingAvailable: true,
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
      callTracingAvailable: false,
    },
  ],
  'run-empty-scan': [],
  'run-failed-harness': [],
};

export const FIXTURE_GRAPH: Record<string, GraphData> = {
  'run-auth-regression': {
    files: [
      { file: 'auth/tokens.py', name: 'tokens.py', symbolCount: 10, changeStatus: 'modified', lineCount: 160 },
      { file: 'auth/crypto.py', name: 'crypto.py', symbolCount: 10, changeStatus: 'unchanged', lineCount: 175 },
      { file: 'auth/service.py', name: 'service.py', symbolCount: 10, changeStatus: 'unchanged', lineCount: 190 },
      { file: 'auth/sessions.py', name: 'sessions.py', symbolCount: 8, changeStatus: 'added', lineCount: 80 },
      { file: 'auth/limiter.py', name: 'limiter.py', symbolCount: 6, changeStatus: 'unchanged', lineCount: 70 },
      { file: 'auth/models.py', name: 'models.py', symbolCount: 8, changeStatus: 'added', lineCount: 75 },
      { file: 'tests/test_auth.py', name: 'test_auth.py', symbolCount: 6, changeStatus: 'unchanged', lineCount: 150 },
      { file: 'tests/test_sessions.py', name: 'test_sessions.py', symbolCount: 4, changeStatus: 'unchanged', lineCount: 65 },
    ],
    nodes: [
      // --- auth/tokens.py (8 symbols) ---
      {
        id: 'auth/tokens.py::decode_jwt_header',
        file: 'auth/tokens.py',
        name: 'decode_jwt_header',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 18,
        lineEnd: 33,
        changeStatus: 'unchanged',
        description: 'Decodes Base64-URL header segment from token string and parses JSON algorithm parameters.',
        sourceSnippet: `def decode_jwt_header(token: str) -> dict:
    raw_header = token.split(".")[0]
    padded = raw_header + "=" * (-len(raw_header) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))`,
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
        description: 'Validates JWT signature, expiration timestamp, and registered token claims against clock leeway.',
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
        id: 'auth/tokens.py::encode_jwt',
        file: 'auth/tokens.py',
        name: 'encode_jwt',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 62,
        lineEnd: 76,
        changeStatus: 'unchanged',
        description: 'Serializes payload claims dictionary and produces signed compact JWT string.',
        sourceSnippet: `def encode_jwt(claims: dict, alg: str = "HS256") -> str:
    header = {"typ": "JWT", "alg": alg}
    encoded_header = base64.urlsafe_b64encode(json.dumps(header).encode()).rstrip(b'=')
    encoded_payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b'=')
    sig = sign_payload(f"{encoded_header.decode()}.{encoded_payload.decode()}", alg)
    return f"{encoded_header.decode()}.{encoded_payload.decode()}.{sig}"`,
      },
      {
        id: 'auth/tokens.py::verify_claims',
        file: 'auth/tokens.py',
        name: 'verify_claims',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 78,
        lineEnd: 92,
        changeStatus: 'unchanged',
        description: 'Checks required JWT claims including issuer, audience, and subject identifier existence.',
        sourceSnippet: `def verify_claims(claims: dict, expected_issuer: str = "auth-service") -> bool:
    if claims.get("iss") != expected_issuer:
        return False
    return "sub" in claims`,
      },
      {
        id: 'auth/tokens.py::extract_bearer_token',
        file: 'auth/tokens.py',
        name: 'extract_bearer_token',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 94,
        lineEnd: 106,
        changeStatus: 'unchanged',
        description: 'Parses HTTP Authorization header string and extracts raw Bearer token credential.',
        sourceSnippet: `def extract_bearer_token(header_value: str) -> str:
    if not header_value.startswith("Bearer "):
        raise ValueError("Invalid authorization header format")
    return header_value[7:].strip()`,
      },
      {
        id: 'auth/tokens.py::TokenClaims',
        file: 'auth/tokens.py',
        name: 'TokenClaims',
        kind: 'class',
        parentModule: 'auth/tokens.py',
        lineStart: 108,
        lineEnd: 128,
        changeStatus: 'unchanged',
        description: 'Data wrapper class providing typed accessors for standard JWT claims.',
        sourceSnippet: `class TokenClaims:
    def __init__(self, raw: dict):
        self.raw = raw
        self.sub = raw.get("sub")
        self.exp = raw.get("exp")
        
    def is_expired(self) -> bool:
        return bool(self.exp and self.exp < time.time())`,
      },
      {
        id: 'auth/tokens.py::TokenClaims.__init__',
        file: 'auth/tokens.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/tokens.py',
        lineStart: 109,
        lineEnd: 114,
        changeStatus: 'unchanged',
        description: 'Initializes TokenClaims container with decoded dictionary attributes.',
        sourceSnippet: `    def __init__(self, raw: dict):
        self.raw = raw
        self.sub = raw.get("sub")
        self.exp = raw.get("exp")`,
      },
      {
        id: 'auth/tokens.py::TokenClaims.is_expired',
        file: 'auth/tokens.py',
        name: 'is_expired',
        kind: 'method',
        parentModule: 'auth/tokens.py',
        lineStart: 116,
        lineEnd: 122,
        changeStatus: 'unchanged',
        description: 'Returns True if the expiration claim timestamp is prior to current UTC epoch.',
        sourceSnippet: `    def is_expired(self) -> bool:
        return bool(self.exp and self.exp < time.time())`,
      },
      {
        id: 'auth/tokens.py::revoke_token_hash',
        file: 'auth/tokens.py',
        name: 'revoke_token_hash',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 130,
        lineEnd: 142,
        changeStatus: 'unchanged',
        description: 'Records SHA-256 hash of invalidated token in blacklisted revocation set.',
        sourceSnippet: `def revoke_token_hash(token_hash: str) -> None:
    revocation_set.add(token_hash)`,
      },
      {
        id: 'auth/tokens.py::parse_bearer_header',
        file: 'auth/tokens.py',
        name: 'parse_bearer_header',
        kind: 'function',
        parentModule: 'auth/tokens.py',
        lineStart: 144,
        lineEnd: 155,
        changeStatus: 'unchanged',
        description: 'Sanitizes and extracts credential string from raw HTTP Authorization header.',
        sourceSnippet: `def parse_bearer_header(header: str) -> str:
    return header.strip().split(" ")[1]`,
      },

      // --- auth/crypto.py (8 symbols) ---
      {
        id: 'auth/crypto.py::parse_public_key',
        file: 'auth/crypto.py',
        name: 'parse_public_key',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 15,
        lineEnd: 38,
        changeStatus: 'unchanged',
        description: 'Retrieves algorithm verification key bytes from local secret store or environment.',
        sourceSnippet: `def parse_public_key(alg: str) -> bytes:
    if alg != "HS256":
        raise ValueError(f"Unsupported algorithm: {alg}")
    return b"secret-development-signing-key"`,
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
        description: 'Computes cryptographic HMAC digest and compares with received JWT signature bytes.',
        sourceSnippet: `def verify_signature(token: str, alg: str) -> dict:
    parts = token.split(".")
    payload, sig = parts[1], parts[2]
    key = parse_public_key(alg)
    hmac_val = hmac.new(key, payload.encode(), hashlib.sha256).digest()
    return json.loads(base64.urlsafe_b64decode(payload + "=="))`,
      },
      {
        id: 'auth/crypto.py::sign_payload',
        file: 'auth/crypto.py',
        name: 'sign_payload',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 68,
        lineEnd: 82,
        changeStatus: 'unchanged',
        description: 'Signs string message payload with HMAC-SHA256 and returns Base64-URL digest string.',
        sourceSnippet: `def sign_payload(data: str, alg: str) -> str:
    key = parse_public_key(alg)
    digest = hmac.new(key, data.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode()`,
      },
      {
        id: 'auth/crypto.py::derive_key',
        file: 'auth/crypto.py',
        name: 'derive_key',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 85,
        lineEnd: 98,
        changeStatus: 'unchanged',
        description: 'Derives cryptographic key material using PBKDF2 HMAC key derivation function.',
        sourceSnippet: `def derive_key(secret: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, 100000)`,
      },
      {
        id: 'auth/crypto.py::generate_keypair',
        file: 'auth/crypto.py',
        name: 'generate_keypair',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 100,
        lineEnd: 115,
        changeStatus: 'unchanged',
        description: 'Generates ephemeral key pair for token signature verification in local development.',
        sourceSnippet: `def generate_keypair() -> tuple[bytes, bytes]:
    salt = secrets.token_bytes(16)
    priv = derive_key("dev-master", salt)
    return priv, salt`,
      },
      {
        id: 'auth/crypto.py::CryptoBackend',
        file: 'auth/crypto.py',
        name: 'CryptoBackend',
        kind: 'class',
        parentModule: 'auth/crypto.py',
        lineStart: 118,
        lineEnd: 142,
        changeStatus: 'unchanged',
        description: 'Cryptographic engine wrapper caching secret keys and signature contexts.',
        sourceSnippet: `class CryptoBackend:
    def __init__(self, key: bytes):
        self.key = key
        
    def digest(self, message: bytes) -> bytes:
        return hmac.new(self.key, message, hashlib.sha256).digest()`,
      },
      {
        id: 'auth/crypto.py::CryptoBackend.__init__',
        file: 'auth/crypto.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/crypto.py',
        lineStart: 119,
        lineEnd: 124,
        changeStatus: 'unchanged',
        description: 'Initializes CryptoBackend with active signing secret key.',
        sourceSnippet: `    def __init__(self, key: bytes):
        self.key = key`,
      },
      {
        id: 'auth/crypto.py::CryptoBackend.digest',
        file: 'auth/crypto.py',
        name: 'digest',
        kind: 'method',
        parentModule: 'auth/crypto.py',
        lineStart: 126,
        lineEnd: 135,
        changeStatus: 'unchanged',
        description: 'Calculates HMAC-SHA256 checksum over byte payload using cached key.',
        sourceSnippet: `    def digest(self, message: bytes) -> bytes:
        return hmac.new(self.key, message, hashlib.sha256).digest()`,
      },
      {
        id: 'auth/crypto.py::constant_time_compare',
        file: 'auth/crypto.py',
        name: 'constant_time_compare',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 145,
        lineEnd: 155,
        changeStatus: 'unchanged',
        description: 'Compares two byte arrays in constant time to safeguard against timing leak attacks.',
        sourceSnippet: `def constant_time_compare(val1: bytes, val2: bytes) -> bool:
    return hmac.compare_digest(val1, val2)`,
      },
      {
        id: 'auth/crypto.py::rotate_keys',
        file: 'auth/crypto.py',
        name: 'rotate_keys',
        kind: 'function',
        parentModule: 'auth/crypto.py',
        lineStart: 157,
        lineEnd: 168,
        changeStatus: 'unchanged',
        description: 'Rotates active development HMAC secret and invalidates legacy key material.',
        sourceSnippet: `def rotate_keys() -> None:
    pass`,
      },

      // --- auth/service.py (8 symbols) ---
      {
        id: 'auth/service.py::login_with_token',
        file: 'auth/service.py',
        name: 'login_with_token',
        kind: 'function',
        parentModule: 'auth/service.py',
        lineStart: 55,
        lineEnd: 72,
        changeStatus: 'unchanged',
        description: 'Orchestrates JWT validation, verifies identity claims, and initializes active session.',
        sourceSnippet: `def login_with_token(token: str) -> UserSession:
    """Orchestrate token decode, validation, and session registration."""
    claims = validate_token(token, leeway=0)
    user_id = claims["sub"]
    return create_session(user_id)`,
      },
      {
        id: 'auth/service.py::logout_session',
        file: 'auth/service.py',
        name: 'logout_session',
        kind: 'function',
        parentModule: 'auth/service.py',
        lineStart: 74,
        lineEnd: 88,
        changeStatus: 'unchanged',
        description: 'Invalidates session token in active store and logs security logout audit record.',
        sourceSnippet: `def logout_session(session_id: str) -> bool:
    store = SessionStore()
    return store.invalidate(session_id)`,
      },
      {
        id: 'auth/service.py::authenticate_header',
        file: 'auth/service.py',
        name: 'authenticate_header',
        kind: 'function',
        parentModule: 'auth/service.py',
        lineStart: 90,
        lineEnd: 105,
        changeStatus: 'unchanged',
        description: 'Authenticates inbound HTTP request header by extracting Bearer token and validating claims.',
        sourceSnippet: `def authenticate_header(auth_header: str) -> dict:
    raw_token = extract_bearer_token(auth_header)
    return validate_token(raw_token)`,
      },
      {
        id: 'auth/service.py::refresh_token_pair',
        file: 'auth/service.py',
        name: 'refresh_token_pair',
        kind: 'function',
        parentModule: 'auth/service.py',
        lineStart: 107,
        lineEnd: 122,
        changeStatus: 'unchanged',
        description: 'Rotates existing session credential and issues newly signed token pair.',
        sourceSnippet: `def refresh_token_pair(session_id: str) -> tuple[str, str]:
    sess = get_session(session_id)
    new_token = encode_jwt({"sub": sess.user_id, "exp": int(time.time()) + 3600})
    return new_token, session_id`,
      },
      {
        id: 'auth/service.py::AuthService',
        file: 'auth/service.py',
        name: 'AuthService',
        kind: 'class',
        parentModule: 'auth/service.py',
        lineStart: 124,
        lineEnd: 152,
        changeStatus: 'unchanged',
        description: 'High-level authentication service encapsulating session store and token validator.',
        sourceSnippet: `class AuthService:
    def __init__(self, store: SessionStore):
        self.store = store
        
    def get_user(self, session_id: str) -> UserProfile:
        sess = self.store.get(session_id)
        return UserProfile(sess.user_id)
        
    def revoke_all(self, user_id: str) -> int:
        return 1`,
      },
      {
        id: 'auth/service.py::AuthService.__init__',
        file: 'auth/service.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/service.py',
        lineStart: 125,
        lineEnd: 128,
        changeStatus: 'unchanged',
        description: 'Constructs AuthService bound to the provided session store instance.',
        sourceSnippet: `    def __init__(self, store: SessionStore):
        self.store = store`,
      },
      {
        id: 'auth/service.py::AuthService.get_user',
        file: 'auth/service.py',
        name: 'get_user',
        kind: 'method',
        parentModule: 'auth/service.py',
        lineStart: 130,
        lineEnd: 138,
        changeStatus: 'unchanged',
        description: 'Loads user profile metadata corresponding to an authenticated session token.',
        sourceSnippet: `    def get_user(self, session_id: str) -> UserProfile:
        sess = self.store.get(session_id)
        return UserProfile(sess.user_id)`,
      },
      {
        id: 'auth/service.py::AuthService.revoke_all',
        file: 'auth/service.py',
        name: 'revoke_all',
        kind: 'method',
        parentModule: 'auth/service.py',
        lineStart: 140,
        lineEnd: 148,
        changeStatus: 'unchanged',
        description: 'Revokes all active sessions registered to a specific user account.',
        sourceSnippet: `    def revoke_all(self, user_id: str) -> int:
        return 1`,
      },
      {
        id: 'auth/service.py::validate_api_key',
        file: 'auth/service.py',
        name: 'validate_api_key',
        kind: 'function',
        parentModule: 'auth/service.py',
        lineStart: 155,
        lineEnd: 168,
        changeStatus: 'unchanged',
        description: 'Validates automated machine API client key against trusted external service credentials.',
        sourceSnippet: `def validate_api_key(key: str) -> bool:
    return key.startswith("fm_live_")`,
      },
      {
        id: 'auth/service.py::AuthService.validate_credential',
        file: 'auth/service.py',
        name: 'validate_credential',
        kind: 'method',
        parentModule: 'auth/service.py',
        lineStart: 170,
        lineEnd: 182,
        changeStatus: 'unchanged',
        description: 'Verifies user email and salted password hash against user directory records.',
        sourceSnippet: `    def validate_credential(self, user_id: str, secret: str) -> bool:
        return True`,
      },

      // --- auth/sessions.py (8 symbols) ---
      {
        id: 'auth/sessions.py::create_session',
        file: 'auth/sessions.py',
        name: 'create_session',
        kind: 'function',
        parentModule: 'auth/sessions.py',
        lineStart: 12,
        lineEnd: 26,
        changeStatus: 'added',
        description: 'Allocates a new secure random session ID and persists record in active SessionStore.',
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
        id: 'auth/sessions.py::get_session',
        file: 'auth/sessions.py',
        name: 'get_session',
        kind: 'function',
        parentModule: 'auth/sessions.py',
        lineStart: 28,
        lineEnd: 38,
        changeStatus: 'added',
        description: 'Retrieves active UserSession instance matching given session ID or raises KeyError.',
        sourceSnippet: `def get_session(session_id: str) -> UserSession:
    store = SessionStore()
    return store.get(session_id)`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,11 @@
+def get_session(session_id: str) -> UserSession:
+    store = SessionStore()
+    return store.get(session_id)`,
      },
      {
        id: 'auth/sessions.py::SessionStore',
        file: 'auth/sessions.py',
        name: 'SessionStore',
        kind: 'class',
        parentModule: 'auth/sessions.py',
        lineStart: 40,
        lineEnd: 78,
        changeStatus: 'added',
        description: 'In-memory thread-safe storage backend tracking active user session identifiers.',
        sourceSnippet: `class SessionStore:
    def __init__(self):
        self._sessions = {}
        
    def put(self, user_id: str) -> UserSession:
        sid = f"sess_{secrets.token_hex(8)}"
        sess = UserSession(sid, user_id, time.time())
        self._sessions[sid] = sess
        return sess

    def get(self, session_id: str) -> UserSession:
        return self._sessions[session_id]

    def invalidate(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    def cleanup_expired(self, max_age_seconds: int = 86400) -> int:
        return 0`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,38 @@
+class SessionStore:
+    def __init__(self):
+        self._sessions = {}`,
      },
      {
        id: 'auth/sessions.py::SessionStore.__init__',
        file: 'auth/sessions.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 41,
        lineEnd: 44,
        changeStatus: 'added',
        description: 'Initializes empty hash table for session records.',
        sourceSnippet: `    def __init__(self):
        self._sessions = {}`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,4 @@
+    def __init__(self):
+        self._sessions = {}`,
      },
      {
        id: 'auth/sessions.py::SessionStore.put',
        file: 'auth/sessions.py',
        name: 'put',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 46,
        lineEnd: 54,
        changeStatus: 'added',
        description: 'Generates crypto-random session identifier and saves UserSession record.',
        sourceSnippet: `    def put(self, user_id: str) -> UserSession:
        sid = f"sess_{secrets.token_hex(8)}"
        sess = UserSession(sid, user_id, time.time())
        self._sessions[sid] = sess
        return sess`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,8 @@
+    def put(self, user_id: str) -> UserSession:
+        sid = f"sess_{secrets.token_hex(8)}"`,
      },
      {
        id: 'auth/sessions.py::SessionStore.get',
        file: 'auth/sessions.py',
        name: 'get',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 56,
        lineEnd: 60,
        changeStatus: 'added',
        description: 'Looks up session by ID or raises KeyError if missing or expired.',
        sourceSnippet: `    def get(self, session_id: str) -> UserSession:
        return self._sessions[session_id]`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,4 @@
+    def get(self, session_id: str) -> UserSession:
+        return self._sessions[session_id]`,
      },
      {
        id: 'auth/sessions.py::SessionStore.invalidate',
        file: 'auth/sessions.py',
        name: 'invalidate',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 62,
        lineEnd: 67,
        changeStatus: 'added',
        description: 'Removes session record from store, rendering session token immediately expired.',
        sourceSnippet: `    def invalidate(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,4 @@
+    def invalidate(self, session_id: str) -> bool:
+        return self._sessions.pop(session_id, None) is not None`,
      },
      {
        id: 'auth/sessions.py::SessionStore.cleanup_expired',
        file: 'auth/sessions.py',
        name: 'cleanup_expired',
        kind: 'method',
        parentModule: 'auth/sessions.py',
        lineStart: 69,
        lineEnd: 74,
        changeStatus: 'added',
        description: 'Purges stale session records older than maximum retention age.',
        sourceSnippet: `    def cleanup_expired(self, max_age_seconds: int = 86400) -> int:
        return 0`,
        gitDiff: `+++ b/auth/sessions.py
@@ -0,0 +1,4 @@
+    def cleanup_expired(self, max_age_seconds: int = 86400) -> int:
+        return 0`,
      },

      // --- auth/limiter.py (6 symbols) ---
      {
        id: 'auth/limiter.py::RedisRateLimiter',
        file: 'auth/limiter.py',
        name: 'RedisRateLimiter',
        kind: 'class',
        parentModule: 'auth/limiter.py',
        lineStart: 15,
        lineEnd: 45,
        changeStatus: 'unchanged',
        description: 'Sliding-window rate limiter backed by Redis cluster for distributed throttling.',
        sourceSnippet: `class RedisRateLimiter:
    def __init__(self, host: str = "127.0.0.1", port: int = 6379):
        self._conn = redis.Redis(host=host, port=port)
        self._conn.ping()

    def check(self, key: str) -> bool:
        return True

    def reset(self, key: str) -> None:
        pass`,
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
        description: 'Initializes Redis connection and performs eager health check ping.',
        sourceSnippet: `    def __init__(self, host: str = "127.0.0.1", port: int = 6379):
        self._conn = redis.Redis(host=host, port=port)
        self._conn.ping()`,
      },
      {
        id: 'auth/limiter.py::RedisRateLimiter.check',
        file: 'auth/limiter.py',
        name: 'check',
        kind: 'method',
        parentModule: 'auth/limiter.py',
        lineStart: 28,
        lineEnd: 36,
        changeStatus: 'unchanged',
        description: 'Increments call counter for client IP key and checks threshold limits.',
        sourceSnippet: `    def check(self, key: str) -> bool:
        return True`,
      },
      {
        id: 'auth/limiter.py::RedisRateLimiter.reset',
        file: 'auth/limiter.py',
        name: 'reset',
        kind: 'method',
        parentModule: 'auth/limiter.py',
        lineStart: 38,
        lineEnd: 44,
        changeStatus: 'unchanged',
        description: 'Clears recorded throttle timestamps for the specified client key.',
        sourceSnippet: `    def reset(self, key: str) -> None:
        pass`,
      },
      {
        id: 'auth/limiter.py::InMemoryLimiter',
        file: 'auth/limiter.py',
        name: 'InMemoryLimiter',
        kind: 'class',
        parentModule: 'auth/limiter.py',
        lineStart: 47,
        lineEnd: 65,
        changeStatus: 'unchanged',
        description: 'Fallback rate limiter maintaining in-memory timestamps for single-process testing.',
        sourceSnippet: `class InMemoryLimiter:
    def __init__(self):
        self._records = {}

    def check(self, key: str) -> bool:
        return True`,
      },
      {
        id: 'auth/limiter.py::InMemoryLimiter.check',
        file: 'auth/limiter.py',
        name: 'check',
        kind: 'method',
        parentModule: 'auth/limiter.py',
        lineStart: 55,
        lineEnd: 64,
        changeStatus: 'unchanged',
        description: 'Evaluates rate limit in memory without network connection dependency.',
        sourceSnippet: `    def check(self, key: str) -> bool:
        return True`,
      },

      // --- auth/models.py (6 symbols) ---
      {
        id: 'auth/models.py::UserSession',
        file: 'auth/models.py',
        name: 'UserSession',
        kind: 'class',
        parentModule: 'auth/models.py',
        lineStart: 10,
        lineEnd: 30,
        changeStatus: 'added',
        description: 'Represents an active user session with unique session ID, user ID, and issue timestamp.',
        sourceSnippet: `class UserSession:
    def __init__(self, session_id: str, user_id: str, created_at: float):
        self.session_id = session_id
        self.user_id = user_id
        self.created_at = created_at

    def to_dict(self) -> dict:
        return {"session_id": self.session_id, "user_id": self.user_id}`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,20 @@
+class UserSession:
+    def __init__(self, session_id: str, user_id: str, created_at: float):
+        self.session_id = session_id`,
      },
      {
        id: 'auth/models.py::UserSession.__init__',
        file: 'auth/models.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/models.py',
        lineStart: 11,
        lineEnd: 18,
        changeStatus: 'added',
        description: 'Initializes UserSession attributes.',
        sourceSnippet: `    def __init__(self, session_id: str, user_id: str, created_at: float):
        self.session_id = session_id
        self.user_id = user_id
        self.created_at = created_at`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,7 @@
+    def __init__(self, session_id: str, user_id: str, created_at: float):`,
      },
      {
        id: 'auth/models.py::UserSession.to_dict',
        file: 'auth/models.py',
        name: 'to_dict',
        kind: 'method',
        parentModule: 'auth/models.py',
        lineStart: 20,
        lineEnd: 26,
        changeStatus: 'added',
        description: 'Serializes session metadata into dictionary for JSON wire transmission.',
        sourceSnippet: `    def to_dict(self) -> dict:
        return {"session_id": self.session_id, "user_id": self.user_id}`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,6 @@
+    def to_dict(self) -> dict:
+        return {"session_id": self.session_id, "user_id": self.user_id}`,
      },
      {
        id: 'auth/models.py::UserProfile',
        file: 'auth/models.py',
        name: 'UserProfile',
        kind: 'class',
        parentModule: 'auth/models.py',
        lineStart: 32,
        lineEnd: 52,
        changeStatus: 'added',
        description: 'User identity profile containing account ID, email address, and permissions.',
        sourceSnippet: `class UserProfile:
    def __init__(self, user_id: str, email: str = ""):
        self.user_id = user_id
        self.email = email
        self.roles = ["user"]

    def is_active(self) -> bool:
        return True`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,15 @@
+class UserProfile:
+    def __init__(self, user_id: str, email: str = ""):`,
      },
      {
        id: 'auth/models.py::UserProfile.__init__',
        file: 'auth/models.py',
        name: '__init__',
        kind: 'method',
        parentModule: 'auth/models.py',
        lineStart: 33,
        lineEnd: 39,
        changeStatus: 'added',
        description: 'Initializes UserProfile record with default user roles.',
        sourceSnippet: `    def __init__(self, user_id: str, email: str = ""):
        self.user_id = user_id
        self.email = email
        self.roles = ["user"]`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,6 @@
+    def __init__(self, user_id: str, email: str = ""):`,
      },
      {
        id: 'auth/models.py::UserProfile.is_active',
        file: 'auth/models.py',
        name: 'is_active',
        kind: 'method',
        parentModule: 'auth/models.py',
        lineStart: 41,
        lineEnd: 48,
        changeStatus: 'added',
        description: 'Checks whether account is marked active and allowed to create sessions.',
        sourceSnippet: `    def is_active(self) -> bool:
        return True`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,4 @@
+    def is_active(self) -> bool:
+        return True`,
      },
      {
        id: 'auth/models.py::UserSession.is_valid',
        file: 'auth/models.py',
        name: 'is_valid',
        kind: 'method',
        parentModule: 'auth/models.py',
        lineStart: 54,
        lineEnd: 60,
        changeStatus: 'added',
        description: 'Checks if session timestamp falls within maximum permitted continuous lifetime.',
        sourceSnippet: `    def is_valid(self, max_duration: int = 86400) -> bool:
        return (time.time() - self.created_at) < max_duration`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,4 @@
+    def is_valid(self, max_duration: int = 86400) -> bool:`,
      },
      {
        id: 'auth/models.py::UserProfile.has_role',
        file: 'auth/models.py',
        name: 'has_role',
        kind: 'method',
        parentModule: 'auth/models.py',
        lineStart: 62,
        lineEnd: 68,
        changeStatus: 'added',
        description: 'Verifies user profile includes the specified permission role tag.',
        sourceSnippet: `    def has_role(self, role_name: str) -> bool:
        return role_name in self.roles`,
        gitDiff: `+++ b/auth/models.py
@@ -0,0 +1,4 @@
+    def has_role(self, role_name: str) -> bool:`,
      },

      // --- tests/test_auth.py (6 symbols) ---
      {
        id: 'tests/test_auth.py::test_login_expired_token',
        file: 'tests/test_auth.py',
        name: 'test_login_expired_token',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 38,
        lineEnd: 50,
        changeStatus: 'unchanged',
        description: 'Regression test verifying that expired JWT tokens are rejected with TokenExpiredError.',
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
        description: 'Integration test verifying that valid JWT tokens successfully create authenticated sessions.',
        sourceSnippet: `def test_login_valid_token():
    """Ensure valid active token successfully logs in user."""
    token = create_test_token(exp_offset=3600)
    user = login_with_token(token)
    assert user.is_authenticated is True`,
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
        description: 'Verifies connection to backend Redis rate limiter under heavy load.',
        sourceSnippet: `def test_rate_limit_backend():
    limiter = RedisRateLimiter(host="127.0.0.1", port=6379)
    assert limiter.check("client_1") is True`,
      },
      {
        id: 'tests/test_auth.py::test_extract_bearer',
        file: 'tests/test_auth.py',
        name: 'test_extract_bearer',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 106,
        lineEnd: 118,
        changeStatus: 'unchanged',
        description: 'Unit test verifying Bearer header parsing with valid and invalid prefixes.',
        sourceSnippet: `def test_extract_bearer():
    assert extract_bearer_token("Bearer xyz123") == "xyz123"`,
      },
      {
        id: 'tests/test_auth.py::test_invalid_signature',
        file: 'tests/test_auth.py',
        name: 'test_invalid_signature',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 120,
        lineEnd: 132,
        changeStatus: 'unchanged',
        description: 'Ensures tampered JWT payload signatures trigger verification exceptions.',
        sourceSnippet: `def test_invalid_signature():
    with pytest.raises(Exception):
        verify_signature("invalid.token.sig", "HS256")`,
      },
      {
        id: 'tests/test_auth.py::test_crypto_digest',
        file: 'tests/test_auth.py',
        name: 'test_crypto_digest',
        kind: 'function',
        parentModule: 'tests/test_auth.py',
        lineStart: 134,
        lineEnd: 145,
        changeStatus: 'unchanged',
        description: 'Unit test checking CryptoBackend HMAC-SHA256 digest output repeatability.',
        sourceSnippet: `def test_crypto_digest():
    backend = CryptoBackend(b"secret")
    assert len(backend.digest(b"hello")) == 32`,
      },

      // --- tests/test_sessions.py (4 symbols) ---
      {
        id: 'tests/test_sessions.py::test_session_create',
        file: 'tests/test_sessions.py',
        name: 'test_session_create',
        kind: 'function',
        parentModule: 'tests/test_sessions.py',
        lineStart: 10,
        lineEnd: 22,
        changeStatus: 'unchanged',
        description: 'Verifies session store allocates distinct non-empty session IDs for user accounts.',
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
        description: 'Verifies invalidating an active session removes it immediately from storage.',
        sourceSnippet: `def test_session_invalidation():
    store = SessionStore()
    sess = store.put("usr_123")
    assert store.invalidate(sess.session_id) is True`,
      },
      {
        id: 'tests/test_sessions.py::test_session_cleanup',
        file: 'tests/test_sessions.py',
        name: 'test_session_cleanup',
        kind: 'function',
        parentModule: 'tests/test_sessions.py',
        lineStart: 37,
        lineEnd: 48,
        changeStatus: 'unchanged',
        description: 'Ensures cleanup routine purges expired sessions without disrupting active sessions.',
        sourceSnippet: `def test_session_cleanup():
    store = SessionStore()
    assert store.cleanup_expired(3600) == 0`,
      },
      {
        id: 'tests/test_sessions.py::test_session_not_found',
        file: 'tests/test_sessions.py',
        name: 'test_session_not_found',
        kind: 'function',
        parentModule: 'tests/test_sessions.py',
        lineStart: 50,
        lineEnd: 60,
        changeStatus: 'unchanged',
        description: 'Verifies querying an unallocated session key raises KeyError exception.',
        sourceSnippet: `def test_session_not_found():
    store = SessionStore()
    with pytest.raises(KeyError):
        store.get("nonexistent_session")`,
      },
    ],
    edges: [
      // === Observed Runtime Call Edges (Explicitly tagged with testIds) ===
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
        id: 'e_login_to_create_sess',
        source: 'auth/service.py::login_with_token',
        target: 'auth/sessions.py::create_session',
        category: 'runtime_observed',
        provenance: 'pytest-trace: service.py:70 -> sessions.py:12',
        observedCount: 1,
        testIds: ['tests/test_auth.py::test_login_valid_token'],
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
        provenance: 'pytest-trace: sessions.py:15 -> sessions.py:46',
        observedCount: 2,
        testIds: [
          'tests/test_auth.py::test_login_valid_token',
          'tests/test_sessions.py::test_session_create',
        ],
      },
      {
        id: 'e_put_to_model',
        source: 'auth/sessions.py::SessionStore.put',
        target: 'auth/models.py::UserSession',
        category: 'runtime_observed',
        provenance: 'pytest-trace: sessions.py:49 -> models.py:10',
        observedCount: 2,
        testIds: [
          'tests/test_auth.py::test_login_valid_token',
          'tests/test_sessions.py::test_session_create',
        ],
      },
      {
        id: 'e_test_sess_inv',
        source: 'tests/test_sessions.py::test_session_invalidation',
        target: 'auth/sessions.py::SessionStore.invalidate',
        category: 'runtime_observed',
        provenance: 'pytest-trace: test_sessions.py:27 -> sessions.py:62',
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

      // === Static Structural Edges (Imports & Static AST Calls - Labeled "Static structure (sample)") ===
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
      {
        id: 'e_static_tokens_to_claims',
        source: 'auth/tokens.py::validate_token',
        target: 'auth/tokens.py::verify_claims',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(verify_claims)) in tokens.py:50',
      },
      {
        id: 'e_static_encode_to_sign',
        source: 'auth/tokens.py::encode_jwt',
        target: 'auth/crypto.py::sign_payload',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(sign_payload)) in tokens.py:66',
      },
      {
        id: 'e_static_sign_to_derive',
        source: 'auth/crypto.py::sign_payload',
        target: 'auth/crypto.py::derive_key',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(derive_key)) in crypto.py:70',
      },
      {
        id: 'e_static_gen_to_derive',
        source: 'auth/crypto.py::generate_keypair',
        target: 'auth/crypto.py::derive_key',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(derive_key)) in crypto.py:102',
      },
      {
        id: 'e_static_logout_to_inv',
        source: 'auth/service.py::logout_session',
        target: 'auth/sessions.py::SessionStore.invalidate',
        category: 'static_call',
        provenance: 'ast-static: Call(Attribute(invalidate)) in service.py:76',
      },
      {
        id: 'e_static_auth_header_to_extract',
        source: 'auth/service.py::authenticate_header',
        target: 'auth/tokens.py::extract_bearer_token',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(extract_bearer_token)) in service.py:92',
      },
      {
        id: 'e_static_auth_header_to_validate',
        source: 'auth/service.py::authenticate_header',
        target: 'auth/tokens.py::validate_token',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(validate_token)) in service.py:93',
      },
      {
        id: 'e_static_refresh_to_get_sess',
        source: 'auth/service.py::refresh_token_pair',
        target: 'auth/sessions.py::get_session',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(get_session)) in service.py:109',
      },
      {
        id: 'e_static_refresh_to_encode',
        source: 'auth/service.py::refresh_token_pair',
        target: 'auth/tokens.py::encode_jwt',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(encode_jwt)) in service.py:110',
      },
      {
        id: 'e_static_svc_get_user_to_profile',
        source: 'auth/service.py::AuthService.get_user',
        target: 'auth/models.py::UserProfile',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(UserProfile)) in service.py:132',
      },
      {
        id: 'e_static_svc_get_user_to_get_sess',
        source: 'auth/service.py::AuthService.get_user',
        target: 'auth/sessions.py::SessionStore.get',
        category: 'static_call',
        provenance: 'ast-static: Call(Attribute(get)) in service.py:131',
      },
      {
        id: 'e_static_limiter_check_to_init',
        source: 'auth/limiter.py::RedisRateLimiter.check',
        target: 'auth/limiter.py::RedisRateLimiter.__init__',
        category: 'static_call',
        provenance: 'ast-static: Dependency on class instance initialization',
      },
      {
        id: 'e_static_test_bearer_to_extract',
        source: 'tests/test_auth.py::test_extract_bearer',
        target: 'auth/tokens.py::extract_bearer_token',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(extract_bearer_token)) in test_auth.py:107',
      },
      {
        id: 'e_static_test_sig_to_verify',
        source: 'tests/test_auth.py::test_invalid_signature',
        target: 'auth/crypto.py::verify_signature',
        category: 'static_call',
        provenance: 'ast-static: Call(Name(verify_signature)) in test_auth.py:122',
      },
      {
        id: 'e_static_test_digest_to_backend',
        source: 'tests/test_auth.py::test_crypto_digest',
        target: 'auth/crypto.py::CryptoBackend.digest',
        category: 'static_call',
        provenance: 'ast-static: Call(Attribute(digest)) in test_auth.py:136',
      },
      {
        id: 'e_static_test_cleanup_to_store',
        source: 'tests/test_sessions.py::test_session_cleanup',
        target: 'auth/sessions.py::SessionStore.cleanup_expired',
        category: 'static_call',
        provenance: 'ast-static: Call(Attribute(cleanup_expired)) in test_sessions.py:39',
      },
      {
        id: 'e_static_test_not_found_to_get',
        source: 'tests/test_sessions.py::test_session_not_found',
        target: 'auth/sessions.py::SessionStore.get',
        category: 'static_call',
        provenance: 'ast-static: Call(Attribute(get)) in test_sessions.py:52',
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
    files: [],
  },
  'run-failed-harness': {
    files: [
      { file: 'payment/webhook.py', name: 'webhook.py', symbolCount: 1, changeStatus: 'modified', lineCount: 35 },
    ],
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
        description: 'Processes incoming Stripe webhook payload signatures and triggers fulfillment handlers.',
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
