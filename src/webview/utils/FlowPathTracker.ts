// src/webview/utils/FlowPathTracker.ts
import { Logger } from "../../utils/webviewLogger";

export interface FlowNode {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
}

export interface FlowPath {
  id: string;
  name: string;
  nodes: FlowNode[];
  depth: number;
  createdAt: number;
  isActive: boolean;
}

export interface FlowPathStats {
  totalFlows: number;
  averageDepth: number;
  maxDepth: number;
  minDepth: number;
}

class FlowPathTrackerClass {
  private flows: Map<string, FlowPath> = new Map();
  private listeners: Array<(flows: FlowPath[]) => void> = [];

  /**
   * Tự động tạo flows từ root nodes đến end nodes
   */
  generateFlowsFromGraph(
    nodes: FlowNode[],
    edges: Array<{ source: string; target: string }>
  ): void {
    this.flows.clear();

    // Tìm root nodes (không có incoming edges)
    const nodeIds = new Set(nodes.map((n) => n.id));
    const targetIds = new Set(edges.map((e) => e.target));
    const rootNodeIds = Array.from(nodeIds).filter((id) => !targetIds.has(id));

    // Với mỗi root node, DFS để tìm tất cả paths đến end nodes
    rootNodeIds.forEach((rootId) => {
      const rootNode = nodes.find((n) => n.id === rootId);
      if (!rootNode) return;

      const paths = this.findAllPathsFromNode(rootId, nodes, edges);

      paths.forEach((path, index) => {
        const flowId = `flow-${rootId}-${index}-${Date.now()}`;
        const flowName = this.generateFlowName(path);

        const flow: FlowPath = {
          id: flowId,
          name: flowName,
          nodes: path,
          depth: path.length,
          createdAt: Date.now(),
          isActive: false,
        };

        this.flows.set(flowId, flow);
      });
    });

    this.notifyListeners();
  }

  /**
   * Tìm tất cả paths từ một node đến end nodes (DFS)
   */
  private findAllPathsFromNode(
    startNodeId: string,
    allNodes: FlowNode[],
    edges: Array<{ source: string; target: string }>
  ): FlowNode[][] {
    const allPaths: FlowNode[][] = [];
    const visited = new Set<string>();

    const dfs = (currentNodeId: string, currentPath: FlowNode[]) => {
      const currentNode = allNodes.find((n) => n.id === currentNodeId);
      if (!currentNode) return;

      // Thêm node hiện tại vào path
      const newPath = [...currentPath, currentNode];

      // Tìm outgoing edges
      const outgoingEdges = edges.filter((e) => e.source === currentNodeId);

      // Nếu không có outgoing edges -> đây là end node
      if (outgoingEdges.length === 0) {
        allPaths.push(newPath);
        return;
      }

      // Tiếp tục DFS với các children
      outgoingEdges.forEach((edge) => {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          dfs(edge.target, newPath);
          visited.delete(edge.target);
        }
      });
    };

    visited.add(startNodeId);
    dfs(startNodeId, []);

    return allPaths;
  }

  /**
   * Tạo tên flow từ path (ví dụ: "main → handleRequest → saveDB")
   */
  private generateFlowName(path: FlowNode[]): string {
    if (path.length === 0) return "Empty Flow";
    if (path.length === 1) return path[0].label;

    const start = path[0].label;
    const end = path[path.length - 1].label;
    const middle = path.length > 2 ? ` → ... → ` : ` → `;

    return `${start}${middle}${end}`;
  }

  /**
   * Lấy tất cả flows
   */
  getAllFlows(): FlowPath[] {
    return Array.from(this.flows.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  /**
   * Lấy flow theo ID
   */
  getFlowById(flowId: string): FlowPath | undefined {
    return this.flows.get(flowId);
  }

  /**
   * Set active flow
   */
  setActiveFlow(flowId: string): void {
    this.flows.forEach((flow) => {
      flow.isActive = flow.id === flowId;
    });
    this.notifyListeners();
  }

  /**
   * Clear active flow
   */
  clearActiveFlow(): void {
    this.flows.forEach((flow) => {
      flow.isActive = false;
    });
    this.notifyListeners();
  }

  /**
   * Xóa flow
   */
  deleteFlow(flowId: string): void {
    this.flows.delete(flowId);
    this.notifyListeners();
  }

  /**
   * Xóa tất cả flows
   */
  clearAllFlows(): void {
    this.flows.clear();
    this.notifyListeners();
  }

  /**
   * Lấy thống kê
   */
  getStats(): FlowPathStats {
    const flows = this.getAllFlows();

    if (flows.length === 0) {
      return {
        totalFlows: 0,
        averageDepth: 0,
        maxDepth: 0,
        minDepth: 0,
      };
    }

    const depths = flows.map((f) => f.depth);
    const totalDepth = depths.reduce((sum, d) => sum + d, 0);

    return {
      totalFlows: flows.length,
      averageDepth: Math.round(totalDepth / flows.length),
      maxDepth: Math.max(...depths),
      minDepth: Math.min(...depths),
    };
  }

  /**
   * Subscribe to changes
   */
  subscribe(listener: (flows: FlowPath[]) => void): () => void {
    this.listeners.push(listener);

    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(): void {
    const flows = this.getAllFlows();
    this.listeners.forEach((listener) => listener(flows));
  }

  /**
   * Export formatted report
   */
  getFormattedReport(): string {
    const flows = this.getAllFlows();
    const stats = this.getStats();

    let output = `=== Flow Path Report ===\n\n`;
    output += `Total Flows: ${stats.totalFlows}\n`;
    output += `Average Depth: ${stats.averageDepth}\n`;
    output += `Max Depth: ${stats.maxDepth}\n`;
    output += `Min Depth: ${stats.minDepth}\n\n`;

    flows.forEach((flow, index) => {
      output += `Flow ${index + 1}: ${flow.name}\n`;
      output += `  Depth: ${flow.depth}\n`;
      output += `  Path:\n`;

      flow.nodes.forEach((node, nodeIndex) => {
        const indent = "    ".repeat(nodeIndex);
        const arrow = nodeIndex > 0 ? "└→ " : "🏁 ";
        output += `${indent}${arrow}${node.label} (${node.type})\n`;
        output += `${indent}   📄 ${node.file.split("/").pop()}:${node.line}\n`;
      });

      output += `\n`;
    });

    return output;
  }
}

export const FlowPathTracker = new FlowPathTrackerClass();
