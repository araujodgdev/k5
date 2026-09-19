"use client";

import { Fragment, memo, useMemo, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";

/**
 * The model answers in Markdown. Rendering it as plain text is what puts `## Título` and `**negrito**`
 * on screen verbatim.
 *
 * Tokens are turned into React elements instead of HTML: a streamed answer is untrusted text, and
 * `dangerouslySetInnerHTML` would make every response an injection surface. Raw `html` tokens are
 * printed as text for the same reason.
 */

const inlineRenderers: Record<string, (token: Token, key: string) => ReactNode> = {
  text: (token, key) => {
    const value = token as Tokens.Text;
    return value.tokens?.length ? <Fragment key={key}>{renderInline(value.tokens)}</Fragment> : <Fragment key={key}>{value.text}</Fragment>;
  },
  escape: (token, key) => <Fragment key={key}>{(token as Tokens.Escape).text}</Fragment>,
  html: (token, key) => <Fragment key={key}>{(token as Tokens.HTML).raw}</Fragment>,
  strong: (token, key) => <strong key={key} className="font-medium text-foreground">{renderInline((token as Tokens.Strong).tokens)}</strong>,
  em: (token, key) => <em key={key}>{renderInline((token as Tokens.Em).tokens)}</em>,
  del: (token, key) => <del key={key}>{renderInline((token as Tokens.Del).tokens)}</del>,
  codespan: (token, key) => <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{(token as Tokens.Codespan).text}</code>,
  br: (_token, key) => <br key={key} />,
  link: (token, key) => {
    const value = token as Tokens.Link;
    // Only http(s) and mail links become anchors; `javascript:` and friends stay inert text.
    const safe = /^(https?:|mailto:|\/)/i.test(value.href);
    if (!safe) return <Fragment key={key}>{renderInline(value.tokens)}</Fragment>;
    return <a key={key} href={value.href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-muted-foreground">{renderInline(value.tokens)}</a>;
  },
  image: (token, key) => <Fragment key={key}>{(token as Tokens.Image).text || (token as Tokens.Image).title || ""}</Fragment>,
};

function renderInline(tokens: Token[] | undefined): ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    const renderer = inlineRenderers[token.type];
    if (renderer) return renderer(token, key);
    return <Fragment key={key}>{"text" in token ? String(token.text) : token.raw}</Fragment>;
  });
}

const headingClasses = ["text-lg font-medium", "text-base font-medium", "text-sm font-medium", "text-sm font-medium", "text-sm font-medium", "text-sm font-medium"];

function ListItems({ token }: { token: Tokens.List }) {
  return token.items.map((item, index) => (
    <li key={index} className="pl-1">
      {item.task && <input type="checkbox" checked={item.checked} readOnly className="mr-2 size-3.5 accent-foreground" aria-hidden="true" />}
      {renderBlocks(item.tokens, true)}
    </li>
  ));
}

function renderBlocks(tokens: Token[] | undefined, tight = false): ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case "space":
        return null;
      case "heading": {
        const value = token as Tokens.Heading;
        const level = Math.min(Math.max(value.depth, 1), 6);
        const Tag = `h${level}` as "h1";
        return <Tag key={key} className={`mt-5 mb-2 first:mt-0 ${headingClasses[level - 1]}`}>{renderInline(value.tokens)}</Tag>;
      }
      case "paragraph": {
        const value = token as Tokens.Paragraph;
        if (tight) return <Fragment key={key}>{renderInline(value.tokens)}</Fragment>;
        return <p key={key} className="my-3 first:mt-0 last:mb-0">{renderInline(value.tokens)}</p>;
      }
      case "text": {
        const value = token as Tokens.Text;
        return <Fragment key={key}>{value.tokens?.length ? renderInline(value.tokens) : value.text}</Fragment>;
      }
      case "list": {
        const value = token as Tokens.List;
        const className = "my-3 grid gap-1 pl-5 first:mt-0 last:mb-0";
        return value.ordered
          ? <ol key={key} start={Number(value.start) || 1} className={`${className} list-decimal`}><ListItems token={value} /></ol>
          : <ul key={key} className={`${className} list-disc`}><ListItems token={value} /></ul>;
      }
      case "code": {
        const value = token as Tokens.Code;
        return <pre key={key} className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-6 first:mt-0 last:mb-0"><code>{value.text}</code></pre>;
      }
      case "blockquote": {
        const value = token as Tokens.Blockquote;
        return <blockquote key={key} className="my-3 border-l-2 pl-3 text-muted-foreground first:mt-0 last:mb-0">{renderBlocks(value.tokens)}</blockquote>;
      }
      case "hr":
        return <hr key={key} className="my-5" />;
      case "table": {
        const value = token as Tokens.Table;
        return (
          <div key={key} className="my-3 overflow-x-auto first:mt-0 last:mb-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b">{value.header.map((cell, cellIndex) => <th key={cellIndex} className="py-1.5 pr-4 font-medium text-[13px] text-muted-foreground last:pr-0">{renderInline(cell.tokens)}</th>)}</tr>
              </thead>
              <tbody>
                {value.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b last:border-b-0">
                    {row.map((cell, cellIndex) => <td key={cellIndex} className="py-1.5 pr-4 align-top last:pr-0">{renderInline(cell.tokens)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "html":
        return <Fragment key={key}>{(token as Tokens.HTML).raw}</Fragment>;
      default:
        return <Fragment key={key}>{"text" in token ? String(token.text) : token.raw}</Fragment>;
    }
  });
}

/** Markdown answer body. Re-parsed per streamed chunk, which is cheap next to the model call. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tokens = useMemo(() => {
    try {
      return marked.lexer(text, { gfm: true, breaks: true });
    } catch {
      return null;
    }
  }, [text]);
  if (!tokens) return <p className="whitespace-pre-wrap">{text}</p>;
  return <>{renderBlocks(tokens)}</>;
});
