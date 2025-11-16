import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Panel,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../styles/common.css";
import "../styles/flow-graph.css";
import FunctionNode from "./nodes/FunctionNode";
import FileGroupContainer from "./containers/FileGroupContainer";
import { FrameworkConfig } from "../configs/layoutStrategies";
import {
  calculateFileGroupContainers,
  getLayoutedElements,
} from "../utils/graphLayout";
import { EdgeTracker } from "../utils/EdgeTracker";
import { Logger } from "../../utils/webviewLogger";
import NodeVisibilityDrawer from "./drawers/NodeVisibilityDrawer";
import DeclarationNode from "./nodes/DeclarationNode";
import CallOrderEdge from "./edges/CallOrderEdge";
import ExecutionTraceDrawer from "./drawers/ExecutionTraceDrawer";
import useDebounce from "../hooks/useDebounce";
import useExecutionTrace from "../hooks/useExecutionTrace";
import useGraphHighlighting from "../hooks/useGraphHighlighting";
import FlowGraphToolbar from "./toolbar/FlowGraphToolbar";
import useRenderGraph from "../hooks/useRenderGraph";
import useMessageBridge from "../hooks/useMessageBridge";

import type {
  FunctionNodeData,
  DeclarationNodeData,
  FlowNode,
  FlowEdge,
  FlowGraphProps,
} from "../types/flowGraph";

const nodeTypes = {
  functionNode: FunctionNode as React.ComponentType<any>,
  declarationNode: DeclarationNode as React.ComponentType<any>,
  fileGroupContainer: FileGroupContainer as React.ComponentType<any>,
};

const edgeTypes = {
  callOrderEdge: CallOrderEdge as React.ComponentType<any>,
};

const FlowGraph: React.FC<FlowGraphProps> = ({ vscode }) => {
  const reactFlowInstance = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [enableJumpToFile, setEnableJumpToFile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detectedFramework, setDetectedFramework] =
    useState<FrameworkConfig | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [isAutoSorting, setIsAutoSorting] = useState(false);

  const [isGraphReady, setIsGraphReady] = useState(false);
  const {
    lineHighlightedEdges,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleClearNodeHighlight,
  } = useGraphHighlighting({
    edges,
    nodes,
    setEdges,
    setNodes,
    isGraphReady,
    vscode,
  });
  const [pendingHighlightNodeId, setPendingHighlightNodeId] = useState<
    string | null
  >(null);

  useEffect(() => {
    return () => {
      (window as any).__goflowGraphReady = false;
      (window as any).__goflowEffectiveGraphReady = false;
      (window as any).__goflowEdges = [];
    };
  }, []);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("goflow-hidden-nodes");
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch (error) {
      console.error("[FlowGraph] Failed to load hidden nodes", error);
      return new Set<string>();
    }
  });

  const [isTraceDrawerOpen, setIsTraceDrawerOpen] = useState(false);

  // Instrumentation / session tracking
  const renderStartRef = useRef<number>(0);
  const renderInvocationCountRef = useRef<number>(0);
  const queuedNodeHighlightCountsRef = useRef<Record<string, number>>({});
  const queuedEdgeHighlightCountRef = useRef<number>(0);
  const sessionCounterRef = useRef<number>(0);
  const currentSessionIdRef = useRef<number>(0);
  const prevGraphReadyRef = useRef<boolean>(false);
  const midReloadRef = useRef<boolean>(false);
  const prevNodesRef = useRef<FlowNode[]>([]);
  const prevEdgesRef = useRef<FlowEdge[]>([]);

  const debouncedNodes = useDebounce(nodes, 100);
  const lastContainerUpdateRef = useRef<string>("");

  // Logging bridge (declare BEFORE hook usage)
  const logToExtension = useCallback(
    (
      level: "DEBUG" | "INFO" | "WARN" | "ERROR",
      message: string,
      data?: any
    ) => {
      try {
        vscode.postMessage({
          command: "webviewLog",
          level,
          message,
          data:
            data !== undefined
              ? (() => {
                  try {
                    return JSON.parse(JSON.stringify(data));
                  } catch {
                    return String(data);
                  }
                })()
              : undefined,
        });
      } catch (e) {
        console.error("[FlowGraph] Failed to send log", e);
      }
    },
    [vscode]
  );

  // Execution trace hook (encapsulates static + dynamic trace logic)
  const {
    executionTrace,
    buildStaticExecutionTrace,
    clearTrace,
    handleCallEdge,
    recordUnresolvedCalls,
    recordRawLine,
    rootNodeId,
    rootCode,
    rootStartLine,
    setRootIfUnset,
  } = useExecutionTrace({ logFn: logToExtension });

  // Persist hidden node IDs
  useEffect(() => {
    try {
      localStorage.setItem(
        "goflow-hidden-nodes",
        JSON.stringify(Array.from(hiddenNodeIds))
      );
    } catch (error) {
      console.error("[FlowGraph] Failed to persist hidden nodes", error);
    }
  }, [hiddenNodeIds]);

  const handleToggleDrawer = useCallback(
    () => setIsDrawerOpen((prev) => !prev),
    []
  );

  const handleToggleNodeVisibility = useCallback((nodeId: string) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleShowAllNodes = useCallback(() => setHiddenNodeIds(new Set()), []);
  const handleHideAllNodes = useCallback(() => {
    setHiddenNodeIds(
      new Set(nodes.filter((n) => n.type === "functionNode").map((n) => n.id))
    );
  }, [nodes]);

  const toggleTraceDrawer = useCallback(
    () => setIsTraceDrawerOpen((p) => !p),
    []
  );

  useEffect(() => {
    if (prevGraphReadyRef.current !== isGraphReady) {
      logToExtension("DEBUG", "[FlowGraph] isGraphReady transition", {
        from: prevGraphReadyRef.current,
        to: isGraphReady,
        sessionId: currentSessionIdRef.current,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      });
      prevGraphReadyRef.current = isGraphReady;
    }
  }, [
    isGraphReady,
    nodes.length,
    edges.length,
    logToExtension,
    currentSessionIdRef.current,
  ]);

  useEffect(() => {
    if (
      isGraphReady &&
      pendingHighlightNodeId &&
      edges.length > 0 &&
      nodes.length > 0
    ) {
      handleNodeHighlight(pendingHighlightNodeId);
      setPendingHighlightNodeId(null);
    }

    if (isGraphReady && edges.length > 0 && nodes.length > 0) {
      const pendingLineClick = (window as any).__goflowPendingLineClick;
      if (pendingLineClick) {
        delete (window as any).__goflowPendingLineClick;
        try {
          vscode.postMessage({
            command: "resolveDefinitionAtLine",
            file: pendingLineClick.file,
            line: pendingLineClick.functionStartLine,
            relativeLine: pendingLineClick.lineNumber,
            lineContent: pendingLineClick.lineContent,
            nodeId: pendingLineClick.nodeId,
            shouldTracePath: false,
          });

          handleNodeHighlight(pendingLineClick.nodeId);

          Logger.info("[FlowGraph] Processed queued line click", {
            nodeId: pendingLineClick.nodeId,
            lineNumber: pendingLineClick.lineNumber,
          });
        } catch (e) {
          Logger.error("[FlowGraph] Failed to process queued line click", e);
        }
      }
    }
  }, [
    isGraphReady,
    pendingHighlightNodeId,
    edges.length,
    nodes.length,
    handleNodeHighlight,
    vscode,
  ]);

  useEffect(() => {
    if (isGraphReady && nodes.length > 0 && edges.length > 0) {
      (window as any).__goflowGraphReady = true;
      (window as any).__goflowEdges = edges;
      (window as any).__goflowEffectiveGraphReady = true;
      (window as any).__goflowNodes = nodes;

      const pendingNodeId = (window as any).__goflowPendingNodeHighlight;
      if (pendingNodeId) {
        handleNodeHighlight(pendingNodeId);
        delete (window as any).__goflowPendingNodeHighlight;
      }

      const pendingLineClick = (window as any).__goflowPendingLineClick;
      if (pendingLineClick) {
        delete (window as any).__goflowPendingLineClick;
        try {
          vscode.postMessage({
            command: "resolveDefinitionAtLine",
            file: pendingLineClick.file,
            line: pendingLineClick.functionStartLine,
            relativeLine: pendingLineClick.lineNumber,
            lineContent: pendingLineClick.lineContent,
            nodeId: pendingLineClick.nodeId,
            shouldTracePath: false,
          });
          handleNodeHighlight(pendingLineClick.nodeId);
          Logger.info("[FlowGraph] Processed queued line click", {
            nodeId: pendingLineClick.nodeId,
            lineNumber: pendingLineClick.lineNumber,
          });
        } catch (e) {
          Logger.error("[FlowGraph] Failed to process queued line click", e);
        }
      }
    } else {
      (window as any).__goflowGraphReady = false;
      (window as any).__goflowEffectiveGraphReady = false;
    }
  }, [isGraphReady, nodes, edges, handleNodeHighlight, vscode]);

  useEffect(() => {
    const unsubscribe = EdgeTracker.subscribe((edges) => {});
    return () => unsubscribe();
  }, []);

  const { renderGraph } = useRenderGraph({
    detectedFramework,
    setNodes,
    setEdges,
    setCurrentFileName,
    setDetectedFramework,
    setIsLoading,
    setError,
    setIsGraphReady,
    lineHighlightedEdges,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleClearNodeHighlight,
    nodes,
    vscode,
    buildStaticExecutionTrace,
    setRootIfUnset,
    logToExtension,
    queuedNodeHighlightCountsRef,
    queuedEdgeHighlightCountRef,
    midReloadRef,
    prevNodesRef,
    prevEdgesRef,
    currentSessionIdRef,
    renderStartRef,
    renderInvocationCountRef,
    isGraphReady,
  });

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (enableJumpToFile && node.type === "functionNode") {
        const data = node.data as FunctionNodeData;
        vscode.postMessage({
          command: "jumpToDefinition",
          file: data.file,
          line: data.line,
        });
      }
    },
    [vscode, enableJumpToFile]
  );

  const processQueuedInteractions = useCallback(() => {
    const pendingLineClick = (window as any).__goflowPendingLineClick;
    if (pendingLineClick) {
      Logger.info(`[FlowGraph] Processing queued line click`, {
        nodeId: pendingLineClick.nodeId,
        lineNumber: pendingLineClick.lineNumber,
        queueTime: Date.now() - pendingLineClick.timestamp,
      });

      vscode.postMessage({
        command: "resolveDefinitionAtLine",
        file: pendingLineClick.file,
        line: pendingLineClick.functionStartLine,
        relativeLine: pendingLineClick.lineNumber,
        lineContent: pendingLineClick.lineContent,
        nodeId: pendingLineClick.nodeId,
        shouldTracePath: false,
      });

      handleNodeHighlight(pendingLineClick.nodeId);

      delete (window as any).__goflowPendingLineClick;
    }

    const pendingNodeHighlight = (window as any).__goflowPendingNodeHighlight;
    if (pendingNodeHighlight) {
      handleNodeHighlight(pendingNodeHighlight);
      delete (window as any).__goflowPendingNodeHighlight;
    }
  }, [vscode, handleNodeHighlight]);

  useEffect(() => {
    const isEffectivelyReady =
      isGraphReady && nodes.length > 0 && edges.length > 0;

    if (isEffectivelyReady) {
      (window as any).__goflowGraphReady = true;
      (window as any).__goflowEdges = edges;
      (window as any).__goflowNodes = nodes;
      (window as any).__goflowEffectiveGraphReady = true;

      Logger.info(`[FlowGraph] Graph marked as ready`, {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        sessionId: currentSessionIdRef.current,
      });

      processQueuedInteractions();
    } else {
      (window as any).__goflowGraphReady = false;
      (window as any).__goflowEffectiveGraphReady = false;
    }
  }, [isGraphReady, nodes, edges, processQueuedInteractions]);

  const handleAutoSort = useCallback(async () => {
    if (!detectedFramework || isAutoSorting) return;
    setIsAutoSorting(true);
    try {
      const codeNodes = nodes.filter((n) => n.type === "functionNode");
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        await getLayoutedElements(codeNodes, edges, detectedFramework);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      buildStaticExecutionTrace(layoutedEdges, layoutedNodes);
    } catch (err) {
      console.error("[FlowGraph] Auto-sort failed:", err);
      setError(err instanceof Error ? err.message : "Auto-sort failed");
    } finally {
      setIsAutoSorting(false);
    }
  }, [
    nodes,
    edges,
    detectedFramework,
    isAutoSorting,
    setNodes,
    setEdges,
    getLayoutedElements,
    buildStaticExecutionTrace,
  ]);

  const handleExport = useCallback(
    () => vscode.postMessage({ command: "export" }),
    [vscode]
  );
  const handleFit = useCallback(
    () => vscode.postMessage({ command: "fitView" }),
    [vscode]
  );

  useEffect(() => {
    const codeNodes = debouncedNodes.filter((n) => n.type === "functionNode");
    const declarationNodes = debouncedNodes.filter(
      (n) => n.type === "declarationNode"
    );
    const currentContainers = debouncedNodes.filter(
      (n) => n.type === "fileGroupContainer"
    );
    if (codeNodes.length === 0 && declarationNodes.length === 0) {
      return;
    }
    const containerNodes = calculateFileGroupContainers(debouncedNodes);

    const currentSignature = JSON.stringify({
      codeNodeCount: codeNodes.length,
      containerCount: currentContainers.length,
      containerPositions: currentContainers.map((c: any) => ({
        id: c.id,
        x: c.position.x,
        y: c.position.y,
      })),
    });
    const newSignature = JSON.stringify({
      codeNodeCount: codeNodes.length,
      containerCount: containerNodes.length,
      containerPositions: containerNodes.map((c) => ({
        id: c.id,
        x: c.position.x,
        y: c.position.y,
      })),
    });

    if (
      currentSignature === newSignature &&
      currentSignature === lastContainerUpdateRef.current
    ) {
      return;
    }
    lastContainerUpdateRef.current = newSignature;

    setNodes((current) => {
      const withoutContainers = current.filter(
        (n) => n.type !== "fileGroupContainer"
      );
      return [...containerNodes, ...withoutContainers];
    });
  }, [debouncedNodes, calculateFileGroupContainers, setNodes]);

  useEffect(() => {
    vscode.postMessage({ command: "ready" });
  }, [vscode]);

  // Centralized window message bridge hook
  useMessageBridge({
    renderGraph,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleCallEdge,
    recordUnresolvedCalls,
    recordRawLine,
    isGraphReady,
    nodes,
    edges,
    setNodes,
    setEdges,
    setEnableJumpToFile,
    queuedEdgeHighlightCountRef,
    prevNodesRef,
    prevEdgesRef,
    midReloadRef,
    sessionCounterRef,
    currentSessionIdRef,
    renderInvocationCountRef,
    logToExtension,
  });

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {error ? (
        <div className="loading-container">
          <div className="loading-text" style={{ color: "#ef4444" }}>
            ❌ Error: {error}
            <div style={{ marginTop: "16px", fontSize: "14px" }}>
              Check the browser console (F12) for details
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="loading-container">
          <div className="loading-text">
            Loading GoFlow Canvas...
            <div style={{ marginTop: "8px", fontSize: "12px", opacity: 0.7 }}>
              If this takes too long, check the console
            </div>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes.filter((n) => {
            if (n.type === "functionNode") {
              return !hiddenNodeIds.has(n.id);
            }
            if (n.type === "declarationNode") {
              const declData = n.data as DeclarationNodeData;
              if (!declData.usedBy || declData.usedBy.length === 0)
                return false;
              const hasVisibleCaller = declData.usedBy.some(
                (callerId) => !hiddenNodeIds.has(callerId)
              );
              return hasVisibleCaller;
            }
            if (n.type === "fileGroupContainer") {
              const fileName = (n.data as any).fileName;
              const visibleNodesInContainer = nodes.filter((node) => {
                if (node.type === "functionNode") {
                  return (
                    (node.data as FunctionNodeData).file === fileName &&
                    !hiddenNodeIds.has(node.id)
                  );
                }
                if (node.type === "declarationNode") {
                  const declData = node.data as DeclarationNodeData;
                  const usedBy = declData.usedBy || [];
                  const hasVisibleCaller = usedBy.some(
                    (callerId) =>
                      nodes.find((fn) => fn.id === callerId) &&
                      !hiddenNodeIds.has(callerId)
                  );
                  return hasVisibleCaller;
                }
                return false;
              });
              return visibleNodesInContainer.length > 0;
            }
            return true;
          })}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
        >
          <Background />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              if (node.type === "fileGroupContainer")
                return "rgba(251,191,36,0.3)";
              if (node.type === "declarationNode") {
                const data = node.data as any;
                const colorMap: Record<string, string> = {
                  class: "#a855f7",
                  struct: "#06b6d4",
                  interface: "#f59e0b",
                  enum: "#84cc16",
                  type: "#6366f1",
                };
                return colorMap[data.type] || "#6b7280";
              }
              const data = node.data as any;
              return data.type === "function" ? "#4CAF50" : "#2196F3";
            }}
            nodeStrokeWidth={3}
            zoomable
            pannable
          />
          <FlowGraphToolbar
            enableJumpToFile={enableJumpToFile}
            setEnableJumpToFile={setEnableJumpToFile}
            detectedFramework={detectedFramework}
            isAutoSorting={isAutoSorting}
            handleAutoSort={handleAutoSort}
            handleFit={handleFit}
            handleExport={handleExport}
            isTraceDrawerOpen={isTraceDrawerOpen}
            toggleTraceDrawer={toggleTraceDrawer}
            handleToggleDrawer={handleToggleDrawer}
            vscode={vscode}
          />
          {detectedFramework && (
            <Panel position="bottom-left" className="flow-graph-info-panel">
              <div className="flow-graph-info-content">
                <div className="flow-graph-info-label">Detected:</div>
                <div className="flow-graph-info-value">
                  {detectedFramework.strategy.description}
                </div>
                <div className="flow-graph-info-hint">
                  {detectedFramework.rationale}
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      )}
      <NodeVisibilityDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        nodes={nodes
          .filter((n) => n.type === "functionNode")
          .map((n) => ({
            id: n.id,
            label: (n.data as FunctionNodeData).label,
            type: (n.data as FunctionNodeData).type,
            file: (n.data as FunctionNodeData).file,
            line: (n.data as FunctionNodeData).line,
          }))}
        hiddenNodeIds={hiddenNodeIds}
        onToggleNode={handleToggleNodeVisibility}
        onShowAll={handleShowAllNodes}
        onHideAll={handleHideAllNodes}
      />
      <ExecutionTraceDrawer
        isOpen={isTraceDrawerOpen}
        onClose={() => setIsTraceDrawerOpen(false)}
        trace={executionTrace}
        rootNodeId={rootNodeId}
        rootCode={rootCode}
        rootStartLine={rootStartLine}
        onClear={() => {
          clearTrace();
        }}
        onJumpToNode={(nodeId) => {
          handleNodeHighlight(nodeId);
          try {
            const target = nodes.find((n) => n.id === nodeId);
            if (target && reactFlowInstance) {
              const w =
                (target.style?.width as number) ||
                (target.width as number) ||
                600;
              const h =
                (target.style?.height as number) ||
                (target.height as number) ||
                300;
              reactFlowInstance.setCenter(
                target.position.x + w / 2,
                target.position.y + h / 2,
                {
                  zoom: 1,
                  duration: 400,
                }
              );
            }
          } catch (e) {
            logToExtension(
              "WARN",
              "[ExecutionFlow] Failed to center on node",
              e
            );
          }
        }}
      />
    </div>
  );
};

export default FlowGraph;
