import { useCallback } from "react";
import { FrameworkConfig, detectFramework } from "../configs/layoutStrategies";
import convertToFlowDataExternal from "../utils/flowConversion";
import { getLayoutedElements } from "../utils/graphLayout";
import type { GraphData } from "../../models/Node";
import type { FlowNode, FlowEdge } from "../types/flowGraph";

/**
 * Parameters required for renderGraph orchestration.
 * These are passed from FlowGraph to keep this hook stateless regarding ReactFlow instance & external refs.
 */
export interface UseRenderGraphParams {
  detectedFramework: FrameworkConfig | null;
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  setCurrentFileName: (f: string) => void;
  setDetectedFramework: (fw: FrameworkConfig | null) => void;
  setIsLoading: (b: boolean) => void;
  setError: (msg: string | null) => void;
  setIsGraphReady: (b: boolean) => void;

  lineHighlightedEdges: Set<string>;
  handleHighlightEdge: (sourceId: string, targetId: string) => void;
  handleClearHighlight: () => void;
  handleNodeHighlight: (nodeId: string) => void;
  handleClearNodeHighlight: () => void;

  nodes: FlowNode[];
  vscode: any;

  buildStaticExecutionTrace: (edges: FlowEdge[], nodes: FlowNode[]) => void;
  setRootIfUnset: (nodes: FlowNode[]) => void;
  logToExtension: (
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    message: string,
    data?: any
  ) => void;

  // Instrumentation / session tracking refs
  queuedNodeHighlightCountsRef: React.MutableRefObject<Record<string, number>>;
  queuedEdgeHighlightCountRef: React.MutableRefObject<number>;
  midReloadRef: React.MutableRefObject<boolean>;
  prevNodesRef: React.MutableRefObject<FlowNode[]>;
  prevEdgesRef: React.MutableRefObject<FlowEdge[]>;
  currentSessionIdRef: React.MutableRefObject<number>;
  renderStartRef: React.MutableRefObject<number>;
  renderInvocationCountRef: React.MutableRefObject<number>;
  isGraphReady: boolean;
}

/**
 * Hook that returns the renderGraph async function used by FlowGraph.
 * Separates bulky logic from component body to improve readability.
 */
export function useRenderGraph(params: UseRenderGraphParams) {
  const {
    detectedFramework,
    setNodes,
    setEdges,
    setCurrentFileName,
    setDetectedFramework,
    setIsLoading,
    setError,
    setIsGraphReady,
    lineHighlightedEdges,
    handleHighlightEdge,
    handleClearHighlight,
    handleNodeHighlight,
    handleClearNodeHighlight,
    nodes,
    vscode,
    buildStaticExecutionTrace,
    setRootIfUnset,
    logToExtension,
    queuedNodeHighlightCountsRef,
    queuedEdgeHighlightCountRef,
    midReloadRef,
    prevNodesRef,
    prevEdgesRef,
    currentSessionIdRef,
    renderStartRef,
    renderInvocationCountRef,
    isGraphReady,
  } = params;

  const renderGraph = useCallback(
    async (data: GraphData, fileName?: string) => {
      try {
        (window as any).__goflowPendingNodeHighlight = null;
        (window as any).__goflowPendingLineClick = null;
        (window as any).__goflowPendingEdgeHighlights = [];

        renderStartRef.current = performance.now();
        renderInvocationCountRef.current += 1;

        // Diagnostic logging
        logToExtension("INFO", "[FlowGraph] 🚀 START renderGraph", {
          fileName,
          rawNodeCount: data.nodes.length,
          rawEdgeCount: data.edges.length,
          invocation: renderInvocationCountRef.current,
          sessionId: currentSessionIdRef.current,
          previousReadyState: isGraphReady,
          previousNodeCount: nodes.length,
          previousEdgeCount: prevEdgesRef.current.length,
        });
        logToExtension("DEBUG", "[FlowGraph] renderGraph start", {
          fileName,
          nodeCount: data.nodes.length,
          edgeCount: data.edges.length,
          isGraphReadyBefore: isGraphReady,
          invocation: renderInvocationCountRef.current,
          sessionId: currentSessionIdRef.current,
        });

        if (fileName) {
          setCurrentFileName(fileName);
          const firstNode = data.nodes[0];
          const fileContent = firstNode?.code || "";
          const detected = detectFramework(fileName, fileContent);
          setDetectedFramework(detected);
          logToExtension("DEBUG", "[FlowGraph] Framework detection", {
            detected: detected?.strategy.description,
          });
        }

        // Convert raw graph data to flow nodes/edges (includes side-effect callbacks)
        const { nodes: flowNodes, edges: flowEdges } =
          convertToFlowDataExternal(data, {
            vscode,
            detectedDirection: detectedFramework?.strategy.direction,
            lineHighlightedEdges,
            onHighlightEdge: handleHighlightEdge,
            onClearHighlight: handleClearHighlight,
            onNodeHighlight: handleNodeHighlight,
            onClearNodeHighlight: handleClearNodeHighlight,
          });

        // Layout
        const { nodes: layoutedNodes, edges: layoutedEdges } =
          await getLayoutedElements(flowNodes, flowEdges, detectedFramework);

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        logToExtension("DEBUG", "[FlowGraph] Layout applied", {
          layoutNodeCount: layoutedNodes.length,
          layoutEdgeCount: layoutedEdges.length,
          invocation: renderInvocationCountRef.current,
        });

        // Set execution trace root automatically
        setRootIfUnset(layoutedNodes);

        setIsLoading(false);
        setError(null);
        setIsGraphReady(true);
        logToExtension("INFO", "[FlowGraph] Graph ready", {
          invocation: renderInvocationCountRef.current,
          sessionId: currentSessionIdRef.current,
          queuedNodeHighlightAttempts: Object.entries(
            queuedNodeHighlightCountsRef.current
          ).map(([nodeId, attempts]) => ({ nodeId, attempts })),
          queuedEdgeEventsTotal: queuedEdgeHighlightCountRef.current,
          bufferedPrevGraph: {
            hadBuffer: midReloadRef.current,
            prevNodeCount: prevNodesRef.current.length,
            prevEdgeCount: prevEdgesRef.current.length,
          },
        });

        (window as any).__goflowGraphReady = true;
        (window as any).__goflowSessionId = currentSessionIdRef.current;
        (window as any).__goflowEffectiveGraphReady = true;
        (window as any).__goflowEdges = layoutedEdges;
        window.dispatchEvent(
          new CustomEvent("goflow-effective-ready", {
            detail: {
              sessionId: currentSessionIdRef.current,
              nodeCount: layoutedNodes.length,
              edgeCount: layoutedEdges.length,
            },
          })
        );

        midReloadRef.current = false;
        prevNodesRef.current = [];
        prevEdgesRef.current = [];

        // Process queued items now that graph is ready
        try {
          const pendingNodeId = (window as any).__goflowPendingNodeHighlight;
          if (pendingNodeId) {
            delete (window as any).__goflowPendingNodeHighlight;
            handleNodeHighlight(pendingNodeId);
          }
          const pendingEdges =
            (window as any).__goflowPendingEdgeHighlights || [];
          if (Array.isArray(pendingEdges) && pendingEdges.length > 0) {
            pendingEdges.forEach((h: any) =>
              handleHighlightEdge(h.source, h.target)
            );
            delete (window as any).__goflowPendingEdgeHighlights;
          }
        } catch {
          // swallow
        }

        // Initialize execution trace with the layouted graph
        buildStaticExecutionTrace(layoutedEdges, layoutedNodes);

        const elapsed = performance.now() - renderStartRef.current;
        logToExtension("INFO", "[FlowGraph] Graph layout completed", {
          layoutNodeCount: layoutedNodes.length,
          layoutEdgeCount: layoutedEdges.length,
          elapsedMs: Math.round(elapsed),
          pendingHighlightNodeId:
            (window as any).__goflowPendingNodeHighlight || null,
          pendingEdgeQueueSize: Array.isArray(
            (window as any).__goflowPendingEdgeHighlights
          )
            ? (window as any).__goflowPendingEdgeHighlights.length
            : 0,
        });
      } catch (err: any) {
        console.error("[FlowGraph] Failed to render graph:", err);
        logToExtension("ERROR", "[FlowGraph] renderGraph failure", {
          error: err instanceof Error ? err.message : String(err),
        });
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsLoading(false);
        setIsGraphReady(false);
      }
    },
    [
      detectedFramework,
      setNodes,
      setEdges,
      setCurrentFileName,
      setDetectedFramework,
      setIsLoading,
      setError,
      setIsGraphReady,
      lineHighlightedEdges,
      handleHighlightEdge,
      handleClearHighlight,
      handleNodeHighlight,
      handleClearNodeHighlight,
      nodes,
      vscode,
      buildStaticExecutionTrace,
      setRootIfUnset,
      logToExtension,
      queuedNodeHighlightCountsRef,
      queuedEdgeHighlightCountRef,
      midReloadRef,
      prevNodesRef,
      prevEdgesRef,
      currentSessionIdRef,
      renderStartRef,
      renderInvocationCountRef,
      isGraphReady,
    ]
  );

  return { renderGraph };
}

export default useRenderGraph;
