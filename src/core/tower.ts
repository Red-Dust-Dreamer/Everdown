/** 爬塔副本:独立怪物曲线 / 进层 / 结算 / 钥匙管理(与 abyss/tower.py 一致) */
import type { Color } from "./ansi.ts";
import { Monster, mobGold } from "./combat.ts";
import { ART, MONSTERS, TOWER } from "./data.ts";
import { rollRelic } from "./relics.ts";
import type { Relic } from "./relics.ts";
import type { PyRandom } from "./rng.ts";

/** 塔进度(存档持久) */
export interface TowerState {
  keys: number;
  max_floor: number;
  /** ISO 日期串 YYYY-MM-DD(本地时区) */
  last_refresh: string | null;
}

/** 塔系怪物:独立曲线,每 boss_every 层一个头目 */
export function towerMonster(floor: number, rng: PyRandom): Monster {
  const t = TOWER;
  const boss = floor % t.boss_every === 0;
  // 从全局怪物池随机(视觉多样性)
  const keys = Object.keys(MONSTERS);
  const key = rng.choice(keys);
  const mob = MONSTERS[key];
  let name: string = mob.name;
  let color: Color = mob.color;

  let hp = t.th0 + t.thk * Math.pow(floor, t.thp);
  let atk = t.ta0 + t.tak * Math.pow(floor, t.tap);
  const dfn = t.td0 + t.tdk * Math.pow(floor, t.tdp);
  const interval = 1.6;

  if (boss) {
    hp *= 3.0;
    atk *= 1.3;
    color = "bright_yellow";
    name = `塔·${name}`;
  }
  return new Monster(name, ART[key], color, hp, atk, dfn, interval, boss, false, floor, null);
}

/** 1-10关 → tier 10, 11-20关 → tier 20 ... */
export function towerRelicTier(floor: number): number {
  return (Math.floor((floor - 1) / 10) + 1) * 10;
}

/** 塔金币(相对主线同 tier 怪 × drop_gold_mult) */
export function towerGold(floor: number): number {
  const t = towerRelicTier(floor);
  return mobGold(t) * TOWER.drop_gold_mult;
}

/** 塔掉落:必掉 1 件遗物,头目层保底稀有 */
export function rollTowerDrop(floor: number, rng: PyRandom, _luck = 0): Relic {
  const boss = floor % TOWER.boss_every === 0;
  const minIdx = boss ? 2 : 0;
  const tier = towerRelicTier(floor);
  return rollRelic(tier, rng, minIdx);
}

/** 本地日期串(与 Python datetime.fromtimestamp().date() 同口径) */
function localDateStr(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 两个 ISO 日期串(Y-M-D)的日差(均按 UTC 零点解析,日历日差) */
function isoDays(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
}

/** 每天刷新钥匙(可囤积,上限 keys_cap)。返回获得数。 */
export function refreshKeys(towerState: TowerState, nowTs: number): number {
  const today = localDateStr(nowTs);
  const last = towerState.last_refresh;
  if (last === null) {
    towerState.last_refresh = today;
    towerState.keys = TOWER.keys_per_day;
    return TOWER.keys_per_day;
  }
  const days = isoDays(today, last);
  if (days <= 0) return 0;
  const gained = Math.min(days * TOWER.keys_per_day, TOWER.keys_cap - towerState.keys);
  towerState.keys = Math.min(towerState.keys + gained, TOWER.keys_cap);
  towerState.last_refresh = today;
  return gained;
}
