import * as Sentry from '@sentry/nextjs';
import { serverOptions } from './lib/observability/options';

Sentry.init(serverOptions('web-edge', process.env));
