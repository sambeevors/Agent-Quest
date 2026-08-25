import type { AgentActivity } from '../types';

/**
 * Write-oriented git subcommands, matched anywhere in the command (covers
 * `git add … && git commit …`, `cd repo && git push`, heredoc'd commits, etc.).
 * Read-only subcommands like `git status`/`log`/`diff` deliberately fall through
 * to the shell classifier below, which leaves them at the Arena.
 */
export const GIT_COMMAND_PATTERN = /\bgit\s+(commit|push|merge|rebase|cherry-pick)\b/;

/**
 * Commands whose whole job is to read or search the filesystem. An agent running
 * these is doing the same work as the Read/Grep/Glob tools — it just went through
 * a shell to do it — so it belongs in the Library, not the Arena.
 */
const READ_COMMANDS = new Set([
  // read a file
  'cat', 'bat', 'head', 'tail', 'less', 'more', 'nl', 'xxd', 'strings',
  // search inside files
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',
  // find files
  'find', 'fd', 'locate', 'ls', 'tree',
  // inspect / slice what was read
  'awk', 'cut', 'sort', 'uniq', 'wc', 'column', 'jq', 'yq', 'diff', 'cmp',
  'stat', 'file', 'realpath', 'readlink', 'basename', 'dirname',
]);

/**
 * Commands that neither read nor mutate anything interesting. They're allowed to
 * appear alongside a read without demoting it (`cd repo && grep …`, `cat a; echo
 * ---; cat b`), but on their own they don't make a command a read.
 */
const NEUTRAL_COMMANDS = new Set(['cd', 'echo', 'printf', 'pwd', 'true', ':']);

/** Prefixes that wrap another command; skip them and classify what follows. */
const COMMAND_PREFIXES = new Set(['time', 'command', 'builtin', 'nohup', 'exec', '!']);

/** Redirect targets that discard or re-point a stream rather than writing a file. */
const NON_FILE_TARGETS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']);

/**
 * Split a command line into pipeline/list segments on unquoted `|`, `||`, `&&`,
 * `;`, `&` and newlines. Quote-aware because separators inside a pattern are
 * routine — `grep -E 'foo|bar' src` is one segment, not two.
 */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (quote !== null) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += command[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '\\') {
      current += ch + (command[i + 1] ?? '');
      i++;
      continue;
    }

    // `2>&1` duplicates a file descriptor — that `&` isn't a separator.
    if (ch === '&' && current.trimEnd().endsWith('>')) {
      current += ch;
      continue;
    }

    if (ch === '|' || ch === '&' || ch === ';' || ch === '\n') {
      segments.push(current);
      current = '';
      if ((ch === '|' || ch === '&') && command[i + 1] === ch) i++;
      continue;
    }

    current += ch;
  }

  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Split a segment into words, keeping quoted runs together. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;

    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === '\\') {
      current += segment[i + 1] ?? '';
      i++;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The executable a segment runs, plus its arguments. `null` when unrecognisable. */
function commandOf(segment: string): { name: string; args: string[] } | null {
  const tokens = tokenize(segment);
  let i = 0;

  // Skip grouping punctuation, env assignments and wrapper commands.
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token === '(' || token === '{' || token === '!') { i++; continue; }
    if (ENV_ASSIGNMENT.test(token)) { i++; continue; }
    if (COMMAND_PREFIXES.has(token)) { i++; continue; }
    break;
  }

  const head = tokens[i];
  if (head === undefined) return null;

  // `/usr/bin/grep` and `(grep` both name grep.
  const name = head.replace(/^\(+/, '').split('/').pop() ?? '';
  if (name.length === 0) return null;
  return { name, args: tokens.slice(i + 1) };
}

/**
 * True when the segment redirects stdout/stderr into a real file. `2>/dev/null`
 * and `2>&1` are everyday companions to a grep and don't count; `> out.txt` does.
 */
function writesToFile(segment: string): boolean {
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;

    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '\\') { i++; continue; }
    if (ch !== '>') continue;

    // Consume `>>` (append) and any following whitespace, then read the target.
    let j = i + 1;
    if (segment[j] === '>') j++;
    while (segment[j] === ' ' || segment[j] === '\t') j++;
    if (segment[j] === '&') {
      i = j;
      continue; // fd duplication: 2>&1
    }
    const target = tokenize(segment.slice(j))[0];
    if (target === undefined || !NON_FILE_TARGETS.has(target)) return true;
    i = j;
  }

  return false;
}

/**
 * `find`/`fd` are only searches until they're told to run something on what they
 * found — `find . -name '*.tmp' -exec rm {} +` deletes files.
 */
const FIND_ACTION_FLAGS = new Set([
  '-exec', '-execdir', '-ok', '-okdir', '-delete', '-x', '--exec', '-X', '--exec-batch',
]);

function isFindWithAction(name: string, args: string[]): boolean {
  if (name !== 'find' && name !== 'fd') return false;
  return args.some((a) => FIND_ACTION_FLAGS.has(a));
}

/** `sed`/`perl` edit files in place when given `-i`; otherwise they only read. */
function isInPlaceEdit(name: string, args: string[]): boolean {
  if (name !== 'sed' && name !== 'perl') return false;
  return args.some((a) => a === '-i' || (a.startsWith('-i') && !a.startsWith('-i=')) || a === '--in-place');
}

/**
 * Classify a shell command into the building its hero should walk to.
 *
 * Agents do a large share of their reading and searching through Bash rather
 * than the Read/Grep/Glob tools (`cat`, `sed -n`, `grep -rn`, `find`), and
 * sending all of that to the Arena left the Library empty. A command counts as
 * reading only when *every* segment is a read or a neutral chore and nothing
 * redirects into a file — so `grep x src | head` reads, while `grep x src > out`
 * or `cat f | xargs rm` stay generic shell work.
 */
export function classifyBashCommand(command: string): AgentActivity {
  if (GIT_COMMAND_PATTERN.test(command)) return 'git';

  const segments = splitSegments(command);
  if (segments.length === 0) return 'bash';

  let sawRead = false;
  for (const segment of segments) {
    if (writesToFile(segment)) return 'bash';

    const parsed = commandOf(segment);
    if (parsed === null) return 'bash';

    if (isFindWithAction(parsed.name, parsed.args)) return 'bash';

    if (READ_COMMANDS.has(parsed.name)) {
      sawRead = true;
      continue;
    }
    if (parsed.name === 'sed' && !isInPlaceEdit(parsed.name, parsed.args)) {
      sawRead = true;
      continue;
    }
    if (NEUTRAL_COMMANDS.has(parsed.name)) continue;

    return 'bash';
  }

  return sawRead ? 'reading' : 'bash';
}
