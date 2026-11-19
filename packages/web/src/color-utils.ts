export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** スウォッチ要素のstyle.backgroundImageに直接代入する値を作る: 指定色(alpha込み)の単色レイヤーを
 * 市松模様の上に重ねたもの。CSSのbackground-imageは複数レイヤーを並べるとレイヤーは手前から
 * 順(最初に書いたものが一番上)に重なるので、単色レイヤーを先頭に置けば不透明(a=1)なら市松を
 * 完全に覆い隠し、半透明(a<1)になるほど下の市松が透けて見える——意図した「不透明度を下げると
 * 透明チェッカーが見えてくる」表示になる。
 *
 * element.style.opacity(要素全体を薄くする)では実現できない: opacityは背景色だけでなく
 * この市松模様(同じ要素のbackground-image)も一緒に薄めてしまい、どの不透明度でも市松が
 * ずっと透けて見える・肝心の色自体も薄汚れて見えるという不具合になっていた。
 * background-size/background-position/background-colorは呼び出し側のCSSで
 * (レイヤー数ぶん: 単色,市松1,市松2)固定値を指定しておく前提。 */
export function checkeredBackgroundImage(r: number, g: number, b: number, alpha255: number): string {
  const a = Math.max(0, Math.min(1, alpha255 / 255));
  const solid = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
  return (
    `linear-gradient(${solid}, ${solid}), ` +
    `linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%), ` +
    `linear-gradient(45deg, #777 25%, transparent 25%, transparent 75%, #777 75%)`
  );
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return [h, s, v];
}
