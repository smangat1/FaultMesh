import React, { useEffect, useRef, useState, useMemo } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import type { GraphData, TestItem, FileCluster, CodeNode } from '../types';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
} from 'lucide-react';

export type GraphViewMode = 'structure' | 'changes' | 'tests' | 'investigation';

export interface GraphViewProps {
  graphData: GraphData;
  tests: TestItem[];
  selectedTestId: string | null;
  onSelectTest?: (testId: string | null) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  selectedFile?: string | null;
  onSelectFile?: (file: string | null) => void;
  pinnedSymbolIds?: string[];
  collapsedFiles?: Set<string>;
  onToggleCollapseFile?: (file: string) => void;
  onCollapseAllFiles?: () => void;
  onExpandAllFiles?: () => void;
  viewMode?: GraphViewMode;
  onSelectViewMode?: (mode: GraphViewMode) => void;
  runStatus?: string;
  errorMessage?: string;
}

/**
 * Deterministically computes (x, y) coordinates for all files and their child symbols.
 * Guarantees 0ms layout jitter, 100% repeatability across runs and environments.
 */
export function computeDeterministicPositions(
  files: FileCluster[],
  nodes: CodeNode[]
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const COLS = 3;
  const COL_WIDTH = 440;
  const ROW_HEIGHT = 320;
  const ORIGIN_X = 240;
  const ORIGIN_Y = 180;

  // Group nodes by file
  const nodesByFile: Record<string, CodeNode[]> = {};
  for (const n of nodes) {
    if (!nodesByFile[n.file]) nodesByFile[n.file] = [];
    nodesByFile[n.file].push(n);
  }

  files.forEach((fileCluster, fIdx) => {
    const col = fIdx % COLS;
    const row = Math.floor(fIdx / COLS);
    const fileCenterX = ORIGIN_X + col * COL_WIDTH;
    const fileCenterY = ORIGIN_Y + row * ROW_HEIGHT;

    // Position compound parent node
    positions[`file:${fileCluster.file}`] = { x: fileCenterX, y: fileCenterY };

    // Position internal child symbols in 2-column subgrid inside file cluster for clean label readability
    const fileNodes = nodesByFile[fileCluster.file] || [];
    fileNodes.forEach((node, sIdx) => {
      const symCol = sIdx % 2;
      const symRow = Math.floor(sIdx / 2);
      const symX = fileCenterX - 70 + symCol * 140;
      const symY = fileCenterY - 60 + symRow * 42;
      positions[node.id] = { x: symX, y: symY };
    });
  });

  return positions;
}

export const GraphView: React.FC<GraphViewProps> = ({
  graphData,
  tests,
  selectedTestId,
  selectedNodeId,
  onSelectNode,
  selectedFile,
  onSelectFile,
  pinnedSymbolIds = [],
  collapsedFiles = new Set(),
  onToggleCollapseFile,
  onCollapseAllFiles,
  onExpandAllFiles,
  viewMode: propViewMode,
  onSelectViewMode,
  runStatus,
  errorMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const [currentViewMode, setCurrentViewMode] = useState<GraphViewMode>(propViewMode || 'tests');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeStaticContext, setIncludeStaticContext] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<'far' | 'mid' | 'close'>('mid');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (propViewMode && propViewMode !== currentViewMode) {
      setCurrentViewMode(propViewMode);
    }
  }, [propViewMode, currentViewMode]);

  const handleModeChange = (mode: GraphViewMode) => {
    setCurrentViewMode(mode);
    onSelectViewMode?.(mode);
    if (mode === 'structure') {
      setIncludeStaticContext(true);
    }
  };

  // Compute file clusters from graphData.files or dynamically from nodes
  const fileClusters: FileCluster[] = useMemo(() => {
    if (graphData.files && graphData.files.length > 0) {
      return graphData.files;
    }
    const fileMap = new Map<string, { count: number; changeStatus: CodeNode['changeStatus'] }>();
    graphData.nodes.forEach((n) => {
      const existing = fileMap.get(n.file) || { count: 0, changeStatus: 'unchanged' };
      existing.count += 1;
      if (n.changeStatus === 'modified') existing.changeStatus = 'modified';
      else if (n.changeStatus === 'added' && existing.changeStatus !== 'modified') {
        existing.changeStatus = 'added';
      }
      fileMap.set(n.file, existing);
    });
    return Array.from(fileMap.entries()).map(([file, info]) => ({
      file,
      name: file.split('/').pop() || file,
      symbolCount: info.count,
      changeStatus: info.changeStatus,
      lineCount: 100,
    }));
  }, [graphData.files, graphData.nodes]);

  const activeTest = useMemo(() => {
    return tests.find((t) => t.id === selectedTestId) || null;
  }, [tests, selectedTestId]);

  // Compute Cytoscape elements with deterministic preset positions
  const elements = useMemo(() => {
    const nodes: cytoscape.NodeDefinition[] = [];
    const edges: cytoscape.EdgeDefinition[] = [];

    if (graphData.nodes.length === 0) {
      return { nodes, edges };
    }

    const positions = computeDeterministicPositions(fileClusters, graphData.nodes);

    // 1. Add File Clusters (compound parents or summary nodes if collapsed)
    fileClusters.forEach((fc) => {
      const fileId = `file:${fc.file}`;
      const isCollapsed = collapsedFiles.has(fc.file);
      const pos = positions[fileId] || { x: 200, y: 200 };

      if (isCollapsed) {
        // Collapsed file shows as single summary node
        nodes.push({
          data: {
            id: fileId,
            label: `${fc.name} (${fc.symbolCount})`,
            file: fc.file,
            isFileCluster: true,
            isCollapsed: true,
            symbolCount: fc.symbolCount,
            changeStatus: fc.changeStatus,
          },
          position: pos,
        });
      } else {
        // Expanded file cluster (compound parent)
        nodes.push({
          data: {
            id: fileId,
            label: fc.name,
            file: fc.file,
            isFileCluster: true,
            isCollapsed: false,
            symbolCount: fc.symbolCount,
            changeStatus: fc.changeStatus,
          },
        });
      }
    });

    // 2. Add Symbol child nodes (only for uncollapsed files)
    graphData.nodes.forEach((n) => {
      if (collapsedFiles.has(n.file)) return;

      const fileId = `file:${n.file}`;
      const pos = positions[n.id] || { x: 200, y: 200 };
      const isTestItem = tests.some((t) => t.id === n.id);
      const testItem = tests.find((t) => t.id === n.id);

      nodes.push({
        data: {
          id: n.id,
          parent: fileId,
          label: n.name,
          shortLabel: n.name.length > 20 ? `${n.name.substring(0, 18)}…` : n.name,
          kind: n.kind,
          file: n.file,
          changeStatus: n.changeStatus,
          status: testItem ? testItem.status : 'neutral',
          isTest: isTestItem,
          description: n.description || '',
          lineStart: n.lineStart,
          lineEnd: n.lineEnd,
        },
        position: pos,
      });
    });

    const activeNodeIdSet = new Set(nodes.map((n) => n.data.id));

    // 3. Add Edges (re-routing to collapsed file node if child is collapsed)
    graphData.edges.forEach((e) => {
      let sourceId = e.source;
      let targetId = e.target;

      // Find file if node is inside a collapsed file
      const sourceNode = graphData.nodes.find((n) => n.id === sourceId);
      const targetNode = graphData.nodes.find((n) => n.id === targetId);

      if (sourceNode && collapsedFiles.has(sourceNode.file)) {
        sourceId = `file:${sourceNode.file}`;
      }
      if (targetNode && collapsedFiles.has(targetNode.file)) {
        targetId = `file:${targetNode.file}`;
      }

      // Avoid self-loops when nodes in same collapsed file connect
      if (sourceId === targetId) return;

      if (!activeNodeIdSet.has(sourceId) || !activeNodeIdSet.has(targetId)) return;

      // Filter static edges if toggled off
      if (!includeStaticContext && (e.category === 'static_call' || e.category === 'static_import')) {
        return;
      }

      // Per-test observed edges require explicit provenance for the active test
      if (e.category === 'runtime_observed' && activeTest) {
        if (!e.testIds || !e.testIds.includes(activeTest.id)) {
          return;
        }
      }

      edges.push({
        data: {
          id: e.id,
          source: sourceId,
          target: targetId,
          category: e.category,
          provenance: e.provenance,
          observedCount: e.observedCount,
          testIds: e.testIds || [],
        },
      });
    });

    return { nodes, edges };
  }, [graphData, fileClusters, collapsedFiles, tests, includeStaticContext]);

  // Priority set for label collision prevention:
  // selected > pinned > failing > changed > hovered > others
  const priorityNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (selectedNodeId) set.add(selectedNodeId);
    pinnedSymbolIds.forEach((id) => set.add(id));
    if (hoveredNodeId) set.add(hoveredNodeId);
    tests.forEach((t) => {
      if (t.status === 'fail' || t.status === 'error') set.add(t.id);
    });
    graphData.nodes.forEach((n) => {
      if (n.changeStatus === 'modified' || n.changeStatus === 'added') set.add(n.id);
    });
    return set;
  }, [selectedNodeId, pinnedSymbolIds, hoveredNodeId, tests, graphData.nodes]);

  // Initialize Cytoscape with preset deterministic layout and quiet Obsidian-like styling
  useEffect(() => {
    if (!containerRef.current || elements.nodes.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...elements.nodes, ...elements.edges],
      boxSelectionEnabled: false,
      autounselectify: false,
      style: [
        // --- Compound Parent Nodes (File Clusters: open constellation anchor, zero rectangular borders) ---
        {
          selector: 'node[?isFileCluster][!isCollapsed]',
          style: {
            shape: 'roundrectangle',
            'background-opacity': 0,
            'border-width': 0,
            padding: '24px',
            label: 'data(label)',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'top',
            'text-halign': 'left',
            'text-margin-x': 0,
            'text-margin-y': -8,
            color: '#64748b',
            'z-index': 1,
          },
        },
        // Collapsed file summary node: clean circular dot (12px)
        {
          selector: 'node[?isCollapsed]',
          style: {
            shape: 'ellipse',
            width: 12,
            height: 12,
            'background-color': '#94a3b8',
            'border-width': 0,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'font-size': '11px',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            color: '#cbd5e1',
            label: 'data(label)',
            'z-index': 10,
          },
        },
        {
          selector: 'node[?isCollapsed][changeStatus = "modified"]',
          style: {
            'background-color': '#d29922',
            'border-width': 1.5,
            'border-color': '#f6c156',
            width: 13,
            height: 13,
          },
        },
        {
          selector: 'node[?isCollapsed][changeStatus = "added"]',
          style: {
            'background-color': '#38bdf8',
            'border-width': 1.5,
            'border-color': '#7dd3fc',
            width: 13,
            height: 13,
          },
        },
        // --- Child Symbol Nodes (Functions / Classes / Methods: small circular dots) ---
        {
          selector: 'node[!isFileCluster]',
          style: {
            shape: 'ellipse',
            width: 6,
            height: 6,
            'background-color': '#64748b',
            'border-width': 0,
            label: '',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            color: '#cbd5e1',
            'text-max-width': '115px',
            'text-wrap': 'ellipsis',
            'text-background-color': '#101114',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'z-index': 15,
          },
        },
        // Class nodes: slightly larger circular dot
        {
          selector: 'node[kind = "class"]',
          style: {
            shape: 'ellipse',
            width: 7.5,
            height: 7.5,
            'background-color': '#7c8c9e',
          },
        },
        // Modified Code Node: Amber circle
        {
          selector: 'node[!isFileCluster][changeStatus = "modified"]',
          style: {
            'background-color': '#d29922',
            'border-width': 1.5,
            'border-color': '#f6c156',
            width: 8,
            height: 8,
            'z-index': 25,
          },
        },
        // Added Code Node: Restrained cyan circle
        {
          selector: 'node[!isFileCluster][changeStatus = "added"]',
          style: {
            'background-color': '#38bdf8',
            'border-width': 1.5,
            'border-color': '#7dd3fc',
            width: 8,
            height: 8,
            'z-index': 25,
          },
        },
        // Failing Test Node: Crimson circle
        {
          selector: 'node[!isFileCluster][status = "fail"]',
          style: {
            'background-color': '#f85149',
            'border-width': 1.5,
            'border-color': '#ff7b72',
            width: 10,
            height: 10,
            'z-index': 30,
          },
        },
        // Error Test Node: Orange circle
        {
          selector: 'node[!isFileCluster][status = "error"]',
          style: {
            'background-color': '#db6d28',
            'border-width': 1.5,
            'border-color': '#f0883e',
            width: 8,
            height: 8,
            'z-index': 30,
          },
        },
        // Passing Test Node: Green circle
        {
          selector: 'node[!isFileCluster][status = "pass"]',
          style: {
            'background-color': '#238636',
            width: 6,
            height: 6,
          },
        },
        // --- Structural Edges (1px fine strands, semi-transparent desaturated gray) ---
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#1f2937',
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
            opacity: 0.45,
            'z-index': 5,
          },
        },
        {
          selector: 'edge[category = "static_call"], edge[category = "static_import"]',
          style: {
            'line-color': '#1a2230',
            'line-style': 'solid',
            width: 1,
            opacity: 0.4,
          },
        },
        // --- Observed Edges for selected test: fine solid cyan strand ---
        {
          selector: 'edge.observed-for-test',
          style: {
            'line-color': '#38bdf8',
            'target-arrow-color': '#38bdf8',
            'target-arrow-shape': 'chevron',
            'arrow-scale': 0.7,
            width: 1.5,
            opacity: 1.0,
            'z-index': 40,
          },
        },
        // --- Test Dimming Classes (dims unexercised without removing) ---
        {
          selector: 'node.dimmed',
          style: {
            opacity: 0.22,
          },
        },
        {
          selector: 'node.exercised',
          style: {
            opacity: 1.0,
            'border-width': 1.5,
            'border-color': '#38bdf8',
          },
        },
        {
          selector: 'edge.dimmed',
          style: {
            opacity: 0.12,
          },
        },
        // Selected node focus (luminous outline)
        {
          selector: 'node.selected-node',
          style: {
            'border-color': '#f8fafc',
            'border-width': 2,
            'z-index': 999,
          },
        },
        // Show label class (driven by semantic zoom and collision prevention)
        {
          selector: 'node.show-label',
          style: {
            label: 'data(shortLabel)',
          },
        },
        // Hovered element
        {
          selector: 'node.hovered',
          style: {
            'border-color': '#60a5fa',
            'border-width': 2,
            'z-index': 500,
          },
        },
        {
          selector: 'edge.hovered',
          style: {
            'line-color': '#60a5fa',
            width: 2,
            'target-arrow-shape': 'chevron',
            'target-arrow-color': '#60a5fa',
            'z-index': 100,
          },
        },
      ],
      layout: {
        name: 'preset',
        fit: true,
        padding: 50,
      },
    });

    // Zoom listener for semantic zoom
    cy.on('zoom', () => {
      const z = cy.zoom();
      if (z < 0.65) setZoomLevel('far');
      else if (z < 1.15) setZoomLevel('mid');
      else setZoomLevel('close');
    });

    // Tap handlers
    cy.on('tap', 'node', (evt: EventObject) => {
      const target = evt.target;
      if (target.data('isFileCluster')) {
        onSelectFile?.(target.data('file'));
      } else {
        onSelectNode?.(target.id());
      }
    });

    // Double tap on file cluster to toggle expand/collapse
    cy.on('dbltap', 'node[?isFileCluster]', (evt: EventObject) => {
      const file = evt.target.data('file');
      if (file && onToggleCollapseFile) {
        onToggleCollapseFile(file);
      }
    });

    // Tap on background to deselect
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        onSelectNode?.(null);
        onSelectFile?.(null);
      }
    });

    // Mouseover / Mouseout
    cy.on('mouseover', 'node', (evt: EventObject) => {
      setHoveredNodeId(evt.target.id());
      evt.target.addClass('hovered');
    });

    cy.on('mouseout', 'node', (evt: EventObject) => {
      setHoveredNodeId(null);
      evt.target.removeClass('hovered');
    });

    cy.on('mouseover', 'edge', (evt: EventObject) => {
      evt.target.addClass('hovered');
    });

    cy.on('mouseout', 'edge', (evt: EventObject) => {
      evt.target.removeClass('hovered');
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, onSelectNode, onSelectFile, onToggleCollapseFile]);

  // Update selection highlight & test dimming dynamically WITHOUT re-running layout
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // 1. Clear selection styling
      cy.nodes().removeClass('selected-node');
      if (selectedNodeId) {
        cy.getElementById(selectedNodeId).addClass('selected-node');
      } else if (selectedFile) {
        cy.getElementById(`file:${selectedFile}`).addClass('selected-node');
      }

      // 2. Mode-aware highlight & dimming
      if (currentViewMode === 'changes') {
        // Changes Mode: highlight modified and added symbols, dim unchanged
        cy.nodes().forEach((n) => {
          if (n.data('isFileCluster')) {
            n.removeClass('dimmed');
            return;
          }
          const status = n.data('changeStatus');
          if (status === 'modified' || status === 'added') {
            n.addClass('exercised');
            n.removeClass('dimmed');
          } else {
            n.removeClass('exercised');
            n.addClass('dimmed');
          }
        });
        cy.edges().removeClass('observed-for-test');
      } else if (currentViewMode === 'structure') {
        // Structure Mode: all nodes and static structure visible with full contrast
        cy.nodes().removeClass('dimmed').removeClass('exercised');
        cy.edges().removeClass('dimmed').removeClass('observed-for-test');
      } else {
        // Tests & Investigation Modes: highlight active test coverage & runtime calls
        if (activeTest) {
          const exercisedSet = new Set(activeTest.exercisedNodeIds);
          exercisedSet.add(activeTest.id);

          cy.nodes().forEach((n) => {
            if (n.data('isFileCluster')) {
              // Keep file clusters visible
              n.removeClass('dimmed');
              return;
            }
            if (exercisedSet.has(n.id())) {
              n.addClass('exercised');
              n.removeClass('dimmed');
            } else {
              n.removeClass('exercised');
              n.addClass('dimmed');
            }
          });

          cy.edges().forEach((e) => {
            const isObserved =
              e.data('category') === 'runtime_observed' &&
              Boolean(e.data('testIds')?.includes(activeTest.id));

            if (isObserved) {
              e.addClass('observed-for-test');
              e.removeClass('dimmed');
            } else {
              e.removeClass('observed-for-test');
              e.addClass('dimmed');
            }
          });
        } else {
          // No test selected: restore full contrast
          cy.nodes().removeClass('dimmed').removeClass('exercised');
          cy.edges().removeClass('dimmed').removeClass('observed-for-test');
        }
      }

      // 3. Semantic Zoom & Collision-Managed Labels
      cy.nodes().removeClass('show-label');

      if (zoomLevel === 'close') {
        // Zoomed in: show all symbol labels inside clusters
        cy.nodes('[!isFileCluster]').addClass('show-label');
      } else if (zoomLevel === 'mid') {
        // Mid zoom: show labels only for priority nodes (selected > pinned > failing > changed > hovered)
        cy.nodes().forEach((n) => {
          if (!n.data('isFileCluster') && priorityNodeIds.has(n.id())) {
            n.addClass('show-label');
          }
        });
      }
      // Far zoom: labels remain hidden on symbols, only file names shown on clusters
    });
  }, [selectedNodeId, selectedFile, activeTest, zoomLevel, priorityNodeIds, currentViewMode]);

  // ResizeObserver to handle container size changes cleanly
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (cyRef.current) {
        cyRef.current.resize();
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Search handler: pans & zooms camera to target symbol without re-layout
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    const cy = cyRef.current;
    if (!cy || !query.trim()) return;

    const matched = cy.nodes().filter((n) => {
      const label = n.data('label') || '';
      const id = n.id();
      return (
        label.toLowerCase().includes(query.toLowerCase()) ||
        id.toLowerCase().includes(query.toLowerCase())
      );
    });

    if (matched.length > 0) {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

      cy.animate({
        center: { eles: matched.first() },
        zoom: 1.3,
        duration: prefersReducedMotion ? 0 : 200,
      });
      onSelectNode?.(matched.first().id());
    }
  };

  const handleFit = () => {
    cyRef.current?.fit(undefined, 40);
  };

  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 1.3);
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 0.75);
  };

  // Diagnostic states for empty / failed harness
  if (runStatus === 'empty') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '40px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          backgroundColor: 'var(--bg-app)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Empty Repository Scan
        </div>
        <div style={{ fontSize: '12px', maxWidth: '420px', lineHeight: '1.5' }}>
          Scan completed with 0 test cases detected. Static AST discovered 0 executable code nodes.
        </div>
      </div>
    );
  }

  if (runStatus === 'failed') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '40px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          backgroundColor: 'var(--bg-app)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--status-error)', marginBottom: '4px' }}>
          Harness Aborted During Collection
        </div>
        <div style={{ fontSize: '12px', maxWidth: '480px', lineHeight: '1.5' }}>
          {errorMessage || 'Runner encountered an unhandled collection error before runtime traces could be collected.'}
        </div>
      </div>
    );
  }

  if (graphData.nodes.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '40px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          backgroundColor: 'var(--bg-app)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          No Project Map Available
        </div>
        <div style={{ fontSize: '12px', maxWidth: '420px', lineHeight: '1.5' }}>
          No graph nodes or source files are recorded for this run.
        </div>
      </div>
    );
  }

  const isAllCollapsed =
    fileClusters.length > 0 && fileClusters.every((fc) => collapsedFiles.has(fc.file));

  const handleToggleAllCollapse = () => {
    if (isAllCollapsed) {
      onExpandAllFiles?.();
    } else {
      onCollapseAllFiles?.();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-app)',
      }}
    >
      {/* Calm Obsidian/Zotero Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-default)',
          gap: '12px',
          flexWrap: 'nowrap',
          zIndex: 10,
          minHeight: '38px',
        }}
      >
        {/* Left: Mode Switcher + Scope / Highlighting Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, overflow: 'hidden' }}>
          {/* Mode Segmented Control: Structure | Changes | Tests | Investigation */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-app)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px',
              border: '1px solid var(--border-default)',
              flexShrink: 0,
            }}
            role="radiogroup"
            aria-label="Graph View Mode"
          >
            {(['structure', 'changes', 'tests', 'investigation'] as GraphViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: currentViewMode === mode ? 600 : 400,
                  backgroundColor: currentViewMode === mode ? 'var(--bg-active)' : 'transparent',
                  color: currentViewMode === mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
                role="radio"
                aria-checked={currentViewMode === mode}
              >
                {mode}
              </button>
            ))}
          </div>

          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeTest ? `Highlighting: ${activeTest.name}` : 'Whole Project Map'}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            ({graphData.nodes.length} nodes, {elements.edges.length} edges)
          </span>

          {activeTest && !activeTest.callTracingAvailable && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(210, 153, 34, 0.15)',
                color: '#d29922',
                border: '1px solid rgba(210, 153, 34, 0.3)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title="Coverage recorded without runtime call-edge tracing"
            >
              Coverage only
            </span>
          )}
        </div>

        {/* Right: Level Toggle, Static Context Toggle, Search, Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Level Toggle Button */}
          <button
            onClick={handleToggleAllCollapse}
            className="btn-ghost btn-sm"
            style={{ fontSize: '11px', padding: '2px 7px' }}
            title={isAllCollapsed ? 'Expand all files into function constellations' : 'Collapse all files into overview dots'}
          >
            {isAllCollapsed ? 'Expand All' : 'Collapse to Files'}
          </button>

          <label
            style={{
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: includeStaticContext ? 'var(--text-primary)' : 'var(--text-secondary)',
              userSelect: 'none',
            }}
            title="Toggle static structure relationships (imports and static AST calls)"
          >
            <input
              type="checkbox"
              checked={includeStaticContext}
              onChange={(e) => setIncludeStaticContext(e.target.checked)}
              aria-label="Include Static Context"
            />
            <span>Static Context</span>
          </label>

          {/* Quick Search */}
          <div style={{ position: 'relative', width: '130px' }}>
            <Search
              size={11}
              style={{
                position: 'absolute',
                left: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Find symbol..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px 2px 22px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                outline: 'none',
                fontFamily: 'inherit',
              }}
              aria-label="Find symbol in map"
            />
          </div>

          {/* Zoom Level Indicator */}
          <span
            style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {zoomLevel}
          </span>

          {/* Zoom Buttons */}
          <div style={{ display: 'flex', gap: '2px' }}>
            <button onClick={handleZoomIn} className="btn-ghost btn-sm" title="Zoom In" aria-label="Zoom in">
              <ZoomIn size={12} />
            </button>
            <button onClick={handleZoomOut} className="btn-ghost btn-sm" title="Zoom Out" aria-label="Zoom out">
              <ZoomOut size={12} />
            </button>
            <button onClick={handleFit} className="btn-ghost btn-sm" title="Fit to View" aria-label="Fit to view">
              <Maximize2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Cytoscape Canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          backgroundColor: '#101114',
        }}
      />
    </div>
  );
};
