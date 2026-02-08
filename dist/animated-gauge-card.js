/**
 * Animated Gauge Card for Home Assistant
 * https://github.com/smalarz/animated-gauge-card
 *
 * @version 1.0.0
 * @license MIT
 */

const VERSION = '1.0.0';

// ─── LOCALES ───

const LOCALES = {
  en: {
    editor: {
      entity: 'Entity', name: 'Name', min: 'Min value', max: 'Max value',
      unit: 'Unit', decimals: 'Decimals', needle: 'Show needle',
      segments: 'Color segments (value:color)', show_value: 'Show value',
      show_name: 'Show name', show_segments_label: 'Show segment labels',
      show_min_max: 'Show min/max', show_ticks: 'Show tick marks',
      arc_width: 'Arc width (%)', start_angle: 'Start angle',
      severity: 'Severity thresholds',
    },
    no_data: 'N/A',
  },
  pl: {
    editor: {
      entity: 'Encja', name: 'Nazwa', min: 'Wartość min', max: 'Wartość max',
      unit: 'Jednostka', decimals: 'Miejsca dziesiętne', needle: 'Pokaż wskazówkę',
      segments: 'Segmenty kolorów (wartość:kolor)', show_value: 'Pokaż wartość',
      show_name: 'Pokaż nazwę', show_segments_label: 'Pokaż etykiety segmentów',
      show_min_max: 'Pokaż min/max', show_ticks: 'Pokaż podziałkę',
      arc_width: 'Grubość łuku (%)', start_angle: 'Kąt początkowy',
      severity: 'Progi kolorów',
    },
    no_data: 'Brak',
  },
  de: {
    editor: {
      entity: 'Entität', name: 'Name', min: 'Min-Wert', max: 'Max-Wert',
      unit: 'Einheit', decimals: 'Dezimalstellen', needle: 'Zeiger anzeigen',
      segments: 'Farbsegmente (Wert:Farbe)', show_value: 'Wert anzeigen',
      show_name: 'Name anzeigen', show_segments_label: 'Segmentbeschriftungen',
      show_min_max: 'Min/Max anzeigen', show_ticks: 'Markierungen',
      arc_width: 'Bogenbreite (%)', start_angle: 'Startwinkel',
      severity: 'Schwellenwerte',
    },
    no_data: 'N/A',
  },
};

function getLocale(hass) {
  if (!hass) return LOCALES.en;
  const lang = (hass.language || 'en').substring(0, 2);
  return LOCALES[lang] || LOCALES.en;
}

// ─── HELPERS ───

function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  if (Math.abs(endAngle - startAngle) < 0.01) return '';
  const start = polarToXY(cx, cy, r, endAngle);
  const end = polarToXY(cx, cy, r, startAngle);
  const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
  return `M${start.x},${start.y} A${r},${r} 0 ${largeArc} 0 ${end.x},${end.y}`;
}

function formatVal(v, decimals) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Number(v).toFixed(decimals ?? 0);
}

function parseSeverity(sev) {
  if (!sev) return null;
  if (Array.isArray(sev)) {
    return sev.map(s => ({ from: parseFloat(s.from), to: parseFloat(s.to), color: s.color }))
      .sort((a, b) => a.from - b.from);
  }
  return null;
}

function getSegmentColor(value, severity, defaultColor) {
  if (!severity) return defaultColor;
  for (const s of severity) {
    if (value >= s.from && value < s.to) return s.color;
  }
  // Check last segment with <= for max boundary
  const last = severity[severity.length - 1];
  if (last && value >= last.from && value <= last.to) return last.color;
  return defaultColor;
}

// ─── DEFAULT SEVERITY ───

const DEFAULT_SEVERITY = [
  { from: 0, to: 33, color: '#4caf50' },
  { from: 33, to: 66, color: '#ff9800' },
  { from: 66, to: 100, color: '#f44336' },
];

// ─── MAIN CARD ───

class AnimatedGaugeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._built = false;
    this._animatedValue = null;
    this._animFrame = null;
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._built) this._buildShell();

    const eid = this._config.entity;
    if (eid) {
      const newVal = parseFloat(hass.states[eid]?.state);
      const oldVal = prev ? parseFloat(prev.states[eid]?.state) : NaN;
      if (!isNaN(newVal) && newVal !== oldVal) {
        this._animateValue(isNaN(oldVal) ? this._config.min : oldVal, newVal);
      } else if (!this._animFrame) {
        this._render(this._animatedValue ?? newVal);
      }
    }
  }

  setConfig(config) {
    if (!config.entity) throw new Error('Please define an entity');
    const severity = config.severity || config.segments || null;

    this._config = {
      entity: config.entity,
      name: config.name ?? null,
      min: config.min ?? 0,
      max: config.max ?? 100,
      unit: config.unit ?? null,
      decimals: config.decimals ?? 0,
      severity: parseSeverity(severity) || DEFAULT_SEVERITY,
      needle: config.needle !== false,
      show_value: config.show_value !== false,
      show_name: config.show_name !== false,
      show_min_max: config.show_min_max !== false,
      show_ticks: config.show_ticks ?? true,
      show_segments_label: config.show_segments_label ?? false,
      arc_width: config.arc_width ?? 20,
      // Gauge arc: default 240° sweep from -120° to +120°
      sweep_angle: config.sweep_angle ?? 240,
    };
    this._built = false;
    this._animatedValue = null;
  }

  disconnectedCallback() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  _animateValue(from, to) {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    const duration = 800;
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      this._animatedValue = from + (to - from) * eased;
      this._render(this._animatedValue);
      if (progress < 1) {
        this._animFrame = requestAnimationFrame(tick);
      } else {
        this._animFrame = null;
        this._animatedValue = to;
      }
    };
    this._animFrame = requestAnimationFrame(tick);
  }

  _buildShell() {
    this.shadowRoot.innerHTML = `<style>${this._css()}</style>
      <ha-card>
        <div class="gauge-card" id="card">
          <svg id="svg"></svg>
          <div class="value-area" id="value-area"></div>
        </div>
      </ha-card>`;
    this._built = true;
  }

  _render(currentValue) {
    if (!this._built || !this._hass) return;
    const cfg = this._config;
    const states = this._hass.states;
    const state = states[cfg.entity];
    const rawVal = state ? parseFloat(state.state) : NaN;
    const val = currentValue !== undefined && !isNaN(currentValue) ? currentValue : rawVal;
    const available = state && state.state !== 'unavailable' && state.state !== 'unknown' && !isNaN(rawVal);

    // Geometry: 240° arc, centered, opening at bottom
    // Angles in standard math: 0° = right, 90° = up
    // We use SVG angles where 0° = top, clockwise
    // For 240° sweep: start at 150° (bottom-left), end at 30° (bottom-right) going clockwise through top
    const sweep = cfg.sweep_angle;
    const arcStartDeg = 180 + (360 - sweep) / 2; // e.g. 240° → 240°
    const arcEndDeg = arcStartDeg + sweep;        // e.g. 240° → 480° = 120°

    const W = 200, H = 160;
    const cx = W / 2, cy = 105;
    const outerR = 80;
    const arcW = cfg.arc_width;
    const innerR = outerR - arcW;
    const midR = outerR - arcW / 2;

    const svg = this.shadowRoot.getElementById('svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // Helper: angle in degrees (0=top, clockwise) to x,y
    const toXY = (r, deg) => {
      const rad = (deg - 90) * Math.PI / 180;
      return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    };

    // Helper: SVG arc path from angle a1 to a2 (degrees, clockwise)
    const arcPath = (r, a1, a2) => {
      const p1 = toXY(r, a1);
      const p2 = toXY(r, a2);
      const angleDiff = ((a2 - a1) % 360 + 360) % 360;
      const large = angleDiff > 180 ? 1 : 0;
      return `M${p1.x.toFixed(2)},${p1.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    };

    // Value to angle mapping
    const range = cfg.max - cfg.min;
    const valToAngle = (v) => {
      const pct = Math.max(0, Math.min(1, (v - cfg.min) / range));
      return arcStartDeg + pct * sweep;
    };

    let html = '';

    // ─── Background track ───
    html += `<path d="${arcPath(midR, arcStartDeg, arcEndDeg)}" fill="none" stroke="rgba(148,163,184,0.12)" stroke-width="${arcW}" stroke-linecap="round"/>`;

    // ─── Colored severity segments ───
    if (cfg.severity) {
      cfg.severity.forEach(seg => {
        const segFrom = Math.max(seg.from, cfg.min);
        const segTo = Math.min(seg.to, cfg.max);
        if (segTo <= segFrom) return;
        const a1 = valToAngle(segFrom);
        const a2 = valToAngle(segTo);
        html += `<path d="${arcPath(midR, a1, a2)}" fill="none" stroke="${seg.color}" stroke-width="${arcW}" stroke-linecap="butt" opacity="0.3"/>`;
      });
    }

    // ─── Active arc + needle ───
    if (available && !isNaN(val)) {
      const clampedVal = Math.max(cfg.min, Math.min(cfg.max, val));
      const valAngle = valToAngle(clampedVal);
      const activeColor = getSegmentColor(clampedVal, cfg.severity, '#3b82f6');

      // Active filled arc
      if (valAngle - arcStartDeg > 0.5) {
        html += `<defs><linearGradient id="ag" gradientUnits="userSpaceOnUse" x1="${toXY(midR, arcStartDeg).x}" y1="${toXY(midR, arcStartDeg).y}" x2="${toXY(midR, valAngle).x}" y2="${toXY(midR, valAngle).y}">
          <stop offset="0%" stop-color="${activeColor}" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="${activeColor}" stop-opacity="1"/>
        </linearGradient></defs>`;
        html += `<path d="${arcPath(midR, arcStartDeg, valAngle)}" fill="none" stroke="url(#ag)" stroke-width="${arcW}" stroke-linecap="round"/>`;
      }

      // Glow at tip
      const tip = toXY(midR, valAngle);
      html += `<circle cx="${tip.x.toFixed(2)}" cy="${tip.y.toFixed(2)}" r="${arcW * 0.6}" fill="${activeColor}" opacity="0.12"/>`;

      // Needle
      if (cfg.needle) {
        const needleTip = toXY(outerR + 2, valAngle);
        const needleBase1 = toXY(8, valAngle - 8);
        const needleBase2 = toXY(8, valAngle + 8);

        html += `<polygon points="${needleTip.x.toFixed(2)},${needleTip.y.toFixed(2)} ${needleBase1.x.toFixed(2)},${needleBase1.y.toFixed(2)} ${needleBase2.x.toFixed(2)},${needleBase2.y.toFixed(2)}" fill="${activeColor}" opacity="0.85"/>`;
        html += `<circle cx="${cx}" cy="${cy}" r="6" fill="${activeColor}"/>`;
        html += `<circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--card-background-color, #1e293b)"/>`;
      }
    }

    // ─── Tick marks ───
    if (cfg.show_ticks) {
      const majorStep = this._niceStep(range, 5);
      const minorStep = majorStep / 5;

      // Avoid floating point accumulation
      const steps = Math.round(range / minorStep);
      for (let i = 0; i <= steps; i++) {
        const v = cfg.min + i * minorStep;
        if (v > cfg.max + minorStep * 0.01) break;
        const a = valToAngle(Math.min(v, cfg.max));
        const isMajor = Math.abs(v % majorStep) < minorStep * 0.1 || Math.abs(v % majorStep - majorStep) < minorStep * 0.1;
        const t1 = toXY(outerR + 2, a);
        const t2 = toXY(outerR + (isMajor ? 9 : 5), a);
        html += `<line x1="${t1.x.toFixed(2)}" y1="${t1.y.toFixed(2)}" x2="${t2.x.toFixed(2)}" y2="${t2.y.toFixed(2)}" stroke="rgba(148,163,184,${isMajor ? '0.4' : '0.15'})" stroke-width="${isMajor ? 1.5 : 0.75}"/>`;

        if (isMajor && cfg.show_segments_label) {
          const lp = toXY(outerR + 16, a);
          html += `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}" fill="rgba(148,163,184,0.5)" font-size="8" text-anchor="middle" dominant-baseline="central">${this._formatTickVal(v)}</text>`;
        }
      }
    }

    // ─── Min/Max labels ───
    if (cfg.show_min_max) {
      const minP = toXY(outerR + 14, arcStartDeg);
      const maxP = toXY(outerR + 14, arcEndDeg);
      html += `<text x="${minP.x.toFixed(2)}" y="${minP.y.toFixed(2)}" fill="rgba(148,163,184,0.45)" font-size="10" text-anchor="middle" dominant-baseline="central">${this._formatTickVal(cfg.min)}</text>`;
      html += `<text x="${maxP.x.toFixed(2)}" y="${maxP.y.toFixed(2)}" fill="rgba(148,163,184,0.45)" font-size="10" text-anchor="middle" dominant-baseline="central">${this._formatTickVal(cfg.max)}</text>`;
    }

    svg.innerHTML = html;

    // ─── Value + Name ───
    const valueArea = this.shadowRoot.getElementById('value-area');
    const l = getLocale(this._hass);
    let vaHtml = '';

    if (cfg.show_value) {
      const unit = cfg.unit ?? state?.attributes.unit_of_measurement ?? '';
      const displayVal = available ? formatVal(rawVal, cfg.decimals) : l.no_data;
      const activeColor = available ? getSegmentColor(Math.max(cfg.min, Math.min(cfg.max, rawVal)), cfg.severity, '#3b82f6') : 'var(--secondary-text-color)';
      vaHtml += `<div class="gauge-value" style="color:${activeColor}">${displayVal}<span class="gauge-unit">${unit}</span></div>`;
    }

    if (cfg.show_name) {
      const name = cfg.name ?? state?.attributes.friendly_name ?? cfg.entity;
      vaHtml += `<div class="gauge-name">${name}</div>`;
    }

    valueArea.innerHTML = vaHtml;
  }

  _niceStep(range, target) {
    const rough = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow;
    let nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  _formatTickVal(v) {
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(0) + 'k';
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(1);
  }

  // ─── HA ───

  getCardSize() { return 3; }
  static getConfigElement() { return document.createElement('animated-gauge-card-editor'); }
  static getStubConfig(hass) {
    const sensors = Object.keys(hass.states).filter(e => e.startsWith('sensor.')).slice(0, 1);
    return { entity: sensors[0] || 'sensor.temperature', min: 0, max: 100 };
  }

  _css() {
    return `
      :host { display: block; }
      ha-card { overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); }
      .gauge-card {
        position: relative; padding: 16px 16px 8px;
        display: flex; flex-direction: column; align-items: center;
      }
      svg { display: block; width: 100%; max-width: 250px; }
      .value-area {
        text-align: center; margin-top: -30px; position: relative; z-index: 1;
      }
      .gauge-value {
        font-size: 32px; font-weight: 300; line-height: 1;
        letter-spacing: -0.5px;
        transition: color 0.5s ease;
      }
      .gauge-unit { font-size: 14px; opacity: 0.7; margin-left: 3px; font-weight: 400; }
      .gauge-name {
        font-size: 13px; color: var(--secondary-text-color);
        margin-top: 4px; font-weight: 500;
      }
    `;
  }
}

// ─── EDITOR ───

class AnimatedGaugeCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._config = {}; }
  setConfig(config) { this._config = JSON.parse(JSON.stringify(config)); this._render(); }
  set hass(hass) { this._hass = hass; if (!this._rendered) this._render(); }

  _fireChanged() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: JSON.parse(JSON.stringify(this._config)) } }));
  }

  _getSensorEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states).filter(e => e.startsWith('sensor.')).sort()
      .map(id => ({ id, name: this._hass.states[id].attributes.friendly_name || id }));
  }

  _setupAutocomplete(input, onSelect) {
    const entities = this._getSensorEntities();
    const wrap = input.parentElement;
    wrap.style.position = 'relative';
    const dropdown = document.createElement('div');
    dropdown.className = 'ac-list';
    wrap.appendChild(dropdown);
    let selectedIdx = -1;

    const show = (items) => {
      dropdown.innerHTML = items.map((e, i) =>
        `<div class="ac-item${i === selectedIdx ? ' ac-active' : ''}" data-val="${e.id}">${e.name} <span class="ac-id">${e.id}</span></div>`
      ).join('');
      dropdown.style.display = items.length ? 'block' : 'none';
    };
    const hide = () => { setTimeout(() => { dropdown.style.display = 'none'; }, 200); };
    const filter = (q) => {
      const lq = q.toLowerCase();
      return entities.filter(e => e.id.toLowerCase().includes(lq) || e.name.toLowerCase().includes(lq)).slice(0, 40);
    };

    input.addEventListener('focus', () => show(filter(input.value)));
    input.addEventListener('blur', hide);
    input.addEventListener('input', () => { selectedIdx = -1; show(filter(input.value)); });
    input.addEventListener('keydown', (ev) => {
      const items = dropdown.querySelectorAll('.ac-item');
      if (ev.key === 'ArrowDown') { ev.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); show(filter(input.value)); items[selectedIdx]?.scrollIntoView({block:'nearest'}); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); show(filter(input.value)); items[selectedIdx]?.scrollIntoView({block:'nearest'}); }
      else if (ev.key === 'Enter' && selectedIdx >= 0 && items[selectedIdx]) { ev.preventDefault(); input.value = items[selectedIdx].dataset.val; dropdown.style.display = 'none'; onSelect(input.value); }
      else if (ev.key === 'Escape') { dropdown.style.display = 'none'; }
    });
    dropdown.addEventListener('mousedown', (ev) => {
      const item = ev.target.closest('.ac-item');
      if (item) { input.value = item.dataset.val; dropdown.style.display = 'none'; onSelect(input.value); }
    });
    input.addEventListener('change', () => onSelect(input.value.trim()));
  }

  _render() {
    this._rendered = true;
    const c = this._config;
    const l = getLocale(this._hass);
    const e = l.editor;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .form { padding: 8px 0; }
        .row { margin-bottom: 12px; }
        .row label { display: block; font-size: 12px; margin-bottom: 4px; color: var(--secondary-text-color); font-weight: 500; }
        .row input, .row textarea { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--divider-color, #e0e0e0); background: var(--card-background-color, #fff); color: var(--primary-text-color); font-size: 13px; box-sizing: border-box; }
        .row input:focus, .row textarea:focus { border-color: var(--primary-color); outline: none; }
        .row textarea { min-height: 60px; font-family: monospace; font-size: 12px; resize: vertical; }
        .inline { display: flex; gap: 8px; }
        .inline > * { flex: 1; }
        .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
        .toggle-row label { margin: 0; font-size: 12px; color: var(--secondary-text-color); }
        .section { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--secondary-text-color); margin: 16px 0 6px; font-weight: 600; }
        .hint { font-size: 10px; color: var(--secondary-text-color); opacity: .6; margin-top: 2px; }
        .ac-list { display: none; position: absolute; z-index: 999; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-top: none; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,.15); }
        .ac-item { padding: 8px 10px; cursor: pointer; font-size: 13px; color: var(--primary-text-color); border-bottom: 1px solid var(--divider-color, #f0f0f0); }
        .ac-item:last-child { border-bottom: none; }
        .ac-item:hover, .ac-active { background: var(--primary-color, #03a9f4); color: #fff; }
        .ac-item:hover .ac-id, .ac-active .ac-id { color: rgba(255,255,255,.7); }
        .ac-id { font-size: 11px; color: var(--secondary-text-color); margin-left: 6px; }
        .seg-block { background: var(--secondary-background-color, #f5f5f5); border-radius: 8px; padding: 10px; margin-bottom: 6px; position: relative; }
        .seg-block .remove { position: absolute; top: 6px; right: 6px; cursor: pointer; color: var(--error-color, #ef4444); font-size: 16px; background: none; border: none; padding: 2px 4px; }
        .add-btn { cursor: pointer; color: var(--primary-color); font-size: 13px; font-weight: 500; padding: 8px 0; }
      </style>
      <div class="form">
        <div class="row"><label>${e.entity}</label><div class="ac-wrap"><input id="entity" value="${c.entity || ''}" autocomplete="off"></div></div>
        <div class="row"><label>${e.name}</label><input id="name" value="${c.name || ''}"></div>
        <div class="inline">
          <div class="row"><label>${e.min}</label><input id="min" type="number" value="${c.min ?? 0}"></div>
          <div class="row"><label>${e.max}</label><input id="max" type="number" value="${c.max ?? 100}"></div>
        </div>
        <div class="inline">
          <div class="row"><label>${e.unit}</label><input id="unit" value="${c.unit || ''}"></div>
          <div class="row"><label>${e.decimals}</label><input id="decimals" type="number" min="0" max="5" value="${c.decimals ?? 0}"></div>
          <div class="row"><label>${e.arc_width}</label><input id="arc_width" type="number" min="5" max="50" value="${c.arc_width ?? 20}"></div>
        </div>
        <div class="toggle-row"><label>${e.needle}</label><input type="checkbox" id="needle" ${c.needle !== false ? 'checked' : ''}></div>
        <div class="toggle-row"><label>${e.show_value}</label><input type="checkbox" id="show_value" ${c.show_value !== false ? 'checked' : ''}></div>
        <div class="toggle-row"><label>${e.show_name}</label><input type="checkbox" id="show_name" ${c.show_name !== false ? 'checked' : ''}></div>
        <div class="toggle-row"><label>${e.show_min_max}</label><input type="checkbox" id="show_min_max" ${c.show_min_max !== false ? 'checked' : ''}></div>
        <div class="toggle-row"><label>${e.show_ticks}</label><input type="checkbox" id="show_ticks" ${c.show_ticks !== false ? 'checked' : ''}></div>
        <div class="toggle-row"><label>${e.show_segments_label}</label><input type="checkbox" id="show_segments_label" ${c.show_segments_label ? 'checked' : ''}></div>
        <div class="section">${e.severity}</div>
        <div id="severity-list"></div>
        <div class="add-btn" id="add-seg">+ Add segment</div>
      </div>`;

    // Entity autocomplete
    const entInput = this.shadowRoot.getElementById('entity');
    this._setupAutocomplete(entInput, (val) => { this._config.entity = val; this._fireChanged(); });

    // Text inputs
    this.shadowRoot.getElementById('name')?.addEventListener('change', (ev) => {
      if (ev.target.value) this._config.name = ev.target.value; else delete this._config.name;
      this._fireChanged();
    });
    this.shadowRoot.getElementById('unit')?.addEventListener('change', (ev) => {
      if (ev.target.value) this._config.unit = ev.target.value; else delete this._config.unit;
      this._fireChanged();
    });

    // Number inputs
    ['min', 'max', 'decimals', 'arc_width'].forEach(id => {
      this.shadowRoot.getElementById(id)?.addEventListener('change', (ev) => {
        this._config[id] = parseFloat(ev.target.value); this._fireChanged();
      });
    });

    // Toggles
    ['needle', 'show_value', 'show_name', 'show_min_max', 'show_ticks', 'show_segments_label'].forEach(id => {
      this.shadowRoot.getElementById(id)?.addEventListener('change', (ev) => {
        this._config[id] = ev.target.checked; this._fireChanged();
      });
    });

    // Severity segments
    this._renderSeverity();
    this.shadowRoot.getElementById('add-seg')?.addEventListener('click', () => {
      if (!this._config.severity) this._config.severity = [];
      const last = this._config.severity[this._config.severity.length - 1];
      this._config.severity.push({ from: last ? last.to : 0, to: this._config.max ?? 100, color: '#3b82f6' });
      this._fireChanged(); this._renderSeverity();
    });
  }

  _renderSeverity() {
    const list = this.shadowRoot.getElementById('severity-list');
    if (!list) return;
    const segs = this._config.severity || DEFAULT_SEVERITY;

    list.innerHTML = segs.map((s, i) => `
      <div class="seg-block">
        <button class="remove" data-idx="${i}">×</button>
        <div class="inline">
          <div class="row"><label>From</label><input class="seg-field" data-idx="${i}" data-key="from" type="number" value="${s.from}"></div>
          <div class="row"><label>To</label><input class="seg-field" data-idx="${i}" data-key="to" type="number" value="${s.to}"></div>
          <div class="row"><label>Color</label><input class="seg-field" data-idx="${i}" data-key="color" type="color" value="${s.color}"></div>
        </div>
      </div>`).join('');

    list.querySelectorAll('.seg-field').forEach(el => {
      el.addEventListener('change', (ev) => {
        const idx = parseInt(ev.target.dataset.idx);
        const key = ev.target.dataset.key;
        if (!this._config.severity) this._config.severity = [...DEFAULT_SEVERITY];
        if (key === 'color') this._config.severity[idx][key] = ev.target.value;
        else this._config.severity[idx][key] = parseFloat(ev.target.value);
        this._fireChanged();
      });
    });

    list.querySelectorAll('.remove').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (!this._config.severity) this._config.severity = [...DEFAULT_SEVERITY];
        this._config.severity.splice(parseInt(ev.target.dataset.idx), 1);
        this._fireChanged(); this._renderSeverity();
      });
    });
  }
}

// ─── REGISTER ───

customElements.define('animated-gauge-card', AnimatedGaugeCard);
customElements.define('animated-gauge-card-editor', AnimatedGaugeCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'animated-gauge-card',
  name: 'Animated Gauge Card',
  description: 'Animated gauge card with needle, color segments, tick marks, and smooth value transitions',
  preview: true,
  documentationURL: 'https://github.com/smalarz/animated-gauge-card',
});

console.info(`%c ANIMATED-GAUGE-CARD %c v${VERSION} `, 'color:#fff;background:#f59e0b;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px', 'color:#f59e0b;background:#fef3c7;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0');
