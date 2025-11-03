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
const FILE_GROUP_PADDING = 80;
const FILE_GROUP_MARGIN = 200;
const CODE_NODE_WIDTH = 850;
const CODE_NODE_MIN_HEIGHT = 206; // ✅ Minimum height cho auto-fit nodes
const CODE_NODE_DEFAULT_HEIGHT = 320; // ✅ Default height for layout calculations
const DECLARATION_NODE_WIDTH = 350;
const DECLARATION_NODE_HEIGHT = 200;
const MIN_NODE_SPACING = 40;
const DECLARATION_GRID_COLUMNS = 2;
const DECLARATION_GRID_SPACING = 60;
const MIN_CONTAINER_SPACING = 100;

// ==================== HELPER: GROUP NODES BY FILE ====================
interface FileGroup {
  fileName: string;
  nodes: Node[];
  edges: Edge[]; // Edges nội bộ trong group
}

function groupNodesByFile(nodes: Node[], edges: Edge[]): FileGroup[] {
  const nodesByFile = new Map<string, Node[]>();

  // STEP 1: Group FunctionNodes by file
  nodes.forEach((node) => {
    if (node.type === "functionNode") {
      const file = (node.data as any).file;
      if (!nodesByFile.has(file)) {
        nodesByFile.set(file, []);
      }
      nodesByFile.get(file)!.push(node);
    }
  });

  // STEP 2: CRITICAL FIX - Group DeclarationNodes by CALLER's file
  nodes.forEach((node) => {
    if (node.type === "declarationNode") {
      const declData = node.data as any;
      const usedBy = declData.usedBy || [];

      // CRITICAL: Tìm caller FunctionNode đầu tiên
      const callerNode = nodes.find(
        (n) => n.type === "functionNode" && usedBy.includes(n.id)
      );

      if (callerNode) {
        const callerFile = (callerNode.data as any).file;

        if (!nodesByFile.has(callerFile)) {
          nodesByFile.set(callerFile, []);
        }
        nodesByFile.get(callerFile)!.push(node);
      } else {
        // Fallback: đặt vào file của chính declaration node
        const declFile = (node.data as any).file;
        if (!nodesByFile.has(declFile)) {
          nodesByFile.set(declFile, []);
        }
        nodesByFile.get(declFile)!.push(node);
      }
    }
  });

  // STEP 3: Create file groups với internal edges
  const fileGroups: FileGroup[] = [];
  nodesByFile.forEach((groupNodes, fileName) => {
    const nodeIds = new Set(groupNodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    // THÊM LOG ĐẾM SỐ LƯỢNG NODE
    const functionCount = groupNodes.filter(
      (n) => n.type === "functionNode"
    ).length;
    const declarationCount = groupNodes.filter(
      (n) => n.type === "declarationNode"
    ).length;

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

// ==================== HELPER: CHECK RECTANGLE OVERLAP ====================
function rectanglesOverlap(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    rect1.x < rect2.x + rect2.width + MIN_NODE_SPACING &&
    rect1.x + rect1.width + MIN_NODE_SPACING > rect2.x &&
    rect1.y < rect2.y + rect2.height + MIN_NODE_SPACING &&
    rect1.y + rect1.height + MIN_NODE_SPACING > rect2.y
  );
}

// ==================== HELPER: CHECK POSITION OCCUPIED ====================
function isPositionOccupied(
  x: number,
  y: number,
  width: number,
  height: number,
  occupiedPositions: Map<
    string,
    { x: number; y: number; width: number; height: number }
  >,
  functionNodes: Node[],
  existingDeclarations: Node[]
): boolean {
  const newRect = { x, y, width, height };

  // Check against occupied positions
  for (const [_, occupied] of occupiedPositions) {
    if (rectanglesOverlap(newRect, occupied)) {
      return true;
    }
  }

  // Check against existing declaration nodes
  for (const declNode of existingDeclarations) {
    const declRect = {
      x: declNode.position.x,
      y: declNode.position.y,
      width: DECLARATION_NODE_WIDTH,
      height: DECLARATION_NODE_HEIGHT,
    };

    if (rectanglesOverlap(newRect, declRect)) {
      return true;
    }
  }

  return false;
}

// ==================== HELPER: FIND OPTIMAL POSITION ====================
function findOptimalPosition(
  preferredX: number,
  preferredY: number,
  width: number,
  height: number,
  occupiedPositions: Map<
    string,
    { x: number; y: number; width: number; height: number }
  >,
  functionNodes: Node[],
  existingDeclarations: Node[]
): { x: number; y: number } {
  let x = preferredX;
  let y = preferredY;

  // ✅ THÊM: Validate input trước khi xử lý
  if (!isFinite(x) || !isFinite(y)) {
    console.warn(
      `[findOptimalPosition] Invalid input position: x=${x}, y=${y} - using fallback`
    );
    x = 100;
    y = 100;
  }

  const maxAttempts = 12;
  let attempts = 0;

  while (
    attempts < maxAttempts &&
    isPositionOccupied(
      x,
      y,
      width,
      height,
      occupiedPositions,
      functionNodes,
      existingDeclarations
    )
  ) {
    const spiralStep = Math.floor(attempts / 4) + 1;
    const spiralDirection = attempts % 4;

    switch (spiralDirection) {
      case 0:
        x = preferredX + spiralStep * (width + MIN_NODE_SPACING);
        break;
      case 1:
        y = preferredY + spiralStep * (height + MIN_NODE_SPACING);
        break;
      case 2:
        x = preferredX - spiralStep * (width + MIN_NODE_SPACING);
        break;
      case 3:
        y = preferredY - spiralStep * (height + MIN_NODE_SPACING);
        break;
    }

    attempts++;
  }

  if (attempts >= maxAttempts) {
    let maxX = -Infinity;
    let baseY = preferredY;

    functionNodes.forEach((node) => {
      const nodeX =
        node.position.x + ((node.style?.width as number) || CODE_NODE_WIDTH);
      if (nodeX > maxX) {
        maxX = nodeX;
        baseY = node.position.y;
      }
    });

    if (maxX > -Infinity) {
      x = maxX + MIN_NODE_SPACING;
      y = baseY;
    } else {
      x = preferredX + 500;
      y = preferredY + 100;
    }
  }

  // ✅ THÊM: Validate output trước khi return
  if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0) {
    console.warn(
      `[findOptimalPosition] Invalid output position: x=${x}, y=${y} - using safe fallback`
    );
    return { x: 100, y: 100 };
  }

  return { x, y };
}

// ==================== ENHANCED: PLACE DECLARATION NODES NEAR CALLERS ====================
function placeDeclarationNodesNearCallers(
  functionNodes: Node[],
  declarationNodes: Node[],
  edges: Edge[]
): Node[] {
  const positionedDeclarations: Node[] = [];
  const occupiedPositions = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();

  // Mark all function node positions as occupied
  functionNodes.forEach((node) => {
    const nodeWidth = (node.style?.width as number) || CODE_NODE_WIDTH;
    const nodeHeight =
      (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT;
    occupiedPositions.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      width: nodeWidth,
      height: nodeHeight,
    });
  });

  const declarationsByFunction = new Map<string, Node[]>();

  // Group declarations by caller function
  declarationNodes.forEach((declNode) => {
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
      }
    }
  });

  // Place declarations for each function
  declarationsByFunction.forEach((declarations, functionId) => {
    const callerNode = functionNodes.find((n) => n.id === functionId);
    if (!callerNode) return;

    const callerX = callerNode.position.x;
    const callerY = callerNode.position.y;
    const callerWidth = (callerNode.style?.width as number) || CODE_NODE_WIDTH;
    const callerHeight =
      (callerNode.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT;

    // Calculate initial declaration area (right side of caller)
    const baseX = callerX + callerWidth + MIN_NODE_SPACING;
    const baseY = callerY;

    // Group declarations into columns for better layout
    const declarationsPerColumn = Math.ceil(
      declarations.length / DECLARATION_GRID_COLUMNS
    );

    declarations.forEach((declNode, index) => {
      const column = index % DECLARATION_GRID_COLUMNS;
      const row = Math.floor(index / DECLARATION_GRID_COLUMNS);

      let preferredX =
        baseX + column * (DECLARATION_NODE_WIDTH + DECLARATION_GRID_SPACING);
      let preferredY =
        baseY + row * (DECLARATION_NODE_HEIGHT + MIN_NODE_SPACING);

      // ✅ THÊM: Validate preferred position
      if (!isFinite(preferredX) || !isFinite(preferredY)) {
        console.warn(
          `[placeDeclarationNodesNearCallers] Invalid preferred position for ${declNode.id}: x=${preferredX}, y=${preferredY}`
        );
        preferredX = 100;
        preferredY = 100;
      }

      const adjustedPosition = findOptimalPosition(
        preferredX,
        preferredY,
        DECLARATION_NODE_WIDTH,
        DECLARATION_NODE_HEIGHT,
        occupiedPositions,
        functionNodes,
        positionedDeclarations
      );

      // ✅ THÊM: Validate adjusted position trước khi tạo node
      const safePosition = {
        x: Math.max(0, isFinite(adjustedPosition.x) ? adjustedPosition.x : 100),
        y: Math.max(0, isFinite(adjustedPosition.y) ? adjustedPosition.y : 100),
      };

      const positionedNode = {
        ...declNode,
        position: safePosition, // ✅ Sử dụng safe position
        zIndex: 5,
        style: {
          ...declNode.style,
          width: DECLARATION_NODE_WIDTH,
          height: DECLARATION_NODE_HEIGHT,
        },
        width: DECLARATION_NODE_WIDTH,
        height: DECLARATION_NODE_HEIGHT,
      };

      positionedDeclarations.push(positionedNode);

      occupiedPositions.set(declNode.id, {
        x: safePosition.x, // ✅ Sử dụng safe position
        y: safePosition.y,
        width: DECLARATION_NODE_WIDTH,
        height: DECLARATION_NODE_HEIGHT,
      });
    });
  });

  // Handle declarations without callers
  const unplacedDeclarations = declarationNodes.filter(
    (decl) => !positionedDeclarations.some((placed) => placed.id === decl.id)
  );

  if (unplacedDeclarations.length > 0) {
    let fallbackX = 100;
    let fallbackY = 100;

    unplacedDeclarations.forEach((declNode, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);

      // ✅ THÊM: Validate fallback position
      const x =
        fallbackX + column * (DECLARATION_NODE_WIDTH + MIN_NODE_SPACING);
      const y = fallbackY + row * (DECLARATION_NODE_HEIGHT + MIN_NODE_SPACING);

      const safePosition = {
        x: isFinite(x) && x >= 0 ? x : 100,
        y: isFinite(y) && y >= 0 ? y : 100,
      };

      const positionedNode = {
        ...declNode,
        position: safePosition, // ✅ Sử dụng safe position
        zIndex: 5,
        style: {
          ...declNode.style,
          width: DECLARATION_NODE_WIDTH,
          height: DECLARATION_NODE_HEIGHT,
        },
        width: DECLARATION_NODE_WIDTH,
        height: DECLARATION_NODE_HEIGHT,
      };

      positionedDeclarations.push(positionedNode);
    });
  }

  return positionedDeclarations;
}

// ==================== HELPER: ENSURE CONTAINER SPACING ====================
function ensureContainerSpacing(containers: any[]): any[] {
  const adjustedContainers = [...containers];

  for (let i = 0; i < adjustedContainers.length; i++) {
    for (let j = i + 1; j < adjustedContainers.length; j++) {
      const containerA = adjustedContainers[i];
      const containerB = adjustedContainers[j];

      if (containersOverlap(containerA, containerB)) {
        // Move containerB to avoid overlap
        const moveRight =
          containerA.position.x + containerA.data.width + MIN_CONTAINER_SPACING;
        const moveDown =
          containerA.position.y +
          containerA.data.height +
          MIN_CONTAINER_SPACING;

        // Choose the direction that creates less movement
        const currentDistanceX = Math.abs(
          containerA.position.x - containerB.position.x
        );
        const currentDistanceY = Math.abs(
          containerA.position.y - containerB.position.y
        );

        if (currentDistanceX < currentDistanceY) {
          containerB.position.x = moveRight;
        } else {
          containerB.position.y = moveDown;
        }
      }
    }
  }

  return adjustedContainers;
}

function containersOverlap(containerA: any, containerB: any): boolean {
  return (
    containerA.position.x < containerB.position.x + containerB.data.width &&
    containerA.position.x + containerA.data.width > containerB.position.x &&
    containerA.position.y < containerB.position.y + containerB.data.height &&
    containerA.position.y + containerA.data.height > containerB.position.y
  );
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
    // ✅ Use actual node height if available, fallback to default
    const nodeHeight =
      (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT;

    dagreGraph.setNode(node.id, {
      width: CODE_NODE_WIDTH,
      height: nodeHeight,
    });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    // ✅ THÊM: Validate và đảm bảo node dimensions hợp lệ
    const nodeHeight = Math.max(
      CODE_NODE_MIN_HEIGHT,
      (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT
    );

    // ✅ THÊM: Validate position values
    let posX = nodeWithPosition.x - CODE_NODE_WIDTH / 2;
    let posY = nodeWithPosition.y - nodeHeight / 2;

    // Đảm bảo positions là số hợp lệ và không âm
    if (!isFinite(posX) || posX < 0) posX = 0;
    if (!isFinite(posY) || posY < 0) posY = 0;

    return {
      ...node,
      position: {
        x: posX,
        y: posY,
      },
      // ✅ THÊM: Đảm bảo node có dimensions hợp lệ
      width: CODE_NODE_WIDTH,
      height: nodeHeight,
      style: {
        ...node.style,
        width: CODE_NODE_WIDTH,
        height: nodeHeight,
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
      const nodeHeight =
        (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CODE_NODE_WIDTH);
      maxY = Math.max(maxY, y + nodeHeight);
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
      height: (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT,
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
      const nodeHeight =
        (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CODE_NODE_WIDTH);
      maxY = Math.max(maxY, y + nodeHeight);
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
      const nodeHeight =
        (node.style?.height as number) || CODE_NODE_DEFAULT_HEIGHT;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CODE_NODE_WIDTH);
      maxY = Math.max(maxY, y + nodeHeight);
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
      result = { nodes, edges: styledEdges };
  }

  return result;
}
