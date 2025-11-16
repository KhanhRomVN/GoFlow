import { useState, useCallback } from "react";
import { Edge, Node } from "@xyflow/react";
import { EdgeTracker } from "../utils/EdgeTracker";
import { Logger } from "../../utils/webviewLogger";
import type {
  FunctionNodeData,
  DeclarationNodeData,
  FlowEdge,
  FlowNode,
} from "../types/flowGraph";

/**
 * Encapsulates edge/node highlighting logic that was previously inline in FlowGraph.tsx.
 * This reduces cognitive load in the main component and keeps styling / state mutation cohesive.
 */
export interface UseGraphHighlightingParams {
  edges: FlowEdge[];
  nodes: FlowNode[];
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  isGraphReady: boolean;
  vscode: any;
}

export interface UseGraphHighlightingResult {
  lineHighlightedEdges: Set<string>;
  nodeHighlightedEdges: Set<string>;
  highlightedNodeId: string | null;
  handleHighlightEdge: (sourceNodeId: string, targetNodeId: string) => void;
  handleClearHighlight: () => void;
  handleNodeHighlight: (targetNodeId: string) => void;
  handleClearNodeHighlight: () => void;
}

/**
 * Derives original dash array (kept identical to previous logic).
 */
const getOriginalDashArray = (edge: FlowEdge): string | undefined => {
  if (edge.style?.strokeDasharray) return edge.style.strokeDasharray as string;
  if ((edge.data as any)?.dashed === true) return "8 4";
  if ((edge.data as any)?.hasReturnValue === false) return "8 4";
  return undefined;
};

export function useGraphHighlighting({
  edges,
  nodes,
  setEdges,
  setNodes,
  isGraphReady,
  vscode,
}: UseGraphHighlightingParams): UseGraphHighlightingResult {
  const [lineHighlightedEdges, setLineHighlightedEdges] = useState<Set<string>>(
    new Set()
  );
  const [nodeHighlightedEdges, setNodeHighlightedEdges] = useState<Set<string>>(
    new Set()
  );
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(
    null
  );

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
    [nodeHighlightedEdges, setEdges]
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
  }, [nodeHighlightedEdges, setEdges]);

  const handleNodeHighlight = useCallback(
    (targetNodeId: string) => {
      if (!isGraphReady || edges.length === 0 || nodes.length === 0) {
        // Defer using window global (keeps behavior parity with original code)
        (window as any).__goflowPendingNodeHighlight = targetNodeId;
        Logger.debug(
          `[useGraphHighlighting] Graph not ready, queued highlight for ${targetNodeId}`
        );
        return;
      }

      const incomingEdges = edges.filter((e) => e.target === targetNodeId);
      const edgeKeys = new Set(
        incomingEdges.map((e) => `${e.source}->${e.target}`)
      );
      setNodeHighlightedEdges(edgeKeys);
      setHighlightedNodeId(targetNodeId);

      // Trace path to root (unchanged logic)
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

      // Update edges styling
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

      // Update node visuals
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
      setEdges,
      setNodes,
      lineHighlightedEdges,
      vscode,
    ]
  );

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
  }, [lineHighlightedEdges, setEdges, setNodes]);

  return {
    lineHighlightedEdges,
    nodeHighlightedEdges,
    highlightedNodeId,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleClearNodeHighlight,
  };
}

export default useGraphHighlighting;
