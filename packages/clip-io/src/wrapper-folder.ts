/**
 * The exported .clip has no free-form metadata slot for "what mini resolution was this drawn
 * at", so we round-trip it through the wrapper folder's own name instead: parsing it back out
 * on import is what lets re-opening our own files resume at the original tiny canvas size.
 */
const BASE_NAME = "ミニラフ";

export function wrapperFolderName(miniWidth: number, miniHeight: number): string {
  return `${BASE_NAME} (${miniWidth}x${miniHeight})`;
}

export function parseWrapperFolderName(name: string): { width: number; height: number } | null {
  const m = new RegExp(`^${BASE_NAME} \\((\\d+)x(\\d+)\\)$`).exec(name);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}
