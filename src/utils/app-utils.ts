import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { ConnectionStep } from "../components/index.ts";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

export function scanDirectoryForImages(dirPath: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files.sort();
  } catch (error) {
    console.error(`Error scanning directory: ${error}`);
    return [];
  }
}

export function updateStepStatus(
  steps: ConnectionStep[],
  stepId: string,
  status: "pending" | "active" | "complete" | "error",
  nextStepId?: string,
): ConnectionStep[] {
  return steps.map((step) => {
    if (step.id === stepId) return { ...step, status };
    if (nextStepId && step.id === nextStepId)
      return { ...step, status: "active" };
    return step;
  });
}
