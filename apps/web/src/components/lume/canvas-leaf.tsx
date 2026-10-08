import 'server-only';

import type { ReactNode } from 'react';
import { requireWorkspace } from '@/lib/session';
import { workspaceContext } from '@/lib/application/context';
import { authorizedCanvasResource } from '@/lib/canvas-resources';
import { canonicalCanvasHref } from '@/lib/lume-workspace';
import { PublishCanvasLeaf } from './canvas-host';

type RouteProps = {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export function officePage<P>(path: string, load: (props: P) => ReactNode | Promise<ReactNode>, chrome?: (props: { children: ReactNode }) => Promise<ReactNode>) {
  return async function OfficePage(props: P & RouteProps) {
    const [params, search]: [Record<string, string | string[]>, Record<string, string | string[] | undefined>] = await Promise.all([
      props.params ?? Promise.resolve({}), props.searchParams ?? Promise.resolve({}),
    ]);
    const pathname = path.replace(/\[([^\]]+)\]/g, (_, key: string) => encodeURIComponent(String(params[key])));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (Array.isArray(value)) value.forEach(item => query.append(key, item));
      else if (value !== undefined) query.set(key, value);
    }
    const href = canonicalCanvasHref(pathname + (query.size ? `?${query}` : ''));
    if (!href) throw new Error('Invalid office leaf.');
    const { user, office } = await requireWorkspace();
    const resource = await authorizedCanvasResource(workspaceContext({ user, office }), href);
    const loaded = await load(props);
    const content = chrome ? await chrome({ children: loaded }) : loaded;
    return <PublishCanvasLeaf href={href} nonce={query.get('__canvas')} resource={resource}>{content}</PublishCanvasLeaf>;
  };
}
