import dagre from "dagre";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from "d3-force";
import { Node, Edge } from "@xyflow/react";
import { LayoutStrategy } from "../configs/layoutStrategies";

const elk = new ELK();

// ==================== DAGRE ====================
export function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const direction = strategy.direction || "TB";
  dagreGraph.setGraph({
    rankdir: direction,
    ranksep: strategy.ranksep || 120,
    nodesep: strategy.nodesep || 80,
    edgesep: 40,
    marginx: 60,
    marginy: 60,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 850, height: 320 });
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
        x: nodeWithPosition.x - 425,
        y: nodeWithPosition.y - 160,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ==================== ELK LAYERED ====================
export async function layoutWithELK(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": strategy.algorithm === "elk-force" ? "force" : "layered",
      "elk.direction": strategy.direction || "DOWN",
      "elk.spacing.nodeNode": String(strategy.nodesep || 80),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        strategy.ranksep || 120
      ),
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: 850,
      height: 320,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layoutedGraph = await elk.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);
    return {
      ...node,
      position: {
        x: elkNode?.x || 0,
        y: elkNode?.y || 0,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ==================== D3 FORCE ====================
export function layoutWithD3Force(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): { nodes: Node[]; edges: Edge[] } {
  const simulation = forceSimulation(nodes as any)
    .force(
      "link",
      forceLink(edges as any)
        .id((d: any) => d.id)
        .distance(150)
    )
    .force("charge", forceManyBody().strength(-1000))
    .force("center", forceCenter(400, 300))
    .stop();

  // Run simulation synchronously
  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  const layoutedNodes = nodes.map((node: any) => ({
    ...node,
    position: { x: node.x || 0, y: node.y || 0 },
  }));

  return { nodes: layoutedNodes, edges };
}

// ==================== MAIN DISPATCHER ====================
export async function applyLayout(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  // Update edge types
  const styledEdges = edges.map((edge) => ({
    ...edge,
    type: strategy.edgeType,
    style: {
      stroke: "#666",
      strokeWidth: 2,
    },
  }));

  switch (strategy.algorithm) {
    case "dagre":
      return layoutWithDagre(nodes, styledEdges, strategy);
    case "elk-layered":
    case "elk-force":
    case "elk-box":
      return await layoutWithELK(nodes, styledEdges, strategy);
    case "d3-force":
      return layoutWithD3Force(nodes, styledEdges, strategy);
    default:
      return { nodes, edges: styledEdges };
  }
}
