const CARD_VERSION = "1.4.0";

const TRANSLATIONS = {
  en: {
    locked: "Locked",
    unlocked: "Unlocked",
    open: "Open",
    missing: "Entity missing",
    missing_detail: "Contact entity missing",
    loading: "Loading",
    open_button: "Open door",
    last_opened: "Opened",
    ago: (d) => `${d} ago`,
    minutes: (m) => `${m}m`,
    hours: (h, m) => `${h}h ${m}m`,
    countdown: (s) => `Auto reset in ${s}s`,
    ready: (s) => `Ready · ${s}s`,
    failed: "Failed",
    slide_to_arm: "Slide to arm",
    sim_door_open: "Door: Open",
    sim_door_closed: "Door: Closed",
    sim_pulse: "Motor pulse",
  },
  de: {
    locked: "Verriegelt",
    unlocked: "Entriegelt",
    open: "Offen",
    missing: "Entität fehlt",
    missing_detail: "Türkontakt nicht gefunden",
    loading: "Lädt",
    open_button: "Tür öffnen",
    last_opened: "Geöffnet",
    ago: (d) => `vor ${d}`,
    minutes: (m) => `${m} Min.`,
    hours: (h, m) => `${h} Std. ${m} Min.`,
    countdown: (s) => `Sperrt wieder in ${s} s`,
    ready: (s) => `Freigegeben · ${s} s`,
    failed: "Fehler",
    slide_to_arm: "Zum Freigeben schieben",
    sim_door_open: "Tür: Offen",
    sim_door_closed: "Tür: Zu",
    sim_pulse: "Motorimpuls",
  },
};

// config.language "en" / "de" wins, otherwise follow the Home Assistant UI language.
function resolveLanguage(config, hass) {
  const wanted = config?.language && config.language !== "auto"
    ? config.language
    : hass?.locale?.language || hass?.language || navigator.language || "en";
  return String(wanted).toLowerCase().startsWith("de") ? "de" : "en";
}

// Stage colors as OKLCH [lightness, chroma, hue]. Animating the three channels separately
// lets a color change travel around the hue circle instead of fading through a muddy brown.
// Sliding only enables the button, the door stays locked: "armed" is a brighter green.
const STAGE_ACCENTS = {
  locked: [0.678, 0.169, 145.8],
  armed: [0.74, 0.19, 143],
  unlocked: [0.634, 0.164, 28.4],
  open: [0.631, 0.165, 29.2],
  missing: [0.649, 0.015, 262.4],
  loading: [0.649, 0.015, 262.4],
};

// Waypoints for the way back from red to green; keep the sweep bright instead of olive.
const SWEEP_ORANGE = [0.775, 0.147, 69.8];
const SWEEP_YELLOW = [0.82, 0.16, 100];

for (const name of ["--drc-l", "--drc-c", "--drc-h"]) {
  try {
    CSS.registerProperty({ name, syntax: "<number>", inherits: true, initialValue: "0" });
  } catch (_err) {
    // Already registered (card loaded twice) or not supported: colors then switch without animation.
  }
}

const CARD_STYLE = `
  :host {
    display: block;
    height: 100%;
    --drc-l: ${STAGE_ACCENTS.locked[0]};
    --drc-c: ${STAGE_ACCENTS.locked[1]};
    --drc-h: ${STAGE_ACCENTS.locked[2]};
    --drc-accent: oklch(var(--drc-l) var(--drc-c) var(--drc-h));
    --drc-card-bg: var(--ha-card-background, var(--card-background-color, #fff));
    --drc-go: oklch(${STAGE_ACCENTS.armed.join(" ")});
    --drc-btn-idle: color-mix(in srgb, var(--secondary-text-color, #6b7280) 16%, var(--drc-card-bg));
    --drc-track: color-mix(in srgb, var(--drc-accent) 20%, var(--drc-card-bg));
    /* 72px controls + 12px padding keep the card within the standard 2-row height. */
    --control-h: 72px;
    --knob-w: 64px;
    --btn-w: var(--control-h);
  }
  ha-card {
    display: block;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    padding: 12px;
    container-type: inline-size;
  }
  .wrap {
    display: flex;
    gap: 12px;
    align-items: center;
    height: 100%;
    min-width: 0;
  }
  .status {
    /* Fixed basis so the slider does not shift when the status text changes.
       The status column is the only part that gives way on narrow cards. */
    flex: 0 1 124px;
    max-width: 124px;
    min-width: 0;
    padding-left: 2px;
  }
  .title {
    margin: 0;
    font-size: 22px;
    font-weight: 400;
    color: var(--primary-text-color, #141414);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .detail {
    margin-top: 4px;
    min-height: 18px;
    font-size: 13px;
    color: var(--secondary-text-color, #4f5561);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .detail.error {
    color: var(--error-color, #db4437);
  }
  .slider {
    flex: 1 1 0;
    min-width: calc(var(--knob-w) + 48px);
    position: relative;
    height: var(--control-h);
    --knob-pad: 4px;
    --ratio: 0;
    border-radius: 20px;
    background-color: var(--drc-track);
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .slider::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgba(40, 55, 40, 0.07);
    pointer-events: none;
  }
  .knob {
    position: absolute;
    top: var(--knob-pad);
    left: calc(var(--knob-pad) + (100% - var(--knob-w) - (var(--knob-pad) * 2)) * var(--ratio));
    width: var(--knob-w);
    height: calc(var(--control-h) - (var(--knob-pad) * 2));
    border-radius: 16px;
    background-color: var(--drc-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition:
      left var(--drc-knob-ms, 180ms) cubic-bezier(0.2, 0.82, 0.28, 1),
      box-shadow 220ms ease;
    box-shadow: 0 5px 12px rgba(0, 0, 0, 0.14);
    cursor: grab;
    outline: none;
  }
  .slider.dragging .knob {
    transition: box-shadow 220ms ease;
    cursor: grabbing;
  }
  .slider.disabled .knob {
    cursor: default;
  }
  .knob:focus-visible {
    box-shadow: 0 0 0 3px var(--drc-card-bg), 0 0 0 5px var(--primary-color, #377cfb);
  }
  .knob.armed {
    box-shadow: 0 6px 14px rgba(52, 168, 83, 0.35);
  }
  .lock-icon {
    width: 28px;
    height: 28px;
    color: #fff;
    overflow: visible;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18));
    pointer-events: none;
  }
  /* The shackle lifts step by step while the knob is dragged towards the button. */
  .lock-shackle {
    transform-box: view-box;
    transform-origin: 8px 14px;
    transform: translateY(calc(var(--drc-open, 0) * -3px)) rotate(calc(var(--drc-open, 0) * -14deg));
    transition: transform 260ms cubic-bezier(0.2, 0.82, 0.28, 1);
  }
  .slider.dragging .lock-shackle {
    transition: none;
  }
  .lock-keyhole {
    fill: var(--drc-accent);
  }
  .open-btn {
    flex: 0 0 var(--btn-w);
    width: var(--btn-w);
    height: var(--control-h);
    border: none;
    border-radius: 20px;
    /* Grey while locked; turns green step by step while the knob is dragged. */
    background-color: color-mix(in srgb, var(--drc-go) calc(var(--drc-progress, 0) * 70%), var(--drc-btn-idle));
    color: var(--primary-text-color, #101820);
    font: inherit;
    font-size: 16px;
    line-height: 1.2;
    padding: 0 6px;
    font-weight: 500;
    cursor: not-allowed;
    opacity: calc(0.72 + var(--drc-progress, 0) * 0.28);
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.52);
    transition: background-color 220ms ease, color 220ms ease, opacity 220ms ease,
      box-shadow 220ms ease, transform 120ms ease;
    -webkit-tap-highlight-color: transparent;
  }
  .open-btn.active {
    background-color: var(--drc-accent);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(0, 0, 0, 0.08));
    color: #fff;
    cursor: pointer;
    opacity: 1;
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.4),
      inset 0 0 0 3px rgba(255, 255, 255, 0.56),
      0 8px 16px rgba(40, 140, 64, 0.34);
  }
  .open-btn.active:hover {
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.5),
      inset 0 0 0 3px rgba(255, 255, 255, 0.7),
      0 10px 18px rgba(40, 140, 64, 0.4);
  }
  .open-btn.active:active {
    transform: translateY(1px) scale(0.99);
  }
  .open-btn:focus-visible {
    outline: 2px solid var(--primary-color, #377cfb);
    outline-offset: 2px;
  }
  .sim-controls {
    margin-top: 8px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sim-controls[hidden] {
    display: none;
  }
  .sim-btn {
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
    background: transparent;
    border-radius: 10px;
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    color: var(--primary-text-color, #1f2937);
  }
  /* Narrow cards: the status text gives way first, the button always keeps its size. */
  @container (max-width: 340px) {
    .wrap {
      --knob-w: 56px;
    }
    .status {
      max-width: 100px;
    }
    .title {
      font-size: 20px;
    }
  }
  @container (max-width: 290px) {
    .status {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .knob,
    .slider,
    .open-btn {
      transition: none;
    }
  }
`;

class DoorReleaseCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._armedUntil = 0;
    this._unlockUntil = 0;
    this._returnUntilMs = 0;
    this._returnAnimMs = 900;
    this._dragRatio = 0;
    this._dragging = false;
    this._dragPointerId = null;
    this._armTimer = null;
    this._tickTimer = null;
    this._simDoorOpen = false;
    this._simLastOpenMs = 0;
    this._errorText = "";
    this._errorUntil = 0;
    this._els = null;
    this._lastEntityRefs = null;
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states ?? {});
    return {
      type: "custom:door-release-card",
      contact_entity:
        ids.find((id) => id.startsWith("binary_sensor.") && /door|tuer|tür|haustuer/i.test(id)) ??
        "binary_sensor.haustuer_kontakt",
      open_script: ids.find((id) => id.startsWith("script.")) ?? "script.automatische_turoffnung",
      slider_return_ms: 900,
      simulation_mode: false,
    };
  }

  static getConfigElement() {
    return document.createElement("door-release-card-editor");
  }

  setConfig(config) {
    const simMode = Boolean(config?.simulation_mode);
    if (!simMode && (!config || !config.contact_entity)) {
      throw new Error("door-release-card: 'contact_entity' is required.");
    }
    if (!simMode && !config.open_script && !config.open_action?.service) {
      throw new Error("door-release-card: set 'open_script' or provide 'open_action.service'.");
    }
    if (config.open_action?.service && String(config.open_action.service).split(".").length !== 2) {
      throw new Error("door-release-card: 'open_action.service' must look like 'domain.service'.");
    }
    this._config = {
      arm_timeout: 10,
      arm_threshold: 0.5,
      unlock_display_timeout: 5,
      contact_open_state: "on",
      treat_missing_as_locked: true,
      show_last_changed: true,
      slider_return_ms: 900,
      simulation_mode: false,
      ...config,
    };
    this._lastEntityRefs = null;
    this._loadSimulationState();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    // HA pushes a new hass object on every state change of any entity.
    // Only update when one of the entities this card depends on changed.
    const refs = [
      hass?.states?.[this._config.contact_entity],
      hass?.states?.[this._config.open_script],
      resolveLanguage(this._config, hass),
    ];
    if (this._els && this._lastEntityRefs && refs.every((ref, i) => ref === this._lastEntityRefs[i])) {
      return;
    }
    this._lastEntityRefs = refs;
    this._update();
  }

  connectedCallback() {
    this._update();
  }

  disconnectedCallback() {
    window.clearTimeout(this._tickTimer);
    this._tickTimer = null;
    this._clearArmTimer();
    this._dragging = false;
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      rows: 2,
      columns: 12,
      min_rows: 2,
      max_rows: 2,
      min_columns: 12,
      max_columns: 12,
    };
  }

  // ---------- helpers ----------

  _seconds(key, fallback, min = 1) {
    return Math.max(min, Number(this._config[key]) || fallback);
  }

  _clearArmTimer() {
    window.clearTimeout(this._armTimer);
    this._armTimer = null;
  }

  _getContactStateObj() {
    if (this._config.simulation_mode) {
      return {
        state: this._simDoorOpen ? this._config.contact_open_state : "off",
        last_changed: new Date().toISOString(),
      };
    }
    return this._hass?.states?.[this._config.contact_entity] ?? null;
  }

  _getStage(now = Date.now()) {
    if (!this._hass && !this._config.simulation_mode) {
      return "loading";
    }
    if (now < this._armedUntil) {
      return "armed";
    }
    // Slider returning after "Open door" (not after a plain arm timeout).
    if (now < this._returnUntilMs && now < this._unlockUntil) {
      return "unlocked";
    }
    const entity = this._getContactStateObj();
    if (!entity) {
      return this._config.treat_missing_as_locked ? "locked" : "missing";
    }
    if (entity.state === this._config.contact_open_state) {
      return "open";
    }
    if (now < this._unlockUntil) {
      return "unlocked";
    }
    return "locked";
  }

  get _t() {
    return TRANSLATIONS[resolveLanguage(this._config, this._hass)];
  }

  // A text set in the config always wins over the built-in translation.
  _text(configKey, translationKey) {
    const custom = this._config[configKey];
    return custom === undefined || custom === null || custom === "" ? this._t[translationKey] : String(custom);
  }

  _getStageLabel(stage) {
    switch (stage) {
      case "open":
        return this._text("label_open", "open");
      case "armed":
        // Sliding only enables the button; the door itself is still locked.
        return this._config.label_armed || this._text("label_locked", "locked");
      case "unlocked":
        return this._text("label_unlocked", "unlocked");
      case "missing":
        return this._text("label_missing", "missing");
      case "loading":
        return this._t.loading;
      default:
        return this._text("label_locked", "locked");
    }
  }

  _formatAgo(timestamp) {
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) {
      return "";
    }
    const totalMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    const t = this._t;
    const duration =
      totalMinutes < 60 ? t.minutes(totalMinutes) : t.hours(Math.floor(totalMinutes / 60), totalMinutes % 60);
    return t.ago(duration);
  }

  _formatLastChanged() {
    const entity = this._getContactStateObj();
    if (!entity?.last_changed || !this._config.show_last_changed || this._config.simulation_mode) {
      return "";
    }
    return this._formatAgo(entity.last_changed);
  }

  _formatLastOpened() {
    const ts = this._config.simulation_mode
      ? this._simLastOpenMs || null
      : this._hass?.states?.[this._config.open_script]?.attributes?.last_triggered;
    if (!ts) {
      return "";
    }
    const ago = this._formatAgo(ts);
    return ago ? `${this._text("last_opened_prefix", "last_opened")} ${ago}` : "";
  }

  _getStatusDetail(stage, now) {
    if (now < this._errorUntil) {
      return { text: this._errorText, error: true };
    }
    const countdown = (ms) => this._t.countdown(Math.max(0, Math.ceil(ms / 1000)));
    if (stage === "armed") {
      return { text: this._t.ready(Math.max(0, Math.ceil((this._armedUntil - now) / 1000))) };
    }
    if (stage === "unlocked") {
      const left = Math.max(this._returnUntilMs, this._unlockUntil) - now;
      if (left > 0) {
        return { text: countdown(left) };
      }
    }
    if (stage === "locked") {
      return { text: this._formatLastOpened() || this._formatLastChanged() };
    }
    if (stage === "missing") {
      return { text: this._text("missing_detail_text", "missing_detail") };
    }
    return { text: this._formatLastChanged() };
  }

  // ---------- simulation ----------

  _simStorageKey() {
    const id = this._config.open_script || this._config.contact_entity || "door-release";
    return `door-release-card-sim:${id}`;
  }

  _loadSimulationState() {
    if (!this._config.simulation_mode) {
      return;
    }
    try {
      const data = JSON.parse(window.localStorage.getItem(this._simStorageKey()) || "null");
      this._simDoorOpen = Boolean(data?.doorOpen);
      this._simLastOpenMs = Number(data?.lastOpenMs) || 0;
    } catch (_err) {
      // Ignore missing or malformed local storage.
    }
  }

  _saveSimulationState() {
    if (!this._config.simulation_mode) {
      return;
    }
    try {
      window.localStorage.setItem(
        this._simStorageKey(),
        JSON.stringify({ doorOpen: this._simDoorOpen, lastOpenMs: this._simLastOpenMs }),
      );
    } catch (_err) {
      // Ignore storage write failures.
    }
  }

  _toggleSimDoor() {
    this._simDoorOpen = !this._simDoorOpen;
    this._saveSimulationState();
    this._update();
  }

  _simulateMotorPulse() {
    const now = Date.now();
    this._simLastOpenMs = now;
    this._simDoorOpen = true;
    this._saveSimulationState();
    this._unlockUntil = now + this._seconds("unlock_display_timeout", 5) * 1000;
    this._update();
  }

  // ---------- state transitions ----------

  _startReturn(withUnlockWindow) {
    const now = Date.now();
    const returnMs = this._seconds("slider_return_ms", 900, 250);
    this._armedUntil = 0;
    this._clearArmTimer();
    this._returnUntilMs = now + returnMs;
    this._returnAnimMs = returnMs;
    if (withUnlockWindow) {
      this._unlockUntil = now + Math.max(this._seconds("unlock_display_timeout", 5) * 1000, returnMs);
    }
  }

  _arm() {
    const armTimeoutMs = this._seconds("arm_timeout", 10) * 1000;
    this._armedUntil = Date.now() + armTimeoutMs;
    this._returnUntilMs = 0;
    this._clearArmTimer();
    this._armTimer = window.setTimeout(() => {
      this._startReturn(false);
      this._update();
    }, armTimeoutMs);
    this._update();
  }

  _disarm() {
    this._armedUntil = 0;
    this._clearArmTimer();
    this._update();
  }

  _threshold() {
    return Math.max(0.3, Math.min(0.95, Number(this._config.arm_threshold) || 0.5));
  }

  _canInteract() {
    const stage = this._getStage();
    return stage !== "missing" && stage !== "loading";
  }

  _getPointerRatio(event) {
    const rect = this._els.track.getBoundingClientRect();
    const knobW = this._els.knob.offsetWidth || 0;
    const usable = Math.max(1, rect.width - knobW);
    // Center the knob under the pointer instead of snapping its left edge to it.
    const ratio = (event.clientX - rect.left - knobW / 2) / usable;
    return Math.max(0, Math.min(1, ratio));
  }

  _onPointerDown(event) {
    if (!this._canInteract() || event.button > 0) {
      return;
    }
    event.preventDefault();
    this._dragging = true;
    this._dragPointerId = event.pointerId;
    this._dragOffset = this._getPointerRatio(event) - this._currentRatio();
    try {
      this._els.knob.setPointerCapture(event.pointerId);
    } catch (_err) {
      // Pointer already released; the drag still works without capture.
    }
    this._dragRatio = this._currentRatio();
    this._update();
  }

  _onPointerMove(event) {
    if (!this._dragging || event.pointerId !== this._dragPointerId) {
      return;
    }
    this._dragRatio = Math.max(0, Math.min(1, this._getPointerRatio(event) - this._dragOffset));
    this._applyDragProgress(Math.min(1, this._dragRatio / this._threshold()));
    this._els.track.style.setProperty("--ratio", this._dragRatio.toFixed(4));
  }

  _onPointerUp(event) {
    if (!this._dragging || event.pointerId !== this._dragPointerId) {
      return;
    }
    this._dragging = false;
    this._dragPointerId = null;
    if (event.type !== "pointercancel" && this._dragRatio >= this._threshold()) {
      this._arm();
    } else {
      this._disarm();
    }
  }

  _onKnobKey(event) {
    if (!this._canInteract()) {
      return;
    }
    if (["Enter", " ", "ArrowRight", "End"].includes(event.key)) {
      event.preventDefault();
      this._arm();
    } else if (["Escape", "ArrowLeft", "Home"].includes(event.key) && this._getStage() === "armed") {
      event.preventDefault();
      this._disarm();
    }
  }

  async _triggerOpen() {
    if (Date.now() >= this._armedUntil) {
      return;
    }
    this._startReturn(true);

    if (this._config.simulation_mode) {
      this._simulateMotorPulse();
      return;
    }

    const openAction = this._config.open_action ?? null;
    let service = openAction?.service;
    const data = { ...(openAction?.data ?? {}) };
    if (!service) {
      service = "script.turn_on";
      data.entity_id = this._config.open_script;
    }
    const [domain, serviceName] = service.split(".");
    this._update();

    try {
      await this._hass.callService(domain, serviceName, data, openAction?.target);
    } catch (err) {
      this._errorText = `${this._t.failed}: ${err?.message || err?.code || "service call"}`;
      this._errorUntil = Date.now() + 6000;
      this._update();
    }
  }

  // ---------- rendering ----------

  _currentRatio(now = Date.now()) {
    if (this._dragging) {
      return this._dragRatio;
    }
    return now < this._armedUntil ? 1 : 0;
  }

  _build() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${CARD_STYLE}</style>
      <ha-card>
        <div class="wrap">
          <div class="status">
            <div class="title" aria-live="polite"></div>
            <div class="detail"></div>
            <div class="sim-controls" hidden>
              <button class="sim-btn" data-sim="door" type="button"></button>
              <button class="sim-btn" data-sim="pulse" type="button"></button>
            </div>
          </div>
          <div class="slider">
            <div class="knob" role="switch" tabindex="0">
              <svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path class="lock-shackle" d="M8 14V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor"
                  stroke-width="2.2" stroke-linecap="round" />
                <rect x="4.5" y="11" width="15" height="10.5" rx="2.5" fill="currentColor" />
                <path class="lock-keyhole" d="M12 13.9a1.7 1.7 0 0 1 .85 3.17v1.63h-1.7v-1.63A1.7 1.7 0 0 1 12 13.9z" />
              </svg>
            </div>
          </div>
          <button class="open-btn" type="button" disabled></button>
        </div>
      </ha-card>
    `;
    const $ = (sel) => root.querySelector(sel);
    this._els = {
      title: $(".title"),
      detail: $(".detail"),
      sim: $(".sim-controls"),
      simDoor: $('[data-sim="door"]'),
      simPulse: $('[data-sim="pulse"]'),
      track: $(".slider"),
      knob: $(".knob"),
      button: $(".open-btn"),
    };
    const { knob, button, simDoor } = this._els;
    knob.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    knob.addEventListener("pointermove", (e) => this._onPointerMove(e));
    knob.addEventListener("pointerup", (e) => this._onPointerUp(e));
    knob.addEventListener("pointercancel", (e) => this._onPointerUp(e));
    knob.addEventListener("lostpointercapture", (e) => this._onPointerUp(e));
    knob.addEventListener("keydown", (e) => this._onKnobKey(e));
    button.addEventListener("click", () => this._triggerOpen());
    simDoor.addEventListener("click", () => this._toggleSimDoor());
    this._els.simPulse.addEventListener("click", () => this._simulateMotorPulse());
  }

  _setText(el, text) {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }

  _update() {
    if (!this._config || !Object.keys(this._config).length || !this.isConnected) {
      return;
    }
    if (!this._els) {
      this._build();
    }
    const now = Date.now();
    const stage = this._getStage(now);
    const armed = stage === "armed";
    const returning = now < this._returnUntilMs;
    const { title, detail, sim, simDoor, simPulse, track, knob, button } = this._els;
    const t = this._t;

    if (!this._dragging) {
      this._setAccent(stage);
    }

    this._setText(title, this._getStageLabel(stage));
    const status = this._getStatusDetail(stage, now);
    this._setText(detail, status.text || "");
    detail.classList.toggle("error", Boolean(status.error));

    sim.hidden = !this._config.simulation_mode;
    this._setText(simDoor, this._simDoorOpen ? t.sim_door_open : t.sim_door_closed);
    this._setText(simPulse, t.sim_pulse);

    const interactive = stage !== "missing" && stage !== "loading";
    track.classList.toggle("dragging", this._dragging);
    track.classList.toggle("disabled", !interactive);
    track.style.setProperty("--drc-knob-ms", `${returning ? this._returnAnimMs : 180}ms`);
    if (!this._dragging) {
      track.style.setProperty("--ratio", String(this._currentRatio(now)));
      button.style.removeProperty("--drc-progress");
      knob.style.setProperty("--drc-open", stage === "unlocked" || stage === "open" ? "1" : "0");
    }
    knob.classList.toggle("armed", armed);
    if (knob.title !== t.slide_to_arm) {
      knob.title = t.slide_to_arm;
      knob.setAttribute("aria-label", t.slide_to_arm);
    }
    knob.setAttribute("aria-checked", String(armed));
    knob.setAttribute("aria-disabled", String(!interactive));

    this._setText(button, this._text("open_button_label", "open_button"));
    button.disabled = !armed;
    button.classList.toggle("active", armed);

    this._scheduleTick(now);
  }

  // While dragging, the button turns from grey to green and the knob brightens slightly,
  // in step with the slide distance (progress 1 = arm threshold reached). The lock stays closed.
  _applyDragProgress(progress) {
    this._els.button.style.setProperty("--drc-progress", progress.toFixed(3));
    this._accentAnim?.cancel();
    const from = STAGE_ACCENTS.locked;
    const to = STAGE_ACCENTS.armed;
    ["--drc-l", "--drc-c", "--drc-h"].forEach((name, i) => {
      this.style.setProperty(name, String(from[i] + (to[i] - from[i]) * progress));
    });
    // Forces the next _setAccent to animate from this in-between color.
    this._accent = "drag";
  }

  _setAccent(stage) {
    const target = STAGE_ACCENTS[stage] ?? STAGE_ACCENTS.locked;
    const prevStage = this._accentStage;
    if (this._accent === target) {
      return;
    }
    this._accentStage = stage;
    const toFrame = ([l, c, h]) => ({ "--drc-l": String(l), "--drc-c": String(c), "--drc-h": String(h) });
    const computed = getComputedStyle(this);
    const from = ["--drc-l", "--drc-c", "--drc-h"].map((name) => parseFloat(computed.getPropertyValue(name)));
    // No animation for the first paint or when leaving the grey loading / missing state.
    const first = !this._accent || prevStage === "loading" || prevStage === "missing";
    this._accent = target;
    const frame = toFrame(target);
    for (const [name, value] of Object.entries(frame)) {
      this.style.setProperty(name, value);
    }
    this._accentAnim?.cancel();
    if (first || !this.animate || from.some((v) => !Number.isFinite(v)) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    // Going back to locked is a slow, calm fade. From red it sweeps through bright orange
    // and yellow (the stages in reverse) instead of passing through a dark olive.
    const frames = [toFrame(from)];
    let duration = 450;
    if ((prevStage === "unlocked" || prevStage === "open") && stage === "locked") {
      frames.push(toFrame(SWEEP_ORANGE), toFrame(SWEEP_YELLOW));
      duration = 1200;
    } else if (prevStage === "armed" && stage === "locked") {
      duration = Math.max(600, this._returnAnimMs);
    }
    frames.push(frame);
    this._accentAnim = this.animate(frames, { duration, easing: "ease-in-out" });
  }

  _scheduleTick(now) {
    window.clearTimeout(this._tickTimer);
    // Fast ticks while a countdown or animation is running, slow ticks for "Xm ago".
    const deadlines = [this._armedUntil, this._returnUntilMs, this._unlockUntil, this._errorUntil]
      .filter((t) => t > now)
      .map((t) => t - now);
    const delay = deadlines.length
      ? Math.min(1000 - (now % 1000) + 5, Math.min(...deadlines) + 5)
      : 30000;
    this._tickTimer = window.setTimeout(() => this._update(), delay);
  }
}

const EDITOR_TRANSLATIONS = {
  en: {
    contact_entity: "Door contact",
    open_script: "Door opener script",
    language: "Language",
    lang_auto: "Automatic (Home Assistant)",
    timing: "Timing",
    arm_timeout: "Button enabled for",
    unlock_display_timeout: "Show as unlocked for",
    slider_return_ms: "Slider return animation",
    arm_threshold: "Slide distance to enable the button",
    texts: "Texts",
    texts_helper: "Leave empty to use the default text",
    open_button_label: "Button",
    label_locked: "Locked",
    label_unlocked: "Unlocked",
    label_armed: "Button enabled",
    label_open: "Open",
    advanced: "Advanced",
    show_last_changed: "Show time since last door change",
    treat_missing_as_locked: "Show as locked if contact entity is missing",
    simulation_mode: "Simulation mode (for testing, nothing is triggered)",
    default: "Default",
  },
  de: {
    contact_entity: "Türkontakt",
    open_script: "Skript zum Türöffnen",
    language: "Sprache",
    lang_auto: "Automatisch (Home Assistant)",
    timing: "Zeiten",
    arm_timeout: "Button freigegeben für",
    unlock_display_timeout: "Als entriegelt anzeigen für",
    slider_return_ms: "Rücklauf-Animation des Schiebers",
    arm_threshold: "Schiebeweg zur Freigabe",
    texts: "Texte",
    texts_helper: "Leer lassen für den Standardtext",
    open_button_label: "Button",
    label_locked: "Verriegelt",
    label_unlocked: "Entriegelt",
    label_armed: "Button freigegeben",
    label_open: "Offen",
    advanced: "Erweitert",
    show_last_changed: "Zeit seit letzter Türänderung anzeigen",
    treat_missing_as_locked: "Als verriegelt anzeigen, wenn der Kontakt fehlt",
    simulation_mode: "Simulationsmodus (zum Testen, löst nichts aus)",
    default: "Standard",
  },
};

// Values the form shows when the config does not set them; they are not written back.
const FORM_DEFAULTS = {
  language: "auto",
  arm_timeout: 10,
  unlock_display_timeout: 5,
  arm_threshold: 0.5,
  slider_return_ms: 900,
  show_last_changed: true,
  treat_missing_as_locked: true,
  simulation_mode: false,
};

// Default texts shown as hint under each text field.
const TEXT_DEFAULTS = {
  open_button_label: "open_button",
  label_locked: "locked",
  label_unlocked: "unlocked",
  label_armed: "locked",
  label_open: "open",
};

class DoorReleaseCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._form = null;
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    const langChanged = resolveLanguage(this._config, hass) !== resolveLanguage(this._config, this._hass);
    this._hass = hass;
    if (this._form) {
      this._form.hass = hass;
      if (langChanged) {
        this._render();
      }
    } else {
      this._render();
    }
  }

  connectedCallback() {
    this._ensureFormLoaded();
  }

  // ha-form is lazy-loaded by Home Assistant; loading a built-in card editor pulls it in.
  async _ensureFormLoaded() {
    if (customElements.get("ha-form")) {
      return;
    }
    try {
      const helpers = await window.loadCardHelpers?.();
      const card = await helpers?.createCardElement({ type: "entities", entities: [] });
      await card?.constructor?.getConfigElement?.();
    } catch (_err) {
      // Ignore; the form renders once ha-form is defined.
    }
    await customElements.whenDefined("ha-form");
    this._render();
  }

  _schema(t) {
    const tr = TRANSLATIONS[resolveLanguage(this._config, this._hass)];
    const text = (name) => ({ name, selector: { text: {} }, _default: tr[TEXT_DEFAULTS[name]] });
    return [
      { name: "contact_entity", selector: { entity: { domain: "binary_sensor" } } },
      { name: "open_script", selector: { entity: { domain: "script" } } },
      {
        name: "language",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: t.lang_auto },
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" },
            ],
          },
        },
      },
      {
        type: "expandable",
        name: "",
        flatten: true,
        title: t.timing,
        icon: "mdi:timer-outline",
        schema: [
          {
            type: "grid",
            name: "",
            schema: [
              { name: "arm_timeout", selector: { number: { min: 1, max: 120, mode: "box", unit_of_measurement: "s" } } },
              { name: "unlock_display_timeout", selector: { number: { min: 1, max: 120, mode: "box", unit_of_measurement: "s" } } },
            ],
          },
          { name: "arm_threshold", selector: { number: { min: 0.3, max: 0.95, step: 0.05, mode: "slider" } } },
          { name: "slider_return_ms", selector: { number: { min: 250, max: 3000, step: 50, mode: "slider", unit_of_measurement: "ms" } } },
        ],
      },
      {
        type: "expandable",
        name: "",
        flatten: true,
        title: t.texts,
        icon: "mdi:format-text",
        schema: [
          { type: "grid", name: "", schema: Object.keys(TEXT_DEFAULTS).map(text) },
        ],
      },
      {
        type: "expandable",
        name: "",
        flatten: true,
        title: t.advanced,
        icon: "mdi:cog-outline",
        schema: [
          { name: "show_last_changed", selector: { boolean: {} } },
          { name: "treat_missing_as_locked", selector: { boolean: {} } },
          { name: "simulation_mode", selector: { boolean: {} } },
        ],
      },
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) {
      return;
    }
    const t = EDITOR_TRANSLATIONS[resolveLanguage(this._config, this._hass)];
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (e) => this._onChange(e.detail.value));
      (this.shadowRoot ?? this.attachShadow({ mode: "open" })).append(this._form);
    }
    const schema = this._schema(t);
    const defaults = new Map();
    const collect = (items) =>
      items.forEach((item) => (item.schema ? collect(item.schema) : item._default && defaults.set(item.name, item._default)));
    collect(schema);

    this._form.computeLabel = (item) => t[item.name] ?? item.title ?? item.name;
    this._form.computeHelper = (item) =>
      defaults.has(item.name) ? `${t.default}: ${defaults.get(item.name)}` : undefined;
    this._form.hass = this._hass;
    this._form.schema = schema;
    this._form.data = { ...FORM_DEFAULTS, ...this._config };
  }

  _onChange(value) {
    const next = { ...value };
    for (const [key, val] of Object.entries(next)) {
      const isDefault = key in FORM_DEFAULTS && val === FORM_DEFAULTS[key] && !(key in this._config);
      if (val === undefined || val === null || val === "" || isDefault || (key === "language" && val === "auto")) {
        delete next[key];
      }
    }
    this._config = next;
    this._render();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("door-release-card")) {
  customElements.define("door-release-card", DoorReleaseCard);
}
if (!customElements.get("door-release-card-editor")) {
  customElements.define("door-release-card-editor", DoorReleaseCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "door-release-card")) {
  window.customCards.push({
    type: "door-release-card",
    name: "Door Release Card",
    description: "Slider-armed door release card for contact sensor + open script workflows.",
    preview: true,
    documentationURL: "https://github.com/42bios/door-release-card",
  });
}

console.info(`%c DOOR-RELEASE-CARD %c v${CARD_VERSION} `, "color:#fff;background:#43b252", "color:#43b252");
