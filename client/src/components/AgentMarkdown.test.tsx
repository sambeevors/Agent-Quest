import { describe, it, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMarkdown } from './AgentMarkdown';

const render = (md: string) => renderToStaticMarkup(<AgentMarkdown>{md}</AgentMarkdown>);

describe('AgentMarkdown', () => {
  it('renders GFM tables', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>2</td>');
  });

  it('renders strikethrough and task lists', () => {
    expect(render('~~gone~~')).toContain('<del>gone</del>');
    expect(render('- [x] done')).toContain('type="checkbox"');
  });

  it('links open in a new tab, bare URLs included', () => {
    const html = render('see https://example.com');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('per-surface overrides keep the shared link renderer', () => {
    const html = renderToStaticMarkup(
      <AgentMarkdown components={{ p: ({ children }) => <>{children}</> }}>{'[x](https://a.b)'}</AgentMarkdown>,
    );
    expect(html).toBe('<a href="https://a.b" target="_blank" rel="noopener noreferrer">x</a>');
  });
});
