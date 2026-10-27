import React, { useEffect, useRef, useMemo, useState } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import type { GraphData, TestItem, FileCluster, CodeNode } from '../types';
import { ZoomIn, ZoomOut, Maximize2, Search, ChevronsDown, ChevronsUp, Bot } from 'lucide-react';
import type { AgentPhase, AgentSimulationStep } from '../agent/agentSimulation';
import { AGENT_SIMULATION_STEPS } from '../agent/agentSimulation';
import { InvestigationReplayBar } from './InvestigationReplayBar';
import { StepExplanationPopup } from './StepExplanationPopup';

export type GraphViewMode = 'structure' | 'changes' | 'tests' | 'investigation';

interface GraphViewProps {
  graphData: GraphData;
  tests: TestItem[];
  datasetKey?: string;
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
  isAgentMode?: boolean;
  onToggleAgentMode?: () => void;
  agentActiveNodeId?: string | null;
  agentPhase?: AgentPhase;
  agentPhaseLabel?: string;
  agentActionPill?: string;
  agentActiveEdgeIds?: string[];
  agentZoomTarget?: number;
  isInspectorOpen?: boolean;
  agentStepIndex?: number;
  totalAgentSteps?: number;
  isAgentPlaying?: boolean;
  onToggleAgentPlay?: () => void;
  onPrevAgentStep?: () => void;
  onNextAgentStep?: () => void;
  onRestartAgent?: () => void;
  onJumpAgentStep?: (step: number) => void;
  agentSpeed?: number;
  onChangeAgentSpeed?: (speed: number) => void;
  currentAgentStep?: AgentSimulationStep | null;
  isExplanationExpanded?: boolean;
  onToggleExplanationExpand?: () => void;
  isRealImport?: boolean;
  onCyReady?: (cy: Core) => void;
}

interface HoverTagInfo {
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  badge?: { text: string; color: string; bg: string };
  meta?: string[];
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
      // Stagger radius between alternating orbits for sibling nodes to prevent cluster crowding
      const radialOffset = count > 5 ? (sIdx % 2 === 0 ? 0 : 26) : 0;
      const radius = 50 + radialOffset;
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
  datasetKey,
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
  isAgentMode,
  onToggleAgentMode,
  agentActiveNodeId,
  agentPhase,
  agentPhaseLabel,
  agentActionPill: _agentActionPill,
  agentActiveEdgeIds = [],
  agentZoomTarget = 1.15,
  isInspectorOpen = false,
  agentStepIndex = 0,
  totalAgentSteps = 6,
  isAgentPlaying = false,
  onToggleAgentPlay,
  onPrevAgentStep,
  onNextAgentStep,
  onRestartAgent,
  onJumpAgentStep,
  agentSpeed = 1,
  onChangeAgentSpeed,
  currentAgentStep,
  isExplanationExpanded: propExplanationExpanded,
  onToggleExplanationExpand,
  isRealImport = false,
  onCyReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const prevDatasetKeyRef = useRef<string | undefined>(datasetKey);
  const prevSelectedTestIdRef = useRef<string | null>(selectedTestId);

  const [currentViewMode, setCurrentViewMode] = useState<GraphViewMode>(propViewMode || 'structure');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeStaticContext, setIncludeStaticContext] = useState(
    (propViewMode ? propViewMode === 'structure' : true) && !selectedTestId
  );
  const [zoomLevel, setZoomLevel] = useState<'far' | 'mid' | 'close'>('mid');
  const [hoverTag, setHoverTag] = useState<HoverTagInfo | null>(null);
  const [isCameraTrackingPaused, setIsCameraTrackingPaused] = useState(false);
  const [localExplanationExpanded, setLocalExplanationExpanded] = useState(false);

  const isExplanationExpanded =
    propExplanationExpanded !== undefined ? propExplanationExpanded : localExplanationExpanded;
  const toggleExplanationExpand =
    onToggleExplanationExpand || (() => setLocalExplanationExpanded((p) => !p));

  const resolvedAgentStep =
    currentAgentStep ||
    (isAgentMode && agentStepIndex !== undefined ? AGENT_SIMULATION_STEPS[agentStepIndex] : null);

  const agentCheckpoints = useMemo(
    () =>
      AGENT_SIMULATION_STEPS.map((s, idx) => ({
        index: idx,
        label: s.checkpointLabel || s.phaseLabel,
        phase: s.phase,
        phaseName: s.phaseLabel,
      })),
    []
  );

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

    // Compute execution step order if an active test is being traced (Structure mode / test selection context only)
    const edgeStepMap = new Map<string, number>();
    const nodeStepMap = new Map<string, number>();

    if (activeTest && currentViewMode !== 'changes') {
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

    // Map deterministic sibling order within each file cluster for minimal label stagger
    const nodeIndexInFile = new Map<string, number>();
    fileClusters.forEach((fc) => {
      const fNodes = graphData.nodes.filter((n) => n.file === fc.file);
      const sorted = [...fNodes].sort((a, b) => {
        if (a.changeStatus === 'modified') return -1;
        if (b.changeStatus === 'modified') return 1;
        return a.lineStart - b.lineStart;
      });
      sorted.forEach((n, idx) => {
        nodeIndexInFile.set(n.id, idx);
      });
    });

    // 1. Add File Clusters (clean filename label without cluttering persistent text)
    fileClusters.forEach((fc) => {
      const fileId = `file:${fc.file}`;
      const isCollapsed = collapsedFiles.has(fc.file);
      const pos = positions[fileId] || { x: 480, y: 360 };

      nodes.push({
        data: {
          id: fileId,
          label: fc.name,
          shortLabel: fc.name,
          file: fc.file,
          isFileCluster: true,
          isCollapsed,
          symbolCount: fc.symbolCount,
          changeStatus: fc.changeStatus,
          role: fc.role || '',
          tier: fc.tier || '',
          description: fc.description || '',
          lineCount: fc.lineCount,
          isGhost: fc.isGhost,
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

      const sIdx = nodeIndexInFile.get(n.id) ?? 0;
      const isOdd = sIdx % 2 === 1;
      const staggerClass = isOdd ? 'label-stagger-top' : 'label-stagger-bottom';

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
          rawName: n.name,
          isGhost: n.isGhost,
          signature: n.signature,
          docstringFirstLine: n.docstringFirstLine,
          contentHash: n.contentHash,
        },
        classes: `${staggerClass}${n.isGhost ? ' ghost-node' : ''}`,
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
          confidence: e.confidence,
          kind: e.kind,
          isGhost: e.isGhost,
          resolutionReason: e.resolutionReason,
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
  // selected > pinned > failing > changed > others
  const priorityNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (selectedNodeId) set.add(selectedNodeId);
    pinnedSymbolIds.forEach((id) => set.add(id));
    tests.forEach((t) => {
      if (t.status === 'fail' || t.status === 'error') set.add(t.id);
    });
    graphData.nodes.forEach((n) => {
      if (n.changeStatus === 'modified' || n.changeStatus === 'added') set.add(n.id);
    });
    return set;
  }, [selectedNodeId, pinnedSymbolIds, tests, graphData.nodes]);

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
          // --- File Cluster Nodes (Sleek celestial dots, crisp clean labels) ---
          {
            selector: 'node[?isFileCluster]',
            style: {
              shape: 'ellipse',
              width: 12,
              height: 12,
              'background-color': '#1e293b',
              'border-width': 1,
              'border-color': '#475569',
              label: 'data(label)',
              'font-family':
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              'font-size': '10px',
              'font-weight': 500,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 4,
              color: '#cbd5e1',
              'text-outline-color': '#101114',
              'text-outline-width': 1.2,
              'text-outline-opacity': 0.95,
              'z-index': 20,
            },
          },
          // Expanded file center anchor (minimalist subtle hub)
          {
            selector: 'node[?isFileCluster][!isCollapsed]',
            style: {
              width: 5,
              height: 5,
              'background-color': '#334155',
              'border-width': 0,
              color: '#64748b',
              'font-size': '9px',
            },
          },
          // Modified file
          {
            selector: 'node[?isFileCluster][changeStatus = "modified"]',
            style: {
              'background-color': '#d97706',
              'border-width': 1,
              'border-color': '#f59e0b',
              width: 12,
              height: 12,
            },
          },
          // Added file
          {
            selector: 'node[?isFileCluster][changeStatus = "added"]',
            style: {
              'background-color': '#0284c7',
              'border-width': 1,
              'border-color': '#38bdf8',
              width: 12,
              height: 12,
            },
          },
          // --- Child Symbol Nodes (Functions / Classes: sleek modern dots, no cartoon border) ---
          {
            selector: 'node[!isFileCluster]',
            style: {
              shape: 'ellipse',
              width: 4.5,
              height: 4.5,
              'background-color': '#64748b',
              'border-width': 0,
              label: '',
              'font-family':
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              'font-size': '9px',
              'font-weight': 400,
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 3,
              color: '#94a3b8',
              'text-outline-color': '#101114',
              'text-outline-width': 1.0,
              'text-outline-opacity': 0.95,
              'z-index': 15,
            },
          },
          // Minimal label stagger/offset for sibling function nodes in expanded clusters
          {
            selector: 'node[!isFileCluster].label-stagger-bottom',
            style: {
              'text-valign': 'bottom',
              'text-margin-y': 4,
            },
          },
          {
            selector: 'node[!isFileCluster].label-stagger-top',
            style: {
              'text-valign': 'top',
              'text-margin-y': -4,
            },
          },
          // Class nodes
          {
            selector: 'node[kind = "class"]',
            style: {
              shape: 'ellipse',
              width: 6.5,
              height: 6.5,
              'background-color': '#818cf8',
              'border-width': 0,
            },
          },
          // Modified Code Node: Clean warm amber circle
          {
            selector: 'node[!isFileCluster][changeStatus = "modified"]',
            style: {
              'background-color': '#f59e0b',
              'border-width': 0,
              width: 6.5,
              height: 6.5,
              'z-index': 25,
            },
          },
          // Added Code Node: Clean sky cyan circle
          {
            selector: 'node[!isFileCluster][changeStatus = "added"]',
            style: {
              'background-color': '#38bdf8',
              'border-width': 0,
              width: 6.5,
              height: 6.5,
              'z-index': 25,
            },
          },
          // Failing Test Node: Solid crimson circle
          {
            selector: 'node[!isFileCluster][status = "fail"]',
            style: {
              'background-color': '#ef4444',
              'border-width': 0,
              width: 7.5,
              height: 7.5,
              'z-index': 30,
            },
          },
          // Error Test Node: Solid orange circle
          {
            selector: 'node[!isFileCluster][status = "error"]',
            style: {
              'background-color': '#f97316',
              'border-width': 0,
              width: 7.0,
              height: 7.0,
              'z-index': 30,
            },
          },
          // Passing Test Node: Emerald circle
          {
            selector: 'node[!isFileCluster][status = "pass"]',
            style: {
              'background-color': '#10b981',
              'border-width': 0,
              width: 4.5,
              height: 4.5,
            },
          },
          // --- Containment rays from file center anchor to child symbols ---
          {
            selector: 'edge[category = "containment"]',
            style: {
              width: 0.75,
              'line-color': '#1e293b',
              'line-style': 'solid',
              opacity: 0.45,
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
              opacity: 0.65,
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
              opacity: 0.55,
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
          // Ambiguous static edges: warm amber dashed line with restrained glow
          {
            selector: 'edge[confidence = "ambiguous"]',
            style: {
              'line-color': '#d97706',
              'target-arrow-color': '#d97706',
              'line-style': 'dashed',
              'line-dash-pattern': [4, 3],
              opacity: 0.75,
              width: 1.1,
              'z-index': 12,
            },
          },
          // Unresolved static edges: faint dotted line
          {
            selector: 'edge[confidence = "unresolved"]',
            style: {
              'line-color': '#475569',
              'target-arrow-color': '#475569',
              'line-style': 'dotted',
              opacity: 0.35,
              width: 0.75,
              'z-index': 4,
            },
          },
          // Ghost edges: base-side removed relationships
          {
            selector: 'edge[?isGhost]',
            style: {
              'line-color': '#64748b',
              'target-arrow-color': '#64748b',
              'line-style': 'dashed',
              opacity: 0.25,
              width: 0.75,
            },
          },
          // Ghost nodes: distinct base-side removed elements that do not look current
          {
            selector: 'node[?isGhost]',
            style: {
              'border-width': 1.5,
              'border-style': 'dashed',
              'border-color': '#ef4444',
              opacity: 0.45,
              'background-color': '#1c1917',
            },
          },
          // --- Observed Edges for selected test: Cyan strand with Sequential Step Badges ---
          {
            selector: 'edge.observed-for-test',
            style: {
              'line-color': '#38bdf8',
              'target-arrow-color': '#38bdf8',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.75,
              width: 1.75,
              opacity: 1.0,
              'z-index': 40,
              label: 'data(stepLabel)',
              'font-size': '9px',
              'font-family':
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              'font-weight': 600,
              color: '#38bdf8',
              'text-outline-color': '#101114',
              'text-outline-width': 1.2,
              'text-outline-opacity': 0.95,
            },
          },
          // --- Dimming Classes ---
          {
            selector: 'node.dimmed',
            style: {
              opacity: 0.15,
              'text-opacity': 0,
            },
          },
          {
            selector: 'node.exercised',
            style: {
              opacity: 1.0,
              'border-width': 1.5,
              'border-color': '#38bdf8',
              label: 'data(shortLabel)',
              'text-opacity': 1,
              'font-size': '10px',
              'font-weight': 600,
              color: '#38bdf8',
              'text-outline-color': '#101114',
              'text-outline-width': 1.2,
              'text-outline-opacity': 0.95,
              'z-index': 100,
            },
          },
          {
            selector: 'node.active-test-node',
            style: {
              opacity: 1.0,
              'border-width': 2.0,
              'border-color': '#ef4444',
              label: 'data(shortLabel)',
              'text-opacity': 1,
              'font-size': '11px',
              'font-weight': 700,
              color: '#f87171',
              'text-outline-color': '#101114',
              'text-outline-width': 1.5,
              'text-outline-opacity': 0.95,
              'z-index': 110,
            },
          },
          {
            selector: 'edge.dimmed',
            style: {
              opacity: 0.08,
            },
          },
          // Selected node focus (luminous crisp outline ring)
          {
            selector: 'node.selected-node',
            style: {
              'border-color': '#ffffff',
              'border-width': 2,
              'border-opacity': 1,
              'z-index': 999,
            },
          },
          // Persistent connected edge highlight when node is selected
          {
            selector: 'edge.persistent-connected-edge',
            style: {
              'line-color': '#38bdf8',
              'target-arrow-color': '#38bdf8',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.8,
              width: 2.0,
              opacity: 1.0,
              'z-index': 90,
            },
          },
          // Persistent connected neighbor node highlight when node is selected
          {
            selector: 'node.persistent-neighbor',
            style: {
              'border-color': '#38bdf8',
              'border-width': 1.5,
              opacity: 1.0,
              'z-index': 80,
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
          // Show label class
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
              'target-arrow-color': '#60a5fa',
              width: 2.0,
              opacity: 1.0,
              'z-index': 100,
            },
          },
          // --- Autonomous Agent Investigation Classes: Refined Obsidian Aesthetics ---
          // --- Autonomous Agent Investigation Classes: Refined Obsidian Aesthetics ---
          // Greyed out unimpacted child nodes in agent mode: quiet architectural dots (no labels, clean slate)
          {
            selector: 'node[!isFileCluster].agent-unimpacted',
            style: {
              'background-color': '#334155',
              'border-width': 0,
              opacity: 0.28,
              label: '',
              'z-index': 5,
            },
          },
          // Greyed out unimpacted file cluster anchors: subtle celestial hubs preserving repository structure
          {
            selector: 'node[?isFileCluster].agent-unimpacted',
            style: {
              'background-color': '#1e293b',
              'border-width': 1,
              'border-color': '#334155',
              opacity: 0.40,
              label: 'data(shortLabel)',
              color: '#64748b',
              'font-size': '8.5px',
              'z-index': 10,
            },
          },
          // Decisively grey out all non-containment unimpacted edges in agent mode
          {
            selector: 'edge.agent-unimpacted',
            style: {
              'line-color': '#1a2230',
              opacity: 0.05,
              'target-arrow-shape': 'none',
              width: 0.5,
              label: '',
              'z-index': 1,
            },
          },
          // Faint containment edges for unimpacted clusters so the architectural structure remains clear
          {
            selector: 'edge[category = "containment"].agent-unimpacted',
            style: {
              'line-color': '#1e293b',
              opacity: 0.20,
              width: 0.5,
              'z-index': 2,
            },
          },
          // Impacted nodes: high contrast, restrained colors, exact preserved shape and size
          {
            selector: 'node.agent-impacted',
            style: {
              opacity: 1.0,
              'transition-property': 'background-color, border-color, border-width',
              'transition-duration': 0.35,
              'transition-timing-function': 'ease-in-out',
              'z-index': 100,
            },
          },
          // Failing test node (Red) - starting failure role
          {
            selector: 'node.agent-impacted[id = "tests/test_auth.py::test_login_expired_token"]',
            style: {
              'background-color': '#ef4444',
              'border-width': 1.2,
              'border-color': '#fca5a5',
              label: 'data(shortLabel)',
              color: '#fca5a5',
              'font-weight': 600,
              'font-size': '9.5px',
              'z-index': 120,
            },
          },
          // Intermediate call coordinator node (Cyan) - service examination role
          {
            selector: 'node.agent-impacted[id = "auth/service.py::login_with_token"]',
            style: {
              'background-color': '#0284c7',
              'border-width': 1.2,
              'border-color': '#38bdf8',
              label: 'data(shortLabel)',
              color: '#7dd3fc',
              'font-weight': 500,
              'font-size': '9.5px',
              'z-index': 110,
            },
          },
          // Candidate defect / patch site node (Amber) - proposed modification role
          {
            selector: 'node.agent-impacted[id = "auth/tokens.py::validate_token"]',
            style: {
              'background-color': '#d97706',
              'border-width': 1.2,
              'border-color': '#f59e0b',
              label: 'data(shortLabel)',
              color: '#fde68a',
              'font-weight': 600,
              'font-size': '9.5px',
              'z-index': 120,
            },
          },
          // Impacted file cluster nodes
          {
            selector: 'node[?isFileCluster].agent-impacted',
            style: {
              opacity: 0.85,
              'border-color': '#64748b',
              'border-width': 1,
              label: 'data(label)',
              color: '#cbd5e1',
              'z-index': 80,
            },
          },
          // Single Brief Color Flash Classes (rapid brightening on arrival, then settles)
          {
            selector: 'node.node-flash-red',
            style: {
              'background-color': '#f87171',
              'border-color': '#ffffff',
              'border-width': 1.8,
            },
          },
          {
            selector: 'node.node-flash-cyan',
            style: {
              'background-color': '#38bdf8',
              'border-color': '#ffffff',
              'border-width': 1.8,
            },
          },
          {
            selector: 'node.node-flash-amber',
            style: {
              'background-color': '#fbbf24',
              'border-color': '#ffffff',
              'border-width': 1.8,
            },
          },
          {
            selector: 'node.node-flash-purple',
            style: {
              'background-color': '#c084fc',
              'border-color': '#ffffff',
              'border-width': 1.8,
            },
          },
          {
            selector: 'node.node-flash-green',
            style: {
              'background-color': '#34d399',
              'border-color': '#ffffff',
              'border-width': 1.8,
            },
          },
          // Containment strands for impacted files
          {
            selector: 'edge[category = "containment"].agent-impacted',
            style: {
              opacity: 0.35,
              'line-color': '#334155',
              'z-index': 10,
            },
          },
          // Traveling edge illumination (wave of color traveling toward next node)
          {
            selector: 'edge.edge-illuminating',
            style: {
              'line-color': '#38bdf8',
              'target-arrow-color': '#38bdf8',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.85,
              width: 2.4,
              opacity: 1.0,
              'z-index': 95,
            },
          },
          {
            selector: 'edge.edge-illuminating-amber',
            style: {
              'line-color': '#f59e0b',
              'target-arrow-color': '#f59e0b',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.85,
              width: 2.4,
              opacity: 1.0,
              'z-index': 95,
            },
          },
          // Traversed historical connection strands (accumulating trail)
          {
            selector: 'edge.edge-traversed-cyan',
            style: {
              'line-color': '#0284c7',
              'target-arrow-color': '#0284c7',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.75,
              width: 1.8,
              opacity: 0.85,
              'z-index': 90,
            },
          },
          {
            selector: 'edge.edge-traversed-amber',
            style: {
              'line-color': '#d97706',
              'target-arrow-color': '#d97706',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 0.75,
              width: 1.8,
              opacity: 0.85,
              'z-index': 90,
            },
          },
        ],
        layout: {
          name: 'preset',
          fit: true,
          padding: 50,
        },
      });

      // Zoom listener for semantic zoom level tracking
      cy.on('zoom', () => {
        const z = cy.zoom();
        if (z < 0.8) setZoomLevel('far');
        else if (z < 1.3) setZoomLevel('mid');
        else setZoomLevel('close');
        setHoverTag(null);
      });

      cy.on('pan', () => {
        setHoverTag(null);
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

      // Interactive Hover Floating Tag on Node
      cy.on('mouseover', 'node', (evt: EventObject) => {
        const target = evt.target;
        target.addClass('hovered');
        target.neighborhood('edge').addClass('hovered');
        target.neighborhood('node').addClass('neighbor-highlighted');

        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const originalEvt = evt.originalEvent as MouseEvent;
        const x = originalEvt ? originalEvt.clientX - rect.left : target.renderedPosition().x;
        const y = originalEvt ? originalEvt.clientY - rect.top : target.renderedPosition().y;

        if (target.data('isFileCluster')) {
          const isCollapsed = target.data('isCollapsed');
          const changeStatus = target.data('changeStatus');
          setHoverTag({
            x,
            y,
            title: target.data('file'),
            subtitle: target.data('role') || 'File Cluster',
            badge:
              changeStatus !== 'unchanged'
                ? {
                    text: changeStatus,
                    color: changeStatus === 'modified' ? '#f59e0b' : '#38bdf8',
                    bg: changeStatus === 'modified' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                  }
                : target.data('tier')
                ? { text: target.data('tier'), color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.15)' }
                : undefined,
            meta: [
              `${target.data('symbolCount')} symbols • ${target.data('lineCount') || 100} lines`,
              isCollapsed ? 'Collapsed dot (double-click to unfold)' : 'Unfolded constellation',
            ],
          });
        } else {
          const kind = target.data('kind');
          const isTest = target.data('isTest');
          const status = target.data('status');
          const changeStatus = target.data('changeStatus');
          const stepNumber = target.data('stepNumber');

          let badge;
          if (isTest && status !== 'neutral') {
            badge = {
              text: status.toUpperCase(),
              color: status === 'fail' ? '#ef4444' : status === 'pass' ? '#10b981' : '#f97316',
              bg:
                status === 'fail'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : status === 'pass'
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(249, 115, 22, 0.15)',
            };
          } else if (changeStatus !== 'unchanged') {
            badge = {
              text: changeStatus.toUpperCase(),
              color: changeStatus === 'modified' ? '#f59e0b' : '#38bdf8',
              bg: changeStatus === 'modified' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)',
            };
          }

          const meta: string[] = [];
          if (stepNumber !== undefined) {
            meta.push(`Execution Order: Step [${stepNumber}]`);
          }
          if (target.data('description')) {
            meta.push(target.data('description'));
          }

          setHoverTag({
            x,
            y,
            title: target.data('rawName') || target.data('label'),
            subtitle: `${kind} in ${target.data('file')} (L${target.data('lineStart')}-${target.data('lineEnd')})`,
            badge,
            meta,
          });
        }
      });

      cy.on('mouseout', 'node', (evt: EventObject) => {
        evt.target.removeClass('hovered');
        cy.elements().removeClass('hovered').removeClass('neighbor-highlighted');
        setHoverTag(null);
      });

      // Interactive Hover Floating Tag on Edge
      cy.on('mouseover', 'edge', (evt: EventObject) => {
        const edge = evt.target;
        edge.addClass('hovered');

        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const originalEvt = evt.originalEvent as MouseEvent;
        const x = originalEvt ? originalEvt.clientX - rect.left : rect.width / 2;
        const y = originalEvt ? originalEvt.clientY - rect.top : rect.height / 2;

        const src = edge.source().data('rawName') || edge.source().data('label') || edge.source().id();
        const tgt = edge.target().data('rawName') || edge.target().data('label') || edge.target().id();
        const category = edge.data('category');
        const stepNumber = edge.data('stepNumber');
        const testIds = edge.data('testIds') as string[] | undefined;

        let categoryLabel = 'Static AST Call';
        let badgeText = 'Static Call';
        let badgeColor = '#94a3b8';
        let badgeBg = 'rgba(148, 163, 184, 0.15)';

        if (category === 'runtime_observed') {
          categoryLabel = 'Runtime Observed Call';
          badgeText = 'Runtime Call';
          badgeColor = '#38bdf8';
          badgeBg = 'rgba(56, 189, 248, 0.15)';
        } else if (category === 'containment') {
          categoryLabel = 'Cluster Membership';
          badgeText = 'Cluster Ray';
          badgeColor = '#64748b';
          badgeBg = 'rgba(100, 116, 139, 0.15)';
        } else if (category === 'aggregated_structural') {
          categoryLabel = 'Cross-File Dependency';
          badgeText = 'Cross-File';
          badgeColor = '#818cf8';
          badgeBg = 'rgba(129, 140, 248, 0.15)';
        }

        const meta: string[] = [];
        if (stepNumber !== undefined) {
          meta.push(`Execution Order: Step [${stepNumber}]`);
        }
        if (testIds && testIds.length > 0) {
          meta.push(`Observed in: ${testIds.join(', ')}`);
        }
        if (edge.data('provenance')) {
          meta.push(edge.data('provenance'));
        }

        setHoverTag({
          x,
          y,
          title: `${src} → ${tgt}`,
          subtitle: categoryLabel,
          badge: {
            text: badgeText,
            color: badgeColor,
            bg: badgeBg,
          },
          meta,
        });
      });

      // Track cursor movement on hovered nodes and edges for smooth positioning
      cy.on('mousemove', 'node, edge', (evt: EventObject) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const originalEvt = evt.originalEvent as MouseEvent;
        if (originalEvt) {
          const x = originalEvt.clientX - rect.left;
          const y = originalEvt.clientY - rect.top;
          setHoverTag((prev) => (prev ? { ...prev, x, y } : null));
        }
      });

      cy.on('mouseout', 'edge', (evt: EventObject) => {
        evt.target.removeClass('hovered');
        setHoverTag(null);
      });

      cyRef.current = cy;
      onCyReady?.(cy);
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

    // Retain exact camera viewport on same-dataset mutations (collapse/expand, mode toggling),
    // but fit the full graph with padding on dataset/run identity change.
    if (datasetKey !== undefined && datasetKey !== prevDatasetKeyRef.current) {
      prevDatasetKeyRef.current = datasetKey;
      cy.fit(cy.elements(), 50);
    } else {
      cy.viewport({ zoom: currentZoom, pan: currentPan });
    }
  }, [elements, onSelectNode, onSelectFile, onToggleCollapseFile, datasetKey]);

  // Clean up Cytoscape on unmount
  useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, []);

  // Update dynamic classes, selection focus, and persistent connection highlights
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      // 1. Clear previous selection & connection focus classes
      cy.nodes().removeClass('selected-node').removeClass('persistent-neighbor').removeClass('active-test-node');
      cy.edges().removeClass('persistent-connected-edge');

      // 2. Persistent Connection Highlight on Node/File Selection
      if (selectedNodeId) {
        const target = cy.getElementById(selectedNodeId);
        if (target.length > 0) {
          target.addClass('selected-node').addClass('show-label');
          const connectedEdges = target.connectedEdges();
          connectedEdges.addClass('persistent-connected-edge');
          const neighborNodes = target.neighborhood('node');
          neighborNodes.addClass('persistent-neighbor').addClass('show-label');

          // Dim everything else to give an intuitive persistent focused ego-graph
          cy.nodes().forEach((n) => {
            if (n.id() !== selectedNodeId && !neighborNodes.contains(n)) {
              n.addClass('dimmed');
            } else {
              n.removeClass('dimmed');
            }
          });

          cy.edges().forEach((e) => {
            if (!connectedEdges.contains(e)) {
              e.addClass('dimmed');
            } else {
              e.removeClass('dimmed');
            }
          });
        }
      } else if (selectedFile) {
        const fileNode = cy.getElementById(`file:${selectedFile}`);
        if (fileNode.length > 0) {
          fileNode.addClass('selected-node').addClass('show-label');
          const connectedEdges = fileNode.connectedEdges();
          connectedEdges.addClass('persistent-connected-edge');
          const neighborNodes = fileNode.neighborhood('node');
          neighborNodes.addClass('persistent-neighbor').addClass('show-label');

          cy.nodes().forEach((n) => {
            if (n.id() !== `file:${selectedFile}` && !neighborNodes.contains(n)) {
              n.addClass('dimmed');
            } else {
              n.removeClass('dimmed');
            }
          });

          cy.edges().forEach((e) => {
            if (!connectedEdges.contains(e)) {
              e.addClass('dimmed');
            } else {
              e.removeClass('dimmed');
            }
          });
        }
      } else if (currentViewMode === 'changes') {
        // Changes Mode: clear test execution trace, highlight modified and added symbols, dim unchanged
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
        // Clear blue test execution path from changes overlay
        cy.edges().removeClass('observed-for-test');
        cy.edges().forEach((e) => {
          const src = cy.getElementById(e.data('source'));
          const tgt = cy.getElementById(e.data('target'));
          const isRelatedToChange =
            src.data('changeStatus') === 'modified' ||
            src.data('changeStatus') === 'added' ||
            tgt.data('changeStatus') === 'modified' ||
            tgt.data('changeStatus') === 'added';
          if (isRelatedToChange) {
            e.removeClass('dimmed');
          } else {
            e.addClass('dimmed');
          }
        });
      } else if (activeTest) {
        // Highlighting active test coverage & runtime calls when no individual node is selected
        const exercisedSet = new Set(activeTest.exercisedNodeIds);
        exercisedSet.add(activeTest.id);

        const exercisedFiles = new Set<string>();
        exercisedSet.forEach((id) => {
          const file = graphData.nodes.find((n) => n.id === id)?.file;
          if (file) exercisedFiles.add(file);
        });

        cy.nodes().forEach((n) => {
          if (n.data('isFileCluster')) {
            const file = n.data('file');
            if (exercisedFiles.has(file)) {
              n.removeClass('dimmed');
            } else {
              n.addClass('dimmed');
            }
            return;
          }
          if (n.id() === activeTest.id) {
            n.addClass('active-test-node').removeClass('dimmed');
          } else if (exercisedSet.has(n.id())) {
            n.addClass('exercised');
            n.removeClass('dimmed');
          } else {
            n.removeClass('exercised').removeClass('active-test-node');
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
      // 4. Autonomous Agent Investigation: Accumulating Trail, Role Highlighting & Impact Overview
      cy.nodes()
        .removeClass('agent-impacted')
        .removeClass('agent-unimpacted');
      cy.edges()
        .removeClass('agent-impacted')
        .removeClass('agent-unimpacted')
        .removeClass('edge-illuminating')
        .removeClass('edge-illuminating-amber')
        .removeClass('edge-traversed-cyan')
        .removeClass('edge-traversed-amber');

      if (isAgentMode) {
        // Accumulating trail nodes based on current step index (true time-travel replay)
        const visitedNodeIds = new Set<string>();
        visitedNodeIds.add('tests/test_auth.py::test_login_expired_token');
        visitedNodeIds.add('file:tests/test_auth.py');

        if (agentStepIndex >= 1) {
          visitedNodeIds.add('auth/service.py::login_with_token');
          visitedNodeIds.add('file:auth/service.py');
        }
        if (agentStepIndex >= 2) {
          visitedNodeIds.add('auth/tokens.py::validate_token');
          visitedNodeIds.add('file:auth/tokens.py');
        }

        // Accumulating trail edges based on current step index
        const visitedEdgeIds = new Set<string>();
        visitedEdgeIds.add('containment:file:tests/test_auth.py->tests/test_auth.py::test_login_expired_token');
        if (agentStepIndex >= 1) {
          visitedEdgeIds.add('e_test_fail_to_login');
          visitedEdgeIds.add('containment:file:auth/service.py->auth/service.py::login_with_token');
        }
        if (agentStepIndex >= 2) {
          visitedEdgeIds.add('e_login_to_validate');
          visitedEdgeIds.add('containment:file:auth/tokens.py->auth/tokens.py::validate_token');
        }

        // Decisively grey out all non-visited nodes; spotlight visited/impacted nodes
        cy.nodes().forEach((n) => {
          if (visitedNodeIds.has(n.id())) {
            n.addClass('agent-impacted');
            n.removeClass('agent-unimpacted');
            n.addClass('show-label');
          } else {
            n.addClass('agent-unimpacted');
            n.removeClass('agent-impacted');
            n.removeClass('show-label');
          }
        });

        // Decisively grey out all non-visited edges; style traversed edges with accumulating trail
        cy.edges().forEach((e) => {
          if (visitedEdgeIds.has(e.id())) {
            e.addClass('agent-impacted');
            e.removeClass('agent-unimpacted');
            if (e.id() === 'e_test_fail_to_login') {
              e.addClass('edge-traversed-cyan');
            } else if (e.id() === 'e_login_to_validate') {
              e.addClass('edge-traversed-amber');
            }
          } else {
            e.addClass('agent-unimpacted');
            e.removeClass('agent-impacted');
            e.removeClass('edge-traversed-cyan');
            e.removeClass('edge-traversed-amber');
          }
        });
      }
    });
  }, [
    selectedNodeId,
    selectedFile,
    activeTest,
    zoomLevel,
    priorityNodeIds,
    currentViewMode,
    isAgentMode,
    agentActiveNodeId,
    agentPhase,
    agentActiveEdgeIds,
    agentStepIndex,
  ]);

  // Reset camera tracking pause when agent active mode restarts or changes
  useEffect(() => {
    if (!isAgentMode) {
      setIsCameraTrackingPaused(false);
    }
  }, [isAgentMode]);

  // Smooth Camera Gliding with Perfect Geometric Center & Zoom Out on Resolution
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !isAgentMode || !agentActiveNodeId || isCameraTrackingPaused) return;

    let targetNode = cy.getElementById(agentActiveNodeId);
    if (!targetNode || targetNode.length === 0) {
      const file = graphData.nodes.find((n) => n.id === agentActiveNodeId)?.file;
      if (file) {
        targetNode = cy.getElementById(`file:${file}`);
      }
    }
    if (!targetNode || targetNode.length === 0) return;

    const modelPos = targetNode.position();
    const targetZoom = agentZoomTarget || 1.15;

    // Viewport visible dimensions: containerW is already the visible canvas between sidebar and drawer
    const containerW = containerRef.current?.clientWidth || 800;
    const containerH = containerRef.current?.clientHeight || 600;
    const visibleCenterX = containerW / 2;
    const bottomInset = isAgentMode ? 55 : 0;
    const visibleCenterY = (containerH - bottomInset) / 2;

    const targetPanX = visibleCenterX - modelPos.x * targetZoom;
    const targetPanY = visibleCenterY - modelPos.y * targetZoom;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    cy.stop();
    cy.animate(
      {
        pan: { x: targetPanX, y: targetPanY },
        zoom: targetZoom,
      },
      {
        duration: prefersReducedMotion ? 0 : 500,
        easing: 'ease-in-out-cubic',
      }
    );
  }, [agentActiveNodeId, isAgentMode, agentZoomTarget, isCameraTrackingPaused, isInspectorOpen, graphData.nodes]);

  // Selection camera: gently center/zoom on failing test node and exercised symbols in context,
  // keeping rest of project map present (dimmed), not removed.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || isAgentMode) {
      prevSelectedTestIdRef.current = selectedTestId;
      return;
    }

    if (selectedTestId) {
      const active = tests.find((t) => t.id === selectedTestId);
      const targetEles = cy.collection();
      const testNode = cy.getElementById(selectedTestId);
      if (testNode.length > 0) targetEles.merge(testNode);

      if (active?.exercisedNodeIds) {
        active.exercisedNodeIds.forEach((id) => {
          const node = cy.getElementById(id);
          if (node.length > 0) {
            targetEles.merge(node);
          } else {
            const file = graphData.nodes.find((n) => n.id === id)?.file;
            if (file) {
              const fileCluster = cy.getElementById(`file:${file}`);
              if (fileCluster.length > 0) targetEles.merge(fileCluster);
            }
          }
        });
      }

      if (targetEles.length > 0) {
        const bb = targetEles.boundingBox();
        const containerW = containerRef.current?.clientWidth || 800;
        const containerH = containerRef.current?.clientHeight || 600;
        const padding = 120; // generous padding keeps surrounding dimmed project map visible
        const w = Math.max(bb.w, 120);
        const h = Math.max(bb.h, 120);
        const fitZoom = Math.min((containerW - padding * 2) / w, (containerH - padding * 2) / h);
        const targetZoom = Math.max(0.95, Math.min(1.4, fitZoom));

        const centerX = bb.x1 + bb.w / 2;
        const centerY = bb.y1 + bb.h / 2;
        const visibleCenterX = containerW / 2;
        const visibleCenterY = containerH / 2;
        const targetPanX = visibleCenterX - centerX * targetZoom;
        const targetPanY = visibleCenterY - centerY * targetZoom;

        const prefersReducedMotion =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

        cy.stop();
        cy.animate(
          {
            pan: { x: targetPanX, y: targetPanY },
            zoom: targetZoom,
          },
          {
            duration: prefersReducedMotion ? 0 : 350,
            easing: 'ease-in-out-cubic',
          }
        );
      }
    } else if (prevSelectedTestIdRef.current && !selectedTestId) {
      // Gentle fit when clearing test selection
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

      cy.stop();
      cy.animate(
        {
          fit: { eles: cy.elements(), padding: 50 },
        },
        {
          duration: prefersReducedMotion ? 0 : 300,
          easing: 'ease-in-out-cubic',
        }
      );
    }

    prevSelectedTestIdRef.current = selectedTestId;
  }, [selectedTestId, tests, isAgentMode, graphData.nodes]);

  // Detect manual user pan/zoom during agent mode to pause camera tracking
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const onUserInteraction = (evt: EventObject) => {
      if (isAgentMode && !isCameraTrackingPaused && evt.originalEvent) {
        setIsCameraTrackingPaused(true);
      }
    };

    cy.on('dragpan zoom', onUserInteraction);
    return () => {
      cy.removeListener('dragpan zoom', onUserInteraction);
    };
  }, [isAgentMode, isCameraTrackingPaused]);

  // Single Brief Color Flash on Arrival & Traveling Edge Wave
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !isAgentMode || !agentActiveNodeId) return;

    let targetNode = cy.getElementById(agentActiveNodeId);
    if (!targetNode || targetNode.length === 0) {
      const file = graphData.nodes.find((n) => n.id === agentActiveNodeId)?.file;
      if (file) {
        targetNode = cy.getElementById(`file:${file}`);
      }
    }
    if (!targetNode || targetNode.length === 0) return;

    // Determine flash color based on current action phase:
    // Red: failing test identified (diagnosing)
    // Cyan: examining relationship/function (tracing)
    // Amber: suspicious modification or candidate patch inspected (inspecting, patching)
    // Purple: verification trial executed (verifying)
    // Green: successful recorded verification outcome (resolved)
    let flashColorClass = 'node-flash-cyan';
    if (agentPhase === 'diagnosing') flashColorClass = 'node-flash-red';
    else if (agentPhase === 'inspecting' || agentPhase === 'patching') flashColorClass = 'node-flash-amber';
    else if (agentPhase === 'verifying') flashColorClass = 'node-flash-purple';
    else if (agentPhase === 'resolved') flashColorClass = 'node-flash-green';

    // Active traveling edge for this transition
    const travelingEdgeId =
      agentStepIndex === 1
        ? 'e_test_fail_to_login'
        : agentStepIndex === 2
        ? 'e_login_to_validate'
        : null;

    let travelingEdge: cytoscape.EdgeCollection | null = null;
    if (travelingEdgeId) {
      const edge = cy.getElementById(travelingEdgeId);
      if (edge.length > 0) {
        travelingEdge = edge;
        const edgeColorClass = agentStepIndex === 2 ? 'edge-illuminating-amber' : 'edge-illuminating';
        edge.addClass(edgeColorClass);
      }
    }

    // Trigger single color flash on destination arrival
    const flashDelay = travelingEdge ? 300 : 50;
    const flashTimer = setTimeout(() => {
      targetNode.addClass(flashColorClass);

      // Settle edge into traversed history
      if (travelingEdge) {
        const edgeColorClass = agentStepIndex === 2 ? 'edge-illuminating-amber' : 'edge-illuminating';
        const traversedClass = agentStepIndex === 2 ? 'edge-traversed-amber' : 'edge-traversed-cyan';
        travelingEdge.removeClass(edgeColorClass).addClass(traversedClass);
      }

      // Settle node fill into softer persistent color after brief hold (350ms)
      const settleTimer = setTimeout(() => {
        targetNode.removeClass(flashColorClass);
      }, 350);

      return () => clearTimeout(settleTimer);
    }, flashDelay);

    return () => {
      clearTimeout(flashTimer);
      targetNode
        .removeClass('node-flash-red')
        .removeClass('node-flash-cyan')
        .removeClass('node-flash-amber')
        .removeClass('node-flash-purple')
        .removeClass('node-flash-green');
      if (travelingEdge) {
        travelingEdge.removeClass('edge-illuminating').removeClass('edge-illuminating-amber');
      }
    };
  }, [isAgentMode, agentActiveNodeId, agentPhase, agentStepIndex, graphData.nodes]);

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
        <div
          style={{
            padding: '16px 24px',
            backgroundColor: '#111722',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            color: '#94a3b8',
            fontSize: '13px',
            textAlign: 'center',
            maxWidth: '440px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          {isRealImport
            ? 'Structure file contains no symbols. The project may be empty or filtered out.'
            : 'No graph nodes or source files are recorded for this run.'}
        </div>
      </div>
    );
  }

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
          gap: '10px',
          flexWrap: 'nowrap',
          zIndex: 10,
          minHeight: '38px',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        {/* Left: Core Navigation & Action Controls (Always flexShrink: 0 so buttons NEVER get cut off) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Layer Selector: Structure vs Changes */}
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
                whiteSpace: 'nowrap',
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
                whiteSpace: 'nowrap',
              }}
              role="radio"
              aria-label="Changes"
              aria-checked={currentViewMode === 'changes'}
              title="Highlight modified and added files/functions in this commit"
            >
              Changes
            </button>
          </div>

          {/* Quick Unfold All / Fold All Segmented Control */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              backgroundColor: '#161e2e',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-default)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <button
              onClick={onExpandAllFiles}
              className={collapsedFiles.size === 0 ? 'btn-ghost' : 'btn-secondary'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                cursor: 'pointer',
                border: 'none',
                borderRight: '1px solid var(--border-default)',
                color: collapsedFiles.size > 0 ? '#38bdf8' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
              title="Unfold all files to reveal smaller function and class nodes"
              aria-label="Unfold All Files"
            >
              <ChevronsDown size={11} />
              <span>Unfold All</span>
            </button>
            <button
              onClick={onCollapseAllFiles}
              className={collapsedFiles.size === fileClusters.length ? 'btn-ghost' : 'btn-secondary'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                cursor: 'pointer',
                border: 'none',
                color:
                  collapsedFiles.size === fileClusters.length
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
              title="Fold all files into overview dots"
              aria-label="Fold All Files"
            >
              <ChevronsUp size={11} />
              <span>Fold to Files</span>
            </button>
          </div>

          {/* Autonomous Agent Simulation Toggle or Gated Notice */}
          {isRealImport ? (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px dashed #334155',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'not-allowed',
                whiteSpace: 'nowrap',
              }}
              title="Autonomous agent repair is a sample demo feature and is not available on real imports"
              aria-label="Agent Auto-Repair disabled on real imports"
            >
              <Bot size={12} style={{ color: 'var(--text-muted)' }} />
              <span>Agent Auto-Repair (Demo only)</span>
            </span>
          ) : (
            onToggleAgentMode && (
              <button
                onClick={onToggleAgentMode}
                className={isAgentMode ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  backgroundColor: isAgentMode ? 'rgba(56, 189, 248, 0.2)' : undefined,
                  color: isAgentMode ? '#38bdf8' : undefined,
                  border: isAgentMode ? '1px solid rgba(56, 189, 248, 0.4)' : undefined,
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
                title="Simulate autonomous agent actively repairing code defects"
                aria-label="Agent Auto-Repair"
              >
                <Bot size={12} style={{ color: isAgentMode ? '#38bdf8' : 'var(--text-secondary)' }} />
                <span>{isAgentMode ? 'Agent Active' : 'Agent Auto-Repair'}</span>
              </button>
            )
          )}
        </div>

        {/* Center: Active Scope / Context (minWidth: 0, flexShrink: 1, truncates with ellipsis) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
          {activeTest ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flexShrink: 1 }}>
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
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  whiteSpace: 'nowrap',
                  maxWidth: '220px',
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
                style={{ fontSize: '10px', padding: '1px 5px', color: 'var(--text-muted)', flexShrink: 0 }}
                title="Clear test tracing and return to whole project overview"
              >
                ✕ Clear
              </button>
            </div>
          ) : (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
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
              fontSize: '10px',
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
                fontSize: '9px',
                padding: '1px 5px',
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

        {/* Right: Static Context Toggle, Search, Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
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

      {/* Canvas Area Container - Relative Anchor for Cytoscape and its Overlays */}
      <div
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Cytoscape Canvas */}
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#101114',
          }}
        />

        {/* Floating Glassmorphic Tag Card on Hover */}
        {hoverTag && (
          <div
            style={{
              position: 'absolute',
              left: `${
                hoverTag.x + 310 > (containerRef.current?.clientWidth || 800)
                  ? Math.max(10, hoverTag.x - 300)
                  : hoverTag.x + 14
              }px`,
              top: `${
                hoverTag.y + 140 > (containerRef.current?.clientHeight || 600)
                  ? Math.max(10, hoverTag.y - 120)
                  : hoverTag.y + 14
              }px`,
              pointerEvents: 'none',
              zIndex: 1000,
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 10px 28px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              padding: '8px 12px',
              maxWidth: '320px',
              backdropFilter: 'blur(10px)',
              color: '#f8fafc',
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              fontSize: '11px',
              lineHeight: 1.4,
              animation: 'fadeIn 0.1s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              {hoverTag.badge && (
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: hoverTag.badge.color,
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontWeight: 600,
                  color: '#ffffff',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  wordBreak: 'break-word',
                }}
              >
                {hoverTag.title}
              </span>
              {hoverTag.badge && (
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: hoverTag.badge.color,
                    backgroundColor: hoverTag.badge.bg,
                    border: `1px solid ${hoverTag.badge.color}40`,
                    padding: '1px 5px',
                    borderRadius: '3px',
                    marginLeft: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {hoverTag.badge.text}
                </span>
              )}
            </div>
            {hoverTag.subtitle && (
              <div style={{ fontSize: '11px', color: '#93c5fd', marginBottom: '4px' }}>
                {hoverTag.subtitle}
              </div>
            )}
            {hoverTag.meta && hoverTag.meta.length > 0 && (
              <div
                style={{
                  fontSize: '10px',
                  color: '#94a3b8',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '4px',
                  marginTop: '2px',
                }}
              >
                {hoverTag.meta.map((m, i) => (
                  <div key={i}>{m}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Expandable Step Explanation Popup (Docked above Replay Bar) */}
        {isAgentMode && resolvedAgentStep && (
          <StepExplanationPopup
            currentStepIndex={agentStepIndex}
            totalSteps={totalAgentSteps}
            currentPhase={agentPhase || 'idle'}
            phaseLabel={agentPhaseLabel || ''}
            checkpointLabel={resolvedAgentStep.checkpointLabel || agentPhaseLabel || ''}
            targetNodeId={resolvedAgentStep.targetNodeId}
            explanation={resolvedAgentStep.explanation}
            isExpanded={isExplanationExpanded}
            onToggleExpand={toggleExplanationExpand}
            isInspectorOpen={isInspectorOpen}
            onSelectNode={(nodeId) => onSelectNode?.(nodeId)}
          />
        )}

        {/* Minimalist Investigation Replay Bar (Docked at Bottom of Canvas) */}
        {isAgentMode && onToggleAgentMode && (
          <InvestigationReplayBar
            currentStepIndex={agentStepIndex}
            totalSteps={totalAgentSteps}
            currentPhase={agentPhase || 'idle'}
            checkpoints={agentCheckpoints}
            isPlaying={isAgentPlaying}
            onTogglePlay={onToggleAgentPlay || (() => {})}
            onPrevStep={onPrevAgentStep || (() => {})}
            onNextStep={onNextAgentStep || (() => {})}
            onRestart={onRestartAgent || (() => {})}
            onJumpToStep={onJumpAgentStep || (() => {})}
            speed={agentSpeed}
            onChangeSpeed={onChangeAgentSpeed || (() => {})}
            isCameraTrackingPaused={isCameraTrackingPaused}
            onResumeTracking={() => setIsCameraTrackingPaused(false)}
            onClose={onToggleAgentMode}
            isInspectorOpen={isInspectorOpen}
          />
        )}
      </div>
    </div>
  );
};
