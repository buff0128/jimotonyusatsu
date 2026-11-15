#!/bin/sh
# OGP 画像（public/og-image.png、1200×630）を作る。生成りの背景に docs/logo/logo-horizontal.svg（柿×藍）と
# キャッチコピーを置き、Chrome のヘッドレス描画でスクリーンショットを撮る（macOS の Google Chrome を使う）
# 色・フォントは docs/design/DESIGN.md に合わせる（見出しは M PLUS Rounded 1c を Google Fonts から読む）
#   sh scripts/build-og-image.sh
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WORK="$ROOT/data/og"
mkdir -p "$WORK"
cp "$ROOT/docs/logo/logo-horizontal.svg" "$WORK/logo.svg"
cat > "$WORK/og.html" <<'HTML'
<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800&family=Noto+Sans+JP:wght@700&display=block">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; background: #FAF7F2; overflow: hidden; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; position: relative; }
  img { width: 640px; height: auto; display: block; }
  p { margin: 0; font-family: 'M PLUS Rounded 1c', sans-serif; font-weight: 800; font-size: 52px; color: #2B2622; letter-spacing: 0.02em; }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; background: #EFE6D6; border-top: 1px solid #E2D6C1;
          display: flex; align-items: center; justify-content: center; font-family: 'Noto Sans JP', sans-serif; font-weight: 700; font-size: 24px; color: #4A3F35; }
</style></head>
<body>
  <img src="logo.svg" alt="">
  <p>あなたの町の入札を、ひとめで。</p>
  <div class="band">国・県・市町村の入札を市区町村ごとに　登録なし・完全無料</div>
</body></html>
HTML
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=8000 \
  --window-size=1200,630 --screenshot="$ROOT/public/og-image.png" "file://$WORK/og.html" >/dev/null 2>&1
echo "public/og-image.png を作成しました"
