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

import FunctionNode from "./FunctionNode";
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

interface FunctionNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  endLine?: number;
  code: string;
}

type FlowNode = Node<FunctionNodeData>;
type FlowEdge = Edge;

interface FlowGraphProps {
  vscode: any;
}

const nodeTypes = {
  functionNode: FunctionNode as React.ComponentType<any>,
};

// Thêm state cho detected framework
interface FlowGraphState {
  detectedFramework: FrameworkConfig | null;
  currentFileName: string;
  isAutoSorting: boolean;
}

Logger.info(
  "[GoFlow Debug] FlowGraph - NodeTypes registered:",
  Object.keys(nodeTypes)
);

const FlowGraph: React.FC<FlowGraphProps> = ({ vscode }) => {
  Logger.info("[FlowGraph] Component mounting...");
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [enableJumpToFile, setEnableJumpToFile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detectedFramework, setDetectedFramework] =
    useState<FrameworkConfig | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [isAutoSorting, setIsAutoSorting] = useState(false);
  const [highlightedEdges, setHighlightedEdges] = useState<Set<string>>(
    new Set()
  );

  Logger.info("[FlowGraph] Initial state - isLoading:", isLoading);

  const handleHighlightEdge = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      Logger.info("[FlowGraph] Highlight edge request:", {
        sourceNodeId,
        targetNodeId,
      });

      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          const isTargetEdge =
            edge.source === sourceNodeId && edge.target === targetNodeId;

          if (isTargetEdge) {
            return {
              ...edge,
              animated: true,
              style: {
                ...edge.style,
                stroke: "#FFC107",
                strokeWidth: 4,
              },
            };
          } else {
            return {
              ...edge,
              animated: false,
              style: {
                ...edge.style,
                stroke: "#666",
                strokeWidth: 2,
              },
            };
          }
        });
      });

      setHighlightedEdges(new Set([`${sourceNodeId}->${targetNodeId}`]));
    },
    [setEdges]
  );

  const handleClearHighlight = useCallback(() => {
    Logger.info("[FlowGraph] Clear all edge highlights");

    setEdges((currentEdges) => {
      return currentEdges.map((edge) => ({
        ...edge,
        animated: false,
        style: {
          ...edge.style,
          stroke: "#666",
          strokeWidth: 2,
        },
      }));
    });

    setHighlightedEdges(new Set());
  }, [setEdges]);

  const getLayoutedElements = useCallback(
    async (
      nodes: FlowNode[],
      edges: FlowEdge[],
      framework?: FrameworkConfig | null
    ): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> => {
      const strategy = framework?.strategy || {
        algorithm: "dagre" as const,
        direction: "TB" as const,
        edgeType: "smoothstep" as const,
        ranksep: 120,
        nodesep: 80,
        description: "Default Layout",
      };

      Logger.info("[FlowGraph] Applying layout:", {
        algorithm: strategy.algorithm,
        direction: strategy.direction,
        framework: framework
          ? Object.keys(FRAMEWORK_LAYOUT_STRATEGIES).find(
              (key) => FRAMEWORK_LAYOUT_STRATEGIES[key] === framework
            )
          : "default",
      });

      const layouted = await applyLayout(nodes, edges, strategy);

      const layoutedNodes = layouted.nodes.map((node) => ({
        ...node,
        data: node.data as FunctionNodeData,
        style: { width: "auto" },
      })) as FlowNode[];

      return { nodes: layoutedNodes, edges: layouted.edges };
    },
    []
  ); // Empty deps vì không dùng external variables

  const convertToFlowData = useCallback(
    (data: GraphData): { nodes: FlowNode[]; edges: FlowEdge[] } => {
      const flowNodes: FlowNode[] = data.nodes
        .filter((node) => node.type === "function" || node.type === "method")
        .map((node) => ({
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
            allNodes: data.nodes,
          },
        }));

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
          type: "smoothstep",
          animated: false,
          style: { stroke: "#666", strokeWidth: 2 },
        }));

      return { nodes: flowNodes, edges: flowEdges };
    },
    [vscode, handleHighlightEdge, handleClearHighlight]
  ); // Dependencies từ data

  const renderGraph = useCallback(
    async (data: GraphData, fileName?: string) => {
      try {
        Logger.info("[FlowGraph] renderGraph called with data:", {
          nodes: data.nodes.length,
          edges: data.edges.length,
          fileName,
        });

        // Auto-detect framework
        if (fileName) {
          setCurrentFileName(fileName);
          const firstNode = data.nodes[0];
          const fileContent = firstNode?.code || "";
          const detected = detectFramework(fileName, fileContent);
          setDetectedFramework(detected);
          Logger.info("[FlowGraph] Detected framework:", {
            strategy: detected.strategy.description,
            rationale: detected.rationale,
          });
        }

        const { nodes: flowNodes, edges: flowEdges } = convertToFlowData(data);
        Logger.info("[FlowGraph] Converted to flow data:", {
          flowNodes: flowNodes.length,
          flowEdges: flowEdges.length,
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } =
          await getLayoutedElements(flowNodes, flowEdges, detectedFramework);
        Logger.info("[FlowGraph] Layout completed");

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        setIsLoading(false);
        setError(null);
        Logger.info("[FlowGraph] Graph rendered successfully");
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
      if (enableJumpToFile) {
        vscode.postMessage({
          command: "jumpToDefinition",
          file: node.data.file,
          line: node.data.line,
        });
      }
    },
    [vscode, enableJumpToFile]
  );

  const handleAutoSort = useCallback(async () => {
    if (!detectedFramework || isAutoSorting) return;

    setIsAutoSorting(true);
    Logger.info("[FlowGraph] Auto-sorting with detected framework:", {
      strategy: detectedFramework.strategy.description,
    });

    try {
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        await getLayoutedElements(nodes, edges, detectedFramework);

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);

      Logger.info("[FlowGraph] Auto-sort completed");
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

  useEffect(() => {
    Logger.info("[FlowGraph] Setting up message handler");

    const messageHandler = async (event: MessageEvent) => {
      Logger.info("[FlowGraph] Message received:", event.data?.command);
      const message = event.data;

      try {
        switch (message.command) {
          case "renderGraph":
            Logger.info("[FlowGraph] renderGraph command received");
            if (message.config) {
              setEnableJumpToFile(message.config.enableJumpToFile);
            }
            if (message.theme) {
              // Store theme in window instead of vscode object
              (window as any).__goflowTheme = message.theme;
              Logger.info("[FlowGraph] Theme received:", message.theme);
            }
            await renderGraph(message.data, message.data?.fileName);
            break;
          case "refresh":
            Logger.info("[FlowGraph] refresh command received");
            if (message.data) {
              await renderGraph(message.data, message.data?.fileName);
            }
            break;
          case "highlightEdge":
            Logger.info("[FlowGraph] highlightEdge command received", {
              sourceNodeId: message.sourceNodeId,
              targetNodeId: message.targetNodeId,
            });
            handleHighlightEdge(message.sourceNodeId, message.targetNodeId);
            break;
          case "clearHighlight":
            Logger.info("[FlowGraph] clearHighlight command received");
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
    Logger.info("[FlowGraph] Sending ready message to backend");
    vscode.postMessage({ command: "ready" });

    return () => {
      Logger.info("[FlowGraph] Cleaning up message handler");
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
        >
          <Background />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
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

          {/* Framework Info Panel */}
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
