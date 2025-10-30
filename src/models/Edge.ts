export interface Edge {
  source: string;
  target: string;
  type: "calls" | "uses" | "implements" | "returns" | "receives";
  label?: string;
}

export interface EdgeStyle {
  color?: string;
  width?: number;
  style?: "solid" | "dashed" | "dotted";
}

export function createEdge(
  source: string,
  target: string,
  type: Edge["type"],
  label?: string
): Edge {
  return { source, target, type, label };
}

export function getEdgeStyle(type: Edge["type"]): EdgeStyle {
  switch (type) {
    case "calls":
      return { color: "#666", width: 2, style: "solid" };
    case "uses":
      return { color: "#999", width: 1, style: "dashed" };
    case "implements":
      return { color: "#9C27B0", width: 2, style: "dotted" };
    case "returns":
      return { color: "#4CAF50", width: 1, style: "dashed" };
    case "receives":
      return { color: "#2196F3", width: 1, style: "dashed" };
    default:
      return { color: "#666", width: 1, style: "solid" };
  }
}
