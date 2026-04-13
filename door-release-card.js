
class DoorReleaseCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._armedUntil = 0;
    this._unlockUntil = 0;
    this._dragRatio = 0;
    this._dragging = false;
    this._ticker = null;
    this._armTimer = null;
    this._boundMove = null;
    this._boundUp = null;
    this._lastRender = 0;
    this._returnStartMs = 0;
    this._returnUntilMs = 0;
    this._returnAnimMs = 900;
    this._armActive = false;
    this._visualColors = null;
    this._simDoorOpen = false;
    this._simLastOpenMs = 0;
  }

  static getStubConfig() {
    return {
      type: "custom:door-release-card",
      contact_entity: "binary_sensor.haustuer_kontakt",
      open_script: "script.automatische_turoffnung",
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
    if (!simMode && !config.open_script && !(config.open_action && config.open_action.service)) {
      throw new Error(
        "door-release-card: set 'open_script' or provide 'open_action.service'.",
      );
    }
    this._config = {
      arm_timeout: 10,
      arm_threshold: 0.5,
      unlock_display_timeout: 5,
      contact_open_state: "on",
      treat_missing_as_locked: true,
      label_locked: "Locked",
      label_armed: "Armed",
      label_unlocked: "Unlocked",
      label_open: "Open",
      label_missing: "Entity missing",
      missing_detail_text: "Contact entity missing",
      last_opened_prefix: "Last opening",
      open_button_label: "Open door",
      show_last_changed: true,
      slider_return_ms: 900,
      simulation_mode: false,
      ...config,
    };
    this._render(true);
  }

  connectedCallback() {
    this._loadSimulationState();
    this._render(true);
    this._ensureTicker();
  }

  disconnectedCallback() {
    this._stopTicker();
    this._clearArmTimer();
    this._unbindPointerHandlers();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      min_rows: 1,
      max_rows: 10,
      min_columns: 4,
      max_columns: 12,
    };
  }

  _ensureTicker() {
    if (this._ticker) {
      return;
    }
    this._ticker = window.setInterval(() => {
      const now = Date.now();
      const stillArmed = now < this._armedUntil;
      const stillUnlock = now < this._unlockUntil;
      const stillReturning = now < this._returnUntilMs;
      if (!stillArmed && !stillUnlock && !stillReturning && !this._dragging) {
        this._dragRatio = 0;
      }
      this._render();
    }, 1000);
  }

  _stopTicker() {
    if (this._ticker) {
      window.clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  _clearArmTimer() {
    if (this._armTimer) {
      window.clearTimeout(this._armTimer);
      this._armTimer = null;
    }
  }

  _unbindPointerHandlers() {
    if (this._boundMove) {
      window.removeEventListener("pointermove", this._boundMove);
      this._boundMove = null;
    }
    if (this._boundUp) {
      window.removeEventListener("pointerup", this._boundUp);
      this._boundUp = null;
    }
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

  _isDoorOpen() {
    const entity = this._getContactStateObj();
    if (!entity) {
      return false;
    }
    return entity.state === this._config.contact_open_state;
  }

  _getStage(now = Date.now()) {
    if (!this._hass) {
      return "loading";
    }
    if (now < this._armedUntil) {
      return "armed";
    }
    if (now < this._returnUntilMs) {
      return "unlocked";
    }
    if (!this._getContactStateObj()) {
      if (this._config.treat_missing_as_locked) {
        return "locked";
      }
      return "missing";
    }
    if (this._isDoorOpen()) {
      return "open";
    }
    if (now < this._unlockUntil) {
      return "unlocked";
    }
    return "locked";
  }

  _getStageLabel(stage) {
    if (stage === "open") {
      return this._config.label_open;
    }
    if (stage === "armed") {
      return this._config.label_unlocked;
    }
    if (stage === "unlocked") {
      return this._config.label_unlocked;
    }
    if (stage === "missing") {
      return this._config.label_missing;
    }
    if (stage === "loading") {
      return "Loading";
    }
    return this._config.label_locked;
  }

  _formatDuration(seconds) {
    const totalMinutes = Math.max(0, Math.floor(seconds / 60));
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  _formatLastChanged() {
    const entity = this._getContactStateObj();
    if (!entity || !entity.last_changed || !this._config.show_last_changed) {
      return "";
    }
    const lastChanged = new Date(entity.last_changed).getTime();
    if (!Number.isFinite(lastChanged)) {
      return "";
    }
    const deltaSec = Math.max(0, Math.floor((Date.now() - lastChanged) / 1000));
    return `${this._formatDuration(deltaSec)} ago`;
  }

  _formatLastOpened() {
    if (this._config.simulation_mode) {
      if (!this._simLastOpenMs) {
        return "";
      }
      const deltaSec = Math.max(0, Math.floor((Date.now() - this._simLastOpenMs) / 1000));
      return `${this._config.last_opened_prefix} ${this._formatDuration(deltaSec)} ago`;
    }
    const scriptEntityId = this._config.open_script;
    if (!scriptEntityId || !this._hass?.states?.[scriptEntityId]) {
      return "";
    }
    const scriptState = this._hass.states[scriptEntityId];
    const ts = scriptState?.attributes?.last_triggered;
    if (!ts) {
      return "";
    }
    const lastTriggered = new Date(ts).getTime();
    if (!Number.isFinite(lastTriggered)) {
      return "";
    }
    const deltaSec = Math.max(0, Math.floor((Date.now() - lastTriggered) / 1000));
    return `${this._config.last_opened_prefix} ${this._formatDuration(deltaSec)} ago`;
  }

  _getStageColors(stage) {
    const defaults = {
      locked: { accent: "#43b252", track: "#d9ecdd", button: "#d9ecdd", text: "#101820" },
      armed: { accent: "#f1a33a", track: "#f7e4bd", button: "#f7d595", text: "#101820" },
      unlocked: { accent: "#dc5b4e", track: "#f4d3cf", button: "#f4d3cf", text: "#101820" },
      open: { accent: "#db5a4b", track: "#f4d3cf", button: "#f4d3cf", text: "#101820" },
      missing: { accent: "#8a8f98", track: "#d9dde3", button: "#d9dde3", text: "#101820" },
      loading: { accent: "#8a8f98", track: "#d9dde3", button: "#d9dde3", text: "#101820" },
    };
    return defaults[stage] ?? defaults.locked;
  }

  _hexToRgb(hex) {
    if (!hex || typeof hex !== "string") {
      return { r: 0, g: 0, b: 0 };
    }
    const rgbMatch = hex.match(/rgb\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*\)/i);
    if (rgbMatch) {
      return {
        r: Number(rgbMatch[1]) || 0,
        g: Number(rgbMatch[2]) || 0,
        b: Number(rgbMatch[3]) || 0,
      };
    }
    const value = hex.replace("#", "");
    if (value.length !== 6) {
      return { r: 0, g: 0, b: 0 };
    }
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  _mixColor(fromHex, toHex, t) {
    const a = this._hexToRgb(fromHex);
    const b = this._hexToRgb(toHex);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bch = Math.round(a.b + (b.b - a.b) * t);
    return `rgb(${r}, ${g}, ${bch})`;
  }

  _smoothColors(target) {
    if (!this._visualColors) {
      this._visualColors = { ...target };
      return { ...target };
    }
    const speed = 0.42;
    const out = {};
    for (const key of ["accent", "track", "button"]) {
      const current = this._visualColors[key];
      const next = target[key];
      if (current === next) {
        out[key] = next;
        continue;
      }
      out[key] = this._mixColor(current, next, speed);
      this._visualColors[key] = out[key];
    }
    out.text = target.text;
    return out;
  }

  _simStorageKey() {
    const id = this._config.open_script || this._config.contact_entity || "door-release";
    return `door-release-card-sim:${id}`;
  }

  _loadSimulationState() {
    if (!this._config.simulation_mode || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this._simStorageKey());
      if (!raw) {
        return;
      }
      const data = JSON.parse(raw);
      this._simDoorOpen = Boolean(data?.doorOpen);
      this._simLastOpenMs = Number(data?.lastOpenMs) || 0;
    } catch (_err) {
      // Ignore malformed local storage.
    }
  }

  _saveSimulationState() {
    if (!this._config.simulation_mode || !window.localStorage) {
      return;
    }
    try {
      const data = JSON.stringify({
        doorOpen: this._simDoorOpen,
        lastOpenMs: this._simLastOpenMs,
      });
      window.localStorage.setItem(this._simStorageKey(), data);
    } catch (_err) {
      // Ignore storage write failures.
    }
  }

  _toggleSimDoor() {
    this._simDoorOpen = !this._simDoorOpen;
    this._saveSimulationState();
    this._render(true);
  }

  _simulateMotorPulse() {
    const now = Date.now();
    this._simLastOpenMs = now;
    this._simDoorOpen = true;
    this._saveSimulationState();
    this._unlockUntil = now + Math.max(1, Number(this._config.unlock_display_timeout) || 5) * 1000;
    this._render(true);
  }

  _startReturnSequence() {
    const now = Date.now();
    const returnMs = Math.max(250, Number(this._config.slider_return_ms) || 900);
    const unlockTimeoutMs = Math.max(1, Number(this._config.unlock_display_timeout) || 5) * 1000;
    this._armedUntil = 0;
    this._armActive = false;
    this._clearArmTimer();
    this._returnStartMs = now;
    this._returnUntilMs = now + returnMs;
    this._returnAnimMs = returnMs;
    this._unlockUntil = now + Math.max(unlockTimeoutMs, returnMs);
    this._dragRatio = 1;
  }

  _startReturnOnly() {
    const now = Date.now();
    const returnMs = Math.max(250, Number(this._config.slider_return_ms) || 900);
    this._armedUntil = 0;
    this._armActive = false;
    this._clearArmTimer();
    this._returnStartMs = now;
    this._returnUntilMs = now + returnMs;
    this._returnAnimMs = returnMs;
    this._dragRatio = 1;
  }

  _getReturnRatio(now = Date.now()) {
    if (this._returnUntilMs <= this._returnStartMs) {
      return 0;
    }
    if (now <= this._returnStartMs) {
      return 1;
    }
    if (now >= this._returnUntilMs) {
      return 0;
    }
    const progress = (now - this._returnStartMs) / (this._returnUntilMs - this._returnStartMs);
    return Math.max(0, Math.min(1, 1 - progress));
  }

  _formatRemainingSeconds(ms) {
    return `${Math.max(0, Math.ceil(ms / 1000))}s`;
  }

  _arm() {
    const armTimeoutMs = Math.max(1, Number(this._config.arm_timeout) || 10) * 1000;
    this._armedUntil = Date.now() + armTimeoutMs;
    this._armActive = true;
    this._clearArmTimer();
    this._armTimer = window.setTimeout(() => {
      if (this._armActive) {
        this._startReturnOnly();
        this._render(true);
      }
    }, armTimeoutMs);
    this._returnStartMs = 0;
    this._returnUntilMs = 0;
    this._dragRatio = 1;
    this._render(true);
  }

  _resetArm() {
    this._armedUntil = 0;
    this._armActive = false;
    this._clearArmTimer();
    if (!this._dragging) {
      this._dragRatio = 0;
    }
  }

  _getPointerRatio(event) {
    if (!this._trackElement) {
      return 0;
    }
    const rect = this._trackElement.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, ratio));
  }

  _startDrag(event) {
    const stage = this._getStage();
    if (stage === "missing" || stage === "loading") {
      return;
    }
    this._dragging = true;
    this._dragRatio = this._getPointerRatio(event);
    this._boundMove = (moveEvent) => {
      if (!this._dragging) {
        return;
      }
      this._dragRatio = this._getPointerRatio(moveEvent);
      this._render();
    };
    this._boundUp = () => this._endDrag();
    window.addEventListener("pointermove", this._boundMove);
    window.addEventListener("pointerup", this._boundUp);
    this._render();
  }

  _endDrag() {
    this._dragging = false;
    const threshold = Math.max(0.3, Math.min(0.95, Number(this._config.arm_threshold) || 0.5));
    if (this._dragRatio >= threshold) {
      this._arm();
    } else {
      this._resetArm();
      this._render();
    }
    this._unbindPointerHandlers();
  }

  async _triggerOpen() {
    const now = Date.now();
    if (now >= this._armedUntil) {
      return;
    }
    // Always start the UI transition immediately on button press.
    this._startReturnSequence();

    if (this._config.simulation_mode) {
      this._simulateMotorPulse();
      return;
    }

    const openAction = this._config.open_action ?? null;
    let service = openAction?.service;
    let data = { ...(openAction?.data ?? {}) };

    if (!service) {
      service = "script.turn_on";
      data.entity_id = this._config.open_script;
    }

    const parts = service.split(".");
    if (parts.length !== 2) {
      return;
    }
    const [domain, serviceName] = parts;

    this._hass.callService(domain, serviceName, data).catch(() => {
      // Keep UI behavior deterministic even if backend call fails.
    });
    this._render(true);
  }

  _render(force = false) {
    if (!this._config || !Object.keys(this._config).length) {
      return;
    }

    const now = Date.now();
    if (!force && now - this._lastRender < 80) {
      return;
    }
    this._lastRender = now;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    const stage = this._getStage(now);
    const colors = this._smoothColors(this._getStageColors(stage));
    const statusLabel = this._getStageLabel(stage);
    const hasContactEntity = Boolean(this._getContactStateObj());
    const lastOpenedDetail = this._formatLastOpened();
    const lastChangedDetail = this._formatLastChanged();
    const armMsLeft = Math.max(0, this._armedUntil - now);
    const returnMsLeft = Math.max(0, this._returnUntilMs - now);
    const unlockMsLeft = Math.max(0, this._unlockUntil - now);
    const unlockedMsLeft = returnMsLeft > 0 ? returnMsLeft : unlockMsLeft;
    const statusDetail =
      stage === "armed"
        ? `Auto reset in ${this._formatRemainingSeconds(armMsLeft)}`
        : stage === "unlocked" && unlockedMsLeft > 0
          ? `Auto reset in ${this._formatRemainingSeconds(unlockedMsLeft)}`
          : stage === "locked"
            ? lastOpenedDetail || lastChangedDetail
            : lastChangedDetail ||
            (!hasContactEntity ? this._config.missing_detail_text : "");

    const buttonEnabled = stage === "armed";
    const openLabel = this._config.open_button_label;
    const isReturning = now < this._returnUntilMs && this._returnUntilMs > this._returnStartMs;
    const returnRatio = this._getReturnRatio(now);
    const sliderRatio = this._dragging ? this._dragRatio : buttonEnabled ? 1 : returnRatio;
    const containerWidth = Math.max(320, this.clientWidth || this.offsetWidth || 560);
    const containerHeight = Math.max(120, this.clientHeight || this.offsetHeight || 160);
    const compactLayout = containerWidth < 460;
    const tinyLayout = containerWidth < 380;
    const statusWidth = compactLayout
      ? Math.max(120, Math.min(188, Math.round(containerWidth * 0.44)))
      : Math.max(132, Math.min(220, Math.round(containerWidth * 0.29)));
    const buttonWidth = compactLayout
      ? Math.max(94, Math.min(128, Math.round(containerWidth * 0.29)))
      : Math.max(110, Math.min(152, Math.round(containerWidth * 0.22)));
    const widthBasedHeight = compactLayout
      ? Math.max(70, Math.min(98, Math.round(containerWidth * 0.165)))
      : Math.max(74, Math.min(108, Math.round(containerWidth * 0.145)));
    const cardPadding = Math.max(10, Math.min(18, Math.round(containerHeight * 0.11)));
    const availableInnerHeight = Math.max(62, containerHeight - (cardPadding * 2));
    const heightBasedHeight = Math.max(62, Math.min(170, availableInnerHeight));
    const cardHeight = Math.min(Math.max(widthBasedHeight, heightBasedHeight), availableInnerHeight);
    const titleSize = 28;
    const detailSize = Math.max(11, Math.min(16, Math.round(cardHeight * 0.17)));
    const buttonTextSize = Math.max(15, Math.min(22, Math.round(cardHeight * 0.3)));
    const knobWidth = Math.max(84, Math.round(cardHeight * 1.22));
    const knobHeight = Math.max(56, cardHeight - 6);
    const knobRadius = Math.max(16, Math.round(knobHeight * 0.35));
    const cardRadius = Math.max(18, Math.round(cardHeight * 0.36));
    const lockOpenish = stage === "armed" || stage === "unlocked" || stage === "open";
    const lockIcon = lockOpenish ? "mdi:lock-open-variant-outline" : "mdi:lock-outline";
    const openBtnTop = buttonEnabled ? this._mixColor(colors.accent, "#ffffff", 0.18) : colors.button;
    const openBtnBottom = buttonEnabled ? this._mixColor(colors.accent, "#000000", 0.08) : colors.button;

    const knobClass = `knob ${stage === "armed" ? "knob-armed" : ""}`;
    const openBtnClass = `open-btn ${buttonEnabled ? "open-btn-active" : "open-btn-idle"}`;
    const wrapClass = `wrap ${compactLayout ? "wrap-compact" : ""}`;
    const detailClass = `detail ${tinyLayout ? "detail-hidden" : ""}`;
    const simDoorLabel = this._simDoorOpen ? "Door: Open" : "Door: Closed";
    const simModeControls = this._config.simulation_mode
      ? `
          <div class="sim-controls">
            <button class="sim-btn" id="simDoorBtn">${simDoorLabel}</button>
            <button class="sim-btn" id="simPulseBtn">Motor pulse</button>
          </div>
        `
      : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
        }
        ha-card {
          border-radius: var(--ha-card-border-radius, 12px);
          padding: ${cardPadding}px;
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0, 0, 0, 0.08));
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .wrap {
          display: flex;
          gap: 12px;
          align-items: center;
          height: 100%;
          min-width: 0;
        }
        .wrap-compact {
          display: flex;
          gap: 10px;
        }
        .status {
          flex: 0 0 ${statusWidth}px;
          min-width: 0;
          padding-left: 2px;
        }
        .wrap-compact .status {
          flex: 0 0 ${statusWidth}px;
        }
        .title {
          margin: 0;
          font-size: ${titleSize}px;
          line-height: normal;
          letter-spacing: normal;
          font-weight: 400;
          color: rgb(20, 20, 20);
          font-family: Roboto, "Noto Sans", sans-serif;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .detail {
          margin-top: 6px;
          min-height: 20px;
          font-size: ${detailSize}px;
          color: #4f5561;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .detail-hidden {
          display: none;
        }
        .slider {
          flex: 1 1 auto;
          min-width: 0;
          position: relative;
          height: ${cardHeight}px;
          --knob-width: ${knobWidth}px;
          --knob-pad: 4px;
          border-radius: ${cardRadius}px;
          background: ${colors.track};
          overflow: hidden;
          touch-action: none;
          user-select: none;
          transition: background-color 260ms ease;
        }
        .wrap-compact .slider {
          flex: 1 1 auto;
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
          left: calc(var(--knob-pad) + (100% - var(--knob-width) - (var(--knob-pad) * 2)) * ${sliderRatio.toFixed(4)});
          width: var(--knob-width);
          height: ${knobHeight}px;
          border-radius: ${knobRadius}px;
          background: ${colors.accent};
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          transition: ${this._dragging ? "none" : `left ${isReturning ? this._returnAnimMs : 180}ms cubic-bezier(0.2, 0.82, 0.28, 1), background-color 220ms ease`};
          box-shadow: 0 5px 12px rgba(0, 0, 0, 0.14);
          cursor: grab;
        }
        .knob-armed {
          box-shadow: 0 6px 14px rgba(241, 163, 58, 0.35);
        }
        .lock-icon {
          --mdc-icon-size: 28px;
          color: #fff;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18));
        }
        .knob:active {
          cursor: grabbing;
        }
        .open-btn {
          flex: 0 0 ${buttonWidth}px;
          min-width: ${buttonWidth}px;
          max-width: ${buttonWidth}px;
          border: none;
          border-radius: ${Math.max(16, cardRadius - 4)}px;
          height: ${cardHeight}px;
          background: linear-gradient(180deg, ${openBtnTop} 0%, ${openBtnBottom} 100%);
          color: ${buttonEnabled ? "white" : colors.text};
          font-size: ${buttonTextSize}px;
          font-weight: 520;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
          cursor: ${buttonEnabled ? "pointer" : "not-allowed"};
          transition: background 220ms ease, color 220ms ease, opacity 220ms ease, box-shadow 220ms ease, transform 120ms ease, filter 160ms ease;
          opacity: ${buttonEnabled ? "1" : "0.72"};
        }
        .wrap-compact .open-btn {
          flex: 0 0 ${buttonWidth}px;
        }
        .open-btn-active {
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.4),
            inset 0 0 0 3px rgba(255, 255, 255, 0.56),
            0 8px 16px rgba(170, 112, 34, 0.34);
        }
        .open-btn-active:hover {
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.5),
            inset 0 0 0 3px rgba(255, 255, 255, 0.7),
            0 10px 18px rgba(170, 112, 34, 0.4);
          filter: saturate(1.03);
        }
        .open-btn-active:active {
          transform: translateY(1px) scale(0.99);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.32),
            inset 0 0 0 3px rgba(255, 255, 255, 0.52),
            0 5px 10px rgba(170, 112, 34, 0.3);
        }
        .open-btn-idle {
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.52);
        }
        .open-btn:focus-visible {
          outline: 2px solid #377cfb;
          outline-offset: 2px;
        }
        .sim-controls {
          margin-top: 8px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-btn {
          border: 1px solid rgba(0, 0, 0, 0.14);
          background: rgba(0, 0, 0, 0.03);
          border-radius: 10px;
          padding: 4px 8px;
          font-size: 12px;
          cursor: pointer;
          color: #1f2937;
        }
        @media (max-width: 680px) {
          .title {
            font-size: ${titleSize}px;
          }
          .slider,
          .open-btn {
            height: ${Math.max(56, cardHeight - 6)}px;
          }
          .knob {
            height: ${Math.max(48, knobHeight - 6)}px;
            width: ${Math.max(72, knobWidth - 8)}px;
            --knob-width: ${Math.max(72, knobWidth - 8)}px;
            border-radius: ${Math.max(14, knobRadius - 4)}px;
          }
        }
      </style>
      <ha-card>
        <div class="${wrapClass}">
          <div class="status">
            <div class="title">${statusLabel}</div>
            <div class="${detailClass}">${statusDetail}</div>
            ${simModeControls}
          </div>
          <div class="slider" id="sliderTrack">
            <div class="${knobClass}" id="sliderKnob" title="Slide to arm">
              <ha-icon class="lock-icon" icon="${lockIcon}"></ha-icon>
            </div>
          </div>
          <button class="${openBtnClass}" id="openButton" ${buttonEnabled ? "" : "disabled"}>
            ${openLabel}
          </button>
        </div>
      </ha-card>
    `;

    this._trackElement = this.shadowRoot.querySelector("#sliderTrack");
    const knob = this.shadowRoot.querySelector("#sliderKnob");
    const openButton = this.shadowRoot.querySelector("#openButton");
    const simDoorBtn = this.shadowRoot.querySelector("#simDoorBtn");
    const simPulseBtn = this.shadowRoot.querySelector("#simPulseBtn");

    if (knob) {
      knob.onpointerdown = (event) => this._startDrag(event);
    }
    if (openButton) {
      openButton.onpointerdown = (event) => {
        event.preventDefault();
        this._triggerOpen();
      };
      openButton.onclick = (event) => event.preventDefault();
    }
    if (simDoorBtn) {
      simDoorBtn.onclick = () => this._toggleSimDoor();
    }
    if (simPulseBtn) {
      simPulseBtn.onclick = () => this._simulateMotorPulse();
    }
  }
}

class DoorReleaseCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _value(key, fallback = "") {
    const v = this._config?.[key];
    return v === undefined || v === null ? fallback : v;
  }

  _onInput(event) {
    const target = event.target;
    const key = target.dataset.key;
    if (!key) {
      return;
    }
    let value;
    if (target.type === "number") {
      value = target.value === "" ? undefined : Number(target.value);
    } else if (target.type === "checkbox") {
      value = target.checked;
    } else {
      value = target.value;
    }

    const next = { ...this._config };
    if (value === undefined || value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }

    this._config = next;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _entityOptions(prefix) {
    if (!this._hass?.states) {
      return "";
    }
    return Object.keys(this._hass.states)
      .filter((entityId) => entityId.startsWith(prefix))
      .sort()
      .map((entityId) => `<option value="${entityId}"></option>`)
      .join("");
  }

  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    const contactList = this._entityOptions("binary_sensor.");
    const scriptList = this._entityOptions("script.");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .wrap { display:grid; gap:12px; }
        .section {
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 12px;
          background: color-mix(in srgb, var(--card-background-color) 92%, var(--primary-color) 8%);
        }
        .section-title {
          margin: 0 0 10px 0;
          font-size: 13px;
          font-weight: 700;
          color: var(--primary-text-color);
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .row { display:grid; gap:6px; margin-bottom: 10px; }
        .row:last-child { margin-bottom: 0; }
        label { font-weight:600; font-size:13px; }
        input {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          padding: 8px 10px;
          font: inherit;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        input[disabled] {
          opacity: 0.75;
          cursor: not-allowed;
        }
        .grid {
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap:10px;
        }
      </style>
      <div class="wrap">
        <div class="section">
          <div class="section-title">Entities</div>
          <div class="row">
            <label>Contact Entity</label>
            <input data-key="contact_entity" list="contact_entities" value="${this._value("contact_entity", "binary_sensor.haustuer_kontakt")}">
            <datalist id="contact_entities">${contactList}</datalist>
          </div>
          <div class="row">
            <label>Open Script</label>
            <input data-key="open_script" list="script_entities" value="${this._value("open_script", "script.automatische_turoffnung")}">
            <datalist id="script_entities">${scriptList}</datalist>
          </div>
        </div>
        <div class="section">
          <div class="section-title">Behavior</div>
          <div class="grid">
            <div class="row">
              <label>Arm Timeout (s)</label>
              <input data-key="arm_timeout" type="number" min="1" value="${this._value("arm_timeout", 10)}">
            </div>
            <div class="row">
              <label>Unlock Display (s)</label>
              <input data-key="unlock_display_timeout" type="number" min="1" value="${this._value("unlock_display_timeout", 5)}">
            </div>
            <div class="row">
              <label>Slider Return (ms)</label>
              <input data-key="slider_return_ms" type="number" min="250" step="50" value="${this._value("slider_return_ms", 900)}">
            </div>
            <div class="row">
              <label>Simulation Mode</label>
              <input data-key="simulation_mode" type="checkbox" ${this._value("simulation_mode", false) ? "checked" : ""}>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="section-title">Layout</div>
          <div class="row">
            <label>Adaptive by Dashboard Grid</label>
            <input value="Card scales automatically with tile size (no pixel settings)." disabled>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll("input").forEach((el) => {
      el.oninput = (event) => this._onInput(event);
      el.onchange = (event) => this._onInput(event);
    });
  }
}

if (!customElements.get("door-release-card")) {
  customElements.define("door-release-card", DoorReleaseCard);
}
if (!customElements.get("door-release-card-editor")) {
  customElements.define("door-release-card-editor", DoorReleaseCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "door-release-card",
  name: "Door Release Card",
  description:
    "Slider-armed door release card for contact sensor + open script workflows.",
});

