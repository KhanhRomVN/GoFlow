import React, { useEffect } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Logger } from "../../../utils/webviewLogger";
import "../../styles/execution-trace-code-editor.css";

/**
 * Lightweight Monaco wrapper dedicated for ExecutionTraceCard.
 * Differences from MonacoCodeEditor:
 *  - No function call decorations logic
 *  - Dedicated segment highlight (past / active / future)
 *  - Read-only always
 *  - Auto height based on content clamped to max lines
 *  - Does NOT send cursor events back
 *
 * Segment highlighting rules:
 *  - segmentStartLine & segmentEndLine are 1-based relative lines inside the function snapshot.
 *  - Lines < segmentStartLine: dimmed (already executed earlier - past)
 *  - segmentStartLine .. segmentEndLine: bright (current active window)
 *  - Lines > segmentEndLine: dimmed (future not yet executed)
 *  - If only segmentEndLine is provided (and no segmentStartLine) fallback to legacy fadeFrom behavior (bright = 1..segmentEndLine)
 */

interface ExecutionTraceCodeEditorProps {
  value: string;
  language?: string;
  lineNumber?: number; // absolute starting line in original file
  height?: string;
  segmentStartLine?: number;
  segmentEndLine?: number;
  legacyFadeFromLine?: number; // fallback for older entries
  nodeId?: string;
  onEditorHeightChange?: (h: number) => void;
}

let monacoInitialized = false;

const ExecutionTraceCodeEditor: React.FC<ExecutionTraceCodeEditorProps> = ({
  value,
  language = "go",
  lineNumber = 1,
  height = "160px",
  segmentStartLine,
  segmentEndLine,
  legacyFadeFromLine,
  nodeId,
  onEditorHeightChange,
}) => {
  useEffect(() => {
    if (monacoInitialized) return;
    try {
      loader.config({
        paths: { vs: "./vs" },
        "vs/nls": { availableLanguages: {} },
      });
      loader
        .init()
        .then(() => {
          monacoInitialized = true;
        })
        .catch((err) => {
          Logger.error("[ExecutionTraceCodeEditor] Monaco init failed", err);
        });
    } catch (e) {
      Logger.error("[ExecutionTraceCodeEditor] Loader config exception", e);
    }
  }, []);

  const handleMount = (editor: any, monaco: any) => {
    // Theme selection (reuse logic from MonacoCodeEditor simplified)
    let themeName = "vs-dark";
    try {
      const themeInfo = (window as any).__goflowTheme;
      if (themeInfo && typeof themeInfo.isDark === "boolean") {
        themeName = themeInfo.isDark ? "vs-dark" : "vs";
      } else {
        const bgColor = getComputedStyle(document.body)
          .getPropertyValue("--vscode-editor-background")
          .trim();
        if (bgColor && bgColor.startsWith("#")) {
          const r = parseInt(bgColor.slice(1, 3), 16);
          const g = parseInt(bgColor.slice(3, 5), 16);
          const b = parseInt(bgColor.slice(5, 7), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          themeName = brightness > 128 ? "vs" : "vs-dark";
        }
      }
    } catch {}
    monaco.editor.setTheme(themeName);

    const model = editor.getModel();
    if (!model) return;

    // Auto-height
    const lineHeight = 19;
    const maxLines = 25;
    const actualLines = model.getLineCount();
    const targetLines = Math.min(actualLines, maxLines);
    const targetHeight = Math.max(
      3 * lineHeight,
      targetLines * lineHeight + 16
    );
    editor.layout({
      width: editor.getLayoutInfo().width,
      height: targetHeight,
    });
    if (onEditorHeightChange) onEditorHeightChange(targetHeight);

    // Apply segment decorations
    const applySegmentDecorations = () => {
      if (!model) return;
      const total = model.getLineCount();
      const decorations: any[] = [];

      if (
        typeof segmentStartLine === "number" &&
        segmentStartLine >= 1 &&
        typeof segmentEndLine === "number" &&
        segmentEndLine >= segmentStartLine
      ) {
        // Highlight active segment lines (skip line 1 - function declaration)
        for (let i = segmentStartLine; i < segmentEndLine; i++) {
          if (i === 1) continue; // Skip function declaration line
          decorations.push({
            range: new monaco.Range(i, 1, i, 1),
            options: {
              isWholeLine: true,
              className: "active-segment-line-with-bg",
            },
          });
        }
        // Call line: RED background + RED gutter ONLY
        decorations.push({
          range: new monaco.Range(segmentEndLine, 1, segmentEndLine, 1),
          options: {
            isWholeLine: true,
            className: "function-call-line-with-bg",
          },
        });
      } else if (
        typeof legacyFadeFromLine === "number" &&
        legacyFadeFromLine >= 1 &&
        legacyFadeFromLine <= total
      ) {
        // Legacy: highlight up to (EXCLUDING) call line, skip line 1
        for (let i = 1; i < legacyFadeFromLine; i++) {
          if (i === 1) continue; // Skip function declaration line
          decorations.push({
            range: new monaco.Range(i, 1, i, 1),
            options: {
              isWholeLine: true,
              className: "active-segment-line-with-bg",
            },
          });
        }
        // Legacy call line: RED background + RED gutter ONLY
        decorations.push({
          range: new monaco.Range(legacyFadeFromLine, 1, legacyFadeFromLine, 1),
          options: {
            isWholeLine: true,
            className: "function-call-line-with-bg",
          },
        });
      }

      editor.deltaDecorations([], decorations);
    };

    applySegmentDecorations();

    editor.onDidChangeModelContent(() => {
      applySegmentDecorations();
    });
  };

  return (
    <div
      className="execution-trace-monaco-container"
      style={{ height }}
      data-node-id={nodeId}
    >
      <Editor
        language={language}
        value={value}
        height="100%"
        onMount={handleMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          fontFamily: "'Courier New', monospace",
          lineHeight: 19,
          lineNumbers: (editorLineNumber: number) =>
            String(lineNumber + editorLineNumber - 1),
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 4,
          renderLineHighlight: "none",
          scrollbar: {
            vertical: "hidden",
            horizontal: "auto",
            verticalScrollbarSize: 0,
            alwaysConsumeMouseWheel: false,
          },
          automaticLayout: true,
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          wordWrap: "off",
          padding: { top: 6, bottom: 6 },
        }}
        loading={
          <div className="execution-trace-monaco-loading">
            Loading trace code...
          </div>
        }
      />
    </div>
  );
};

export default ExecutionTraceCodeEditor;
