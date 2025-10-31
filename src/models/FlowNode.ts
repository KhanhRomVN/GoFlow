import { Node, Edge } from "@xyflow/react";

export interface FunctionNodeData {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  code: string;
  isExpanded: boolean;
  previewLines: number;
  [key: string]: unknown;
}

export type FlowNode = Node<FunctionNodeData>;

export interface FlowEdgeData {
  source: string;
  target: string;
  type: "calls";
  [key: string]: unknown;
}

export type FlowEdge = Edge<FlowEdgeData>;

export interface FlowGraphData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  fileName: string;
}

export interface NodeColors {
  function: string;
  method: string;
}

export const NODE_COLORS: NodeColors = {
  function: "#4CAF50",
  method: "#2196F3",
};

export const DEFAULT_NODE_WIDTH = 320;
export const DEFAULT_NODE_HEIGHT = 180;
export const PREVIEW_LINES = 8;
