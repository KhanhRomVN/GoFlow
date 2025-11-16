import { FrameworkConfig } from "../configs/layoutStrategies";
import { applyLayout } from "./layoutEngines";
import type {
  FlowNode,
  FlowEdge,
  FunctionNodeData,
  DeclarationNodeData,
} from "../types/flowGraph";

/**
 * Build file group container nodes around existing laid-out nodes.
 * Each container wraps all function/declaration nodes belonging to the same file.
 */
export function calculateFileGroupContainers(nodes: FlowNode[]): FlowNode[] {
  const containerNodes: FlowNode[] = [];
  const nodesByFile = new Map<string, FlowNode[]>();

  nodes.forEach((node) => {
    let file: string;
    if (node.type === "functionNode") {
      file = (node.data as FunctionNodeData).file;
    } else if (node.type === "declarationNode") {
      const declData = node.data as DeclarationNodeData;
      const usedBy = declData.usedBy || [];
      // Attempt to infer grouping file based on a caller (fallback to declaration file)
      const callerNode = nodes.find(
        (n) => n.type === "functionNode" && usedBy.includes(n.id)
      );
      file = callerNode
        ? (callerNode.data as FunctionNodeData).file
        : (declData.file as string);
    } else {
      return;
    }
    if (!nodesByFile.has(file)) nodesByFile.set(file, []);
    nodesByFile.get(file)!.push(node);
  });

  nodesByFile.forEach((fileNodes, file) => {
    if (fileNodes.length === 0) return;
    const padding = 60;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    fileNodes.forEach((node) => {
      let nodeWidth: number;
      let nodeHeight: number;
      if (node.type === "functionNode") {
        nodeWidth = (node.style?.width as number) || 650;
        nodeHeight = (node.style?.height as number) || 320;
      } else if (node.type === "declarationNode") {
        nodeWidth = (node.style?.width as number) || 350;
        nodeHeight = (node.style?.height as number) || 200;
      } else {
        nodeWidth = 650;
        nodeHeight = 320;
      }
      const x = node.position.x;
      const y = node.position.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + nodeWidth);
      maxY = Math.max(maxY, y + nodeHeight);
    });

    const containerWidth = maxX - minX + padding * 2;
    const containerHeight = maxY - minY + padding * 2;
    const functionNodeCount = fileNodes.filter(
      (n) => n.type === "functionNode"
    ).length;
    const declarationNodeCount = fileNodes.filter(
      (n) => n.type === "declarationNode"
    ).length;

    containerNodes.push({
      id: `container-${file}`,
      type: "fileGroupContainer" as const,
      position: { x: minX - padding, y: minY - padding },
      data: {
        fileName: file,
        nodeCount: fileNodes.length,
        functionNodeCount,
        declarationNodeCount,
        width: containerWidth,
        height: containerHeight,
      } as any,
      draggable: false,
      selectable: false,
      zIndex: 0,
      style: { width: containerWidth, height: containerHeight },
    } as FlowNode);
  });

  return containerNodes;
}

/**
 * Apply graph layout algorithm (dagre default) and then wrap nodes with file group containers.
 */
export async function getLayoutedElements(
  nodes: FlowNode[],
  edges: FlowEdge[],
  framework?: FrameworkConfig | null
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  const strategy = framework?.strategy || {
    algorithm: "dagre" as const,
    direction: "TB" as const,
    edgeType: "default" as const,
    ranksep: 150,
    nodesep: 100,
    description: "Default Layout",
  };
  const layouted = await applyLayout(nodes, edges, strategy);
  const flowNodes = layouted.nodes as FlowNode[];
  const containers = calculateFileGroupContainers(flowNodes);
  return { nodes: [...containers, ...flowNodes], edges: layouted.edges };
}
