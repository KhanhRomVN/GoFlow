// src/webview/components/FlowPathDrawer.tsx
import React, { useState, useMemo, useCallback } from "react";
import { FlowPath, FlowNode } from "../utils/FlowPathTracker";
import "../styles/flow-path-drawer.css";

interface FlowPathDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  flows: FlowPath[];
  onSelectFlow: (flowId: string) => void;
  onDeleteFlow: (flowId: string) => void;
  onClearAll: () => void;
}

// Execution Flow Visualization Component
const ExecutionFlowVisualization: React.FC<{ flow: FlowPath }> = ({ flow }) => {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const handleStepClick = useCallback(
    (index: number) => {
      setActiveStep(activeStep === index ? null : index);
    },
    [activeStep]
  );

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-2).join("/");
  };

  return (
    <div className="execution-flow-visualization">
      <div className="execution-flow-header">
        <h3>Execution Flow</h3>
        <span className="flow-steps">{flow.nodes.length} steps</span>
      </div>

      {flow.description && (
        <div className="execution-flow-description">{flow.description}</div>
      )}

      <div className="execution-steps">
        {flow.nodes.map((node, index) => (
          <div key={node.id} className="execution-step-container">
            <div
              className={`execution-step ${
                activeStep === index ? "active" : ""
              }`}
              onClick={() => handleStepClick(index)}
            >
              <div className="step-number">{index + 1}</div>
              <div className="step-content">
                <div className="step-function">
                  <span className={`function-type ${node.type}`}>
                    {node.type === "function" ? "FUNC" : "METHOD"}
                  </span>
                  <span className="function-name">{node.label}</span>
                </div>
                <div className="step-file">
                  {getRelativePath(node.file)}:{node.line}
                </div>
              </div>
            </div>
            {index < flow.nodes.length - 1 && (
              <div className="step-arrow">↓</div>
            )}
          </div>
        ))}
      </div>

      <div className="execution-flow-actions">
        <button
          className="execution-flow-action-btn"
          onClick={() => {
            // Export flow functionality can be added here
          }}
        >
          Export Flow
        </button>
        <button
          className="execution-flow-action-btn secondary"
          onClick={() => {
            // Highlight flow in graph functionality can be added here
          }}
        >
          Highlight in Graph
        </button>
      </div>
    </div>
  );
};

// Flow List Item Component
const FlowListItem: React.FC<{
  flow: FlowPath;
  isActive: boolean;
  onSelect: (flowId: string) => void;
  onDelete: (flowId: string) => void;
}> = ({ flow, isActive, onSelect, onDelete }) => {
  const getDepthColor = (depth: number): string => {
    if (depth <= 3) return "short";
    if (depth <= 6) return "medium";
    return "long";
  };

  const getFlowIcon = (flow: FlowPath): string => {
    if (flow.name.includes("Long Chain")) return "🔗";
    if (flow.name.includes("Execution")) return "🔄";
    return "📊";
  };

  return (
    <div
      className={`flow-path-item ${isActive ? "active" : ""}`}
      onClick={() => onSelect(flow.id)}
    >
      <div className="flow-path-item-header">
        <div className="flow-path-item-title">
          <span className="flow-path-item-icon">{getFlowIcon(flow)}</span>
          <span className="flow-path-item-name">{flow.name}</span>
        </div>
        <div className="flow-path-item-actions">
          <span
            className={`flow-path-depth-badge ${getDepthColor(flow.depth)}`}
          >
            {flow.depth}
          </span>
          <button
            className="flow-path-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(flow.id);
            }}
            title="Delete flow"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="flow-path-item-body">
        {flow.description && (
          <div className="flow-path-item-description">{flow.description}</div>
        )}
        <div className="flow-path-node">
          <div className="flow-path-node-indicator">🏁</div>
          <div className="flow-path-node-info">
            <div className="flow-path-node-label">
              <span
                className={`flow-path-node-type ${
                  flow.nodes[0]?.type || "function"
                }`}
              >
                {flow.nodes[0]?.type === "function" ? "𝑓" : "ⓜ"}
              </span>
              <span className="flow-path-node-name">
                {flow.nodes[0]?.label || "Start"}
              </span>
            </div>
            <div className="flow-path-node-meta">
              {flow.nodes[0]?.file.split("/").pop()}:{flow.nodes[0]?.line}
            </div>
          </div>
        </div>

        {flow.nodes.length > 1 && (
          <>
            <div
              style={{
                textAlign: "center",
                color: "var(--vscode-descriptionForeground)",
                fontSize: "12px",
              }}
            >
              ... {flow.nodes.length - 2} more steps ...
            </div>

            <div className="flow-path-node">
              <div className="flow-path-node-indicator">🎯</div>
              <div className="flow-path-node-info">
                <div className="flow-path-node-label">
                  <span
                    className={`flow-path-node-type ${
                      flow.nodes[flow.nodes.length - 1]?.type || "function"
                    }`}
                  >
                    {flow.nodes[flow.nodes.length - 1]?.type === "function"
                      ? "𝑓"
                      : "ⓜ"}
                  </span>
                  <span className="flow-path-node-name">
                    {flow.nodes[flow.nodes.length - 1]?.label || "End"}
                  </span>
                </div>
                <div className="flow-path-node-meta">
                  {flow.nodes[flow.nodes.length - 1]?.file.split("/").pop()}:
                  {flow.nodes[flow.nodes.length - 1]?.line}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const FlowPathDrawer: React.FC<FlowPathDrawerProps> = ({
  isOpen,
  onClose,
  flows,
  onSelectFlow,
  onDeleteFlow,
  onClearAll,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDepth, setFilterDepth] = useState<
    "all" | "short" | "medium" | "long"
  >("all");
  const [selectedFlow, setSelectedFlow] = useState<FlowPath | null>(null);

  const filteredFlows = useMemo(() => {
    return flows.filter((flow) => {
      const matchesSearch =
        searchQuery === "" ||
        flow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        flow.nodes.some((node) =>
          node.label.toLowerCase().includes(searchQuery.toLowerCase())
        ) ||
        (flow.description &&
          flow.description.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesDepth = true;
      if (filterDepth === "short") {
        matchesDepth = flow.depth <= 3;
      } else if (filterDepth === "medium") {
        matchesDepth = flow.depth > 3 && flow.depth <= 6;
      } else if (filterDepth === "long") {
        matchesDepth = flow.depth > 6;
      }

      return matchesSearch && matchesDepth;
    });
  }, [flows, searchQuery, filterDepth]);

  const stats = useMemo(() => {
    if (flows.length === 0) {
      return {
        total: 0,
        avgDepth: 0,
        maxDepth: 0,
        minDepth: 0,
        totalSteps: 0,
      };
    }

    const depths = flows.map((f) => f.depth);
    const total = flows.length;
    const avgDepth =
      Math.round((depths.reduce((sum, d) => sum + d, 0) / total) * 10) / 10;
    const maxDepth = Math.max(...depths);
    const minDepth = Math.min(...depths);
    const totalSteps = flows.reduce((sum, flow) => sum + flow.nodes.length, 0);

    return { total, avgDepth, maxDepth, minDepth, totalSteps };
  }, [flows]);

  const handleSelectFlow = useCallback(
    (flowId: string) => {
      const flow = flows.find((f) => f.id === flowId);
      setSelectedFlow(flow || null);
      onSelectFlow(flowId);
    },
    [flows, onSelectFlow]
  );

  const handleBackToList = useCallback(() => {
    setSelectedFlow(null);
  }, []);

  const handleExportAll = useCallback(() => {
    // Export all flows functionality can be added here
  }, [flows]);

  const getStatValueClass = (
    value: number,
    type: "depth" | "steps" = "depth"
  ): string => {
    if (type === "depth") {
      if (value <= 3) return "low";
      if (value <= 6) return "medium";
      return "high";
    } else {
      if (value <= 10) return "low";
      if (value <= 20) return "medium";
      return "high";
    }
  };

  return (
    <div className={`flow-path-drawer ${isOpen ? "open" : ""}`}>
      <div className="flow-path-header">
        <div className="flow-path-title">
          <span className="flow-path-icon">🔄</span>
          <span className="flow-path-title-text">Execution Flows</span>
          <span className="flow-path-count">{stats.total}</span>
        </div>
        <button className="flow-path-close-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {selectedFlow ? (
        <div className="flow-detail-view">
          <button className="back-button" onClick={handleBackToList}>
            ← Back to Flows
          </button>
          <ExecutionFlowVisualization flow={selectedFlow} />
        </div>
      ) : (
        <div className="flow-list-view">
          <div className="flow-path-stats">
            <div className="flow-path-stat-item">
              <span className="flow-path-stat-label">Avg Depth</span>
              <span
                className={`flow-path-stat-value ${getStatValueClass(
                  stats.avgDepth
                )}`}
              >
                {stats.avgDepth}
              </span>
            </div>
            <div className="flow-path-stat-item">
              <span className="flow-path-stat-label">Max Depth</span>
              <span
                className={`flow-path-stat-value ${getStatValueClass(
                  stats.maxDepth
                )}`}
              >
                {stats.maxDepth}
              </span>
            </div>
            <div className="flow-path-stat-item">
              <span className="flow-path-stat-label">Total Steps</span>
              <span
                className={`flow-path-stat-value ${getStatValueClass(
                  stats.totalSteps,
                  "steps"
                )}`}
              >
                {stats.totalSteps}
              </span>
            </div>
            <div className="flow-path-stat-item">
              <span className="flow-path-stat-label">Flows</span>
              <span className="flow-path-stat-value">{stats.total}</span>
            </div>
          </div>

          <div className="flow-path-search">
            <input
              type="text"
              className="flow-path-search-input"
              placeholder="Search flows or functions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flow-path-filter">
            <button
              className={`flow-path-filter-btn ${
                filterDepth === "all" ? "active" : ""
              }`}
              onClick={() => setFilterDepth("all")}
            >
              All ({flows.length})
            </button>
            <button
              className={`flow-path-filter-btn ${
                filterDepth === "short" ? "active" : ""
              }`}
              onClick={() => setFilterDepth("short")}
            >
              Short (≤3)
            </button>
            <button
              className={`flow-path-filter-btn ${
                filterDepth === "medium" ? "active" : ""
              }`}
              onClick={() => setFilterDepth("medium")}
            >
              Medium (4-6)
            </button>
            <button
              className={`flow-path-filter-btn ${
                filterDepth === "long" ? "active" : ""
              }`}
              onClick={() => setFilterDepth("long")}
            >
              Long (6+)
            </button>
          </div>

          <div className="flow-path-actions">
            <button
              className="flow-path-action-btn clear-all"
              onClick={onClearAll}
              disabled={flows.length === 0}
            >
              Clear All
            </button>
            <button
              className="flow-path-action-btn export"
              onClick={handleExportAll}
              disabled={flows.length === 0}
            >
              Export All
            </button>
          </div>

          <div className="flow-path-list">
            {filteredFlows.length === 0 ? (
              <div className="flow-path-empty">
                {searchQuery
                  ? `No execution flows found matching "${searchQuery}"`
                  : "No execution flows available. Flows will be generated from function calls with return values."}
              </div>
            ) : (
              filteredFlows.map((flow) => (
                <FlowListItem
                  key={flow.id}
                  flow={flow}
                  isActive={flow.isActive}
                  onSelect={handleSelectFlow}
                  onDelete={onDeleteFlow}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FlowPathDrawer;
