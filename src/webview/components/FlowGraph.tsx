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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../styles/common.css";
import "../styles/flow-graph.css";
import FunctionNode from "./FunctionNode";
import FileGroupContainer from "./FileGroupContainer";
import { GraphData } from "../../models/Node";
import { detectFramework, FrameworkConfig } from "../configs/layoutStrategies";
import { applyLayout } from "../utils/layoutEngines";
import { EdgeTracker, EdgeConnection } from "../utils/EdgeTracker";
import { Logger } from "../../utils/webviewLogger";
import NodeVisibilityDrawer from "./NodeVisibilityDrawer";
import FlowPathDrawer from "./FlowPathDrawer";
import { FlowPathTracker, FlowPath } from "../utils/FlowPathTracker";

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

import DeclarationNode from "./DeclarationNode";

const nodeTypes = {
  functionNode: FunctionNode as React.ComponentType<any>,
  declarationNode: DeclarationNode as React.ComponentType<any>,
  fileGroupContainer: FileGroupContainer as React.ComponentType<any>,
};

// Custom debounce hook
const useDebounce = (value: any, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

const FlowGraph: React.FC<FlowGraphProps> = ({ vscode }) => {
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
      console.error(
        "[FlowGraph] Failed to load hidden nodes from localStorage:",
        error
      );
      return new Set<string>();
    }
  });

  // Flow Path Drawer states
  const [isFlowPathDrawerOpen, setIsFlowPathDrawerOpen] = useState(false);
  const [flowPaths, setFlowPaths] = useState<FlowPath[]>([]);

  // Auto-save hiddenNodeIds to localStorage
  useEffect(() => {
    try {
      const array = Array.from(hiddenNodeIds);
      localStorage.setItem("goflow-hidden-nodes", JSON.stringify(array));
    } catch (error) {
      console.error(
        "[FlowGraph] Failed to save hidden nodes to localStorage:",
        error
      );
    }
  }, [hiddenNodeIds]);

  const handleToggleFlowPathDrawer = useCallback(() => {
    setIsFlowPathDrawerOpen((prev) => !prev);
  }, []);

  const handleSelectFlow = useCallback((flowId: string) => {
    FlowPathTracker.setActiveFlow(flowId);

    const flow = FlowPathTracker.getFlowById(flowId);
    if (!flow) return;

    // TODO: Highlight all nodes and edges in this flow path
  }, []);

  const handleDeleteFlow = useCallback((flowId: string) => {
    FlowPathTracker.deleteFlow(flowId);
  }, []);

  const handleClearAllFlows = useCallback(() => {
    FlowPathTracker.clearAllFlows();
  }, []);

  useEffect(() => {
    const unsubscribe = FlowPathTracker.subscribe((flows) => {
      setFlowPaths(flows);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Use debounce for nodes to prevent excessive re-renders
  const debouncedNodes = useDebounce(nodes, 100);
  const lastContainerUpdateRef = useRef<string>("");

  const getOriginalDashArray = useCallback(
    (edge: FlowEdge): string | undefined => {
      // Priority 1: Từ style hiện tại
      if (edge.style?.strokeDasharray) {
        return edge.style.strokeDasharray as string;
      }

      // Priority 2: Từ data.dashed flag
      if (edge.data?.dashed === true) {
        return "8 4";
      }

      // Priority 3: Từ data.hasReturnValue (fallback)
      if (edge.data?.hasReturnValue === false) {
        return "8 4";
      }

      // Default: solid line
      return undefined;
    },
    []
  );

  const handleToggleDrawer = useCallback(() => {
    setIsDrawerOpen((prev) => !prev);
  }, []);

  const handleToggleNodeVisibility = useCallback((nodeId: string) => {
    setHiddenNodeIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, []);

  const handleShowAllNodes = useCallback(() => {
    setHiddenNodeIds(new Set());
  }, []);

  const handleHideAllNodes = useCallback(() => {
    const allNodeIds = nodes
      .filter((n) => n.type === "functionNode")
      .map((n) => n.id);
    setHiddenNodeIds(new Set(allNodeIds));
  }, [nodes]);

  const handleHighlightEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edgeKey = `${sourceNodeId}->${targetNodeId}`;
      setLineHighlightedEdges(new Set([edgeKey]));

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const currentEdgeKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = currentEdgeKey === edgeKey;
          const isNodeHighlighted = nodeHighlightedEdges.has(currentEdgeKey);

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
        });
      });
    },
    [setEdges, nodeHighlightedEdges, getOriginalDashArray]
  );

  const handleClearHighlight = useCallback(() => {
    setLineHighlightedEdges(new Set());

    setEdges((currentEdges) => {
      return currentEdges.map((edge) => {
        const currentEdgeKey = `${edge.source}->${edge.target}`;
        const isNodeHighlighted = nodeHighlightedEdges.has(currentEdgeKey);

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
      });
    });
  }, [setEdges, nodeHighlightedEdges, getOriginalDashArray]);

  const handleNodeHighlight = useCallback(
    (targetNodeId: string) => {
      // If graph not ready, save request for later
      if (!isGraphReady || edges.length === 0 || nodes.length === 0) {
        Logger.warn(
          `[FlowGraph] Graph not ready. Saving pending highlight request for: ${targetNodeId}`
        );
        setPendingHighlightNodeId(targetNodeId);
        return;
      }

      const incomingEdges = edges.filter(
        (edge) => edge.target === targetNodeId
      );

      if (incomingEdges.length === 0) {
        Logger.warn(
          `[FlowGraph] No incoming edges found for ${targetNodeId} - this is a root node`
        );
      }

      const edgeKeys = new Set(
        incomingEdges.map((edge) => `${edge.source}->${edge.target}`)
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

      const tracedPath = EdgeTracker.tracePathsToRoot(
        targetNodeId,
        allNodesData
      );

      if (tracedPath) {
        EdgeTracker.logTracedPaths(tracedPath);

        const report = EdgeTracker.getFormattedPathReport(tracedPath);

        vscode.postMessage({
          command: "showPathTrace",
          tracedPath: tracedPath,
          formattedReport: report,
        });
      } else {
        Logger.warn(`[FlowGraph] No traced path found for ${targetNodeId}`);
      }

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const currentEdgeKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = lineHighlightedEdges.has(currentEdgeKey);
          const isNodeHighlighted = edgeKeys.has(currentEdgeKey);

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
        });
      });

      setNodes((currentNodes) => {
        return currentNodes.map((node) => {
          const isParentNode = incomingEdges.some(
            (edge) => edge.source === node.id
          );
          const isTargetNode = node.id === targetNodeId;

          if (isParentNode || isTargetNode) {
            return {
              ...node,
              style: {
                ...node.style,
                border: isTargetNode
                  ? "3px solid #FF6B6B"
                  : "2px solid #FFA500",
                boxShadow: isTargetNode
                  ? "0 0 10px rgba(255, 107, 107, 0.5)"
                  : "0 0 8px rgba(255, 165, 0, 0.4)",
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
        });
      });
    },
    [
      edges,
      setEdges,
      lineHighlightedEdges,
      setNodes,
      nodes,
      vscode,
      isGraphReady,
    ]
  );

  // Process pending highlight when graph becomes ready
  useEffect(() => {
    if (
      isGraphReady &&
      pendingHighlightNodeId &&
      edges.length > 0 &&
      nodes.length > 0
    ) {
      // Execute the pending highlight
      handleNodeHighlight(pendingHighlightNodeId);

      // Clear pending request
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

    setEdges((currentEdges) => {
      return currentEdges.map((edge) => {
        const currentEdgeKey = `${edge.source}->${edge.target}`;
        const isLineHighlighted = lineHighlightedEdges.has(currentEdgeKey);

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
      });
    });

    setNodes((currentNodes) => {
      return currentNodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          border: undefined,
          boxShadow: undefined,
        },
      }));
    });
  }, [setEdges, lineHighlightedEdges, setNodes, getOriginalDashArray]);

  // Update the calculateFileGroupContainers function in FlowGraph.tsx
  const calculateFileGroupContainers = useCallback(
    (nodes: FlowNode[]): FlowNode[] => {
      const containerNodes: FlowNode[] = [];
      const nodesByFile = new Map<string, FlowNode[]>();

      // STEP 1: Group FunctionNodes by file
      nodes.forEach((node) => {
        if (node.type === "functionNode") {
          const file = (node.data as FunctionNodeData).file;
          if (!nodesByFile.has(file)) {
            nodesByFile.set(file, []);
          }
          nodesByFile.get(file)!.push(node);
        }
      });

      // STEP 2: Group DeclarationNodes by CALLER's file
      nodes.forEach((node) => {
        if (node.type === "declarationNode") {
          const declData = node.data as DeclarationNodeData;
          const usedBy = declData.usedBy || [];

          // CRITICAL: Tìm caller FunctionNode đầu tiên
          const callerNode = nodes.find(
            (n) => n.type === "functionNode" && usedBy.includes(n.id)
          );

          if (callerNode) {
            const callerFile = (callerNode.data as FunctionNodeData).file;

            if (!nodesByFile.has(callerFile)) {
              nodesByFile.set(callerFile, []);
            }
            nodesByFile.get(callerFile)!.push(node);
          } else {
            // THÊM LOG DEBUG - DeclarationNode không có caller
            console.warn(
              `  ⚠️ No caller found for DeclarationNode: ${node.id}`
            );
            console.warn(`     Expected usedBy:`, usedBy);

            // Fallback: đặt vào file của chính declaration node
            const declFile = (node.data as DeclarationNodeData).file;
            if (!nodesByFile.has(declFile)) {
              nodesByFile.set(declFile, []);
            }
            nodesByFile.get(declFile)!.push(node);
          }
        }
      });

      // STEP 3: Calculate bounding box for each file group (including DeclarationNodes)
      nodesByFile.forEach((fileNodes, file) => {
        if (fileNodes.length === 0) return;

        const padding = 40;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        fileNodes.forEach((node) => {
          // Use appropriate dimensions for different node types
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

        const containerId = `container-${file}`;

        // Count nodes by type for the container
        const functionNodeCount = fileNodes.filter(
          (n) => n.type === "functionNode"
        ).length;
        const declarationNodeCount = fileNodes.filter(
          (n) => n.type === "declarationNode"
        ).length;

        containerNodes.push({
          id: containerId,
          type: "fileGroupContainer" as const,
          position: {
            x: minX - padding,
            y: minY - padding,
          },
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
          style: {
            width: containerWidth,
            height: containerHeight,
          },
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

      const layoutedResult = await applyLayout(nodes, edges, strategy);

      const layoutedFlowNodes = layoutedResult.nodes as FlowNode[];
      const containerNodes = calculateFileGroupContainers(layoutedFlowNodes);
      const allNodes = [...containerNodes, ...layoutedFlowNodes];

      return { nodes: allNodes, edges: layoutedResult.edges };
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
            },
            zIndex: 10,
          } as FlowNode);
        } else if (
          node.type === "class" ||
          node.type === "struct" ||
          node.type === "interface" ||
          node.type === "enum" ||
          node.type === "type"
        ) {
          // DeclarationNode
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
            style: {
              width: 350,
              height: 200,
            },
            zIndex: 5,
          } as FlowNode);
        }
      });

      const flowEdges: FlowEdge[] = data.edges
        .filter((edge) => {
          const sourceExists = flowNodes.some((n) => n.id === edge.source);
          const targetExists = flowNodes.some((n) => n.id === edge.target);

          // CRITICAL: Keep "uses" edges (FunctionNode -> DeclarationNode)
          if (edge.type === "uses") {
            return sourceExists && targetExists;
          }

          // Keep "calls" edges (FunctionNode -> FunctionNode)
          return sourceExists && targetExists;
        })
        .map((edge, index) => {
          const sourceNode = data.nodes.find((n) => n.id === edge.source);
          const targetNode = data.nodes.find((n) => n.id === edge.target);

          const hasReturnValue = edge.hasReturnValue ?? true;

          const edgeStyle = hasReturnValue
            ? {
                stroke: "#666",
                strokeWidth: 2,
                strokeLinecap: "round" as const,
              }
            : {
                stroke: "#888", // Màu nhạt hơn cho dashed
                strokeWidth: 2,
                strokeLinecap: "round" as const,
                strokeDasharray: "8 4", // Nét đứt rõ ràng hơn
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

          return {
            id: `edge-${edge.source}-${edge.target}-${index}`,
            source: edge.source,
            target: edge.target,
            type: edge.type || "default",
            animated: false,
            style: edgeStyle,
            data: {
              dashed: !hasReturnValue,
              solid: hasReturnValue,
              hasReturnValue: hasReturnValue,
            },
            pathOptions: {
              borderRadius: 20,
              curvature: 0.5,
            },
          };
        });

      EdgeTracker.updateEdges(edgeConnections);

      return { nodes: flowNodes, edges: flowEdges };
    },
    [
      vscode,
      handleHighlightEdge,
      handleClearHighlight,
      handleNodeHighlight,
      handleClearNodeHighlight,
      lineHighlightedEdges,
    ]
  );

  useEffect(() => {
    const unsubscribe = EdgeTracker.subscribe((edges) => {});

    return () => {
      unsubscribe();
    };
  }, []);

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

        // Generate flow paths
        const codeNodes = layoutedNodes
          .filter((n) => n.type === "functionNode")
          .map((n) => ({
            id: n.id,
            label: (n.data as FunctionNodeData).label,
            type: (n.data as FunctionNodeData).type,
            file: (n.data as FunctionNodeData).file,
            line: (n.data as FunctionNodeData).line,
          }));

        FlowPathTracker.generateFlowsFromGraph(codeNodes, layoutedEdges);

        setIsLoading(false);
        setError(null);

        // Mark graph as ready AFTER state updates
        setIsGraphReady(true);
      } catch (err) {
        console.error("❌ [FlowGraph] Failed to render graph:", err);
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
  ]);

  const handleExport = useCallback(() => {
    vscode.postMessage({
      command: "export",
    });
  }, [vscode]);

  const handleFit = useCallback(() => {
    vscode.postMessage({
      command: "fitView",
    });
  }, [vscode]);

  // Fixed useEffect for container calculation - prevent infinite loop
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

    // THÊM LOG DEBUG
    console.log(`📊 Container Calculation:`, {
      functionNodes: codeNodes.length,
      declarationNodes: declarationNodes.length,
      currentContainers: currentContainers.length,
    });

    if (codeNodes.length === 0 && declarationNodes.length === 0) {
      return;
    }

    const containerNodes = calculateFileGroupContainers(debouncedNodes);

    // LOG KẾT QUẢ
    containerNodes.forEach((container) => {
      const data = container.data as any;
      console.log(
        `🏷️ Container "${data.fileName}": ${data.functionNodeCount}F + ${data.declarationNodeCount}D`
      );
    });

    // Create a signature for current state to prevent unnecessary updates
    const currentSignature = JSON.stringify({
      codeNodeCount: codeNodes.length,
      containerCount: currentContainers.length,
      containerPositions: currentContainers.map(
        (c: { id: any; position: { x: any; y: any } }) => ({
          id: c.id,
          x: c.position.x,
          y: c.position.y,
        })
      ),
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

    // Only update if signatures are different
    if (
      currentSignature === newSignature &&
      currentSignature === lastContainerUpdateRef.current
    ) {
      return;
    }

    lastContainerUpdateRef.current = newSignature;

    setNodes((currentNodes) => {
      const withoutContainers = currentNodes.filter(
        (n) => n.type !== "fileGroupContainer"
      );
      const updatedNodes = [...containerNodes, ...withoutContainers];
      return updatedNodes;
    });
  }, [debouncedNodes, calculateFileGroupContainers, setNodes]);

  // useEffect CHỈ GỬI "ready" MỘT LẦN khi component mount
  useEffect(() => {
    vscode.postMessage({ command: "ready" });
  }, []); // ← KHÔNG CÓ DEPENDENCIES - chỉ chạy 1 lần

  // useEffect riêng để xử lý message listener
  useEffect(() => {
    const messageHandler = async (event: MessageEvent) => {
      const message = event.data;
      try {
        switch (message.command) {
          case "renderGraph":
            setIsGraphReady(false); // Reset flag before rendering
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
            break;
          case "clearHighlight":
            handleClearHighlight();
            break;
          case "tracePathForLineClick":
            handleNodeHighlight(message.targetNodeId);
            break;
          default:
            console.log("❓ [FlowGraph] Unknown command:", message.command);
        }
      } catch (err) {
        console.error("[FlowGraph] Error handling message:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
      }
    };

    window.addEventListener("message", messageHandler);

    return () => {
      window.removeEventListener("message", messageHandler);
    };
  }, [
    renderGraph,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    edges,
    nodes,
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

              if (!declData.usedBy || declData.usedBy.length === 0) {
                return false;
              }

              // CRITICAL FIX: Check if ANY caller is visible (not just first)
              const hasVisibleCaller = declData.usedBy.some((callerId) => {
                return !hiddenNodeIds.has(callerId);
              });

              return hasVisibleCaller;
            }

            // In the main ReactFlow component's nodes filter
            if (n.type === "fileGroupContainer") {
              const containerFile = (n.data as any).fileName;

              // Count visible nodes (both FunctionNodes AND DeclarationNodes)
              const visibleNodesInContainer = nodes.filter((node) => {
                if (node.type === "functionNode") {
                  return (
                    (node.data as FunctionNodeData).file === containerFile &&
                    !hiddenNodeIds.has(node.id)
                  );
                }

                if (node.type === "declarationNode") {
                  const declData = node.data as DeclarationNodeData;
                  const usedBy = declData.usedBy || [];

                  // Check if declaration belongs to this container by finding its caller
                  const callerNode = nodes.find(
                    (caller) =>
                      caller.type === "functionNode" &&
                      usedBy.includes(caller.id)
                  );

                  if (
                    callerNode &&
                    (callerNode.data as FunctionNodeData).file === containerFile
                  ) {
                    // Check if the caller is visible
                    return !hiddenNodeIds.has(callerNode.id);
                  }
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
              if (node.type === "fileGroupContainer") {
                return "rgba(251, 191, 36, 0.3)";
              }
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
          <Panel position="top-right" className="flow-graph-panel">
            <button
              onClick={handleToggleFlowPathDrawer}
              className="flow-graph-button flow-graph-button-primary"
              title="Flow Paths"
            >
              🔄
            </button>
            <button
              onClick={handleToggleDrawer}
              className="flow-graph-button flow-graph-button-primary"
              title="Node Visibility"
            >
              👁️
            </button>
            <button
              onClick={() => setEnableJumpToFile(!enableJumpToFile)}
              className={`flow-graph-button ${
                enableJumpToFile
                  ? "flow-graph-button-toggle-on"
                  : "flow-graph-button-toggle-off"
              }`}
              title={
                enableJumpToFile ? "Jump to file: ON" : "Jump to file: OFF"
              }
            >
              {enableJumpToFile ? "🔗" : "⛔"}
            </button>
            <button
              onClick={handleAutoSort}
              className="flow-graph-button flow-graph-button-auto-sort"
              title={
                detectedFramework
                  ? `Auto Sort: ${detectedFramework.strategy.description}`
                  : "Auto Sort Layout"
              }
              disabled={!detectedFramework || isAutoSorting}
            >
              {isAutoSorting ? "⏳" : "🔄"}
            </button>
            <button
              onClick={handleFit}
              className="flow-graph-button flow-graph-button-primary"
              title="Fit view"
            >
              ⊡
            </button>
            <button
              onClick={handleExport}
              className="flow-graph-button flow-graph-button-primary"
              title="Export"
            >
              💾
            </button>
            <button
              onClick={() => {
                const stats = EdgeTracker.getStats();
                EdgeTracker.logCurrentState();

                vscode.postMessage({
                  command: "showEdgeStats",
                  stats: stats,
                  edges: EdgeTracker.getAllEdges(),
                  formattedReport: EdgeTracker.getEdgeListFormatted(),
                });
              }}
              className="flow-graph-button flow-graph-button-primary"
              title="Show Edge Statistics"
            >
              📊
            </button>
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
      <FlowPathDrawer
        isOpen={isFlowPathDrawerOpen}
        onClose={() => setIsFlowPathDrawerOpen(false)}
        flows={flowPaths}
        onSelectFlow={handleSelectFlow}
        onDeleteFlow={handleDeleteFlow}
        onClearAll={handleClearAllFlows}
      />
    </div>
  );
};

export default FlowGraph;
