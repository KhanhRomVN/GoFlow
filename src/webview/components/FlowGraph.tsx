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
import CodeEntityNode from "./CodeEntityNode";
import FileGroupContainer from "./FileGroupContainer";
import { GraphData } from "../../models/Node";
import { detectFramework, FrameworkConfig } from "../configs/layoutStrategies";
import { applyLayout } from "../utils/layoutEngines";
import { EdgeTracker, EdgeConnection } from "../utils/EdgeTracker";
import { Logger } from "../../utils/webviewLogger";

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
  lineHighlightedEdges?: Set<string>;
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

  // Use debounce for nodes to prevent excessive re-renders
  const debouncedNodes = useDebounce(nodes, 100);
  const lastContainerUpdateRef = useRef<string>("");

  const handleHighlightEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      const edgeKey = `${sourceNodeId}->${targetNodeId}`;
      setLineHighlightedEdges(new Set([edgeKey]));

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const currentEdgeKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = currentEdgeKey === edgeKey;
          const isNodeHighlighted = nodeHighlightedEdges.has(currentEdgeKey);

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
      setHighlightedNodeId(targetNodeId);

      const allNodesData = nodes
        .filter((n) => n.type === "codeEntityNode")
        .map((n) => ({
          id: n.id,
          label: (n.data as CodeEntityNodeData).label,
          type: (n.data as CodeEntityNodeData).type,
          file: (n.data as CodeEntityNodeData).file,
          line: (n.data as CodeEntityNodeData).line,
        }));

      const tracedPath = EdgeTracker.tracePathsToRoot(
        targetNodeId,
        allNodesData
      );

      if (tracedPath) {
        EdgeTracker.logTracedPaths(tracedPath);

        const report = EdgeTracker.getFormattedPathReport(tracedPath);
        console.log("\n" + report);

        vscode.postMessage({
          command: "showPathTrace",
          tracedPath: tracedPath,
          formattedReport: report,
        });
      }

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const currentEdgeKey = `${edge.source}->${edge.target}`;
          const isLineHighlighted = lineHighlightedEdges.has(currentEdgeKey);
          const isNodeHighlighted = edgeKeys.has(currentEdgeKey);

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
    [edges, setEdges, lineHighlightedEdges, setNodes, nodes, vscode]
  );

  const handleClearNodeHighlight = useCallback(() => {
    setNodeHighlightedEdges(new Set());
    setHighlightedNodeId(null);

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
  }, [setEdges, lineHighlightedEdges, setNodes]);

  const calculateFileGroupContainers = useCallback(
    (nodes: FlowNode[]): FlowNode[] => {
      const containerNodes: FlowNode[] = [];
      const nodesByFile = new Map<string, FlowNode[]>();

      nodes.forEach((node) => {
        if (node.type === "codeEntityNode") {
          const file = (node.data as CodeEntityNodeData).file;
          if (!nodesByFile.has(file)) {
            nodesByFile.set(file, []);
          }
          nodesByFile.get(file)!.push(node);
        }
      });

      nodesByFile.forEach((fileNodes, file) => {
        if (fileNodes.length === 0) return;

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
              lineHighlightedEdges: lineHighlightedEdges,
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
        .map((edge, index) => {
          const sourceNode = data.nodes.find((n) => n.id === edge.source);
          const targetNode = data.nodes.find((n) => n.id === edge.target);

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
    const unsubscribe = EdgeTracker.subscribe((edges) => {
      Logger.info(
        `[FlowGraph] EdgeTracker updated: ${edges.length} edges tracked`
      );
    });

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
        setIsLoading(false);
        setError(null);
      } catch (err) {
        console.error("❌ [FlowGraph] Failed to render graph:", err);
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

  // Fixed useEffect for container calculation - prevent infinite loop
  useEffect(() => {
    const codeNodes = debouncedNodes.filter(
      (n: { type: string }) => n.type === "codeEntityNode"
    );
    const currentContainers = debouncedNodes.filter(
      (n: { type: string }) => n.type === "fileGroupContainer"
    );

    if (codeNodes.length === 0) {
      return;
    }

    const containerNodes = calculateFileGroupContainers(codeNodes);

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
  }, [renderGraph, handleHighlightEdge, handleClearHighlight]);

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
            <button
              onClick={() => {
                const stats = EdgeTracker.getStats();
                EdgeTracker.logCurrentState();

                console.log("\n" + EdgeTracker.getEdgeListFormatted());

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
    </div>
  );
};

export default FlowGraph;
