#!/usr/bin/env bash
# 縮小処理の入力にだけ使う原本を取得する。
# 配信アセット（public/assets/）はリポジトリに含まれているので、
# 単一ファイル版を作り直すときにだけ必要。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets-src

KHRONOS="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models"

# dragon.bin（量子化メッシュ）を作り直すための原本
if [ ! -f assets-src/DragonAttenuation.glb ]; then
  echo "› DragonAttenuation.glb を取得中…"
  curl -fL --progress-bar -o assets-src/DragonAttenuation.glb \
    "$KHRONOS/DragonAttenuation/glTF-Binary/DragonAttenuation.glb"
fi

echo "完了。dragon.bin を作り直すには:"
echo "  node tools/pack-dragon.mjs assets-src/DragonAttenuation.glb public/assets/models/dragon.bin"
