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
  GitCommit,
  Info,
} from 'lucide-react';

interface GraphViewProps {
  graphData: GraphData;
  tests: TestItem[];
  selectedTestId: string | null;
  onSelectTest?: (testId: string | null) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  runStatus?: string;
  errorMessage?: string;
}

export const GraphView: React.FC<GraphViewProps> = ({
  graphData,
  tests,
  selectedTestId,
  selectedNodeId,
  onSelectNode,
  runStatus,
  errorMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [includeStaticContext, setIncludeStaticContext] = useState(false);
  const [localSelectedNodeId, setLocalSelectedNodeId] = useState<string | null>(null);

  // Active selected node: prioritize prop, fallback to local selection
  const activeNodeId = selectedNodeId !== undefined ? selectedNodeId : localSelectedNodeId;

  const activeTest = useMemo(() => {
    return tests.find((t) => t.id === selectedTestId) || null;
  }, [tests, selectedTestId]);

  // Selected Node data
  const selectedNode = useMemo(() => {
    return graphData.nodes.find((n) => n.id === activeNodeId) || null;
  }, [graphData.nodes, activeNodeId]);

  // Edges related to selected node
  const relatedEdges = useMemo(() => {
    if (!activeNodeId) return [];
    return graphData.edges.filter(
      (e) => e.source === activeNodeId || e.target === activeNodeId
    );
  }, [graphData.edges, activeNodeId]);

  // Compute bounded graph elements for this test (or full graph if no test selected)
  const elements = useMemo(() => {
    const nodes: cytoscape.NodeDefinition[] = [];
    const edges: cytoscape.EdgeDefinition[] = [];

    if (graphData.nodes.length === 0) {
      return { nodes, edges };
    }

    // Determine relevant nodes
    let relevantNodeIds: Set<string>;
    if (activeTest) {
      relevantNodeIds = new Set(activeTest.exercisedNodeIds);
      relevantNodeIds.add(activeTest.id);

      // If static context is enabled, include 1-hop static neighbors
      if (includeStaticContext) {
        graphData.edges.forEach((e) => {
          if (e.category === 'static_call' || e.category === 'static_import') {
            if (relevantNodeIds.has(e.source)) relevantNodeIds.add(e.target);
            if (relevantNodeIds.has(e.target)) relevantNodeIds.add(e.source);
          }
        });
      }
    } else {
      relevantNodeIds = new Set(graphData.nodes.map((n) => n.id));
    }

    // Add nodes
    graphData.nodes.forEach((n) => {
      if (!relevantNodeIds.has(n.id)) return;

      const testItem = tests.find((t) => t.id === n.id);
      nodes.push({
        data: {
          id: n.id,
          label: n.name,
          name: n.name,
          kind: n.kind,
          file: n.file,
          changeStatus: n.changeStatus,
          status: testItem ? testItem.status : 'neutral',
          isTest: Boolean(testItem),
        },
      });
    });

    const activeNodeIdSet = new Set(nodes.map((n) => n.data.id));

    // Add edges
    graphData.edges.forEach((e) => {
      if (!activeNodeIdSet.has(e.source) || !activeNodeIdSet.has(e.target)) return;

      if (e.category === 'runtime_observed') {
        // Require explicit per-test edge provenance
        if (activeTest && (!e.testIds || !e.testIds.includes(activeTest.id))) {
          return;
        }
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
      } else if (includeStaticContext) {
        // Static edges only when opted in
        edges.push({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            category: e.category,
            provenance: e.provenance,
          },
        });
      }
    });

    return { nodes, edges };
  }, [graphData, tests, activeTest, includeStaticContext]);

  // Handle node selection
  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      setLocalSelectedNodeId(nodeId);
      onSelectNode?.(nodeId);
    },
    [onSelectNode]
  );

  // Initialize and maintain Cytoscape
  useEffect(() => {
    if (!containerRef.current || elements.nodes.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...elements.nodes, ...elements.edges],
      style: [
        // Base Node: Clean circular dot with readable label
        {
          selector: 'node',
          style: {
            shape: 'ellipse',
            width: 14,
            height: 14,
            'background-color': '#202632',
            'border-width': 1.5,
            'border-color': '#334155',
            label: 'data(label)',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            'font-size': '11px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 5,
            color: '#94a3b8',
            'text-max-width': '160px',
            'text-wrap': 'ellipsis',
            'text-background-color': '#0e1117',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
          },
        },
        // Modified Code Node: Amber
        {
          selector: 'node[changeStatus = "modified"]',
          style: {
            'background-color': '#f59e0b',
            'border-color': '#fbbf24',
            'border-width': 2.5,
            width: 18,
            height: 18,
            color: '#fbbf24',
            'font-weight': 'bold',
            'z-index': 100,
          },
        },
        // Added Code Node: Cyan
        {
          selector: 'node[changeStatus = "added"]',
          style: {
            'background-color': '#06b6d4',
            'border-color': '#22d3ee',
            'border-width': 2.5,
            width: 18,
            height: 18,
            color: '#22d3ee',
            'font-weight': 'bold',
            'z-index': 100,
          },
        },
        // Failing Test Node: Red
        {
          selector: 'node[status = "fail"]',
          style: {
            'background-color': '#ef4444',
            'border-color': '#fca5a5',
            'border-width': 3,
            width: 20,
            height: 20,
            color: '#f87171',
            'font-weight': 'bold',
            'z-index': 110,
          },
        },
        // Passing Test Node: Green
        {
          selector: 'node[status = "pass"]',
          style: {
            'background-color': '#10b981',
            'border-color': '#6ee7b7',
            'border-width': 2,
            width: 14,
            height: 14,
            color: '#a7f3d0',
          },
        },
        // Error Test Node: Orange
        {
          selector: 'node[status = "error"]',
          style: {
            'background-color': '#f97316',
            'border-color': '#fdba74',
            'border-width': 2.5,
            width: 18,
            height: 18,
            color: '#fb923c',
            'font-weight': 'bold',
          },
        },
        // Base Edges
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#475569',
            'curve-style': 'bezier',
            'target-arrow-shape': 'chevron',
            'arrow-scale': 0.7,
            'target-arrow-color': '#475569',
          },
        },
        // Runtime Observed Edges: Clear solid cyan/blue
        {
          selector: 'edge[category = "runtime_observed"]',
          style: {
            'line-color': '#38bdf8',
            'target-arrow-color': '#38bdf8',
            width: 2,
          },
        },
        // Static Call/Import Edges: Muted dashed
        {
          selector: 'edge[category = "static_call"], edge[category = "static_import"]',
          style: {
            'line-color': '#475569',
            'line-style': 'dashed',
            'line-dash-pattern': [4, 4],
            width: 1,
            'target-arrow-shape': 'none',
          },
        },
        // Selected node focus
        {
          selector: '.selected-node',
          style: {
            'border-color': '#3b82f6',
            'border-width': 3.5,
            'z-index': 999,
            color: '#ffffff',
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        fit: true,
        padding: 50,
        componentSpacing: 100,
        boundingBox: { x1: 0, y1: 0, w: 800, h: 600 },
        nodeRepulsion: () => 10000,
        idealEdgeLength: () => 100,
        edgeElasticity: () => 0.45,
        gravity: 0.3,
        numIter: 800,
      },
    });

    cy.on('tap', 'node', (evt: EventObject) => {
      handleSelectNode(evt.target.id());
    });

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        handleSelectNode(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, handleSelectNode]);

  // Update selection class on activeNodeId change without recreating graph
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.nodes().removeClass('selected-node');
      if (activeNodeId) {
        cy.getElementById(activeNodeId).addClass('selected-node');
      }
    });
  }, [activeNodeId]);

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
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

      cy.animate({
        center: { eles: matched.first() },
        zoom: 1.4,
        duration: prefersReducedMotion ? 0 : 250,
      });
      handleSelectNode(matched.first().id());
    }
  };

  const handleFit = () => {
    cyRef.current?.fit(undefined, 40);
  };

  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 1.25);
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom(cy.zoom() * 0.8);
  };

  // Diagnostic empty / error state checks
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
          No Evidence Graph Available
        </div>
        <div style={{ fontSize: '12px', maxWidth: '420px', lineHeight: '1.5' }}>
          No graph nodes or runtime traces are recorded for this run.
        </div>
      </div>
    );
  }

  if (activeTest && activeTest.exercisedNodeIds.length === 0) {
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
          No Coverage Recorded for {activeTest.name}
        </div>
        <div style={{ fontSize: '12px', maxWidth: '420px', lineHeight: '1.5' }}>
          This test executed without recording any runtime coverage nodes or trace edges.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: selectedNode ? 'minmax(0, 1fr) minmax(300px, 340px)' : '1fr',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-app)',
      }}
    >
      {/* Center Graph Canvas */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          minWidth: 0,
        }}
      >
        {/* Compact Evidence Map Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            backgroundColor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-default)',
            gap: '12px',
            flexWrap: 'wrap',
            zIndex: 10,
          }}
        >
          {/* Scope indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {activeTest ? `Evidence for ${activeTest.name}` : 'Full Repository Topology'}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ({elements.nodes.length} nodes, {elements.edges.length} edges)
            </span>
          </div>

          {/* Controls: Static context toggle, Search, Zoom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label
              style={{
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                color: includeStaticContext ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              title="Show surrounding static AST calls and imports (clearly dashed)"
            >
              <input
                type="checkbox"
                checked={includeStaticContext}
                onChange={(e) => setIncludeStaticContext(e.target.checked)}
              />
              Include Static Context
            </label>

            {/* Search Box */}
            <div style={{ position: 'relative', width: '160px' }}>
              <Search
                size={12}
                style={{
                  position: 'absolute',
                  left: '7px',
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
                  padding: '3px 8px 3px 24px',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                aria-label="Find symbol in evidence map"
              />
            </div>

            {/* Fit & Zoom Buttons */}
            <div style={{ display: 'flex', gap: '2px' }}>
              <button onClick={handleZoomIn} className="btn-ghost btn-sm" title="Zoom In" aria-label="Zoom in">
                <ZoomIn size={13} />
              </button>
              <button onClick={handleZoomOut} className="btn-ghost btn-sm" title="Zoom Out" aria-label="Zoom out">
                <ZoomOut size={13} />
              </button>
              <button onClick={handleFit} className="btn-ghost btn-sm" title="Fit to View" aria-label="Fit to view">
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
            backgroundColor: 'var(--bg-app)',
          }}
        />
      </div>

      {/* Right Column: Node Details Inspector Drawer */}
      {selectedNode && (
        <div
          style={{
            borderLeft: '1px solid var(--border-default)',
            backgroundColor: 'var(--bg-surface)',
            height: '100%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-default)',
              backgroundColor: 'var(--bg-raised)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '4px',
              }}
            >
              <span className={`badge-change ${selectedNode.changeStatus}`}>
                {selectedNode.changeStatus}
              </span>
              <button
                onClick={() => handleSelectNode(null)}
                className="btn-ghost btn-sm"
                aria-label="Close symbol inspector"
              >
                <X size={13} />
              </button>
            </div>

            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
                wordBreak: 'break-all',
              }}
            >
              {selectedNode.name}
            </div>
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
          </div>

          {/* Inspector Body */}
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Git Diff if changed */}
            {selectedNode.gitDiff && (
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: 'var(--change-modified)',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <GitCommit size={11} /> Unified Git Diff
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
                  color: 'var(--text-secondary)',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Code2 size={11} /> Source Snippet (L{selectedNode.lineStart}-{selectedNode.lineEnd})
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
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Connected Relationships ({relatedEdges.length})
              </div>

              {relatedEdges.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  No connections recorded for this symbol.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {relatedEdges.map((e) => {
                    const isOutbound = e.source === selectedNode.id;
                    const counterpart = isOutbound ? e.target : e.source;
                    return (
                      <button
                        key={e.id}
                        onClick={() => handleSelectNode(counterpart)}
                        style={{
                          backgroundColor: 'var(--bg-app)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '6px 8px',
                          fontSize: '11px',
                          display: 'flex',
                          flexDirection: 'column',
                          textAlign: 'left',
                          gap: '2px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <span
                            style={{
                              color: e.category === 'runtime_observed' ? 'var(--accent)' : 'var(--text-muted)',
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
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Causality Note */}
            <div className="notice-honest">
              <Info size={12} style={{ color: 'var(--change-modified)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Observed trace:</strong> Edge connections represent recorded execution calls or AST structures.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
