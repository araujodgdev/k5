import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require.resolve('server-only');
require.cache[path] = { id: path, filename: path, loaded: true, exports: {}, path } as NodeJS.Module;
