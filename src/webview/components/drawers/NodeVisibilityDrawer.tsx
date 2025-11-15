import React, { useState, useMemo } from "react";
import "../../styles/node-visibility-drawer.css";

interface NodeInfo {
  id: string;
  label: string;
  type: "function" | "method";
  file: string;
  line: number;
}

interface NodeVisibilityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: NodeInfo[];
  hiddenNodeIds: Set<string>;
  onToggleNode: (nodeId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

const NodeVisibilityDrawer: React.FC<NodeVisibilityDrawerProps> = ({
  isOpen,
  onClose,
  nodes,
  hiddenNodeIds,
  onToggleNode,
  onShowAll,
  onHideAll,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "function" | "method">(
    "all"
  );

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesSearch =
        searchQuery === "" ||
        node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.file.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType = filterType === "all" || node.type === filterType;

      return matchesSearch && matchesType;
    });
  }, [nodes, searchQuery, filterType]);

  const getRelativePath = (fullPath: string): string => {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-2).join("/");
  };

  const visibleCount = nodes.length - hiddenNodeIds.size;

  return (
    <>
      <div
        className={`node-visibility-overlay ${isOpen ? "active" : ""}`}
        onClick={onClose}
      />

      <div className={`node-visibility-drawer ${isOpen ? "open" : ""}`}>
        <div className="node-visibility-header">
          <div className="node-visibility-title">
            <span className="node-visibility-icon">👁️</span>
            <span className="node-visibility-title-text">Node Visibility</span>
            <span className="node-visibility-count">
              {visibleCount}/{nodes.length}
            </span>
          </div>
          <button
            className="node-visibility-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="node-visibility-search">
          <input
            type="text"
            className="node-visibility-search-input"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="node-visibility-filter">
          <button
            className={`node-visibility-filter-btn ${
              filterType === "all" ? "active" : ""
            }`}
            onClick={() => setFilterType("all")}
          >
            All ({nodes.length})
          </button>
          <button
            className={`node-visibility-filter-btn ${
              filterType === "function" ? "active" : ""
            }`}
            onClick={() => setFilterType("function")}
          >
            Functions ({nodes.filter((n) => n.type === "function").length})
          </button>
          <button
            className={`node-visibility-filter-btn ${
              filterType === "method" ? "active" : ""
            }`}
            onClick={() => setFilterType("method")}
          >
            Methods ({nodes.filter((n) => n.type === "method").length})
          </button>
        </div>

        <div className="node-visibility-actions">
          <button
            className="node-visibility-action-btn show-all"
            onClick={onShowAll}
            disabled={hiddenNodeIds.size === 0}
          >
            Show All
          </button>
          <button
            className="node-visibility-action-btn hide-all"
            onClick={onHideAll}
            disabled={hiddenNodeIds.size === nodes.length}
          >
            Hide All
          </button>
        </div>

        <div className="node-visibility-list">
          {filteredNodes.length === 0 ? (
            <div className="node-visibility-empty">
              No nodes found matching "{searchQuery}"
            </div>
          ) : (
            filteredNodes.map((node) => {
              const isHidden = hiddenNodeIds.has(node.id);

              return (
                <div
                  key={node.id}
                  className={`node-visibility-item ${isHidden ? "hidden" : ""}`}
                  onClick={() => onToggleNode(node.id)}
                >
                  <div className="node-visibility-item-left">
                    <span className="node-visibility-toggle">
                      {isHidden ? "👁️‍🗨️" : "👁️"}
                    </span>
                    <span className={`node-visibility-type-badge ${node.type}`}>
                      {node.type === "function" ? "𝑓" : "ⓜ"}
                    </span>
                    <div className="node-visibility-item-info">
                      <div className="node-visibility-item-label">
                        {node.label}
                      </div>
                      <div className="node-visibility-item-meta">
                        {getRelativePath(node.file)}:{node.line}
                      </div>
                    </div>
                  </div>
                  <div className="node-visibility-item-status">
                    {isHidden ? "Hidden" : "Visible"}
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

export default NodeVisibilityDrawer;
