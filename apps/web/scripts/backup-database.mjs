import { spawn } from 'node:child_process';

// libpq does not expand a connection URI supplied only through PGDATABASE. Pass its fields as
// environment variables instead; a --dbname URI would expose the password in process arguments.
const parameters = {
  host: 'PGHOST', hostaddr: 'PGHOSTADDR', port: 'PGPORT', user: 'PGUSER', password: 'PGPASSWORD', dbname: 'PGDATABASE',
  application_name: 'PGAPPNAME', connect_timeout: 'PGCONNECT_TIMEOUT', options: 'PGOPTIONS',
  sslmode: 'PGSSLMODE', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslpassword: 'PGSSLPASSWORD',
  sslrootcert: 'PGSSLROOTCERT', sslcrl: 'PGSSLCRL', sslcrldir: 'PGSSLCRLDIR',
  ssl_min_protocol_version: 'PGSSLMINPROTOCOLVERSION', ssl_max_protocol_version: 'PGSSLMAXPROTOCOLVERSION',
  channel_binding: 'PGCHANNELBINDING', gssencmode: 'PGGSSENCMODE', target_session_attrs: 'PGTARGETSESSIONATTRS',
  service: 'PGSERVICE', passfile: 'PGPASSFILE',
};

try {
  const url = new URL(process.env.DATABASE_URL_UNPOOLED);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
  const env = { ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  for (const [name, value] of url.searchParams) {
    if (!Object.hasOwn(parameters, name)) throw new Error();
    env[parameters[name]] = value;
  }
  // Remote backups must verify both the server certificate and its hostname.
  if (!['localhost', '127.0.0.1', '::1'].includes(env.PGHOST)) {
    env.PGSSLMODE ??= 'verify-full';
    if (env.PGSSLMODE !== 'verify-full') throw new Error();
  }
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--no-password'], { env, stdio: 'inherit' });
  child.on('error', () => { console.error('Could not start database backup.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('Invalid or unsupported database backup connection configuration.');
  process.exitCode = 1;
}
