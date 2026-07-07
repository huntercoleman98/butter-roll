import { renderToStaticMarkup } from "react-dom/server";
import type { IconType } from "react-icons";
import type { ReactElement } from "react";

type SyncIconFC = (props: { size?: number; color?: string }) => ReactElement;

const cache = new Map<string, HTMLImageElement>();

export function iconToImage(
  Icon: IconType,
  cacheKey: string,
  fg = "white",
  size = 12,
): Promise<HTMLImageElement> {
  const cached = cache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const element = (Icon as unknown as SyncIconFC)({ size, color: fg });
  const markup = renderToStaticMarkup(element);
  const dataUrl = "data:image/svg+xml," + encodeURIComponent(markup);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(cacheKey, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
