import type { ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Agent replies are GitHub-flavoured: tables, ~~strikethrough~~, task lists
// and bare URLs all show up constantly, and plain CommonMark leaves them as
// pipes and tildes. Links open in a new tab — clicking one in place would
// navigate the dashboard (or the Electron window, which routes new windows
// to the real browser) away from the village.
const BASE_COMPONENTS: Components = {
  a: ({ node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

const REMARK_PLUGINS = [remarkGfm];

interface AgentMarkdownProps {
  children: string;
  /** Per-surface overrides, merged over the shared link renderer. */
  components?: Components;
}

export function AgentMarkdown({ children, components }: AgentMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={components === undefined ? BASE_COMPONENTS : { ...BASE_COMPONENTS, ...components }}
    >
      {children}
    </ReactMarkdown>
  );
}
