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
import { applyLayout } from "../utils/layoutEngines";
import { EdgeTracker, EdgeConnection } from "../utils/EdgeTracker";
import { Logger } from "../../utils/webviewLogger";
import NodeVisibilityDrawer from "./drawers/NodeVisibilityDrawer";
import DeclarationNode from "./nodes/DeclarationNode";
import CallOrderEdge from "./edges/CallOrderEdge";
import ExecutionTraceDrawer, {
  ExecutionTraceEntry,
} from "./drawers/ExecutionTraceDrawer";

interface FunctionNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  endLine?: number;
  code: string;
  vscode?: any;
  onHighlightEdge?: (sourceNodeId: string, targetNodeId: string) => void;
  onClearHighlight?: () => void;
  onNodeHighlight?: (nodeId: string) => void;
  onClearNodeHighlight?: () => void;
  allNodes?: any[];
  lineHighlightedEdges?: Set<string>;
}

interface DeclarationNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "class" | "struct" | "interface" | "enum" | "type";
  file: string;
  line: number;
  code: string;
  language?: string;
  usedBy?: any[];
}

type FlowNode = Node<FunctionNodeData> | Node<DeclarationNodeData>;
type FlowEdge = Edge;

interface FlowGraphProps {
  vscode: any;
}

const nodeTypes = {
  functionNode: FunctionNode as React.ComponentType<any>,
  declarationNode: DeclarationNode as React.ComponentType<any>,
  fileGroupContainer: FileGroupContainer as React.ComponentType<any>,
};

const edgeTypes = {
  callOrderEdge: CallOrderEdge as React.ComponentType<any>,
};

// Debounce hook
const useDebounce = (value: any, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
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

  // NEW: ExecutionTraceDrawer now shows static call order list derived from edges
  const [isTraceDrawerOpen, setIsTraceDrawerOpen] = useState(false);
  const [executionTrace, setExecutionTrace] = useState<ExecutionTraceEntry[]>(
    []
  );
  // Track last CALL entry per caller to synthesize RETURN segment before next call
  const lastCallEntryRef = useRef<Map<string, ExecutionTraceEntry>>(new Map());
  // Root function snapshot references (first function node rendered)
  const rootNodeIdRef = useRef<string | undefined>(undefined);
  const rootCodeRef = useRef<string | undefined>(undefined);
  const rootStartLineRef = useRef<number | undefined>(undefined);

  // Auto-save hidden nodes
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

  const debouncedNodes = useDebounce(nodes, 100);
  const lastContainerUpdateRef = useRef<string>("");

  // Structured logging bridge
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
        Logger.warn(
          `[FlowGraph] Graph not ready. Pending highlight for ${targetNodeId}`
        );
        setPendingHighlightNodeId(targetNodeId);
        return;
      }

      const incomingEdges = edges.filter((e) => e.target === targetNodeId);
      const edgeKeys = new Set(
        incomingEdges.map((e) => `${e.source}->${e.target}`)
      );
      setNodeHighlightedEdges(edgeKeys);
      setHighlightedNodeId(targetNodeId);

      // Trace paths to root (for overlay or stats)
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

  // Process pending highlight
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
  }, [
    isGraphReady,
    pendingHighlightNodeId,
    edges.length,
    nodes.length,
    handleNodeHighlight,
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

  // File group container calculation
  const calculateFileGroupContainers = useCallback(
    (nodes: FlowNode[]): FlowNode[] => {
      const containerNodes: FlowNode[] = [];
      const nodesByFile = new Map<string, FlowNode[]>();

      nodes.forEach((node) => {
        let file: string;
        if (node.type === "functionNode") {
          file = (node.data as FunctionNodeData).file;
        } else if (node.type === "declarationNode") {
          const declData = node.data as DeclarationNodeData;
          const usedBy = declData.usedBy || [];
          const callerNode = nodes.find(
            (n) => n.type === "functionNode" && usedBy.includes(n.id)
          );
          file = callerNode
            ? (callerNode.data as FunctionNodeData).file
            : (declData.file as string);
        } else {
          return;
        }
        if (!nodesByFile.has(file)) nodesByFile.set(file, []);
        nodesByFile.get(file)!.push(node);
      });

      nodesByFile.forEach((fileNodes, file) => {
        if (fileNodes.length === 0) return;
        const padding = 60;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        fileNodes.forEach((node) => {
          let nodeWidth, nodeHeight;
          if (node.type === "functionNode") {
            nodeWidth = (node.style?.width as number) || 650;
            nodeHeight = (node.style?.height as number) || 320;
          } else if (node.type === "declarationNode") {
            nodeWidth = (node.style?.width as number) || 350;
            nodeHeight = (node.style?.height as number) || 200;
          } else {
            nodeWidth = 650;
            nodeHeight = 320;
          }
          const x = node.position.x;
          const y = node.position.y;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + nodeWidth);
          maxY = Math.max(maxY, y + nodeHeight);
        });

        const containerWidth = maxX - minX + padding * 2;
        const containerHeight = maxY - minY + padding * 2;
        const functionNodeCount = fileNodes.filter(
          (n) => n.type === "functionNode"
        ).length;
        const declarationNodeCount = fileNodes.filter(
          (n) => n.type === "declarationNode"
        ).length;

        containerNodes.push({
          id: `container-${file}`,
          type: "fileGroupContainer" as const,
          position: { x: minX - padding, y: minY - padding },
          data: {
            fileName: file,
            nodeCount: fileNodes.length,
            functionNodeCount,
            declarationNodeCount,
            width: containerWidth,
            height: containerHeight,
          } as any,
          draggable: false,
          selectable: false,
          zIndex: 0,
          style: { width: containerWidth, height: containerHeight },
        } as FlowNode);
      });

      return containerNodes;
    },
    []
  );

  const getLayoutedElements = useCallback(
    async (
      nodes: FlowNode[],
      edges: FlowEdge[],
      framework?: FrameworkConfig | null
    ): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> => {
      const strategy = framework?.strategy || {
        algorithm: "dagre" as const,
        direction: "TB" as const,
        edgeType: "default" as const,
        ranksep: 150,
        nodesep: 100,
        description: "Default Layout",
      };
      const layouted = await applyLayout(nodes, edges, strategy);
      const flowNodes = layouted.nodes as FlowNode[];
      const containers = calculateFileGroupContainers(flowNodes);
      return { nodes: [...containers, ...flowNodes], edges: layouted.edges };
    },
    [calculateFileGroupContainers]
  );

  const convertToFlowData = useCallback(
    (data: GraphData): { nodes: FlowNode[]; edges: FlowEdge[] } => {
      const flowNodes: FlowNode[] = [];
      const edgeConnections: EdgeConnection[] = [];

      data.nodes.forEach((node) => {
        if (node.type === "function" || node.type === "method") {
          flowNodes.push({
            id: node.id,
            type: "functionNode" as const,
            position: { x: 0, y: 0 },
            draggable: false, // mặc định KHÔNG kéo, chỉ bật khi move-mode
            data: {
              id: node.id,
              label: node.label,
              type: node.type as "function" | "method",
              file: node.file,
              line: node.line,
              endLine: node.endLine,
              code: node.code || "",
              vscode: vscode,
              onHighlightEdge: handleHighlightEdge,
              onClearHighlight: handleClearHighlight,
              onNodeHighlight: handleNodeHighlight,
              onClearNodeHighlight: handleClearNodeHighlight,
              allNodes: data.nodes,
              lineHighlightedEdges: lineHighlightedEdges,
            } as FunctionNodeData,
            style: {
              width: 650,
              height: 320,
              minHeight: 206,
            },
            width: 650,
            height: 320,
            zIndex: 10,
          } as FlowNode);
        } else if (
          node.type === "class" ||
          node.type === "struct" ||
          node.type === "interface" ||
          node.type === "enum" ||
          node.type === "type"
        ) {
          flowNodes.push({
            id: node.id,
            type: "declarationNode" as const,
            position: { x: 0, y: 0 },
            data: {
              id: node.id,
              label: node.label,
              type: node.type,
              file: node.file,
              line: node.line,
              code: node.code || "",
              language: (node as any).language,
              usedBy: (node as any).usedBy || [],
            },
            style: { width: 350, height: 200 },
            width: 350,
            height: 200,
            zIndex: 5,
          } as FlowNode);
        }
      });

      const flowEdges: FlowEdge[] = data.edges
        .filter((edge) => {
          const sourceExists = flowNodes.some((n) => n.id === edge.source);
          const targetExists = flowNodes.some((n) => n.id === edge.target);
          if (edge.type === "uses") return sourceExists && targetExists;
          return sourceExists && targetExists;
        })
        .map((edge, index) => {
          const sourceNode = data.nodes.find((n) => n.id === edge.source);
          const targetNode = data.nodes.find((n) => n.id === edge.target);

          const hasReturnValue = edge.hasReturnValue ?? true;
          const callOrder = (edge as any).callOrder;
          const returnOrder = (edge as any).returnOrder;

          const edgeStyle = hasReturnValue
            ? {
                stroke: "#666",
                strokeWidth: 2,
                strokeLinecap: "round" as const,
              }
            : {
                stroke: "#888",
                strokeWidth: 2,
                strokeLinecap: "round" as const,
                strokeDasharray: "8 4",
              };

          if (sourceNode && targetNode) {
            edgeConnections.push({
              source: edge.source,
              target: edge.target,
              sourceLabel: sourceNode.label,
              targetLabel: targetNode.label,
              sourceType: sourceNode.type as "function" | "method",
              targetType: targetNode.type as "function" | "method",
              timestamp: Date.now(),
            });
          }

          let edgeType: string;
          if (edge.type === "uses") edgeType = "default";
          else if (callOrder !== undefined || returnOrder !== undefined)
            edgeType = "callOrderEdge";
          else edgeType = "default";

          // Handle optimization (safe fallback)
          let sourceHandle = "right";
          let targetHandle = "left";
          try {
            const sourceFlowNode = flowNodes.find((n) => n.id === edge.source);
            const targetFlowNode = flowNodes.find((n) => n.id === edge.target);
            if (sourceFlowNode && targetFlowNode) {
              // Basic direction-based handle selection
              sourceHandle =
                detectedFramework?.strategy.direction === "LR"
                  ? "right"
                  : "bottom";
              targetHandle =
                detectedFramework?.strategy.direction === "LR" ? "left" : "top";
            } else if (edge.type === "uses") {
              sourceHandle = "right";
              targetHandle = "left";
            }
          } catch (err) {
            Logger.warn(
              `[convertToFlowData] Edge handle optimization failed for ${edge.source}->${edge.target}`
            );
          }

          return {
            id: `edge-${edge.source}-${edge.target}-${index}`,
            source: edge.source,
            target: edge.target,
            sourceHandle,
            targetHandle,
            type: edgeType,
            animated: false,
            style: edgeStyle,
            data: {
              dashed: !hasReturnValue,
              solid: hasReturnValue,
              hasReturnValue,
              callOrder,
              returnOrder,
            },
            pathOptions: { borderRadius: 20, curvature: 0.5 },
          };
        });

      EdgeTracker.updateEdges(edgeConnections);
      (window as any).__goflowEdges = flowEdges;

      return { nodes: flowNodes, edges: flowEdges };
    },
    [
      vscode,
      handleHighlightEdge,
      handleClearHighlight,
      handleNodeHighlight,
      handleClearNodeHighlight,
      lineHighlightedEdges,
      detectedFramework?.strategy.direction,
    ]
  );

  useEffect(() => {
    const unsubscribe = EdgeTracker.subscribe((edges) => {});
    return () => unsubscribe();
  }, []);

  const buildStaticExecutionTrace = useCallback(
    (flowEdges: FlowEdge[], flowNodes: FlowNode[]) => {
      // Build quick lookup maps for node code, label & start line
      const nodeCodeMap = new Map<string, string>();
      const nodeLabelMap = new Map<string, string>();
      const nodeStartLineMap = new Map<string, number>();
      flowNodes.forEach((n) => {
        if (n.type === "functionNode") {
          const fnData = n.data as FunctionNodeData;
          nodeCodeMap.set(n.id, fnData.code || "");
          nodeLabelMap.set(n.id, fnData.label || n.id);
          nodeStartLineMap.set(n.id, fnData.line);
        } else if (n.type === "declarationNode") {
          const declData = n.data as DeclarationNodeData;
          nodeCodeMap.set(n.id, declData.code || "");
          nodeLabelMap.set(n.id, declData.label || n.id);
          nodeStartLineMap.set(n.id, declData.line);
        }
      });

      // Helper: attempt to find relative call line inside source function code
      const findCallLine = (
        sourceId: string,
        targetId: string
      ): { relLine?: number; content?: string } => {
        const sourceCode = nodeCodeMap.get(sourceId);
        if (!sourceCode) return {};
        const targetLabel = nodeLabelMap.get(targetId);
        if (!targetLabel) return {};
        const lines = sourceCode.split("\n");
        // naive search: first line containing "targetLabel("
        const idx = lines.findIndex((l) => l.includes(`${targetLabel}(`));
        if (idx >= 0) {
          return { relLine: idx + 1, content: lines[idx] };
        }
        return {};
      };

      // (Removed callee progression helper; highlightUntilRelativeLine now uses caller sourceCallLine)

      // Helper: find next call line in caller AFTER a given relative line
      const findNextCallLineAfter = (
        sourceId: string,
        afterRelLine: number
      ): number | undefined => {
        const sourceCode = nodeCodeMap.get(sourceId);
        if (!sourceCode) return undefined;
        const lines = sourceCode.split("\n");
        const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
        for (let i = afterRelLine; i < lines.length; i++) {
          const raw = lines[i];
          const trimmed = raw.trim();
          if (!trimmed || trimmed.startsWith("//")) continue;
          if (trimmed.startsWith("func ")) continue;
          if (callRegex.test(raw)) return i + 1; // 1-based
        }
        return undefined;
      };

      // Collect call entries enriched with code
      const callEntries: ExecutionTraceEntry[] = flowEdges
        .filter(
          (e) =>
            e.type === "callOrderEdge" &&
            e.data &&
            typeof (e.data as any).callOrder === "number"
        )
        .map((e) => {
          const callOrder = (e.data as any).callOrder;
          const sourceCode = nodeCodeMap.get(e.source);
          const targetCode = nodeCodeMap.get(e.target);
          const { relLine, content } = findCallLine(e.source, e.target);

          return {
            step: callOrder,
            type: "call",
            sourceNodeId: e.source,
            targetNodeId: e.target,
            sourceCallLine: relLine,
            sourceLineContent: content,
            sourceCode,
            targetCode,
            sourceStartLine: nodeStartLineMap.get(e.source),
            targetStartLine: nodeStartLineMap.get(e.target),
            timestamp: Date.now(),
            // Legacy single-bound highlight
            highlightUntilRelativeLine: relLine,
            // NEW segment highlighting: for a CALL bright region = 1..call line
            highlightSegmentStartRelativeLine: relLine ? 1 : undefined,
            highlightSegmentEndRelativeLine: relLine,
          } as ExecutionTraceEntry;
        });

      // Collect return entries enriched
      const returnEntries: ExecutionTraceEntry[] = flowEdges
        .filter(
          (e) =>
            e.type === "callOrderEdge" &&
            e.data &&
            typeof (e.data as any).returnOrder === "number"
        )
        .map((e) => {
          const returnOrder = (e.data as any).returnOrder;
          const sourceCode = nodeCodeMap.get(e.source);
          const targetCode = nodeCodeMap.get(e.target);

          // Find matching prior call entry for this edge to get its call line
          const priorCall = callEntries.find(
            (c) =>
              c.sourceNodeId === e.source &&
              c.targetNodeId === e.target &&
              typeof c.sourceCallLine === "number"
          );
          const previousCallLine = priorCall?.sourceCallLine;

          // Determine next call line after previous call line inside caller
          let nextCallLine: number | undefined;
          if (typeof previousCallLine === "number") {
            nextCallLine = findNextCallLineAfter(e.source, previousCallLine);
          }

          return {
            step: returnOrder,
            type: "return",
            sourceNodeId: e.source,
            targetNodeId: e.target,
            sourceCode,
            targetCode,
            sourceStartLine: nodeStartLineMap.get(e.source),
            targetStartLine: nodeStartLineMap.get(e.target),
            timestamp: Date.now(),
            // Segment for RETURN: (previousCallLine+1) .. (nextCallLine or previousCallLine+1 if none)
            highlightSegmentStartRelativeLine:
              typeof previousCallLine === "number"
                ? previousCallLine + 1
                : undefined,
            highlightSegmentEndRelativeLine:
              typeof previousCallLine === "number"
                ? nextCallLine || previousCallLine + 1
                : undefined,
          } as ExecutionTraceEntry;
        });

      // Merge & sort
      const merged = [...callEntries, ...returnEntries].sort(
        (a, b) => (a.step ?? 0) - (b.step ?? 0)
      );

      // Correlate call/return pairs per edge (source->target)
      const correlationMap: Record<
        string,
        {
          callStep?: number;
          returnStep?: number;
          callOrder?: number;
          returnOrder?: number;
          sourceNodeId: string;
          targetNodeId: string;
          hasSourceLineContent?: boolean;
        }
      > = {};

      callEntries.forEach((c) => {
        const key = `${c.sourceNodeId}->${c.targetNodeId}`;
        correlationMap[key] = {
          ...(correlationMap[key] || {}),
          callStep: c.step,
          callOrder: c.step,
          sourceNodeId: c.sourceNodeId,
          targetNodeId: c.targetNodeId,
          hasSourceLineContent: !!c.sourceLineContent,
        };
      });
      returnEntries.forEach((r) => {
        const key = `${r.sourceNodeId}->${r.targetNodeId}`;
        correlationMap[key] = {
          ...(correlationMap[key] || {}),
          returnStep: r.step,
          returnOrder: r.step,
          sourceNodeId: r.sourceNodeId,
          targetNodeId: r.targetNodeId,
        };
      });

      // Detect anomalies: return before call, missing return, missing call
      const anomalies: {
        key: string;
        issue: string;
        data: any;
      }[] = [];
      Object.entries(correlationMap).forEach(([key, v]) => {
        if (v.callStep !== undefined && v.returnStep !== undefined) {
          if ((v.returnStep as number) < (v.callStep as number)) {
            anomalies.push({
              key,
              issue: "RETURN_BEFORE_CALL",
              data: v,
            });
          }
        } else if (v.callStep !== undefined && v.returnStep === undefined) {
          anomalies.push({
            key,
            issue: "MISSING_RETURN",
            data: v,
          });
        } else if (v.callStep === undefined && v.returnStep !== undefined) {
          anomalies.push({
            key,
            issue: "RETURN_WITHOUT_CALL",
            data: v,
          });
        }
      });

      setExecutionTrace(merged);
      logToExtension(
        "INFO",
        "[StaticTrace] Built execution flow list (enriched)",
        {
          callCount: callEntries.length,
          returnCount: returnEntries.length,
          total: merged.length,
          withSourceLines: callEntries.filter((c) => c.sourceCallLine).length,
          edgePairs: Object.keys(correlationMap).length,
          anomalyCount: anomalies.length,
        }
      );

      if (anomalies.length > 0) {
        logToExtension("WARN", "[StaticTrace] Detected execution anomalies", {
          anomalies: anomalies.slice(0, 50), // cap for safety
        });
      } else {
        logToExtension(
          "DEBUG",
          "[StaticTrace] No execution anomalies detected"
        );
      }
    },
    [logToExtension]
  );

  const renderGraph = useCallback(
    async (data: GraphData, fileName?: string) => {
      try {
        if (fileName) {
          setCurrentFileName(fileName);
          const firstNode = data.nodes[0];
          const fileContent = firstNode?.code || "";
          const detected = detectFramework(fileName, fileContent);
          setDetectedFramework(detected);
        }

        const { nodes: flowNodes, edges: flowEdges } = convertToFlowData(data);
        const { nodes: layoutedNodes, edges: layoutedEdges } =
          await getLayoutedElements(flowNodes, flowEdges, detectedFramework);

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);

        // Capture root function (first function node) once
        if (!rootNodeIdRef.current) {
          const firstFn = layoutedNodes.find((n) => n.type === "functionNode");
          if (firstFn) {
            rootNodeIdRef.current = firstFn.id;
            rootCodeRef.current = (firstFn.data as FunctionNodeData).code || "";
            rootStartLineRef.current = (firstFn.data as FunctionNodeData).line;
            logToExtension("INFO", "[ExecutionFlow] Root function captured", {
              rootNodeId: rootNodeIdRef.current,
              rootStartLine: rootStartLineRef.current,
            });
          }
        }

        setIsLoading(false);
        setError(null);
        setIsGraphReady(true);

        // BUILD STATIC TRACE (now passes nodes for code enrichment)
        buildStaticExecutionTrace(layoutedEdges, layoutedNodes);
      } catch (err) {
        console.error("[FlowGraph] Failed to render graph:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
        setIsGraphReady(false);
      }
    },
    [
      setNodes,
      setEdges,
      detectedFramework,
      convertToFlowData,
      getLayoutedElements,
      buildStaticExecutionTrace,
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

  // Containers recalculation
  useEffect(() => {
    const codeNodes = debouncedNodes.filter(
      (n: { type: string }) => n.type === "functionNode"
    );
    const declarationNodes = debouncedNodes.filter(
      (n: { type: string }) => n.type === "declarationNode"
    );
    const currentContainers = debouncedNodes.filter(
      (n: { type: string }) => n.type === "fileGroupContainer"
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

  // Send ready once
  useEffect(() => {
    vscode.postMessage({ command: "ready" });
  }, [vscode]);

  // Message listener
  useEffect(() => {
    const messageHandler = async (event: MessageEvent) => {
      const message = event.data;
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
            setIsGraphReady(false);
            if (message.config) {
              setEnableJumpToFile(message.config.enableJumpToFile);
            }
            if (message.theme) {
              (window as any).__goflowTheme = message.theme;
            }
            await renderGraph(message.data, message.data?.fileName);
            break;
          case "refresh":
            if (message.data) {
              await renderGraph(message.data, message.data?.fileName);
            }
            break;
          case "highlightEdge":
            handleHighlightEdge(message.sourceNodeId, message.targetNodeId);

            // Dynamic execution flow: synthesize RETURN entry for previous call of same caller (if exists)
            try {
              const prevCall = lastCallEntryRef.current.get(
                message.sourceNodeId
              );
              const sourceFnNodeForReturn = nodes.find(
                (n) =>
                  n.id === message.sourceNodeId && n.type === "functionNode"
              );
              const sourceCodeForReturn =
                sourceFnNodeForReturn &&
                (sourceFnNodeForReturn.data as FunctionNodeData).code
                  ? (sourceFnNodeForReturn.data as FunctionNodeData).code
                  : undefined;

              // Helper: find next call line after a given relative line (restricted to scanning until new call line)
              const findNextCallLineAfterDynamic = (
                sourceCode: string,
                afterRelLine: number,
                clampToRelLine?: number
              ): number | undefined => {
                const lines = sourceCode.split("\n");
                const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
                for (let i = afterRelLine; i < lines.length; i++) {
                  const raw = lines[i];
                  const trimmed = raw.trim();
                  if (!trimmed || trimmed.startsWith("//")) continue;
                  if (trimmed.startsWith("func ")) continue;
                  if (callRegex.test(raw)) {
                    const candidate = i + 1;
                    if (
                      typeof clampToRelLine === "number" &&
                      candidate > clampToRelLine
                    )
                      return clampToRelLine; // clamp
                    return candidate;
                  }
                  if (
                    typeof clampToRelLine === "number" &&
                    i + 1 >= clampToRelLine
                  ) {
                    // reached clamp boundary without finding another call line
                    return clampToRelLine;
                  }
                }
                return clampToRelLine;
              };

              if (
                prevCall &&
                sourceCodeForReturn &&
                typeof prevCall.sourceCallLine === "number"
              ) {
                const newCallRelLine =
                  typeof message.sourceCallLine === "number"
                    ? message.sourceCallLine
                    : undefined;
                const nextCallLine =
                  typeof newCallRelLine === "number"
                    ? newCallRelLine
                    : findNextCallLineAfterDynamic(
                        sourceCodeForReturn,
                        prevCall.sourceCallLine,
                        undefined
                      );

                // Construct RETURN entry segment: (prevCallLine+1) .. (nextCallLine)
                const startSeg = prevCall.sourceCallLine + 1;
                const endSeg =
                  typeof nextCallLine === "number"
                    ? nextCallLine
                    : prevCall.sourceCallLine + 1;

                setExecutionTrace((prev) => [
                  ...prev,
                  {
                    step: prev.length + 1,
                    type: "return",
                    sourceNodeId: prevCall.sourceNodeId,
                    targetNodeId: prevCall.targetNodeId,
                    sourceCode: sourceCodeForReturn,
                    sourceStartLine: (
                      sourceFnNodeForReturn?.data as
                        | FunctionNodeData
                        | undefined
                    )?.line,
                    timestamp: Date.now(),
                    highlightSegmentStartRelativeLine: startSeg,
                    highlightSegmentEndRelativeLine: endSeg,
                  },
                ]);
              }
            } catch (e) {
              logToExtension(
                "WARN",
                "[ExecutionFlow] Failed to synthesize return entry",
                e
              );
            }

            // Dynamic execution flow: add CALL entry
            try {
              const sourceFnNode = nodes.find(
                (n) =>
                  n.id === message.sourceNodeId && n.type === "functionNode"
              );
              const targetFnNode = nodes.find(
                (n) =>
                  n.id === message.targetNodeId && n.type === "functionNode"
              );

              const sourceCode =
                sourceFnNode && (sourceFnNode.data as FunctionNodeData).code
                  ? (sourceFnNode.data as FunctionNodeData).code
                  : undefined;
              const targetCode =
                targetFnNode && (targetFnNode.data as FunctionNodeData).code
                  ? (targetFnNode.data as FunctionNodeData).code
                  : undefined;

              const sourceLines = sourceCode ? sourceCode.split("\n") : [];
              const sourceLineContent =
                sourceLines[(message.sourceCallLine || 0) - 1] || "";

              // Dynamic: highlight all executed lines in caller (source) up to call site
              const callerProgressLine =
                typeof message.sourceCallLine === "number"
                  ? message.sourceCallLine
                  : undefined;

              setExecutionTrace((prev) => {
                const newCallEntry: ExecutionTraceEntry = {
                  step: prev.length + 1,
                  type: "call",
                  sourceNodeId: message.sourceNodeId,
                  targetNodeId: message.targetNodeId,
                  sourceCallLine:
                    typeof message.sourceCallLine === "number"
                      ? message.sourceCallLine
                      : undefined,
                  sourceLineContent: sourceLineContent,
                  sourceCode,
                  targetCode,
                  sourceStartLine: sourceFnNode
                    ? (sourceFnNode.data as FunctionNodeData).line
                    : undefined,
                  targetStartLine: targetFnNode
                    ? (targetFnNode.data as FunctionNodeData).line
                    : undefined,
                  timestamp: Date.now(),
                  highlightUntilRelativeLine: callerProgressLine,
                  highlightSegmentStartRelativeLine:
                    typeof message.sourceCallLine === "number" ? 1 : undefined,
                  highlightSegmentEndRelativeLine: callerProgressLine,
                };
                // Update lastCallEntryRef for this caller
                lastCallEntryRef.current.set(
                  message.sourceNodeId,
                  newCallEntry
                );
                return [...prev, newCallEntry];
              });
            } catch (e) {
              logToExtension(
                "WARN",
                "[ExecutionFlow] Failed to append call entry",
                e
              );
            }
            break;
          case "clearHighlight":
            handleClearHighlight();
            break;
          case "recordTraceLine":
            // Unresolved calls on a line: add one 'unresolved' entry per call name
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

              message.functionCalls.forEach((fnName: string) => {
                setExecutionTrace((prev) => [
                  ...prev,
                  {
                    step: prev.length + 1,
                    type: "unresolved",
                    sourceNodeId: message.sourceNodeId,
                    targetNodeId: `unresolved_${fnName}`,
                    sourceCallLine: message.relativeLine,
                    sourceLineContent: srcLineContent,
                    sourceCode,
                    sourceStartLine: sourceFnNode
                      ? (sourceFnNode.data as FunctionNodeData).line
                      : undefined,
                    timestamp: Date.now(),
                  },
                ]);
              });
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

              setExecutionTrace((prev) => [
                ...prev,
                {
                  step: prev.length + 1,
                  type: "raw",
                  sourceNodeId: message.sourceNodeId,
                  targetNodeId: `raw_line_${message.relativeLine}`,
                  sourceCallLine: message.relativeLine,
                  sourceLineContent: srcLineContent,
                  sourceCode,
                  sourceStartLine: sourceFnNode
                    ? (sourceFnNode.data as FunctionNodeData).line
                    : undefined,
                  timestamp: Date.now(),
                },
              ]);
            }
            break;
          case "tracePathForLineClick":
            handleNodeHighlight(message.targetNodeId);
            break;
          default:
            console.log("[FlowGraph] Unknown command:", message.command);
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
        rootNodeId={rootNodeIdRef.current}
        rootCode={rootCodeRef.current}
        rootStartLine={rootStartLineRef.current}
        onClear={() => {
          setExecutionTrace([]);
        }}
        onJumpToNode={(nodeId) => {
          // Highlight + center viewport on node
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
