import React, { useEffect, useRef, useMemo, useState } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import type { GraphData, TestItem, FileCluster, CodeNode } from '../types';
import { ZoomIn, ZoomOut, Maximize2, Search } from 'lucide-react';

export type GraphViewMode = 'structure' | 'changes' | 'tests' | 'investigation';

interface GraphViewProps {
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
 * Uses relationship-informed architectural tiering and organic celestial starburst clustering.
 */
const KNOWN_FILE_COORDINATES: Record<string, { x: number; y: number }> = {
  // Ingress / Test tier at top (y = 110)
  'tests/test_auth.py': { x: 340, y: 110 },
  'tests/test_sessions.py': { x: 620, y: 110 },
  // Core coordinator hub at center (y = 290)
  'auth/service.py': { x: 480, y: 290 },
  // Security & Token authority wing (left, x = 230)
  'auth/tokens.py': { x: 230, y: 470 },
  'auth/crypto.py': { x: 230, y: 680 },
  // Traffic protection (central intermediary, x = 480)
  'auth/limiter.py': { x: 480, y: 520 },
  // State & Session persistence wing (right, x = 730)
  'auth/sessions.py': { x: 730, y: 470 },
  'auth/models.py': { x: 730, y: 680 },
};

export function computeDeterministicPositions(
  files: FileCluster[],
  nodes: CodeNode[]
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  // Group nodes by file
  const nodesByFile: Record<string, CodeNode[]> = {};
  for (const n of nodes) {
    if (!nodesByFile[n.file]) nodesByFile[n.file] = [];
    nodesByFile[n.file].push(n);
  }

  files.forEach((fileCluster, fIdx) => {
    let fileCenterX: number;
    let fileCenterY: number;

    if (KNOWN_FILE_COORDINATES[fileCluster.file]) {
      fileCenterX = KNOWN_FILE_COORDINATES[fileCluster.file].x;
      fileCenterY = KNOWN_FILE_COORDINATES[fileCluster.file].y;
    } else {
      // Golden angle spiral distribution for arbitrary repositories / scale fixtures
      const phi = 2.399963229728653; // golden angle in radians
      const angle = fIdx * phi;
      const radius = 220 + Math.sqrt(fIdx / Math.max(files.length, 1)) * 480;
      let hash = 0;
      for (let i = 0; i < fileCluster.file.length; i++) {
        hash = (hash * 31 + fileCluster.file.charCodeAt(i)) & 0xffffffff;
      }
      const jitterX = (hash % 30) - 15;
      const jitterY = ((hash >> 4) % 30) - 15;
      fileCenterX = Math.round(480 + Math.cos(angle) * radius + jitterX);
      fileCenterY = Math.round(420 + Math.sin(angle) * radius + jitterY);
    }

    // Position file anchor node
    positions[`file:${fileCluster.file}`] = { x: fileCenterX, y: fileCenterY };

    // Position internal child symbols in an organic celestial constellation
    const fileNodes = nodesByFile[fileCluster.file] || [];
    const count = fileNodes.length;

    // Order functions: modified/failing first, then by line order
    const sortedFileNodes = [...fileNodes].sort((a, b) => {
      if (a.changeStatus === 'modified') return -1;
      if (b.changeStatus === 'modified') return 1;
      return a.lineStart - b.lineStart;
    });

    sortedFileNodes.forEach((node, sIdx) => {
      const angle = (sIdx * ((2 * Math.PI) / Math.max(count, 1))) + 0.35;
      const radius = 45 + ((sIdx * 37) % 35);
      const symX = Math.round(fileCenterX + Math.cos(angle) * radius);
      const symY = Math.round(fileCenterY + Math.sin(angle) * radius);
      positions[node.id] = { x: symX, y: symY };
    });
  });

  return positions;
}

export const GraphView: React.FC<GraphViewProps> = ({
  graphData,
  tests,
  selectedTestId,
  onSelectTest,
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const [currentViewMode, setCurrentViewMode] = useState<GraphViewMode>(propViewMode || 'structure');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeStaticContext, setIncludeStaticContext] = useState(
    (propViewMode ? propViewMode === 'structure' : true) && !selectedTestId
  );
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

  // Compute Cytoscape elements with deterministic preset positions and call order
  const elements = useMemo(() => {
    const nodes: cytoscape.NodeDefinition[] = [];
    const edges: cytoscape.EdgeDefinition[] = [];

    if (graphData.nodes.length === 0) {
      return { nodes, edges };
    }

    const positions = computeDeterministicPositions(fileClusters, graphData.nodes);

    // Compute execution step order if an active test is being traced
    const edgeStepMap = new Map<string, number>();
    const nodeStepMap = new Map<string, number>();

    if (activeTest) {
      const observedEdges = graphData.edges.filter(
        (e) => e.category === 'runtime_observed' && e.testIds?.includes(activeTest.id)
      );

      nodeStepMap.set(activeTest.id, 0);
      const queue: string[] = [activeTest.id];
      let stepCounter = 1;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const outgoing = observedEdges.filter((e) => e.source === curr);
        outgoing.forEach((e) => {
          if (!edgeStepMap.has(e.id)) {
            edgeStepMap.set(e.id, stepCounter);
            if (!nodeStepMap.has(e.target)) {
              nodeStepMap.set(e.target, stepCounter);
              queue.push(e.target);
            }
            stepCounter++;
          }
        });
      }
    }

    // 1. Add File Clusters (with architectural role subtitle)
    fileClusters.forEach((fc) => {
      const fileId = `file:${fc.file}`;
      const isCollapsed = collapsedFiles.has(fc.file);
      const pos = positions[fileId] || { x: 480, y: 360 };

      const subtitle = fc.role ? `\n${fc.role}` : '';
      const displayLabel = isCollapsed
        ? `${fc.name}${subtitle ? ` • ${fc.role}` : ` (${fc.symbolCount})`}`
        : `${fc.name}${subtitle}`;

      nodes.push({
        data: {
          id: fileId,
          label: displayLabel,
          shortLabel: fc.name,
          file: fc.file,
          isFileCluster: true,
          isCollapsed,
          symbolCount: fc.symbolCount,
          changeStatus: fc.changeStatus,
          role: fc.role || '',
          tier: fc.tier || '',
        },
        position: pos,
      });
    });

    // 2. Add Symbol child nodes (ONLY for uncollapsed files - genuine semantic zooming)
    graphData.nodes.forEach((n) => {
      if (collapsedFiles.has(n.file)) return;

      const pos = positions[n.id] || { x: 480, y: 360 };
      const isTestItem = tests.some((t) => t.id === n.id);
      const testItem = tests.find((t) => t.id === n.id);
      const stepNumber = nodeStepMap.get(n.id);

      const stepPrefix = stepNumber !== undefined ? `[${stepNumber}] ` : '';
      const formattedLabel = `${stepPrefix}${n.name}`;
      const short = n.name.length > 18 ? `${n.name.substring(0, 16)}…` : n.name;

      nodes.push({
        data: {
          id: n.id,
          label: formattedLabel,
          shortLabel: `${stepPrefix}${short}`,
          kind: n.kind,
          file: n.file,
          changeStatus: n.changeStatus,
          status: testItem ? testItem.status : 'neutral',
          isTest: isTestItem,
          description: n.description || '',
          lineStart: n.lineStart,
          lineEnd: n.lineEnd,
          stepNumber,
        },
        position: pos,
      });

      // Faint radial containment strand linking expanded file anchor to each child symbol
      const fileId = `file:${n.file}`;
      edges.push({
        data: {
          id: `containment:${fileId}->${n.id}`,
          source: fileId,
          target: n.id,
          category: 'containment',
          isContainment: true,
        },
      });
    });

    const activeNodeIdSet = new Set(nodes.map((n) => n.data.id));
    const addedAggregatedEdges = new Set<string>();

    // 3. Add Edges (re-routing to collapsed file node if child's file is collapsed)
    graphData.edges.forEach((e) => {
      let sourceId = e.source;
      let targetId = e.target;

      const sourceNode = graphData.nodes.find((n) => n.id === sourceId);
      const targetNode = graphData.nodes.find((n) => n.id === targetId);

      const sourceFile = sourceNode?.file;
      const targetFile = targetNode?.file;

      const isSourceCollapsed = sourceFile ? collapsedFiles.has(sourceFile) : false;
      const isTargetCollapsed = targetFile ? collapsedFiles.has(targetFile) : false;

      if (isSourceCollapsed && sourceFile) {
        sourceId = `file:${sourceFile}`;
      }
      if (isTargetCollapsed && targetFile) {
        targetId = `file:${targetFile}`;
      }

      // Avoid self-loops when nodes within same collapsed file connect
      if (sourceId === targetId) return;

      if (!activeNodeIdSet.has(sourceId) || !activeNodeIdSet.has(targetId)) return;

      // Filter static edges if toggled off
      if (!includeStaticContext && (e.category === 'static_call' || e.category === 'static_import')) {
        return;
      }

      // If both endpoints are file nodes, aggregate and deduplicate into single fine architectural strand
      const isAggregated = sourceId.startsWith('file:') && targetId.startsWith('file:');
      if (isAggregated) {
        const edgeKey = `${sourceId}->${targetId}`;
        if (addedAggregatedEdges.has(edgeKey)) return;
        addedAggregatedEdges.add(edgeKey);

        edges.push({
          data: {
            id: `agg:${edgeKey}`,
            source: sourceId,
            target: targetId,
            category: 'aggregated_structural',
            isAggregated: true,
            provenance: 'static_ast',
            testIds: e.testIds || [],
          },
        });
        return;
      }

      // Per-test observed edges require explicit provenance for the active test
      if (e.category === 'runtime_observed' && activeTest) {
        if (!e.testIds || !e.testIds.includes(activeTest.id)) {
          return;
        }
      }

      const stepNum = edgeStepMap.get(e.id);

      edges.push({
        data: {
          id: e.id,
          source: sourceId,
          target: targetId,
          category: e.category,
          provenance: e.provenance,
          observedCount: e.observedCount,
          testIds: e.testIds || [],
          stepNumber: stepNum,
          stepLabel: stepNum !== undefined ? `[${stepNum}]` : '',
        },
      });
    });

    return { nodes, edges };
  }, [graphData, fileClusters, collapsedFiles, tests, includeStaticContext, activeTest]);

  const structuralEdgeCount = useMemo(
    () => elements.edges.filter((e) => !e.data.isContainment).length,
    [elements.edges]
  );

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

  // 1. Initialize Cytoscape ONCE on container mount with preset deterministic layout
  useEffect(() => {
    if (!containerRef.current || elements.nodes.length === 0) return;

    if (!cyRef.current) {
      const cy = cytoscape({
        container: containerRef.current,
        elements: [...elements.nodes, ...elements.edges],
        boxSelectionEnabled: false,
        autounselectify: false,
        wheelSensitivity: 0.25,
        style: [
          // --- File Cluster Nodes (Clean circular dots with architectural subtitles) ---
          {
            selector: 'node[?isFileCluster]',
            style: {
              shape: 'ellipse',
              width: 14,
              height: 14,
              'background-color': '#94a3b8',
              'border-width': 0,
              label: 'data(label)',
              'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              'font-size': '10px',
              'font-weight': 600,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 5,
              color: '#cbd5e1',
              'text-wrap': 'wrap',
              'text-max-width': '140px',
              'text-background-color': '#101114',
              'text-background-opacity': 0.85,
              'text-background-padding': '3px',
              'text-background-shape': 'roundrectangle',
              'z-index': 20,
            },
          },
          // Expanded file center anchor
          {
            selector: 'node[?isFileCluster][!isCollapsed]',
            style: {
              width: 13,
              height: 13,
              'background-color': '#475569',
              'border-width': 1.5,
              'border-color': '#94a3b8',
              'border-opacity': 0.8,
              color: '#94a3b8',
            },
          },
          // Modified file
          {
            selector: 'node[?isFileCluster][changeStatus = "modified"]',
            style: {
              'background-color': '#d29922',
              'border-width': 1.5,
              'border-color': '#f6c156',
              width: 15,
              height: 15,
            },
          },
          // Added file
          {
            selector: 'node[?isFileCluster][changeStatus = "added"]',
            style: {
              'background-color': '#38bdf8',
              'border-width': 1.5,
              'border-color': '#7dd3fc',
              width: 15,
              height: 15,
            },
          },
          // --- Child Symbol Nodes (Functions / Classes: small circular dots) ---
          {
            selector: 'node[!isFileCluster]',
            style: {
              shape: 'ellipse',
              width: 5.5,
              height: 5.5,
              'background-color': '#64748b',
              'border-width': 0,
              label: '',
              'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              'font-size': '10px',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              color: '#cbd5e1',
              'text-max-width': '125px',
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
              width: 7,
              height: 7,
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
              width: 7.5,
              height: 7.5,
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
              width: 7.5,
              height: 7.5,
              'z-index': 25,
            },
          },
          // Failing Test Node: Crimson circle
          {
            selector: 'node[!isFileCluster][status = "fail"]',
            style: {
              'background-color': '#f85149',
              'border-width': 2,
              'border-color': '#ff7b72',
              width: 9,
              height: 9,
              'z-index': 30,
            },
          },
          // Error Test Node: Orange circle
          {
            selector: 'node[!isFileCluster][status = "error"]',
            style: {
              'background-color': '#db6d28',
              'border-width': 2,
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
              width: 5,
              height: 5,
            },
          },
          // --- Containment rays from file center anchor to child symbols ---
          {
            selector: 'edge[category = "containment"]',
            style: {
              width: 0.75,
              'line-color': '#243042',
              'line-style': 'solid',
              opacity: 0.35,
              'curve-style': 'straight',
              'target-arrow-shape': 'none',
              'z-index': 2,
            },
          },
          // --- Aggregated structural edges between files at overview ---
          {
            selector: 'edge[?isAggregated]',
            style: {
              width: 1.2,
              'line-color': '#2e3b4e',
              'curve-style': 'bezier',
              opacity: 0.6,
              'target-arrow-shape': 'none',
              'z-index': 5,
            },
          },
          // --- Structural Edges with Directional Triangle Arrows ---
          {
            selector: 'edge[!isAggregated][category != "containment"]',
            style: {
              width: 0.85,
              'line-color': '#222d3d',
              'curve-style': 'bezier',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': '#222d3d',
              'arrow-scale': 0.65,
              opacity: 0.5,
              'z-index': 5,
            },
          },
          {
            selector: 'edge[category = "static_call"], edge[category = "static_import"]',
            style: {
              'line-color': '#243244',
              'target-arrow-color': '#243244',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.7,
              'line-style': 'solid',
              width: 0.85,
              opacity: 0.55,
            },
          },
          // --- Observed Edges for selected test: Cyan strand with Sequential Step Badges ---
          {
            selector: 'edge.observed-for-test',
            style: {
              'line-color': '#38bdf8',
              'target-arrow-color': '#38bdf8',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.85,
              width: 1.6,
              opacity: 1.0,
              'z-index': 40,
              label: 'data(stepLabel)',
              'font-size': '9px',
              'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              'font-weight': 700,
              color: '#38bdf8',
              'text-background-color': '#101114',
              'text-background-opacity': 0.9,
              'text-background-padding': '2px',
              'text-background-shape': 'roundrectangle',
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
              'border-width': 1.8,
              'border-color': '#38bdf8',
            },
          },
          {
            selector: 'edge.dimmed',
            style: {
              opacity: 0.1,
            },
          },
          // Selected node focus (luminous outline)
          {
            selector: 'node.selected-node',
            style: {
              'border-color': '#ffffff',
              'border-width': 2.5,
              'border-opacity': 1,
              'z-index': 999,
            },
          },
          // Neighbor highlighted on hover
          {
            selector: 'node.neighbor-highlighted',
            style: {
              'border-color': '#60a5fa',
              'border-width': 1.5,
              'z-index': 400,
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
              width: 1.8,
              opacity: 0.9,
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

      // Zoom listener for semantic zoom level tracking (does not trigger layout destruction)
      cy.on('zoom', () => {
        const z = cy.zoom();
        if (z < 0.8) setZoomLevel('far');
        else if (z < 1.3) setZoomLevel('mid');
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

      // Double tap on background to fit view
      cy.on('dbltap', (evt: EventObject) => {
        if (evt.target === cy) {
          cy.animate({
            fit: { eles: cy.elements(), padding: 40 },
            duration: 250,
          });
        }
      });

      // Tap on background to deselect
      cy.on('tap', (evt: EventObject) => {
        if (evt.target === cy) {
          onSelectNode?.(null);
          onSelectFile?.(null);
        }
      });

      // Mouseover / Mouseout with neighborhood strand illumination
      cy.on('mouseover', 'node', (evt: EventObject) => {
        const target = evt.target;
        setHoveredNodeId(target.id());
        target.addClass('hovered');
        target.neighborhood('edge').addClass('hovered');
        target.neighborhood('node').addClass('neighbor-highlighted');
      });

      cy.on('mouseout', 'node', (evt: EventObject) => {
        setHoveredNodeId(null);
        evt.target.removeClass('hovered');
        cy.elements().removeClass('hovered').removeClass('neighbor-highlighted');
      });

      cy.on('mouseover', 'edge', (evt: EventObject) => {
        evt.target.addClass('hovered');
      });

      cy.on('mouseout', 'edge', (evt: EventObject) => {
        evt.target.removeClass('hovered');
      });

      cyRef.current = cy;
      return;
    }

    // 2. Incremental element updates: preserve current zoom and pan without any jumps
    const cy = cyRef.current;
    const currentPan = cy.pan();
    const currentZoom = cy.zoom();

    const allElements = [...elements.nodes, ...elements.edges];
    const newIds = new Set(allElements.map((el) => el.data.id));

    cy.batch(() => {
      // Remove elements no longer present
      cy.elements().forEach((el) => {
        if (!newIds.has(el.id())) {
          cy.remove(el);
        }
      });

      // Add or update elements
      const toAdd: cytoscape.ElementDefinition[] = [];
      allElements.forEach((el) => {
        const id = el.data.id;
        if (!id) return;
        const existing = cy.getElementById(id);
        if (existing.length > 0) {
          existing.data(el.data);
          if (el.position) {
            existing.position(el.position);
          }
        } else {
          toAdd.push(el);
        }
      });

      if (toAdd.length > 0) {
        cy.add(toAdd);
      }
    });

    // Retain exact camera viewport
    cy.viewport({ zoom: currentZoom, pan: currentPan });
  }, [elements, onSelectNode, onSelectFile, onToggleCollapseFile]);

  // Clean up Cytoscape on unmount
  useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, []);

  // Update classes and dynamic highlights
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
      if (activeTest) {
        // Highlighting active test coverage & runtime calls
        const exercisedSet = new Set(activeTest.exercisedNodeIds);
        exercisedSet.add(activeTest.id);

        cy.nodes().forEach((n) => {
          if (n.data('isFileCluster')) {
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
      } else if (currentViewMode === 'changes') {
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
      } else {
        // All Code / Structure Mode: full contrast on all elements
        cy.nodes().removeClass('dimmed').removeClass('exercised');
        cy.edges().removeClass('dimmed').removeClass('observed-for-test');
      }

      // 3. Semantic Zoom & Collision-Managed Labels
      cy.nodes().removeClass('show-label');

      if (zoomLevel === 'close') {
        // Zoomed in: show all symbol labels inside clusters
        cy.nodes('[!isFileCluster]').addClass('show-label');
      } else if (zoomLevel === 'mid') {
        // Mid zoom: show labels only for priority nodes
        cy.nodes().forEach((n) => {
          if (!n.data('isFileCluster') && priorityNodeIds.has(n.id())) {
            n.addClass('show-label');
          }
        });
      }
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

  // Zoom controls with smooth camera animation
  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({
      zoom: cy.zoom() * 1.35,
      duration: 180,
    });
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({
      zoom: cy.zoom() / 1.35,
      duration: 180,
    });
  };

  const handleFit = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({
      fit: { eles: cy.elements(), padding: 40 },
      duration: 250,
    });
  };

  // Empty state guard
  if (graphData.nodes.length === 0 && (!graphData.files || graphData.files.length === 0)) {
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
          backgroundColor: '#101114',
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
        backgroundColor: '#101114',
      }}
    >
      {/* Calm Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          backgroundColor: '#11141a',
          borderBottom: '1px solid var(--border-default)',
          gap: '12px',
          flexWrap: 'nowrap',
          zIndex: 10,
          minHeight: '38px',
        }}
      >
        {/* Left: Clear Layer Controls + Active Test Scope */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, overflow: 'hidden' }}>
          {/* Layer Selector: All Code vs Changed Code */}
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
            <button
              onClick={() => handleModeChange('structure')}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: currentViewMode === 'structure' ? 600 : 400,
                backgroundColor: currentViewMode === 'structure' ? 'var(--bg-active)' : 'transparent',
                color: currentViewMode === 'structure' ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
              role="radio"
              aria-label="Structure"
              aria-checked={currentViewMode === 'structure'}
              title="Show entire codebase structure and static relationships"
            >
              Structure
            </button>

            <button
              onClick={() => handleModeChange('changes')}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: currentViewMode === 'changes' ? 600 : 400,
                backgroundColor: currentViewMode === 'changes' ? 'var(--bg-active)' : 'transparent',
                color: currentViewMode === 'changes' ? 'var(--change-modified)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
              role="radio"
              aria-label="Changes"
              aria-checked={currentViewMode === 'changes'}
              title="Highlight modified and added files/functions in this commit"
            >
              Changes
            </button>
          </div>

          {/* Active Test Scope or Overview Scope */}
          {activeTest ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: activeTest.status === 'fail' ? '#f87171' : '#34d399',
                  backgroundColor:
                    activeTest.status === 'fail'
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'rgba(16, 185, 129, 0.12)',
                  border:
                    activeTest.status === 'fail'
                      ? '1px solid rgba(239, 68, 68, 0.3)'
                      : '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  whiteSpace: 'nowrap',
                  maxWidth: '280px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'inline-block',
                }}
                title={`Highlighting: ${activeTest.name}`}
              >
                Highlighting: {activeTest.name}
              </span>
              <button
                onClick={() => onSelectTest?.(null)}
                className="btn-ghost btn-sm"
                style={{ fontSize: '10px', padding: '1px 5px', color: 'var(--text-muted)' }}
                title="Clear test tracing and return to whole project overview"
              >
                ✕ Clear
              </button>
            </div>
          ) : (
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
              Whole Project Map
            </span>
          )}

          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            ({graphData.nodes.length} nodes, {structuralEdgeCount} edges)
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
            title={
              isAllCollapsed
                ? 'Expand all files into function constellations'
                : 'Collapse all files into overview dots'
            }
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
            <button
              onClick={handleZoomIn}
              className="btn-ghost btn-sm"
              title="Zoom In"
              aria-label="Zoom in"
            >
              <ZoomIn size={12} />
            </button>
            <button
              onClick={handleZoomOut}
              className="btn-ghost btn-sm"
              title="Zoom Out"
              aria-label="Zoom out"
            >
              <ZoomOut size={12} />
            </button>
            <button
              onClick={handleFit}
              className="btn-ghost btn-sm"
              title="Fit to View"
              aria-label="Fit to view"
            >
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
