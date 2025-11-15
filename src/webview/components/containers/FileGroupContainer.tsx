import React, { memo } from "react";
import { NodeProps } from "@xyflow/react";
import "../../styles/file-group-container.css";

interface FileGroupContainerData extends Record<string, unknown> {
  fileName: string;
  nodeCount: number;
  functionNodeCount: number;
  declarationNodeCount: number;
  width: number;
  height: number;
}

// Update FileGroupContainer.tsx to show both counts
const FileGroupContainer: React.FC<NodeProps> = ({ data }) => {
  const containerData = data as FileGroupContainerData;

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-3).join("/");
  };

  return (
    <div
      className="file-group-container"
      style={{
        width: containerData.width,
        height: containerData.height,
      }}
    >
      <div className="file-group-container-header">
        <span className="file-group-container-icon">📁</span>
        <span className="file-group-container-filename">
          {getRelativePath(containerData.fileName)}
        </span>
        <span className="file-group-container-badge">
          {containerData.functionNodeCount || 0}ƒ
          {containerData.declarationNodeCount
            ? ` + ${containerData.declarationNodeCount}D`
            : ""}
        </span>
      </div>
    </div>
  );
};

export default memo(FileGroupContainer);
