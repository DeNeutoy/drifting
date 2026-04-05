import { useState, useEffect } from "preact/hooks";

export function useRoute(): string {
  const [route, setRoute] = useState(window.location.hash || "#/");

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
