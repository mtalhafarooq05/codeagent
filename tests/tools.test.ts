import { describe, expect, it } from 'vitest';
import { createProjectToolRegistry } from '../src/tools/index.js';

describe('createProjectToolRegistry', () => {
  it('registers the project-scoped read and directory-listing tools', () => {
    const registry = createProjectToolRegistry(process.cwd());

    expect(registry.descriptors().map((tool) => tool.name)).toEqual([
      'read_file',
      'list_directory',
    ]);
  });
});
