// 業種タグの体系（説明は docs/GYOSHU.md）
//
// サイト（Astro）と取得スクリプト（scripts/*.mjs。Node 26 の型除去で .ts を直接 import）の両方から使う。
// そのため型注釈以外の TypeScript 固有構文（enum など）は使わない。
//
// keywords は件名（NFKC 正規化後）に対する部分一致。categories は、その種別（API の Category）の案件にだけ
// キーワード判定を適用するという意味（種別が空の案件にはすべて適用する）。AI が付けるタグには categories の制約はない。

export type GyoshuCategory = 'koji' | 'buppin' | 'ekimu';

export type Gyoshu = {
  slug: string;
  label: string;
  description: string;
  categories: readonly GyoshuCategory[];
  keywords: readonly string[];
};

export const GYOSHU = [
  // ── 工事 ──
  {
    slug: 'doboku',
    label: '土木・舗装工事',
    description: '道路・舗装・河川・橋梁・上下水道管・港湾・林道などの土木工事',
    categories: ['koji'],
    keywords: ['道路', '舗装', '河川', '橋', '護岸', '砂防', '水路', '側溝', '管渠', '管路', '下水道', '上水道', '配水管', '送水管', '法面', '堤防', '土木', '治山', '林道', '漁港', '港湾', '浚渫', '擁壁', '農道', '用水路', '排水路', '災害復旧', '造成', '地盤改良', '管更生', '老朽管', '汚水', '給水管', '重給管', '舗装'],
  },
  {
    slug: 'kenchiku',
    label: '建築工事',
    description: '庁舎・学校・住宅などの新築・増改築・改修・解体、屋根・外壁・内装・塗装・防水',
    categories: ['koji'],
    keywords: ['建築', '新築', '増築', '改築', '解体', '屋根', '外壁', '防水', '内装', '塗装', 'トイレ改修', '耐震', '校舎', '体育館', '庁舎', '住宅', '改修工事'],
  },
  {
    slug: 'denki',
    label: '電気・通信工事',
    description: '電気設備・照明（LED化）・受変電・通信・放送設備・太陽光発電設備の工事',
    categories: ['koji'],
    keywords: ['電気', '照明', 'LED', '受変電', '変電', '通信設備', '放送設備', '防災無線', '太陽光', '自家発電', '発電機', '信号', '電灯', '非常灯', '防犯カメラ'],
  },
  {
    slug: 'setsubi-koji',
    label: '管・空調設備工事',
    description: '給排水・衛生・空調・冷暖房・ボイラー・消防設備などの設備工事',
    categories: ['koji'],
    keywords: ['空調', '給排水', '衛生設備', '管工事', 'ボイラー', '冷暖房', '配管', '換気', '消防設備', 'ポンプ', '浄化槽', '機械設備', 'エレベーター', '昇降機', '中央監視'],
  },
  {
    slug: 'zoen',
    label: '造園・草刈り・樹木管理',
    description: '造園・植栽・剪定・伐採・除草・草刈り・公園や緑地の維持管理、森林の整備（造林・間伐）',
    categories: ['koji', 'ekimu'],
    keywords: ['造園', '植栽', '剪定', '草刈', '除草', '樹木', '伐採', '緑地', '芝', '花壇', '公園維持', '森林', '造林', '間伐', '下刈', '植林'],
  },
  // ── 役務 ──
  {
    slug: 'sokuryo-sekkei',
    label: '測量・設計',
    description: '測量、建設工事の設計・監理、地質調査、用地・補償調査',
    categories: ['ekimu', 'koji'],
    keywords: ['測量', '設計業務', '設計委託', '実施設計', '基本設計', '詳細設計', '地質調査', '用地調査', '補償', '工事監理', '施工管理', '点検診断', '橋梁点検'],
  },
  {
    slug: 'chosa-keikaku',
    label: '調査・計画',
    description: '計画の策定支援、調査・分析、アンケート、評価・検討業務',
    categories: ['ekimu'],
    keywords: ['計画策定', '計画改定', '策定支援', '策定業務', '調査業務', '調査委託', '基礎調査', '実態調査', '意向調査', 'アンケート', '分析', '検討業務', '評価業務', '可能性調査', 'コンサル', '調査研究', '研究', '検討', '解析'],
  },
  {
    slug: 'system',
    label: 'システム開発・運用',
    description: '情報システム・ソフトウェア・Webサイトの開発、運用・保守、クラウド、ネットワーク構築',
    categories: ['ekimu', 'buppin'],
    keywords: ['システム', 'ソフトウェア', 'アプリ', 'クラウド', 'ホームページ', 'ウェブサイト', 'Webサイト', 'DX', 'ネットワーク', 'サーバ', 'データ', 'デジタル', 'RPA', 'AI', 'セキュリティ', 'ツール'],
  },
  {
    slug: 'seiso',
    label: '清掃',
    description: '庁舎・施設の清掃、貯水槽・排水管の清掃、ガラス清掃',
    categories: ['ekimu'],
    keywords: ['清掃', '洗浄', '貯水槽', 'ワックス', '害虫', '消毒'],
  },
  {
    slug: 'keibi',
    label: '警備',
    description: '施設警備・機械警備・交通誘導・イベント警備',
    categories: ['ekimu'],
    keywords: ['警備', '交通誘導', '監視業務'],
  },
  {
    slug: 'hoshu-tenken',
    label: '設備の保守・点検',
    description: '空調・電気・消防・昇降機などの設備や機器の保守・点検・修理',
    categories: ['ekimu'],
    keywords: ['保守', '点検', 'メンテナンス', '修繕', '修理', 'エレベーター', '昇降機', '消防用設備', '定期検査', '運転管理', '性能検査'],
  },
  {
    slug: 'shisetsu-kanri',
    label: '施設管理・運営',
    description: '施設の総合管理・運営、指定管理、駐車場・公園などの管理運営',
    categories: ['ekimu'],
    keywords: ['施設管理', '管理運営', '運営管理', '指定管理', '総合管理', '管理業務', '駐車場'],
  },
  {
    slug: 'haikibutsu',
    label: '廃棄物処理',
    description: '一般・産業廃棄物の収集運搬・処分、リサイクル、し尿・汚泥処理',
    categories: ['ekimu', 'buppin'],
    keywords: ['廃棄物', '収集運搬', '処分', 'リサイクル', 'し尿', '汚泥', 'ごみ', '資源物', '焼却灰', '不用品'],
  },
  {
    slug: 'unso',
    label: '運送・引越し',
    description: '物品の運搬・輸送・配送、庁舎移転・引越し、送迎',
    categories: ['ekimu'],
    keywords: ['運搬', '輸送', '運送', '引越', '移転業務', '配送', '送迎', '運行', '文書交換', '郵便'],
  },
  {
    slug: 'insatsu',
    label: '印刷・製本',
    description: '広報紙・パンフレット・ポスター・報告書・封筒などの印刷・製本',
    categories: ['ekimu', 'buppin'],
    keywords: ['印刷', '製本', '広報紙', 'パンフレット', 'ポスター', '冊子', 'チラシ', 'リーフレット', '封筒', '名刺'],
  },
  {
    slug: 'kouhou',
    label: '広報・イベント',
    description: 'イベントの企画運営、広報・PR、動画制作、広告、普及啓発',
    categories: ['ekimu'],
    keywords: ['イベント', '広報', '動画', 'PR', 'プロモーション', '広告', '啓発', '展示', '番組', '映像', '観光', 'デザイン', '設営', '会場'],
  },
  {
    slug: 'itaku-jimu',
    label: '窓口・事務の委託、人材派遣',
    description: '窓口・受付・コールセンター・事務処理の業務委託、労働者派遣',
    categories: ['ekimu'],
    keywords: ['派遣', '窓口', '受付', 'コールセンター', '事務補助', '事務処理', '入力業務', 'データ入力', '業務支援', 'BPO', '電話'],
  },
  {
    slug: 'kenshu',
    label: '研修・教育',
    description: '職員研修、講座・教室の運営、学習支援、教材',
    categories: ['ekimu', 'buppin'],
    keywords: ['研修', '講座', '教室', 'セミナー', '学習', '教材', '訓練'],
  },
  {
    slug: 'chintai',
    label: '賃貸借・リース',
    description: '機器・車両・建物などの賃貸借、リース、レンタル',
    categories: ['ekimu', 'buppin'],
    keywords: ['賃貸借', 'リース', 'レンタル', '借上', '借入'],
  },
  // ── 物品 ──
  {
    slug: 'jimu',
    label: '事務用品・家具',
    description: '文房具・コピー用紙・トナー・事務机・椅子・書庫などの事務用品と什器',
    categories: ['buppin'],
    keywords: ['事務用品', '文具', '文房具', '用紙', 'トナー', '机', '椅子', '家具', '什器', '書庫', 'ロッカー', 'カーテン', 'デスク', 'チェア', 'シュレッダー'],
  },
  {
    slug: 'it-kiki',
    label: 'パソコン・IT機器',
    description: 'パソコン・タブレット・サーバ・プリンタ・複合機・ネットワーク機器・ソフトウェアライセンス',
    categories: ['buppin'],
    keywords: ['パソコン', 'PC', 'タブレット', 'サーバ', 'プリンタ', '複合機', '端末', 'ライセンス', 'ディスプレイ', 'モニタ', 'ネットワーク機器', '電子計算機'],
  },
  {
    slug: 'iryo',
    label: '医療・医薬品',
    description: '医薬品・試薬・医療機器・診療材料・衛生材料',
    categories: ['buppin', 'ekimu'],
    keywords: ['医薬品', '医療', '診療', '試薬', '薬品', '衛生材料', 'ワクチン', '検診', '健診', '病院', '透析', '手術', '呼吸器', '患者', '看護'],
  },
  {
    slug: 'shokuhin',
    label: '食料品・給食',
    description: '食材・給食・米・牛乳・弁当などの食料品',
    categories: ['buppin', 'ekimu'],
    keywords: ['食料', '食材', '給食', '精米', '米穀', '牛乳', '弁当', '食品', '調理', '飲料', '非常食', '玄米'],
  },
  {
    slug: 'nenryo',
    label: '燃料・電力',
    description: 'ガソリン・灯油・重油・LPガス、電力・ガスの供給',
    categories: ['buppin', 'ekimu'],
    keywords: ['燃料', 'ガソリン', '灯油', '軽油', '重油', '電力', '電気需給', '電気供給', 'ガス供給', 'LPガス', 'プロパン', 'ガス'],
  },
  {
    slug: 'sharyo',
    label: '車両',
    description: '公用車・消防車・救急車・バス・作業車などの車両、船舶',
    categories: ['buppin'],
    keywords: ['車両', '自動車', '消防車', 'ポンプ車', '救急車', 'バス', 'トラック', '軽自動車', 'ダンプ', '船舶', '除雪車', '公用車'],
  },
  {
    slug: 'kiki',
    label: '機械・器具・備品',
    description: '各種の機械・装置・測定器・理化学機器・備品の購入',
    categories: ['buppin'],
    keywords: ['機器', '装置', '機械', '器具', '測定', '分析装置', '備品', '購入', '顕微鏡', '空気清浄', 'エアコン', '冷蔵庫', '洗濯機'],
  },
  {
    slug: 'seifuku',
    label: '被服・寝具',
    description: '制服・作業服・防寒着・寝具・タオルなどの繊維製品',
    categories: ['buppin'],
    keywords: ['被服', '制服', '作業服', '防寒', '寝具', '布団', 'タオル', '靴', '活動服', '雨衣', '看護衣', '白衣'],
  },
  {
    slug: 'tosho',
    label: '図書・新聞',
    description: '図書・書籍・新聞・雑誌・データベース・地図などの資料',
    categories: ['buppin'],
    keywords: ['図書', '書籍', '新聞', '雑誌', '追録', '地図', '教科書', 'ジャーナル', 'Clinical'],
  },
  {
    slug: 'bosai',
    label: '防災・消防用品',
    description: '防災備蓄品・消防用資機材・救助用具・防犯用品',
    categories: ['buppin'],
    keywords: ['防災', '備蓄', '消防', '救助', '防犯', '消火', '避難', '発電機'],
  },
] as const satisfies readonly Gyoshu[];

export type GyoshuSlug = (typeof GYOSHU)[number]['slug'];

/**
 * 検索ページの「よく探されることば」。業種のキーワード（上の keywords）から、中小企業が探しやすい語を選んだ固定の一覧。
 * 実際の検索回数は記録していない（検索の記録はサーバーに残さない）
 */
export const POPULAR_KEYWORDS = ['清掃', '警備', '草刈', '印刷', '測量', 'システム', '給食', '修繕', 'パソコン', '廃棄物'] as const;

export function findGyoshu(slug: string): Gyoshu | undefined {
  return GYOSHU.find((g) => g.slug === slug);
}

export function gyoshuLabel(slug: string): string {
  return findGyoshu(slug)?.label ?? slug;
}

/** キーワード判定で付けるタグの最大数 */
const MAX_RULE_TAGS = 3;

/**
 * 件名から業種タグを推定する（キーワードの部分一致）。
 * 先に一致したもの（GYOSHU の並び順）を優先し、最大 MAX_RULE_TAGS 個。
 */
export function classifyByKeywords(projectName: string, category: string | null): string[] {
  const name = projectName.normalize('NFKC');
  const tags: string[] = [];
  for (const g of GYOSHU) {
    if (category && !(g.categories as readonly string[]).includes(category)) continue;
    if (g.keywords.some((k) => name.includes(k))) tags.push(g.slug);
    if (tags.length >= MAX_RULE_TAGS) break;
  }
  return tags;
}
