// Card tests: `node --test tests/*.mjs` – no npm dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const CARD_DIR = new URL("../dist/", import.meta.url);
const CARD_FILES = readdirSync(CARD_DIR).filter((f) => f.endsWith(".js"));
const SOURCE = readFileSync(new URL("alphaess-card.js", CARD_DIR), "utf8");

// ------------------------------------------------------------ minimal DOM stub

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.hidden = false;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    const props = {};
    this.style = { setProperty: (k, v) => (props[k] = v), getPropertyValue: (k) => props[k] || "", _props: props };
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      toggle: (c, on) => {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c);
        self.className = [...set].join(" ");
      },
    };
  }
  set innerHTML(v) { this.children = []; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  find(cls) {
    if (this.classList.contains(cls)) return this;
    for (const c of this.children) { const hit = c.find && c.find(cls); if (hit) return hit; }
    return null;
  }
}

function makeContext(extra = {}) {
  const registry = new Map();
  class HTMLElement {
    constructor() { this.dispatched = []; this.children = []; }
    attachShadow() { this.shadowRoot = new FakeEl("#shadow"); return this.shadowRoot; }
    dispatchEvent(ev) { this.dispatched.push(ev); return true; }
    appendChild(c) { this.children.push(c); return c; }
  }
  const ctx = {
    console: { info() {}, error(...a) { ctx.__errors.push(a); }, warn() {} },
    __errors: [],
    HTMLElement,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    customElements: {
      get: (t) => registry.get(t),
      define: (t, c) => { if (registry.has(t)) throw new Error(`already defined: ${t}`); registry.set(t, c); },
      whenDefined: () => new Promise(() => {}), // ha-form never arrives in tests
    },
    document: { createElement: (t) => { const C = registry.get(t); return C ? new C() : new FakeEl(t); } },
    Intl, Date, Math, JSON, Number, String, Object, Array, Promise, Error, RegExp, Set, parseFloat,
    ...extra,
  };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

function loadCard(withHook = true) {
  const ctx = makeContext(withHook ? { module: { exports: {} } } : {});
  vm.runInContext(SOURCE, ctx, { filename: "alphaess-card.js" });
  return ctx;
}

// ------------------------------------------------------------ mock hass

// object IDs as the integration creates them for a device named "AlphaESS Inverter"
const IDS = {
  pv_power: ["current_pv_production", "W"],
  load_power: ["current_house_load", "W"],
  grid_power: ["grid_power", "W"],
  battery_power: ["battery_power", "W"],
  battery_soc: ["battery_state_of_charge", "%"],
  pv_today: ["today_s_pv_generation", "kWh", "today_pv_generation"],
  grid_import_today: ["today_s_energy_from_grid", "kWh", "today_energy_from_grid"],
  grid_export_today: ["today_s_energy_feed_to_grid", "kWh", "today_energy_feed_to_grid"],
  battery_charge_today: ["today_s_battery_charged", "kWh", "today_battery_charged"],
  battery_discharge_today: ["today_s_battery_discharged", "kWh", "today_battery_discharged"],
};

function mkHass(values, { lang = "de", prefix = "alphaess_inverter_", extra = {} } = {}) {
  const hass = {
    locale: { language: lang, number_format: "language" }, language: lang,
    devices: { inv: { id: "inv", name: "AlphaESS Inverter" } },
    entities: {}, states: {},
  };
  for (const [role, [obj, unit, key]] of Object.entries(IDS)) {
    const eid = `sensor.${prefix}${obj}`;
    hass.entities[eid] = { entity_id: eid, device_id: "inv", platform: "alphaess_modbus", translation_key: key || null };
    if (values[role] !== undefined) {
      hass.states[eid] = { entity_id: eid, state: String(values[role]), attributes: { unit_of_measurement: unit } };
    }
  }
  Object.assign(hass.entities, extra);
  return hass;
}

function render(ctx, config, hass) {
  const Card = ctx.customElements.get("alphaess-card");
  const card = new Card();
  card.setConfig(config);
  card.hass = hass;
  const e = card._els;
  const tile = (t) => t && { value: `${t.num.textContent}${t.unit.textContent ? " " + t.unit.textContent : ""}`,
    label: t.label.textContent, color: t.tile.style.getPropertyValue("--c"), soc: t.soc.textContent };
  const warn = card.shadowRoot.find("warning");
  return {
    card,
    warning: warn && warn.textContent,
    solar: tile(e.solar), home: tile(e.home), grid: tile(e.grid), battery: tile(e.battery),
    todayHidden: e.today && e.today.hidden,
    chips: e.pvToday && [e.pvToday, e.importToday, e.exportToday].map((c) => (c.chip.hidden ? null : c.value.textContent)),
    autarky: e.autarky && (e.autarky.hidden ? null : e.autarkyValue.textContent),
  };
}

const SUNNY = { pv_power: 4820, load_power: 1240, grid_power: -2310, battery_power: -1270, battery_soc: 64,
  pv_today: 18.4, grid_import_today: 2.1, grid_export_today: 9.7, battery_charge_today: 6.2, battery_discharge_today: 3.9 };

// ------------------------------------------------------------ old WebViews

test("all card files evaluate as classic scripts in one shared context, twice", () => {
  const ctx = makeContext();
  for (let i = 0; i < 2; i++) {
    for (const f of CARD_FILES) {
      vm.runInContext(readFileSync(new URL(f, CARD_DIR), "utf8"), ctx, { filename: f });
    }
  }
  assert.ok(ctx.customElements.get("alphaess-card"));
  assert.equal(ctx.window.customCards.filter((c) => c.type === "alphaess-card").length, 1);
});

test("source uses no syntax newer than ES2019", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const forbidden = [
    [/\?\.(?!\d)/, "optional chaining ?."],
    [/\?\?/, "nullish coalescing ??"],
    [/(\|\||&&)=/, "logical assignment"],
    [/\.at\(/, ".at()"],
    [/\.replaceAll\(/, "replaceAll"],
    [/this\.#\w|^\s*(static\s+)?#\w+\s*[=(;]/m, "#private class members"],
  ];
  for (const [re, name] of forbidden) assert.doesNotMatch(code, re, `forbidden syntax: ${name}`);
});

test("whole file is wrapped in its own function scope", () => {
  const code = SOURCE.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "").trim();
  assert.match(code, /^\(function \(\) \{/);
  assert.match(code, /\}\)\(\);$/);
});

test("every color-mix() and conic-gradient() has a plain fallback declaration directly before it", () => {
  const lines = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").split("\n");
  let count = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([a-z-]+)\s*:.*(color-mix|conic-gradient)\(/);
    if (!m) return;
    count++;
    const prev = lines.slice(0, i).reverse().find((l) => l.trim() !== "");
    assert.ok(prev && new RegExp(`^\\s*${m[1]}\\s*:`).test(prev) && !/color-mix\(|conic-gradient\(/.test(prev),
      `no fallback before line ${i + 1}: ${line.trim()}`);
  });
  assert.ok(count > 0);
});

test("CSS avoids flex/grid gap and inset", () => {
  assert.doesNotMatch(SOURCE, /^\s*(gap|inset)\s*:/m);
});

// ------------------------------------------------------------ behaviour

test("without a device the card shows a hint", () => {
  const ctx = loadCard();
  assert.equal(render(ctx, {}, mkHass(SUNNY)).warning, "Kein AlphaESS-Gerät ausgewählt");
});

test("unknown device and a device without AlphaESS sensors show hints", () => {
  const ctx = loadCard();
  assert.equal(render(ctx, { device: "nope" }, mkHass(SUNNY)).warning, "Gerät nicht gefunden");
  const hass = mkHass(SUNNY);
  for (const e of Object.values(hass.entities)) e.platform = "other";
  assert.equal(render(ctx, { device: "inv" }, hass).warning, "Keine Sensoren der AlphaESS-Integration gefunden");
});

test("sunny midday: values are positive, labels and colours follow the direction", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass(SUNNY));
  assert.equal(r.warning, null);
  assert.deepEqual(r.solar, { value: "4.820 W", label: "Erzeugung", color: "var(--energy-solar-color, #ff9800)", soc: "" });
  assert.equal(r.home.value, "1.240 W");
  assert.equal(r.grid.value, "2.310 W");
  assert.equal(r.grid.label, "Einspeisung");
  assert.match(r.grid.color, /grid-return/);
  assert.equal(r.battery.value, "1.270 W");
  assert.equal(r.battery.label, "Akku lädt");
  assert.match(r.battery.color, /success/);
  assert.equal(r.battery.soc, "64%");
});

test("evening: battery discharging is red, small grid power counts as idle", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass({ pv_power: 0, load_power: 860, grid_power: 4, battery_power: 856, battery_soc: 41 }));
  assert.equal(r.battery.label, "Akku entlädt");
  assert.match(r.battery.color, /error/);
  assert.equal(r.grid.label, "Netz");
  assert.equal(r.grid.value, "4 W");
  assert.match(r.solar.color, /disabled/);
});

test("grid import, and battery exactly 0 shows the plain label", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass({ grid_power: 618, battery_power: 0, battery_soc: 10 }));
  assert.equal(r.grid.label, "Netzbezug");
  assert.match(r.grid.color, /grid-consumption/);
  assert.equal(r.battery.label, "Akku");
  assert.equal(r.battery.value, "0 W");
});

test("invert_battery and idle_threshold", () => {
  const ctx = loadCard();
  const inv = render(ctx, { device: "inv", invert_battery: true }, mkHass({ battery_power: 500 }));
  assert.equal(inv.battery.label, "Akku lädt");
  const thr = render(ctx, { device: "inv", idle_threshold: 100 }, mkHass({ battery_power: -60, grid_power: 80 }));
  assert.equal(thr.battery.label, "Akku");
  assert.equal(thr.grid.label, "Netz");
});

test("power in kW is converted to W", () => {
  const ctx = loadCard();
  const hass = mkHass({ pv_power: 1.5 });
  hass.states["sensor.alphaess_inverter_current_pv_production"].attributes.unit_of_measurement = "kW";
  assert.equal(render(ctx, { device: "inv" }, hass).solar.value, "1.500 W");
});

test("today's energy and self-sufficiency", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass(SUNNY));
  assert.deepEqual(r.chips, ["18,4 kWh", "2,1 kWh", "9,7 kWh"]);
  // consumption = 18.4 + 2.1 - 9.7 + 3.9 - 6.2 = 8.5 kWh, from grid 2.1 -> 75 %
  assert.equal(r.autarky, "75 %");
  assert.equal(r.todayHidden, false);
  assert.equal(render(ctx, { device: "inv", show_autarky: false }, mkHass(SUNNY)).autarky, null);
  assert.equal(render(ctx, { device: "inv", show_today: false }, mkHass(SUNNY)).todayHidden, true);
});

test("self-sufficiency is left out when a battery energy sensor is missing", () => {
  const ctx = loadCard();
  const values = { ...SUNNY };
  delete values.battery_discharge_today;
  assert.equal(render(ctx, { device: "inv" }, mkHass(values)).autarky, null);
});

test("unavailable sensors show a dash", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass({ pv_power: "unavailable", battery_soc: "unknown" }));
  assert.equal(r.solar.value, "–");
  assert.equal(r.battery.soc, "");
});

test("sensors are found by friendly name when the entity IDs were renamed", () => {
  const ctx = loadCard();
  const hass = mkHass({}, { prefix: "x_" });
  const id = "sensor.netz";
  hass.entities[id] = { entity_id: id, device_id: "inv", platform: "alphaess_modbus", translation_key: null };
  hass.states[id] = { entity_id: id, state: "-300", attributes: { unit_of_measurement: "W", friendly_name: "AlphaESS Inverter Grid Power" } };
  delete hass.entities["sensor.x_grid_power"];
  assert.equal(render(ctx, { device: "inv" }, hass).grid.label, "Einspeisung");
});

test("grid_power does not match the per-phase sensors", () => {
  const ctx = loadCard();
  const phase = "sensor.alphaess_inverter_grid_power_phase_a";
  const hass = mkHass({ grid_power: 100 });
  hass.entities = { [phase]: { entity_id: phase, device_id: "inv", platform: "alphaess_modbus" }, ...hass.entities };
  hass.states[phase] = { entity_id: phase, state: "-999", attributes: { unit_of_measurement: "W" } };
  assert.equal(render(ctx, { device: "inv" }, hass).grid.value, "100 W");
});

test("entities: overrides a role", () => {
  const ctx = loadCard();
  const hass = mkHass(SUNNY);
  hass.states["sensor.my_pv"] = { entity_id: "sensor.my_pv", state: "777", attributes: { unit_of_measurement: "W" } };
  assert.equal(render(ctx, { device: "inv", entities: { pv_power: "sensor.my_pv" } }, hass).solar.value, "777 W");
});

test("English labels and number format", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass(SUNNY, { lang: "en" }));
  assert.equal(r.solar.value, "4,820 W");
  assert.equal(r.grid.label, "Exporting");
  assert.equal(r.battery.label, "Charging");
});

test("tapping a tile opens the sensor", () => {
  const ctx = loadCard();
  const r = render(ctx, { device: "inv" }, mkHass(SUNNY));
  r.card._els.grid.tile.listeners.click[0]();
  const ev = r.card.dispatched.find((e) => e.type === "hass-more-info");
  assert.equal(ev.detail.entityId, "sensor.alphaess_inverter_grid_power");
});

test("render errors are shown inside the card instead of throwing", () => {
  const ctx = loadCard();
  const hass = mkHass(SUNNY);
  Object.defineProperty(hass, "states", { get() { throw new Error("boom"); } });
  const r = render(ctx, { device: "inv" }, hass);
  assert.match(r.warning, /boom/);
  assert.equal(ctx.__errors.length > 0, true);
});

test("card is fixed to 12 columns x 3 rows", () => {
  const ctx = loadCard();
  const card = new (ctx.customElements.get("alphaess-card"))();
  assert.equal(typeof card.getCardSize(), "number");
  assert.deepEqual({ ...card.getGridOptions() }, { columns: 12, min_columns: 12, rows: 3, min_rows: 3, max_rows: 3 });
  assert.deepEqual({ ...card.getLayoutOptions() }, { grid_columns: 4, grid_rows: 3 });
});

test("getStubConfig names an explicit device and never throws", async () => {
  const ctx = loadCard();
  const Card = ctx.customElements.get("alphaess-card");
  assert.equal((await Card.getStubConfig(mkHass(SUNNY))).device, "inv");
  assert.equal((await Card.getStubConfig({})).device, "");
});

// ------------------------------------------------------------ editor

test("editor works while ha-form is not defined and fills in the device", () => {
  const ctx = loadCard();
  const editor = new (ctx.customElements.get("alphaess-card-editor"))();
  editor.hass = mkHass(SUNNY);
  editor.setConfig({ type: "custom:alphaess-card", entity: "sensor.alphaess_inverter_grid_power" });
  editor.connectedCallback();
  const ev = editor.dispatched.find((e) => e.type === "config-changed");
  assert.ok(ev, "config-changed was not fired");
  assert.equal(ev.detail.config.device, "inv");
});
