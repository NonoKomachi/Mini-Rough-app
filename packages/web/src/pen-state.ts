/** スタイラス対応タブレット等、ペンとタッチの両方を同時に検知できる画面向けの簡易パーム
 * リジェクション — ペンが画面に触れている間は、描いている手のひらが触れて生じる誤タッチ
 * (描画・パン・ピンチズーム・2本指Undo/3本指Redo等)を全て無視できるようにする(ユーザー要望)。
 * ペンの接触はキャンバスごとに別々の要素で捕捉されるため、ここではdocument全体をキャプチャ
 * フェーズで監視し、どのキャンバス上のペンでもアプリ全体に効くようにする。 */
let activePenCount = 0;

document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.pointerType === "pen") activePenCount++;
  },
  { capture: true }
);
document.addEventListener(
  "pointerup",
  (e) => {
    if (e.pointerType === "pen" && activePenCount > 0) activePenCount--;
  },
  { capture: true }
);
document.addEventListener(
  "pointercancel",
  (e) => {
    if (e.pointerType === "pen" && activePenCount > 0) activePenCount--;
  },
  { capture: true }
);

export function isPenActive(): boolean {
  return activePenCount > 0;
}
