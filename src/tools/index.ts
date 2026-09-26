import { createReadFileTool } from './read-file.js';
import { ToolRegistry } from './registry.js';

export function createProjectToolRegistry(projectRoot: string): ToolRegistry {
  return new ToolRegistry([createReadFileTool(projectRoot)]);
}
