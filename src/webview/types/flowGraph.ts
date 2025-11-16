import type { Node, Edge } from "@xyflow/react";
import type { GraphData } from "../../models/Node";

/**
 * Data payload for a function/method node rendered in the flow graph.
 */
export interface FunctionNodeData extends Record<string, unknown> {
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

/**
 * Data payload for a declaration node (class / struct / interface / enum / type).
 */
export interface DeclarationNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  type: "class" | "struct" | "interface" | "enum" | "type";
  file: string;
  line: number;
  code: string;
  language?: string;
  usedBy?: any[];
}

/**
 * Unified flow node union type used by ReactFlow state.
 */
export type FlowNode = Node<FunctionNodeData> | Node<DeclarationNodeData>;

/**
 * Flow edge type alias (currently no custom data shape enforced here).
 */
export type FlowEdge = Edge;

/**
 * Props for the FlowGraph root component.
 */
export interface FlowGraphProps {
  vscode: any;
}

/**
 * Options passed to convert raw GraphData into FlowNodes/FlowEdges.
 * This isolates side-effectful callbacks from the pure transformation logic.
 */
export interface ConvertToFlowOptions {
  vscode: any;
  detectedDirection?: "TB" | "LR" | string;
  lineHighlightedEdges: Set<string>;
  onHighlightEdge?: (sourceId: string, targetId: string) => void;
  onClearHighlight?: () => void;
  onNodeHighlight?: (nodeId: string) => void;
  onClearNodeHighlight?: () => void;
}

/**
 * Result structure for conversion.
 */
export interface FlowConversionResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Public signature for conversion helper (implemented elsewhere).
 */
export type ConvertToFlowFn = (
  data: GraphData,
  options: ConvertToFlowOptions
) => FlowConversionResult;
