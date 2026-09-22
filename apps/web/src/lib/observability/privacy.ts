import type { Breadcrumb, ErrorEvent, TransactionEvent, SpanJSON, Options } from '@sentry/core';

// Legal documents, credentials and AI conversations must not become telemetry.
export const dataCollection: NonNullable<Options['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

export function telemetryUrl(value: string): string {
  try {
    const relative = value.startsWith('/');
    const url = new URL(value, 'https://lume.invalid');
    // Resource identifiers add cardinality and can identify client records.
    const path = url.pathname.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]');
    return relative ? path : `${url.protocol}//${url.host}${path}`;
  } catch {
    return '[invalid-url]';
  }
}

export function beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console messages and DOM selectors can contain filenames, document text and form values.
  if (breadcrumb.category === 'console' || breadcrumb.category?.startsWith('ui.')) return null;
  const data = breadcrumb.data;
  return {
    timestamp: breadcrumb.timestamp,
    category: breadcrumb.category,
    type: breadcrumb.type,
    level: breadcrumb.level,
    data: data ? {
      ...(typeof data.url === 'string' ? { url: telemetryUrl(data.url) } : {}),
      ...(typeof data.from === 'string' ? { from: telemetryUrl(data.from) } : {}),
      ...(typeof data.to === 'string' ? { to: telemetryUrl(data.to) } : {}),
      ...(typeof data.method === 'string' ? { method: data.method } : {}),
      ...(typeof data.status_code === 'number' ? { status_code: data.status_code } : {}),
    } : undefined,
  };
}

export function beforeSendSpan(span: SpanJSON): SpanJSON {
  const data = Object.fromEntries(Object.entries(span.data ?? {}).filter(([key, value]) =>
    ((typeof value === 'number' || typeof value === 'boolean') && /^(sentry\.|gen_ai\.usage\.|http\.response\.|browser\.|network\.)/.test(key)) ||
    /^(sentry\.(origin|op|source)|http\.(request.method|response.status_code)|db\.(system|operation.name)|gen_ai\.(operation.name|request.model|response.model|system))$/.test(key),
  ));
  // Query text and resource paths can contain literals even with body capture disabled.
  const description = span.op?.startsWith('db') ? span.op
    : span.description?.replace(/https?:\/\/[^\s]+|(?<=^|\s)\/[^\s]+/g, telemetryUrl);
  return { ...span, description, data };
}

export function scrubEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  // Relay otherwise infers a user/IP from the ingestion request even when user is absent.
  event.sdk = { ...event.sdk, settings: { ...event.sdk?.settings, infer_ip: 'never' } };
  delete event.user;
  delete event.extra;
  delete event.server_name;
  if (event.transaction) event.transaction = event.transaction.replace(/https?:\/\/[^\s]+|(?<=^|\s)\/[^\s]+/g, telemetryUrl);
  if (event.request) event.request = {
    method: event.request.method,
    url: event.request.url ? telemetryUrl(event.request.url) : undefined,
  };
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.flatMap(breadcrumb => {
    const safe = beforeBreadcrumb(breadcrumb);
    return safe ? [safe] : [];
  });
  if (event.contexts) {
    // Keep technical runtime/trace context; discard arbitrary application payloads.
    event.contexts = Object.fromEntries(Object.entries(event.contexts).filter(([key]) =>
      ['trace', 'runtime', 'browser', 'os', 'device', 'react'].includes(key),
    ));
    if (event.contexts.trace) delete event.contexts.trace.data;
  }
  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.post_context;
      delete frame.context_line;
    }
  }
  if ('spans' in event && event.spans) event.spans = event.spans.map(beforeSendSpan);
  return event;
}

export const privacyOptions = {
  dataCollection,
  enableLogs: false,
  enableMetrics: false,
  beforeBreadcrumb,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendSpan,
};
