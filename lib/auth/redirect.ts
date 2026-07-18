const LOCAL_BASE_URL = "https://maso.local";
const ALLOWED_PATHS = ["/", "/records", "/analytics"];

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}

export function safeNextPath(
  value: string | string[] | null | undefined,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "/";
  }

  try {
    const parsed = new URL(candidate, LOCAL_BASE_URL);

    if (parsed.origin !== LOCAL_BASE_URL || !isAllowedPath(parsed.pathname)) {
      return "/";
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}
