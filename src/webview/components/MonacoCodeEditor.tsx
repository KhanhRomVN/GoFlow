import React, { useState, useEffect } from "react";
import Editor, { loader } from "@monaco-editor/react";

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

  console.log("[MonacoCodeEditor] Props:", {
    language,
    height,
    readOnly,
    lineNumber,
    valueLength: value?.length || 0,
  });

  useEffect(() => {
    console.log("[MonacoCodeEditor] Initializing Monaco loader");
    // Configure Monaco to load from local media/vs folder
    loader.config({
      paths: {
        vs: "./vs",
      },
      "vs/nls": {
        availableLanguages: {},
      },
    });

    loader.init().catch((err) => {
      console.error("[MonacoCodeEditor] Failed to initialize Monaco:", err);
      console.error("Failed to initialize Monaco:", err);
    });
  }, []);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    console.log("[MonacoCodeEditor] Editor mounted");
    console.log("[MonacoCodeEditor] ReadOnly mode:", readOnly);
    setIsEditorReady(true);

    // Get VSCode CSS variables
    const bodyStyles = getComputedStyle(document.body);
    const getColor = (varName: string, fallback: string) => {
      const color = bodyStyles.getPropertyValue(varName).trim();
      return color || fallback;
    };

    // Detect if dark theme
    const bgColor = getColor("--vscode-editor-background", "#1e1e1e");
    const isDark =
      bgColor.startsWith("#") && parseInt(bgColor.slice(1, 3), 16) < 128;

    // Define custom theme based on VSCode colors
    monaco.editor.defineTheme("vscode-custom", {
      base: isDark ? "vs-dark" : "vs",
      inherit: true,
      rules: [
        {
          token: "keyword",
          foreground: getColor(
            "--vscode-symbolIcon-keywordForeground",
            "569cd6"
          ).replace("#", ""),
          fontStyle: "bold",
        },
        {
          token: "type",
          foreground: getColor(
            "--vscode-symbolIcon-classForeground",
            "4ec9b0"
          ).replace("#", ""),
        },
        {
          token: "string",
          foreground: getColor(
            "--vscode-symbolIcon-stringForeground",
            "ce9178"
          ).replace("#", ""),
        },
        {
          token: "comment",
          foreground: getColor(
            "--vscode-symbolIcon-variableForeground",
            "6a9955"
          ).replace("#", ""),
          fontStyle: "italic",
        },
        {
          token: "number",
          foreground: getColor(
            "--vscode-symbolIcon-numberForeground",
            "b5cea8"
          ).replace("#", ""),
        },
        {
          token: "function",
          foreground: getColor(
            "--vscode-symbolIcon-functionForeground",
            "dcdcaa"
          ).replace("#", ""),
        },
        {
          token: "variable",
          foreground: getColor("--vscode-editor-foreground", "d4d4d4").replace(
            "#",
            ""
          ),
        },
        {
          token: "identifier",
          foreground: getColor("--vscode-editor-foreground", "d4d4d4").replace(
            "#",
            ""
          ),
        },
      ],
      colors: {
        "editor.background": getColor("--vscode-editor-background", "#1e1e1e"),
        "editor.foreground": getColor("--vscode-editor-foreground", "#d4d4d4"),
        "editor.lineHighlightBackground": getColor(
          "--vscode-editor-lineHighlightBackground",
          "#2a2d2e"
        ),
        "editorLineNumber.foreground": getColor(
          "--vscode-editorLineNumber-foreground",
          "#858585"
        ),
        "editorLineNumber.activeForeground": getColor(
          "--vscode-editorLineNumber-activeForeground",
          "#c6c6c6"
        ),
        "editor.selectionBackground": getColor(
          "--vscode-editor-selectionBackground",
          "#264f78"
        ),
        "editor.inactiveSelectionBackground": getColor(
          "--vscode-editor-inactiveSelectionBackground",
          "#3a3d41"
        ),
        "editorCursor.foreground": getColor(
          "--vscode-editorCursor-foreground",
          "#aeafad"
        ),
      },
    });

    // Apply custom theme
    monaco.editor.setTheme("vscode-custom");

    // Set line number offset if needed
    if (lineNumber > 1) {
      editor.revealLineInCenter(1);
    }
  };

  const handleChange = (value: string | undefined) => {
    console.log(
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
