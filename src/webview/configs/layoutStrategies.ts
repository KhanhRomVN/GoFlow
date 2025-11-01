export interface LayoutStrategy {
  algorithm: "dagre" | "elk-layered" | "elk-force" | "d3-force" | "elk-box";
  direction: "TB" | "LR" | "BT" | "RL" | "DOWN" | "RIGHT" | "UP" | "LEFT";
  edgeType: "default" | "smoothstep" | "straight" | "step";
  ranksep?: number;
  nodesep?: number;
  description: string;
}

export interface FrameworkConfig {
  languages: string[];
  filePatterns: RegExp[];
  strategy: LayoutStrategy;
  rationale: string;
}

export const FRAMEWORK_LAYOUT_STRATEGIES: Record<string, FrameworkConfig> = {
  // ==================== GO ====================
  "go-gin": {
    languages: ["go"],
    filePatterns: [/gin\./, /echo\./, /fiber\./],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 120,
      nodesep: 80,
      description:
        "Top-Down Hierarchical (HTTP Handler → Service → Repository)",
    },
    rationale:
      "Go APIs thường có clear separation: Handler → Business Logic → Data Layer",
  },

  "go-grpc": {
    languages: ["go"],
    filePatterns: [/grpc\./, /protobuf/, /\.pb\.go$/],
    strategy: {
      algorithm: "dagre",
      direction: "LR",
      edgeType: "smoothstep",
      ranksep: 150,
      nodesep: 100,
      description: "Left-Right (gRPC Service Chain)",
    },
    rationale: "gRPC service chains dễ đọc hơn khi flow từ trái sang phải",
  },

  "go-default": {
    languages: ["go"],
    filePatterns: [/\.go$/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 120,
      nodesep: 80,
      description: "Top-Down Standard",
    },
    rationale: "Default cho Go projects",
  },

  // ==================== JAVA / SPRING ====================
  "spring-boot": {
    languages: ["java"],
    filePatterns: [
      /@RestController/,
      /@Service/,
      /@Repository/,
      /springframework/,
    ],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default", // Bezier curves
      description: "ELK Layered (handles @Autowired circular deps)",
    },
    rationale:
      "Spring có nhiều circular dependencies qua dependency injection → ELK xử lý tốt hơn Dagre",
  },

  "spring-webflux": {
    languages: ["java"],
    filePatterns: [/Mono/, /Flux/, /reactor/],
    strategy: {
      algorithm: "elk-force",
      direction: "DOWN",
      edgeType: "default",
      description: "Force-Directed (reactive streams)",
    },
    rationale: "Reactive streams có non-linear flow → force-directed tốt hơn",
  },

  "java-default": {
    languages: ["java"],
    filePatterns: [/\.java$/],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered Standard",
    },
    rationale: "Default cho Java projects",
  },

  // ==================== PYTHON ====================
  "python-django": {
    languages: ["python"],
    filePatterns: [/django/, /models\.py/, /views\.py/, /serializers\.py/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 100,
      nodesep: 70,
      description: "Top-Down (View → Serializer → Model → DB)",
    },
    rationale: "Django MVC rõ ràng về layers",
  },

  "python-fastapi": {
    languages: ["python"],
    filePatterns: [/fastapi/, /@app\./, /APIRouter/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 110,
      nodesep: 75,
      description: "Top-Down (Router → Service → Repository)",
    },
    rationale: "FastAPI giống Go về architecture pattern",
  },

  "python-celery": {
    languages: ["python"],
    filePatterns: [/celery/, /@task/, /@shared_task/],
    strategy: {
      algorithm: "d3-force",
      direction: "TB",
      edgeType: "straight",
      description: "Force-Directed (async task chains)",
    },
    rationale: "Celery tasks có nhiều parallel execution paths",
  },

  "python-default": {
    languages: ["python"],
    filePatterns: [/\.py$/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 100,
      nodesep: 70,
      description: "Top-Down Standard",
    },
    rationale: "Default cho Python projects",
  },

  // ==================== NODE.JS / TYPESCRIPT ====================
  "express-js": {
    languages: ["javascript", "typescript"],
    filePatterns: [/express/, /router\./, /middleware/],
    strategy: {
      algorithm: "d3-force",
      direction: "TB",
      edgeType: "straight",
      description: "Force-Directed (middleware chains)",
    },
    rationale: "Express middleware chains có nhiều branching logic",
  },

  nestjs: {
    languages: ["typescript"],
    filePatterns: [/@nestjs/, /@Module/, /@Controller/, /@Injectable/],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered (DI container)",
    },
    rationale: "NestJS architecture giống Spring Boot → dùng ELK",
  },

  "nodejs-default": {
    languages: ["javascript", "typescript"],
    filePatterns: [/\.js$/, /\.ts$/],
    strategy: {
      algorithm: "d3-force",
      direction: "TB",
      edgeType: "straight",
      description: "Force-Directed Standard",
    },
    rationale: "Node.js async/callback patterns phù hợp force-directed",
  },

  // ==================== RUBY ====================
  "ruby-rails": {
    languages: ["ruby"],
    filePatterns: [/ActionController/, /ActiveRecord/, /ApplicationController/],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered (callbacks + concerns)",
    },
    rationale: "Rails callbacks và concerns tạo nhiều circular refs",
  },

  "ruby-sinatra": {
    languages: ["ruby"],
    filePatterns: [/sinatra/, /get ['"]/, /post ['"]/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 100,
      nodesep: 70,
      description: "Top-Down Simple",
    },
    rationale: "Sinatra đơn giản hơn Rails → dagre đủ dùng",
  },

  "ruby-default": {
    languages: ["ruby"],
    filePatterns: [/\.rb$/],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered Standard",
    },
    rationale: "Default cho Ruby projects",
  },

  // ==================== RUST ====================
  "rust-actix": {
    languages: ["rust"],
    filePatterns: [/actix_web/, /HttpServer/, /App::new/],
    strategy: {
      algorithm: "dagre",
      direction: "LR",
      edgeType: "smoothstep",
      ranksep: 140,
      nodesep: 90,
      description: "Left-Right (actor model)",
    },
    rationale: "Actix actor model dễ theo dõi từ trái sang phải",
  },

  "rust-tokio": {
    languages: ["rust"],
    filePatterns: [/tokio/, /async fn/, /\.await/],
    strategy: {
      algorithm: "elk-force",
      direction: "DOWN",
      edgeType: "default",
      description: "Force-Directed (async runtime)",
    },
    rationale: "Tokio async có nhiều concurrent tasks",
  },

  "rust-default": {
    languages: ["rust"],
    filePatterns: [/\.rs$/],
    strategy: {
      algorithm: "dagre",
      direction: "LR",
      edgeType: "smoothstep",
      ranksep: 130,
      nodesep: 85,
      description: "Left-Right Standard",
    },
    rationale: "Rust ownership model dễ đọc từ trái sang phải",
  },

  // ==================== C# / .NET ====================
  "dotnet-aspnet": {
    languages: ["csharp"],
    filePatterns: [
      /Controller/,
      /\[HttpGet\]/,
      /\[HttpPost\]/,
      /IActionResult/,
    ],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered (DI + middleware)",
    },
    rationale: "ASP.NET Core giống Spring về DI architecture",
  },

  "csharp-default": {
    languages: ["csharp"],
    filePatterns: [/\.cs$/],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered Standard",
    },
    rationale: "Default cho C# projects",
  },

  // ==================== PHP ====================
  "php-laravel": {
    languages: ["php"],
    filePatterns: [/Illuminate/, /Eloquent/, /Route::/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 110,
      nodesep: 75,
      description: "Top-Down (Route → Controller → Model)",
    },
    rationale: "Laravel MVC pattern rõ ràng",
  },

  "php-default": {
    languages: ["php"],
    filePatterns: [/\.php$/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 100,
      nodesep: 70,
      description: "Top-Down Standard",
    },
    rationale: "Default cho PHP projects",
  },

  // ==================== KOTLIN ====================
  "kotlin-ktor": {
    languages: ["kotlin"],
    filePatterns: [/ktor/, /routing/, /install\(/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 120,
      nodesep: 80,
      description: "Top-Down (Ktor routing)",
    },
    rationale: "Ktor DSL giống Go Gin về structure",
  },

  "kotlin-spring": {
    languages: ["kotlin"],
    filePatterns: [/@RestController/, /@Service/, /springframework/],
    strategy: {
      algorithm: "elk-layered",
      direction: "DOWN",
      edgeType: "default",
      description: "ELK Layered (Spring DI)",
    },
    rationale: "Kotlin + Spring → dùng strategy của Spring",
  },

  "kotlin-default": {
    languages: ["kotlin"],
    filePatterns: [/\.kt$/],
    strategy: {
      algorithm: "dagre",
      direction: "TB",
      edgeType: "smoothstep",
      ranksep: 120,
      nodesep: 80,
      description: "Top-Down Standard",
    },
    rationale: "Default cho Kotlin projects",
  },
};

// ==================== AUTO-DETECTION ====================
export function detectFramework(
  fileName: string,
  fileContent: string
): FrameworkConfig {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // Language mapping
  const languageMap: Record<string, string> = {
    go: "go",
    java: "java",
    py: "python",
    js: "javascript",
    ts: "typescript",
    rb: "ruby",
    rs: "rust",
    cs: "csharp",
    php: "php",
    kt: "kotlin",
  };

  const language = languageMap[ext];
  if (!language) {
    // Fallback to dagre
    return FRAMEWORK_LAYOUT_STRATEGIES["go-default"];
  }

  // Try to match specific framework first
  for (const [key, config] of Object.entries(FRAMEWORK_LAYOUT_STRATEGIES)) {
    if (config.languages.includes(language)) {
      // Check if file content matches framework patterns
      const matches = config.filePatterns.some((pattern) => {
        if (pattern instanceof RegExp) {
          return pattern.test(fileContent) || pattern.test(fileName);
        }
        return false;
      });

      if (matches) {
        return config;
      }
    }
  }

  // Fallback to language default
  const defaultKey = `${language}-default`;
  return (
    FRAMEWORK_LAYOUT_STRATEGIES[defaultKey] ||
    FRAMEWORK_LAYOUT_STRATEGIES["go-default"]
  );
}
