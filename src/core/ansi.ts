/** ANSI 颜色 / 宽度对齐 / 进度条 / 数值格式化(与 abyss/ansi.py 语义一致) */
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";

const FG: Record<string, number> = {
  black: 30, red: 31, green: 32, yellow: 33,
  blue: 34, magenta: 35, cyan: 36, white: 37,
  bright_black: 90, bright_red: 91, bright_green: 92,
  bright_yellow: 93, bright_blue: 94, bright_magenta: 95,
  bright_cyan: 96, bright_white: 97,
};
const BG: Record<string, number> = Object.fromEntries(
  Object.entries(FG).map(([k, v]) => [k, v + 10]));

export type Color = keyof typeof FG | "";

export function c(text: string | number, fg?: Color, bg?: Color, bold = false): string {
  const parts: string[] = [];
  if (bold) parts.push(BOLD);
  if (fg && FG[fg]) parts.push(`\x1b[${FG[fg]}m`);
  if (bg && BG[bg]) parts.push(`\x1b[${BG[bg]}m`);
  if (!parts.length) return String(text);
  return parts.join("") + String(text) + RESET;
}

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function charWidth(ch: string): number {
  const o = ch.codePointAt(0)!;
  if ((o >= 0x1100 && o <= 0x115f) || (o >= 0x2e80 && o <= 0xa4cf)
    || (o >= 0xac00 && o <= 0xd7a3) || (o >= 0xf900 && o <= 0xfaff)
    || (o >= 0xfe10 && o <= 0xfe19) || (o >= 0xfe30 && o <= 0xfe6f)
    || (o >= 0xff00 && o <= 0xff60) || (o >= 0xffe0 && o <= 0xffe6)) {
    return 2;
  }
  return 1;
}

export function dwidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch);
  return w;
}

export function pad(s: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const gap = width - dwidth(s);
  if (gap <= 0) return s;
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
}

export function trunc(s: string, width: number): string {
  let out = "", w = 0, inEsc = false;
  for (const ch of s) {
    if (ch === "\x1b") { inEsc = true; out += ch; continue; }
    if (inEsc) {
      out += ch;
      if (/[a-zA-Z]/.test(ch)) inEsc = false;
      continue;
    }
    const cw = charWidth(ch);
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  if (inEsc) out += RESET;
  return out;
}

export function hpColor(pct: number): Color {
  return pct > 0.5 ? "green" : pct > 0.25 ? "yellow" : "red";
}

export function bar(cur: number, mx: number, width: number, color: Color): string {
  if (mx <= 0) mx = 1;
  cur = Math.max(0, Math.min(cur, mx));
  const filled = Math.round(width * cur / mx);
  return c("█".repeat(filled), color, "", true)
    + c("░".repeat(width - filled), "bright_black");
}

export function fmt(n: number): string {
  const neg = n < 0;
  n = Math.abs(n);
  const units: [number, string][] = [
    [1e16, "京"], [1e12, "兆"], [1e8, "亿"], [1e4, "万"],
  ];
  for (const [div, suf] of units) {
    if (n >= div) {
      let s = (n / div).toFixed(2);
      s = s.replace(/0+$/, "").replace(/\.$/, "");
      return (neg ? "-" : "") + s + suf;
    }
  }
  return (neg ? "-" : "") + String(Math.round(n));
}

export function fmtTime(sec: number): string {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
