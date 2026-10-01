/** CLI/网页宿主共用的呈现层状态(与 abyss/view.py 一致) */
export interface UIFlags {
  tab: number; bag_sel: number; forge_sel: number; skill_sel: number;
  char_sel: number; skill_zone: number; skill_slot: number;
  paused: boolean; help: boolean; confirm_reset: boolean; quests_sel: number;
}

export interface Floater { text: string; color: string; ttl: number }

export const LOG_CAP = 60;
export const FLOATER_CAP = 5;
export const FLOATER_TTL = 1.2;
export const TOAST_TTL = 2.0;
export const BUMP_TTL = 0.24;
export const FLASH_TTL = 0.15;

export class View {
  ui: UIFlags = {
    tab: 0, bag_sel: 0, forge_sel: 0, skill_sel: 0, char_sel: 0,
    skill_zone: 1, skill_slot: 0,
    paused: false, help: false, confirm_reset: false, quests_sel: 0,
  };
  logbuf: [string, string][] = [];
  floaters: Floater[] = [];
  toast = "";
  toastTtl = 0;
  heroBump = 0;
  mobBump = 0;
  mobFlash = 0;

  drain(g: any): void {
    for (const [kind, text, color] of g.events) {
      if (kind === "log") {
        this.logbuf.push([text, color]);
        if (this.logbuf.length > LOG_CAP) this.logbuf.shift();
      } else if (kind === "floater") {
        this.floaters.push({ text, color, ttl: FLOATER_TTL });
        if (this.floaters.length > FLOATER_CAP) this.floaters.shift();
      } else if (kind === "toast") {
        this.toast = text;
        this.toastTtl = TOAST_TTL;
      } else if (kind === "anim") {
        if (text === "hero_attack") this.heroBump = BUMP_TTL;
        else if (text === "mob_attack") this.mobBump = BUMP_TTL;
        else if (text === "mob_flash") this.mobFlash = FLASH_TTL;
      }
    }
    g.events.length = 0;
  }

  tick(dt: number): void {
    if (this.toastTtl > 0) {
      this.toastTtl -= dt;
      if (this.toastTtl <= 0) this.toast = "";
    }
    this.floaters = this.floaters.filter(f => (f.ttl -= dt) > 0);
    this.heroBump = Math.max(0, this.heroBump - dt);
    this.mobBump = Math.max(0, this.mobBump - dt);
    this.mobFlash = Math.max(0, this.mobFlash - dt);
  }
}
