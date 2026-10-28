import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveToast } from '../components/LiveToast';
import { GraphView, computeDeterministicPositions } from '../components/GraphView';
import type { GraphData, FileCluster, CodeNode } from '../types';

describe('Part 1: The Four Fixes (Live Workspace Polish)', () => {
  describe('Fix 1: Toast Placement (Never covers top toolbar controls)', () => {
    it('positions LiveToast at the bottom of the canvas instead of top', () => {
      const onDismiss = vi.fn();
      render(
        <LiveToast
          message="src/playground/pricing.py changed on disk"
          onDismiss={onDismiss}
        />
      );

      const toast = screen.getByRole('status');
      expect(toast).toBeDefined();
      expect(toast.style.bottom).toBe('22px');
      expect(toast.style.top).toBe('');
      expect(toast.style.left).toBe('50%');
      expect(toast.style.transform).toBe('translateX(-50%)');

      // Dismiss button is present and functional
      const dismissBtn = screen.getByRole('button', { name: /dismiss notification/i });
      expect(dismissBtn).toBeDefined();
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fix 2: Small Window Overflow & Responsive Toolbar', () => {
    const mockGraph: GraphData = {
      files: [
        { file: 'auth/service.py', name: 'service.py', symbolCount: 2, changeStatus: 'unchanged', lineCount: 50 },
        { file: 'auth/tokens.py', name: 'tokens.py', symbolCount: 2, changeStatus: 'unchanged', lineCount: 80 },
      ],
      nodes: [
        { id: 'n1', name: 'login', file: 'auth/service.py', parentModule: 'service', kind: 'function', changeStatus: 'unchanged', lineStart: 10, lineEnd: 20 },
        { id: 'n2', name: 'logout', file: 'auth/service.py', parentModule: 'service', kind: 'function', changeStatus: 'unchanged', lineStart: 25, lineEnd: 35 },
        { id: 'n3', name: 'validate_token', file: 'auth/tokens.py', parentModule: 'tokens', kind: 'function', changeStatus: 'unchanged', lineStart: 5, lineEnd: 15 },
        { id: 'n4', name: 'create_token', file: 'auth/tokens.py', parentModule: 'tokens', kind: 'function', changeStatus: 'unchanged', lineStart: 20, lineEnd: 30 },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n3', category: 'static_call', provenance: 'static_ast', confidence: 'resolved' },
      ],
      unresolvedReferences: [],
      parseErrors: [],
    };

    it('renders toolbar with responsive collapse classes and ensures zoom controls have flexShrink: 0', () => {
      const onToggleMapDrawer = vi.fn();
      const { container } = render(
        <div style={{ width: 784, height: 600 }}>
          <GraphView
            graphData={mockGraph}
            tests={[]}
            selectedTestId={null}
            isLive={true}
            onToggleMapDrawer={onToggleMapDrawer}
          />
        </div>
      );

      const toolbar = container.querySelector('.graph-toolbar');
      expect(toolbar).toBeDefined();

      // Fold buttons have responsive label class
      const unfoldLabels = container.querySelectorAll('.graph-btn-label-full');
      expect(unfoldLabels.length).toBeGreaterThanOrEqual(2);

      // Center title has responsive title class
      const titleLabel = container.querySelector('.graph-title-label');
      expect(titleLabel).toBeDefined();
      expect(titleLabel?.textContent).toContain('Whole Project Map');

      // Static context label has responsive context class
      const contextLabel = container.querySelector('.graph-context-label');
      expect(contextLabel).toBeDefined();

      // Search container has responsive search class
      const searchContainer = container.querySelector('.graph-search-container');
      expect(searchContainer).toBeDefined();

      // Zoom level indicator (MID) and zoom buttons are rendered and have flexShrink: 0
      const zoomIndicator = screen.getByText(/mid/i);
      expect(zoomIndicator).toBeDefined();
      expect(zoomIndicator.style.flexShrink).toBe('0');

      const zoomInBtn = screen.getByRole('button', { name: /zoom in/i });
      const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i });
      const fitBtn = screen.getByRole('button', { name: /fit to view/i });
      expect(zoomInBtn).toBeDefined();
      expect(zoomOutBtn).toBeDefined();
      expect(fitBtn).toBeDefined();

      // Live drawer buttons (Files, Diff / Source) are present
      expect(screen.getByRole('button', { name: /toggle files drawer/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /toggle diff drawer/i })).toBeDefined();
    });
  });

  describe('Fix 3: Fresh Map Default Links or Hint', () => {
    it('shows small useful default cross-file links with default-live-edge class and displays hint on open', () => {
      const mockGraphWithLinks: GraphData = {
        files: [
          { file: 'a.py', name: 'a.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 20 },
          { file: 'b.py', name: 'b.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 20 },
        ],
        nodes: [
          { id: 'sym_a', name: 'func_a', file: 'a.py', parentModule: 'a', kind: 'function', changeStatus: 'unchanged', lineStart: 1, lineEnd: 10 },
          { id: 'sym_b', name: 'func_b', file: 'b.py', parentModule: 'b', kind: 'function', changeStatus: 'unchanged', lineStart: 1, lineEnd: 10 },
        ],
        edges: [
          { id: 'edge_ab', source: 'sym_a', target: 'sym_b', category: 'static_call', provenance: 'static_ast', confidence: 'resolved' },
        ],
        unresolvedReferences: [],
        parseErrors: [],
      };

      let cy: any = null;
      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={mockGraphWithLinks}
            tests={[]}
            selectedTestId={null}
            isLive={true}
            selectedNodeId={null}
            selectedFile={null}
            highlightedNodeIds={[]}
            onCyReady={(instance) => {
              cy = instance;
            }}
          />
        </div>
      );

      // Default capped preview edge is rendered with muted styling
      const nonContainmentEdges = cy.edges('[category != "containment"]');
      expect(nonContainmentEdges.length).toBe(1);
      expect(nonContainmentEdges.first().hasClass('default-live-edge')).toBe(true);

      // Calm interaction hint is visible
      expect(screen.getByTestId('live-map-hint')).toBeDefined();
      expect(screen.getByText('Click a file to see what it connects to')).toBeDefined();
    });

    it('renders 0 fake links and shows hint when data has 0 cross-file edges', () => {
      const mockGraphNoEdges: GraphData = {
        files: [
          { file: 'standalone.py', name: 'standalone.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 20 },
        ],
        nodes: [
          { id: 'sym_standalone', name: 'lone_func', file: 'standalone.py', parentModule: 'standalone', kind: 'function', changeStatus: 'unchanged', lineStart: 1, lineEnd: 10 },
        ],
        edges: [],
        unresolvedReferences: [],
        parseErrors: [],
      };

      let cy: any = null;
      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={mockGraphNoEdges}
            tests={[]}
            selectedTestId={null}
            isLive={true}
            selectedNodeId={null}
            selectedFile={null}
            highlightedNodeIds={[]}
            onCyReady={(instance) => {
              cy = instance;
            }}
          />
        </div>
      );

      const nonContainmentEdges = cy.edges('[category != "containment"]');
      expect(nonContainmentEdges.length).toBe(0);

      // Hint is shown without any fake data
      expect(screen.getByTestId('live-map-hint')).toBeDefined();
      expect(screen.getByText('Click a file to see what it connects to')).toBeDefined();
    });

    it('hides the hint when hasActiveToast is true to prevent visual collision', () => {
      const mockGraph: GraphData = {
        files: [{ file: 'app.py', name: 'app.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 20 }],
        nodes: [{ id: 'app_main', name: 'main', file: 'app.py', parentModule: 'app', kind: 'function', changeStatus: 'unchanged', lineStart: 1, lineEnd: 10 }],
        edges: [],
        unresolvedReferences: [],
        parseErrors: [],
      };

      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={mockGraph}
            tests={[]}
            selectedTestId={null}
            isLive={true}
            hasActiveToast={true}
          />
        </div>
      );

      expect(screen.queryByTestId('live-map-hint')).toBeNull();
    });
  });

  describe('Fix 4: Sparse Map on Small Projects', () => {
    it('computes balanced circular layout positions for small file sets (<= 6 files)', () => {
      const files: FileCluster[] = [
        { file: 'src/config.py', name: 'config.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 30 },
        { file: 'src/pricing.py', name: 'pricing.py', symbolCount: 2, changeStatus: 'unchanged', lineCount: 50 },
        { file: 'src/invoice.py', name: 'invoice.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 40 },
      ];

      const nodes: CodeNode[] = [
        { id: 's1', name: 'load_cfg', file: 'src/config.py', parentModule: 'config', kind: 'function', changeStatus: 'unchanged', lineStart: 5, lineEnd: 15 },
        { id: 's2', name: 'calc_price', file: 'src/pricing.py', parentModule: 'pricing', kind: 'function', changeStatus: 'unchanged', lineStart: 10, lineEnd: 30 },
        { id: 's3', name: 'apply_tax', file: 'src/pricing.py', parentModule: 'pricing', kind: 'function', changeStatus: 'unchanged', lineStart: 35, lineEnd: 45 },
        { id: 's4', name: 'make_inv', file: 'src/invoice.py', parentModule: 'invoice', kind: 'function', changeStatus: 'unchanged', lineStart: 5, lineEnd: 25 },
      ];

      const positions = computeDeterministicPositions(files, nodes);

      // Positions exist for all files and symbols
      expect(positions['file:src/config.py']).toBeDefined();
      expect(positions['file:src/pricing.py']).toBeDefined();
      expect(positions['file:src/invoice.py']).toBeDefined();
      expect(positions['s1']).toBeDefined();
      expect(positions['s2']).toBeDefined();

      // Files are spaced across the canvas around (480, 360) with comfortable radius > 100px
      const pConfig = positions['file:src/config.py'];
      const pPricing = positions['file:src/pricing.py'];
      const dist = Math.hypot(pConfig.x - pPricing.x, pConfig.y - pPricing.y);
      expect(dist).toBeGreaterThan(150);
    });

    it('assigns sparse-node class to nodes in small projects for proportional sizing', () => {
      const smallGraph: GraphData = {
        files: [
          { file: 'alpha.py', name: 'alpha.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 20 },
          { file: 'beta.py', name: 'beta.py', symbolCount: 1, changeStatus: 'unchanged', lineCount: 20 },
        ],
        nodes: [
          { id: 'n_a', name: 'alpha_fn', file: 'alpha.py', parentModule: 'alpha', kind: 'function', changeStatus: 'unchanged', lineStart: 1, lineEnd: 10 },
          { id: 'n_b', name: 'beta_fn', file: 'beta.py', parentModule: 'beta', kind: 'function', changeStatus: 'unchanged', lineStart: 1, lineEnd: 10 },
        ],
        edges: [],
        unresolvedReferences: [],
        parseErrors: [],
      };

      let cy: any = null;
      render(
        <div style={{ width: 800, height: 600 }}>
          <GraphView
            graphData={smallGraph}
            tests={[]}
            selectedTestId={null}
            onCyReady={(instance) => {
              cy = instance;
            }}
          />
        </div>
      );

      const fileNodes = cy.nodes('[?isFileCluster]');
      expect(fileNodes.length).toBe(2);
      expect(fileNodes.first().hasClass('sparse-node')).toBe(true);

      const childNodes = cy.nodes('[!isFileCluster]');
      expect(childNodes.length).toBe(2);
      expect(childNodes.first().hasClass('sparse-node')).toBe(true);
    });
  });
});
