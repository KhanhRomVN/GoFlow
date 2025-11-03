// src/webview/utils/FlowPathTracker.ts
import { Logger } from "../../utils/webviewLogger";

export interface FlowNode {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
  hasReturnValue?: boolean;
}

export interface FlowPath {
  id: string;
  name: string;
  nodes: FlowNode[];
  depth: number;
  createdAt: number;
  isActive: boolean;
  description?: string;
}

export interface FlowPathStats {
  totalFlows: number;
  averageDepth: number;
  maxDepth: number;
  minDepth: number;
  totalSteps: number;
}

class FlowPathTrackerClass {
  private flows: Map<string, FlowPath> = new Map();
  private listeners: Array<(flows: FlowPath[]) => void> = [];

  /**
   * Tạo execution flows từ graph data - CHỈ bao gồm edges có return value
   */
  // Sửa phương thức generateExecutionFlowsFromGraph
  generateExecutionFlowsFromGraph(
    nodes: FlowNode[],
    edges: Array<{
      source: string;
      target: string;
      hasReturnValue?: boolean;
      type?: string;
    }>
  ): void {
    this.flows.clear();

    // Lọc chỉ lấy function nodes trong workspace
    const workspaceFunctionNodes = nodes.filter((node) =>
      this.isInWorkspace(node.file)
    );

    // Tìm root nodes (không có incoming edges)
    const nodeIds = new Set(workspaceFunctionNodes.map((n) => n.id));
    const targetIds = new Set(edges.map((e) => e.target));
    const rootNodeIds = Array.from(nodeIds).filter((id) => !targetIds.has(id));

    // Tạo execution flow cho mỗi root node
    rootNodeIds.forEach((rootId) => {
      const rootNode = workspaceFunctionNodes.find((n) => n.id === rootId);
      if (!rootNode) return;

      // Tìm tất cả execution paths từ root node (CHỈ edges có return value)
      const executionPaths = this.findExecutionPaths(
        rootId,
        workspaceFunctionNodes,
        edges
      );

      executionPaths.forEach((path, index) => {
        if (path.length > 1) {
          // Chỉ thêm flow có ít nhất 2 nodes
          const flowId = `execution-flow-${rootId}-${index}-${Date.now()}`;
          const flowName = this.generateExecutionFlowName(path);
          const description = this.generateFlowDescription(path);

          const flow: FlowPath = {
            id: flowId,
            name: flowName,
            nodes: path,
            depth: path.length,
            createdAt: Date.now(),
            isActive: false,
            description,
          };

          this.flows.set(flowId, flow);
        }
      });
    });

    // Thêm flows từ các node quan trọng khác (nếu có)
    this.addImportantFlows(workspaceFunctionNodes, edges);

    this.notifyListeners();
  }

  /**
   * Tìm execution paths (chỉ bao gồm edges CÓ RETURN VALUE)
   */
  private findExecutionPaths(
    startNodeId: string,
    allNodes: FlowNode[],
    edges: Array<{
      source: string;
      target: string;
      hasReturnValue?: boolean;
      type?: string;
    }>
  ): FlowNode[][] {
    const allPaths: FlowNode[][] = [];
    const visited = new Set<string>();

    const dfs = (currentNodeId: string, currentPath: FlowNode[]) => {
      const currentNode = allNodes.find((n) => n.id === currentNodeId);
      if (!currentNode) return;

      // Thêm node hiện tại vào path
      const newPath = [...currentPath, currentNode];

      // Tìm outgoing edges CÓ RETURN VALUE (solid edges) và là calls
      const outgoingEdges = edges.filter(
        (edge) =>
          edge.source === currentNodeId &&
          edge.hasReturnValue === true && // CHỈ lấy edges có return value
          edge.type === "calls" // CHỈ lấy edges gọi hàm
      );

      // Nếu không có outgoing edges có return value -> đây là end node
      if (outgoingEdges.length === 0) {
        allPaths.push(newPath);
        return;
      }

      // Tiếp tục DFS với các children CÓ RETURN VALUE
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
   * Thêm các flows quan trọng khác (longest chains, etc.)
   */
  private addImportantFlows(
    nodes: FlowNode[],
    edges: Array<{
      source: string;
      target: string;
      hasReturnValue?: boolean;
      type?: string;
    }>
  ): void {
    // Tìm longest execution chain
    const allChains: FlowNode[][] = [];
    const nodeIds = new Set(nodes.map((n) => n.id));

    nodeIds.forEach((nodeId) => {
      const chains = this.findExecutionPaths(nodeId, nodes, edges);
      chains.forEach((chain) => {
        if (chain.length >= 3) {
          // Chỉ thêm chains dài
          allChains.push(chain);
        }
      });
    });

    // Sắp xếp theo độ dài và thêm 3 chains dài nhất
    const longestChains = allChains
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);

    longestChains.forEach((chain, index) => {
      const flowId = `longest-chain-${index}-${Date.now()}`;
      const flow: FlowPath = {
        id: flowId,
        name: `Long Chain ${index + 1} (${chain.length} steps)`,
        nodes: chain,
        depth: chain.length,
        createdAt: Date.now(),
        isActive: false,
        description: `Long execution chain with ${chain.length} function calls`,
      };
      this.flows.set(flowId, flow);
    });
  }

  /**
   * Kiểm tra node có thuộc workspace không
   */
  private isInWorkspace(filePath: string): boolean {
    // Loại bỏ stdlib, vendor, và external dependencies
    const excludedPatterns = [
      "/usr/local/go/",
      "/go/pkg/mod/",
      "\\go\\pkg\\mod\\",
      "/vendor/",
      "node_modules",
      ".git",
      "/usr/",
      "/opt/",
      "/tmp/",
    ];

    return !excludedPatterns.some((pattern) =>
      filePath.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Tạo tên flow theo dạng execution flow
   */
  private generateExecutionFlowName(path: FlowNode[]): string {
    if (path.length === 0) return "Empty Execution Flow";
    if (path.length === 1) return `Single: ${path[0].label}`;

    const startNode = path[0];
    const endNode = path[path.length - 1];

    if (path.length <= 3) {
      return path.map((node) => node.label).join(" → ");
    } else {
      return `${startNode.label} → ... → ${endNode.label}`;
    }
  }

  /**
   * Tạo mô tả cho flow
   */
  private generateFlowDescription(path: FlowNode[]): string {
    if (path.length === 1) {
      return `Single function: ${path[0].label}`;
    }

    const functionCount = path.filter(
      (node) => node.type === "function"
    ).length;
    const methodCount = path.filter((node) => node.type === "method").length;

    let description = `Execution flow with ${path.length} steps`;
    if (functionCount > 0) {
      description += `, ${functionCount} function${
        functionCount > 1 ? "s" : ""
      }`;
    }
    if (methodCount > 0) {
      description += `, ${methodCount} method${methodCount > 1 ? "s" : ""}`;
    }

    return description;
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
        totalSteps: 0,
      };
    }

    const depths = flows.map((f) => f.depth);
    const totalDepth = depths.reduce((sum, d) => sum + d, 0);
    const totalSteps = flows.reduce((sum, flow) => sum + flow.nodes.length, 0);

    return {
      totalFlows: flows.length,
      averageDepth: Math.round((totalDepth / flows.length) * 10) / 10,
      maxDepth: Math.max(...depths),
      minDepth: Math.min(...depths),
      totalSteps,
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

    let output = `=== Execution Flow Path Report ===\n\n`;
    output += `Total Flows: ${stats.totalFlows}\n`;
    output += `Average Depth: ${stats.averageDepth}\n`;
    output += `Max Depth: ${stats.maxDepth}\n`;
    output += `Min Depth: ${stats.minDepth}\n`;
    output += `Total Steps: ${stats.totalSteps}\n\n`;

    flows.forEach((flow, index) => {
      output += `Flow ${index + 1}: ${flow.name}\n`;
      output += `  Depth: ${flow.depth} steps\n`;
      if (flow.description) {
        output += `  Description: ${flow.description}\n`;
      }
      output += `  Execution Path:\n`;

      flow.nodes.forEach((node, nodeIndex) => {
        const indent = "    ";
        const stepNum = (nodeIndex + 1).toString().padStart(2, "0");
        const nodeType = node.type === "function" ? "FUNC" : "METHOD";
        output += `${indent}${stepNum}. [${nodeType}] ${node.label}\n`;
        output += `${indent}     📄 ${node.file.split("/").pop()}:${
          node.line
        }\n`;
      });

      output += `\n`;
    });

    return output;
  }

  /**
   * Tìm flows chứa node cụ thể
   */
  findFlowsWithNode(nodeId: string): FlowPath[] {
    return this.getAllFlows().filter((flow) =>
      flow.nodes.some((node) => node.id === nodeId)
    );
  }

  /**
   * Tìm flows theo tên function
   */
  findFlowsWithFunction(functionName: string): FlowPath[] {
    return this.getAllFlows().filter((flow) =>
      flow.nodes.some((node) =>
        node.label.toLowerCase().includes(functionName.toLowerCase())
      )
    );
  }
}

export const FlowPathTracker = new FlowPathTrackerClass();
