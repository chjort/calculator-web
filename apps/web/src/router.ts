import { useCallback, useEffect, useState } from "react";

export type Path = "/" | "/login" | "/signup" | "/settings";
const KNOWN: readonly Path[] = ["/", "/login", "/signup", "/settings"];
export const toPath = (p: string): Path => (KNOWN as readonly string[]).includes(p) ? (p as Path) : "/";

/** Tiny history router: four same-origin app paths, nothing else is ever navigated to. */
export function useRouter() {
  const [path, setPath] = useState<Path>(() => toPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(toPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: Path, o: { replace?: boolean } = {}) => {
    if (o.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setPath(to);
  }, []);
  return { path, navigate };
}
