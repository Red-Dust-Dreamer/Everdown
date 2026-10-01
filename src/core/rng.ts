/**
 * CPython random.Random 的逐位兼容实现(MT19937)。
 *
 * 移植自 CPython Modules/_randommodule.c:
 * - seed(n):abs(n) 按 32 位小端字拆分 → init_by_array
 * - random():genrand_res53(两个 32 位输出构造 53 位浮点)
 * - getrandbits(k) k<=32:genrand() >> (32-k) 取高 k 位
 * - _randbelow(n):k=n 位数,getrandbits(k) 拒绝采样直到 < n
 * - randrange/choice 走 _randbelow;uniform(a,b)=a+(b-a)*random()
 * - shuffle:从尾到头 j=_randbelow(i+1) 交换
 *
 * 目的:同 seed 下与 Python 版(abyss/)逐位一致,支撑移植对拍。
 */
const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class PyRandom {
  private mt = new Uint32Array(N);
  private index = N + 1; // 未初始化标记(本实现构造即播种,不会读到)

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(n: number): void {
    const s = Math.abs(Math.floor(n));
    // key = s 的 32 位小端字
    const key: number[] = [];
    let v = s;
    if (v === 0) key.push(0);
    while (v > 0) {
      key.push(v % 4294967296);
      v = Math.floor(v / 4294967296);
    }
    this.initByArray(key);
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    // init_genrand(19650218)
    mt[0] = 19650218;
    for (let i = 1; i < N; i++) {
      mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    }
    let i = 1;
    let j = 0;
    let k = Math.max(N, key.length);
    for (; k; k--) {
      // 32 位乘法必须用 Math.imul(普通乘法超 Number 精度)
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j;
      mt[i] = mt[i] >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i;
      mt[i] = mt[i] >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
    this.index = N;
  }

  private genrandUint32(): number {
    const mt = this.mt;
    if (this.index >= N) {
      // 生成下一批
      for (let i = 0; i < N - M; i++) {
        const y = (mt[i] & UPPER_MASK) | (mt[i + 1] & LOWER_MASK);
        mt[i] = mt[i + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (let i = N - M; i < N - 1; i++) {
        const y = (mt[i] & UPPER_MASK) | (mt[i + 1] & LOWER_MASK);
        mt[i] = mt[i + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      const y = (mt[N - 1] & UPPER_MASK) | (mt[0] & LOWER_MASK);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random() — 53 位浮点 */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  /** getrandbits(k),0 < k <= 32 */
  getrandbits(k: number): number {
    if (k <= 0 || k > 32) throw new Error("getrandbits: 0<k<=32");
    const r = this.genrandUint32();
    return k === 32 ? r : r >>> (32 - k);
  }

  /** _randbelow(n) */
  private randbelow(n: number): number {
    let k = 1;
    while (1 << k <= n && k < 32) k++;
    // 上面得到 n 的位宽(等价 n.bit_length())
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** randrange(n) → [0, n) */
  randrange(n: number): number {
    return this.randbelow(n);
  }

  /** choice(arr) */
  choice<T>(arr: readonly T[]): T {
    return arr[this.randbelow(arr.length)];
  }

  /** uniform(a, b) */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** shuffle(arr) — 原地,Fisher-Yates(与 CPython 一致) */
  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }
}
