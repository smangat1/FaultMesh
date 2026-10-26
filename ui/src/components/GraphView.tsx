import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import type { GraphData, TestItem } from '../types';
import { DiffViewer } from './DiffViewer';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Code2,
  X,
  Info,
  Eye,
  GitCommit,
  Sparkles,
  Sliders,
  Play,
  RotateCcw,
} from 'lucide-react';

interface GraphViewProps {
  graphData: GraphData;
  tests: TestItem[];
  selectedTestId: string | null;
  onSelectTest: (testId: string | null) => void;
  theme: 'dark' | 'light';
}

export const GraphView: React.FC<GraphViewProps> = ({
  graphData,
  tests,
  selectedTestId,
  onSelectTest,
  theme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const dashOffsetRef = useRef<number>(0);

  const [granularity, setGranularity] = useState<'function' | 'module'>('function');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterModifiedOnly, setFilterModifiedOnly] = useState(false);
  const [filterShowTests, setFilterShowTests] = useState(true);
  const [filterShowStatic, setFilterShowStatic] = useState(true);
  const [filterShowRuntime, setFilterShowRuntime] = useState(true);
  const [animatePulses, setAnimatePulses] = useState(true);
  const [isolatedNodeId, setIsolatedNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [showPhysicsControls, setShowPhysicsControls] = useState(false);
  const [repulsionStrength, setRepulsionStrength] = useState(14000);
  const [gravityStrength, setGravityStrength] = useState(0.18);

  // Selected Node data
  const selectedNode = useMemo(() => {
    return graphData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [graphData.nodes, selectedNodeId]);

  // Edges related to selected node
  const relatedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graphData.edges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId
    );
  }, [graphData.edges, selectedNodeId]);

  // Build Cytoscape elements (Obsidian Constellation mode: circular nodes, no blocky group boxes)
  const elements = useMemo(() => {
    const nodes: cytoscape.NodeDefinition[] = [];
    const edges: cytoscape.EdgeDefinition[] = [];

    if (granularity === 'module') {
      // In module view, collapse functions into their parent modules
      const moduleNodes: Record<
        string,
        {
          hasModified: boolean;
          hasAdded: boolean;
          hasFailedTest: boolean;
          hasPassingTest: boolean;
          testCount: number;
          functionCount: number;
        }
      > = {};

      graphData.nodes.forEach((n) => {
        const mod = n.parentModule;
        if (!moduleNodes[mod]) {
          moduleNodes[mod] = {
            hasModified: false,
            hasAdded: false,
            hasFailedTest: false,
            hasPassingTest: false,
            testCount: 0,
            functionCount: 0,
          };
        }
        if (n.changeStatus === 'modified') moduleNodes[mod].hasModified = true;
        if (n.changeStatus === 'added') moduleNodes[mod].hasAdded = true;

        const test = tests.find((t) => t.id === n.id);
        if (test) {
          moduleNodes[mod].testCount++;
          if (test.status === 'fail') moduleNodes[mod].hasFailedTest = true;
          if (test.status === 'pass') moduleNodes[mod].hasPassingTest = true;
        } else {
          moduleNodes[mod].functionCount++;
        }
      });

      Object.entries(moduleNodes).forEach(([mod, info]) => {
        let changeStatus = 'unchanged';
        if (info.hasModified) changeStatus = 'modified';
        else if (info.hasAdded) changeStatus = 'added';

        let status = 'neutral';
        if (info.hasFailedTest) status = 'fail';
        else if (info.hasPassingTest) status = 'pass';

        nodes.push({
          data: {
            id: mod,
            label: `${mod} (${info.functionCount} fns)`,
            name: mod,
            kind: 'module',
            changeStatus,
            status,
            degree: info.functionCount + info.testCount,
          },
        });
      });

      // Module-level edges
      const modEdgeSet = new Set<string>();
      graphData.edges.forEach((e) => {
        const srcNode = graphData.nodes.find((n) => n.id === e.source);
        const tgtNode = graphData.nodes.find((n) => n.id === e.target);
        if (srcNode && tgtNode && srcNode.parentModule !== tgtNode.parentModule) {
          const edgeKey = `${srcNode.parentModule}->${tgtNode.parentModule}:${e.category}`;
          if (!modEdgeSet.has(edgeKey)) {
            modEdgeSet.add(edgeKey);
            edges.push({
              data: {
                id: `medge_${edgeKey}`,
                source: srcNode.parentModule,
                target: tgtNode.parentModule,
                category: e.category,
                provenance: e.provenance,
              },
            });
          }
        }
      });

      return { nodes, edges };
    }

    // Function-level granularity (Obsidian dataset view: clean circular celestial nodes)
    const allowedNodeIds = new Set<string>();
    if (isolatedNodeId) {
      allowedNodeIds.add(isolatedNodeId);
      graphData.edges.forEach((e) => {
        if (e.source === isolatedNodeId) allowedNodeIds.add(e.target);
        if (e.target === isolatedNodeId) allowedNodeIds.add(e.source);
      });
    }

    // Node degree calculation for dynamic Obsidian particle scaling
    const degreeMap: Record<string, number> = {};
    graphData.edges.forEach((e) => {
      degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
    });

    graphData.nodes.forEach((n) => {
      if (isolatedNodeId && !allowedNodeIds.has(n.id)) return;
      if (filterModifiedOnly && n.changeStatus === 'unchanged') return;

      const test = tests.find((t) => t.id === n.id);
      if (!filterShowTests && test) return;

      const deg = degreeMap[n.id] || 1;

      nodes.push({
        data: {
          id: n.id,
          label: n.name,
          name: n.name,
          kind: n.kind,
          file: n.file,
          parentModule: n.parentModule,
          changeStatus: n.changeStatus,
          status: test ? test.status : 'neutral',
          isTest: !!test,
          degree: deg,
        },
      });
    });

    const activeNodeIdSet = new Set(nodes.map((n) => n.data.id));

    graphData.edges.forEach((e) => {
      if (!filterShowRuntime && e.category === 'runtime_observed') return;
      if (!filterShowStatic && (e.category === 'static_call' || e.category === 'static_import'))
        return;
      if (!activeNodeIdSet.has(e.source) || !activeNodeIdSet.has(e.target)) return;

      edges.push({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          category: e.category,
          provenance: e.provenance,
          observedCount: e.observedCount,
          testIds: e.testIds || [],
        },
      });
    });

    return { nodes, edges };
  }, [
    graphData,
    tests,
    granularity,
    filterModifiedOnly,
    filterShowTests,
    filterShowStatic,
    filterShowRuntime,
    isolatedNodeId,
  ]);

  // Run or restart the Obsidian Force Physics layout
  const runPhysicsLayout = useCallback(
    (cy: Core) => {
      const layout = cy.layout({
        name: 'cose',
        animate: true,
        animationDuration: 1000,
        refresh: 20,
        fit: true,
        padding: 70,
        randomize: false,
        componentSpacing: 130,
        nodeRepulsion: () => repulsionStrength,
        nodeOverlap: 40,
        idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
          return edge.data('category') === 'runtime_observed' ? 110 : 150;
        },
        edgeElasticity: () => 0.45,
        nestingFactor: 0.1,
        gravity: gravityStrength,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      });
      layout.run();
    },
    [repulsionStrength, gravityStrength]
  );

  // Initialize Cytoscape with Obsidian dataset aesthetics
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...elements.nodes, ...elements.edges],
      style: [
        // Base Node: Sleek Circular Particle (Obsidian style)
        {
          selector: 'node',
          style: {
            shape: 'ellipse',
            width: 12,
            height: 12,
            'background-color': '#334155',
            'border-width': 1.5,
            'border-color': '#475569',
            label: 'data(label)',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size': '9.5px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            color: '#64748b',
            'text-max-width': '130px',
            'text-wrap': 'ellipsis',
            'text-background-color': '#080b11',
            'text-background-opacity': 0.75,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-border-color': 'rgba(51, 65, 85, 0.4)',
            'text-border-width': 0.5,
            'text-border-opacity': 0.5,
            'transition-property':
              'background-color, border-color, border-width, width, height, opacity',
            'transition-duration': 0.25,
          },
        },
        // Hovered node
        {
          selector: 'node:active, node.hovered',
          style: {
            'border-color': '#38bdf8',
            'border-width': 3,
            color: '#f8fafc',
            'font-weight': 'bold',
          },
        },
        // Color accents ONLY on actively changed items:
        // MODIFIED CODE: Glowing Amber Orb
        {
          selector: 'node[changeStatus = "modified"]',
          style: {
            'background-color': '#f59e0b',
            'border-color': '#fef08a',
            'border-width': 3.5,
            width: 24,
            height: 24,
            color: '#fbbf24',
            'font-weight': 'bold',
            'font-size': '11px',
            'z-index': 100,
          },
        },
        // ADDED CODE: Glowing Cyan / Teal Orb
        {
          selector: 'node[changeStatus = "added"]',
          style: {
            'background-color': '#06b6d4',
            'border-color': '#a5f3fc',
            'border-width': 3.5,
            width: 24,
            height: 24,
            color: '#22d3ee',
            'font-weight': 'bold',
            'font-size': '11px',
            'z-index': 100,
          },
        },
        // FAILING TEST: Glowing Crimson Orb
        {
          selector: 'node[status = "fail"]',
          style: {
            'background-color': '#ef4444',
            'border-color': '#fca5a5',
            'border-width': 4,
            width: 26,
            height: 26,
            color: '#f87171',
            'font-weight': 'bold',
            'font-size': '11px',
            'z-index': 110,
          },
        },
        // PASSING TEST: Subtle Emerald Orb
        {
          selector: 'node[status = "pass"]',
          style: {
            'background-color': '#10b981',
            'border-color': '#6ee7b7',
            'border-width': 2,
            width: 14,
            height: 14,
            color: '#a7f3d0',
            'font-size': '10px',
          },
        },
        // ERRORED TEST: Vivid Orange Orb
        {
          selector: 'node[status = "error"]',
          style: {
            'background-color': '#f97316',
            'border-color': '#fdba74',
            'border-width': 3,
            width: 20,
            height: 20,
            color: '#fb923c',
            'font-weight': 'bold',
          },
        },
        // MODULE NODES (When in Module Granularity)
        {
          selector: 'node[kind = "module"]',
          style: {
            shape: 'ellipse',
            width: 32,
            height: 32,
            'background-color': '#1e293b',
            'border-color': '#64748b',
            'border-width': 2,
            color: '#e2e8f0',
            'font-size': '11px',
            'font-weight': 'bold',
          },
        },
        // Slender Filaments: Base Edge
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': 'rgba(148, 163, 184, 0.18)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
            'arrow-scale': 0.6,
            'transition-property': 'line-color, width, opacity',
            'transition-duration': 0.2,
          },
        },
        // Runtime Observed Edges: Subtle Cyan filament
        {
          selector: 'edge[category = "runtime_observed"]',
          style: {
            'line-color': 'rgba(56, 189, 248, 0.35)',
            'target-arrow-shape': 'chevron',
            'target-arrow-color': 'rgba(56, 189, 248, 0.45)',
            width: 1.5,
          },
        },
        // Static Call/Import Edges: Faint Dashed filament
        {
          selector: 'edge[category = "static_call"], edge[category = "static_import"]',
          style: {
            'line-color': 'rgba(100, 116, 139, 0.22)',
            'line-style': 'dashed',
            'line-dash-pattern': [3, 4],
            width: 1,
          },
        },
        // HIGHLIGHTED TEST TRACE: Moving Dotted / Pulsing Line
        {
          selector: '.highlighted-edge',
          style: {
            'line-color': '#38bdf8',
            'line-style': 'dashed',
            'line-dash-pattern': [6, 4],
            width: 3,
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#38bdf8',
            'arrow-scale': 0.8,
            'z-index': 999,
          },
        },
        {
          selector: '.highlighted-edge-failing',
          style: {
            'line-color': '#f43f5e',
            'line-style': 'dashed',
            'line-dash-pattern': [6, 4],
            width: 3.5,
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#f43f5e',
            'arrow-scale': 0.9,
            'z-index': 1000,
          },
        },
        {
          selector: '.highlighted-node',
          style: {
            'border-color': '#38bdf8',
            'border-width': 4,
            'z-index': 999,
            color: '#ffffff',
            'font-weight': 'bold',
          },
        },
        // Dimmed constellation elements when focusing on an active trace
        {
          selector: '.dimmed',
          style: {
            opacity: 0.15,
          },
        },
        // Selected node border
        {
          selector: ':selected',
          style: {
            'border-color': '#38bdf8',
            'border-width': 4,
            'z-index': 1000,
          },
        },
      ],
      layout: {
        name: 'preset',
      },
    });

    cy.on('tap', 'node', (evt: EventObject) => {
      setSelectedNodeId(evt.target.id());
    });

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        setSelectedNodeId(null);
      }
    });

    cyRef.current = cy;

    // Run physics simulation
    runPhysicsLayout(cy);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      cy.destroy();
    };
  }, [elements, theme, runPhysicsLayout]);

  // Moving Dotted Line Animation Loop for Active Traversal Paths
  useEffect(() => {
    if (!animatePulses) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const cy = cyRef.current;
    if (!cy) return;

    let isRunning = true;

    const animateDash = () => {
      if (!isRunning) return;
      dashOffsetRef.current = (dashOffsetRef.current + 0.6) % 20;

      const activeEdges = cy.$('.highlighted-edge, .highlighted-edge-failing');
      if (activeEdges.length > 0) {
        // Update animated dash offset for marching-ants / particle pulse
        activeEdges.style('line-dash-offset', -dashOffsetRef.current);
      }

      animFrameRef.current = requestAnimationFrame(animateDash);
    };

    animFrameRef.current = requestAnimationFrame(animateDash);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [animatePulses, selectedTestId]);

  // Handle Test Highlighting Effect (Live Trace Traversal)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass(
        'highlighted-node highlighted-edge highlighted-edge-failing dimmed'
      );

      if (!selectedTestId) {
        return;
      }

      const activeTest = tests.find((t) => t.id === selectedTestId);
      if (!activeTest) return;

      const exercisedNodeIds = new Set(activeTest.exercisedNodeIds);
      exercisedNodeIds.add(activeTest.id);

      const isFailing = activeTest.status === 'fail';

      cy.nodes().forEach((n) => {
        if (exercisedNodeIds.has(n.id())) {
          n.addClass('highlighted-node');
        } else {
          n.addClass('dimmed');
        }
      });

      cy.edges().forEach((e) => {
        const testIds: string[] = e.data('testIds') || [];
        const isTraversed =
          testIds.includes(selectedTestId) ||
          (exercisedNodeIds.has(e.data('source')) &&
            exercisedNodeIds.has(e.data('target')) &&
            e.data('category') === 'runtime_observed');

        if (isTraversed) {
          e.addClass(isFailing ? 'highlighted-edge-failing' : 'highlighted-edge');
        } else {
          e.addClass('dimmed');
        }
      });
    });
  }, [selectedTestId, tests]);

  // Resize Cytoscape canvas when drawer toggles
  useEffect(() => {
    if (cyRef.current) {
      setTimeout(() => {
        cyRef.current?.resize();
      }, 50);
    }
  }, [selectedNode]);

  // Search handler
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
      cy.animate({
        center: { eles: matched.first() },
        zoom: 1.5,
        duration: 350,
      });
      setSelectedNodeId(matched.first().id());
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

  const handleIsolateNeighbors = (nodeId: string) => {
    if (isolatedNodeId === nodeId) {
      setIsolatedNodeId(null);
    } else {
      setIsolatedNodeId(nodeId);
    }
  };

  const handleRerunPhysics = () => {
    if (cyRef.current) {
      runPhysicsLayout(cyRef.current);
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: selectedNode ? '1fr 420px' : '1fr',
        height: 'calc(100vh - 85px)',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#080b11',
      }}
    >
      {/* Graph Center Area */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          minWidth: 0,
        }}
      >
        {/* Floating Obsidian-Style HUD Toolbar */}
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '14px',
            right: selectedNode ? '14px' : '14px',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 12px',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(51, 65, 85, 0.65)',
            borderRadius: '8px',
            gap: '12px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            flexWrap: 'wrap',
          }}
        >
          {/* Left: Granularity & Test Trace Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                backgroundColor: 'rgba(2, 6, 23, 0.6)',
                borderRadius: '6px',
                padding: '2px',
                border: '1px solid rgba(51, 65, 85, 0.5)',
              }}
            >
              <button
                onClick={() => setGranularity('function')}
                className={`btn btn-sm ${granularity === 'function' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11px', padding: '2px 8px' }}
              >
                Functions ({graphData.nodes.length})
              </button>
              <button
                onClick={() => setGranularity('module')}
                className={`btn btn-sm ${granularity === 'module' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11px', padding: '2px 8px' }}
              >
                Modules
              </button>
            </div>

            {/* Test Trace Highlight Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                Test Trace:
              </span>
              <select
                value={selectedTestId || ''}
                onChange={(e) => onSelectTest(e.target.value || null)}
                style={{
                  backgroundColor: 'rgba(2, 6, 23, 0.8)',
                  color: '#f8fafc',
                  border: '1px solid rgba(51, 65, 85, 0.7)',
                  borderRadius: '5px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  maxWidth: '220px',
                }}
                aria-label="Highlight Test Trace"
              >
                <option value="">(None - Full Topology)</option>
                {tests.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.status.toUpperCase()}] {t.name}
                  </option>
                ))}
              </select>
              {selectedTestId && (
                <button
                  onClick={() => onSelectTest(null)}
                  className="btn btn-sm btn-ghost"
                  title="Clear trace highlight"
                  style={{ padding: '2px 4px' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Symbol quick inspect */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Inspect:</span>
              <select
                value={selectedNodeId || ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setSelectedNodeId(id);
                  if (id && cyRef.current) {
                    const targetEle = cyRef.current.getElementById(id);
                    if (targetEle) {
                      cyRef.current.animate({
                        center: { eles: targetEle },
                        zoom: 1.4,
                        duration: 350,
                      });
                    }
                  }
                }}
                style={{
                  backgroundColor: 'rgba(2, 6, 23, 0.8)',
                  color: '#f8fafc',
                  border: '1px solid rgba(51, 65, 85, 0.7)',
                  borderRadius: '5px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  maxWidth: '220px',
                }}
                aria-label="Inspect Symbol"
              >
                <option value="">(Click node or select)</option>
                {graphData.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.changeStatus})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '180px' }}>
            <Search
              size={12}
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748b',
              }}
            />
            <input
              type="text"
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'rgba(2, 6, 23, 0.8)',
                border: '1px solid rgba(51, 65, 85, 0.7)',
                borderRadius: '5px',
                padding: '4px 8px 4px 26px',
                color: '#f8fafc',
                fontSize: '11px',
                outline: 'none',
              }}
              aria-label="Search symbol"
            />
          </div>

          {/* Filters & Obsidian Physics Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: filterModifiedOnly ? '#fbbf24' : '#94a3b8',
                fontWeight: filterModifiedOnly ? 600 : 400,
              }}
            >
              <input
                type="checkbox"
                checked={filterModifiedOnly}
                onChange={(e) => setFilterModifiedOnly(e.target.checked)}
              />
              Modified Only
            </label>

            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: '#94a3b8',
              }}
            >
              <input
                type="checkbox"
                checked={filterShowTests}
                onChange={(e) => setFilterShowTests(e.target.checked)}
              />
              Tests
            </label>

            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: '#94a3b8',
              }}
              title="Show runtime observed execution edges"
            >
              <input
                type="checkbox"
                checked={filterShowRuntime}
                onChange={(e) => setFilterShowRuntime(e.target.checked)}
              />
              Runtime
            </label>

            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: '#94a3b8',
              }}
              title="Show static AST call and import edges"
            >
              <input
                type="checkbox"
                checked={filterShowStatic}
                onChange={(e) => setFilterShowStatic(e.target.checked)}
              />
              Static
            </label>

            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: animatePulses ? '#38bdf8' : '#64748b',
              }}
              title="Animated moving dotted line pulses along active execution paths"
            >
              <input
                type="checkbox"
                checked={animatePulses}
                onChange={(e) => setAnimatePulses(e.target.checked)}
              />
              <Sparkles size={11} />
              Moving Pulses
            </label>

            <button
              onClick={() => setShowPhysicsControls(!showPhysicsControls)}
              className={`btn btn-sm ${showPhysicsControls ? 'btn-primary' : 'btn-ghost'}`}
              title="Obsidian Graph Physics Settings"
              style={{ padding: '3px 7px' }}
            >
              <Sliders size={12} />
              Physics
            </button>

            <button
              onClick={handleRerunPhysics}
              className="btn btn-sm btn-ghost"
              title="Re-scatter & Simulate Physics"
              style={{ padding: '3px 7px' }}
            >
              <RotateCcw size={12} />
            </button>

            {isolatedNodeId && (
              <button
                onClick={() => setIsolatedNodeId(null)}
                className="btn btn-sm"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  color: '#f87171',
                  borderColor: '#ef4444',
                }}
              >
                Reset Isolation
              </button>
            )}

            <div style={{ display: 'flex', gap: '2px' }}>
              <button onClick={handleZoomIn} className="btn btn-sm btn-ghost" title="Zoom in">
                <ZoomIn size={12} />
              </button>
              <button onClick={handleZoomOut} className="btn btn-sm btn-ghost" title="Zoom out">
                <ZoomOut size={12} />
              </button>
              <button onClick={handleFit} className="btn btn-sm btn-ghost" title="Fit to view">
                <Maximize2 size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* Floating Physics Controls Popover (Obsidian Style) */}
        {showPhysicsControls && (
          <div
            style={{
              position: 'absolute',
              top: '56px',
              right: selectedNode ? '434px' : '14px',
              zIndex: 25,
              width: '260px',
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(51, 65, 85, 0.8)',
              borderRadius: '8px',
              padding: '12px 14px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
              fontSize: '11px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px',
                fontWeight: 700,
                color: '#f8fafc',
              }}
            >
              <span>Obsidian Physics Forces</span>
              <button
                onClick={() => setShowPhysicsControls(false)}
                className="btn btn-sm btn-ghost"
                style={{ padding: '0 4px' }}
              >
                <X size={12} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#94a3b8',
                    marginBottom: '4px',
                  }}
                >
                  <span>Repulsion Force (Spacing)</span>
                  <span>{repulsionStrength}</span>
                </div>
                <input
                  type="range"
                  min="3000"
                  max="20000"
                  step="500"
                  value={repulsionStrength}
                  onChange={(e) => setRepulsionStrength(Number(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#94a3b8',
                    marginBottom: '4px',
                  }}
                >
                  <span>Central Gravity</span>
                  <span>{gravityStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1.0"
                  step="0.05"
                  value={gravityStrength}
                  onChange={(e) => setGravityStrength(Number(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              <div style={{ borderTop: '1px solid rgba(51, 65, 85, 0.5)', paddingTop: '8px' }}>
                <button
                  onClick={handleRerunPhysics}
                  className="btn btn-sm btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <Play size={11} /> Re-Simulate Constellation
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cytoscape Canvas Container (Obsidian Starry Cosmos Background) */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            width: '100%',
            height: '100%',
            background: 'radial-gradient(circle at 50% 50%, #0d1322 0%, #060910 100%)',
            backgroundImage:
              'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Obsidian-Style Evidence & Color Legend */}
        <div
          style={{
            position: 'absolute',
            bottom: '14px',
            left: '14px',
            zIndex: 20,
            maxWidth: showLegend ? '380px' : 'auto',
          }}
        >
          {showLegend ? (
            <div
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(51, 65, 85, 0.7)',
                borderRadius: '8px',
                padding: '12px 14px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                fontSize: '11px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: '#94a3b8',
                }}
              >
                <span>Obsidian Dataset Legend</span>
                <button
                  onClick={() => setShowLegend(false)}
                  className="btn btn-sm btn-ghost"
                  style={{ padding: '0 4px' }}
                >
                  <X size={12} />
                </button>
              </div>

              {/* Node colors: strictly colored only on what is changed */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#f59e0b',
                      border: '2px solid #fef08a',
                      boxShadow: '0 0 6px rgba(245, 158, 11, 0.6)',
                    }}
                  />
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>Modified Code (Amber)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#06b6d4',
                      border: '2px solid #a5f3fc',
                      boxShadow: '0 0 6px rgba(6, 182, 212, 0.6)',
                    }}
                  />
                  <span style={{ color: '#22d3ee', fontWeight: 600 }}>Added Code (Cyan)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                      border: '2px solid #fca5a5',
                      boxShadow: '0 0 8px rgba(239, 68, 68, 0.7)',
                    }}
                  />
                  <span style={{ color: '#f87171', fontWeight: 600 }}>Failing Test (Crimson)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#10b981',
                      border: '1.5px solid #6ee7b7',
                    }}
                  />
                  <span style={{ color: '#a7f3d0' }}>Passing Test (Green)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#334155',
                      border: '1px solid #475569',
                    }}
                  />
                  <span style={{ color: '#64748b' }}>Unchanged Code (Slate)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div
                    style={{
                      width: '16px',
                      height: '0',
                      borderTop: '2px dashed #38bdf8',
                    }}
                  />
                  <span style={{ color: '#38bdf8' }}>Moving Dotted Pulse</span>
                </div>
              </div>

              {/* Edge styles */}
              <div
                style={{
                  borderTop: '1px solid rgba(51, 65, 85, 0.6)',
                  paddingTop: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '2px',
                      backgroundColor: 'rgba(56, 189, 248, 0.6)',
                    }}
                  />
                  <span style={{ color: '#cbd5e1' }}>
                    <strong>Runtime Observed:</strong> Executed trace during test run
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '0px',
                      borderTop: '1px dashed rgba(148, 163, 184, 0.35)',
                    }}
                  />
                  <span style={{ color: '#94a3b8' }}>
                    <strong>Static Possibility:</strong> AST call / import filament
                  </span>
                </div>
              </div>

              {/* Honest Causality Notice */}
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '6px',
                  borderTop: '1px solid rgba(51, 65, 85, 0.6)',
                  fontSize: '10px',
                  color: '#94a3b8',
                }}
              >
                <strong style={{ color: '#fbbf24' }}>Observed, not proven cause:</strong> Graph
                edges show real observed traces, not proven defect root cause.
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLegend(true)}
              className="btn btn-sm"
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(51, 65, 85, 0.6)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <Info size={12} />
              Obsidian Legend
            </button>
          )}
        </div>
      </div>

      {/* Right Column: Node Details Inspector Drawer */}
      {selectedNode && (
        <div
          style={{
            borderLeft: '1px solid rgba(51, 65, 85, 0.7)',
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(16px)',
            height: '100%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Node Header */}
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.7)',
              backgroundColor: 'rgba(2, 6, 23, 0.5)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <span className={`badge-change ${selectedNode.changeStatus}`}>
                {selectedNode.changeStatus}
              </span>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="btn btn-sm btn-ghost"
              >
                <X size={14} />
              </button>
            </div>

            <h3
              style={{
                fontSize: '14px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                wordBreak: 'break-all',
                color: '#f8fafc',
              }}
            >
              {selectedNode.name}
            </h3>
            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                fontFamily: 'var(--font-mono)',
                marginTop: '2px',
              }}
            >
              {selectedNode.file}:{selectedNode.lineStart}-{selectedNode.lineEnd}
            </div>

            <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleIsolateNeighbors(selectedNode.id)}
                className="btn btn-sm"
                title="Isolate 1-hop connected constellation neighbors"
              >
                <Eye size={12} />
                {isolatedNodeId === selectedNode.id
                  ? 'Show Full Constellation'
                  : 'Isolate 1-Hop Neighbors'}
              </button>
            </div>
          </div>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Git Diff if modified or added */}
            {selectedNode.gitDiff && (
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: '#fbbf24',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <GitCommit size={12} /> Git Unified Diff
                </div>
                <DiffViewer diff={selectedNode.gitDiff} />
              </div>
            )}

            {/* Source Snippet */}
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: '#94a3b8',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Code2 size={12} /> Source Snippet (L{selectedNode.lineStart}-{selectedNode.lineEnd})
              </div>
              <DiffViewer
                source={selectedNode.sourceSnippet}
                lineStart={selectedNode.lineStart}
              />
            </div>

            {/* Connected Relationships */}
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: '#94a3b8',
                  marginBottom: '8px',
                }}
              >
                Connected Edges ({relatedEdges.length})
              </div>

              {relatedEdges.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  No inbound or outbound connections recorded.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {relatedEdges.map((e) => {
                    const isOutbound = e.source === selectedNode.id;
                    const counterpart = isOutbound ? e.target : e.source;
                    return (
                      <div
                        key={e.id}
                        onClick={() => setSelectedNodeId(counterpart)}
                        style={{
                          backgroundColor: 'rgba(2, 6, 23, 0.6)',
                          border: '1px solid rgba(51, 65, 85, 0.6)',
                          borderRadius: '5px',
                          padding: '6px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          transition: 'border-color 0.15s ease',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '2px',
                          }}
                        >
                          <span
                            style={{
                              color:
                                e.category === 'runtime_observed'
                                  ? '#38bdf8'
                                  : '#94a3b8',
                              fontWeight: 600,
                              fontSize: '10px',
                              textTransform: 'uppercase',
                            }}
                          >
                            {isOutbound ? '→ Calls' : '← Called by'} ({e.category.replace('_', ' ')})
                          </span>
                          {e.observedCount && (
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                              {e.observedCount}x observed
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: '#f8fafc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {counterpart}
                        </div>
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#64748b',
                            marginTop: '2px',
                          }}
                        >
                          Provenance: {e.provenance}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
