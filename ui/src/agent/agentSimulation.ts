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

export interface PhaseEvidenceItem {
  type:
    | 'failure_evidence'
    | 'call_trace'
    | 'candidate_defect'
    | 'candidate_patch'
    | 'verification_trial'
    | 'resolution_summary';
  title: string;
  summary: string;
  bullets?: { label: string; text: string; color?: string }[];
  tracebackSnippet?: string;
}

export interface StepExplanation {
  stepSummary: string;
  whatHappened: string;
  whyDidItDoThis: string;
  evidenceSupported: string;
  whatChanged: string;
  outcome: string;
}

export interface AgentSimulationStep {
  stepIndex: number;
  phase: AgentPhase;
  phaseLabel: string;
  checkpointLabel: string;
  actionPill: string;
  headline: string;
  detail: string;
  targetNodeId: string;
  targetFile: string;
  unfoldedFiles: string[];
  activeEdgeIds?: string[];
  cameraZoom: number;
  durationMs: number;
  autoOpenInspector: boolean;
  activeTestStatus?: 'fail' | 'running' | 'pass';
  patchedSnippet?: string;
  patchedDiff?: string;
  phaseEvidence: PhaseEvidenceItem;
  explanation: StepExplanation;
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
    role: 'Defect Site & Candidate Patch',
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
    checkpointLabel: 'Failure detected',
    actionPill: 'Inspecting failed test',
    headline: 'Analyzing pytest failure in test_login_expired_token',
    detail: 'Traceback assertion failure: Expected TokenExpiredError, but got InvalidClaimError.',
    targetNodeId: 'tests/test_auth.py::test_login_expired_token',
    targetFile: 'tests/test_auth.py',
    unfoldedFiles: ['tests/test_auth.py'],
    activeEdgeIds: [],
    cameraZoom: 1.05,
    durationMs: 2400,
    autoOpenInspector: false,
    activeTestStatus: 'fail',
    phaseEvidence: {
      type: 'failure_evidence',
      title: 'Recorded Failure Evidence',
      summary:
        'test_login_expired_token raised InvalidClaimError unexpectedly. Assertion failed on token expiration contract.',
      bullets: [
        { label: 'Test Target', text: 'tests/test_auth.py::test_login_expired_token', color: '#ef4444' },
        { label: 'Expected', text: 'TokenExpiredError ("Token expired")', color: '#10b981' },
        { label: 'Actual', text: 'InvalidClaimError ("\'exp\' claim is not numeric")', color: '#ef4444' },
      ],
      tracebackSnippet: `FAILED tests/test_auth.py::test_login_expired_token - InvalidClaimError: 'exp' claim is not numeric: 1718000000
Traceback (most recent call last):
  File "tests/test_auth.py", line 45, in test_login_expired_token
    login_with_token(expired_token)
  File "auth/service.py", line 35, in login_with_token
    claims = validate_token(token, leeway=0)
  File "auth/tokens.py", line 49, in validate_token
    raise InvalidClaimError(f"'exp' claim is not numeric: {exp_val}")`,
    },
    explanation: {
      stepSummary: 'FaultMesh isolated a failing test assertion in test_login_expired_token.',
      whatHappened: 'The investigator inspected the failing pytest execution for test_login_expired_token.',
      whyDidItDoThis:
        'To isolate the exact failure fingerprint and distinguish an expectation assertion failure from an unexpected exception.',
      evidenceSupported:
        "Recorded pytest traceback: InvalidClaimError: 'exp' claim is not numeric: 1718000000 at tests/test_auth.py:45.",
      whatChanged:
        'No source code or repository state modified. Initial failure hypothesis formed around token expiration validation.',
      outcome:
        'Isolated that the test expected TokenExpiredError, but validate_token() prematurely threw InvalidClaimError on numeric string timestamp.',
    },
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
    checkpointLabel: 'Execution evidence traced',
    actionPill: 'Following call stack',
    headline: 'Tracing runtime execution path into coordinator',
    detail: 'Traversing call stack: test_login_expired_token → login_with_token → validate_token.',
    targetNodeId: 'auth/service.py::login_with_token',
    targetFile: 'auth/service.py',
    unfoldedFiles: ['tests/test_auth.py', 'auth/service.py'],
    activeEdgeIds: ['e_test_fail_to_login'],
    cameraZoom: 1.15,
    durationMs: 2600,
    autoOpenInspector: false,
    activeTestStatus: 'fail',
    phaseEvidence: {
      type: 'call_trace',
      title: 'Guided Exploration of Recorded Trace',
      summary:
        'Following recorded runtime call sequence from the test entry point into the auth service coordinator.',
      bullets: [
        { label: 'Caller', text: 'tests/test_auth.py::test_login_expired_token', color: '#38bdf8' },
        { label: 'Coordinator', text: 'auth/service.py::login_with_token (Step [1])', color: '#38bdf8' },
        { label: 'Delegation', text: 'Delegates claim verification to auth/tokens.py::validate_token', color: '#94a3b8' },
      ],
    },
    explanation: {
      stepSummary: 'Traced the runtime call path from the test entry point into the auth coordinator.',
      whatHappened: 'The investigator followed recorded execution evidence into auth/service.py::login_with_token().',
      whyDidItDoThis:
        'To check if service.py modified the token payload before delegating claim validation to the token authority.',
      evidenceSupported:
        'Observed pytest call trace test_auth.py:42 -> service.py:55 confirming login_with_token() forwards the raw token unmutated.',
      whatChanged:
        'No source code changed. Eliminated service.py as a defect candidate and narrowed focus to downstream validator.',
      outcome:
        'Established that service.py is a pass-through coordinator, focusing the investigation on auth/tokens.py::validate_token().',
    },
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
    checkpointLabel: 'Suspicious function inspected',
    actionPill: 'Inspecting candidate defect',
    headline: 'Inspecting candidate defect site in validate_token()',
    detail: 'Suspected regression: isinstance(exp_val, (int, float)) rejects numeric string timestamp "1718000000".',
    targetNodeId: 'auth/tokens.py::validate_token',
    targetFile: 'auth/tokens.py',
    unfoldedFiles: ['tests/test_auth.py', 'auth/service.py', 'auth/tokens.py'],
    activeEdgeIds: ['e_test_fail_to_login', 'e_login_to_validate'],
    cameraZoom: 1.35,
    durationMs: 3500,
    autoOpenInspector: true,
    activeTestStatus: 'fail',
    phaseEvidence: {
      type: 'candidate_defect',
      title: 'Candidate Defect Hypothesis (Unproven)',
      summary:
        'Recent refactoring introduced a rigid type check that treats stringified timestamps as invalid claims rather than coercing them.',
      bullets: [
        { label: 'Suspect Site', text: 'auth/tokens.py::validate_token (Lines 48–52)', color: '#f59e0b' },
        { label: 'Hypothesis', text: 'Strict isinstance check rejects valid numeric strings from client payloads', color: '#f59e0b' },
        { label: 'Evidence Status', text: 'Candidate defect under evaluation — not yet proven', color: '#94a3b8' },
      ],
    },
    explanation: {
      stepSummary: 'Identified recently modified token validation logic containing a rigid type guard.',
      whatHappened:
        'The investigator expanded auth/tokens.py and inspected signature verification and claim parsing in validate_token().',
      whyDidItDoThis:
        'The traceback pointed to line 49 of tokens.py, and Git commit history shows a recent refactoring added strict type checks to exp claims.',
      evidenceSupported:
        'Recorded traceback at tokens.py:49 and Git diff showing isinstance(exp_val, (int, float)) recently added in HEAD.',
      whatChanged: 'No source code modified during this inspection. Candidate defect hypothesis documented.',
      outcome:
        'The strict isinstance check became a candidate explanation for rejecting valid numeric string timestamps ("1718000000"), pending candidate remediation and test verification.',
    },
    log: {
      title: 'Defect Isolated',
      message: 'Located candidate defect at auth/tokens.py line 49. String timestamp "1718000000" fails isinstance check. Formulating non-breaking patch.',
      badge: { text: 'INSPECT', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
    },
  },
  {
    stepIndex: 3,
    phase: 'patching',
    phaseLabel: 'Candidate Patch',
    checkpointLabel: 'Candidate fix examined',
    actionPill: 'Simulating candidate patch',
    headline: 'Formulating non-breaking candidate patch for validate_token()',
    detail: 'Candidate patch: coerce string timestamps with try/float conversion before checking expiration range.',
    targetNodeId: 'auth/tokens.py::validate_token',
    targetFile: 'auth/tokens.py',
    unfoldedFiles: ['tests/test_auth.py', 'auth/service.py', 'auth/tokens.py'],
    activeEdgeIds: ['e_test_fail_to_login', 'e_login_to_validate'],
    cameraZoom: 1.35,
    durationMs: 3600,
    autoOpenInspector: true,
    activeTestStatus: 'fail',
    patchedSnippet: AGENT_PATCHED_SNIPPET,
    patchedDiff: AGENT_PATCHED_DIFF,
    phaseEvidence: {
      type: 'candidate_patch',
      title: 'Candidate Patch Formulation (Simulated Demo)',
      summary:
        'Demonstrating candidate fix in source inspector. The change coerces valid numeric strings to float without breaking non-numeric rejection.',
      bullets: [
        { label: 'File Target', text: 'auth/tokens.py (Lines 47–56)', color: '#f59e0b' },
        { label: 'Change', text: 'try: exp_num = float(exp_val) except (ValueError, TypeError)', color: '#f59e0b' },
        { label: 'Status', text: 'Candidate change simulated — awaiting test verification', color: '#94a3b8' },
      ],
    },
    explanation: {
      stepSummary: 'Formulated a non-breaking candidate patch to coerce stringified timestamps.',
      whatHappened:
        'The investigator formulated and displayed a candidate code modification to validate_token() in auth/tokens.py.',
      whyDidItDoThis:
        'To allow stringified numeric timestamps from HTTP headers to be converted to float timestamps while preserving validation against malformed non-numeric values.',
      evidenceSupported:
        'The test payload used "1718000000", which is mathematically valid as a UNIX timestamp but rejected by isinstance(exp_val, (int, float)).',
      whatChanged:
        'Candidate code mutation proposed in source inspector: replaced isinstance with try: exp_num = float(exp_val) except (ValueError, TypeError). Graph node highlighted in amber.',
      outcome:
        'Proposed candidate diff formulated and ready for verification trial against the regression suite.',
    },
    log: {
      title: 'Patch Injected',
      message: 'Replaced strict isinstance check with robust numeric coercion try: float(exp_val) except (ValueError, TypeError). File updated.',
      badge: { text: 'PATCH', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)' },
    },
  },
  {
    stepIndex: 4,
    phase: 'verifying',
    phaseLabel: 'Replaying Verification',
    checkpointLabel: 'Verification performed',
    actionPill: 'Replaying verification trial',
    headline: 'Re-running test_login_expired_token against candidate patch',
    detail: 'Simulated verification trial #4: checking if TokenExpiredError is properly raised.',
    targetNodeId: 'tests/test_auth.py::test_login_expired_token',
    targetFile: 'tests/test_auth.py',
    unfoldedFiles: ['tests/test_auth.py', 'auth/service.py', 'auth/tokens.py'],
    activeEdgeIds: ['e_test_fail_to_login', 'e_login_to_validate'],
    cameraZoom: 1.15,
    durationMs: 2800,
    autoOpenInspector: false,
    activeTestStatus: 'running',
    patchedSnippet: AGENT_PATCHED_SNIPPET,
    patchedDiff: AGENT_PATCHED_DIFF,
    phaseEvidence: {
      type: 'verification_trial',
      title: 'Replay Verification Trial (Simulated Demo)',
      summary:
        'Executing verification trial #4 against the modified token validation logic to verify whether regression is resolved.',
      bullets: [
        { label: 'Test Target', text: 'tests/test_auth.py::test_login_expired_token', color: '#a855f7' },
        { label: 'Trial', text: 'Replay Trial #4 with instrumented coverage', color: '#a855f7' },
        { label: 'Status', text: 'Executing test runner... (Demo simulation)', color: '#94a3b8' },
      ],
    },
    explanation: {
      stepSummary: 'Re-executed the failing test suite against the candidate patch.',
      whatHappened:
        'The investigator shifted attention back to test_login_expired_token and triggered an automated verification trial.',
      whyDidItDoThis:
        'To verify whether the candidate patch in validate_token() allows the token to proceed to the expiration range check and raise the expected TokenExpiredError.',
      evidenceSupported: 'Simulated pytest execution runner output with coverage instrumentation.',
      whatChanged: 'Test execution state changed from fail to running, then recorded pass outcome.',
      outcome: 'Trial #4 confirmed test_login_expired_token passes cleanly in 34ms with zero assertion errors.',
    },
    log: {
      title: 'Re-running Pytest',
      message: 'Running pytest tests/test_auth.py -k test_login_expired_token with live instrumentation...',
      badge: { text: 'RUNNING', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
    },
  },
  {
    stepIndex: 5,
    phase: 'resolved',
    phaseLabel: 'Demonstration Resolved',
    checkpointLabel: 'Investigation concluded',
    actionPill: 'Verified green (0 regressions)',
    headline: 'test_login_expired_token PASSED in 34ms (0 Failures Remaining)',
    detail: 'Verification confirmed in recorded sample: TokenExpiredError raised cleanly. 6 of 6 tests passing.',
    targetNodeId: 'auth/tokens.py::validate_token',
    targetFile: 'auth/tokens.py',
    unfoldedFiles: ['tests/test_auth.py', 'auth/service.py', 'auth/tokens.py'],
    activeEdgeIds: ['e_test_fail_to_login', 'e_login_to_validate'],
    cameraZoom: 1.15,
    durationMs: 4200,
    autoOpenInspector: true,
    activeTestStatus: 'pass',
    patchedSnippet: AGENT_PATCHED_SNIPPET,
    patchedDiff: AGENT_PATCHED_DIFF,
    phaseEvidence: {
      type: 'resolution_summary',
      title: 'Sample Investigation Resolution Summary',
      summary:
        'Sample demonstration completed. The candidate patch resolved the regression without introducing secondary failures.',
      bullets: [
        { label: 'Target Failure', text: 'tests/test_auth.py::test_login_expired_token', color: '#10b981' },
        { label: 'Candidate Site', text: 'auth/tokens.py::validate_token', color: '#f59e0b' },
        { label: 'Sample Outcome', text: 'PASSED in 34ms (6 passed, 0 failed across test suite)', color: '#10b981' },
        { label: 'Mode', text: 'Changes mode active — examine modified code in inspector', color: '#38bdf8' },
      ],
    },
    explanation: {
      stepSummary: 'Confirmed zero regressions across all 6 tests in auth-service.',
      whatHappened:
        'The investigator completed verification across all test suites, confirmed 6 of 6 tests passing, and concluded the investigation.',
      whyDidItDoThis:
        'To ensure that relaxing numeric timestamp validation did not break other token contracts (valid tokens, session stores, crypto signatures).',
      evidenceSupported: 'Full test suite execution report: 6 passed in 88ms, 0 failures, 0 regressions.',
      whatChanged:
        'Candidate patch verified. Tested function and test confirmed with emerald status. Remediation breakdown available in inspector.',
      outcome: 'Investigation resolved successfully. Candidate patch is ready for code review.',
    },
    log: {
      title: 'Regression Resolved',
      message: 'Pytest replay trial #4 passed cleanly in 34ms. Zero regressions detected. Code change verified.',
      badge: { text: 'RESOLVED', color: '#10b981', bg: 'rgba(168, 85, 129, 0.2)' },
    },
  },
];
