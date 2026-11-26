/**
 * VoiceCore ↔ THE TITAN Engine Room integration (v2.3)
 * Comprehensive natural-language commands with rich phrase variation.
 */
(function (global) {
  "use strict";

  // ---------- helpers ----------
  function safeCall(fn) {
    try { return fn(); } catch (e) { console.warn("[VoiceCoreTitan]", e); }
  }

  function setSwitch(key, on) {
    // Terminal crisis interlock: assistant cannot close main breaker until HTML is repaired
    if (key === "main" && on && global.TerminalUI && TerminalUI.crisisActive && !TerminalUI.crisisCleared) {
      if (global.Game && Game.log) {
        Game.log("BLOCKED (voice): Main breaker interlocked open until engineering terminal is repaired.");
      }
      try {
        if (global.TerminalUI.speak) {
          TerminalUI.speak("Main breaker interlock active. Repair the terminal under the dashboard first.");
        }
      } catch (_) {}
      var btnBlock = document.querySelector('.switch[data-switch="main"]');
      if (btnBlock) {
        btnBlock.setAttribute("aria-pressed", "false");
        btnBlock.textContent = "OFF";
      }
      if (global.Game && Game.state && Game.state.electrics) Game.state.electrics.main = false;
      return;
    }
    if (global.InputManager && typeof InputManager.applySwitch === "function") {
      InputManager.applySwitch(key, on);
      const btn = document.querySelector('.switch[data-switch="' + key + '"]');
      if (btn) {
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.textContent = on ? "ON" : "OFF";
      }
      return;
    }
    const st = global.Game && Game.state;
    if (!st) return;
    const map = {
      main: () => { st.electrics.main = on; },
      motor1: () => { st.electrics.motor1 = on; },
      motor2: () => { st.electrics.motor2 = on; },
      starter: () => { st.electrics.starter = on; },
      aux: () => { st.electrics.aux = on; },
      "lub-pump": () => { st.cooling.lubPump = on; },
      "sw-pump": () => { st.cooling.swPump = on; },
      generator: () => { st.reactor.generator = on; },
      "auto-reg": () => { st.regulator.autoReg = on; },
      clutch: () => { st.motors.clutch = on; }
    };
    if (map[key]) map[key]();
  }

  function setSlider(id, value) {
    const st = global.Game && Game.state;
    if (!st) return;
    value = Math.max(0, Math.min(id === "targetRpm" ? 1200 : 100, Number(value) || 0));
    if (id === "throttle") st.regulator.throttle = value;
    else if (id === "targetRpm") st.motors.targetRpm = value;
    else if (id === "fuelFeed") st.reactor.fuelFeed = value;
    else if (id === "airIntake") st.reactor.airIntake = value;
    else if (id === "lubCooler") st.cooling.lubCooler = value;
    else if (id === "h2oCooler") st.cooling.h2oCooler = value;

    const domMap = {
      throttle: "slider-throttle",
      targetRpm: "slider-rpm",
      fuelFeed: "slider-fuel",
      airIntake: "slider-air",
      lubCooler: "slider-lub-cooler",
      h2oCooler: "slider-h2o-cooler"
    };
    const el = document.getElementById(domMap[id]);
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function showSector(id) {
    if (global.InputManager && InputManager.showSector) {
      InputManager.showSector(id);
    }
  }

  function showHolo(zone) {
    if (global.HologramUI) {
      if (zone) HologramUI.show(zone);
      else if (HologramUI.zone) HologramUI.show(HologramUI.zone);
    }
  }

  function hideHolo() {
    if (global.HologramUI) HologramUI.hide();
  }


  function showMapOverlay(on) {
    let el = document.getElementById("vc-nav-map-overlay");
    if (!on) {
      if (el) {
        el.classList.remove("show");
        if (el._navTimer) { clearInterval(el._navTimer); el._navTimer = null; }
      }
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "vc-nav-map-overlay";
      el.innerHTML =
        '<div class="vc-nav-card">' +
        '<div class="vc-nav-title">NAV — OWN SHIP <span id="vc-nav-clock"></span></div>' +
        '<canvas id="vc-nav-canvas" width="512" height="512"></canvas>' +
        '<button type="button" class="vc-nav-close" id="vc-nav-close">Close projection</button>' +
        "</div>";
      const host =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement ||
        document.getElementById("game") ||
        document.body;
      host.appendChild(el);
      el.querySelector("#vc-nav-close").addEventListener("click", () => showMapOverlay(false));
      if (!document.getElementById("vc-nav-map-style")) {
        const s = document.createElement("style");
        s.id = "vc-nav-map-style";
        s.textContent =
          "#vc-nav-map-overlay{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;background:rgba(0,8,24,0.62);backdrop-filter:blur(5px)}" +
          "#vc-nav-map-overlay.show{display:flex}" +
          /* Windowed default card */
          ".vc-nav-card{width:min(420px,94vw);background:#061018;border:1px solid #1f6feb;border-radius:14px;padding:0.9rem 1rem 1rem;color:#e6edf3;font-family:ui-monospace,monospace;box-shadow:0 0 50px rgba(31,111,235,0.4);transform-origin:center center}" +
          ".vc-nav-title{color:#58a6ff;letter-spacing:0.12em;font-size:0.72rem;margin-bottom:0.55rem;display:flex;justify-content:space-between}" +
          "#vc-nav-canvas{width:100%;height:auto;border-radius:8px;border:1px solid #1a4060;background:#061018;display:block}" +
          ".vc-nav-close{margin-top:0.75rem;width:100%;padding:0.5rem;border-radius:7px;border:1px solid #30363d;background:#0d1b2a;color:#e6edf3;cursor:pointer}" +
          /* Fullscreen / immersive: full layout reduced by 35% (scale 0.65) */
          "#game.immersive #vc-nav-map-overlay .vc-nav-card," +
          "#game.pseudo-fullscreen #vc-nav-map-overlay .vc-nav-card," +
          ":fullscreen #vc-nav-map-overlay .vc-nav-card," +
          ":-webkit-full-screen #vc-nav-map-overlay .vc-nav-card," +
          ".vc-nav-card.vc-nav-fs-compact{width:min(273px,61vw);transform:scale(0.65);transform-origin:center center}" +
          ".vc-nav-card.vc-nav-fs-compact #vc-nav-canvas{image-rendering:auto}";
        document.head.appendChild(s);
      }
    }
    el.classList.add("show");
    // Attach under fullscreen root so CSS :fullscreen / #game.immersive applies
    try {
      const fsRoot =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement ||
        document.getElementById("game") ||
        document.body;
      if (el.parentElement !== fsRoot) fsRoot.appendChild(el);
    } catch (_) {}
    const card = el.querySelector(".vc-nav-card");
    const isFs = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      (document.getElementById("game") &&
        document.getElementById("game").classList.contains("immersive"))
    );
    if (card) {
      // Full layout reduced by 35% on fullscreen / immersive
      card.classList.toggle("vc-nav-fs-compact", isFs);
      if (isFs) {
        card.style.width = "min(273px, 61vw)";
        card.style.transform = "scale(0.65)";
        card.style.transformOrigin = "center center";
      } else {
        card.style.width = "";
        card.style.transform = "";
      }
    }
    const canvas = el.querySelector("#vc-nav-canvas");
    const clock = el.querySelector("#vc-nav-clock");
    const trail = el._trail || (el._trail = []);

    function draw() {
      if (!el.classList.contains("show")) return;
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      const s = (global.Game && Game.state && Game.state.sensors) || {};
      const speed = s.shipSpeedKn || 0;
      const lat = s.latitude != null ? s.latitude : 25.2048;
      const lon = s.longitude != null ? s.longitude : 55.2708;
      const hdg = s.headingDeg != null ? s.headingDeg : 48;

      ctx.fillStyle = "#061018";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#1f6feb";
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, W - 12, H - 12);

      ctx.fillStyle = "#58a6ff";
      ctx.font = "bold 20px monospace";
      ctx.fillText("NAV — OWN SHIP", 22, 34);

      const mx = 36, my = 52, mw = W - 72, mh = H - 190;
      ctx.fillStyle = "rgba(18,55,85,0.55)";
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = "#1a4060";
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        const gy = my + (mh * i) / 6;
        const gx = mx + (mw * i) / 6;
        ctx.beginPath(); ctx.moveTo(mx, gy); ctx.lineTo(mx + mw, gy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, my); ctx.lineTo(gx, my + mh); ctx.stroke();
      }

      const sx = mx + mw / 2, sy = my + mh / 2;
      trail.push({ lat: lat, lon: lon });
      if (trail.length > 50) trail.shift();
      const scale = 8000;
      ctx.strokeStyle = "rgba(63,185,80,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((p, i) => {
        const x = sx + (p.lon - lon) * scale;
        const y = sy - (p.lat - lat) * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // contacts
      [
        { lat: 25.21, lon: 55.28, label: "TRF-2" },
        { lat: 25.19, lon: 55.25, label: "BUOY" },
        { lat: 25.22, lon: 55.30, label: "VES-9" }
      ].forEach((p) => {
        const x = sx + (p.lon - lon) * scale;
        const y = sy - (p.lat - lat) * scale;
        if (x < mx || x > mx + mw || y < my || y > my + mh) return;
        ctx.fillStyle = "#d29922";
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#c9d1d9";
        ctx.font = "12px monospace";
        ctx.fillText(p.label, x + 10, y + 4);
      });

      // own ship
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(hdg * Math.PI / 180);
      ctx.fillStyle = "#3fb950";
      ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(12, 20); ctx.lineTo(0, 12); ctx.lineTo(-12, 20);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      const latStr = (lat >= 0 ? "N " : "S ") + Math.abs(lat).toFixed(5) + "°";
      const lonStr = (lon >= 0 ? "E " : "W ") + Math.abs(lon).toFixed(5) + "°";
      ctx.fillStyle = "#e6edf3";
      ctx.font = "bold 17px monospace";
      ctx.fillText("LAT  " + latStr, 22, H - 100);
      ctx.fillText("LON  " + lonStr, 22, H - 74);
      const kmh = s.speedKmh != null ? s.speedKmh : speed * 1.852;
      ctx.fillStyle = kmh > 0.5 ? "#3fb950" : "#8b949e";
      ctx.fillText("SOG  " + kmh.toFixed(1) + " km/h  (" + speed.toFixed(1) + " kn)", 22, H - 48);
      ctx.fillStyle = "#e6edf3";
      ctx.fillText("HDG  " + hdg.toFixed(0) + "°", 22, H - 22);

      const now = new Date();
      const ts = String(now.getHours()).padStart(2, "0") + ":" +
        String(now.getMinutes()).padStart(2, "0") + ":" +
        String(now.getSeconds()).padStart(2, "0");
      if (clock) clock.textContent = "UTC " + ts;
      ctx.fillStyle = "#58a6ff";
      ctx.font = "12px monospace";
      ctx.fillText("LIVE", W - 60, 34);
    }

    draw();
    if (el._navTimer) clearInterval(el._navTimer);
    el._navTimer = setInterval(draw, 500);
  }

  // Motor alternation timer
  let motorAltTimer = null;
  let motorAltSeconds = 60;

  function stopMotorAlt() {
    if (motorAltTimer) {
      clearInterval(motorAltTimer);
      motorAltTimer = null;
    }
  }

  function startMotorAlt(seconds) {
    seconds = Math.max(10, Math.min(300, Number(seconds) || 60));
    motorAltSeconds = seconds;
    stopMotorAlt();
    // Ensure one motor on to start
    const st = global.Game && Game.state;
    if (st) {
      if (!st.electrics.motor1 && !st.electrics.motor2) {
        setSwitch("motor1", true);
        setSwitch("motor2", false);
      }
    }
    motorAltTimer = setInterval(() => {
      const s = global.Game && Game.state;
      if (!s) return;
      const m1 = !!s.electrics.motor1;
      setSwitch("motor1", !m1);
      setSwitch("motor2", m1);
      if (global.Game && Game.log) {
        Game.log("Motor feed alternated (every " + motorAltSeconds + "s).");
      }
    }, motorAltSeconds * 1000);
  }

  /** Extract numbers from spoken text (supports digits and simple words) */
  function extractNumbers(text) {
    const WORD = {
      zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
      seventy: 70, eighty: 80, ninety: 90, hundred: 100
    };
    const t = String(text || "").toLowerCase();
    const nums = [];
    // digits first
    const digitRe = /\b(\d{1,4})\b/g;
    let m;
    while ((m = digitRe.exec(t))) nums.push(Number(m[1]));
    if (nums.length) return nums;
    // word numbers
    const tokens = t.replace(/[^a-z\s]/g, " ").split(/\s+/);
    for (const tok of tokens) {
      if (WORD[tok] != null) nums.push(WORD[tok]);
    }
    return nums;
  }

  function registerAll() {
    const R = global.VoiceCore.register.bind(global.VoiceCore);

    // ===== Brave wake / sleep =====
    R({
      name: "brave_activate",
      phrases: [
        "brave activate", "activate brave", "hey brave", "hi brave", "ok brave", "okay brave",
        "brave online", "brave wake up", "wake up brave", "brave open", "open brave",
        "show brave", "brave engage", "engage brave", "start brave", "brave start",
        "assistant activate", "activate assistant", "voice activate", "activate voice",
        "engage", "activate", "turn on", "brave", "wake up"
      ],
      action: () => { if (global.VoiceCore && VoiceCore.activate) VoiceCore.activate(); },
      response: ""
    });
    R({
      name: "brave_disengage",
      phrases: [
        "brave disengage", "disengage brave", "brave offline", "brave sleep", "sleep brave",
        "brave close", "close brave", "hide brave", "brave hide", "brave standby", "stand by brave",
        "assistant disengage", "disengage assistant", "voice off", "turn off voice",
        "deactivate", "disengage", "go to sleep", "stop listening", "brave shut down",
        "this engage", "dis engage", "dengage", "deseengage", "these engage", "disengaged",
        "brave disengaged", "stand down", "stand down brave", "brave stand down",
        "go offline", "brave go offline", "sleep mode", "dismiss brave", "dismiss assistant"
      ],
      action: () => { if (global.VoiceCore && VoiceCore.disengage) VoiceCore.disengage(); },
      response: ""
    });

    // ===== Electrics / motors =====
    R({
      name: "main_breaker_on",
      phrases: [
        "close main breaker", "main breaker on", "turn on main breaker", "close the breaker",
        "main on", "power bus on", "energize bus", "energise bus", "close breaker"
      ],
      action: () => setSwitch("main", true),
      response: "Main breaker closed."
    });
    R({
      name: "main_breaker_off",
      phrases: [
        "open main breaker", "main breaker off", "turn off main breaker", "open the breaker",
        "main off", "power bus off", "de-energize bus", "open breaker"
      ],
      action: () => setSwitch("main", false),
      response: "Main breaker open.",
      confirm: true
    });

    R({
      name: "motor1_on",
      phrases: [
        "motor one on", "motor 1 on", "turn on motor one", "turn on motor 1",
        "feed motor one", "feed motor 1", "enable motor one", "start motor one",
        "switch on motor one", "motor one feed", "activate motor one", "activate motor 1",
        "motor number one on", "motor number 1 on", "power motor one", "power motor 1",
        "only motor one", "just motor one", "motor one only"
      ],
      action: () => setSwitch("motor1", true),
      response: "Motor one feed on."
    });
    R({
      name: "motor1_off",
      phrases: [
        "motor one off", "motor 1 off", "turn off motor one", "turn off motor 1",
        "motor number one off", "power off motor one", "stop motor one", "kill motor one",
        "stop motor one", "disable motor one", "deactivate motor one", "cut motor one"
      ],
      action: () => setSwitch("motor1", false),
      response: "Motor one feed off."
    });
    R({
      name: "motor2_on",
      phrases: [
        "motor two on", "motor 2 on", "turn on motor two", "turn on motor 2",
        "feed motor two", "feed motor 2", "enable motor two", "start motor two",
        "switch on motor two", "motor two feed", "activate motor two", "activate motor 2",
        "turn on motor too", "motor to on", "motor number two on", "motor number 2 on",
        "power motor two", "power motor 2", "only motor two", "just motor two", "motor two only"
      ],
      action: () => setSwitch("motor2", true),
      response: "Motor two feed on."
    });
    R({
      name: "motor2_off",
      phrases: [
        "motor two off", "motor 2 off", "turn off motor two", "turn off motor 2",
        "stop motor two", "disable motor two", "deactivate motor two", "cut motor two",
        "turn off motor too"
      ],
      action: () => setSwitch("motor2", false),
      response: "Motor two feed off."
    });

    R({
      name: "starter_on",
      phrases: ["starter on", "turn on starter", "enable starter", "start starter"],
      action: () => setSwitch("starter", true),
      response: "Starter on."
    });
    R({
      name: "starter_off",
      phrases: ["starter off", "turn off starter", "disable starter"],
      action: () => setSwitch("starter", false),
      response: "Starter off."
    });
    R({
      name: "aux_on",
      phrases: ["aux on", "auxiliary on", "turn on aux", "aux bus on", "enable aux"],
      action: () => setSwitch("aux", true),
      response: "Auxiliary bus on."
    });
    R({
      name: "aux_off",
      phrases: ["aux off", "auxiliary off", "turn off aux", "aux bus off"],
      action: () => setSwitch("aux", false),
      response: "Auxiliary bus off."
    });

    // Motor alternation (heat management — switch feeds every X seconds)
    R({
      name: "motor_alt_start",
      phrases: [
        "alternate motors", "switch motors", "alternate motor feeds", "rotate motors",
        "switch between motors", "alternate motor one and two", "motor alternation",
        "start motor alternation", "cycle motors", "swap motors periodically",
        "alternate every sixty seconds", "alternate every 60 seconds",
        "switch motors every minute", "rotate motor feeds"
      ],
      action: () => {
        // Try extract seconds from last utterance
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        const sec = nums.find((n) => n >= 10 && n <= 300) || 60;
        startMotorAlt(sec);
      },
      response: () => "Alternating motor feeds every " + motorAltSeconds + " seconds."
    });
    R({
      name: "motor_alt_stop",
      phrases: [
        "stop alternating motors", "stop motor alternation", "cancel motor alternation",
        "stop switching motors", "hold motors", "stop cycling motors"
      ],
      action: () => stopMotorAlt(),
      response: "Motor alternation stopped."
    });

    // ===== Generator / reactor =====
    R({
      name: "generator_on",
      phrases: [
        "start generator", "generator on", "turn on generator", "reactor on",
        "start reactor", "enable generator", "bring generator online", "spin up generator"
      ],
      action: () => setSwitch("generator", true),
      response: "Generator online."
    });
    R({
      name: "generator_off",
      phrases: [
        "stop generator", "generator off", "turn off generator", "reactor off",
        "stop reactor", "shutdown generator", "take generator offline"
      ],
      action: () => setSwitch("generator", false),
      response: "Generator offline."
    });

    // Regulate reactor core: fuel + air (e.g. "regulate reactor 30 50")
    R({
      name: "reactor_regulate",
      phrases: [
        "regulate reactor", "regulate the reactor", "regulate reactor core",
        "regulate the reactor core", "set reactor", "set reactor core",
        "reactor fuel and air", "balance reactor", "set fuel and air",
        "adjust reactor", "reactor settings", "tune reactor"
      ],
      action: () => {
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        let fuel = nums[0];
        let air = nums[1];
        if (fuel == null) fuel = 40;
        if (air == null) air = 50;
        fuel = Math.max(0, Math.min(100, fuel));
        air = Math.max(0, Math.min(100, air));
        setSlider("fuelFeed", fuel);
        setSlider("airIntake", air);
        // stash for response
        VoiceCoreTitan._lastFuel = fuel;
        VoiceCoreTitan._lastAir = air;
      },
      response: () => {
        const f = VoiceCoreTitan._lastFuel != null ? VoiceCoreTitan._lastFuel : 40;
        const a = VoiceCoreTitan._lastAir != null ? VoiceCoreTitan._lastAir : 50;
        return "Reactor set. Fuel " + f + " percent, air " + a + " percent.";
      }
    });
    R({
      name: "fuel_set",
      phrases: [
        "set fuel", "fuel feed", "set fuel feed", "fuel to", "increase fuel", "decrease fuel",
        "raise fuel", "lower fuel", "fuel feed to"
      ],
      action: () => {
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        const v = nums.length ? nums[nums.length - 1] : 40;
        setSlider("fuelFeed", v);
        VoiceCoreTitan._lastFuel = Math.max(0, Math.min(100, v));
      },
      response: () => "Fuel feed " + (VoiceCoreTitan._lastFuel || 0) + " percent."
    });
    R({
      name: "air_set",
      phrases: [
        "set air", "air intake", "set air intake", "air to", "increase air", "decrease air",
        "raise air", "lower air"
      ],
      action: () => {
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        const v = nums.length ? nums[nums.length - 1] : 50;
        setSlider("airIntake", v);
        VoiceCoreTitan._lastAir = Math.max(0, Math.min(100, v));
      },
      response: () => "Air intake " + (VoiceCoreTitan._lastAir || 0) + " percent."
    });

    // ===== Cooling / coolant =====
    R({
      name: "cooling_on",
      phrases: [
        "start cooling", "turn on cooling", "cooling on", "enable cooling",
        "start pumps", "cooling pumps on", "turn on pumps", "activate cooling"
      ],
      action: () => {
        setSwitch("lub-pump", true);
        setSwitch("sw-pump", true);
      },
      response: "Cooling pumps on."
    });
    R({
      name: "cooling_off",
      phrases: [
        "stop cooling", "turn off cooling", "cooling off", "stop pumps",
        "disable cooling", "pumps off"
      ],
      action: () => {
        setSwitch("lub-pump", false);
        setSwitch("sw-pump", false);
      },
      response: "Cooling pumps off."
    });
    R({
      name: "lub_pump_on",
      phrases: ["lubricant pump on", "lub pump on", "oil pump on", "turn on lub pump"],
      action: () => setSwitch("lub-pump", true),
      response: "Lubricant pump on."
    });
    R({
      name: "lub_pump_off",
      phrases: ["lubricant pump off", "lub pump off", "oil pump off", "turn off lub pump"],
      action: () => setSwitch("lub-pump", false),
      response: "Lubricant pump off."
    });
    R({
      name: "sw_pump_on",
      phrases: ["seawater pump on", "sea water pump on", "water pump on", "sw pump on"],
      action: () => setSwitch("sw-pump", true),
      response: "Seawater pump on."
    });
    R({
      name: "sw_pump_off",
      phrases: ["seawater pump off", "sea water pump off", "water pump off", "sw pump off"],
      action: () => setSwitch("sw-pump", false),
      response: "Seawater pump off."
    });

    R({
      name: "coolant_set",
      phrases: [
        "set coolant", "coolant to", "set coolers", "set cooler", "coolant level",
        "set lub cooler", "set water cooler", "set h2o cooler", "set cooling valves",
        "coolant", "adjust coolant", "regulate coolant", "set cooling to"
      ],
      action: () => {
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        let lub = nums[0];
        let h2o = nums[1] != null ? nums[1] : nums[0];
        if (lub == null) lub = 60;
        if (h2o == null) h2o = 55;
        lub = Math.max(0, Math.min(100, lub));
        h2o = Math.max(0, Math.min(100, h2o));
        setSlider("lubCooler", lub);
        setSlider("h2oCooler", h2o);
        VoiceCoreTitan._lastLub = lub;
        VoiceCoreTitan._lastH2o = h2o;
      },
      response: () =>
        "Coolant set. Lubricant cooler " +
        (VoiceCoreTitan._lastLub || 0) +
        " percent, water cooler " +
        (VoiceCoreTitan._lastH2o || 0) +
        " percent."
    });
    R({
      name: "coolant_max",
      phrases: [
        "maximum cooling", "max cooling", "full cooling", "coolers full open",
        "maximum coolant", "coolant max"
      ],
      action: () => {
        setSwitch("lub-pump", true);
        setSwitch("sw-pump", true);
        setSlider("lubCooler", 100);
        setSlider("h2oCooler", 100);
      },
      response: "Cooling at maximum."
    });

    // ===== Clutch / propulsion macros =====
    R({
      name: "clutch_in",
      phrases: [
        "engage clutch", "clutch in", "clutch on", "couple the shaft", "close clutch", "clutch engage"
      ],
      action: () => setSwitch("clutch", true),
      response: "Clutch engaged."
    });
    R({
      name: "clutch_out",
      phrases: [
        "disengage clutch", "clutch out", "clutch off", "open clutch", "release clutch"
      ],
      action: () => setSwitch("clutch", false),
      response: "Clutch disengaged."
    });

    R({
      name: "start_engines",
      phrases: [
        "start engines", "start the engines", "activate propulsion", "bring online",
        "power up plant", "start plant", "engines start", "fire up engines"
      ],
      action: () => {
        setSwitch("generator", true);
        setSwitch("main", true);
        setSwitch("lub-pump", true);
        setSwitch("sw-pump", true);
        setSwitch("motor1", true);
        setSwitch("clutch", true);
      },
      response: "Propulsion sequence started."
    });
    R({
      name: "stop_engines",
      phrases: [
        "stop engines", "shut down propulsion", "shutdown propulsion", "kill engines",
        "stop propulsion", "engines stop", "secure engines"
      ],
      action: () => {
        stopMotorAlt();
        setSwitch("clutch", false);
        setSwitch("motor1", false);
        setSwitch("motor2", false);
        setSwitch("generator", false);
      },
      response: "Propulsion secured.",
      confirm: true
    });

    // ===== Throttle / regulator =====
    R({
      name: "throttle_up",
      phrases: [
        "increase throttle", "throttle up", "more power", "raise throttle", "throttle",
        "throttles", "throttle higher", "higher throttle", "increase the throttle",
        "up the throttle", "push throttle", "throttle more", "more throttle",
        "power up", "increase power", "boost throttle", "give more throttle"
      ],
      action: () => {
        const st = Game.state;
        const v = Math.min(100, (st.regulator.throttle || 0) + 10);
        setSlider("throttle", v);
      },
      response: () => "Throttle " + Math.round(Game.state.regulator.throttle) + " percent."
    });
    R({
      name: "throttle_down",
      phrases: [
        "decrease throttle", "throttle down", "less power", "reduce throttle",
        "throttle lower", "lower throttle", "decrease the throttle", "less throttle",
        "reduce power", "power down", "cut throttle", "pull throttle"
      ],
      action: () => {
        const st = Game.state;
        const v = Math.max(0, (st.regulator.throttle || 0) - 10);
        setSlider("throttle", v);
      },
      response: () => "Throttle " + Math.round(Game.state.regulator.throttle) + " percent."
    });
    R({
      name: "full_throttle",
      phrases: [
        "full throttle", "throttle one hundred", "maximum throttle", "max throttle",
        "throttle max", "full power", "maximum power", "throttle to max"
      ],
      action: () => setSlider("throttle", 100),
      response: "Full throttle."
    });
    R({
      name: "idle_throttle",
      phrases: [
        "idle", "throttle zero", "zero throttle", "throttle to zero", "idle throttle",
        "throttle idle", "throttle off", "no throttle"
      ],
      action: () => setSlider("throttle", 0),
      response: "Throttle at idle."
    });
    R({
      name: "throttle_set",
      phrases: [
        "set throttle", "throttle to", "throttle at", "set throttle to"
      ],
      action: () => {
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        const v = nums.length ? nums[nums.length - 1] : 30;
        setSlider("throttle", v);
        VoiceCoreTitan._lastThrottle = Math.max(0, Math.min(100, v));
      },
      response: () => "Throttle " + (VoiceCoreTitan._lastThrottle || 0) + " percent."
    });

    R({
      name: "auto_reg_on",
      phrases: [
        "auto regulate on", "auto regulator on", "enable auto regulate", "turn on auto regulate",
        "auto regulation on", "enable auto regulator", "auto reg on"
      ],
      action: () => setSwitch("auto-reg", true),
      response: "Auto-regulate enabled."
    });
    R({
      name: "auto_reg_off",
      phrases: [
        "auto regulate off", "auto regulator off", "disable auto regulate", "turn off auto regulate",
        "auto regulation off", "auto reg off"
      ],
      action: () => setSwitch("auto-reg", false),
      response: "Auto-regulate disabled."
    });
    R({
      name: "rpm_set",
      phrases: [
        "set rpm", "target rpm", "set target rpm", "rpm to", "set revolutions", "engine rpm"
      ],
      action: () => {
        const last = (global.VoiceCore && VoiceCore.lastFinal) || "";
        const nums = extractNumbers(last);
        let v = nums.length ? nums[nums.length - 1] : 400;
        if (v <= 100) v = v * 10; // "fifty" → often meant 500 if context rpm
        setSlider("targetRpm", Math.min(1200, v));
        VoiceCoreTitan._lastRpm = Math.min(1200, v);
      },
      response: () => "Target R P M " + (VoiceCoreTitan._lastRpm || 0) + "."
    });

    // ===== Map / projection =====
    R({
      name: "show_map",
      phrases: [
        "display map", "show map", "show the map", "open map", "navigation map",
        "show navigation", "nav map", "where are we", "show position", "ship position",
        "display navigation", "open navigation map", "show nav", "map on",
        "engage display map", "engage the display map", "engage map", "engage navigation map",
        "engage nav map", "activate display map", "activate map", "bring up the map",
        "bring up map", "project map", "project navigation"
      ],
      action: () => {
        showSector("walk");
        showMapOverlay(true);
      },
      response: "Navigation map displayed."
    });
    R({
      name: "hide_map",
      phrases: [
        "remove map", "hide map", "close map", "map off", "dismiss map",
        "remove projection", "hide projection", "close projection", "dismiss projection",
        "projection off", "hide hologram", "close hologram", "remove hologram"
      ],
      action: () => {
        showMapOverlay(false);
        hideHolo();
      },
      response: "Projection closed."
    });
    R({
      name: "show_projection",
      phrases: [
        "show projection", "open projection", "hologram on", "show hologram",
        "open hologram", "display hologram", "project status"
      ],
      action: () => {
        showSector("walk");
        // Open a useful default zone hologram
        showHolo("electrics");
      },
      response: "Holographic projection open."
    });

    // ===== Views / sectors =====
    R({
      name: "view_overview",
      phrases: ["show overview", "plant overview", "go to overview", "overview panel", "main overview"],
      action: () => showSector("overview"),
      response: "Overview."
    });
    R({
      name: "view_electrics",
      phrases: [
        "show electrics", "open electrics", "sector a", "electrics panel", "go to electrics",
        "electrical panel", "power panel"
      ],
      action: () => showSector("A"),
      response: "Electrics."
    });
    R({
      name: "view_cooling",
      phrases: [
        "show cooling", "open cooling", "sector b", "cooling panel", "go to cooling", "coolant panel"
      ],
      action: () => showSector("B"),
      response: "Cooling."
    });
    R({
      name: "view_reactor",
      phrases: [
        "show reactor", "open reactor", "sector c", "reactor panel", "go to reactor", "reactor core panel"
      ],
      action: () => showSector("C"),
      response: "Reactor."
    });
    R({
      name: "view_regulator",
      phrases: [
        "show regulator", "open regulator", "sector d", "regulator panel", "go to regulator",
        "control regulator", "regulator view"
      ],
      action: () => showSector("D"),
      response: "Regulator."
    });
    R({
      name: "view_motors",
      phrases: [
        "show motors", "open motors", "sector e", "motors panel", "go to motors", "back motors"
      ],
      action: () => showSector("E"),
      response: "Motors."
    });
    R({
      name: "view_walk",
      phrases: [
        "walk mode", "enter walk mode", "start walking", "first person", "explore ship",
        "walk around", "go walk"
      ],
      action: () => showSector("walk"),
      response: "Walk mode."
    });
    R({
      name: "view_external",
      phrases: [
        "external view", "show hull", "outside view", "external hull", "hull view", "outside"
      ],
      action: () => showSector("external"),
      response: "External hull."
    });
    R({
      name: "view_dashboard",
      phrases: ["show dashboard", "engine dashboard", "open dashboard", "dashboard view"],
      action: () => showSector("dashboard"),
      response: "Dashboard."
    });

    // ===== Heat / emergency =====
    R({
      name: "heat_status",
      phrases: [
        "heat status", "heat report", "temperature report", "how hot", "unit heat",
        "check heat", "thermal status", "are we overheating"
      ],
      action: () => {},
      response: () => {
        const h = (Game.state && Game.state.machineHeat) || {};
        const s = (Game.state && Game.state.sensors) || {};
        return (
          "Plant temperature " + Math.round(s.temperatureC || 0) + " degrees. " +
          "Electrics heat " + Math.round(h.electrics || 0) + ". " +
          "Reactor heat " + Math.round(h.reactor || 0) + ". " +
          "Regulator heat " + Math.round(h.regulator || 0) + ". " +
          "Motors heat " + Math.round(h.motors || 0) + "."
        );
      }
    });
    R({
      name: "emergency_stop",
      phrases: [
        "emergency stop", "emergency shutdown", "kill all systems", "scram", "plant trip",
        "emergency cut", "full stop emergency", "abort all", "emergency halt"
      ],
      action: () => {
        stopMotorAlt();
        setSwitch("clutch", false);
        setSwitch("motor1", false);
        setSwitch("motor2", false);
        setSwitch("generator", false);
        setSwitch("main", false);
        setSlider("throttle", 0);
      },
      response: "Emergency stop complete. All propulsion offline.",
      confirm: true
    });
    R({
      name: "recalibrate_heat",
      phrases: [
        "recalibrate", "recalibrate heat", "reset heat", "clear heat emergency",
        "recalibrate unit", "stabilize heat", "stabilise heat", "reset thermal"
      ],
      action: () => {
        if (!global.HeatEmergency) return;
        const zones = ["electrics", "reactor", "regulator", "motors"];
        let any = false;
        for (const z of zones) {
          if (HeatEmergency.isCritical && HeatEmergency.isCritical(z)) {
            HeatEmergency.recalibrate(z);
            any = true;
          }
        }
        // If none critical, gently reduce all heat
        if (!any && Game.state && Game.state.machineHeat) {
          zones.forEach((z) => {
            Game.state.machineHeat[z] = Math.min(Game.state.machineHeat[z] || 0, 30);
          });
        }
        VoiceCoreTitan._recalAny = any;
      },
      response: () =>
        VoiceCoreTitan._recalAny
          ? "Critical units recalibrated. Heat stabilising."
          : "Heat levels eased."
    });
    R({
      name: "stop_emergency",
      phrases: [
        "stop emergency", "cancel emergency", "clear emergency", "end emergency",
        "reset emergency", "emergency clear"
      ],
      action: () => {
        if (global.HeatEmergency && HeatEmergency.resetAll) {
          // only clear deadlines, don't full plant reset if possible
          const d = HeatEmergency.deadlines;
          if (d) Object.keys(d).forEach((k) => { d[k] = null; });
        }
        if (Game.state && Game.state.machineHeat) {
          Object.keys(Game.state.machineHeat).forEach((k) => {
            Game.state.machineHeat[k] = Math.min(Game.state.machineHeat[k] || 0, 25);
          });
        }
      },
      response: "Emergency cleared. Monitor temperatures."
    });


    // ===== Warnings / safe mode / macros =====
    R({
      name: "explain_warning",
      phrases: [
        "explain warning", "brave explain warning", "what is the warning", "why the warning",
        "explain the warning", "what is wrong", "what is the problem", "explain alarm",
        "explain critical", "why alarm", "fault report", "list faults", "what failed",
        "explain status", "describe warning", "talk about the warning"
      ],
      action: () => {},
      response: () => {
        const st = Game.state || {};
        const faults = st.activeFaults || [];
        const hw = global.HardwareSystem || {};
        const heat = st.machineHeat || {};
        const parts = [];
        const labels = {
          overheat_crit: "Critical overheat. Temperature is dangerously high.",
          overheat_warn: "Temperature warning. Plant is running hot.",
          fuel_crit: "Fuel critically low.",
          fuel_warn: "Fuel running low.",
          lub_pump_off: "Lubricant pump is off under load.",
          sw_pump_off: "Seawater pump is off under load.",
          main_breaker_open: "Main breaker is open while power is demanded.",
          generator_offline: "Generator is offline with fuel feed still open.",
          overspeed: "Motors overspeeding.",
          no_bus_power: "Clutch engaged but little bus power.",
          low_pressure: "Cooling pressure is low.",
          high_pressure: "Cooling pressure is high.",
          coolant_low: "Coolant level is low.",
          coolant_foul: "Coolant quality is poor."
        };
        faults.forEach((f) => { if (labels[f]) parts.push(labels[f]); else parts.push(f.replace(/_/g, " ")); });
        if (hw.coolingValveSeized) parts.push("Cooling valve servo is seized. Walk to Cooling and reset.");
        if (hw.breakerTripLock) parts.push("Main breaker trip lock is engaged. Walk to Electrics and reset.");
        if (hw.fuelFeedDrift) parts.push("Fuel feed is drifting. Walk to Regulator and recalibrate.");
        ["electrics", "reactor", "regulator", "motors"].forEach((z) => {
          if ((heat[z] || 0) >= 90) parts.push(z + " unit heat is near critical at " + Math.round(heat[z]) + ".");
        });
        if (global.HeatEmergency && HeatEmergency.anyCritical && HeatEmergency.anyCritical()) {
          parts.push("A heat emergency deadline is active. Recalibrate immediately.");
        }
        if (!parts.length) {
          const cond = (st.condition || "normal").toUpperCase();
          return cond === "NORMAL"
            ? "No active warnings. Plant is normal."
            : "Condition " + cond + ". No detailed fault codes listed.";
        }
        return parts.slice(0, 4).join(" ");
      }
    });


    function fullStabilize(aggressive) {
      const st = Game.state;
      if (!st) return { spoken: [], notes: [] };
      const faults = st.activeFaults || [];
      const s = st.sensors || {};
      const spoken = [];
      const notes = [];

      // Always maximise heat-sink capacity
      setSwitch("lub-pump", true);
      setSwitch("sw-pump", true);
      setSlider("lubCooler", 100);
      setSlider("h2oCooler", 100);
      spoken.push("cooling maximised");

      // Overheat / high temp
      if (
        faults.indexOf("overheat_warn") >= 0 ||
        faults.indexOf("overheat_crit") >= 0 ||
        (s.temperatureC || 0) > 75 ||
        aggressive
      ) {
        setSlider("throttle", Math.min(st.regulator.throttle || 0, aggressive ? 20 : 30));
        setSlider("fuelFeed", Math.min(st.reactor.fuelFeed || 0, aggressive ? 20 : 30));
        setSlider("airIntake", Math.min(st.reactor.airIntake || 50, 50));
        setSlider("targetRpm", Math.min(st.motors.targetRpm || 0, aggressive ? 350 : 500));
        // Single motor feed to cut electrics/motors heat
        if (st.electrics.motor1 && st.electrics.motor2) {
          setSwitch("motor2", false);
          spoken.push("single motor feed");
        }
        spoken.push("load reduced");
      }

      if (faults.indexOf("lub_pump_off") >= 0 || faults.indexOf("sw_pump_off") >= 0) {
        spoken.push("pumps restored");
      }
      if (faults.indexOf("generator_offline") >= 0 && (s.temperatureC || 0) < 90) {
        setSwitch("generator", true);
        spoken.push("generator online");
      }
      if (faults.indexOf("main_breaker_open") >= 0 && !(global.HardwareSystem && HardwareSystem.breakerTripLock)) {
        setSwitch("main", true);
        spoken.push("main breaker closed");
      }
      if (faults.indexOf("overspeed") >= 0) {
        setSlider("targetRpm", 400);
        setSlider("throttle", Math.min(st.regulator.throttle || 0, 25));
        spoken.push("overspeed cut");
      }
      if (faults.indexOf("no_bus_power") >= 0) {
        setSwitch("main", true);
        setSwitch("generator", true);
      }
      if (faults.indexOf("high_pressure") >= 0) {
        setSlider("h2oCooler", 70);
        spoken.push("pressure eased");
      }
      if (faults.indexOf("low_pressure") >= 0) {
        setSwitch("sw-pump", true);
        setSlider("h2oCooler", 100);
      }

      // Unit heat + emergency deadlines
      if (st.machineHeat) {
        ["electrics", "reactor", "regulator", "motors"].forEach((z) => {
          const critical = global.HeatEmergency && HeatEmergency.isCritical && HeatEmergency.isCritical(z);
          if (critical) {
            HeatEmergency.recalibrate(z);
            spoken.push(z + " recalibrated");
          } else if ((st.machineHeat[z] || 0) > (aggressive ? 50 : 70)) {
            st.machineHeat[z] = aggressive ? 25 : 45;
          }
        });
      }

      // Cancel aggressive modes that drive heat
      if (aggressive) {
        stopMotorAlt();
        if (VoiceCoreTitan._stopSafeSpeedWatch) VoiceCoreTitan._stopSafeSpeedWatch();
        setSwitch("auto-reg", false);
      }

      if (global.HardwareSystem) {
        if (HardwareSystem.coolingValveSeized) notes.push("walk to Cooling and reset the servo");
        if (HardwareSystem.breakerTripLock) notes.push("walk to Electrics and clear the breaker lock");
        if (HardwareSystem.fuelFeedDrift) notes.push("walk to Regulator and recalibrate fuel feed");
      }
      return { spoken: spoken, notes: notes, faults: faults };
    }

    R({
      name: "fix_warning",
      phrases: [
        "fix", "fix it", "fix this", "fix warning", "brave fix", "brave fix warning",
        "clear warning", "resolve warning", "fix the warning", "fix alarm", "clear alarm",
        "fix problem", "resolve fault", "fix faults", "address warning", "correct warning",
        "make it safe", "stabilise plant", "stabilize plant",
        "six", "fix six", "brave six"
      ],
      action: () => {
        const r = fullStabilize(false);
        VoiceCoreTitan._fixResult = r;
      },
      response: () => {
        const r = VoiceCoreTitan._fixResult || { spoken: [], notes: [] };
        let msg = r.spoken.length
          ? "Fixing. " + r.spoken.join(", ") + "."
          : "Stabilising plant.";
        if (r.notes && r.notes.length) msg += " Still required: " + r.notes.join(", ") + ".";
        return msg;
      }
    });

    R({
      name: "fix_crisis",
      phrases: [
        "fix crisis", "brave fix crisis", "fix the crisis", "crisis fix",
        "resolve crisis", "clear crisis", "emergency fix", "fix critical",
        "fix critical warning", "stabilise crisis", "stabilize crisis",
        "full stabilise", "full stabilize", "complete fix", "fix everything wrong"
      ],
      action: () => {
        // 1) Diagnose
        const st = Game.state || {};
        const faults = st.activeFaults || [];
        const heat = st.machineHeat || {};
        const hw = global.HardwareSystem || {};
        const labels = {
          overheat_crit: "critical overheat",
          overheat_warn: "temperature warning",
          fuel_crit: "critical fuel",
          fuel_warn: "low fuel",
          lub_pump_off: "lubricant pump off",
          sw_pump_off: "seawater pump off",
          main_breaker_open: "main breaker open",
          generator_offline: "generator offline",
          overspeed: "overspeed",
          no_bus_power: "no bus power",
          low_pressure: "low cooling pressure",
          high_pressure: "high cooling pressure",
          coolant_low: "low coolant",
          coolant_foul: "foul coolant"
        };
        const diagnosis = [];
        faults.forEach((f) => diagnosis.push(labels[f] || f.replace(/_/g, " ")));
        if (hw.coolingValveSeized) diagnosis.push("cooling servo seized");
        if (hw.breakerTripLock) diagnosis.push("breaker trip lock");
        if (hw.fuelFeedDrift) diagnosis.push("fuel feed drift");
        ["electrics", "reactor", "regulator", "motors"].forEach((z) => {
          if ((heat[z] || 0) >= 85) diagnosis.push(z + " heat " + Math.round(heat[z]));
        });
        if (global.HeatEmergency && HeatEmergency.anyCritical && HeatEmergency.anyCritical()) {
          diagnosis.push("heat emergency deadline active");
        }

        // 2) Aggressive full stabilize
        const r = fullStabilize(true);
        VoiceCoreTitan._crisisDiagnosis = diagnosis;
        VoiceCoreTitan._fixResult = r;
      },
      response: () => {
        const diag = VoiceCoreTitan._crisisDiagnosis || [];
        const r = VoiceCoreTitan._fixResult || { spoken: [], notes: [] };
        let msg = "";
        if (diag.length) {
          msg += "Crisis: " + diag.slice(0, 4).join(", ") + ". ";
        } else {
          msg += "No active crisis codes. ";
        }
        if (r.spoken.length) msg += "Actions: " + r.spoken.join(", ") + ". ";
        else msg += "Plant already stabilised. ";
        if (r.notes && r.notes.length) {
          msg += "Physical steps still needed: " + r.notes.join(", ") + ".";
        } else {
          msg += "Remote stabilisation complete.";
        }
        return msg;
      }
    });


    R({
      name: "turn_on_everything",
      phrases: [
        "turn on everything", "brave turn on everything", "power everything", "enable everything",
        "all systems on", "all systems go", "full plant on", "start everything",
        "bring everything online", "activate all systems", "power up everything"
      ],
      action: () => {
        setSwitch("generator", true);
        setSwitch("main", true);
        setSwitch("lub-pump", true);
        setSwitch("sw-pump", true);
        setSwitch("motor1", true);
        setSwitch("motor2", true);
        setSwitch("starter", true);
        setSwitch("aux", true);
        setSwitch("clutch", true);
        setSwitch("auto-reg", true);
        setSlider("lubCooler", 80);
        setSlider("h2oCooler", 80);
        setSlider("fuelFeed", 45);
        setSlider("airIntake", 55);
        setSlider("throttle", 40);
      },
      response: "All primary systems energised. Monitor heat closely."
    });

    R({
      name: "turn_off_everything",
      phrases: [
        "turn off everything", "brave turn off everything", "power everything off",
        "all systems off", "shut down everything", "shutdown everything",
        "turn everything off", "disable everything", "secure everything",
        "shut down all systems", "shutdown all systems", "power down everything",
        "kill everything", "switch off everything", "stop everything"
      ],
      action: () => {
        stopMotorAlt();
        if (VoiceCoreTitan._stopSafeSpeedWatch) VoiceCoreTitan._stopSafeSpeedWatch();
        setSwitch("clutch", false);
        setSwitch("motor1", false);
        setSwitch("motor2", false);
        setSwitch("starter", false);
        setSwitch("aux", false);
        setSwitch("generator", false);
        setSwitch("main", false);
        setSwitch("lub-pump", false);
        setSwitch("sw-pump", false);
        setSwitch("auto-reg", false);
        setSlider("throttle", 0);
        setSlider("targetRpm", 0);
        setSlider("fuelFeed", 0);
        setSlider("airIntake", 0);
      },
      response: "All plant systems secured and offline. Assistant remains available."
    });

    R({
      name: "stabilize_all_systems",
      phrases: [
        "stabilize all systems", "stabilise all systems", "stabilize all system",
        "stabilise all system", "brave stabilize", "brave stabilise",
        "stabilize everything", "stabilise everything", "stabilize the plant",
        "stabilise the plant", "stabilize systems", "stabilise systems",
        "prevent heat buildup", "prevent heat build up", "heat prevention mode",
        "thermal stabilise", "thermal stabilize", "keep systems cool",
        "balance all systems", "regulate all systems", "safe operating mode"
      ],
      action: () => {
        // Proactive thermal management — even with no active warning
        stopMotorAlt();
        if (VoiceCoreTitan._stopSafeSpeedWatch) VoiceCoreTitan._stopSafeSpeedWatch();
        setSwitch("lub-pump", true);
        setSwitch("sw-pump", true);
        setSlider("lubCooler", 100);
        setSlider("h2oCooler", 100);
        // Prefer single motor feed
        const st = Game.state;
        if (st) {
          if (st.electrics.motor1 && st.electrics.motor2) {
            setSwitch("motor2", false);
            setSwitch("motor1", true);
          }
          // Cap demand
          setSlider("throttle", Math.min(st.regulator.throttle || 0, 40));
          setSlider("targetRpm", Math.min(st.motors.targetRpm || 0, 600));
          setSlider("fuelFeed", Math.min(st.reactor.fuelFeed || 0, 40));
          setSlider("airIntake", Math.min(Math.max(st.reactor.airIntake || 50, 40), 55));
          setSwitch("auto-reg", false);
          // Ease unit heat buffers
          if (st.machineHeat) {
            ["electrics", "reactor", "regulator", "motors"].forEach((z) => {
              if ((st.machineHeat[z] || 0) > 40) {
                st.machineHeat[z] = Math.min(st.machineHeat[z], 40);
              }
            });
          }
        }
      },
      response: "All systems stabilised. Cooling maximised, load capped, dual motor feed avoided. Heat buildup reduced."
    });

    R({
      name: "safe_speed_mode",
      phrases: [
        "faster speed safe mode", "brave faster speed safe mode", "safe speed mode",
        "speed safe mode", "safe fast mode", "fast safe mode", "maximum safe speed",
        "push speed safely", "safe performance mode", "performance safe mode",
        "run safe speed", "enable safe speed"
      ],
      action: () => {
        // Aggressive but cooled setup
        setSwitch("generator", true);
        setSwitch("main", true);
        setSwitch("lub-pump", true);
        setSwitch("sw-pump", true);
        setSwitch("motor1", true);
        setSwitch("motor2", false); // one feed to manage heat
        setSwitch("clutch", true);
        setSwitch("auto-reg", true);
        setSlider("lubCooler", 100);
        setSlider("h2oCooler", 100);
        setSlider("fuelFeed", 55);
        setSlider("airIntake", 60);
        setSlider("throttle", 70);
        setSlider("targetRpm", 900);
        startMotorAlt(45);
        VoiceCoreTitan._startSafeSpeedWatch();
      },
      response: "Safe speed mode engaged. I will protect the plant if unit heat reaches ninety."
    });

    R({
      name: "safe_speed_cancel",
      phrases: [
        "cancel safe speed", "stop safe speed", "disable safe speed mode",
        "exit safe speed", "end safe mode"
      ],
      action: () => {
        VoiceCoreTitan._stopSafeSpeedWatch();
        stopMotorAlt();
      },
      response: "Safe speed mode cancelled."
    });

    // ===== Extra systems from HTML =====
    R({
      name: "quality_low",
      phrases: ["low quality", "performance low", "reduce graphics", "quality low"],
      action: () => { if (global.SceneManager && SceneManager.setQuality) SceneManager.setQuality("low"); },
      response: "Graphics set to low."
    });
    R({
      name: "quality_high",
      phrases: ["high quality", "performance high", "quality high", "best graphics"],
      action: () => { if (global.SceneManager && SceneManager.setQuality) SceneManager.setQuality("high"); },
      response: "Graphics set to high."
    });
    R({
      name: "interact_nearby",
      phrases: [
        "interact", "use machine", "press interact", "reset nearby", "interact here",
        "use equipment", "reset this machine"
      ],
      action: () => {
        if (global.Joystick && Joystick.doInteract) Joystick.doInteract();
        else if (global.InputManager) {
          // fallback: trigger same path as E key via walk cam
          try {
            const cam = SceneManager && SceneManager.walkCam;
            if (cam && HardwareSystem) {
              const zone = HardwareSystem.zoneAt(cam.position.x, cam.position.z);
              if (zone) {
                if (HologramUI) HologramUI.toggle(zone);
                HardwareSystem.tryReset(zone);
                if (HeatEmergency) HeatEmergency.recalibrate(zone);
              }
            }
          } catch (_) {}
        }
      },
      response: "Interacting with nearby equipment."
    });

    // ===== Status =====
    R({
      name: "status_report",
      phrases: [
        "status report", "system status", "plant status", "what is the status",
        "report status", "give me a status", "status", "ship status", "full status"
      ],
      action: () => {},
      response: () => {
        const s = Game.state.sensors || {};
        const st = Game.state;
        const power = (s.elecPowerKw || 0).toFixed(0);
        const temp = (s.temperatureC || 0).toFixed(0);
        const rpm = (s.rpm || 0).toFixed(0);
        const fuel = (st.fuelPercent || 0).toFixed(0);
        const cond = (st.condition || "unknown").toUpperCase();
        return (
          "Condition " + cond + ". Power " + power + " kilowatts. Temperature " +
          temp + " degrees. R P M " + rpm + ". Fuel " + fuel + " percent."
        );
      }
    });
  }

  const VoiceCoreTitan = {
    installed: false,
    _lastFuel: null,
    _lastAir: null,
    _lastLub: null,
    _lastH2o: null,
    _lastThrottle: null,
    _lastRpm: null,
    _recalAny: false,
    _fixNotes: [],
    _safeWatchTimer: null,
    _safeTripped: false,

    _stopSafeSpeedWatch() {
      if (this._safeWatchTimer) {
        clearInterval(this._safeWatchTimer);
        this._safeWatchTimer = null;
      }
      this._safeTripped = false;
    },

    _startSafeSpeedWatch() {
      this._stopSafeSpeedWatch();
      this._safeTripped = false;
      this._safeWatchTimer = setInterval(() => {
        const st = global.Game && Game.state;
        if (!st || !st.machineHeat) return;
        const heats = ["electrics", "reactor", "regulator", "motors"].map((z) => st.machineHeat[z] || 0);
        const maxH = Math.max.apply(null, heats);
        if (maxH >= 90 && !this._safeTripped) {
          this._safeTripped = true;
          // Automatic safe configuration
          setSlider("throttle", 25);
          setSlider("targetRpm", 400);
          setSlider("fuelFeed", 25);
          setSlider("airIntake", 45);
          setSlider("lubCooler", 100);
          setSlider("h2oCooler", 100);
          setSwitch("lub-pump", true);
          setSwitch("sw-pump", true);
          setSwitch("motor2", false);
          setSwitch("motor1", true);
          setSwitch("auto-reg", false);
          stopMotorAlt();
          if (global.Game && Game.log) {
            Game.log("SAFE SPEED MODE: unit heat ≥ 90 — switched to safe settings.");
          }
          if (global.VoiceCore && VoiceCore.speak) {
            VoiceCore.speak("Heat limit reached. Switched every setting to safe.");
          }
        }
      }, 1000);
    },

    async install(opts = {}) {
      if (!global.VoiceCore) {
        console.error("[VoiceCoreTitan] VoiceCore not loaded.");
        return false;
      }
      if (this.installed) return true;

      await VoiceCore.init({
        autoUI: opts.autoUI !== false,
        container: opts.container || null,
        lang: opts.lang || "en-US"
      });

      registerAll();

      try {
        if (global.VoiceCore && VoiceCore.SpeechAI && VoiceCore.SpeechAI.rebuildIndex) {
          VoiceCore.SpeechAI.rebuildIndex();
        }
      } catch (_) {}

      if (global.VoiceCore && VoiceCore.Trainer) {
        try {
          VoiceCore.Trainer.load();
          VoiceCore.Trainer.applyToRegistry();
        } catch (e) {
          console.warn("[VoiceCoreTitan] trainer apply:", e);
        }
      }

      this.installed = true;

      if (opts.greet !== false) {
        VoiceCore.speak("Titan voice interface ready.");
      }
      if (global.Game && Game.log) {
        Game.log("VoiceCore online — speak commands or use the voice panel.");
      }
      return true;
    }
  };

  global.VoiceCoreTitan = VoiceCoreTitan;
})(typeof window !== "undefined" ? window : globalThis);
