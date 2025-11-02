// src/webview/utils/EdgeTracker.ts
import { Logger } from "../../utils/webviewLogger";

export interface EdgeConnection {
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
  sourceType: "function" | "method";
  targetType: "function" | "method";
  timestamp: number;
}

export interface EdgeStats {
  totalEdges: number;
  functionToFunction: number;
  functionToMethod: number;
  methodToFunction: number;
  methodToMethod: number;
}

export interface PathNode {
  nodeId: string;
  nodeLabel: string;
  nodeType: "function" | "method";
  depth: number;
  file?: string;
  line?: number;
}

export interface TracedPath {
  targetNode: PathNode;
  paths: Array<{
    nodes: PathNode[];
    edges: EdgeConnection[];
    totalDepth: number;
  }>;
}

class EdgeTrackerClass {
  private edges: Map<string, EdgeConnection> = new Map();
  private listeners: Array<(edges: EdgeConnection[]) => void> = [];

  getEdgeListFormatted(): string {
    const edges = this.getAllEdges();
    const stats = this.getStats();

    let output = `=== GoFlow Edge Tracker Report ===\n\n`;
    output += `Total Edges: ${stats.totalEdges}\n\n`;
    output += `Breakdown:\n`;
    output += `  - function → function: ${stats.functionToFunction}\n`;
    output += `  - function → method: ${stats.functionToMethod}\n`;
    output += `  - method → function: ${stats.methodToFunction}\n`;
    output += `  - method → method: ${stats.methodToMethod}\n\n`;

    const groupedEdges = {
      "function → function": edges.filter(
        (e) => e.sourceType === "function" && e.targetType === "function"
      ),
      "function → method": edges.filter(
        (e) => e.sourceType === "function" && e.targetType === "method"
      ),
      "method → function": edges.filter(
        (e) => e.sourceType === "method" && e.targetType === "function"
      ),
      "method → method": edges.filter(
        (e) => e.sourceType === "method" && e.targetType === "method"
      ),
    };

    Object.entries(groupedEdges).forEach(([category, categoryEdges]) => {
      if (categoryEdges.length > 0) {
        output += `${category} (${categoryEdges.length} edges):\n`;
        categoryEdges.forEach((edge, index) => {
          output += `  ${index + 1}. ${edge.sourceLabel} → ${
            edge.targetLabel
          }\n`;
        });
        output += `\n`;
      }
    });

    return output;
  }

  addEdge(connection: EdgeConnection): void {
    const edgeKey = `${connection.source}->${connection.target}`;

    if (!this.edges.has(edgeKey)) {
      this.edges.set(edgeKey, connection);

      Logger.info(
        `[EdgeTracker] New edge added: ${connection.sourceLabel}(${connection.sourceType}) -> ${connection.targetLabel}(${connection.targetType})`
      );

      this.notifyListeners();
    }
  }

  removeEdge(source: string, target: string): void {
    const edgeKey = `${source}->${target}`;

    if (this.edges.has(edgeKey)) {
      const edge = this.edges.get(edgeKey)!;
      this.edges.delete(edgeKey);

      Logger.info(
        `[EdgeTracker] Edge removed: ${edge.sourceLabel} -> ${edge.targetLabel}`
      );

      this.notifyListeners();
    }
  }

  updateEdges(connections: EdgeConnection[]): void {
    this.edges.clear();

    connections.forEach((conn) => {
      const edgeKey = `${conn.source}->${conn.target}`;
      this.edges.set(edgeKey, conn);
    });

    this.logCurrentState();
    this.notifyListeners();
  }

  getAllEdges(): EdgeConnection[] {
    return Array.from(this.edges.values());
  }

  getEdgesBySource(sourceId: string): EdgeConnection[] {
    return Array.from(this.edges.values()).filter(
      (edge) => edge.source === sourceId
    );
  }

  getEdgesByTarget(targetId: string): EdgeConnection[] {
    return Array.from(this.edges.values()).filter(
      (edge) => edge.target === targetId
    );
  }

  getStats(): EdgeStats {
    const edges = this.getAllEdges();

    const stats: EdgeStats = {
      totalEdges: edges.length,
      functionToFunction: 0,
      functionToMethod: 0,
      methodToFunction: 0,
      methodToMethod: 0,
    };

    edges.forEach((edge) => {
      if (edge.sourceType === "function" && edge.targetType === "function") {
        stats.functionToFunction++;
      } else if (
        edge.sourceType === "function" &&
        edge.targetType === "method"
      ) {
        stats.functionToMethod++;
      } else if (
        edge.sourceType === "method" &&
        edge.targetType === "function"
      ) {
        stats.methodToFunction++;
      } else if (edge.sourceType === "method" && edge.targetType === "method") {
        stats.methodToMethod++;
      }
    });

    return stats;
  }

  logCurrentState(): void {
    const edges = this.getAllEdges();
    const stats = this.getStats();

    Logger.info(`[EdgeTracker] Current state:`, {
      totalEdges: stats.totalEdges,
      breakdown: {
        "function -> function": stats.functionToFunction,
        "function -> method": stats.functionToMethod,
        "method -> function": stats.methodToFunction,
        "method -> method": stats.methodToMethod,
      },
    });

    if (edges.length === 0) {
      Logger.debug("[EdgeTracker] No edges to display");
      return;
    }

    Logger.debug(`[EdgeTracker] Displaying all ${edges.length} edges:`);

    const groupedEdges = {
      "function -> function": edges.filter(
        (e) => e.sourceType === "function" && e.targetType === "function"
      ),
      "function -> method": edges.filter(
        (e) => e.sourceType === "function" && e.targetType === "method"
      ),
      "method -> function": edges.filter(
        (e) => e.sourceType === "method" && e.targetType === "function"
      ),
      "method -> method": edges.filter(
        (e) => e.sourceType === "method" && e.targetType === "method"
      ),
    };

    Object.entries(groupedEdges).forEach(([category, categoryEdges]) => {
      if (categoryEdges.length > 0) {
        Logger.debug(`\n  📊 ${category} (${categoryEdges.length} edges):`);
        categoryEdges.forEach((edge, index) => {
          Logger.debug(
            `    ${index + 1}. ${edge.sourceLabel} → ${edge.targetLabel}`
          );
        });
      }
    });

    Logger.debug(`\n  ✅ Total: ${edges.length} edges logged`);
  }

  subscribe(listener: (edges: EdgeConnection[]) => void): () => void {
    this.listeners.push(listener);

    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(): void {
    const edges = this.getAllEdges();
    this.listeners.forEach((listener) => listener(edges));
  }

  clear(): void {
    this.edges.clear();
    Logger.info("[EdgeTracker] All edges cleared");
    this.notifyListeners();
  }

  exportToJSON(): string {
    return JSON.stringify(this.getAllEdges(), null, 2);
  }

  importFromJSON(json: string): void {
    try {
      const connections: EdgeConnection[] = JSON.parse(json);
      this.updateEdges(connections);
      Logger.info(
        `[EdgeTracker] Imported ${connections.length} edges from JSON`
      );
    } catch (error) {
      Logger.error("[EdgeTracker] Failed to import from JSON", error);
    }
  }

  tracePathsToRoot(
    targetNodeId: string,
    allNodesData: any[]
  ): TracedPath | null {
    const edges = this.getAllEdges();

    const targetNodeData = allNodesData.find((n) => n.id === targetNodeId);
    if (!targetNodeData) {
      Logger.warn(`[EdgeTracker] Target node ${targetNodeId} not found`);
      return null;
    }

    const incomingEdges = edges.filter((e) => e.target === targetNodeId);

    if (incomingEdges.length === 0) {
      Logger.info(
        `[EdgeTracker] Node ${targetNodeId} is a root node (no incoming edges)`
      );
      return {
        targetNode: {
          nodeId: targetNodeId,
          nodeLabel: targetNodeData.label,
          nodeType: targetNodeData.type,
          depth: 0,
          file: targetNodeData.file,
          line: targetNodeData.line,
        },
        paths: [],
      };
    }

    const allPaths: Array<{
      nodes: PathNode[];
      edges: EdgeConnection[];
      totalDepth: number;
    }> = [];

    const visited = new Set<string>();

    const dfs = (
      currentNodeId: string,
      currentPath: PathNode[],
      currentEdges: EdgeConnection[],
      depth: number
    ) => {
      if (visited.has(currentNodeId)) {
        return;
      }

      const currentNodeData = allNodesData.find((n) => n.id === currentNodeId);
      if (!currentNodeData) return;

      const currentNode: PathNode = {
        nodeId: currentNodeId,
        nodeLabel: currentNodeData.label,
        nodeType: currentNodeData.type,
        depth: depth,
        file: currentNodeData.file,
        line: currentNodeData.line,
      };

      const newPath = [...currentPath, currentNode];

      const parents = edges.filter((e) => e.target === currentNodeId);

      if (parents.length === 0) {
        allPaths.push({
          nodes: newPath,
          edges: currentEdges,
          totalDepth: depth,
        });
        return;
      }

      visited.add(currentNodeId);

      parents.forEach((parentEdge) => {
        dfs(
          parentEdge.source,
          newPath,
          [...currentEdges, parentEdge],
          depth + 1
        );
      });

      visited.delete(currentNodeId);
    };

    dfs(targetNodeId, [], [], 0);

    return {
      targetNode: {
        nodeId: targetNodeId,
        nodeLabel: targetNodeData.label,
        nodeType: targetNodeData.type,
        depth: 0,
        file: targetNodeData.file,
        line: targetNodeData.line,
      },
      paths: allPaths,
    };
  }

  logTracedPaths(tracedPath: TracedPath): void {
    if (!tracedPath) {
      Logger.warn("[EdgeTracker] No traced path to log");
      return;
    }

    const { targetNode, paths } = tracedPath;

    Logger.info(
      `[EdgeTracker] 🎯 Tracing paths TO: ${targetNode.nodeLabel} (${targetNode.nodeType})`
    );
    Logger.info(`[EdgeTracker] File: ${targetNode.file}:${targetNode.line}`);

    if (paths.length === 0) {
      Logger.info(
        `[EdgeTracker] ✅ ${targetNode.nodeLabel} is a ROOT node (no incoming edges)`
      );
      return;
    }

    Logger.info(
      `[EdgeTracker] Found ${paths.length} path(s) to root node(s):\n`
    );

    paths.forEach((path, pathIndex) => {
      Logger.info(`[EdgeTracker] 📍 Path ${pathIndex + 1}:`);
      Logger.info(
        `[EdgeTracker]   Depth: ${path.totalDepth} | Nodes: ${path.nodes.length}`
      );

      const pathString = path.nodes
        .reverse()
        .map((node, idx) => {
          const indent = "  ".repeat(idx);
          return `${indent}${idx > 0 ? "└→ " : "🏁 "}${node.nodeLabel} (${
            node.nodeType
          }) [${node.file?.split("/").pop()}:${node.line}]`;
        })
        .join("\n");

      Logger.info(`[EdgeTracker] Path flow:\n${pathString}\n`);
    });

    Logger.info(
      `[EdgeTracker] ═══════════════════════════════════════════════`
    );
  }

  getFormattedPathReport(tracedPath: TracedPath): string {
    if (!tracedPath) {
      return "No traced path available";
    }

    const { targetNode, paths } = tracedPath;

    let output = `=== Path Tracing Report ===\n\n`;
    output += `Target: ${targetNode.nodeLabel} (${targetNode.nodeType})\n`;
    output += `File: ${targetNode.file}:${targetNode.line}\n\n`;

    if (paths.length === 0) {
      output += `✅ This is a ROOT node (no incoming edges)\n`;
      return output;
    }

    output += `Found ${paths.length} path(s) to root:\n\n`;

    paths.forEach((path, pathIndex) => {
      output += `Path ${pathIndex + 1} (Depth: ${path.totalDepth}):\n`;

      path.nodes.reverse().forEach((node, idx) => {
        const indent = "  ".repeat(idx);
        output += `${indent}${idx > 0 ? "└→ " : "🏁 "}${node.nodeLabel} (${
          node.nodeType
        })\n`;
        output += `${indent}   📄 ${node.file?.split("/").pop()}:${
          node.line
        }\n`;
      });

      output += `\n`;
    });

    return output;
  }
}

export const EdgeTracker = new EdgeTrackerClass();
