import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { GraphData } from "../../models/Node";

cytoscape.use(dagre);

interface CanvasProps {
  vscode: any;
}

interface LayoutType {
  name: string;
  options: any;
}

const nodeColors = {
  function: "#4CAF50",
  method: "#2196F3",
  struct: "#FF9800",
  interface: "#9C27B0",
  unknown: "#757575",
};

const Canvas: React.FC<CanvasProps> = ({ vscode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [currentLayout, setCurrentLayout] = useState<string>("dagre");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    code: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    code: "",
  });

  const getLayoutOptions = (layoutName: string) => {
    const layouts: Record<string, any> = {
      dagre: {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 50,
        rankSep: 100,
        animate: false,
      },
      cose: {
        name: "cose",
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: false,
        componentSpacing: 100,
      },
      circle: {
        name: "circle",
        fit: true,
        padding: 30,
        avoidOverlap: true,
      },
      grid: {
        name: "grid",
        fit: true,
        padding: 30,
        avoidOverlap: true,
      },
    };
    return layouts[layoutName] || layouts.dagre;
  };

  const renderGraph = (data: GraphData) => {
    if (!containerRef.current) return;

    const elements: any[] = [];

    data.nodes.forEach((node) => {
      elements.push({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          file: node.file,
          line: node.line,
        },
      });
    });

    data.edges.forEach((edge) => {
      elements.push({
        data: {
          id: `${edge.source}_${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: edge.type,
        },
      });
    });

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: any) =>
              nodeColors[ele.data("type") as keyof typeof nodeColors] ||
              nodeColors.unknown,
            label: "data(label)",
            width: 80,
            height: 80,
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "12px",
            color: "#fff",
            "text-outline-width": 2,
            "text-outline-color": (ele: any) =>
              nodeColors[ele.data("type") as keyof typeof nodeColors] ||
              nodeColors.unknown,
            shape: (ele: any) => {
              const type = ele.data("type");
              if (type === "struct") return "rectangle";
              if (type === "interface") return "diamond";
              return "ellipse";
            },
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#FFC107",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#666",
            "target-arrow-color": "#666",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 1.5,
          },
        },
        {
          selector: "edge:selected",
          style: {
            "line-color": "#FFC107",
            "target-arrow-color": "#FFC107",
            width: 3,
          },
        },
      ],
      layout: getLayoutOptions(currentLayout),
    });

    cyRef.current.on("tap", "node", (evt: any) => {
      const node = evt.target;
      vscode.postMessage({
        command: "jumpToDefinition",
        file: node.data("file"),
        line: node.data("line"),
      });
    });

    cyRef.current.on("mouseover", "node", (evt: any) => {
      const node = evt.target;
      vscode.postMessage({
        command: "getCodePreview",
        file: node.data("file"),
        line: node.data("line"),
        nodeId: node.data("id"),
      });
    });

    cyRef.current.on("mouseout", "node", () => {
      setTooltip({ visible: false, x: 0, y: 0, code: "" });
    });

    cyRef.current.fit();
    setIsLoading(false);
  };

  const handleFit = () => {
    if (cyRef.current) {
      cyRef.current.fit();
    }
  };

  const handleZoomIn = () => {
    if (cyRef.current) {
      cyRef.current.zoom(cyRef.current.zoom() * 1.2);
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      cyRef.current.zoom(cyRef.current.zoom() * 0.8);
    }
  };

  const handleExport = () => {
    if (!cyRef.current) return;
    const png = cyRef.current.png({
      output: "base64",
      bg: "#1e1e1e",
      full: true,
      scale: 2,
    });
    vscode.postMessage({
      command: "export",
      dataUrl: png,
    });
  };

  const handleLayoutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLayout = e.target.value;
    setCurrentLayout(newLayout);
    if (cyRef.current) {
      const layout = cyRef.current.layout(getLayoutOptions(newLayout));
      layout.run();
    }
  };

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "renderGraph":
          renderGraph(message.data);
          break;
        case "refresh":
          if (cyRef.current) {
            cyRef.current.fit();
          }
          break;
        case "showCodePreview":
          if (cyRef.current) {
            const node = cyRef.current.getElementById(message.nodeId);
            if (node.length > 0) {
              const pos = node.renderedPosition();
              setTooltip({
                visible: true,
                x: pos.x + 50,
                y: pos.y,
                code: message.code,
              });
            }
          }
          break;
        case "exportRequest":
          handleExport();
          break;
      }
    };

    window.addEventListener("message", messageHandler);
    vscode.postMessage({ command: "ready" });

    return () => {
      window.removeEventListener("message", messageHandler);
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {isLoading && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "white",
            fontSize: "20px",
          }}
        >
          Loading GoFlow Canvas...
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          display: isLoading ? "none" : "block",
        }}
      />

      {tooltip.visible && (
        <div
          className="tooltip"
          style={{
            position: "absolute",
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            display: "block",
          }}
        >
          <pre>
            <code className="language-go">{tooltip.code}</code>
          </pre>
        </div>
      )}

      <div id="controls">
        <button onClick={handleFit} title="Fit to screen">
          ⊡
        </button>
        <button onClick={handleZoomIn} title="Zoom in">
          +
        </button>
        <button onClick={handleZoomOut} title="Zoom out">
          −
        </button>
        <button onClick={handleExport} title="Export as PNG">
          💾
        </button>
        <select value={currentLayout} onChange={handleLayoutChange}>
          <option value="dagre">Dagre</option>
          <option value="cose">COSE</option>
          <option value="circle">Circle</option>
          <option value="grid">Grid</option>
        </select>
      </div>
    </div>
  );
};

export default Canvas;
