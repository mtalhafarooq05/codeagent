import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('uses local defaults', () => {
    const config = parseConfig([], {}, 'C:\\workspace');
    expect(config.model).toBe('qwen3:8b');
    expect(config.ollamaHost).toBe('http://127.0.0.1:11434');
  });

  it('accepts explicit project and model settings', () => {
    const config = parseConfig(
      ['--project', 'demo', '--model', 'devstral:24b'],
      {},
      process.cwd(),
    );
    expect(config.projectRoot).toContain('demo');
    expect(config.model).toBe('devstral:24b');
  });

  it('rejects a remote Ollama endpoint', () => {
    expect(() => parseConfig(['--host', 'https://example.com'], {})).toThrow(
      'Only a local HTTP Ollama host',
    );
  });
});
