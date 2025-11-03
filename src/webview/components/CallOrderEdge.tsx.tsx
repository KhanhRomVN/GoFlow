import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from "@xyflow/react";

const CallOrderEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const callOrder = data?.callOrder as number | undefined;
  const hasReturnValue = data?.hasReturnValue !== false;

  return (
    <React.Fragment>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {callOrder && hasReturnValue && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 11,
              fontWeight: 700,
              background: "#FFC107",
              color: "#000",
              padding: "2px 6px",
              borderRadius: "4px",
              border: "1px solid #F59E0B",
              pointerEvents: "all",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            }}
            className="nodrag nopan"
          >
            {String(callOrder).padStart(1, "0")}
          </div>
        </EdgeLabelRenderer>
      )}
    </React.Fragment>
  );
};

export default CallOrderEdge;
