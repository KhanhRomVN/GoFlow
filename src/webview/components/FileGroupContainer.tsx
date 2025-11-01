import React, { memo } from "react";
import { NodeProps } from "@xyflow/react";
import "../styles/file-group-container.css";

interface FileGroupContainerData extends Record<string, unknown> {
  fileName: string;
  nodeCount: number;
  width: number;
  height: number;
}

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
          {containerData.nodeCount}{" "}
          {containerData.nodeCount > 1 ? "nodes" : "node"}
        </span>
      </div>
    </div>
  );
};

export default memo(FileGroupContainer);
