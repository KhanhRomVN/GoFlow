import { GraphData } from "../../models/Node";
import { EdgeTracker, EdgeConnection } from "../utils/EdgeTracker";
import type {
  FlowNode,
  FlowEdge,
  FunctionNodeData,
  DeclarationNodeData,
  ConvertToFlowOptions,
  FlowConversionResult,
} from "../types/flowGraph";

/**
 * Pure transformation of raw GraphData into FlowNodes & FlowEdges.
 * Performs EdgeTracker side-effect (kept here for now).
 */
export default function convertToFlowData(
  data: GraphData,
  options: ConvertToFlowOptions
): FlowConversionResult {
  const {
    vscode,
    detectedDirection,
    lineHighlightedEdges,
    onHighlightEdge,
    onClearHighlight,
    onNodeHighlight,
    onClearNodeHighlight,
  } = options;

  const flowNodes: FlowNode[] = [];
  const edgeConnections: EdgeConnection[] = [];

  data.nodes.forEach((node) => {
    if (node.type === "function" || node.type === "method") {
      flowNodes.push({
        id: node.id,
        type: "functionNode" as const,
        position: { x: 0, y: 0 },
        draggable: false,
        data: {
          id: node.id,
          label: node.label,
          type: node.type as "function" | "method",
          file: node.file,
          line: node.line,
          endLine: node.endLine,
          code: node.code || "",
          vscode,
          onHighlightEdge,
          onClearHighlight,
          onNodeHighlight,
          onClearNodeHighlight,
          allNodes: data.nodes,
          lineHighlightedEdges,
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
          sourceHandle = detectedDirection === "LR" ? "right" : "bottom";
          targetHandle = detectedDirection === "LR" ? "left" : "top";
        } else if (edge.type === "uses") {
          sourceHandle = "right";
          targetHandle = "left";
        }
      } catch {
        // swallow
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
}
