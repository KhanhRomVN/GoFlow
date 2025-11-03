import dagre from "dagre";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";
import { Node, Edge } from "@xyflow/react";
import { LayoutStrategy } from "../configs/layoutStrategies";

const elk = new ELK();

// ==================== CONSTANTS ====================
const FILE_GROUP_PADDING = 60; // Padding inside file group container
const FILE_GROUP_MARGIN = 120; // Margin between file group containers
const CODE_NODE_WIDTH = 850;
const CODE_NODE_HEIGHT = 320;

// ==================== HELPER: GROUP NODES BY FILE ====================
interface FileGroup {
  fileName: string;
  nodes: Node[];
  edges: Edge[]; // Edges nội bộ trong group
}

function groupNodesByFile(nodes: Node[], edges: Edge[]): FileGroup[] {
  const nodesByFile = new Map<string, Node[]>();

  // Group FunctionNodes by file
  nodes.forEach((node) => {
    if (node.type === "functionNode") {
      const file = (node.data as any).file;
      if (!nodesByFile.has(file)) {
        nodesByFile.set(file, []);
      }
      nodesByFile.get(file)!.push(node);
    }
  });

  // Group DeclarationNodes by caller's file
  nodes.forEach((node) => {
    if (node.type === "declarationNode") {
      const declData = node.data as any;
      const usedBy = declData.usedBy || [];

      // Tìm caller FunctionNode đầu tiên
      const callerNode = nodes.find(
        (n) => n.type === "functionNode" && usedBy.includes(n.id)
      );

      if (callerNode) {
        const callerFile = (callerNode.data as any).file;
        if (!nodesByFile.has(callerFile)) {
          nodesByFile.set(callerFile, []);
        }
        nodesByFile.get(callerFile)!.push(node);
      }
    }
  });

  // Create file groups with internal edges
  const fileGroups: FileGroup[] = [];
  nodesByFile.forEach((groupNodes, fileName) => {
    const nodeIds = new Set(groupNodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    fileGroups.push({
      fileName,
      nodes: groupNodes,
      edges: internalEdges,
    });
  });

  return fileGroups;
}

// ==================== HELPER: CALCULATE CROSS-FILE EDGES ====================
function getCrossFileEdges(groups: FileGroup[], allEdges: Edge[]): Edge[] {
  const allNodeIds = new Set<string>();
  groups.forEach((group) => {
    group.nodes.forEach((node) => allNodeIds.add(node.id));
  });

  const crossFileEdges = allEdges.filter((edge) => {
    const sourceGroup = groups.find((g) =>
      g.nodes.some((n) => n.id === edge.source)
    );
    const targetGroup = groups.find((g) =>
      g.nodes.some((n) => n.id === edge.target)
    );

    return (
      sourceGroup &&
      targetGroup &&
      sourceGroup.fileName !== targetGroup.fileName
    );
  });

  return crossFileEdges;
}

// ==================== HELPER: PLACE DECLARATION NODES NEAR CALLERS ====================
// ==================== HELPER: PLACE DECLARATION NODES NEAR CALLERS ====================
// ==================== HELPER: PLACE DECLARATION NODES NEAR CALLERS ====================
function placeDeclarationNodesNearCallers(
  functionNodes: Node[],
  declarationNodes: Node[],
  edges: Edge[]
): Node[] {
  const positionedDeclarations: Node[] = [];

  // Group declarations by caller to stack them vertically if multiple declarations per function
  const declarationsByFunction = new Map<string, Node[]>();

  declarationNodes.forEach((declNode, declIndex) => {
    // CRITICAL DEBUG: Check if this declaration has ANY incoming edges
    const allIncomingEdges = edges.filter(
      (edge) => edge.target === declNode.id
    );

    // Tìm FunctionNode sử dụng DeclarationNode này (edge type = "uses")
    const callerEdge = edges.find(
      (edge) => edge.target === declNode.id && edge.type === "uses"
    );

    if (callerEdge) {
      const callerNode = functionNodes.find((n) => n.id === callerEdge.source);

      if (callerNode) {
        if (!declarationsByFunction.has(callerNode.id)) {
          declarationsByFunction.set(callerNode.id, []);
        }
        declarationsByFunction.get(callerNode.id)!.push(declNode);
      } else {
        console.warn(`   ⚠️ Caller node not found: ${callerEdge.source}`);
      }
    } else {
      // Fallback: nếu không tìm thấy caller, đặt ở vị trí mặc định (góc trên trái)
      console.warn(
        `   ⚠️ No caller edge found - placing at default position (0, 0)`
      );
      console.warn(
        `   🔍 Expected edge pattern: <any_function_id> -> ${declNode.id} with type="uses"`
      );
      positionedDeclarations.push({
        ...declNode,
        position: { x: 0, y: 0 },
        zIndex: 5,
      });
    }
  });

  // Đặt declarations theo từng function caller
  let globalDeclarationIndex = 0;

  declarationsByFunction.forEach((declarations, functionId) => {
    const callerNode = functionNodes.find((n) => n.id === functionId);
    if (!callerNode) {
      console.error(`   ❌ Caller node not found for ${functionId}`);
      return;
    }

    const offsetX = 120; // Khoảng cách ngang từ FunctionNode
    const baseOffsetY = -50; // Offset ban đầu theo chiều dọc
    const stackSpacing = 220; // Khoảng cách giữa các declarations (DeclarationNode height ~200px)

    declarations.forEach((declNode, index) => {
      const yPosition =
        callerNode.position.y + baseOffsetY + index * stackSpacing;
      const xPosition = callerNode.position.x + CODE_NODE_WIDTH + offsetX;

      const positionedNode = {
        ...declNode,
        position: {
          x: xPosition,
          y: yPosition,
        },
        zIndex: 5,
        style: {
          ...declNode.style,
          width: 350,
          height: 200,
        },
      };

      positionedDeclarations.push(positionedNode);
      globalDeclarationIndex++;
    });
  });

  // CRITICAL CHECK: Kiểm tra duplicate positions
  const positionMap = new Map<string, Node[]>();
  positionedDeclarations.forEach((node) => {
    const posKey = `${node.position.x},${node.position.y}`;
    if (!positionMap.has(posKey)) {
      positionMap.set(posKey, []);
    }
    positionMap.get(posKey)!.push(node);
  });

  let hasDuplicates = false;
  positionMap.forEach((nodes, position) => {
    if (nodes.length > 1) {
      hasDuplicates = true;
      console.error(`   ❌ DUPLICATE POSITION DETECTED: ${position}`);
      console.error(`      ${nodes.length} nodes at same position:`);
      nodes.forEach((node) => {
        console.error(`         - ${node.id} (${(node.data as any).label})`);
      });
    }
  });

  return positionedDeclarations;
}

// ==================== DAGRE ====================
function layoutGroupWithDagre(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): Node[] {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const direction = strategy.direction || "TB";
  dagreGraph.setGraph({
    rankdir: direction,
    ranksep: strategy.ranksep || 120,
    nodesep: strategy.nodesep || 80,
    edgesep: 40,
    marginx: FILE_GROUP_PADDING,
    marginy: FILE_GROUP_PADDING,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: CODE_NODE_WIDTH,
      height: CODE_NODE_HEIGHT,
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
        x: nodeWithPosition.x - CODE_NODE_WIDTH / 2,
        y: nodeWithPosition.y - CODE_NODE_HEIGHT / 2,
      },
    };
  });

  return layoutedNodes;
}

export function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): { nodes: Node[]; edges: Edge[] } {
  const fileGroups = groupNodesByFile(nodes, edges);
  const crossFileEdges = getCrossFileEdges(fileGroups, edges);

  // Step 1: Layout nodes within each file group
  const layoutedGroups = fileGroups.map((group) => ({
    ...group,
    nodes: layoutGroupWithDagre(group.nodes, group.edges, strategy),
  }));

  // Step 2: Calculate bounding box for each group
  interface GroupBounds {
    fileName: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    nodes: Node[];
  }

  const groupBounds: GroupBounds[] = layoutedGroups.map((group) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    group.nodes.forEach((node) => {
      const x = node.position.x;
      const y = node.position.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CODE_NODE_WIDTH);
      maxY = Math.max(maxY, y + CODE_NODE_HEIGHT);
    });

    return {
      fileName: group.fileName,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      nodes: group.nodes,
    };
  });

  // Step 3: Layout file groups as super-nodes using Dagre
  const superGraph = new dagre.graphlib.Graph();
  superGraph.setDefaultEdgeLabel(() => ({}));

  const direction = strategy.direction || "TB";
  superGraph.setGraph({
    rankdir: direction,
    ranksep: FILE_GROUP_MARGIN,
    nodesep: FILE_GROUP_MARGIN,
    edgesep: FILE_GROUP_MARGIN / 2,
  });

  groupBounds.forEach((bounds) => {
    superGraph.setNode(bounds.fileName, {
      width: bounds.width + FILE_GROUP_PADDING * 2,
      height: bounds.height + FILE_GROUP_PADDING * 2,
    });
  });

  // Add edges between file groups
  crossFileEdges.forEach((edge) => {
    const sourceGroup = groupBounds.find((g) =>
      g.nodes.some((n) => n.id === edge.source)
    );
    const targetGroup = groupBounds.find((g) =>
      g.nodes.some((n) => n.id === edge.target)
    );

    if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
      superGraph.setEdge(sourceGroup.fileName, targetGroup.fileName);
    }
  });

  dagre.layout(superGraph);

  // Step 4: Position file groups and adjust node positions
  const finalFunctionNodes: Node[] = [];
  const declarationNodes = nodes.filter((n) => n.type === "declarationNode");

  groupBounds.forEach((bounds) => {
    const superNode = superGraph.node(bounds.fileName);
    const groupOffsetX =
      superNode.x - (bounds.width + FILE_GROUP_PADDING * 2) / 2;
    const groupOffsetY =
      superNode.y - (bounds.height + FILE_GROUP_PADDING * 2) / 2;

    // Adjust ONLY FunctionNodes in this group (filter out DeclarationNodes)
    bounds.nodes.forEach((node) => {
      if (node.type === "functionNode") {
        finalFunctionNodes.push({
          ...node,
          position: {
            x:
              node.position.x - bounds.minX + groupOffsetX + FILE_GROUP_PADDING,
            y:
              node.position.y - bounds.minY + groupOffsetY + FILE_GROUP_PADDING,
          },
        });
      }
    });
  });

  // CRITICAL: Place DeclarationNodes AFTER FunctionNodes have been positioned
  const positionedDeclarations = placeDeclarationNodesNearCallers(
    finalFunctionNodes,
    declarationNodes,
    edges
  );

  const finalNodes = [...finalFunctionNodes, ...positionedDeclarations];

  return { nodes: finalNodes, edges };
}

// ==================== ELK LAYERED ====================
async function layoutGroupWithELK(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): Promise<Node[]> {
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
      "elk.padding": `[top=${FILE_GROUP_PADDING},left=${FILE_GROUP_PADDING},bottom=${FILE_GROUP_PADDING},right=${FILE_GROUP_PADDING}]`,
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: CODE_NODE_WIDTH,
      height: CODE_NODE_HEIGHT,
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

  return layoutedNodes;
}

export async function layoutWithELK(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const fileGroups = groupNodesByFile(nodes, edges);
  const crossFileEdges = getCrossFileEdges(fileGroups, edges);

  // Step 1: Layout nodes within each file group
  const layoutedGroups = await Promise.all(
    fileGroups.map(async (group) => ({
      ...group,
      nodes: await layoutGroupWithELK(group.nodes, group.edges, strategy),
    }))
  );

  // Step 2: Calculate bounding boxes (same as Dagre)
  interface GroupBounds {
    fileName: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    nodes: Node[];
  }

  const groupBounds: GroupBounds[] = layoutedGroups.map((group) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    group.nodes.forEach((node) => {
      const x = node.position.x;
      const y = node.position.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CODE_NODE_WIDTH);
      maxY = Math.max(maxY, y + CODE_NODE_HEIGHT);
    });

    return {
      fileName: group.fileName,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      nodes: group.nodes,
    };
  });

  // Step 3: Layout file groups using ELK
  const superGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": strategy.direction || "DOWN",
      "elk.spacing.nodeNode": String(FILE_GROUP_MARGIN),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(FILE_GROUP_MARGIN),
    },
    children: groupBounds.map((bounds) => ({
      id: bounds.fileName,
      width: bounds.width + FILE_GROUP_PADDING * 2,
      height: bounds.height + FILE_GROUP_PADDING * 2,
    })),
    edges: crossFileEdges
      .map((edge) => {
        const sourceGroup = groupBounds.find((g) =>
          g.nodes.some((n) => n.id === edge.source)
        );
        const targetGroup = groupBounds.find((g) =>
          g.nodes.some((n) => n.id === edge.target)
        );

        if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
          return {
            id: `${sourceGroup.fileName}-${targetGroup.fileName}`,
            sources: [sourceGroup.fileName],
            targets: [targetGroup.fileName],
          };
        }
        return null;
      })
      .filter((e) => e !== null) as any[],
  };

  const layoutedSuperGraph = await elk.layout(superGraph);

  // Step 4: Position file groups and adjust node positions
  const finalFunctionNodes: Node[] = [];
  const declarationNodes = nodes.filter((n) => n.type === "declarationNode");

  groupBounds.forEach((bounds) => {
    const superNode = layoutedSuperGraph.children?.find(
      (n) => n.id === bounds.fileName
    );
    const groupOffsetX = (superNode?.x || 0) + FILE_GROUP_PADDING;
    const groupOffsetY = (superNode?.y || 0) + FILE_GROUP_PADDING;

    // Adjust ONLY FunctionNodes in this group
    bounds.nodes.forEach((node) => {
      if (node.type === "functionNode") {
        finalFunctionNodes.push({
          ...node,
          position: {
            x: node.position.x - bounds.minX + groupOffsetX,
            y: node.position.y - bounds.minY + groupOffsetY,
          },
        });
      }
    });
  });

  // CRITICAL: Place DeclarationNodes AFTER FunctionNodes have been positioned
  const positionedDeclarations = placeDeclarationNodesNearCallers(
    finalFunctionNodes,
    declarationNodes,
    edges
  );

  const finalNodes = [...finalFunctionNodes, ...positionedDeclarations];

  return { nodes: finalNodes, edges };
}

// ==================== D3 FORCE ====================
export function layoutWithD3Force(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): { nodes: Node[]; edges: Edge[] } {
  const fileGroups = groupNodesByFile(nodes, edges);
  const crossFileEdges = getCrossFileEdges(fileGroups, edges);

  // Step 1: Layout each file group independently
  const layoutedGroups = fileGroups.map((group) => {
    const simulation = forceSimulation(group.nodes as any)
      .force(
        "link",
        forceLink(group.edges as any)
          .id((d: any) => d.id)
          .distance(150)
      )
      .force("charge", forceManyBody().strength(-800))
      .force("center", forceCenter(0, 0))
      .force("collision", forceCollide(CODE_NODE_WIDTH / 2 + 40))
      .stop();

    // Run simulation
    for (let i = 0; i < 300; i++) {
      simulation.tick();
    }

    return {
      ...group,
      nodes: group.nodes.map((node: any) => ({
        ...node,
        position: { x: node.x || 0, y: node.y || 0 },
      })),
    };
  });

  // Step 2: Calculate bounding boxes
  interface GroupBounds {
    fileName: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    nodes: Node[];
    centerX: number;
    centerY: number;
  }

  const groupBounds: GroupBounds[] = layoutedGroups.map((group) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    group.nodes.forEach((node) => {
      const x = node.position.x;
      const y = node.position.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CODE_NODE_WIDTH);
      maxY = Math.max(maxY, y + CODE_NODE_HEIGHT);
    });

    return {
      fileName: group.fileName,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      nodes: group.nodes,
    };
  });

  // Step 3: Create super-nodes for file groups
  const superNodes = groupBounds.map((bounds) => ({
    id: bounds.fileName,
    x: 0,
    y: 0,
    width: bounds.width + FILE_GROUP_PADDING * 2,
    height: bounds.height + FILE_GROUP_PADDING * 2,
    bounds,
  }));

  // Step 4: Apply force simulation to super-nodes
  const superLinks = crossFileEdges
    .map((edge) => {
      const sourceGroup = groupBounds.find((g) =>
        g.nodes.some((n) => n.id === edge.source)
      );
      const targetGroup = groupBounds.find((g) =>
        g.nodes.some((n) => n.id === edge.target)
      );

      if (sourceGroup && targetGroup) {
        return {
          source: sourceGroup.fileName,
          target: targetGroup.fileName,
        };
      }
      return null;
    })
    .filter((link) => link !== null) as Array<{
    source: string;
    target: string;
  }>;

  const superSimulation = forceSimulation(superNodes as any)
    .force(
      "link",
      forceLink(superLinks)
        .id((d: any) => d.id)
        .distance(400)
    )
    .force("charge", forceManyBody().strength(-2000))
    .force("center", forceCenter(0, 0))
    .force(
      "collision",
      forceCollide(
        (d: any) => Math.max(d.width, d.height) / 2 + FILE_GROUP_MARGIN
      )
    )
    .stop();

  for (let i = 0; i < 300; i++) {
    superSimulation.tick();
  }

  // Step 5: Position all nodes based on super-node positions
  const finalFunctionNodes: Node[] = [];
  const declarationNodes = nodes.filter((n) => n.type === "declarationNode");

  superNodes.forEach((superNode: any) => {
    const bounds = superNode.bounds;
    const offsetX = superNode.x - bounds.centerX;
    const offsetY = superNode.y - bounds.centerY;

    // Adjust ONLY FunctionNodes
    bounds.nodes.forEach((node: Node) => {
      if (node.type === "functionNode") {
        finalFunctionNodes.push({
          ...node,
          position: {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY,
          },
        });
      }
    });
  });

  // CRITICAL: Place DeclarationNodes AFTER FunctionNodes have been positioned
  const positionedDeclarations = placeDeclarationNodesNearCallers(
    finalFunctionNodes,
    declarationNodes,
    edges
  );

  const finalNodes = [...finalFunctionNodes, ...positionedDeclarations];

  return { nodes: finalNodes, edges };
}

// ==================== MAIN DISPATCHER ====================
export async function applyLayout(
  nodes: Node[],
  edges: Edge[],
  strategy: LayoutStrategy
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  // Update edge styles - PRESERVE ORIGINAL EDGE TYPE (CRITICAL for "uses" edges)
  const styledEdges = edges.map((edge) => ({
    ...edge,
    // CRITICAL: KHÔNG override edge.type nếu đã có (giữ "uses", "calls", v.v.)
    // Chỉ set default type nếu edge.type === undefined
    type: edge.type || strategy.edgeType,
    style: {
      ...edge.style,
      stroke: edge.style?.stroke || "#666",
      strokeWidth: edge.style?.strokeWidth || 2,
      strokeLinecap: (edge.style?.strokeLinecap || "round") as
        | "round"
        | "butt"
        | "square",
      strokeLinejoin: "round" as const,
    },
  }));

  let result;
  switch (strategy.algorithm) {
    case "dagre":
      result = layoutWithDagre(nodes, styledEdges, strategy);
      break;
    case "elk-layered":
    case "elk-force":
    case "elk-box":
      result = await layoutWithELK(nodes, styledEdges, strategy);
      break;
    case "d3-force":
      result = layoutWithD3Force(nodes, styledEdges, strategy);
      break;
    default:
      console.warn(
        `❓ [LayoutEngine] Unknown algorithm: ${strategy.algorithm}, using default`
      );
      result = { nodes, edges: styledEdges };
  }

  return result;
}
