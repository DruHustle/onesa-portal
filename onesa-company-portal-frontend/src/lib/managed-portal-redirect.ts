/** Only the browser-facing OIDC start/callback exchanges may forward redirects. */
export function managedPortalRedirect(path: string[], target: string | null, origin: string, issuer?: string) {
  if (!target || !issuer || path.length !== 3 || path[0] !== "auth" || path[1] !== "managed") return null;
  try {
    const url = new URL(target,origin);
    if (url.username || url.password) return null;
    if ((path[2] === "start" || path[2] === "step-up") && url.protocol === "https:" && url.origin === new URL(issuer).origin &&
      url.pathname === "/authorize" && !url.hash) return url.href;
    if (url.origin !== origin || !target.startsWith("/") || target.startsWith("//")) return null;
    if ((path[2] === "start" || path[2] === "callback") && url.pathname === "/api/v1/auth/managed/retry") return url.href;
    if (path[2] === "callback" && target === "/admin/step-up-complete") return url.href;
    if (path[2] === "callback" && url.pathname === "/admin") return url.href;
  } catch { /* Reject malformed issuer or upstream destination. */ }
  return null;
}

/** Accept only the configured Auth0 endpoint and this Portal's public return page. */
export function managedPortalLogoutRedirect(target: string | null, origin: string, issuer?: string) {
  if (!target || !issuer) return null;
  try {
    const configured = new URL(issuer);
    const logout = new URL(target);
    if (issuer !== configured.origin + "/" || logout.protocol !== "https:" ||
        logout.origin !== configured.origin || logout.pathname !== "/oidc/logout" ||
        logout.username || logout.password || logout.hash) return null;
    const params = logout.searchParams;
    if (params.size !== 2 || !params.get("client_id")?.trim() || params.get("post_logout_redirect_uri") !== origin + "/en")
      return null;
    return logout.href;
  } catch {
    return null;
  }
}
