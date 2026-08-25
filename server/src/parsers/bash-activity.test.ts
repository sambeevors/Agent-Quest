import { describe, expect, it } from 'bun:test';
import { classifyBashCommand } from './bash-activity';

describe('classifyBashCommand', () => {
  it('sends file reads to the Library', () => {
    expect(classifyBashCommand('cat server/src/types.ts')).toBe('reading');
    expect(classifyBashCommand('head -50 README.md')).toBe('reading');
    expect(classifyBashCommand("sed -n '1,50p' src/index.ts")).toBe('reading');
  });

  it('sends searches and globs to the Library', () => {
    expect(classifyBashCommand("grep -rn 'foo' src")).toBe('reading');
    expect(classifyBashCommand('rg --files-with-matches TODO')).toBe('reading');
    expect(classifyBashCommand("find . -name '*.ts'")).toBe('reading');
    expect(classifyBashCommand('ls -la client/src')).toBe('reading');
  });

  it('handles the full pipeline, not just the first command', () => {
    expect(classifyBashCommand("grep -rn 'x' src | head -30")).toBe('reading');
    expect(classifyBashCommand('cat a.ts; echo ---; cat b.ts')).toBe('reading');
    expect(classifyBashCommand("cd server && grep -rn 'x' src")).toBe('reading');
    expect(classifyBashCommand('find . -name "*.ts" | wc -l')).toBe('reading');
  });

  it('does not split on separators inside quotes', () => {
    expect(classifyBashCommand("grep -E 'foo|bar' src/index.ts")).toBe('reading');
    expect(classifyBashCommand('grep -rn "a && b" src')).toBe('reading');
  });

  it('tolerates stderr redirects and fd duplication', () => {
    expect(classifyBashCommand('grep -rn foo src 2>/dev/null')).toBe('reading');
    expect(classifyBashCommand('cat missing.txt 2>&1 | head -5')).toBe('reading');
  });

  it('stays at the Arena when any part of the command is not a read', () => {
    expect(classifyBashCommand('bun test')).toBe('bash');
    expect(classifyBashCommand('npm run build')).toBe('bash');
    expect(classifyBashCommand("find . -name '*.tmp' -exec rm {} +")).toBe('bash');
    expect(classifyBashCommand('cat urls.txt | xargs curl -O')).toBe('bash');
    expect(classifyBashCommand('')).toBe('bash');
  });

  it('stays at the Arena when output is written to a file', () => {
    expect(classifyBashCommand('grep -rn foo src > matches.txt')).toBe('bash');
    expect(classifyBashCommand('cat a.ts >> combined.ts')).toBe('bash');
    expect(classifyBashCommand("sed -i 's/a/b/' src/index.ts")).toBe('bash');
  });

  it('leaves neutral chores alone rather than calling them reads', () => {
    expect(classifyBashCommand('cd /tmp')).toBe('bash');
    expect(classifyBashCommand('echo hello')).toBe('bash');
  });

  it('routes write-oriented git to the Chapel, read-only git to the Arena', () => {
    expect(classifyBashCommand('git commit -m "feat: x"')).toBe('git');
    expect(classifyBashCommand('cd repo && git push')).toBe('git');
    expect(classifyBashCommand('git status')).toBe('bash');
    expect(classifyBashCommand('git log --oneline | head -20')).toBe('bash');
  });

  it('reads through absolute paths and env prefixes', () => {
    expect(classifyBashCommand('/usr/bin/grep -rn foo src')).toBe('reading');
    expect(classifyBashCommand('LC_ALL=C grep -rn foo src')).toBe('reading');
  });
});
