// src/webview/utils/EdgeHandleOptimizer.ts
import { Position } from "@xyflow/react";
import { Node } from "@xyflow/react";

export interface NodePosition {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  type: string;
}

export interface OptimizedHandle {
  sourceHandle: string;
  targetHandle: string;
  priority: number; // Độ ưu tiên (cao hơn = tốt hơn)
}

export class EdgeHandleOptimizer {
  /**
   * Tính toán handle tối ưu dựa trên vị trí tương đối giữa 2 node
   */
  static calculateOptimalHandles(
    sourceNode: NodePosition,
    targetNode: NodePosition,
    layoutDirection: string = "TB"
  ): OptimizedHandle {
    const sourceCenter = {
      x: sourceNode.position.x + sourceNode.width / 2,
      y: sourceNode.position.y + sourceNode.height / 2,
    };

    const targetCenter = {
      x: targetNode.position.x + targetNode.width / 2,
      y: targetNode.position.y + targetNode.height / 2,
    };

    // Tính góc và khoảng cách
    const deltaX = targetCenter.x - sourceCenter.x;
    const deltaY = targetCenter.y - sourceCenter.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Xác định hướng chính dựa trên layout
    const directionScores = this.calculateDirectionScores(
      deltaX,
      deltaY,
      layoutDirection
    );

    // Chọn handle có điểm số cao nhất
    const bestDirection = directionScores.reduce((best, current) =>
      current.score > best.score ? current : best
    );

    return {
      sourceHandle: bestDirection.sourceHandle,
      targetHandle: bestDirection.targetHandle,
      priority: bestDirection.score,
    };
  }

  /**
   * Tính điểm cho các hướng handle có thể
   */
  private static calculateDirectionScores(
    deltaX: number,
    deltaY: number,
    layoutDirection: string
  ): Array<{ sourceHandle: string; targetHandle: string; score: number }> {
    const directions = [];

    // Top-Down Layout (Mặc định cho Go)
    if (layoutDirection === "TB" || layoutDirection === "DOWN") {
      directions.push(
        // Source Bottom -> Target Top (Ưu tiên cao nhất cho TB layout)
        {
          sourceHandle: Position.Bottom,
          targetHandle: Position.Top,
          score: this.calculateTBScore(deltaX, deltaY),
        },
        // Source Right -> Target Left (Khi target ở bên phải)
        {
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
          score: this.calculateLRScore(deltaX, deltaY),
        },
        // Source Left -> Target Right (Khi target ở bên trái)
        {
          sourceHandle: Position.Left,
          targetHandle: Position.Right,
          score: this.calculateRLScore(deltaX, deltaY),
        }
      );
    }

    // Left-Right Layout
    else if (layoutDirection === "LR" || layoutDirection === "RIGHT") {
      directions.push(
        // Source Right -> Target Left (Ưu tiên cao nhất cho LR layout)
        {
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
          score: this.calculateLRScore(deltaX, deltaY),
        },
        // Source Bottom -> Target Top (Khi target ở phía dưới)
        {
          sourceHandle: Position.Bottom,
          targetHandle: Position.Top,
          score: this.calculateTBScore(deltaX, deltaY),
        },
        // Source Top -> Target Bottom (Khi target ở phía trên)
        {
          sourceHandle: Position.Top,
          targetHandle: Position.Bottom,
          score: this.calculateBTScore(deltaX, deltaY),
        }
      );
    }

    // Fallback cho các layout khác
    else {
      directions.push(
        {
          sourceHandle: Position.Right,
          targetHandle: Position.Left,
          score: this.calculateLRScore(deltaX, deltaY),
        },
        {
          sourceHandle: Position.Bottom,
          targetHandle: Position.Top,
          score: this.calculateTBScore(deltaX, deltaY),
        },
        {
          sourceHandle: Position.Left,
          targetHandle: Position.Right,
          score: this.calculateRLScore(deltaX, deltaY),
        },
        {
          sourceHandle: Position.Top,
          targetHandle: Position.Bottom,
          score: this.calculateBTScore(deltaX, deltaY),
        }
      );
    }

    return directions;
  }

  /**
   * Tính điểm cho hướng Top-Bottom
   */
  private static calculateTBScore(deltaX: number, deltaY: number): number {
    // Ưu tiên khi target ở phía dưới source
    const verticalScore = deltaY > 0 ? 1.0 : 0.2;

    // Giảm điểm nếu lệch ngang quá nhiều
    const horizontalPenalty = Math.abs(deltaX) > 200 ? 0.3 : 0.8;

    // Ưu tiên thẳng đứng
    const alignmentBonus = Math.abs(deltaX) < 50 ? 0.5 : 0;

    return verticalScore * horizontalPenalty + alignmentBonus;
  }

  /**
   * Tính điểm cho hướng Bottom-Top
   */
  private static calculateBTScore(deltaX: number, deltaY: number): number {
    // Ưu tiên khi target ở phía trên source
    const verticalScore = deltaY < 0 ? 1.0 : 0.2;
    const horizontalPenalty = Math.abs(deltaX) > 200 ? 0.3 : 0.8;
    const alignmentBonus = Math.abs(deltaX) < 50 ? 0.5 : 0;

    return verticalScore * horizontalPenalty + alignmentBonus;
  }

  /**
   * Tính điểm cho hướng Left-Right
   */
  private static calculateLRScore(deltaX: number, deltaY: number): number {
    // Ưu tiên khi target ở bên phải source
    const horizontalScore = deltaX > 0 ? 1.0 : 0.2;

    // Giảm điểm nếu lệch dọc quá nhiều
    const verticalPenalty = Math.abs(deltaY) > 150 ? 0.3 : 0.8;

    // Ưu tiên thẳng ngang
    const alignmentBonus = Math.abs(deltaY) < 50 ? 0.5 : 0;

    return horizontalScore * verticalPenalty + alignmentBonus;
  }

  /**
   * Tính điểm cho hướng Right-Left
   */
  private static calculateRLScore(deltaX: number, deltaY: number): number {
    // Ưu tiên khi target ở bên trái source
    const horizontalScore = deltaX < 0 ? 1.0 : 0.2;
    const verticalPenalty = Math.abs(deltaY) > 150 ? 0.3 : 0.8;
    const alignmentBonus = Math.abs(deltaY) < 50 ? 0.5 : 0;

    return horizontalScore * verticalPenalty + alignmentBonus;
  }

  /**
   * Tối ưu tất cả edges trong graph
   */
  static optimizeAllEdges(
    nodes: Node[],
    edges: any[],
    layoutDirection: string = "TB"
  ): any[] {
    const nodePositions = new Map<string, NodePosition>();

    // Thu thập vị trí node
    nodes.forEach((node) => {
      nodePositions.set(node.id, {
        id: node.id,
        position: node.position,
        width: (node.style?.width as number) || 650,
        height: (node.style?.height as number) || 320,
        type: node.type || "functionNode",
      });
    });

    // Tối ưu từng edge
    return edges.map((edge) => {
      const sourceNode = nodePositions.get(edge.source);
      const targetNode = nodePositions.get(edge.target);

      if (!sourceNode || !targetNode) {
        return edge;
      }

      const optimized = this.calculateOptimalHandles(
        sourceNode,
        targetNode,
        layoutDirection
      );

      return {
        ...edge,
        sourceHandle: optimized.sourceHandle,
        targetHandle: optimized.targetHandle,
        data: {
          ...edge.data,
          handlePriority: optimized.priority,
        },
      };
    });
  }
}
