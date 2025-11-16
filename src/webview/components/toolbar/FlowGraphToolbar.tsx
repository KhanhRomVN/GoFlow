import React from "react";
import { Panel } from "@xyflow/react";
import { FrameworkConfig } from "../../configs/layoutStrategies";
import { EdgeTracker } from "../../utils/EdgeTracker";

/**
 * Compact toolbar component extracted from FlowGraph.tsx to reduce main file size.
 * Provides buttons for:
 *  - Node visibility drawer
 *  - Jump-to-file toggle
 *  - Auto sort (framework aware)
 *  - Fit view
 *  - Export
 *  - Edge statistics
 *  - Execution trace drawer toggle
 */
export interface FlowGraphToolbarProps {
  enableJumpToFile: boolean;
  setEnableJumpToFile: (val: boolean) => void;
  detectedFramework: FrameworkConfig | null;
  isAutoSorting: boolean;
  handleAutoSort: () => void;
  handleFit: () => void;
  handleExport: () => void;
  isTraceDrawerOpen: boolean;
  toggleTraceDrawer: () => void;
  handleToggleDrawer: () => void;
  vscode: any;
}

const FlowGraphToolbar: React.FC<FlowGraphToolbarProps> = ({
  enableJumpToFile,
  setEnableJumpToFile,
  detectedFramework,
  isAutoSorting,
  handleAutoSort,
  handleFit,
  handleExport,
  isTraceDrawerOpen,
  toggleTraceDrawer,
  handleToggleDrawer,
  vscode,
}) => {
  return (
    <Panel
      position="top-right"
      className="flow-graph-panel flow-graph-panel-modern"
    >
      <div className="flow-graph-button-group">
        <button
          onClick={handleToggleDrawer}
          className="fg-btn"
          title="Node Visibility"
        >
          👁️
        </button>
        <button
          onClick={() => setEnableJumpToFile(!enableJumpToFile)}
          className={`fg-btn ${
            enableJumpToFile ? "fg-btn-active" : "fg-btn-inactive"
          }`}
          title={enableJumpToFile ? "Jump to file: ON" : "Jump to file: OFF"}
        >
          {enableJumpToFile ? "🔗" : "⛔"}
        </button>
        <button
          onClick={handleAutoSort}
          className="fg-btn"
          title={
            detectedFramework
              ? `Auto Sort: ${detectedFramework.strategy.description}`
              : "Auto Sort Layout"
          }
          disabled={!detectedFramework || isAutoSorting}
        >
          {isAutoSorting ? "⏳" : "🔄"}
        </button>
        <button onClick={handleFit} className="fg-btn" title="Fit view">
          ⊡
        </button>
        <button
          onClick={handleExport}
          className="fg-btn"
          title="Export diagram"
        >
          💾
        </button>
        <button
          onClick={() => {
            const stats = EdgeTracker.getStats();
            EdgeTracker.logCurrentState();
            vscode.postMessage({
              command: "showEdgeStats",
              stats,
              edges: EdgeTracker.getAllEdges(),
              formattedReport: EdgeTracker.getEdgeListFormatted(),
            });
          }}
          className="fg-btn"
          title="Edge statistics"
        >
          📊
        </button>
        <button
          onClick={toggleTraceDrawer}
          className={`fg-btn ${isTraceDrawerOpen ? "fg-btn-active" : ""}`}
          title="Execution Flow List"
        >
          🗒️
        </button>
      </div>
    </Panel>
  );
};

export default FlowGraphToolbar;
