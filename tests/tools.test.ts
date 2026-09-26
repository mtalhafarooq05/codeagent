import { describe, expect, it } from 'vitest';
import { createProjectToolRegistry } from '../src/tools/index.js';

describe('createProjectToolRegistry', () => {
  it('registers only the project-scoped read_file tool', () => {
    const registry = createProjectToolRegistry(process.cwd());

    expect(registry.descriptors().map((tool) => tool.name)).toEqual(['read_file']);
  });
});
