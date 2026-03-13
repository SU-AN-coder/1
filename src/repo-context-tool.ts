import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SnippetResult {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export class RepoContextTool {
  readSnippet(filePath: string, line: number, radius = 8): SnippetResult {
    const absolutePath = resolve(filePath);
    const content = readFileSync(absolutePath, "utf8").split(/\r?\n/);
    const startLine = Math.max(1, line - radius);
    const endLine = Math.min(content.length, line + radius);
    const snippet = content
      .slice(startLine - 1, endLine)
      .map((entry, index) => `${startLine + index}: ${entry}`)
      .join("\n");

    return {
      filePath: absolutePath,
      startLine,
      endLine,
      snippet,
    };
  }

  findNearestSymbol(filePath: string, line: number): string | undefined {
    const absolutePath = resolve(filePath);
    const content = readFileSync(absolutePath, "utf8").split(/\r?\n/);
    const symbolPattern = /^\s*(export\s+)?(async\s+)?(function|class|interface|type|const)\s+([A-Za-z0-9_]+)/;

    for (let cursor = Math.min(line - 1, content.length - 1); cursor >= 0; cursor -= 1) {
      const match = content[cursor]?.match(symbolPattern);
      if (match?.[4]) {
        return match[4];
      }
    }

    return undefined;
  }
}
