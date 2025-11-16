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
import { GraphData } from "../../models/Node";
import { detectFramework, FrameworkConfig } from "../configs/layoutStrategies";
import {
  getLayoutedElements,
  calculateFileGroupContainers,
} from "../utils/graphLayout";
import { EdgeTracker } from "../utils/EdgeTracker";
import { Logger } from "../../utils/webviewLogger";
import NodeVisibilityDrawer from "./drawers/NodeVisibilityDrawer";
import DeclarationNode from "./nodes/DeclarationNode";
import CallOrderEdge from "./edges/CallOrderEdge";
import ExecutionTraceDrawer from "./drawers/ExecutionTraceDrawer";
import useDebounce from "../hooks/useDebounce";
import convertToFlowDataExternal from "../utils/flowConversion";
import useExecutionTrace from "../hooks/useExecutionTrace";

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

  const [lineHighlightedEdges, setLineHighlightedEdges] = useState<Set<string>>(
    new Set()
  );
  const [nodeHighlightedEdges, setNodeHighlightedEdges] = useState<Set<string>>(
    new Set()
  );
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(
    null
  );
  const [pendingHighlightNodeId, setPendingHighlightNodeId] = useState<
    string | null
  >(null);
  const [isGraphReady, setIsGraphReady] = useState(false);

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

  const getOriginalDashArray = useCallback(
    (edge: FlowEdge): string | undefined => {
      if (edge.style?.strokeDasharray)
        return edge.style.strokeDasharray as string;
      if (edge.data?.dashed === true) return "8 4";
      if (edge.data?.hasReturnValue === false) return "8 4";
      return undefined;
    },
    []
  );

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

  const handleHighlightEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edgeKey = `${sourceNodeId}->${targetNodeId}`;
      setLineHighlightedEdges(new Set([edgeKey]));
      setEdges((current) =>
        current.map((edge) => {
          const currentKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = currentKey === edgeKey;
          const isNodeHighlighted = nodeHighlightedEdges.has(currentKey);
          const originalDashArray = getOriginalDashArray(edge);

          if (isLineHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FFC107",
                strokeWidth: 4,
                strokeDasharray: originalDashArray,
              },
              zIndex: 1000,
            };
          }
          if (isNodeHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FF6B6B",
                strokeWidth: 3,
                strokeDasharray: originalDashArray,
              },
              zIndex: 999,
            };
          }
          return {
            ...edge,
            animated: false,
            style: {
              ...edge.style,
              stroke: "#666",
              strokeWidth: 2,
              strokeDasharray: originalDashArray,
            },
            zIndex: 1,
          };
        })
      );
    },
    [nodeHighlightedEdges, getOriginalDashArray, setEdges]
  );

  const handleClearHighlight = useCallback(() => {
    setLineHighlightedEdges(new Set());
    setEdges((current) =>
      current.map((edge) => {
        const currentKey = `${edge.source}->${edge.target}`;
        const isNodeHighlighted = nodeHighlightedEdges.has(currentKey);
        const originalDashArray = getOriginalDashArray(edge);
        if (isNodeHighlighted) {
          return {
            ...edge,
            animated: true,
            style: {
              ...edge.style,
              stroke: "#FF6B6B",
              strokeWidth: 3,
              strokeDasharray: originalDashArray,
            },
            zIndex: 999,
          };
        }
        return {
          ...edge,
          animated: false,
          style: {
            ...edge.style,
            stroke: "#666",
            strokeWidth: 2,
            strokeDasharray: originalDashArray,
          },
          zIndex: 1,
        };
      })
    );
  }, [nodeHighlightedEdges, getOriginalDashArray, setEdges]);

  const handleNodeHighlight = useCallback(
    (targetNodeId: string) => {
      if (!isGraphReady || edges.length === 0 || nodes.length === 0) {
        const globalSession = (window as any).__goflowSessionId;
        const canUseBuffered =
          midReloadRef.current &&
          (window as any).__goflowPrevSessionBuffered &&
          Array.isArray(prevNodesRef.current) &&
          prevNodesRef.current.length > 0 &&
          Array.isArray(prevEdgesRef.current) &&
          prevEdgesRef.current.length > 0;

        if (canUseBuffered) {
          Logger.debug(
            `[FlowGraph] Mid-reload highlight using buffered previous graph for ${targetNodeId}. bufferedNodes=${prevNodesRef.current.length} bufferedEdges=${prevEdgesRef.current.length} session=${currentSessionIdRef.current} globalSession=${globalSession}`
          );

          const bufferedIncoming = prevEdgesRef.current.filter(
            (e) => e.target === targetNodeId
          );
          const edgeKeys = new Set(
            bufferedIncoming.map((e) => `${e.source}->${e.target}`)
          );
          setNodeHighlightedEdges(edgeKeys);
          setHighlightedNodeId(targetNodeId);

          setEdges((current) =>
            current.map((edge) => {
              const currentKey = `${edge.source}->${edge.target}`;
              const isLineHighlighted = lineHighlightedEdges.has(currentKey);
              const isNodeHighlighted = edgeKeys.has(currentKey);
              const originalDashArray = getOriginalDashArray(edge);

              if (isLineHighlighted) {
                return {
                  ...edge,
                  animated: true,
                  style: {
                    ...edge.style,
                    stroke: "#FFC107",
                    strokeWidth: 4,
                    strokeDasharray: originalDashArray,
                  },
                  zIndex: 1000,
                };
              }
              if (isNodeHighlighted) {
                return {
                  ...edge,
                  animated: true,
                  style: {
                    ...edge.style,
                    stroke: "#FF6B6B",
                    strokeWidth: 3,
                    strokeDasharray: originalDashArray,
                  },
                  zIndex: 999,
                };
              }
              return {
                ...edge,
                animated: false,
                style: {
                  ...edge.style,
                  stroke: "#666",
                  strokeWidth: 2,
                  strokeDasharray: originalDashArray,
                },
                zIndex: 1,
              };
            })
          );

          setNodes((currentNodes) =>
            currentNodes.map((node) => {
              const isParent = bufferedIncoming.some(
                (e) => e.source === node.id
              );
              const isTarget = node.id === targetNodeId;
              if (isParent || isTarget) {
                return {
                  ...node,
                  style: {
                    ...node.style,
                    border: isTarget
                      ? "3px solid #FF6B6B"
                      : "2px solid #FFA500",
                    boxShadow: isTarget
                      ? "0 0 10px rgba(255,107,107,0.5)"
                      : "0 0 8px rgba(255,165,0,0.4)",
                  },
                };
              }
              return {
                ...node,
                style: {
                  ...node.style,
                  border: undefined,
                  boxShadow: undefined,
                },
              };
            })
          );
          return;
        }

        queuedNodeHighlightCountsRef.current[targetNodeId] =
          (queuedNodeHighlightCountsRef.current[targetNodeId] || 0) + 1;
        const repeatCount = queuedNodeHighlightCountsRef.current[targetNodeId];
        if (repeatCount === 1) {
          Logger.debug(
            `[FlowGraph] Graph not ready. Queued highlight for ${targetNodeId}. nodes=${nodes.length} edges=${edges.length} ready=${isGraphReady} session=${currentSessionIdRef.current} globalSession=${globalSession}`
          );
        } else if (repeatCount % 5 === 0) {
          Logger.debug(
            `[FlowGraph] Graph still not ready after ${repeatCount} attempts for ${targetNodeId}. nodes=${nodes.length} edges=${edges.length} ready=${isGraphReady} session=${currentSessionIdRef.current} globalSession=${globalSession}`
          );
        }
        setPendingHighlightNodeId(targetNodeId);
        return;
      }

      const incomingEdges = edges.filter((e) => e.target === targetNodeId);
      const edgeKeys = new Set(
        incomingEdges.map((e) => `${e.source}->${e.target}`)
      );
      setNodeHighlightedEdges(edgeKeys);
      setHighlightedNodeId(targetNodeId);

      const allNodesData = nodes
        .filter((n) => n.type === "functionNode")
        .map((n) => ({
          id: n.id,
          label: (n.data as FunctionNodeData).label,
          type: (n.data as FunctionNodeData).type,
          file: (n.data as FunctionNodeData).file,
          line: (n.data as FunctionNodeData).line,
        }));
      const traced = EdgeTracker.tracePathsToRoot(targetNodeId, allNodesData);
      if (traced) {
        const report = EdgeTracker.getFormattedPathReport(traced);
        vscode.postMessage({
          command: "showPathTrace",
          tracedPath: traced,
          formattedReport: report,
        });
      }

      setEdges((current) =>
        current.map((edge) => {
          const currentKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = lineHighlightedEdges.has(currentKey);
          const isNodeHighlighted = edgeKeys.has(currentKey);
          const originalDashArray = getOriginalDashArray(edge);

          if (isLineHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FFC107",
                strokeWidth: 4,
                strokeDasharray: originalDashArray,
              },
              zIndex: 1000,
            };
          }
          if (isNodeHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FF6B6B",
                strokeWidth: 3,
                strokeDasharray: originalDashArray,
              },
              zIndex: 999,
            };
          }
          return {
            ...edge,
            animated: false,
            style: {
              ...edge.style,
              stroke: "#666",
              strokeWidth: 2,
              strokeDasharray: originalDashArray,
            },
            zIndex: 1,
          };
        })
      );

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const isParent = incomingEdges.some((e) => e.source === node.id);
          const isTarget = node.id === targetNodeId;
          if (isParent || isTarget) {
            return {
              ...node,
              style: {
                ...node.style,
                border: isTarget ? "3px solid #FF6B6B" : "2px solid #FFA500",
                boxShadow: isTarget
                  ? "0 0 10px rgba(255,107,107,0.5)"
                  : "0 0 8px rgba(255,165,0,0.4)",
              },
            };
          }
          return {
            ...node,
            style: {
              ...node.style,
              border: undefined,
              boxShadow: undefined,
            },
          };
        })
      );
    },
    [
      isGraphReady,
      edges,
      nodes,
      lineHighlightedEdges,
      getOriginalDashArray,
      setEdges,
      setNodes,
      vscode,
    ]
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

  const handleClearNodeHighlight = useCallback(() => {
    setNodeHighlightedEdges(new Set());
    setHighlightedNodeId(null);
    setEdges((current) =>
      current.map((edge) => {
        const currentKey = `${edge.source}->${edge.target}`;
        const isLineHighlighted = lineHighlightedEdges.has(currentKey);
        const originalDashArray = getOriginalDashArray(edge);
        if (isLineHighlighted) {
          return {
            ...edge,
            animated: true,
            style: {
              ...edge.style,
              stroke: "#FFC107",
              strokeWidth: 4,
              strokeDasharray: originalDashArray,
            },
            zIndex: 1000,
          };
        }
        return {
          ...edge,
          animated: false,
          style: {
            ...edge.style,
            stroke: "#666",
            strokeWidth: 2,
            strokeDasharray: originalDashArray,
          },
          zIndex: 1,
        };
      })
    );
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          border: undefined,
          boxShadow: undefined,
        },
      }))
    );
  }, [lineHighlightedEdges, getOriginalDashArray, setEdges, setNodes]);

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

  const renderGraph = useCallback(
    async (data: GraphData, fileName?: string) => {
      try {
        (window as any).__goflowPendingNodeHighlight = null;
        (window as any).__goflowPendingLineClick = null;
        (window as any).__goflowPendingEdgeHighlights = [];

        renderStartRef.current = performance.now();
        renderInvocationCountRef.current += 1;

        Logger.info(`[FlowGraph] 🚀 START renderGraph`, {
          fileName,
          rawNodeCount: data.nodes.length,
          rawEdgeCount: data.edges.length,
          invocation: renderInvocationCountRef.current,
          sessionId: currentSessionIdRef.current,
          previousReadyState: isGraphReady,
          previousNodeCount: nodes.length,
          previousEdgeCount: edges.length,
        });
        logToExtension("DEBUG", "[FlowGraph] renderGraph start", {
          fileName,
          nodeCount: data.nodes.length,
          edgeCount: data.edges.length,
          isGraphReadyBefore: isGraphReady,
          invocation: renderInvocationCountRef.current,
          sessionId: currentSessionIdRef.current,
        });
        if (fileName) {
          setCurrentFileName(fileName);
          const firstNode = data.nodes[0];
          const fileContent = firstNode?.code || "";
          const detected = detectFramework(fileName, fileContent);
          setDetectedFramework(detected);
          logToExtension("DEBUG", "[FlowGraph] Framework detection", {
            detected: detected?.strategy.description,
          });
        }

        const { nodes: flowNodes, edges: flowEdges } =
          convertToFlowDataExternal(data, {
            vscode,
            detectedDirection: detectedFramework?.strategy.direction,
            lineHighlightedEdges,
            onHighlightEdge: handleHighlightEdge,
            onClearHighlight: handleClearHighlight,
            onNodeHighlight: handleNodeHighlight,
            onClearNodeHighlight: handleClearNodeHighlight,
          });
        const { nodes: layoutedNodes, edges: layoutedEdges } =
          await getLayoutedElements(flowNodes, flowEdges, detectedFramework);

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        logToExtension("DEBUG", "[FlowGraph] Layout applied", {
          layoutNodeCount: layoutedNodes.length,
          layoutEdgeCount: layoutedEdges.length,
          invocation: renderInvocationCountRef.current,
        });

        setRootIfUnset(layoutedNodes);

        setIsLoading(false);
        setError(null);
        setIsGraphReady(true);
        logToExtension("INFO", "[FlowGraph] Graph ready", {
          invocation: renderInvocationCountRef.current,
          sessionId: currentSessionIdRef.current,
          queuedNodeHighlightAttempts: Object.entries(
            queuedNodeHighlightCountsRef.current
          ).map(([nodeId, attempts]) => ({ nodeId, attempts })),
          queuedEdgeEventsTotal: queuedEdgeHighlightCountRef.current,
          bufferedPrevGraph: {
            hadBuffer: midReloadRef.current,
            prevNodeCount: prevNodesRef.current.length,
            prevEdgeCount: prevEdgesRef.current.length,
          },
        });
        (window as any).__goflowGraphReady = true;
        (window as any).__goflowSessionId = currentSessionIdRef.current;
        (window as any).__goflowEffectiveGraphReady = true;
        (window as any).__goflowEdges = layoutedEdges;
        window.dispatchEvent(
          new CustomEvent("goflow-effective-ready", {
            detail: {
              sessionId: currentSessionIdRef.current,
              nodeCount: layoutedNodes.length,
              edgeCount: layoutedEdges.length,
            },
          })
        );
        midReloadRef.current = false;
        prevNodesRef.current = [];
        prevEdgesRef.current = [];
        try {
          const pendingNodeId = (window as any).__goflowPendingNodeHighlight;
          if (pendingNodeId) {
            delete (window as any).__goflowPendingNodeHighlight;
            handleNodeHighlight(pendingNodeId);
          }
          const pendingEdges =
            (window as any).__goflowPendingEdgeHighlights || [];
          if (Array.isArray(pendingEdges) && pendingEdges.length > 0) {
            pendingEdges.forEach((h: any) =>
              handleHighlightEdge(h.source, h.target)
            );
            delete (window as any).__goflowPendingEdgeHighlights;
          }
        } catch {}

        buildStaticExecutionTrace(layoutedEdges, layoutedNodes);
        const elapsed = performance.now() - renderStartRef.current;
        logToExtension("INFO", "[FlowGraph] Graph layout completed", {
          layoutNodeCount: layoutedNodes.length,
          layoutEdgeCount: layoutedEdges.length,
          elapsedMs: Math.round(elapsed),
          pendingHighlightNodeId:
            (window as any).__goflowPendingNodeHighlight || null,
          pendingEdgeQueueSize: Array.isArray(
            (window as any).__goflowPendingEdgeHighlights
          )
            ? (window as any).__goflowPendingEdgeHighlights.length
            : 0,
        });
      } catch (err) {
        console.error("[FlowGraph] Failed to render graph:", err);
        logToExtension("ERROR", "[FlowGraph] renderGraph failure", {
          error: err instanceof Error ? err.message : String(err),
        });
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
        setIsGraphReady(false);
      }
    },
    [
      setNodes,
      setEdges,
      detectedFramework,
      getLayoutedElements,
      buildStaticExecutionTrace,
      lineHighlightedEdges,
      handleHighlightEdge,
      handleClearHighlight,
      handleNodeHighlight,
      handleClearNodeHighlight,
      isGraphReady,
      nodes,
      logToExtension,
      setRootIfUnset,
    ]
  );

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

  useEffect(() => {
    const messageHandler = async (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message.command !== "string") {
        return;
      }
      try {
        switch (message.command) {
          case "setNodeDraggable":
            setNodes((curr) =>
              curr.map((n) =>
                n.id === message.nodeId
                  ? { ...n, draggable: !!message.draggable }
                  : n
              )
            );
            break;
          case "renderGraph":
            Logger.info(
              `[FlowGraph] renderGraph command received (prevReady=${isGraphReady}) nodesInPayload=${
                message.data?.nodes?.length ?? 0
              } edgesInPayload=${message.data?.edges?.length ?? 0} invocation=${
                renderInvocationCountRef.current + 1
              } nextSession=${sessionCounterRef.current + 1}`
            );
            sessionCounterRef.current += 1;
            currentSessionIdRef.current = sessionCounterRef.current;
            (window as any).__goflowSessionId = currentSessionIdRef.current;
            logToExtension("DEBUG", "[FlowGraph] renderGraph init", {
              sessionId: currentSessionIdRef.current,
              invocation: renderInvocationCountRef.current + 1,
              prevReadyState: isGraphReady,
              timestamp: Date.now(),
              prevNodeCount: nodes.length,
              prevEdgeCount: edges.length,
            });
            (window as any).__goflowGraphReady = false;
            (window as any).__goflowSessionId = currentSessionIdRef.current;
            (window as any).__goflowEffectiveGraphReady = false;
            (window as any).__goflowEdges = [];
            (window as any).__goflowEdgesClearedAt = Date.now();
            try {
              prevNodesRef.current = nodes;
              prevEdgesRef.current = edges;
              midReloadRef.current = true;
              (window as any).__goflowPrevSessionBuffered = {
                nodeCount: prevNodesRef.current.length,
                edgeCount: prevEdgesRef.current.length,
                sessionId: currentSessionIdRef.current - 1,
              };
            } catch {}
            setIsGraphReady(false);
            if (message.config) {
              setEnableJumpToFile(message.config.enableJumpToFile);
            }
            if (message.theme && typeof message.theme.isDark === "boolean") {
              if (!(window as any).__monacoAppliedTheme) {
                (window as any).__goflowTheme = message.theme;
              } else {
                Logger.debug(
                  "[FlowGraph] Ignored theme payload (theme already locked)"
                );
              }
            } else if (message.theme) {
              Logger.debug(
                "[FlowGraph] Ignored invalid theme payload (missing isDark boolean)"
              );
            }
            await renderGraph(message.data, message.data?.fileName);
            break;
          case "refresh":
            if (message.data) {
              await renderGraph(message.data, message.data?.fileName);
            }
            break;
          case "highlightEdge":
            {
              const globalReady = !!(window as any).__goflowGraphReady;
              const globalEdges = (window as any).__goflowEdges;
              const globalEdgeCount = Array.isArray(globalEdges)
                ? globalEdges.length
                : 0;
              const effectiveReady =
                isGraphReady && nodes.length > 0 && edges.length > 0;
              const fallbackReady =
                globalReady && globalEdgeCount > 0 && nodes.length === 0;

              if (!effectiveReady && !fallbackReady) {
                queuedEdgeHighlightCountRef.current += 1;
                const edgeQueueLen =
                  ((window as any).__goflowPendingEdgeHighlights || []).length +
                  1;
                if (
                  queuedEdgeHighlightCountRef.current === 1 ||
                  queuedEdgeHighlightCountRef.current % 5 === 0
                ) {
                  Logger.debug(
                    `[FlowGraph] Graph not ready. Queued edge highlight ${message.sourceNodeId}->${message.targetNodeId}`,
                    {
                      totalQueuedEdgeEvents:
                        queuedEdgeHighlightCountRef.current,
                      queueLen: edgeQueueLen,
                      reactReady: isGraphReady,
                      reactNodeCount: nodes.length,
                      reactEdgeCount: edges.length,
                      globalReady,
                      globalEdgeCount,
                    }
                  );
                }
                const pending =
                  (window as any).__goflowPendingEdgeHighlights || [];
                pending.push({
                  source: message.sourceNodeId,
                  target: message.targetNodeId,
                });
                (window as any).__goflowPendingEdgeHighlights = pending;
                return;
              }

              if (
                fallbackReady &&
                prevNodesRef.current.length > 0 &&
                prevEdgesRef.current.length > 0
              ) {
                Logger.info(
                  `[FlowGraph] Using buffered graph for edge highlight (React state not synced yet)`,
                  {
                    bufferedNodeCount: prevNodesRef.current.length,
                    bufferedEdgeCount: prevEdgesRef.current.length,
                    sourceNodeId: message.sourceNodeId,
                    targetNodeId: message.targetNodeId,
                  }
                );
                setNodes(prevNodesRef.current);
                setEdges(prevEdgesRef.current);
                setIsGraphReady(true);
              }

              handleHighlightEdge(message.sourceNodeId, message.targetNodeId);

              // Delegate dynamic execution trace update to hook
              handleCallEdge(
                message.sourceNodeId,
                message.targetNodeId,
                typeof message.sourceCallLine === "number"
                  ? message.sourceCallLine
                  : undefined
              );
            }
            break;
          case "clearHighlight":
            handleClearHighlight();
            break;
          case "recordTraceLine":
            if (
              Array.isArray(message.functionCalls) &&
              typeof message.relativeLine === "number"
            ) {
              const sourceFnNode = nodes.find(
                (n) =>
                  n.id === message.sourceNodeId && n.type === "functionNode"
              );
              const sourceCode =
                sourceFnNode && (sourceFnNode.data as FunctionNodeData).code
                  ? (sourceFnNode.data as FunctionNodeData).code
                  : undefined;
              const sourceLines = sourceCode ? sourceCode.split("\n") : [];
              const srcLineContent =
                sourceLines[message.relativeLine - 1] ||
                message.lineContent ||
                "";
              recordUnresolvedCalls(
                message.sourceNodeId,
                message.relativeLine,
                message.functionCalls,
                srcLineContent
              );
            }
            break;
          case "recordTraceLineRaw":
            if (typeof message.relativeLine === "number") {
              const sourceFnNode = nodes.find(
                (n) =>
                  n.id === message.sourceNodeId && n.type === "functionNode"
              );
              const sourceCode =
                sourceFnNode && (sourceFnNode.data as FunctionNodeData).code
                  ? (sourceFnNode.data as FunctionNodeData).code
                  : undefined;
              const sourceLines = sourceCode ? sourceCode.split("\n") : [];
              const srcLineContent =
                sourceLines[message.relativeLine - 1] ||
                message.lineContent ||
                "";
              recordRawLine(
                message.sourceNodeId,
                message.relativeLine,
                srcLineContent
              );
            }
            break;
          case "tracePathForLineClick":
            handleNodeHighlight(message.targetNodeId);
            break;
          default:
            Logger.debug(
              `[FlowGraph] Ignored unknown command: ${message.command}`
            );
        }
      } catch (err) {
        console.error("[FlowGraph] Error handling message:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
      }
    };
    window.addEventListener("message", messageHandler);
    return () => window.removeEventListener("message", messageHandler);
  }, [
    renderGraph,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    isGraphReady,
    nodes,
    edges,
    handleCallEdge,
    recordUnresolvedCalls,
    recordRawLine,
    setNodes,
    setEdges,
  ]);

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
          <Panel
            position="top-right"
            className="flow-graph-panel flow-graph-panel-modern"
          >
            <div className="flow-graph-button-group">
              <button
                onClick={handleToggleDrawer}
                className="fg-btn"
                title="Node Visibility"
              >
                👁️
              </button>
              <button
                onClick={() => setEnableJumpToFile(!enableJumpToFile)}
                className={`fg-btn ${
                  enableJumpToFile ? "fg-btn-active" : "fg-btn-inactive"
                }`}
                title={
                  enableJumpToFile ? "Jump to file: ON" : "Jump to file: OFF"
                }
              >
                {enableJumpToFile ? "🔗" : "⛔"}
              </button>
              <button
                onClick={handleAutoSort}
                className="fg-btn"
                title={
                  detectedFramework
                    ? `Auto Sort: ${detectedFramework.strategy.description}`
                    : "Auto Sort Layout"
                }
                disabled={!detectedFramework || isAutoSorting}
              >
                {isAutoSorting ? "⏳" : "🔄"}
              </button>
              <button onClick={handleFit} className="fg-btn" title="Fit view">
                ⊡
              </button>
              <button
                onClick={handleExport}
                className="fg-btn"
                title="Export diagram"
              >
                💾
              </button>
              <button
                onClick={() => {
                  const stats = EdgeTracker.getStats();
                  EdgeTracker.logCurrentState();
                  vscode.postMessage({
                    command: "showEdgeStats",
                    stats,
                    edges: EdgeTracker.getAllEdges(),
                    formattedReport: EdgeTracker.getEdgeListFormatted(),
                  });
                }}
                className="fg-btn"
                title="Edge statistics"
              >
                📊
              </button>
              <button
                onClick={() => setIsTraceDrawerOpen((p) => !p)}
                className={`fg-btn ${isTraceDrawerOpen ? "fg-btn-active" : ""}`}
                title="Execution Flow List"
              >
                🗒️
              </button>
            </div>
          </Panel>
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
