import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from "@xyflow/react";

interface CallOrderEdgeData {
  callOrder?: number;
  returnOrder?: number;
  hasReturnValue?: boolean;
  dashed?: boolean;
}

const CallOrderEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data = {},
  markerEnd,
}) => {
  const edgeData = data as CallOrderEdgeData;
  const hasReturnValue = edgeData.hasReturnValue ?? true;
  const callOrder = edgeData.callOrder;
  const returnOrder = edgeData.returnOrder;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.5,
  });

  const edgeStyle = {
    ...style,
    strokeDasharray: hasReturnValue ? undefined : "8 4",
    strokeWidth: callOrder !== undefined ? 2.5 : 2,
    stroke: style.stroke || "#666",
  };

  // Calculate label positions for better spacing
  const hasMultipleLabels =
    callOrder !== undefined && returnOrder !== undefined;
  const labelOffset = hasMultipleLabels ? 18 : 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        {callOrder !== undefined && (
          <div
            data-call-order-label="true"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${
                labelY - labelOffset
              }px)`,
              background: hasReturnValue
                ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                : "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
              color: "white",
              padding: "5px 10px",
              borderRadius: "14px",
              fontSize: "11px",
              fontWeight: "700",
              fontFamily: "'Courier New', monospace",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              pointerEvents: "all",
              zIndex: 1000,
              border: "2px solid rgba(255,255,255,0.3)",
              userSelect: "none",
            }}
            className="nodrag nopan"
            title={hasReturnValue ? "Call with return" : "Call without return"}
          >
            {callOrder}
          </div>
        )}
        {returnOrder !== undefined && (
          <div
            data-call-order-label="true"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${
                labelY + labelOffset
              }px)`,
              background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              color: "white",
              padding: "5px 10px",
              borderRadius: "14px",
              fontSize: "11px",
              fontWeight: "700",
              fontFamily: "'Courier New', monospace",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              pointerEvents: "all",
              zIndex: 1000,
              border: "2px solid rgba(255,255,255,0.3)",
              userSelect: "none",
            }}
            className="nodrag nopan"
            title="Return order"
          >
            ← {returnOrder}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

export default CallOrderEdge;
