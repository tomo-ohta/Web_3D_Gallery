import './style.css';
import { Engine, type Slot } from './core/engine';
import type { DemoDef } from './core/types';
import { createStudio } from './demos/studio';
import { createMaterials } from './demos/materials';
import { createGlass } from './demos/glass';
import { createSSS } from './demos/sss';
import { createFur } from './demos/fur';
import { createGodrays } from './demos/godrays';
import { createParticles } from './demos/particles';
import { createFluid } from './demos/fluid';
import { createWater } from './demos/water';
import { createCloth } from './demos/cloth';
import { createSoftbody } from './demos/softbody';
import { createRigid } from './demos/rigid';
import { createOcean } from './demos/ocean';
import { createBoids } from './demos/boids';
import { createFireworks } from './demos/fireworks';
import { createFracture } from './demos/fracture';
import { createRope } from './demos/rope';
import { createSnow } from './demos/snow';
import { createClouds } from './demos/clouds';
import { createMetaballs } from './demos/metaballs';
import { createMandelbulb } from './demos/mandelbulb';
import { createPlanet } from './demos/planet';
import { createLSystem } from './demos/lsystem';
import { createAurora } from './demos/aurora';
import { createNPR } from './demos/npr';
import { createSkeletal } from './demos/skeletal';
import { createMorph } from './demos/morph';
import { createPostfx } from './demos/postfx';
import { createAudioViz } from './demos/audioviz';
import { createWetStreet } from './demos/wetstreet';

const DEMOS: DemoDef[] = [
  {
    id: 'studio',
    title: 'ライティングスタジオ',
    subtitle: 'IBL / PBR MODEL SHOWCASE',
    category: 'ライティング',
    tech: ['glTF 2.0', 'HDRI IBL', 'PBR', 'ACES'],
    description:
      '実写取り込み系PBRモデル（Battle Damaged Helmet）を、実測HDRI環境光のみでライティング。画像ベースドライティング（IBL）が金属の映り込み、錆の粗さ、塗装の艶をすべて環境から導出します。',
    techDetail: [
      'HDRI を PMREM 前処理し粗さ別ミップとして参照',
      'metalness / roughness テクスチャによる物理ベースシェーディング',
      'ACES Filmic トーンマッピング + 露出のシーン別調整',
    ],
    controls: ['ドラッグ — 視点を回転', 'タップ — 環境光を切替（夕暮れ / スタジオ / 星空）', 'ピンチ / ホイール — ズーム'],
    hint: 'ドラッグで回転 / タップで環境切替',
    gridHint: 'ドラッグで視点を回す',
    create: createStudio,
  },
  {
    id: 'fluid',
    title: 'インク流体',
    subtitle: 'NAVIER-STOKES FLUID',
    category: 'シミュレーション',
    tech: ['GPGPU', 'Navier-Stokes', '渦度強制', 'Jacobi反復'],
    description:
      '非圧縮性ナビエ–ストークス方程式をGPU上で解く2D流体。セミラグランジュ移流、渦度強制、圧力のヤコビ反復投影という実務どおりのパイプラインで、インクが混ざり合う渦を生みます。',
    techDetail: [
      '速度場・染料場・圧力場をピンポンFBOで更新',
      '渦度強制（Vorticity Confinement）で小さな渦を保存',
      '発散除去のため圧力ポアソン方程式をヤコビ法で反復求解',
    ],
    controls: ['ドラッグ — インクを注入して掻き混ぜる', 'タップ — 放射状バースト'],
    hint: 'ドラッグでインクを流す / タップで爆発',
    gridHint: 'ドラッグでインクを流す',
    create: createFluid,
  },
  {
    id: 'glass',
    title: 'ガラス屈折と分散',
    subtitle: 'REFRACTION & DISPERSION',
    category: 'マテリアル',
    tech: ['Transmission', 'Dispersion', 'IOR', 'Clearcoat'],
    description:
      '物理ベースの透過マテリアル。屈折率（IOR）に基づき背景を屈折させ、波長ごとに屈折率が異なる「分散」でダイヤモンドのような虹色の縁を生みます。',
    techDetail: [
      'シーンを別パスに描画して屈折サンプリング（Transmission）',
      'RGB各波長で異なるIORを用いる色分散近似',
      '厚み（thickness）と減衰色によるビア・ランバート吸収',
    ],
    controls: ['ドラッグ — 視点を回転', 'タップ — 形状を切替（ダイヤ / ドラゴン / ノット）', 'ピンチ / ホイール — ズーム'],
    hint: 'ドラッグで回転 / タップで形状切替',
    gridHint: 'ドラッグで視点を回す',
    create: createGlass,
  },
  {
    id: 'particles',
    title: '粒子銀河',
    subtitle: '147K GPU PARTICLES',
    category: 'シミュレーション',
    tech: ['GPGPU', 'カールノイズ', '147,456粒子', '加算合成'],
    description:
      '約15万個のパーティクルの位置と速度をすべてGPUテクスチャ上で更新。発散のないカールノイズ乱流と向心力が銀河の渦を形づくり、指先の引力で流れをねじ曲げられます。',
    techDetail: [
      '位置・速度を浮動小数点テクスチャに格納しシェーダーで積分',
      'ポテンシャル場の回転（カールノイズ）による乱流',
      '速度に応じたカラーランプと加算ブレンディング',
    ],
    controls: ['プレス / ドラッグ — 指先に引き寄せる', 'タップ — 爆発', 'ピンチ / ホイール — ズーム'],
    hint: '押さえて引き寄せ / タップで爆発',
    gridHint: '押さえて粒子を引き寄せる',
    create: createParticles,
  },
  {
    id: 'fur',
    title: 'ファー',
    subtitle: 'SHELL-TEXTURED FUR',
    category: 'マテリアル',
    tech: ['シェル法', 'インスタンシング', '疑似AO', 'リムライト'],
    description:
      '毛皮の定番技法「シェルテクスチャリング」。同じメッシュを法線方向に最大60層重ね、層ごとに毛断面を間引くことで体積のある毛並みを作ります。撫でると毛が流れ、離すとスプリングで戻ります。',
    techDetail: [
      'gl_InstanceID による60層のシェル一括描画',
      '層の高さに応じた毛の先細りと擬似アンビエントオクルージョン',
      '重力・慣性・風のオフセットを層高の累乗で加算',
    ],
    controls: ['毛の上をドラッグ — その場所だけ撫でる', '外側をドラッグ — 視点を回転', 'タップ — ぷるぷる震わせる', 'ピンチ / ホイール — ズーム'],
    hint: '撫でると毛並みが流れる / タップで震える',
    gridHint: 'ドラッグで毛を撫でる',
    create: createFur,
  },
  {
    id: 'water',
    title: '水面とコースティクス',
    subtitle: 'INTERACTIVE POOL WATER',
    category: 'シミュレーション',
    tech: ['波動方程式', 'GPGPU', 'コースティクス', 'フレネル'],
    description:
      '高さ場の波動方程式をGPUで解くプール。水面の法線から床タイルを屈折させ、波の集光（コースティクス）を近似。触れた場所から波紋が広がり、干渉し合います。',
    techDetail: [
      '高さと速度をテクスチャに保持する波動方程式ソルバ',
      'ラプラシアンによる集光近似で床のコースティクスを生成',
      'フレネル項で屈折（床）と反射（空）をブレンド',
    ],
    controls: ['なぞる — 波紋を起こす', 'タップ — 大きな波紋', 'ピンチ / ホイール — ズーム'],
    hint: 'なぞって波紋 / タップで大波',
    gridHint: 'なぞって波紋を起こす',
    create: createWater,
  },
  {
    id: 'materials',
    title: 'マテリアル・ミュージアム',
    subtitle: 'PHYSICAL MATERIAL GALLERY',
    category: 'マテリアル',
    tech: ['Clearcoat', 'Anisotropy', 'Iridescence', 'Sheen'],
    description:
      '物理ベースマテリアルの拡張パラメータを巡回展示。カーペイントの二層クリアコート、ヘアライン金属の異方性反射、シャボン膜の虹彩、ベルベットの逆光光沢——同じ形でも材質で全く違う表情になります。',
    techDetail: [
      'MeshPhysicalMaterial の6プリセットを実物質パラメータで構成',
      '薄膜干渉（イリデッセンス）は膜厚から波長依存反射を計算',
      '異方性反射はUV接線方向にハイライトを引き伸ばす',
    ],
    controls: ['ドラッグ — 視点を回転', 'タップ — マテリアルを切替', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで質感切替',
    gridHint: 'ドラッグで視点を回す',
    create: createMaterials,
  },
  {
    id: 'softbody',
    title: 'ソフトボディゼリー',
    subtitle: 'SHAPE-MATCHING SOFT BODY',
    category: 'シミュレーション',
    tech: ['シェイプマッチング', '125質点', 'トライリニア変形', 'Transmission'],
    description:
      'ミュラーのシェイプマッチング法によるゼリー。125個の質点を物理積分し、最適回転を反復抽出して元の形へ引き戻すことで、破綻しない「ぷるぷる」を実現。掴んで投げられます。',
    techDetail: [
      '5×5×5格子質点のセミインプリシット積分',
      '四元数反復による最適回転抽出（Müller 2016）',
      '格子のトライリニア補間で高解像度メッシュを変形',
    ],
    controls: ['本体をドラッグ — 掴んで大きく伸ばす', 'タップ — 突いて揺らす', '外側をドラッグ — 視点回転', 'ピンチ / ホイール — ズーム'],
    hint: '掴んでびよーんと伸ばす / タップで突く',
    gridHint: '掴んで引っ張る',
    create: createSoftbody,
  },
  {
    id: 'godrays',
    title: '光芒の部屋',
    subtitle: 'VOLUMETRIC LIGHT SHAFTS',
    category: 'ライティング',
    tech: ['レイマーチング', 'HG位相関数', '手続き的ノイズ', '塵粒子'],
    description:
      'ブラインドから差し込む光をレイマーチングで体積散乱として計算。各サンプル点から光源方向へ遮蔽を判定し、Henyey-Greenstein位相関数で前方散乱の眩しさを再現します。塵は光の中でだけ煌めきます。',
    techDetail: [
      '1本のレイあたり最大76ステップの体積積分',
      'スリット遮蔽の解析的シャドウで光芒を形成',
      'ノイズによる霧の濃淡と床に落ちるスリット模様',
    ],
    controls: ['ポインタ移動 — 光の角度を変える', 'タップ — 光の色調を切替', 'ピンチ / ホイール — ズーム'],
    hint: '動かして光を操る / タップで色調切替',
    gridHint: '動かして光を操る',
    create: createGodrays,
  },
  {
    id: 'cloth',
    title: '布と風',
    subtitle: 'VERLET CLOTH SIMULATION',
    category: 'シミュレーション',
    tech: ['Verlet積分', '距離拘束', '法線風力', 'ソフトシャドウ'],
    description:
      '1,134質点のヴェルレ積分と約4,300本の距離拘束による旗のシミュレーション。布の法線が受ける風圧ではためきが生まれ、ドラッグで風向きを直接操れます。',
    techDetail: [
      '構造・せん断・曲げの3種の拘束を反復緩和',
      '面の向きと風向きの内積による揚力近似',
      '毎フレーム法線を再計算しPBRシェーディング',
    ],
    controls: ['布の近くをドラッグ — つかんで引っ張る', '離れた場所をドラッグ — 風を送る', 'タップ — 突風', 'ピンチ / ホイール — ズーム'],
    hint: '布をつかんで引っ張る / タップで突風',
    gridHint: '布をつかんで引っ張る',
    create: createCloth,
  },
  {
    id: 'sss',
    title: '透光素材',
    subtitle: 'SUBSURFACE TRANSLUCENCY',
    category: 'マテリアル',
    tech: ['Transmission', 'ビア・ランバート減衰', '厚みマップ'],
    description:
      '翡翠や蝋のように「光を透かす」素材の表現。素材内部を進む光が距離に応じて色付きながら減衰し、薄い部分だけが裏の光を透かします。光源を動かして透け方の変化をお楽しみください。',
    techDetail: [
      '透過距離に基づくビア・ランバート則の色減衰',
      '背後光源の屈折サンプリングで透光を再現',
      '翡翠 / 蜜蝋 / 乳白 / 琥珀 / クリアガラスの5素材',
    ],
    controls: ['ポインタ移動 — 背後の光源を動かす', 'タップ — 素材を切替（5種）', 'ピンチ / ホイール — ズーム'],
    hint: '光を動かす / タップで素材切替',
    gridHint: '動かして光源を操作',
    create: createSSS,
  },
  {
    id: 'rigid',
    title: '剛体タワー',
    subtitle: 'RIGID BODY PHYSICS',
    category: 'シミュレーション',
    tech: ['Rapier (WASM)', '衝突検出', '摩擦・反発', 'スタッキング'],
    description:
      'Rust製物理エンジンRapier（WebAssembly）による剛体シミュレーション。27個の積み木の安定スタッキング、鉄球の衝突、摩擦と反発をリアルタイムに解きます。崩したら自動で再建します。',
    techDetail: [
      'WebAssembly上で動く衝突検出と拘束ソルバ',
      '固定タイムステップ + 補間で安定積分',
      '静止検知による自動リセット',
    ],
    controls: ['タップ — 鉄球を発射', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで鉄球発射 / ドラッグで回転',
    gridHint: 'ドラッグで視点を回す',
    create: createRigid,
  },
  {
    id: 'ocean',
    title: '海洋',
    subtitle: 'GERSTNER WAVE OCEAN',
    category: 'プロシージャル',
    tech: ['ゲルストナー波', '解析的法線', '海泡', '大気フォグ'],
    description:
      '6つのゲルストナー波の重ね合わせによる手続き的な海。頂点が円運動することで波頭が尖る本物の波形になり、解析的に求めた法線が夕陽の鏡面反射と波間の透過光を描きます。凪から時化まで切替可能。',
    techDetail: [
      '振幅・波長・進行方向の異なる6波の重ね合わせ',
      '接線・従法線の解析微分による正確な法線',
      '波頭検出 + ノイズによる砕け泡の表現',
    ],
    controls: ['ドラッグ — 視点を回転', 'タップ — 海況を切替（凪 / うねり / 時化）', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで海況切替（凪・うねり・時化）',
    gridHint: 'ドラッグで視点を回す',
    create: createOcean,
  },
  {
    id: 'boids',
    title: '魚群',
    subtitle: 'GPGPU BOIDS FLOCKING',
    category: 'シミュレーション',
    tech: ['ボイド', 'GPGPU', '4,096体', '群知能'],
    description:
      '分離・整列・結集という3つの単純な規則だけで群れが生まれるボイドモデル。4,096匹の相互作用（約1,600万ペア）を毎フレームGPUで解きます。ポインタは捕食者——近づくと群れが割れて逃げ惑います。',
    techDetail: [
      '全対全の近傍探索をフラグメントシェーダーで並列計算',
      '尾びれのくねりは速度に応じた頂点シェーダー変形',
      '楕円の水槽に閉じ込めるソフト境界と深度フォグ',
    ],
    controls: ['プレス / ドラッグ — 捕食者を差し込む', 'タップ — 群れを散らす', 'ピンチ / ホイール — ズーム'],
    hint: '押さえると群れが逃げる',
    gridHint: '押さえると群れが逃げる',
    create: createBoids,
  },
  {
    id: 'fireworks',
    title: '花火',
    subtitle: 'PARTICLE FIREWORKS',
    category: 'シミュレーション',
    tech: ['多段パーティクル', '牡丹/環/柳/椰子', '水面反射'],
    description:
      '打ち上げから開花までを多段パーティクルで表現する夜空の花火。牡丹・環・柳・椰子の4種の開き方があり、火花は空気抵抗と重力で減速しながら瞬きます。水面には花火が静かに映り込みます。',
    techDetail: [
      '9,000粒のCPUパーティクルプール（スワップ消去で確保なし）',
      'ロケット→開花→尾を引く火花の多段エミッション',
      '同一ジオメトリを反転描画する擬似水面反射',
    ],
    controls: ['タップ — その場所に打ち上げ', 'ドラッグ — 連射', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで打ち上げ / ドラッグで連射',
    gridHint: 'タップした場所に打ち上げ',
    create: createFireworks,
  },
  {
    id: 'wetstreet',
    title: '雨のネオン街',
    subtitle: 'PLANAR REFLECTIONS',
    category: 'ライティング',
    tech: ['平面リフレクション', '水たまりマスク', '波紋', 'ネオン'],
    description:
      '雨上がりの路地。ミラーカメラでシーンをもう一度描画した反射テクスチャを、ノイズの水たまりマスクで濡れたアスファルトに合成します。雨粒の波紋が反射をゆがめ、ネオンの色が路面に流れます。',
    techDetail: [
      '反射行列によるミラーカメラの平面リフレクション',
      '水たまり = fbmノイズのマスクで反射鋭さを変化',
      'セルノイズによる波紋が投影UVをひずませる',
    ],
    controls: ['タップ — ネオンの配色を切替', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップでネオンの色替え',
    gridHint: 'ドラッグで視点を回す',
    create: createWetStreet,
  },
  {
    id: 'clouds',
    title: '雲海',
    subtitle: 'VOLUMETRIC CLOUDS',
    category: 'プロシージャル',
    tech: ['ボリュームレイマーチ', 'ライトマーチ', 'fbmノイズ', 'HG位相'],
    description:
      'fbmノイズの密度場をレイマーチングで積分するボリューメトリック雲。各サンプル点から太陽へ向けて再度マーチし、雲の自己遮蔽と縁の透過光を計算します。太陽を沈めると雲海が茜色に染まります。',
    techDetail: [
      '雲スラブ内を最大84ステップの本マーチ + 4ステップのライトマーチ',
      'Beer則 + パウダー項による濃淡、HG位相関数の前方散乱',
      '太陽高度で空・太陽色をブレンドする簡易大気',
    ],
    controls: ['ドラッグ — 太陽の位置（時刻）を動かす', 'タップ — 雲量を切替', 'ピンチ / ホイール — ズーム'],
    hint: 'ドラッグで太陽を動かす / タップで雲量',
    gridHint: 'ドラッグで太陽を動かす',
    create: createClouds,
  },
  {
    id: 'npr',
    title: '画風切替',
    subtitle: 'NPR / TOON SHADING',
    category: 'スタイライズ',
    tech: ['トゥーン', '反転ハル輪郭線', 'ハッチング', 'ホログラム'],
    description:
      '同じヘルメットモデルを4つの画風で描き分ける非フォトリアルレンダリング（NPR）。ライティングを3段階に量子化するセル調、法線方向に膨らませた裏面メッシュによる輪郭線、画面空間のクロスハッチング——描画の「解釈」が変わります。',
    techDetail: [
      '照度の量子化 + 影色シフトによるセルルック',
      '反転ハル法（法線押し出し + 裏面描画）の輪郭線',
      'スクリーン空間の3層クロスハッチングと紙色',
    ],
    controls: ['タップ — 画風を切替（PBR / トゥーン / スケッチ / ホログラム）', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで画風切替',
    gridHint: 'ドラッグで視点を回す',
    create: createNPR,
  },
  {
    id: 'fracture',
    title: '破壊と再生',
    subtitle: 'FRACTURE PHYSICS',
    category: 'シミュレーション',
    tech: ['Rapier', '破片91個', '凸包コライダー', 'キネマティック補間'],
    description:
      '陶器の壺をタップで粉砕。球殻を91個の破片に分割し、それぞれに凸包コライダーを持たせて剛体として崩壊させます。静まると破片が時を巻き戻すように舞い戻り、壺が再生します。',
    techDetail: [
      '破片ごとの凸包（convex hull）衝突形状',
      '固定→動的→キネマティックの3態を切り替える剛体制御',
      'イージング付き位置・回転補間による逆再生風の再集合',
    ],
    controls: ['タップ — 粉砕 / 破片を蹴散らす', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで粉砕 → 自動で再生',
    gridHint: 'タップで壺を粉砕',
    create: createFracture,
  },
  {
    id: 'planet',
    title: '惑星ジェネレーター',
    subtitle: 'PROCEDURAL PLANET',
    category: 'プロシージャル',
    tech: ['fbm地形', 'バイオーム', '大気散乱風', 'シード生成'],
    description:
      'ノイズから地形・海・雲・大気まで丸ごと生成する手続き的惑星。標高と緯度と斜度からバイオーム（砂浜・森・岩・雪）を決め、フラット法線でローポリ調に仕上げています。タップするたび、まだ誰も見たことのない星が生まれます。',
    techDetail: [
      '頂点シェーダーの尾根ノイズ地形（シード即時再生成）',
      '高度 × 緯度 × 斜面のバイオーム分類',
      'BackSideフレネルの大気グロー + 回転する雲層',
    ],
    controls: ['タップ — 新しい惑星を生成', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで新しい惑星',
    gridHint: 'タップで新しい惑星',
    create: createPlanet,
  },
  {
    id: 'rope',
    title: '真珠のカーテン',
    subtitle: 'VERLET STRANDS',
    category: 'シミュレーション',
    tech: ['Verletロープ', '792ビーズ', '球コライダー', '虹彩真珠'],
    description:
      '36本のストランドに792個の真珠を通したビーズのれん。各ストランドはヴェルレ積分の連鎖拘束で揺れ、指の球コライダーがカーテンをかき分けます。真珠は薄膜干渉でうっすら虹色に光ります。',
    techDetail: [
      'ストランドごとの距離拘束チェーン（上端ピン留め）',
      'ポインタ追従の球コライダーによる押し退け',
      'InstancedMesh + iridescence の真珠マテリアル',
    ],
    controls: ['なぞる — カーテンをかき分ける', 'タップ — 波のパルス', 'ピンチ / ホイール — ズーム'],
    hint: 'なぞってかき分ける',
    gridHint: 'なぞってかき分ける',
    create: createRope,
  },
  {
    id: 'aurora',
    title: 'オーロラ',
    subtitle: 'AURORA BOREALIS',
    category: 'プロシージャル',
    tech: ['層状レイマーチ', 'fbmカーテン', '星空', '雪原反射'],
    description:
      '夜空に揺れるオーロラのカーテン。高度の異なる26枚のノイズ層を視線に沿って積分し、下端は明るい緑、上空へ向かって紫に遷移させています。ポインタを動かすとカーテンが呼応してたなびきます。',
    techDetail: [
      '高度層ごとのfbmサンプリングを加算合成',
      '高度による緑→紫のスペクトル遷移',
      '雪原には上下反転レイでうっすら映り込み',
    ],
    controls: ['ポインタ移動 — カーテンを揺らす / 視線を振る', 'タップ — 色を切替', 'ピンチ / ホイール — ズーム'],
    hint: '動かすとカーテンが揺れる',
    gridHint: '動かすとカーテンが揺れる',
    create: createAurora,
  },
  {
    id: 'skeletal',
    title: 'キツネの散歩',
    subtitle: 'SKELETAL ANIMATION',
    category: 'アニメーション',
    tech: ['スキニング', 'クロスフェード', 'ボーン注視制御', 'glTF'],
    description:
      'ボーンで駆動するスケルタルアニメーション（Khronos Fox）。待機・歩行・走行の3クリップをクロスフェードで滑らかに繋ぎ、さらに毎フレーム頭のボーンをアニメーションの上から書き換えて、キツネがポインタを目で追います。',
    techDetail: [
      'AnimationMixer による3クリップのクロスフェード',
      'ミキサー更新後に頭部ボーンをプロシージャル制御（注視）',
      '歩行速度に同期した円周移動',
    ],
    controls: ['タップ — 待機 / 歩く / 走る を切替', 'ポインタ移動 — キツネが目で追う', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで動作切替 / キツネが目で追う',
    gridHint: 'キツネがポインタを目で追う',
    create: createSkeletal,
  },
  {
    id: 'metaballs',
    title: '液体金属',
    subtitle: 'SDF METABALLS',
    category: 'プロシージャル',
    tech: ['SDFレイマーチ', 'smin融合', '環境マップ反射'],
    description:
      '距離関数（SDF）のスムーズ最小値で7つの球がぬるりと融合する液体金属。ポリゴンを使わずレイマーチングで直接レンダリングし、HDRI環境を映し込みます。1つはポインタで引き回せて、離すと本体に吸い込まれます。',
    techDetail: [
      '多項式smoothing minによる形状融合',
      'スフィアトレーシング + 勾配法線',
      'equirect HDRIの反射・屈折サンプリング',
    ],
    controls: ['ドラッグ — 玉を引き回す', 'タップ — 質感切替（クローム / 金 / シャボン）', 'ピンチ / ホイール — ズーム'],
    hint: 'ドラッグで玉を引き回す',
    gridHint: 'ドラッグで玉を引き回す',
    create: createMetaballs,
  },
  {
    id: 'snow',
    title: '雪原',
    subtitle: 'SNOW ACCUMULATION',
    category: 'シミュレーション',
    tech: ['積雪高さ場', '2,400フレーク', '除雪インタラクション'],
    description:
      '降りしきる雪が高さ場に着雪し、地面がゆっくり嵩を増していきます。指でなぞればそこだけ雪が除けて跡が残り、タップすればどか雪が積もる——時間とともに景色が変わる夜の雪原です。',
    techDetail: [
      'フレークの着地点をガウス散布する CPU 高さ場',
      '高さ場の勾配から法線を再構成する頂点変位シェーダー',
      '街灯の暖色とキラキラ反射（スパークル）',
    ],
    controls: ['なぞる — 雪に跡をつける（除雪）', 'タップ — どか雪を積もらせる', 'ドラッグ（雪原の外）— 視点回転', 'ピンチ / ホイール — ズーム'],
    hint: 'なぞると雪に跡がつく',
    gridHint: 'なぞると雪に跡がつく',
    create: createSnow,
  },
  {
    id: 'postfx',
    title: 'ポスト処理実験室',
    subtitle: 'POST-PROCESSING LAB',
    category: 'スタイライズ',
    tech: ['ブルーム', '被写界深度', '色収差', 'ハーフトーン'],
    description:
      '同じ列柱のシーンに6種類のポストエフェクトを掛け替える実験室。シーンを一度テクスチャに描き、ミップマップを使ったブルームや深度バッファ由来の被写界深度など、撮影後の「現像」で画がどう変わるかを比べられます。',
    techDetail: [
      'ミップマップ合成による軽量ブルーム / ミップぼかしDOF',
      '深度テクスチャの線形化とCoC計算',
      'ハーフトーン網点・ピクセル化・色収差 + グレイン',
    ],
    controls: ['タップ — エフェクト切替（6種）', '上下に動かす — 強さ / 焦点を調整', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで現像切替 / 上下で調整',
    gridHint: '上下に動かして効果を調整',
    create: createPostfx,
  },
  {
    id: 'mandelbulb',
    title: 'マンデルバルブ',
    subtitle: '3D FRACTAL',
    category: 'プロシージャル',
    tech: ['距離推定レイマーチ', 'オービットトラップ', '次数モーフ'],
    description:
      'マンデルブロ集合を3次元へ拡張したフラクタル「Mandelbulb」。距離推定関数によるスフィアトレーシングで、無限に続く自己相似の断崖を描きます。タップで次数がゆっくり変異し、まったく別の生物のような姿に変わります。',
    techDetail: [
      '球面座標のべき乗反復による距離推定（DE）',
      'オービットトラップでの色付けとステップ数AO',
      '次数 8 → 5 → 3.2 → 12 の連続モーフ',
    ],
    controls: ['ドラッグ — 視点を回転', 'タップ — 次数を変異させる', 'ピンチ / ホイール — 接近（ズーム）'],
    hint: 'タップで変異 / ズームで接近',
    gridHint: 'ドラッグで視点を回す',
    create: createMandelbulb,
  },
  {
    id: 'morph',
    title: 'かたちの補間',
    subtitle: 'MORPH TARGETS',
    category: 'アニメーション',
    tech: ['モーフターゲット', 'GPU頂点ブレンド', '法線モーフ'],
    description:
      '球・スパイク・キューブ・ツイストの間を連続補間するモーフターゲット（ブレンドシェイプ）。頂点位置と法線の両方をGPUで混ぜ合わせるため、中間形状でも陰影が破綻しません。ポインタの位置がそのままブレンド空間になります。',
    techDetail: [
      '3ターゲットの morphAttributes.position / normal',
      'ブレンド空間（三角配置）の重み計算',
      'ターゲット形状は数式で手続き生成',
    ],
    controls: ['動かす — ブレンド比を操作', 'タップ — 自動 / 手動を切替', 'ピンチ / ホイール — ズーム'],
    hint: '動かして形をブレンド',
    gridHint: '動かして形をブレンド',
    create: createMorph,
  },
  {
    id: 'lsystem',
    title: '生成される樹',
    subtitle: 'L-SYSTEM GROWTH',
    category: 'プロシージャル',
    tech: ['L-system', 'タートル解釈', '成長アニメーション'],
    description:
      '再帰的な置換規則（L-system）が生む樹木を、根元から梢へと成長アニメーションで芽吹かせます。桜・紅葉・若木の3種はどれも同じ規則の角度と減衰率を変えただけ——タップするたび違う一本が生えてきます。',
    techDetail: [
      'クォータニオンタートルによる3D枝分かれ解釈',
      '深さ順の出生時刻で枝と葉をスケールイン',
      '約3,000本の枝をInstancedMeshで一括描画 + 花びら',
    ],
    controls: ['タップ — 別の樹を生やす（桜 / 紅葉 / 若木）', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで植え替え',
    gridHint: 'タップで別の樹を生やす',
    create: createLSystem,
  },
  {
    id: 'audioviz',
    title: '音の彫刻',
    subtitle: 'AUDIO REACTIVE',
    category: 'スタイライズ',
    tech: ['WebAudio合成', 'FFT解析', 'キック検出'],
    description:
      '音源ファイルを使わず、WebAudioのオシレーターだけでローファイなループをその場で生成。FFTで周波数スペクトラムを解析し、96本のリングが音に呼応して踊ります。低域の立ち上がりを検出して、キックの瞬間だけオーブが脈打ちます。',
    techDetail: [
      'ルックアヘッドスケジューラの生成音楽（キック/ハット/ベース/プラック）',
      'AnalyserNode の周波数ビンを対数マッピング',
      '低域エネルギー微分によるキック検出と発光',
    ],
    controls: ['タップ — 演奏を開始 / 停止', 'ドラッグ — 視点を回転', 'ピンチ / ホイール — ズーム'],
    hint: 'タップで演奏スタート ♪',
    gridHint: 'タップで演奏スタート ♪',
    create: createAudioViz,
  },
];

const CATEGORIES = [
  'すべて',
  'マテリアル',
  'ライティング',
  'シミュレーション',
  'プロシージャル',
  'アニメーション',
  'スタイライズ',
] as const;

function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  let engine: Engine;
  try {
    engine = new Engine(canvas);
  } catch (err) {
    console.error('[LUMINA] WebGL2 を初期化できませんでした:', err);
    const notice = document.createElement('p');
    notice.id = 'gl-fallback';
    notice.textContent =
      'このブラウザでは WebGL2 を初期化できませんでした。ハードウェアアクセラレーションを有効にするか、最新の Chrome / Edge / Firefox / Safari でお試しください。';
    document.getElementById('grid')!.replaceWith(notice);
    return;
  }

  const grid = document.getElementById('grid')!;
  const slots = new Map<string, Slot>();
  const cards = new Map<string, HTMLElement>();

  for (const def of DEMOS) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = def.id;
    card.dataset.category = def.category;

    const view = document.createElement('div');
    view.className = 'card-view';
    view.tabIndex = 0;
    view.setAttribute('role', 'button');
    view.setAttribute('aria-label', `${def.title}を拡大表示`);
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'LOADING';
    view.appendChild(loading);
    card.appendChild(view);

    const tech = document.createElement('div');
    tech.className = 'card-tech';
    for (const tc of def.tech) {
      const chip = document.createElement('span');
      chip.className = 'tech-chip';
      chip.textContent = tc;
      tech.appendChild(chip);
    }
    card.appendChild(tech);

    const expand = document.createElement('button');
    expand.className = 'card-expand';
    expand.title = '全画面で見る';
    expand.setAttribute('aria-label', `${def.title}を全画面で見る`);
    expand.innerHTML = '⤢';
    card.appendChild(expand);

    // 図録のキャプション板（ライブ描画の下に置き、映像には一切かぶせない）
    const plate = document.createElement('div');
    plate.className = 'card-plate';
    plate.innerHTML = `
      <div class="plate-head">
        <h3 class="card-title">${def.title}</h3>
        <span class="card-cat">${def.category}</span>
      </div>
      <p class="card-sub">${def.subtitle}</p>
      <p class="card-hint">
        <span class="hint-drag">${def.gridHint}</span>
        <span class="hint-open">クリックで拡大</span>
      </p>
    `;
    card.appendChild(plate);

    grid.appendChild(card);
    const slot = engine.register(def, view);
    slots.set(def.id, slot);
    cards.set(def.id, card);

    expand.addEventListener('click', (e) => {
      e.stopPropagation();
      void openFullscreen(slot);
    });
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void openFullscreen(slot);
      }
    });
  }

  // カードのタップ（ドラッグを伴わないクリック）で全画面表示を開く
  engine.onCardTap = (slot) => {
    void openFullscreen(slot);
  };

  // ---------- フィルタ ----------
  const filterBar = document.getElementById('filter-bar')!;
  let activeFilter: string = 'すべて';
  for (const cat of CATEGORIES) {
    const n = cat === 'すべて' ? DEMOS.length : DEMOS.filter((d) => d.category === cat).length;
    const b = document.createElement('button');
    b.className = 'filter-chip' + (cat === 'すべて' ? ' active' : '');
    b.innerHTML = `${cat}<span class="count">${n}</span>`;
    b.addEventListener('click', () => {
      activeFilter = cat;
      filterBar.querySelectorAll('.filter-chip').forEach((el) => el.classList.remove('active'));
      b.classList.add('active');
      for (const def of DEMOS) {
        const show = cat === 'すべて' || def.category === cat;
        cards.get(def.id)!.classList.toggle('hidden-by-filter', !show);
      }
    });
    filterBar.appendChild(b);
  }

  // ---------- 計器 ----------
  document.getElementById('stat-demos')!.textContent = String(DEMOS.length);
  document.getElementById('stat-cats')!.textContent = String(CATEGORIES.length - 1);
  const fpsNum = document.querySelector('#stat-fps .num')!;
  engine.onFps = (fps) => {
    fpsNum.textContent = String(Math.round(fps));
  };

  // ---------- 全画面 ----------
  const backdrop = document.getElementById('fs-backdrop')!;
  const fsUi = document.getElementById('fs-ui')!;
  const fsView = document.getElementById('fs-view')!;
  const fsTitle = document.getElementById('fs-title')!;
  const fsSubtitle = document.getElementById('fs-subtitle')!;
  const fsCategory = document.getElementById('fs-category')!;
  const fsDesc = document.getElementById('fs-desc')!;
  const fsTech = document.getElementById('fs-tech')!;
  const fsControls = document.getElementById('fs-controls')!;
  const fsHint = document.createElement('div');
  fsHint.id = 'fs-hint';
  fsUi.appendChild(fsHint);

  let fsSlot: Slot | null = null;
  engine.attachPointer(fsView as HTMLElement, () => fsSlot);

  const visibleDefs = () =>
    DEMOS.filter((d) => activeFilter === 'すべて' || d.category === activeFilter);

  async function openFullscreen(slot: Slot) {
    fsSlot = slot;
    const def = slot.def;
    document.body.classList.add('fs-mode');
    backdrop.hidden = false;
    fsUi.hidden = false;
    fsUi.classList.toggle('panel-hidden', window.innerWidth < 720);
    fsCategory.textContent = def.category;
    fsTitle.textContent = def.title;
    fsSubtitle.textContent = def.subtitle;
    fsDesc.textContent = def.description;
    fsTech.innerHTML = def.techDetail.map((t) => `<li>${t}</li>`).join('');
    fsControls.innerHTML = def.controls.map((t) => `<li>${t}</li>`).join('');
    fsHint.textContent = def.hint;
    history.replaceState(null, '', `#${def.id}`);

    if (slot.initState !== 'ready') {
      fsHint.textContent = '読み込み中…';
      await engine.ensureInit(slot);
      if (fsSlot !== slot) return;
      fsHint.textContent = def.hint;
    }
    engine.setFullscreen(slot);
  }

  function closeFullscreen() {
    fsSlot = null;
    engine.setFullscreen(null);
    document.body.classList.remove('fs-mode');
    backdrop.hidden = true;
    fsUi.hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    // ギャラリーへ戻るときは各カードを初期状態から再構築する
    engine.resetAllDemos();
  }

  function nav(dir: 1 | -1) {
    if (!fsSlot) return;
    const defs = visibleDefs();
    const i = defs.findIndex((d) => d.id === fsSlot!.def.id);
    const next = defs[(i + dir + defs.length) % defs.length];
    void openFullscreen(slots.get(next.id)!);
  }

  document.getElementById('fs-close')!.addEventListener('click', closeFullscreen);
  document.getElementById('fs-prev')!.addEventListener('click', () => nav(-1));
  document.getElementById('fs-next')!.addEventListener('click', () => nav(1));
  document.getElementById('fs-info-toggle')!.addEventListener('click', () => {
    fsUi.classList.toggle('panel-hidden');
  });
  window.addEventListener('keydown', (e) => {
    if (!fsSlot) return;
    if (e.key === 'Escape') closeFullscreen();
    if (e.key === 'ArrowLeft') nav(-1);
    if (e.key === 'ArrowRight') nav(1);
  });

  engine.start();

  // ディープリンク
  const hash = location.hash.slice(1);
  if (hash && slots.has(hash)) {
    void openFullscreen(slots.get(hash)!);
  }
}

boot();
