import { renderSerializedDoc } from '@formepdf/core';
import { Document, Page, View, serialize, Strong, Em, Link } from '@formepdf/react';
import { marked, type Token, type Tokens } from 'marked';
import type { ReactNode } from 'react';
import { Text } from '@/components/pdf/text/text';
import { Heading } from '@/components/pdf/heading/heading';
import { Table, TableBody, TableHeader, TableRow, TableCell } from '@/components/pdf/table/table';

function inline(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index): ReactNode => {
    switch (token.type) {
      case 'strong': return <Strong key={index}>{inline(token.tokens ?? [])}</Strong>;
      case 'em': return <Em key={index}>{inline(token.tokens ?? [])}</Em>;
      case 'link': return /^https?:\/\//i.test(token.href) ? <Link key={index} href={token.href}>{inline(token.tokens ?? [])}</Link> : inline(token.tokens ?? []);
      case 'br': return '\n';
      case 'text': return token.tokens?.length ? inline(token.tokens) : token.text;
      default: return 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
    }
  });
}

function blocks(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index): ReactNode => {
    switch (token.type) {
      case 'space': case 'def': return null;
      case 'heading': return <Heading key={index} level={token.depth <= 1 ? 1 : token.depth === 2 ? 2 : 3} style={{ fontSize: token.depth <= 1 ? 20 : 15 }}>{inline(token.tokens ?? [])}</Heading>;
      case 'paragraph': case 'text': return <Text key={index}>{token.tokens?.length ? inline(token.tokens) : token.text}</Text>;
      case 'blockquote': return <View key={index} style={{ borderLeftWidth: 1, paddingLeft: 12, marginBottom: 10 }}>{blocks(token.tokens ?? [])}</View>;
      case 'list': return <View key={index} style={{ marginLeft: 12 }}>{token.items.map((item: Tokens.ListItem, row: number) => <View key={row} style={{ flexDirection: 'row' }}>
        <Text style={{ width: 24 }}>{token.ordered ? `${(typeof token.start === 'number' ? token.start : 1) + row}.` : '•'}</Text><View style={{ flex: 1 }}>{blocks(item.tokens)}</View>
      </View>)}</View>;
      case 'table': return <Table key={index} variant="line"><TableHeader><TableRow>{token.header.map((cell: Tokens.TableCell, col: number) => <TableCell key={col} header>{inline(cell.tokens)}</TableCell>)}</TableRow></TableHeader>
        <TableBody>{token.rows.map((row: Tokens.TableCell[], n: number) => <TableRow key={n}>{row.map((cell: Tokens.TableCell, col: number) => <TableCell key={col}>{inline(cell.tokens)}</TableCell>)}</TableRow>)}</TableBody></Table>;
      case 'hr': return <View key={index} style={{ borderBottomWidth: 1, marginBottom: 12 }} />;
      default: return <Text key={index}>{'text' in token && typeof token.text === 'string' ? token.text : token.raw}</Text>;
    }
  });
}

export async function renderPdfcnDocument(input: { title: string; content: string }): Promise<Uint8Array> {
  // Only fixed project components consume parsed Markdown. No scripts, remote assets or model JSX.
  return renderSerializedDoc({ ...serialize(<Document title={input.title} author="Lume"><Page size="A4" margin={54}>{blocks(marked.lexer(input.content))}</Page></Document>) });
}
