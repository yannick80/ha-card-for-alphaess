/**
 * Card for AlphaESS Modbus – a Home Assistant dashboard card for AlphaESS
 * inverters connected through the AlphaESS Modbus TCP integration
 * (https://github.com/senalse/ha-alphaess-modbus). Not affiliated with
 * Alpha ESS Co., Ltd.
 * https://github.com/yannick80/ha-card-for-alphaess
 *
 * Plain custom element, no build step and no dependencies. Pick the inverter
 * device and the card finds its sensors on its own (translation_key, entity ID
 * suffix or the integration's English sensor name, in that order).
 */

(function () {
"use strict";

const VERSION = "0.1.0";
const DOMAIN = "alphaess_modbus";
const CARD = "alphaess-card";

// How each role is found on the device. `key` = translation_key,
// `suffix` = end of the generated object ID, `name` = the integration's
// English entity name (end of the friendly name).
const LOOKUP = {
  pv_power: { suffix: "current_pv_production", name: "current pv production" },
  load_power: { suffix: "current_house_load", name: "current house load" },
  grid_power: { suffix: "grid_power", name: "grid power" },
  battery_power: { suffix: "battery_power", name: "battery power" },
  battery_soc: { suffix: "battery_state_of_charge", name: "battery state of charge" },
  pv_today: { key: "today_pv_generation", suffix: "today_s_pv_generation" },
  grid_import_today: { key: "today_energy_from_grid", suffix: "today_s_energy_from_grid" },
  grid_export_today: { key: "today_energy_feed_to_grid", suffix: "today_s_energy_feed_to_grid" },
  battery_charge_today: { key: "today_battery_charged", suffix: "today_s_battery_charged" },
  battery_discharge_today: { key: "today_battery_discharged", suffix: "today_s_battery_discharged" },
};
const ROLES = Object.keys(LOOKUP);
const EMPTY = new Set(["", "unknown", "unavailable", "none", "null"]);

const COLORS = {
  solar: "var(--energy-solar-color, #ff9800)",
  home: "var(--primary-color, #03a9f4)",
  import: "var(--energy-grid-consumption-color, #488fc2)",
  export: "var(--energy-grid-return-color, #8353d1)",
  charge: "var(--success-color, #43a047)",
  discharge: "var(--error-color, #db4437)",
  idle: "var(--disabled-color, var(--disabled-text-color, #9e9e9e))",
};

const STRINGS = {
  de: {
    solar: "Erzeugung",
    home: "Verbrauch",
    grid: "Netz",
    importing: "Netzbezug",
    exporting: "Einspeisung",
    battery: "Akku",
    charging: "Akku lädt",
    discharging: "Akku entlädt",
    today: "Heute",
    pv_today: "PV",
    import_today: "Bezug",
    export_today: "Einspeisung",
    autarky: "Autarkie",
    no_device: "Kein AlphaESS-Gerät ausgewählt",
    device_missing: "Gerät nicht gefunden",
    no_sensors: "Keine Sensoren der AlphaESS-Integration gefunden",
    editor: {
      device: "Wechselrichter",
      invert_battery: "Akku: positiver Wert = Laden",
      show_today: "Tageswerte anzeigen",
      show_autarky: "Autarkie anzeigen",
      idle_threshold: "Ruheschwelle (W)",
    },
  },
  en: {
    solar: "Solar",
    home: "Home",
    grid: "Grid",
    importing: "Importing",
    exporting: "Exporting",
    battery: "Battery",
    charging: "Charging",
    discharging: "Discharging",
    today: "Today",
    pv_today: "Solar",
    import_today: "Import",
    export_today: "Export",
    autarky: "Self-sufficiency",
    no_device: "No AlphaESS device selected",
    device_missing: "Device not found",
    no_sensors: "No sensors of the AlphaESS integration found",
    editor: {
      device: "Inverter",
      invert_battery: "Battery: positive value = charging",
      show_today: "Show today's energy",
      show_autarky: "Show self-sufficiency",
      idle_threshold: "Idle threshold (W)",
    },
  },
};

function strings(hass) {
  const lang = (hass && hass.locale && hass.locale.language) || (hass && hass.language) || "en";
  return String(lang).toLowerCase().indexOf("de") === 0 ? STRINGS.de : STRINGS.en;
}

// Number locale following the user's Home Assistant profile setting
function numberLocale(hass) {
  const l = (hass && hass.locale) || {};
  const lang = l.language || (hass && hass.language) || "en";
  switch (l.number_format) {
    case "comma_decimal": return "en-US";
    case "decimal_comma": return "de";
    case "space_comma": return "fr";
    case "system": return undefined;
    default: return lang;
  }
}

function fmtNum(hass, value, digits) {
  const grouping = !(hass && hass.locale && hass.locale.number_format === "none");
  try {
    return new Intl.NumberFormat(numberLocale(hass), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: grouping,
    }).format(value);
  } catch (e) {
    return value.toFixed(digits);
  }
}

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card {
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    padding: 10px;
    display: flex;
    flex-direction: column;
  }
  .tiles { flex: 1 1 auto; min-height: 0; display: flex; margin: 0 -4px; }
  .tile {
    --c: ${COLORS.idle};
    flex: 1 1 0;
    min-width: 0;
    margin: 0 4px;
    padding: 6px 4px;
    box-sizing: border-box;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: rgba(127, 127, 127, 0.07);
    background: color-mix(in srgb, var(--c) 9%, transparent);
    transition: background-color 300ms ease-in-out;
  }
  .badge {
    position: relative;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--c);
    --mdc-icon-size: 22px;
    background: rgba(127, 127, 127, 0.14);
    background: color-mix(in srgb, var(--c) 18%, transparent);
    transition: color 300ms ease-in-out, background-color 300ms ease-in-out;
  }
  .ring {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    border-radius: 50%;
    background: var(--c);
    background: conic-gradient(var(--c) var(--soc, 0%), rgba(127, 127, 127, 0.25) 0);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
  }
  .soc {
    position: relative;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--primary-text-color);
  }
  .tile.has-soc ha-icon, .tile:not(.has-soc) .ring, .tile:not(.has-soc) .soc { display: none; }
  .value {
    white-space: nowrap;
    color: var(--primary-text-color);
    font-size: 21px;
    line-height: 26px;
    font-weight: var(--ha-font-weight-medium, 500);
    font-variant-numeric: tabular-nums;
  }
  .unit {
    margin-left: 3px;
    font-size: 13px;
    font-weight: 400;
    color: var(--secondary-text-color);
  }
  .label {
    max-width: 100%;
    font-size: var(--ha-font-size-s, 12px);
    line-height: 16px;
    color: var(--secondary-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .today {
    flex: none;
    height: 26px;
    margin-top: 8px;
    padding: 0 4px;
    display: flex;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    font-size: 13px;
  }
  .today[hidden], .autarky[hidden], .chip[hidden] { display: none; }
  .title {
    margin-right: 14px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .chip { display: flex; align-items: center; margin-right: 16px; cursor: pointer; }
  .chip ha-icon { --mdc-icon-size: 16px; color: var(--c); margin-right: 5px; }
  .clabel { color: var(--secondary-text-color); margin-right: 4px; }
  .cval { color: var(--primary-text-color); font-weight: var(--ha-font-weight-medium, 500); font-variant-numeric: tabular-nums; }
  .autarky { margin-left: auto; display: flex; align-items: center; }
  .bar {
    width: 56px;
    height: 6px;
    margin-left: 8px;
    border-radius: 3px;
    overflow: hidden;
    background: rgba(127, 127, 127, 0.2);
  }
  .fill { height: 100%; width: 0; border-radius: 3px; background: ${COLORS.charge}; transition: width 400ms ease-in-out; }

  /* medium width, e.g. 12 columns of a sections dashboard: icons instead of labels */
  .compact .title, .compact .chip .clabel { display: none; }
  .compact .chip { margin-right: 14px; }

  /* narrow cards, e.g. full width on a phone */
  .narrow .value { font-size: 17px; line-height: 22px; }
  .narrow .unit { font-size: 11px; margin-left: 2px; }
  .narrow .badge { width: 34px; height: 34px; --mdc-icon-size: 19px; }
  .narrow .soc { font-size: 10px; }
  .narrow .autarky .clabel { display: none; }
  .narrow .bar { width: 36px; margin-left: 6px; }
  .narrow .chip { margin-right: 10px; }
  .narrow .chip ha-icon { margin-right: 3px; }
  .narrow .today { font-size: 12px; }

  .warning { padding: 12px 16px; color: var(--error-color, #db4437); }
`;

class AlphaESSCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(`${CARD}-editor`);
  }

  static getStubConfig(hass) {
    try {
      const ents = Object.values((hass && hass.entities) || {});
      const dev = Object.values((hass && hass.devices) || {}).find((d) =>
        ents.some((e) => e.device_id === d.id && e.platform === DOMAIN)
      );
      return { device: dev ? dev.id : "" };
    } catch (e) {
      console.error(`${CARD}: getStubConfig failed`, e);
      return { device: "" };
    }
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._signature = "";
    this._entityCache = null;
    this._size = "";
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.entities && typeof config.entities !== "object") {
      throw new Error("'entities' must be a mapping of role: entity_id");
    }
    this._config = { ...config };
    this._entityCache = null;
    this._signature = "";
    this._build();
    if (this._hass) this._safeUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._safeUpdate();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (typeof ResizeObserver === "undefined" || this._observer) return;
    this._observer = new ResizeObserver((entries) => {
      const width = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
      const size = !width || width >= 640 ? "" : width >= 440 ? "compact" : "compact narrow";
      if (size === this._size) return;
      this._size = size;
      this._applySize();
    });
    this._observer.observe(this);
  }

  _applySize() {
    const card = this._els && this._els.card;
    if (!card || !card.classList) return;
    card.classList.toggle("compact", this._size.indexOf("compact") >= 0);
    card.classList.toggle("narrow", this._size.indexOf("narrow") >= 0);
  }

  disconnectedCallback() {
    if (this._observer) this._observer.disconnect();
    this._observer = null;
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 12, rows: 3, min_rows: 3, max_rows: 3 };
  }

  // Layout options of the pre-2024.11 sections grid (4 columns)
  getLayoutOptions() {
    return { grid_columns: 4, grid_rows: 3 };
  }

  _safeUpdate() {
    try {
      this._update();
    } catch (e) {
      console.error(`${CARD}: render failed`, e);
      this._showWarning(`${CARD}: ${(e && e.message) || e}`);
    }
  }

  // ---------------------------------------------------------------- entities

  _deviceId() {
    const c = this._config;
    if (c.device) return c.device;
    const ent = c.entity && this._hass.entities && this._hass.entities[c.entity];
    return ent ? ent.device_id : undefined;
  }

  _entities() {
    const hass = this._hass;
    const deviceId = this._deviceId();
    const key = `${deviceId}|${Object.keys(hass.entities || {}).length}|${JSON.stringify(this._config.entities || {})}`;
    if (this._entityCache && this._entityCache.key === key && this._entityCache.registry === hass.entities) {
      return this._entityCache.map;
    }
    const candidates = Object.values(hass.entities || {}).filter(
      (e) => e.device_id === deviceId && e.platform === DOMAIN && e.entity_id.indexOf("sensor.") === 0
    );
    const objectId = (e) => e.entity_id.slice(7);
    const friendly = (e) => {
      const s = hass.states[e.entity_id];
      return String((s && s.attributes && s.attributes.friendly_name) || "").toLowerCase();
    };
    const tests = [
      (e, l) => l.key && e.translation_key === l.key,
      (e, l) => l.suffix && (objectId(e) === l.suffix || objectId(e).slice(-l.suffix.length - 1) === `_${l.suffix}`),
      (e, l) => {
        if (!l.name) return false;
        const f = friendly(e);
        return f === l.name || f.slice(-l.name.length - 1) === ` ${l.name}`;
      },
    ];
    const map = {};
    for (const test of tests) {
      for (const role of ROLES) {
        if (map[role]) continue;
        const hit = candidates.find((e) => test(e, LOOKUP[role]));
        if (hit) map[role] = hit.entity_id;
      }
    }
    Object.assign(map, this._config.entities || {});
    this._entityCache = { key, registry: hass.entities, map };
    return map;
  }

  _state(role) {
    const id = this._map[role];
    return id ? this._hass.states[id] : undefined;
  }

  _num(role) {
    const s = this._state(role);
    if (!s || EMPTY.has(String(s.state).toLowerCase())) return undefined;
    const n = parseFloat(s.state);
    return Number.isFinite(n) ? n : undefined;
  }

  // power in W, whatever unit the sensor is displayed in
  _watts(role) {
    const n = this._num(role);
    if (n === undefined) return undefined;
    const unit = String((this._state(role).attributes || {}).unit_of_measurement || "W");
    if (unit === "kW") return n * 1000;
    if (unit === "MW") return n * 1000000;
    return n;
  }

  // energy in kWh
  _kwh(role) {
    const n = this._num(role);
    if (n === undefined) return undefined;
    const unit = String((this._state(role).attributes || {}).unit_of_measurement || "kWh");
    if (unit === "Wh") return n / 1000;
    if (unit === "MWh") return n * 1000;
    return n;
  }

  // ---------------------------------------------------------------- render

  _build() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    el("style", "", root).textContent = STYLE;
    const card = el("ha-card", this._size, root);
    const tiles = el("div", "tiles", card);
    const mkTile = (role) => {
      const tile = el("div", "tile", tiles);
      const badge = el("div", "badge", tile);
      const t = {
        tile,
        ring: el("div", "ring", badge),
        icon: el("ha-icon", "", badge),
        soc: el("span", "soc", badge),
      };
      const value = el("div", "value", tile);
      t.num = el("span", "num", value);
      t.unit = el("span", "unit", value);
      t.label = el("div", "label", tile);
      tile.addEventListener("click", () => this._moreInfo(role));
      return t;
    };
    const today = el("div", "today", card);
    const mkChip = (role) => {
      const chip = el("div", "chip", today);
      const c = { chip, icon: el("ha-icon", "", chip), label: el("span", "clabel", chip), value: el("span", "cval", chip) };
      chip.addEventListener("click", () => this._moreInfo(role));
      return c;
    };
    const title = el("span", "title", today);
    const autarky = el("div", "autarky");
    this._els = {
      card,
      solar: mkTile("pv_power"),
      home: mkTile("load_power"),
      grid: mkTile("grid_power"),
      battery: mkTile("battery_power"),
      today,
      title,
      pvToday: mkChip("pv_today"),
      importToday: mkChip("grid_import_today"),
      exportToday: mkChip("grid_export_today"),
      autarky,
      autarkyLabel: el("span", "clabel", autarky),
      autarkyValue: el("span", "cval", autarky),
      autarkyFill: el("div", "fill", el("div", "bar", autarky)),
    };
    today.appendChild(autarky);
    this._els.pvToday.icon.setAttribute("icon", "mdi:solar-power");
    this._els.importToday.icon.setAttribute("icon", "mdi:transmission-tower-import");
    this._els.exportToday.icon.setAttribute("icon", "mdi:transmission-tower-export");
    this._els.pvToday.chip.style.setProperty("--c", COLORS.solar);
    this._els.importToday.chip.style.setProperty("--c", COLORS.import);
    this._els.exportToday.chip.style.setProperty("--c", COLORS.export);
    this._warning = false;
  }

  _moreInfo(role) {
    const entityId = this._map && this._map[role];
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _update() {
    const hass = this._hass;
    const t = strings(hass);
    const deviceId = this._deviceId();

    if (!deviceId) return this._showWarning(t.no_device);
    if (hass.devices && !hass.devices[deviceId]) return this._showWarning(t.device_missing);

    this._map = this._entities();
    if (!ROLES.some((r) => this._map[r])) return this._showWarning(t.no_sensors);

    // Only re-render when something relevant changed
    const sig = [hass.locale && hass.locale.language, hass.locale && hass.locale.number_format]
      .concat(ROLES.map((r) => {
        const s = this._state(r);
        return s ? `${s.state}|${(s.attributes || {}).unit_of_measurement}` : "-";
      }))
      .join(";");
    if (sig === this._signature) return;
    if (this._warning) this._build();
    this._signature = sig;

    const cfg = this._config;
    const threshold = Number.isFinite(Number(cfg.idle_threshold)) ? Math.abs(Number(cfg.idle_threshold)) : 10;
    const e = this._els;

    // Solar
    const pv = this._watts("pv_power");
    this._tile(e.solar, pv, "mdi:solar-power", t.solar,
      pv !== undefined && pv > threshold ? COLORS.solar : COLORS.idle);

    // Home
    const load = this._watts("load_power");
    this._tile(e.home, load, "mdi:home-lightning-bolt", t.home,
      load !== undefined && load > threshold ? COLORS.home : COLORS.idle);

    // Grid: positive = import, negative = export
    const grid = this._watts("grid_power");
    if (grid !== undefined && grid > threshold) {
      this._tile(e.grid, grid, "mdi:transmission-tower-import", t.importing, COLORS.import);
    } else if (grid !== undefined && grid < -threshold) {
      this._tile(e.grid, grid, "mdi:transmission-tower-export", t.exporting, COLORS.export);
    } else {
      this._tile(e.grid, grid, "mdi:transmission-tower", t.grid, COLORS.idle);
    }

    // Battery: negative = charging by default (what AlphaESS inverters report);
    // invert_battery for setups where positive means charging
    const bat = this._watts("battery_power");
    const charge = bat === undefined ? undefined : (cfg.invert_battery ? bat : -bat);
    const soc = this._num("battery_soc");
    let batLabel = t.battery;
    let batColor = COLORS.idle;
    if (charge !== undefined && charge > threshold) {
      batLabel = t.charging;
      batColor = COLORS.charge;
    } else if (charge !== undefined && charge < -threshold) {
      batLabel = t.discharging;
      batColor = COLORS.discharge;
    } else if (soc !== undefined) {
      batColor = "var(--secondary-text-color)";
    }
    this._tile(e.battery, bat, "mdi:home-battery", batLabel, batColor);
    const hasSoc = soc !== undefined;
    e.battery.tile.classList.toggle("has-soc", hasSoc);
    e.battery.soc.textContent = hasSoc ? `${Math.round(soc)}%` : "";
    e.battery.tile.style.setProperty("--soc", hasSoc ? `${Math.min(100, Math.max(0, soc))}%` : "0%");
    if (hasSoc) e.battery.tile.title = `${batLabel} · ${fmtNum(hass, soc, 0)} %`;

    this._updateToday(t);
  }

  _tile(t, watts, icon, label, color) {
    const hass = this._hass;
    t.tile.style.setProperty("--c", color);
    t.icon.setAttribute("icon", icon);
    t.num.textContent = watts === undefined ? "–" : fmtNum(hass, Math.abs(watts), 0);
    t.unit.textContent = watts === undefined ? "" : "W";
    t.label.textContent = label;
    t.tile.title = watts === undefined ? label : `${label}: ${t.num.textContent} W`;
  }

  _updateToday(t) {
    const e = this._els;
    const cfg = this._config;
    const hass = this._hass;
    const pv = this._kwh("pv_today");
    const imp = this._kwh("grid_import_today");
    const exp = this._kwh("grid_export_today");
    const chips = [[e.pvToday, pv, t.pv_today], [e.importToday, imp, t.import_today], [e.exportToday, exp, t.export_today]];
    let any = false;
    for (const [c, value, label] of chips) {
      c.chip.hidden = value === undefined;
      if (value === undefined) continue;
      any = true;
      c.label.textContent = label;
      c.value.textContent = `${fmtNum(hass, value, 1)} kWh`;
      c.chip.title = `${t.today} ${label}: ${c.value.textContent}`;
    }

    // Self-sufficiency today = share of consumption not taken from the grid
    const chg = this._kwh("battery_charge_today");
    const dis = this._kwh("battery_discharge_today");
    let autarky;
    if ([pv, imp, exp, chg, dis].every((v) => v !== undefined)) {
      const consumption = pv + imp - exp + dis - chg;
      if (consumption > 0.05) autarky = Math.min(100, Math.max(0, (1 - imp / consumption) * 100));
    }
    const showAutarky = cfg.show_autarky !== false && autarky !== undefined;
    e.autarky.hidden = !showAutarky;
    if (showAutarky) {
      e.autarkyLabel.textContent = t.autarky;
      e.autarkyValue.textContent = `${fmtNum(hass, autarky, 0)} %`;
      e.autarkyFill.style.width = `${autarky}%`;
      e.autarky.title = `${t.today} ${t.autarky}: ${e.autarkyValue.textContent}`;
    }

    e.title.textContent = t.today;
    e.today.hidden = cfg.show_today === false || !(any || showAutarky);
  }

  _showWarning(text) {
    this._signature = "";
    this._warning = true;
    const root = this.shadowRoot;
    root.innerHTML = "";
    el("style", "", root).textContent = STYLE;
    const card = el("ha-card", "", root);
    el("div", "warning", card).textContent = text;
    this._els = { card };
  }
}

// -------------------------------------------------------------------- editor

class AlphaESSCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    this._fillRequired();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._fillRequired();
    this._render();
  }

  // Write the device into the config as soon as it is known (e.g. YAML with
  // only `entity:`), independent of ha-form being loaded.
  _fillRequired() {
    if (!this._hass || this._config.device || !this._config.entity) return;
    const ent = this._hass.entities && this._hass.entities[this._config.entity];
    if (!ent || !ent.device_id) return;
    this._config = { ...this._config, device: ent.device_id };
    this._emit(this._config);
  }

  _emit(config) {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  connectedCallback() {
    this._ensureForm();
  }

  async _ensureForm() {
    if (customElements.get("ha-form")) return;
    // ha-form is loaded lazily by HA; loading the editor of a built-in card pulls it in.
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "button", entity: "sun.sun" });
      if (card && card.constructor && card.constructor.getConfigElement) {
        await card.constructor.getConfigElement();
      }
    } catch (e) {
      /* ignore – the form will appear once ha-form is defined */
    }
    await customElements.whenDefined("ha-form");
    this._render();
  }

  _schema() {
    return [
      { name: "device", required: true, selector: { device: { integration: DOMAIN } } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "show_today", selector: { boolean: {} } },
          { name: "show_autarky", selector: { boolean: {} } },
        ],
      },
      { name: "invert_battery", selector: { boolean: {} } },
      {
        name: "idle_threshold",
        selector: { number: { min: 0, max: 500, step: 5, mode: "box", unit_of_measurement: "W" } },
      },
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => strings(this._hass).editor[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        for (const k of Object.keys(config)) {
          if (config[k] === "" || config[k] === undefined || config[k] === null) delete config[k];
        }
        this._config = config;
        this._emit(config);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = { show_today: true, show_autarky: true, invert_battery: false, idle_threshold: 10, ...this._config };
  }
}

if (!customElements.get(CARD)) customElements.define(CARD, AlphaESSCard);
if (!customElements.get(`${CARD}-editor`)) customElements.define(`${CARD}-editor`, AlphaESSCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD)) {
  window.customCards.push({
    type: CARD,
    name: "Card for AlphaESS Modbus",
    description: "Live power flow, battery and today's energy of an AlphaESS inverter",
    preview: true,
    documentationURL: "https://github.com/yannick80/ha-card-for-alphaess",
  });
}

console.info(`%c ${CARD} %c ${VERSION} `, "color:#fff;background:#555;font-weight:700", "color:#555;background:#eee");

// Test hook: only active when evaluated with a CommonJS-style `module` (node tests)
if (typeof module !== "undefined" && module && module.exports) {
  module.exports = { AlphaESSCard: AlphaESSCard, AlphaESSCardEditor: AlphaESSCardEditor, fmtNum: fmtNum };
}
})();
