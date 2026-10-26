import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App';
import {
  AGENT_SIMULATION_STEPS,
  AGENT_ACTIVE_FILES,
  AGENT_EXPLANATION,
} from '../agent/agentSimulation';

describe('Autonomous Agent Live Simulation & Code Mutation', () => {
  it('defines valid agent simulation steps, active remediation files, and real engineering explanation', () => {
    expect(AGENT_SIMULATION_STEPS.length).toBeGreaterThanOrEqual(5);

    const phases = AGENT_SIMULATION_STEPS.map((s) => s.phase);
    expect(phases).toContain('diagnosing');
    expect(phases).toContain('tracing');
    expect(phases).toContain('inspecting');
    expect(phases).toContain('patching');
    expect(phases).toContain('verifying');
    expect(phases).toContain('resolved');

    // Verify multi-file active remediation list
    expect(AGENT_ACTIVE_FILES.length).toBe(3);
    const files = AGENT_ACTIVE_FILES.map((f) => f.file);
    expect(files).toContain('auth/tokens.py');
    expect(files).toContain('tests/test_auth.py');
    expect(files).toContain('auth/service.py');

    // Verify in-depth real engineering explanation
    expect(AGENT_EXPLANATION.defectSummary).toContain('test_login_expired_token');
    expect(AGENT_EXPLANATION.rootCause).toContain('isinstance');
    expect(AGENT_EXPLANATION.remediation).toContain('float');
    expect(AGENT_EXPLANATION.verification).toContain('pytest');
  });

  it('allows selecting target project and triggering test suite run', async () => {
    render(<App initialScreen="selector" />);

    // Wait for project selector radio options to load
    const authRadio = await screen.findByRole('radio', { name: /auth-service/i });
    expect(authRadio).toBeDefined();

    // Check run project button
    const runBtn = screen.getByRole('button', { name: /run auth-service/i });
    expect(runBtn).toBeDefined();

    fireEvent.click(runBtn);
    expect(screen.getAllByText(/Running pytest/i).length).toBeGreaterThan(0);
  });

  it('allows launching agent auto-repair and inspects active remediation files and real explanation', async () => {
    render(<App initialScreen="selector" />);

    // Launch agent auto-repair
    const agentBtn = await screen.findByRole('button', { name: /watch agent repair/i });
    fireEvent.click(agentBtn);

    // Verify workspace opened in agent active mode
    const toolbarBtn = await screen.findByRole('button', { name: /agent auto-repair/i });
    expect(toolbarBtn).toBeDefined();

    // Verify active files swapper tabs are present
    await waitFor(() => {
      expect(screen.getAllByText('auth/tokens.py').length).toBeGreaterThan(0);
      expect(screen.getAllByText('tests/test_auth.py').length).toBeGreaterThan(0);
      expect(screen.getAllByText('auth/service.py').length).toBeGreaterThan(0);
    });

    // Verify REAL explanation card is displayed
    expect(screen.getByText(/Remediation Explanation & Analysis/i)).toBeDefined();
    expect(screen.getByText(/Defect Isolation:/i)).toBeDefined();
    expect(screen.getByText(/Root Cause:/i)).toBeDefined();
    expect(screen.getByText(/Fix Applied:/i)).toBeDefined();
    expect(screen.getByText(/Verification:/i)).toBeDefined();
  });

  it('swaps active file inspection between tokens, test, and service contracts', async () => {
    render(<App initialScreen="workspace" />);

    // Toggle agent mode from toolbar
    const toolbarBtn = await screen.findByRole('button', { name: /agent auto-repair/i });
    fireEvent.click(toolbarBtn);

    // Click on active file test tab
    const testTab = await screen.findByTitle(/Inspect tests\/test_auth.py/i);
    expect(testTab).toBeDefined();
    fireEvent.click(testTab);

    // Verify test inspection is displayed
    await waitFor(() => {
      expect(screen.getAllByText(/test_login_expired_token/i).length).toBeGreaterThan(0);
    });

    // Click on service contract tab
    const serviceTab = screen.getByTitle(/Inspect auth\/service.py/i);
    fireEvent.click(serviceTab);

    await waitFor(() => {
      expect(screen.getAllByText(/login_with_token/i).length).toBeGreaterThan(0);
    });
  });
});
