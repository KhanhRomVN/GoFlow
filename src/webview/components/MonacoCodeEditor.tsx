import React, { useState, useEffect } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Logger } from "../../utils/webviewLogger";

// Configure Monaco to use local workers in VSCode webview
declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl?: (workerId: string, label: string) => string;
      getWorker?: (workerId: string, label: string) => Worker;
    };
  }
}

interface MonacoCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string;
  readOnly?: boolean;
  lineNumber?: number;
  onLineClick?: (lineNumber: number, lineContent: string) => void;
}

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  onChange,
  language = "go",
  height = "300px",
  readOnly = false,
  lineNumber = 1,
  onLineClick,
}) => {
  const [isEditorReady, setIsEditorReady] = useState(false);

  useEffect(() => {
    // Configure Monaco to load from local media/vs folder
    try {
      loader.config({
        paths: {
          vs: "./vs",
        },
        "vs/nls": {
          availableLanguages: {},
        },
      });

      loader
        .init()
        .then(() => {
          Logger.info("[MonacoCodeEditor] Monaco initialized successfully");
        })
        .catch((err) => {
          console.error("[MonacoCodeEditor] Failed to initialize Monaco:", err);
          console.error("[MonacoCodeEditor] Stack:", err?.stack);
        });
    } catch (err) {
      console.error("[MonacoCodeEditor] Exception during Monaco config:", err);
    }
  }, []);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    setIsEditorReady(true);

    // Listen to cursor position changes
    if (onLineClick) {
      editor.onDidChangeCursorPosition((e: any) => {
        const lineNumber = e.position.lineNumber;
        const lineContent = editor.getModel()?.getLineContent(lineNumber) || "";
        Logger.debug("[MonacoCodeEditor] Cursor moved to line:", {
          lineNumber,
          lineContent,
        });
        onLineClick(lineNumber, lineContent);
      });
    }

    // Get theme from VSCode API directly
    let themeName = "vs-dark"; // Default to dark theme

    try {
      // Try to get theme from window object first
      const themeInfo = (window as any).__goflowTheme;

      if (themeInfo && typeof themeInfo.isDark === "boolean") {
        themeName = themeInfo.isDark ? "vs-dark" : "vs";
      } else {
        // Fallback: detect from CSS variables
        const bgColor = getComputedStyle(document.body)
          .getPropertyValue("--vscode-editor-background")
          .trim();

        // If background is light-colored, use light theme
        if (bgColor && bgColor.startsWith("#")) {
          const r = parseInt(bgColor.slice(1, 3), 16);
          const g = parseInt(bgColor.slice(3, 5), 16);
          const b = parseInt(bgColor.slice(5, 7), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          themeName = brightness > 128 ? "vs" : "vs-dark";
        }
      }
    } catch (err) {
      Logger.error("[MonacoCodeEditor] Error detecting theme:", err);
    }

    monaco.editor.setTheme(themeName);

    // Set line number offset if needed
    if (lineNumber > 1) {
      editor.revealLineInCenter(1);
    }
  };

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  return (
    <div style={{ width: "100%", height }}>
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        loading={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--vscode-editor-foreground)",
              fontSize: "12px",
            }}
          >
            Loading editor...
          </div>
        }
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          fontFamily: "'Courier New', monospace",
          lineHeight: 19,
          lineNumbers: "on",
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 4,
          renderLineHighlight: "none",
          scrollbar: {
            vertical: "hidden",
            horizontal: "auto",
            verticalScrollbarSize: 0,
            horizontalScrollbarSize: 8,
            alwaysConsumeMouseWheel: false,
          },
          automaticLayout: true,
          wordWrap: "off",
          wrappingIndent: "none",
          tabSize: 4,
          insertSpaces: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
};

export default MonacoCodeEditor;
