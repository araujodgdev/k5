import { withSentry } from '@sentry/cloudflare';
import handler from 'vinext/server/fetch-handler';
import { serverOptions } from '../lib/observability/options';

export * from 'vinext/server/fetch-handler';
export default withSentry<CloudflareEnv>(env => serverOptions('web', env), handler);
