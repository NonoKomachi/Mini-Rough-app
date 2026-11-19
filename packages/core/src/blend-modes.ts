/**
 * CLIP STUDIO PAINTのレイヤー合成モード(「LayerComposite」)と同じ数値コードをそのまま内部表現
 * として使う — .clipの読み書き(clip-io)がそのまま数値を素通しできるようにするため、CSP独自の
 * 列挙(third_party/libclip/include/libclip/clip.h の clip_composite)と1:1で対応させてある。
 * 30(スルー)はフォルダー専用でこのアプリのレイヤー(ラスター)には選ばせない。
 */
export type BlendMode = number;

export const BLEND_NORMAL: BlendMode = 0;

/** UIのドロップダウンに出す順序・ラベル。CSPの合成モード一覧の並びに合わせてある。 */
export const BLEND_MODE_OPTIONS: ReadonlyArray<{ value: BlendMode; label: string }> = [
  { value: 0, label: "通常" },
  { value: 1, label: "比較(暗)" },
  { value: 2, label: "乗算" },
  { value: 3, label: "焼き込みカラー" },
  { value: 4, label: "焼き込み(リニア)" },
  { value: 5, label: "減算" },
  { value: 6, label: "比較(暗)カラー" },
  { value: 7, label: "比較(明)" },
  { value: 8, label: "スクリーン" },
  { value: 9, label: "覆い焼きカラー" },
  { value: 10, label: "グロー" },
  { value: 11, label: "加算" },
  { value: 12, label: "加算(発光)" },
  { value: 13, label: "比較(明)カラー" },
  { value: 14, label: "オーバーレイ" },
  { value: 15, label: "ソフトライト" },
  { value: 16, label: "ハードライト" },
  { value: 17, label: "ビビッドライト" },
  { value: 18, label: "リニアライト" },
  { value: 19, label: "ピンライト" },
  { value: 20, label: "ハードミックス" },
  { value: 21, label: "差の絶対値" },
  { value: 22, label: "除外" },
  { value: 23, label: "色相" },
  { value: 24, label: "彩度" },
  { value: 25, label: "カラー" },
  { value: 26, label: "輝度" },
  { value: 27, label: "除算" }
];

export function blendModeLabel(mode: BlendMode): string {
  return BLEND_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "通常";
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// チャンネルごとに独立に計算できる("separable"な)合成モード。入出力は0..1。
// 式はPhotoshop/CSS Compositing仕様に準拠(一部、Photoshop拡張の加算・減算系も含む)。
// ---------------------------------------------------------------------------
function colorDodge(cb: number, cs: number): number {
  if (cb <= 0) return 0;
  if (cs >= 1) return 1;
  return Math.min(1, cb / (1 - cs));
}

function colorBurn(cb: number, cs: number): number {
  if (cb >= 1) return 1;
  if (cs <= 0) return 0;
  return 1 - Math.min(1, (1 - cb) / cs);
}

function hardLight(cb: number, cs: number): number {
  return cs <= 0.5 ? cb * (2 * cs) : cb + (2 * cs - 1) - cb * (2 * cs - 1);
}

function softLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

function vividLight(cb: number, cs: number): number {
  return cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * cs - 1);
}

/** 乗算・加算・比較(暗)/(明)・スクリーン・オーバーレイ・ソフト/ハードライト・ビビッド/リニア/
 * ピンライト・ハードミックス・差の絶対値・除外・減算・除算 — チャンネル独立に計算できるモード。
 * グロー(10)・加算(発光)(12)はCSP独自で公開された正確な式がないため、近い見た目になる覆い焼き系
 * の式で近似している(ピクセル完全一致は保証しない)。 */
function blendChannelSeparable(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 1: // 比較(暗)
      return Math.min(cb, cs);
    case 2: // 乗算
      return cb * cs;
    case 3: // 焼き込みカラー
      return colorBurn(cb, cs);
    case 4: // 焼き込み(リニア)
      return Math.max(0, cb + cs - 1);
    case 5: // 減算
      return Math.max(0, cb - cs);
    case 7: // 比較(明)
      return Math.max(cb, cs);
    case 8: // スクリーン
      return cb + cs - cb * cs;
    case 9: // 覆い焼きカラー
      return colorDodge(cb, cs);
    case 10: // グロー(近似: 覆い焼きのCb/Csを入れ替え)
      return colorDodge(cs, cb);
    case 11: // 加算
      return Math.min(1, cb + cs);
    case 12: // 加算(発光)(近似: 加算と同じ式を採用)
      return Math.min(1, cb + cs);
    case 14: // オーバーレイ = ハードライトのCb/Csを入れ替え
      return hardLight(cs, cb);
    case 15: // ソフトライト
      return softLight(cb, cs);
    case 16: // ハードライト
      return hardLight(cb, cs);
    case 17: // ビビッドライト
      return vividLight(cb, cs);
    case 18: // リニアライト
      return clamp01(cb + 2 * cs - 1);
    case 19: // ピンライト
      return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 20: // ハードミックス
      return vividLight(cb, cs) < 0.5 ? 0 : 1;
    case 21: // 差の絶対値
      return Math.abs(cb - cs);
    case 22: // 除外
      return cb + cs - 2 * cb * cs;
    case 27: // 除算
      return cs <= 0 ? (cb <= 0 ? 0 : 1) : clamp01(cb / cs);
    default: // 通常(0)含むフォールバック
      return cs;
  }
}

const SEPARABLE_MODES = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 27]);
/** 比較(暗)カラー(6)・比較(明)カラー(13)・色相/彩度/カラー/輝度(23-26) — チャンネル単位ではなく
 * ピクセル全体(色相・輝度)で計算する必要があるモード。 */
const NON_SEPARABLE_MODES = new Set([6, 13, 23, 24, 25, 26]);

export function isKnownBlendMode(mode: BlendMode): boolean {
  return mode === BLEND_NORMAL || SEPARABLE_MODES.has(mode) || NON_SEPARABLE_MODES.has(mode);
}

// ---------------------------------------------------------------------------
// 色相・彩度・カラー・輝度、および比較(暗)/(明)カラー — ピクセル全体(RGB三成分)で計算する
// 合成モード。アルゴリズムはW3C Compositing and Blending仕様のSetLum/SetSat/ClipColorに準拠。
// ---------------------------------------------------------------------------
function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function clipColor(r: number, g: number, b: number, out: [number, number, number]): void {
  const l = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0 && l !== n) {
    r = l + ((r - l) * l) / (l - n);
    g = l + ((g - l) * l) / (l - n);
    b = l + ((b - l) * l) / (l - n);
  }
  if (x > 1 && x !== l) {
    r = l + ((r - l) * (1 - l)) / (x - l);
    g = l + ((g - l) * (1 - l)) / (x - l);
    b = l + ((b - l) * (1 - l)) / (x - l);
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

function setLum(r: number, g: number, b: number, l: number, out: [number, number, number]): void {
  const d = l - lum(r, g, b);
  clipColor(r + d, g + d, b + d, out);
}

const setSatScratch: [number, number, number] = [0, 0, 0];
function setSat(r: number, g: number, b: number, s: number, out: [number, number, number]): void {
  setSatScratch[0] = r;
  setSatScratch[1] = g;
  setSatScratch[2] = b;
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < 3; i++) {
    if (setSatScratch[i] > setSatScratch[maxI]) maxI = i;
    if (setSatScratch[i] < setSatScratch[minI]) minI = i;
  }
  if (setSatScratch[maxI] === setSatScratch[minI]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  let midI = 0;
  for (let i = 0; i < 3; i++) if (i !== maxI && i !== minI) midI = i;
  const mid = ((setSatScratch[midI] - setSatScratch[minI]) * s) / (setSatScratch[maxI] - setSatScratch[minI]);
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[maxI] = s;
  out[midI] = mid;
  out[minI] = 0;
}

const nonSeparableScratchA: [number, number, number] = [0, 0, 0];

function blendPixelNonSeparable(
  mode: BlendMode,
  cbR: number,
  cbG: number,
  cbB: number,
  csR: number,
  csG: number,
  csB: number,
  out: [number, number, number]
): void {
  switch (mode) {
    case 6: // 比較(暗)カラー: 輝度が低い方の色をそのまま採用
      if (lum(cbR, cbG, cbB) <= lum(csR, csG, csB)) {
        out[0] = cbR;
        out[1] = cbG;
        out[2] = cbB;
      } else {
        out[0] = csR;
        out[1] = csG;
        out[2] = csB;
      }
      return;
    case 13: // 比較(明)カラー: 輝度が高い方の色をそのまま採用
      if (lum(cbR, cbG, cbB) >= lum(csR, csG, csB)) {
        out[0] = cbR;
        out[1] = cbG;
        out[2] = cbB;
      } else {
        out[0] = csR;
        out[1] = csG;
        out[2] = csB;
      }
      return;
    case 23: // 色相
      setSat(csR, csG, csB, sat(cbR, cbG, cbB), nonSeparableScratchA);
      setLum(nonSeparableScratchA[0], nonSeparableScratchA[1], nonSeparableScratchA[2], lum(cbR, cbG, cbB), out);
      return;
    case 24: // 彩度
      setSat(cbR, cbG, cbB, sat(csR, csG, csB), nonSeparableScratchA);
      setLum(nonSeparableScratchA[0], nonSeparableScratchA[1], nonSeparableScratchA[2], lum(cbR, cbG, cbB), out);
      return;
    case 25: // カラー
      setLum(csR, csG, csB, lum(cbR, cbG, cbB), out);
      return;
    case 26: // 輝度
      setLum(cbR, cbG, cbB, lum(csR, csG, csB), out);
      return;
    default:
      out[0] = csR;
      out[1] = csG;
      out[2] = csB;
  }
}

/** `mode`でCb(下地)とCs(描画色)を混ぜた結果を`out`(0..1、長さ3)に書き込む。通常(0)や未知の
 * コードはCsをそのまま返す(通常合成と同じ)。 */
export function blendPixel(
  mode: BlendMode,
  cbR: number,
  cbG: number,
  cbB: number,
  csR: number,
  csG: number,
  csB: number,
  out: [number, number, number]
): void {
  if (mode === BLEND_NORMAL || !isKnownBlendMode(mode)) {
    out[0] = csR;
    out[1] = csG;
    out[2] = csB;
    return;
  }
  if (NON_SEPARABLE_MODES.has(mode)) {
    blendPixelNonSeparable(mode, cbR, cbG, cbB, csR, csG, csB, out);
    return;
  }
  out[0] = blendChannelSeparable(mode, cbR, csR);
  out[1] = blendChannelSeparable(mode, cbG, csG);
  out[2] = blendChannelSeparable(mode, cbB, csB);
}
