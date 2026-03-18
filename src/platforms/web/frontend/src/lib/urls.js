/**
 * Environment-aware URL helpers.
 *
 * In dev, the marketing site runs on localhost (same port as Vite).
 * In prod, it's noema.art (no port, https).
 */

const { hostname, port, protocol } = window.location;

const isDev = hostname === 'localhost' || hostname.endsWith('.localhost');
const isStaging = hostname.startsWith('staging.');
const isAppSubdomain = hostname.startsWith('app.');

/**
 * Returns the URL for the marketing/landing site.
 * From the app subdomain: strips "app." prefix and keeps dev port.
 * On staging: stays on staging (no separate landing site).
 */
export function getLandingUrl() {
  if (isStaging) return `${protocol}//${hostname}`;
  if (!isDev) return 'https://noema.art';
  const landingHost = isAppSubdomain ? hostname.replace(/^app\./, '') : hostname;
  return `${protocol}//${landingHost}${port ? `:${port}` : ''}`;
}

/**
 * Returns the URL for the sandbox app subdomain.
 * From the marketing site: prepends "app." and keeps dev port.
 * On staging: stays on staging (app is served directly).
 */
export function getAppUrl() {
  if (isStaging) return `${protocol}//${hostname}`;
  if (!isDev) return 'https://app.noema.art';
  const appHost = isAppSubdomain ? hostname : `app.${hostname}`;
  return `${protocol}//${appHost}${port ? `:${port}` : ''}`;
}
