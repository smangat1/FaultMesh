import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';
import { AGENT_SIMULATION_STEPS } from '../agent/agentSimulation';

describe('Autonomous Agent Live Simulation & Code Mutation', () => {
  it('defines valid agent simulation steps covering diagnosis, call tracing, patching, and verification', () => {
    expect(AGENT_SIMULATION_STEPS.length).toBeGreaterThanOrEqual(5);

    const phases = AGENT_SIMULATION_STEPS.map((s) => s.phase);
    expect(phases).toContain('diagnosing');
    expect(phases).toContain('tracing');
    expect(phases).toContain('inspecting');
    expect(phases).toContain('patching');
    expect(phases).toContain('verifying');
    expect(phases).toContain('resolved');

    // Verify patching step provides valid patched code & diff
    const patchStep = AGENT_SIMULATION_STEPS.find((s) => s.phase === 'patching');
    expect(patchStep).toBeDefined();
    expect(patchStep?.patchedSnippet).toContain('AGENT PATCH');
    expect(patchStep?.patchedDiff).toContain('+    # AGENT PATCH');
  });

  it('allows launching agent auto-repair directly from project selector screen', async () => {
    render(<App initialScreen="selector" />);

    // Check for the "Watch Agent Repair" button
    const agentBtn = await screen.findByRole('button', { name: /watch agent repair/i });
    expect(agentBtn).toBeDefined();

    // Launch agent auto-repair
    fireEvent.click(agentBtn);

    // Verify workspace opened in agent active mode
    expect(screen.getAllByText(/Scoping Failure/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Step 1\//i).length).toBeGreaterThan(0);
  });

  it('renders AgentDock with playback controls, thought streamer, and speed selector', async () => {
    render(<App initialScreen="workspace" />);

    // Toggle Agent Auto-Repair from graph toolbar
    const toolbarBtn = await screen.findByRole('button', { name: /agent auto-repair/i });
    expect(toolbarBtn).toBeDefined();
    fireEvent.click(toolbarBtn);

    // Verify AgentDock is present
    expect(screen.getAllByText(/Step 1\//i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /pause/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /step forward/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reset simulation/i })).toBeDefined();

    // Toggle thought streamer
    const thoughtBtn = screen.getByRole('button', { name: /toggle agent thought/i });
    fireEvent.click(thoughtBtn);
    expect(screen.getAllByText(/Agent Real-Time Thought Stream/i).length).toBeGreaterThan(0);
  });

  it('steps forward through agent workflow and successfully resolves test failure', async () => {
    render(<App initialScreen="workspace" />);

    // Launch agent
    const toolbarBtn = await screen.findByRole('button', { name: /agent auto-repair/i });
    fireEvent.click(toolbarBtn);

    // Pause autoplay to step manually
    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseBtn);

    // Step through each phase
    const stepBtn = screen.getByRole('button', { name: /step forward/i });

    // Step 2: Tracing
    fireEvent.click(stepBtn);
    expect(screen.getAllByText(/Tracing Call Flow/i).length).toBeGreaterThan(0);

    // Step 3: Inspecting
    fireEvent.click(stepBtn);
    expect(screen.getAllByText(/Candidate Defect Found/i).length).toBeGreaterThan(0);

    // Step 4: Live Patching
    fireEvent.click(stepBtn);
    expect(screen.getAllByText(/Live Patching Code/i).length).toBeGreaterThan(0);

    // Step 5: Verifying
    fireEvent.click(stepBtn);
    expect(screen.getAllByText(/Verifying with Pytest/i).length).toBeGreaterThan(0);

    // Step 6: Resolved
    fireEvent.click(stepBtn);
    expect(screen.getAllByText(/Regression Resolved/i).length).toBeGreaterThan(0);
  });
});
