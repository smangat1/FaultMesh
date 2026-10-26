export type AgentPhase =
  | 'idle'
  | 'diagnosing'
  | 'tracing'
  | 'inspecting'
  | 'patching'
  | 'verifying'
  | 'resolved';

export interface AgentLogEntry {
  id: string;
  timestamp: string;
  phase: AgentPhase;
  title: string;
  message: string;
  badge?: { text: string; color: string; bg: string };
  codeTarget?: string;
}

export interface AgentSimulationStep {
  stepIndex: number;
  phase: AgentPhase;
  phaseLabel: string;
  headline: string;
  detail: string;
  targetNodeId: string;
  targetFile: string;
  targetEdgeId?: string;
  autoOpenInspector?: boolean;
  activeTestStatus?: 'fail' | 'running' | 'pass';
  patchedSnippet?: string;
  patchedDiff?: string;
  activeTestIds?: string[];
  log: {
    title: string;
    message: string;
    badge: { text: string; color: string; bg: string };
  };
}

export interface ActiveFileMutation {
  id: string;
  file: string;
  name: string;
  role: string;
  status: 'defect_site' | 'regression_test' | 'caller';
  snippet: string;
  diff?: string;
  lineRange: string;
}

export interface AgentExplanation {
  defectSummary: string;
  rootCause: string;
  remediation: string;
  verification: string;
}

export const AGENT_ORIGINAL_SNIPPET = `def validate_token(token: str, leeway: int = 0) -> dict:
    """Validate token signature, expiration, and registered claims."""
    header = decode_jwt_header(token)
    claims = verify_signature(token, header["alg"])
    current_time = int(time.time())

    # MODIFIED: strict claim type check refactoring
    exp_val = claims.get("exp")
    if not isinstance(exp_val, (int, float)):
        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")

    if exp_val < (current_time - leeway):
        raise TokenExpiredError("Token expired")

    return claims`;

export const AGENT_PATCHED_SNIPPET = `def validate_token(token: str, leeway: int = 0) -> dict:
    """Validate token signature, expiration, and registered claims."""
    header = decode_jwt_header(token)
    claims = verify_signature(token, header["alg"])
    current_time = int(time.time())

    # AGENT PATCH: coerce string timestamps to float before range check
    exp_val = claims.get("exp")
    try:
        exp_num = float(exp_val)
    except (ValueError, TypeError):
        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")

    if exp_num < (current_time - leeway):
        raise TokenExpiredError("Token expired")

    return claims`;

export const AGENT_ORIGINAL_DIFF = `--- a/auth/tokens.py
+++ b/auth/tokens.py
@@ -47,11 +47,14 @@ def validate_token(token: str, leeway: int = 0) -> dict:
     claims = verify_signature(token, header["alg"])
     current_time = int(time.time())

-    if claims.get("exp", 0) < (current_time - leeway):
-        raise TokenExpiredError("Token expired")
+    # MODIFIED: strict claim type check refactoring
+    exp_val = claims.get("exp")
+    if not isinstance(exp_val, (int, float)):
+        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")
+    if exp_val < (current_time - leeway):
+        raise TokenExpiredError("Token expired")
     return claims`;

export const AGENT_PATCHED_DIFF = `--- a/auth/tokens.py
+++ b/auth/tokens.py
@@ -47,14 +47,17 @@ def validate_token(token: str, leeway: int = 0) -> dict:
     claims = verify_signature(token, header["alg"])
     current_time = int(time.time())

-    exp_val = claims.get("exp")
-    if not isinstance(exp_val, (int, float)):
-        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")
+    # AGENT PATCH: coerce string timestamps to float before range check
+    exp_val = claims.get("exp")
+    try:
+        exp_num = float(exp_val)
+    except (ValueError, TypeError):
+        raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")

-    if exp_val < (current_time - leeway):
+    if exp_num < (current_time - leeway):
         raise TokenExpiredError("Token expired")
     return claims`;

export const AGENT_EXPLANATION: AgentExplanation = {
  defectSummary:
    'Regression test test_login_expired_token failed with an unexpected InvalidClaimError instead of TokenExpiredError. Traceback analysis shows token payloads containing stringified numeric timestamps (e.g. exp = "1718000000") were rejected prematurely during type validation on line 49 of tokens.py.',
  rootCause:
    'Commit feat/jwt-sessions refactored token claims with a strict type check: if not isinstance(exp_val, (int, float)): raise InvalidClaimError(...). However, web and mobile client JSON parsers frequently serialize timestamps as string literals. Because the strict isinstance rejected string timestamps, expired tokens never reached the expiration comparison on line 52.',
  remediation:
    'Replaced the rigid isinstance type assertion with non-breaking numeric coercion: try: exp_num = float(exp_val) except (ValueError, TypeError): raise InvalidClaimError(...). Valid numeric strings and numbers are coerced cleanly for the expiration check, while genuinely invalid non-numeric claims continue to raise InvalidClaimError.',
  verification:
    'Re-executed pytest tests/test_auth.py::test_login_expired_token. Pytest passed in 34ms, successfully raising TokenExpiredError. All 6 tests across auth-service are now green with zero side-effects on calling services.',
};

export const AGENT_ACTIVE_FILES: ActiveFileMutation[] = [
  {
    id: 'auth/tokens.py::validate_token',
    file: 'auth/tokens.py',
    name: 'validate_token',
    role: 'Defect Site & Live Patch',
    status: 'defect_site',
    lineRange: '43-59',
    diff: AGENT_PATCHED_DIFF,
    snippet: AGENT_PATCHED_SNIPPET,
  },
  {
    id: 'tests/test_auth.py::test_login_expired_token',
    file: 'tests/test_auth.py',
    name: 'test_login_expired_token',
    role: 'Failing Regression Test',
    status: 'regression_test',
    lineRange: '38-50',
    snippet: `def test_login_expired_token():
    """Verify expired JWT token triggers TokenExpiredError."""
    # Token created with expired exp as numeric string: {"exp": "1718000000"}
    expired_token = create_test_token(exp_offset=-3600)

    # Expected TokenExpiredError, but raised InvalidClaimError prior to patch
    with pytest.raises(TokenExpiredError):
        login_with_token(expired_token)`,
  },
  {
    id: 'auth/service.py::login_with_token',
    file: 'auth/service.py',
    name: 'login_with_token',
    role: 'Calling Coordinator Contract',
    status: 'caller',
    lineRange: '30-45',
    snippet: `def login_with_token(token: str) -> Session:
    """Authenticate user session using provided bearer token."""
    # Delegates token validation to tokens.validate_token
    claims = validate_token(token, leeway=0)
    user_id = claims.get("sub")
    return create_session(user_id=user_id)`,
  },
];

export const AGENT_SIMULATION_STEPS: AgentSimulationStep[] = [
  {
    stepIndex: 0,
    phase: 'diagnosing',
    phaseLabel: 'Scoping Failure',
    headline: 'Analyzing pytest failure in test_login_expired_token',
    detail: 'Inspecting traceback assertion: Expected TokenExpiredError, but got InvalidClaimError.',
    targetNodeId: 'tests/test_auth.py::test_login_expired_token',
    targetFile: 'tests/test_auth.py',
    autoOpenInspector: false,
    activeTestStatus: 'fail',
    log: {
      title: 'Targeting Failure Point',
      message: 'Detected regression in test_login_expired_token. Traceback indicates InvalidClaimError on numeric string timestamp.',
      badge: { text: 'DIAGNOSE', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
    },
  },
  {
    stepIndex: 1,
    phase: 'tracing',
    phaseLabel: 'Tracing Call Flow',
    headline: 'Tracing runtime execution path across service and token modules',
    detail: 'Traversing call stack: test_login_expired_token → login_with_token → validate_token.',
    targetNodeId: 'auth/service.py::login_with_token',
    targetFile: 'auth/service.py',
    targetEdgeId: 'e_test_auth_to_login',
    autoOpenInspector: false,
    activeTestStatus: 'fail',
    log: {
      title: 'Dynamic Call Tracing',
      message: 'Observed runtime call graph: test enters service.py:login_with_token and delegates validation to tokens.py:validate_token.',
      badge: { text: 'TRACE', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' },
    },
  },
  {
    stepIndex: 2,
    phase: 'inspecting',
    phaseLabel: 'Candidate Defect Found',
    headline: 'Inspecting candidate defect in auth/tokens.py::validate_token',
    detail: 'Recent refactoring added strict type check isinstance(exp_val, (int, float)) which rejects string timestamps.',
    targetNodeId: 'auth/tokens.py::validate_token',
    targetFile: 'auth/tokens.py',
    targetEdgeId: 'e_service_to_validate_token',
    autoOpenInspector: true,
    activeTestStatus: 'fail',
    log: {
      title: 'Defect Isolated',
      message: 'Located defect at auth/tokens.py line 49. String timestamp "1718000000" fails isinstance check. Formulating non-breaking patch.',
      badge: { text: 'INSPECT', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
    },
  },
  {
    stepIndex: 3,
    phase: 'patching',
    phaseLabel: 'Live Patching Code',
    headline: 'Applying live patch to auth/tokens.py::validate_token',
    detail: 'Replacing strict isinstance check with try/float conversion to accept valid numeric strings gracefully.',
    targetNodeId: 'auth/tokens.py::validate_token',
    targetFile: 'auth/tokens.py',
    autoOpenInspector: true,
    activeTestStatus: 'fail',
    patchedSnippet: AGENT_PATCHED_SNIPPET,
    patchedDiff: AGENT_PATCHED_DIFF,
    log: {
      title: 'Patch Injected',
      message: 'Replaced strict isinstance check with robust numeric coercion try: float(exp_val) except (ValueError, TypeError). File updated.',
      badge: { text: 'PATCH', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)' },
    },
  },
  {
    stepIndex: 4,
    phase: 'verifying',
    phaseLabel: 'Verifying with Pytest',
    headline: 'Re-running test_login_expired_token against patched code',
    detail: 'Triggering execution replay trial #4 to verify whether TokenExpiredError is properly raised.',
    targetNodeId: 'tests/test_auth.py::test_login_expired_token',
    targetFile: 'tests/test_auth.py',
    autoOpenInspector: false,
    activeTestStatus: 'running',
    patchedSnippet: AGENT_PATCHED_SNIPPET,
    patchedDiff: AGENT_PATCHED_DIFF,
    log: {
      title: 'Re-running Pytest',
      message: 'Running pytest tests/test_auth.py -k test_login_expired_token with live instrumentation...',
      badge: { text: 'RUNNING', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
    },
  },
  {
    stepIndex: 5,
    phase: 'resolved',
    phaseLabel: 'Regression Resolved',
    headline: 'test_login_expired_token PASSED in 34ms (0 Failures Remaining)',
    detail: 'Verification confirmed: TokenExpiredError was successfully raised. 6 of 6 tests passing across repository.',
    targetNodeId: 'tests/test_auth.py::test_login_expired_token',
    targetFile: 'tests/test_auth.py',
    autoOpenInspector: false,
    activeTestStatus: 'pass',
    patchedSnippet: AGENT_PATCHED_SNIPPET,
    patchedDiff: AGENT_PATCHED_DIFF,
    log: {
      title: 'Regression Resolved',
      message: 'Pytest replay trial #4 passed cleanly in 34ms. Zero regressions detected. Code change verified.',
      badge: { text: 'RESOLVED', color: '#10b981', bg: 'rgba(16, 185, 129, 0.2)' },
    },
  },
];
