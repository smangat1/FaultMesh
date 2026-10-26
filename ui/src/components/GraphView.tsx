import React, { useEffect, useRef, useState, useMemo } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import dagre from 'cytoscape-dagre';
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
} from 'lucide-react';

// Register dagre layout plugin safely
if (typeof cytoscape('core', 'dagre') === 'undefined') {
  cytoscape.use(dagre);
}

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

  const [granularity, setGranularity] = useState<'function' | 'module'>('function');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterModifiedOnly, setFilterModifiedOnly] = useState(false);
  const [filterShowTests, setFilterShowTests] = useState(true);
  const [filterShowStatic, setFilterShowStatic] = useState(true);
  const [filterShowRuntime, setFilterShowRuntime] = useState(true);
  const [isolatedNodeId, setIsolatedNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);

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

  // Build Cytoscape elements based on filters and granularity
  const elements = useMemo(() => {
    const nodes: cytoscape.NodeDefinition[] = [];
    const edges: cytoscape.EdgeDefinition[] = [];

    // Module grouping
    const moduleMap = new Set<string>();

    if (granularity === 'module') {
      // In module view, collapse functions into their parent modules
      const moduleNodes: Record<
        string,
        {
          hasModified: boolean;
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
            hasFailedTest: false,
            hasPassingTest: false,
            testCount: 0,
            functionCount: 0,
          };
        }
        if (n.changeStatus === 'modified' || n.changeStatus === 'added') {
          moduleNodes[mod].hasModified = true;
        }
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
        let status = 'neutral';
        if (info.hasFailedTest) status = 'fail';
        else if (info.hasPassingTest) status = 'pass';

        nodes.push({
          data: {
            id: mod,
            label: `${mod}\n(${info.functionCount} fns, ${info.testCount} tests)`,
            kind: 'module',
            changeStatus,
            status,
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

    // Function-level granularity
    // Optional isolation filter
    const allowedNodeIds = new Set<string>();
    if (isolatedNodeId) {
      allowedNodeIds.add(isolatedNodeId);
      graphData.edges.forEach((e) => {
        if (e.source === isolatedNodeId) allowedNodeIds.add(e.target);
        if (e.target === isolatedNodeId) allowedNodeIds.add(e.source);
      });
    }

    graphData.nodes.forEach((n) => {
      if (isolatedNodeId && !allowedNodeIds.has(n.id)) return;
      if (filterModifiedOnly && n.changeStatus === 'unchanged') return;

      const test = tests.find((t) => t.id === n.id);
      if (!filterShowTests && test) return;

      // Group by parent module
      if (!moduleMap.has(n.parentModule)) {
        moduleMap.add(n.parentModule);
        nodes.push({
          data: {
            id: `grp_${n.parentModule}`,
            label: n.parentModule,
            isGroup: true,
          },
        });
      }

      nodes.push({
        data: {
          id: n.id,
          label: n.name,
          parent: `grp_${n.parentModule}`,
          kind: n.kind,
          file: n.file,
          changeStatus: n.changeStatus,
          status: test ? test.status : 'neutral',
          isTest: !!test,
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

  // Initialize and update Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...elements.nodes, ...elements.edges],
      style: [
        // Default node
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-family': 'ui-monospace, Menlo, Monaco, monospace',
            'font-size': '11px',
            'text-valign': 'center',
            'text-halign': 'center',
            color: theme === 'dark' ? '#f8fafc' : '#0f172a',
            'background-color': '#334155',
            'border-width': '2px',
            'border-color': '#475569',
            shape: 'round-rectangle',
            width: 'label',
            height: 'label',
            padding: '8px',
            'text-wrap': 'wrap',
          },
        },
        // Compound parent groups (modules)
        {
          selector: 'node[?isGroup]',
          style: {
            'background-color':
              theme === 'dark'
                ? 'rgba(30, 41, 59, 0.65)'
                : 'rgba(241, 245, 249, 0.75)',
            'border-color': theme === 'dark' ? '#334155' : '#cbd5e1',
            'border-width': '1px',
            'border-style': 'dashed',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': '10px',
            'font-weight': 'bold',
            color: theme === 'dark' ? '#94a3b8' : '#64748b',
            padding: '14px',
          },
        },
        // Modified Code Node: AMBER
        {
          selector: 'node[changeStatus = "modified"]',
          style: {
            'background-color': '#d97706',
            'border-color': '#f59e0b',
            'border-width': '3px',
            color: '#ffffff',
            'font-weight': 'bold',
          },
        },
        // Added Code Node: TEAL/CYAN
        {
          selector: 'node[changeStatus = "added"]',
          style: {
            'background-color': '#0891b2',
            'border-color': '#06b6d4',
            'border-width': '3px',
            color: '#ffffff',
          },
        },
        // Failing Test Node: RED
        {
          selector: 'node[status = "fail"]',
          style: {
            'background-color': '#dc2626',
            'border-color': '#ef4444',
            'border-width': '3px',
            shape: 'rectangle',
            color: '#ffffff',
            'font-weight': 'bold',
          },
        },
        // Passing Test Node: GREEN
        {
          selector: 'node[status = "pass"]',
          style: {
            'background-color': '#059669',
            'border-color': '#10b981',
            'border-width': '2px',
            shape: 'rectangle',
            color: '#ffffff',
          },
        },
        // Errored Test Node: ORANGE
        {
          selector: 'node[status = "error"]',
          style: {
            'background-color': '#ea580c',
            'border-color': '#f97316',
            'border-width': '3px',
            shape: 'rectangle',
            color: '#ffffff',
          },
        },
        // Edges: Default
        {
          selector: 'edge',
          style: {
            width: 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.9,
          },
        },
        // Runtime Observed Edges: Solid colored line with observation evidence
        {
          selector: 'edge[category = "runtime_observed"]',
          style: {
            'line-color': '#38bdf8',
            'target-arrow-color': '#38bdf8',
            width: 2.5,
            'line-style': 'solid',
          },
        },
        // Static Call/Import Edges: Dashed line
        {
          selector: 'edge[category = "static_call"], edge[category = "static_import"]',
          style: {
            'line-color': '#64748b',
            'target-arrow-color': '#64748b',
            width: 1.5,
            'line-style': 'dashed',
            'line-dash-pattern': [4, 4],
          },
        },
        // Highlighted Execution Path (when a test is selected)
        {
          selector: '.highlighted-edge',
          style: {
            'line-color': '#f43f5e',
            'target-arrow-color': '#f43f5e',
            width: 4,
            'z-index': 999,
          },
        },
        {
          selector: '.highlighted-node',
          style: {
            'border-width': '4px',
            'border-color': '#f43f5e',
            'z-index': 999,
          },
        },
        // Dimmed nodes and edges when focusing on a specific test path
        {
          selector: '.dimmed',
          style: {
            opacity: 0.2,
          },
        },
        // Selected node border
        {
          selector: ':selected',
          style: {
            'border-color': '#38bdf8',
            'border-width': '4px',
          },
        },
      ],
      layout: {
        name: 'dagre',
        // @ts-expect-error dagre layout options
        rankDir: 'TB',
        nodeSep: 40,
        rankSep: 60,
        animate: false,
      },
    });

    cy.on('tap', 'node', (evt: EventObject) => {
      const node = evt.target;
      if (!node.data('isGroup')) {
        setSelectedNodeId(node.id());
      }
    });

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        setSelectedNodeId(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [elements, theme]);

  // Resize Cytoscape canvas when drawer toggles
  useEffect(() => {
    if (cyRef.current) {
      setTimeout(() => {
        cyRef.current?.resize();
      }, 50);
    }
  }, [selectedNode]);

  // Handle Test Highlighting Effect
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass('highlighted-node highlighted-edge dimmed');

      if (!selectedTestId) {
        return;
      }

      const activeTest = tests.find((t) => t.id === selectedTestId);
      if (!activeTest) return;

      const exercisedNodeIds = new Set(activeTest.exercisedNodeIds);

      // Highlight active test node
      exercisedNodeIds.add(activeTest.id);

      cy.nodes().forEach((n) => {
        if (n.data('isGroup')) return;
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
          e.addClass('highlighted-edge');
        } else {
          e.addClass('dimmed');
        }
      });
    });
  }, [selectedTestId, tests]);

  // Search handler
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    const cy = cyRef.current;
    if (!cy || !query.trim()) return;

    const matched = cy.nodes().filter((n) => {
      if (n.data('isGroup')) return false;
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
        zoom: 1.2,
        duration: 300,
      });
      setSelectedNodeId(matched.first().id());
    }
  };

  const handleFit = () => {
    cyRef.current?.fit(undefined, 30);
  };

  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 1.25);
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 0.8);
  };

  const handleIsolateNeighbors = (nodeId: string) => {
    if (isolatedNodeId === nodeId) {
      setIsolatedNodeId(null);
    } else {
      setIsolatedNodeId(nodeId);
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: selectedNode ? '1fr 400px' : '1fr',
        height: 'calc(100vh - 85px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Graph Center Area */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          backgroundColor: 'var(--bg-primary)',
          minWidth: 0,
        }}
      >
        {/* Controls Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            gap: '12px',
            flexWrap: 'wrap',
            zIndex: 10,
          }}
        >
          {/* Granularity & Test Select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Function vs Module switch */}
            <div
              style={{
                display: 'flex',
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '4px',
                padding: '2px',
                border: '1px solid var(--border-color)',
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
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Highlight Test Trace:
              </span>
              <select
                value={selectedTestId || ''}
                onChange={(e) => onSelectTest(e.target.value || null)}
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  maxWidth: '200px',
                }}
                aria-label="Highlight Test Trace"
              >
                <option value="">(None - Show Full Topology)</option>
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
                  title="Clear highlight"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Inspect Symbol Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Inspect Symbol:
              </span>
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
                        zoom: 1.1,
                        duration: 300,
                      });
                    }
                  }
                }}
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  maxWidth: '180px',
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
          <div style={{ position: 'relative', width: '200px' }}>
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '4px 8px 4px 26px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                outline: 'none',
              }}
              aria-label="Search symbol"
            />
          </div>

          {/* Filter Toggles & Layout Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: filterModifiedOnly ? 'var(--change-modified)' : 'var(--text-secondary)',
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
                color: 'var(--text-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={filterShowTests}
                onChange={(e) => setFilterShowTests(e.target.checked)}
              />
              Show Tests
            </label>

            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={filterShowRuntime}
                onChange={(e) => setFilterShowRuntime(e.target.checked)}
              />
              Runtime Edges
            </label>

            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={filterShowStatic}
                onChange={(e) => setFilterShowStatic(e.target.checked)}
              />
              Static Edges
            </label>

            {isolatedNodeId && (
              <button
                onClick={() => setIsolatedNodeId(null)}
                className="btn btn-sm"
                style={{
                  backgroundColor: 'var(--status-fail-bg)',
                  color: 'var(--status-fail)',
                  borderColor: 'var(--status-fail)',
                }}
              >
                Reset Isolation
              </button>
            )}

            <div style={{ display: 'flex', gap: '2px' }}>
              <button onClick={handleZoomIn} className="btn btn-sm btn-ghost" title="Zoom in">
                <ZoomIn size={13} />
              </button>
              <button onClick={handleZoomOut} className="btn btn-sm btn-ghost" title="Zoom out">
                <ZoomOut size={13} />
              </button>
              <button onClick={handleFit} className="btn btn-sm btn-ghost" title="Fit to view">
                <Maximize2 size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Cytoscape Container */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            width: '100%',
            height: '100%',
            backgroundColor: theme === 'dark' ? '#090d16' : '#f8fafc',
          }}
        />

        {/* Legend Drawer Toggle & Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            zIndex: 20,
            maxWidth: showLegend ? '360px' : 'auto',
          }}
        >
          {showLegend ? (
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '12px 14px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
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
                  color: 'var(--text-muted)',
                }}
              >
                <span>Evidence & Semantics Legend</span>
                <button
                  onClick={() => setShowLegend(false)}
                  className="btn btn-sm btn-ghost"
                  style={{ padding: '0 4px' }}
                >
                  <X size={12} />
                </button>
              </div>

              {/* Node colors */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      backgroundColor: '#d97706',
                      border: '1px solid #f59e0b',
                    }}
                  />
                  <span>Modified Code (Amber)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      backgroundColor: '#0891b2',
                      border: '1px solid #06b6d4',
                    }}
                  />
                  <span>Added Code (Teal)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      backgroundColor: '#dc2626',
                      border: '1px solid #ef4444',
                    }}
                  />
                  <span>Failing Test (Red)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      backgroundColor: '#059669',
                      border: '1px solid #10b981',
                    }}
                  />
                  <span>Passing Test (Green)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      backgroundColor: '#334155',
                      border: '1px solid #475569',
                    }}
                  />
                  <span>Unchanged (Slate)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      backgroundColor: 'transparent',
                      border: '2px solid #f43f5e',
                    }}
                  />
                  <span>Highlighted Path</span>
                </div>
              </div>

              {/* Edge styles */}
              <div
                style={{
                  borderTop: '1px solid var(--border-subtle)',
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
                      height: '3px',
                      backgroundColor: '#38bdf8',
                    }}
                  />
                  <span>
                    <strong>Runtime Observed:</strong> Executed during test run
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '0px',
                      borderTop: '2px dashed #64748b',
                    }}
                  />
                  <span>
                    <strong>Static Possibility:</strong> AST call / import relation
                  </span>
                </div>
              </div>

              {/* Notice */}
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                }}
              >
                <strong>Observed, not proven cause:</strong> Graph edges show real observed traces,
                not proven defect root cause.
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLegend(true)}
              className="btn btn-sm"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              }}
            >
              <Info size={12} />
              Show Legend
            </button>
          )}
        </div>
      </div>

      {/* Right Column: Node Details Inspector Drawer */}
      {selectedNode && (
        <div
          style={{
            borderLeft: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
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
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-surface)',
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
              }}
            >
              {selectedNode.name}
            </h3>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
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
                title="Isolate 1-hop connected neighbors"
              >
                <Eye size={12} />
                {isolatedNodeId === selectedNode.id
                  ? 'Show Full Graph'
                  : 'Isolate Neighbors'}
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
                    color: 'var(--change-modified)',
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
                  color: 'var(--text-muted)',
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
                  color: 'var(--text-muted)',
                  marginBottom: '8px',
                }}
              >
                Connected Edges ({relatedEdges.length})
              </div>

              {relatedEdges.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '6px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
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
                                  ? 'var(--accent)'
                                  : 'var(--text-muted)',
                              fontWeight: 600,
                              fontSize: '10px',
                              textTransform: 'uppercase',
                            }}
                          >
                            {isOutbound ? '→ Calls' : '← Called by'} ({e.category.replace('_', ' ')})
                          </span>
                          {e.observedCount && (
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {e.observedCount}x observed
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-primary)',
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
                            color: 'var(--text-muted)',
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
