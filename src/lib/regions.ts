// 都道府県一覧を地方ごとに並べるための区分（キーは都道府県コード2桁の範囲）
export const REGIONS = [
  { name: '北海道・東北', codes: ['01', '02', '03', '04', '05', '06', '07'] },
  { name: '関東', codes: ['08', '09', '10', '11', '12', '13', '14'] },
  { name: '中部', codes: ['15', '16', '17', '18', '19', '20', '21', '22', '23'] },
  { name: '近畿', codes: ['24', '25', '26', '27', '28', '29', '30'] },
  { name: '中国', codes: ['31', '32', '33', '34', '35'] },
  { name: '四国', codes: ['36', '37', '38', '39'] },
  { name: '九州・沖縄', codes: ['40', '41', '42', '43', '44', '45', '46', '47'] },
] as const;

export function groupByRegion<T extends { code: string }>(prefs: T[]): { name: string; prefs: T[] }[] {
  return REGIONS.map((region) => ({
    name: region.name,
    prefs: prefs.filter((p) => (region.codes as readonly string[]).includes(p.code)),
  }));
}

/** 「茨城県」→「茨城」（北海道はそのまま）。トップの地域の一覧で使う */
export function shortPrefName(name: string): string {
  return name === '北海道' ? name : name.replace(/[都府県]$/, '');
}
