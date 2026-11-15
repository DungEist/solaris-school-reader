export function isDeveloperRoute(pathname: string): boolean {
  return /\/debug\/?$/.test(pathname);
}

/** Preserve script query links and other URL parameters across view switches. */
export function interfaceHref(developer: boolean, search: string, scriptId: string | null): string {
  const params = new URLSearchParams(search);
  if (scriptId) params.set('script', scriptId);
  const query = params.toString();
  return `${developer ? '/debug' : '/'}${query ? `?${query}` : ''}`;
}
