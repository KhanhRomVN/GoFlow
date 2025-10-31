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
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import "../styles/common.css";
import "../styles/flow-graph.css";

import FunctionNode from "./FunctionNode";
import { GraphData } from "../../models/Node";

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

console.log(
  "[GoFlow Debug] FlowGraph - NodeTypes registered:",
  Object.keys(nodeTypes)
);

const FlowGraph: React.FC<FlowGraphProps> = ({ vscode }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [enableJumpToFile, setEnableJumpToFile] = useState(true);

  const getLayoutedElements = (
    nodes: FlowNode[],
    edges: FlowEdge[]
  ): { nodes: FlowNode[]; edges: FlowEdge[] } => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({
      rankdir: "LR",
      ranksep: 250,
      nodesep: 180,
      edgesep: 60,
      marginx: 80,
      marginy: 80,
    });

    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, {
        width: 650,
        height: 280,
      });
    });

    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - 325,
          y: nodeWithPosition.y - 140,
        },
        style: {
          width: "auto",
        },
      };
    });

    return { nodes: layoutedNodes, edges };
  };

  const convertToFlowData = (
    data: GraphData
  ): { nodes: FlowNode[]; edges: FlowEdge[] } => {
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
  };

  const renderGraph = useCallback(
    (data: GraphData) => {
      const { nodes: flowNodes, edges: flowEdges } = convertToFlowData(data);
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(flowNodes, flowEdges);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setIsLoading(false);
    },
    [setNodes, setEdges]
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
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "renderGraph":
          if (message.config) {
            setEnableJumpToFile(message.config.enableJumpToFile);
          }
          renderGraph(message.data);
          break;
        case "refresh":
          if (message.data) {
            renderGraph(message.data);
          }
          break;
      }
    };

    window.addEventListener("message", messageHandler);
    vscode.postMessage({ command: "ready" });

    return () => {
      window.removeEventListener("message", messageHandler);
    };
  }, [renderGraph, vscode]);

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "renderGraph":
          if (message.config) {
            setEnableJumpToFile(message.config.enableJumpToFile);
          }
          renderGraph(message.data);
          break;
        case "refresh":
          if (message.data) {
            renderGraph(message.data);
          }
          break;
      }
    };

    window.addEventListener("message", messageHandler);
    vscode.postMessage({ command: "ready" });

    return () => {
      window.removeEventListener("message", messageHandler);
    };
  }, [renderGraph, vscode]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {isLoading ? (
        <div className="loading-container">
          <div className="loading-text">Loading GoFlow Canvas...</div>
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
        </ReactFlow>
      )}
    </div>
  );
};

export default FlowGraph;
