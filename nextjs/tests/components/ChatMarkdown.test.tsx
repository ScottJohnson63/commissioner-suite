// tests/components/ChatMarkdown.test.tsx
//
// The assistant writes Markdown. The page used to print it.
//
// The issue that prompted this quoted an answer verbatim — "**Recommendation:**
// There are no QBs…", followed by a hyphenated list — and that is exactly what
// a reader on a phone saw, asterisks and all. What is pinned here is that the
// syntax becomes formatting, that a half-streamed line is still readable, and
// that nothing in a model's output can become markup of its own.

import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { ChatMarkdown } from '@/components/ai/ChatMarkdown';

describe('ChatMarkdown', () => {
  // WHY: The bold run is the verdict. Printed with its asterisks it is the
  //      first thing a reader sees and the least readable thing on the screen.
  it('renders bold and italic runs as elements, not as asterisks', () => {
    const { container } = render(
      <ChatMarkdown text="**Start him.** He is *clearly* the better play." />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Start him.');
    expect(container.querySelector('em')?.textContent).toBe('clearly');
    expect(container.textContent).not.toContain('**');
  });

  // WHY: Every support section the model writes is a list, and a list is where
  //      raw Markdown is worst: one long line of hyphens.
  it('renders a bulleted list as list items', () => {
    const { container } = render(
      <ChatMarkdown text={'Two options:\n\n- Bench the RB\n- Start the WR'} />,
    );
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Bench the RB');
    expect(items[1].textContent).toContain('Start the WR');
  });

  // WHY: The model numbers its rankings. The numbers are content, so they have
  //      to survive being turned into a list.
  it('numbers an ordered list from its own position', () => {
    const { container } = render(
      <ChatMarkdown text={'1. First pick\n2. Second pick\n3. Third pick'} />,
    );
    const items = container.querySelectorAll('ol li');
    expect(items).toHaveLength(3);
    expect(items[2].textContent).toContain('3.');
    expect(items[2].textContent).toContain('Third pick');
  });

  // WHY: A blank line is a paragraph break and a single newline is not. Losing
  //      the distinction turns a two-paragraph answer into one block of text.
  it('separates paragraphs on a blank line and keeps soft breaks inside one', () => {
    const { container } = render(
      <ChatMarkdown text={'Line one\nLine two\n\nSecond paragraph'} />,
    );
    const paras = container.querySelectorAll('p');
    expect(paras).toHaveLength(2);
    expect(paras[0].querySelectorAll('br')).toHaveLength(1);
    expect(paras[1].textContent).toBe('Second paragraph');
  });

  // WHY: This runs on every streamed chunk. A parser that needed a closing
  //      delimiter would flicker the whole answer as each one arrived.
  it('renders a partially streamed line without waiting for the closing syntax', () => {
    render(<ChatMarkdown text="**Start hi" />);
    expect(screen.getByText(/Start hi/)).toBeInTheDocument();
  });

  // WHY: The answer text comes from a model, which is to say from the internet.
  //      Every node here is built from matched text, so markup stays text.
  it('never turns model output into markup', () => {
    const { container } = render(
      <ChatMarkdown text={'<script>alert(1)</script> and <b>bold</b>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  // WHY: An asterisk in prose is not emphasis. Eating it would silently change
  //      what the model said.
  it('leaves an unpaired asterisk alone', () => {
    const { container } = render(<ChatMarkdown text="Projected 12.4 * see note" />);
    expect(container.textContent).toBe('Projected 12.4 * see note');
  });

  // WHY: The model is asked not to use headings, and sometimes uses them. A
  //      literal "### " is worse than a bold line.
  it('renders a heading as a bold line rather than as hashes', () => {
    const { container } = render(<ChatMarkdown text="### Recommendation" />);
    expect(container.textContent).toBe('Recommendation');
  });
});
