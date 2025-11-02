// src/webview/components/FlowPathDrawer.tsx
import React, { useState, useMemo } from "react";
import { FlowPath } from "../utils/FlowPathTracker";
import "../styles/flow-path-drawer.css";

interface FlowPathDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  flows: FlowPath[];
  onSelectFlow: (flowId: string) => void;
  onDeleteFlow: (flowId: string) => void;
  onClearAll: () => void;
}

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

  const filteredFlows = useMemo(() => {
    return flows.filter((flow) => {
      const matchesSearch =
        searchQuery === "" ||
        flow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        flow.nodes.some((node) =>
          node.label.toLowerCase().includes(searchQuery.toLowerCase())
        );

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
      return { total: 0, avgDepth: 0, maxDepth: 0 };
    }

    const depths = flows.map((f) => f.depth);
    const total = flows.length;
    const avgDepth = Math.round(depths.reduce((sum, d) => sum + d, 0) / total);
    const maxDepth = Math.max(...depths);

    return { total, avgDepth, maxDepth };
  }, [flows]);

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-2).join("/");
  };

  const getDepthColor = (depth: number): string => {
    if (depth <= 3) return "short";
    if (depth <= 6) return "medium";
    return "long";
  };

  return (
    <>
      <div className={`flow-path-drawer ${isOpen ? "open" : ""}`}>
        <div className="flow-path-header">
          <div className="flow-path-title">
            <span className="flow-path-icon">🔄</span>
            <span className="flow-path-title-text">Flow Paths</span>
            <span className="flow-path-count">{stats.total}</span>
          </div>
          <button
            className="flow-path-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="flow-path-stats">
          <div className="flow-path-stat-item">
            <span className="flow-path-stat-label">Avg Depth</span>
            <span className="flow-path-stat-value">{stats.avgDepth}</span>
          </div>
          <div className="flow-path-stat-item">
            <span className="flow-path-stat-label">Max Depth</span>
            <span className="flow-path-stat-value">{stats.maxDepth}</span>
          </div>
        </div>

        <div className="flow-path-search">
          <input
            type="text"
            className="flow-path-search-input"
            placeholder="Search flows..."
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
            Long (6)
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
        </div>

        <div className="flow-path-list">
          {filteredFlows.length === 0 ? (
            <div className="flow-path-empty">
              {searchQuery
                ? `No flows found matching "${searchQuery}"`
                : "No flows available"}
            </div>
          ) : (
            filteredFlows.map((flow) => {
              return (
                <div
                  key={flow.id}
                  className={`flow-path-item ${flow.isActive ? "active" : ""}`}
                  onClick={() => onSelectFlow(flow.id)}
                >
                  <div className="flow-path-item-header">
                    <div className="flow-path-item-title">
                      <span className="flow-path-item-icon">🔗</span>
                      <span className="flow-path-item-name">{flow.name}</span>
                    </div>
                    <div className="flow-path-item-actions">
                      <span
                        className={`flow-path-depth-badge ${getDepthColor(
                          flow.depth
                        )}`}
                      >
                        {flow.depth}
                      </span>
                      <button
                        className="flow-path-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFlow(flow.id);
                        }}
                        title="Delete flow"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  <div className="flow-path-item-body">
                    {flow.nodes.map((node, index) => (
                      <div key={index} className="flow-path-node">
                        <div className="flow-path-node-indicator">
                          {index === 0
                            ? "🏁"
                            : index === flow.nodes.length - 1
                            ? "🎯"
                            : "➤"}
                        </div>
                        <div className="flow-path-node-info">
                          <div className="flow-path-node-label">
                            <span
                              className={`flow-path-node-type ${node.type}`}
                            >
                              {node.type === "function" ? "𝑓" : "ⓜ"}
                            </span>
                            <span className="flow-path-node-name">
                              {node.label}
                            </span>
                          </div>
                          <div className="flow-path-node-meta">
                            {getRelativePath(node.file)}:{node.line}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default FlowPathDrawer;
