import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/** Package version, also sent to the API as `X-Teamso-Client: teamso-mcp/<version>`. */
export const VERSION: string = version;
