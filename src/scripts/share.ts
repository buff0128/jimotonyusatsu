// 案件詳細の「リンクをコピー」「印刷」（LINE はただのリンク）
//   [data-copy-url] … クリップボードに URL を入れ、ボタンの文言を少しのあいだ「コピーしました」にする
//   [data-print]    … 印刷のダイアログを開く（印刷用の見た目は global.css と各ページの @media print）
const COPIED_MS = 2000;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // クリップボードが使えない環境（http・古いブラウザなど）では、URL を選べる形で見せる
    window.prompt('このURLをコピーしてください', text);
    return false;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const copyButton = target?.closest?.<HTMLButtonElement>('[data-copy-url]');
  if (copyButton) {
    void copy(copyButton.dataset.copyUrl ?? location.href).then((ok) => {
      const label = copyButton.querySelector('[data-copy-text]');
      if (!ok || !label) return;
      const original = label.textContent;
      label.textContent = 'コピーしました';
      setTimeout(() => (label.textContent = original), COPIED_MS);
    });
    return;
  }
  if (target?.closest?.('[data-print]')) window.print();
});
