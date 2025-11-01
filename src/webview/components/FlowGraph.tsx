import React, { useCallback, useEffect, useState } from "react";
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
import CodeEntityNode from "./CodeEntityNode";
import FileGroupContainer from "./FileGroupContainer";
import { GraphData } from "../../models/Node";
import { Logger } from "../../utils/webviewLogger";
import {
  detectFramework,
  FRAMEWORK_LAYOUT_STRATEGIES,
  FrameworkConfig,
} from "../configs/layoutStrategies";
import { applyLayout } from "../utils/layoutEngines";

const NODE_COLORS = {
  function: "#4CAF50",
  method: "#2196F3",
} as const;

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180;
const PREVIEW_LINES = 8;

interface CodeEntityNodeData extends Record<string, unknown> {
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
}

type FlowNode = Node<CodeEntityNodeData>;
type FlowEdge = Edge;

interface FlowGraphProps {
  vscode: any;
}

const nodeTypes = {
  codeEntityNode: CodeEntityNode as React.ComponentType<any>,
  fileGroupContainer: FileGroupContainer as React.ComponentType<any>,
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

  const handleHighlightEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edgeKey = `${sourceNodeId}->${targetNodeId}`;
      setLineHighlightedEdges(new Set([edgeKey]));

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const currentEdgeKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = currentEdgeKey === edgeKey;

          if (isLineHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FFC107",
                strokeWidth: 4,
              },
              zIndex: 1000,
            };
          }

          const isNodeHighlighted = nodeHighlightedEdges.has(currentEdgeKey);
          if (isNodeHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FF6B6B",
                strokeWidth: 3,
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
            },
            zIndex: 1,
          };
        });
      });
    },
    [setEdges, nodeHighlightedEdges]
  );

  const handleClearHighlight = useCallback(() => {
    setLineHighlightedEdges(new Set());

    setEdges((currentEdges) => {
      return currentEdges.map((edge) => {
        const currentEdgeKey = `${edge.source}->${edge.target}`;
        const isNodeHighlighted = nodeHighlightedEdges.has(currentEdgeKey);

        if (isNodeHighlighted) {
          return {
            ...edge,
            animated: true,
            style: {
              ...edge.style,
              stroke: "#FF6B6B",
              strokeWidth: 3,
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
          },
          zIndex: 1,
        };
      });
    });
  }, [setEdges, nodeHighlightedEdges]);

  const handleNodeHighlight = useCallback(
    (targetNodeId: string) => {
      const incomingEdges = edges.filter(
        (edge) => edge.target === targetNodeId
      );
      const edgeKeys = new Set(
        incomingEdges.map((edge) => `${edge.source}->${edge.target}`)
      );

      setNodeHighlightedEdges(edgeKeys);

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const currentEdgeKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = lineHighlightedEdges.has(currentEdgeKey);

          if (isLineHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FFC107",
                strokeWidth: 4,
              },
              zIndex: 1000,
            };
          }

          const isNodeHighlighted = edgeKeys.has(currentEdgeKey);
          if (isNodeHighlighted) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FF6B6B",
                strokeWidth: 3,
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
            },
            zIndex: 1,
          };
        });
      });

      Logger.info(
        `[FlowGraph] Node highlight: ${incomingEdges.length} parent edges found for node ${targetNodeId}`
      );
    },
    [edges, setEdges, lineHighlightedEdges]
  );

  const handleClearNodeHighlight = useCallback(() => {
    setNodeHighlightedEdges(new Set());

    setEdges((currentEdges) => {
      return currentEdges.map((edge) => {
        const currentEdgeKey = `${edge.source}->${edge.target}`;
        const isLineHighlighted = lineHighlightedEdges.has(currentEdgeKey);

        if (isLineHighlighted) {
          return {
            ...edge,
            animated: true,
            style: {
              ...edge.style,
              stroke: "#FFC107",
              strokeWidth: 4,
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
          },
          zIndex: 1,
        };
      });
    });
  }, [setEdges, lineHighlightedEdges]);

  const calculateFileGroupContainers = useCallback(
    (nodes: FlowNode[]): FlowNode[] => {
      const containerNodes: FlowNode[] = [];
      const nodesByFile = new Map<string, FlowNode[]>();

      // Group nodes by file
      nodes.forEach((node) => {
        if (node.type === "codeEntityNode") {
          const file = (node.data as CodeEntityNodeData).file;
          if (!nodesByFile.has(file)) {
            nodesByFile.set(file, []);
          }
          nodesByFile.get(file)!.push(node);
        }
      });

      // Create container for each file group
      nodesByFile.forEach((fileNodes, file) => {
        if (fileNodes.length === 0) return;

        // Calculate bounding box
        const padding = 40;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        fileNodes.forEach((node) => {
          const nodeWidth = node.style?.width || 650;
          const nodeHeight = node.style?.height || 320;
          const x = node.position.x;
          const y = node.position.y;

          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + (nodeWidth as number));
          maxY = Math.max(maxY, y + (nodeHeight as number));
        });

        // Create container node
        const containerWidth = maxX - minX + padding * 2;
        const containerHeight = maxY - minY + padding * 2;

        const containerId = `container-${file}`;

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

      // Calculate and add file group containers
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

      data.nodes.forEach((node) => {
        if (node.type === "function" || node.type === "method") {
          flowNodes.push({
            id: node.id,
            type: "codeEntityNode" as const,
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
            } as CodeEntityNodeData,
            style: {
              width: 650,
              height: 320,
            },
            zIndex: 10,
          } as FlowNode);
        }
      });

      const flowEdges: FlowEdge[] = data.edges
        .filter((edge) => {
          const sourceExists = flowNodes.some((n) => n.id === edge.source);
          const targetExists = flowNodes.some((n) => n.id === edge.target);
          return sourceExists && targetExists;
        })
        .map((edge, index) => ({
          id: `edge-${edge.source}-${edge.target}-${index}`,
          source: edge.source,
          target: edge.target,
          type: "default",
          animated: false,
          style: {
            stroke: "#666",
            strokeWidth: 2,
            strokeLinecap: "round",
          },
          pathOptions: {
            borderRadius: 20,
            curvature: 0.5,
          },
        }));

      return { nodes: flowNodes, edges: flowEdges };
    },
    [vscode, handleHighlightEdge, handleClearHighlight]
  );

  const renderGraph = useCallback(
    async (data: GraphData, fileName?: string) => {
      try {
        // Auto-detect framework
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
        setIsLoading(false);
        setError(null);
      } catch (err) {
        console.error("[FlowGraph] Failed to render graph:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
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
      if (enableJumpToFile && node.type === "codeEntityNode") {
        const data = node.data as CodeEntityNodeData;
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
      const codeNodes = nodes.filter((n) => n.type === "codeEntityNode");
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

  // Auto-update containers when nodes move
  useEffect(() => {
    const codeNodes = nodes.filter((n) => n.type === "codeEntityNode");
    if (codeNodes.length === 0) {
      return;
    }

    // Chỉ update khi không có container hoặc số lượng code nodes thay đổi
    const currentContainers = nodes.filter(
      (n) => n.type === "fileGroupContainer"
    );

    if (currentContainers.length > 0 && codeNodes.length > 0) {
      // Đã có containers, chỉ cần update khi position thay đổi
      const containerNodes = calculateFileGroupContainers(codeNodes);

      // So sánh với containers hiện tại
      const needsUpdate = containerNodes.some((newContainer) => {
        const oldContainer = currentContainers.find(
          (c) => c.id === newContainer.id
        );
        if (!oldContainer) {
          return true;
        }

        const posXDiff = Math.abs(
          oldContainer.position.x - newContainer.position.x
        );
        const posYDiff = Math.abs(
          oldContainer.position.y - newContainer.position.y
        );
        const widthDiff = Math.abs(
          ((oldContainer.style?.width as number) || 0) -
            ((newContainer.style?.width as number) || 0)
        );
        const heightDiff = Math.abs(
          ((oldContainer.style?.height as number) || 0) -
            ((newContainer.style?.height as number) || 0)
        );

        const hasChanged =
          posXDiff > 1 || posYDiff > 1 || widthDiff > 1 || heightDiff > 1;

        return hasChanged;
      });

      if (!needsUpdate) {
        return;
      }

      setNodes((currentNodes) => {
        const withoutContainers = currentNodes.filter(
          (n) => n.type !== "fileGroupContainer"
        );
        const updatedNodes = [...containerNodes, ...withoutContainers];

        return updatedNodes;
      });
    } else if (currentContainers.length === 0 && codeNodes.length > 0) {
      // Chưa có containers, tạo mới
      const containerNodes = calculateFileGroupContainers(codeNodes);

      setNodes((currentNodes) => {
        const withoutContainers = currentNodes.filter(
          (n) => n.type !== "fileGroupContainer"
        );
        const updatedNodes = [...containerNodes, ...withoutContainers];

        return updatedNodes;
      });
    }
  }, [nodes, calculateFileGroupContainers, setNodes]);

  useEffect(() => {
    const messageHandler = async (event: MessageEvent) => {
      const message = event.data;

      try {
        switch (message.command) {
          case "renderGraph":
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
          default:
            Logger.info("[FlowGraph] Unknown command:", message.command);
        }
      } catch (err) {
        console.error("[FlowGraph] Error handling message:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
      }
    };

    window.addEventListener("message", messageHandler);
    vscode.postMessage({ command: "ready" });

    return () => {
      window.removeEventListener("message", messageHandler);
    };
  }, [renderGraph, vscode, handleHighlightEdge, handleClearHighlight]);

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
          nodes={nodes}
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
              const data = node.data as any;
              return data.type === "function" ? "#4CAF50" : "#2196F3";
            }}
            nodeStrokeWidth={3}
            zoomable
            pannable
          />
          <Panel position="top-right" className="flow-graph-panel">
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
    </div>
  );
};

export default FlowGraph;
