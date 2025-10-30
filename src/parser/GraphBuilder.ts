import * as vscode from "vscode";
import { GraphData, Node, Edge } from "../models/Node";
import { Logger } from "../utils/logger";

export class GraphBuilder {
  private nodes: Map<string, Node> = new Map();
  private edges: Edge[] = [];

  constructor() {}

  addNode(node: Node): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
      Logger.debug(`Added node: ${node.id} (${node.type})`);
    }
  }

  addEdge(edge: Edge): void {
    const isDuplicate = this.edges.some(
      (e) =>
        e.source === edge.source &&
        e.target === edge.target &&
        e.type === edge.type
    );

    if (!isDuplicate) {
      this.edges.push(edge);
      Logger.info(
        `Added edge: ${edge.source} -> ${edge.target} (${edge.type})`
      );
    }
  }

  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  removeOrphanEdges(): void {
    const validNodeIds = new Set(this.nodes.keys());

    this.edges = this.edges.filter((edge) => {
      const isValid =
        validNodeIds.has(edge.source) && validNodeIds.has(edge.target);

      if (!isValid) {
        Logger.info(`Removed orphan edge: ${edge.source} -> ${edge.target}`);
      }

      return isValid;
    });
  }

  filterByMaxNodes(maxNodes: number): void {
    if (this.nodes.size <= maxNodes) {
      return;
    }

    Logger.info(
      `Filtering graph: ${this.nodes.size} nodes -> ${maxNodes} nodes`
    );

    const nodeArray = Array.from(this.nodes.values());
    const priorityNodes = nodeArray
      .sort((a, b) => {
        const priorityOrder = {
          function: 0,
          method: 1,
          interface: 2,
          struct: 3,
          unknown: 4,
        };
        return priorityOrder[a.type] - priorityOrder[b.type];
      })
      .slice(0, maxNodes);

    this.nodes.clear();
    priorityNodes.forEach((node) => this.nodes.set(node.id, node));
    this.removeOrphanEdges();
  }

  calculateMetrics(): {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<string, number>;
    isolatedNodes: number;
  } {
    const nodesByType: Record<string, number> = {};
    const connectedNodes = new Set<string>();

    this.edges.forEach((edge) => {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    });

    this.nodes.forEach((node) => {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    });

    const isolatedNodes = this.nodes.size - connectedNodes.size;

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      nodesByType,
      isolatedNodes,
    };
  }

  build(fileName: string): GraphData {
    this.removeOrphanEdges();

    const metrics = this.calculateMetrics();
    Logger.info(`Graph built: ${JSON.stringify(metrics)}`);

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      fileName,
    };
  }

  clear(): void {
    this.nodes.clear();
    this.edges = [];
    Logger.info("Graph builder cleared");
  }

  mergeGraph(other: GraphData): void {
    other.nodes.forEach((node) => this.addNode(node));
    other.edges.forEach((edge) => this.addEdge(edge));
    Logger.info(`Merged graph with ${other.nodes.length} nodes`);
  }

  getNodeDegree(nodeId: string): { inDegree: number; outDegree: number } {
    let inDegree = 0;
    let outDegree = 0;

    this.edges.forEach((edge) => {
      if (edge.target === nodeId) inDegree++;
      if (edge.source === nodeId) outDegree++;
    });

    return { inDegree, outDegree };
  }

  findRootNodes(): Node[] {
    const roots: Node[] = [];

    this.nodes.forEach((node) => {
      const { inDegree } = this.getNodeDegree(node.id);
      if (inDegree === 0) {
        roots.push(node);
      }
    });

    return roots;
  }

  findLeafNodes(): Node[] {
    const leaves: Node[] = [];

    this.nodes.forEach((node) => {
      const { outDegree } = this.getNodeDegree(node.id);
      if (outDegree === 0) {
        leaves.push(node);
      }
    });

    return leaves;
  }
}
