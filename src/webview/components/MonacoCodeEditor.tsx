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
}

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  onChange,
  language = "go",
  height = "300px",
  readOnly = false,
  lineNumber = 1,
}) => {
  const [isEditorReady, setIsEditorReady] = useState(false);

  Logger.info("[MonacoCodeEditor] Props:", {
    language,
    height,
    readOnly,
    lineNumber,
    valueLength: value?.length || 0,
  });

  useEffect(() => {
    Logger.info("[MonacoCodeEditor] Initializing Monaco loader");
    Logger.info(
      "[MonacoCodeEditor] Window.MonacoEnvironment:",
      window.MonacoEnvironment
    );

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
    Logger.info("[MonacoCodeEditor] Editor mounted");
    Logger.info("[MonacoCodeEditor] ReadOnly mode:", readOnly);
    setIsEditorReady(true);

    // Get theme info from window (stored by FlowGraph)
    const themeInfo = (window as any).__goflowTheme || {
      isDark: true,
      kind: 1, // Default to dark
    };

    Logger.info("[MonacoCodeEditor] Using theme:", themeInfo);

    // Simply use Monaco's built-in themes that match VSCode
    const themeName = themeInfo.isDark ? "vs-dark" : "vs";
    monaco.editor.setTheme(themeName);

    Logger.info("[MonacoCodeEditor] Applied theme:", themeName);

    // Set line number offset if needed
    if (lineNumber > 1) {
      editor.revealLineInCenter(1);
    }
  };

  const handleChange = (value: string | undefined) => {
    Logger.info(
      "[MonacoCodeEditor] Content changed, new length:",
      value?.length || 0
    );
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
          lineNumbers: "on",
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 4,
          renderLineHighlight: "all",
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          automaticLayout: true,
          wordWrap: "off",
          wrappingIndent: "none",
          tabSize: 4,
          insertSpaces: false,
        }}
      />
    </div>
  );
};

export default MonacoCodeEditor;
