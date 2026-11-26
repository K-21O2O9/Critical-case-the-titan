/* TITAN Enhancements — Full formulas + Sci Calculator (fractions) + Terminal */
(function () {
  "use strict";

  const ZONE_FORMULAS = {
    electrics: [
      { eq: "P_bus (kW) = V × I / 1000", note: "Electrical power on the main bus. Voltage is held near nominal; current scales with load." },
      { eq: "I (A) ≈ (P_bus × 1000) / V", note: "High current under load stresses the breaker. Sustained high I can trip the main breaker lock." },
      { eq: "Unit heat gain ≈ base(I) + dualFeedPenalty", note: "One motor feed ≈ 60 s to reach heat 100. Both Motor 1 + Motor 2 ON → faster heat climb and higher peak power." },
      { eq: "Available capacity ×= derate(heat)", note: "heat > 60 → mild derate; > 75 → stronger; > 90 → severe. Switch feeds or cool to recover." },
      { eq: "From Reactor (kW) → Bus → Motors", note: "Electrics distributes reactor electrical power. Without Main Breaker closed, motors see no feed." }
    ],
    cooling: [
      { eq: "coolerOpen = (lubCooler% + h2oCooler%) / 200", note: "Combined cooler valve opening, range 0…1. Set both sliders high for maximum heat rejection." },
      { eq: "coolingPower = Σ [ pumpBase + coolerOpen × pumpGain ] × levelFactor × qualityFactor", note: "Lub pump base≈18, gain≈22; SW pump base≈22, gain≈28. Level & quality scale the result (min ~0.3)." },
      { eq: "targetTemp ≈ AMBIENT(32°C) + heatLoad − coolingPower × 0.55", note: "heatLoad comes from electrical + mechanical power. More coolingPower pulls plant temperature down." },
      { eq: "filterΔP (bar) ≈ 0.15 + (100 − quality) × 0.02 + pumpFactor", note: "Dirty coolant (low quality) raises filter differential pressure. Run pumps when hot to protect quality." },
      { eq: "Coolant level drains slowly while pumps run; recovers when cool / pumps off", note: "Keep level and quality high — they multiply cooling effectiveness." }
    ],
    reactor: [
      { eq: "mix = 1 − min(0.85, |fuelFeed% − airIntake%| / 120)", note: "Mixture quality. Large imbalance between fuel and air still runs but cuts efficiency hard." },
      { eq: "feed = max(0.04, (fuelFeed% / 100) × mix)", note: "Effective fuel fraction. ~10% feed is intentional idle / light-off power when generator is on." },
      { eq: "ηT_live = turbEff × tempPen × corePen", note: "Turbine efficiency after penalties. temp > 80/90/100°C and unit heat > 60/75/90 both reduce ηT." },
      { eq: "Pe (kW) = maxKw × feed × ηT_live × ηG", note: "Electrical power out. maxKw ≈ 380 (lower when fuel tank is low). ηG ≈ 0.92 generator efficiency." },
      { eq: "fuelMassFlow (kg/s) = Pe / (ηT_live × ηG × dens)", note: "dens ≈ 42.5 MJ/kg (fuel energy density × 1000). Higher Pe burns fuel faster." },
      { eq: "Unit heat: gain ≈ 2.5 + (Pe/380)×18 ; loss boosted by Lub + SW pumps", note: "Run cooling when the generator is loaded or reactor unit heat will climb into derate." }
    ],
    regulator: [
      { eq: "density = 0.87 − (T°C − 20) × 0.00045", note: "Fuel density falls slightly as temperature rises." },
      { eq: "ΔP = 0.2 + (throttle% / 100) × 2.0", note: "Pressure drop across the metering path increases with throttle demand." },
      { eq: "Q (vol flow) = √(ΔP / density)", note: "Volumetric flow from orifice relation. Used for fuel system response." },
      { eq: "loadDemandKw = 30 + throttle% × 2.9", note: "Propulsion demand the rest of the plant tries to meet. Auto-Regulate tracks available power." },
      { eq: "Throttle is capped when regulator unit heat is high (≈50% / 75% caps)", note: "Sustained high throttle heats the metering path — cool or ease off to restore full authority." }
    ],
    motors: [
      { eq: "v_kmh = RPM × 0.5", note: "Design calibration: 100 RPM → 50 km/h. Primary speed readout relationship." },
      { eq: "v_kn = v_kmh / 1.852", note: "Ship speed in knots (1 kn = 1.852 km/h)." },
      { eq: "ω (rad/s) = 2π × RPM / 60", note: "Shaft angular velocity from RPM." },
      { eq: "P_mech (kW) = τ (Nm) × ω / 1000", note: "Mechanical power delivered by the shaft." },
      { eq: "RPM ceiling ≈ f(bus kW) × derate(temp, heat) × dualBoost", note: "Available RPM is limited by electrical power, plant temperature, motor unit heat, and whether one or both feeds are on." },
      { eq: "Dual feed: both Motor 1 + Motor 2 ON → higher power & speed, much faster heat", note: "One feed ≈ 60 s to heat 100. Switch feeds to reset heat; both ON only when you need the extra push." }
    ]
  };

  function buildSciCalc(container) {
    if (!container) return;
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "sci-calc";

    const disp = document.createElement("input");
    disp.type = "text";
    disp.className = "calc-display";
    disp.setAttribute("inputmode", "decimal");
    disp.setAttribute("aria-label", "Calculator display — type or use keys");
    disp.value = "0";
    wrap.appendChild(disp);

    const help = document.createElement("div");
    help.style.cssText = "font-size:0.65rem;color:#8b949e;margin:0.15rem 0 0.3rem;line-height:1.3;";
    help.textContent = "Fractions OK: type 3/4 or 1/2. Trig in degrees. Press = or Enter.";
    wrap.appendChild(help);

    const keys = document.createElement("div");
    keys.className = "calc-keys";

    const layout = [
      ["C", "←", "(", ")", "÷"],
      ["7", "8", "9", "×", "sin"],
      ["4", "5", "6", "−", "cos"],
      ["1", "2", "3", "+", "tan"],
      ["0", ".", "π", "^", "√"],
      ["a/b", "log", "ln", "e", "="]
    ];

    function setDisp(v) { disp.value = v; }

    function evalSafe(s) {
      try {
        let t = String(s || "").trim();
        if (!t) return "0";
        t = t.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, "($1+$2/$3)");
        t = t
          .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
          .replace(/π/g, "Math.PI").replace(/\be\b/g, "Math.E")
          .replace(/√\(/g, "Math.sqrt(").replace(/√([0-9.]+)/g, "Math.sqrt($1)")
          .replace(/sin\(/g, "Math.sin(").replace(/cos\(/g, "Math.cos(").replace(/tan\(/g, "Math.tan(")
          .replace(/log\(/g, "Math.log10(").replace(/ln\(/g, "Math.log(")
          .replace(/\^/g, "**");
        t = t
          .replace(/Math\.sin\(([^)]+)\)/g, "Math.sin(($1)*Math.PI/180)")
          .replace(/Math\.cos\(([^)]+)\)/g, "Math.cos(($1)*Math.PI/180)")
          .replace(/Math\.tan\(([^)]+)\)/g, "Math.tan(($1)*Math.PI/180)");
        const r = Function('"use strict"; return (' + t + ")")();
        if (typeof r !== "number" || !isFinite(r)) return "Error";
        return String(Math.round(r * 1e10) / 1e10);
      } catch (e) {
        return "Error";
      }
    }

    function press(label) {
      let cur = disp.value === "0" || disp.value === "Error" ? "" : disp.value;
      if (label === "C") { setDisp("0"); return; }
      if (label === "←") { setDisp(cur.slice(0, -1) || "0"); return; }
      if (label === "=") { setDisp(evalSafe(disp.value)); return; }
      if (label === "a/b") { setDisp(cur + "/"); return; }
      if (label === "√") { setDisp(cur + "√("); return; }
      if (["sin", "cos", "tan", "log", "ln"].indexOf(label) >= 0) { setDisp(cur + label + "("); return; }
      if (label === "π") { setDisp(cur + "π"); return; }
      if (label === "e") { setDisp(cur + "e"); return; }
      setDisp(cur + label);
    }

    layout.forEach(function (row) {
      row.forEach(function (lab) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = lab;
        if (["÷", "×", "−", "+", "^"].indexOf(lab) >= 0) b.className = "op";
        else if (["sin", "cos", "tan", "log", "ln", "√", "π", "e", "a/b"].indexOf(lab) >= 0) b.className = "fn";
        else if (lab === "=") b.className = "eq";
        b.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          press(lab);
        });
        keys.appendChild(b);
      });
    });
    wrap.appendChild(keys);

    disp.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        setDisp(evalSafe(disp.value));
      }
    });
    disp.addEventListener("keyup", function (e) { e.stopPropagation(); });

    container.appendChild(wrap);
  }

  function enhanceHologram() {
    if (!window.HologramUI) return;
    const el = document.getElementById("holo-panel");
    if (el && !el.querySelector(".holo-tabs")) {
      const inner = el.querySelector(".holo-inner");
      if (inner) {
        const title = inner.querySelector(".holo-title");
        const tabs = document.createElement("div");
        tabs.className = "holo-tabs";
        tabs.innerHTML =
          '<button type="button" class="holo-tab active" data-tab="controls">Controls</button>' +
          '<button type="button" class="holo-tab" data-tab="formulas">Formulas</button>';
        if (title) title.after(tabs);
        else inner.insertBefore(tabs, inner.firstChild);

        const controlsPane = document.createElement("div");
        controlsPane.className = "holo-tab-pane active";
        controlsPane.dataset.pane = "controls";
        const stats = inner.querySelector(".holo-stats");
        const actions = inner.querySelector(".holo-actions");
        const blurb = inner.querySelector(".holo-blurb");
        [blurb, stats, actions].forEach(function (n) { if (n) controlsPane.appendChild(n); });
        tabs.after(controlsPane);

        const formulaPane = document.createElement("div");
        formulaPane.className = "holo-tab-pane";
        formulaPane.dataset.pane = "formulas";
        formulaPane.innerHTML = '<div class="formula-list"></div><div class="sci-calc-host"></div>';
        controlsPane.after(formulaPane);
        buildSciCalc(formulaPane.querySelector(".sci-calc-host"));

        tabs.querySelectorAll(".holo-tab").forEach(function (btn) {
          btn.addEventListener("click", function () {
            tabs.querySelectorAll(".holo-tab").forEach(function (b) { b.classList.toggle("active", b === btn); });
            inner.querySelectorAll(".holo-tab-pane").forEach(function (p) {
              p.classList.toggle("active", p.dataset.pane === btn.dataset.tab);
            });
          });
        });
      }
    }

    if (HologramUI._render && !HologramUI._formulaPatched) {
      const origRender = HologramUI._render.bind(HologramUI);
      HologramUI._render = function (cfg) {
        origRender(cfg);
        const list = this.el && this.el.querySelector(".formula-list");
        if (list && this.zone) {
          const fs = ZONE_FORMULAS[this.zone] || [];
          list.innerHTML = fs.map(function (f) {
            return '<div class="f-eq"><strong>' + f.eq + '</strong><div class="f-note">' + f.note + '</div></div>';
          }).join("") || '<div class="f-eq">No formulas for this zone.</div>';
        }
        const host = this.el && this.el.querySelector(".sci-calc-host");
        if (host && !host.querySelector(".sci-calc")) buildSciCalc(host);
      };
      HologramUI._formulaPatched = true;
    }
  }

  const TERM_CHALLENGES = {
    easy: [
      { id: "e1", broken: "<div>Status: OK\n<p>Coolant loop active</div>", fixed: "<div>Status: OK</div>\n<p>Coolant loop active</p>", tip: "Every opening tag needs a matching closing tag.", hint: "Close the <div> before the <p>, and close the <p>." },
      { id: "e2", broken: "<h1>ENGINE ROOM\n<p>All systems nominal</p>", fixed: "<h1>ENGINE ROOM</h1>\n<p>All systems nominal</p>", tip: "Headings need a closing tag.", hint: "Add </h1> after ENGINE ROOM." },
      { id: "e3", broken: "<button>RESET</button\n<span>Ready</span>", fixed: "<button>RESET</button>\n<span>Ready</span>", tip: "The button tag is missing its closing >.", hint: "Put > after button before the newline." },
      { id: "e4", broken: "<img src=\"gauge.png\"\n<p>Primary gauge</p>", fixed: "<img src=\"gauge.png\">\n<p>Primary gauge</p>", tip: "Self-closing / void tags still need > at the end.", hint: "Add > after the src attribute." },
      { id: "e5", broken: "<ul>\n<li>Pump A\n<li>Pump B\n</ul>", fixed: "<ul>\n<li>Pump A</li>\n<li>Pump B</li>\n</ul>", tip: "List items should be closed.", hint: "Add </li> after each item." },
      { id: "e6", broken: "<p class=\"warn\">Overheat alert<p>", fixed: "<p class=\"warn\">Overheat alert</p>", tip: "Closing tag uses a slash, not another open tag.", hint: "Change the second <p> to </p>." },
      { id: "e7", broken: "<a href=\"#logs\">View logs<a>", fixed: "<a href=\"#logs\">View logs</a>", tip: "Anchor tags need a proper close.", hint: "Use </a> to close." },
      { id: "e8", broken: "<table>\n<tr><td>RPM</td>\n</table>", fixed: "<table>\n<tr><td>RPM</td></tr>\n</table>", tip: "Table rows need </tr>.", hint: "Close the <tr> after the cell." },
      { id: "e9", broken: "<label>Throttle</lable>\n<input type=\"range\">", fixed: "<label>Throttle</label>\n<input type=\"range\">", tip: "Spelling matters in tags.", hint: "lable → label." },
      { id: "e10", broken: "<div id=\"panel\"\n  <span>Online</span>\n</div>", fixed: "<div id=\"panel\">\n  <span>Online</span>\n</div>", tip: "Opening tag must end with > before children.", hint: "Add > after panel\"." },
      { id: "e11", broken: "<strong>CRITICAL<strong>\n<em>Act now</em>", fixed: "<strong>CRITICAL</strong>\n<em>Act now</em>", tip: "Close strong with /strong.", hint: "Second strong should be </strong>." },
      { id: "e12", broken: "<section>\n<header>Logs</header>\n<section>", fixed: "<section>\n<header>Logs</header>\n</section>", tip: "Don't open a second section — close the first.", hint: "Change last line to </section>." },
      { id: "e13", broken: "<p>Temp: 72&degC</p>", fixed: "<p>Temp: 72&deg;C</p>", tip: "HTML entities need a semicolon.", hint: "Use &deg; not &deg." },
      { id: "e14", broken: "<br>\n<p>Line break above</p\n>", fixed: "<br>\n<p>Line break above</p>", tip: "Closing tag punctuation.", hint: "Put > right after /p." },
      { id: "e15", broken: "<div class=\"ok\">Stable\n</div", fixed: "<div class=\"ok\">Stable\n</div>", tip: "Closing tag needs >.", hint: "Add > at the end of </div." },
      { id: "e16", broken: "<h2>Motors</h3>\n<p>Clutch engaged</p>", fixed: "<h2>Motors</h2>\n<p>Clutch engaged</p>", tip: "Closing tag must match the opening tag.", hint: "h3 → h2." },
      { id: "e17", broken: "<input type=\"text\" value=\"SET RPM\"\n<button>Apply</button>", fixed: "<input type=\"text\" value=\"SET RPM\">\n<button>Apply</button>", tip: "Input is a void element — end with >.", hint: "Close the input tag." },
      { id: "e18", broken: "<nav>\n<a href=\"#a\">A</a>\n<a href=\"#b\">B\n</nav>", fixed: "<nav>\n<a href=\"#a\">A</a>\n<a href=\"#b\">B</a>\n</nav>", tip: "Second link is unclosed.", hint: "Add </a> after B." },
      { id: "e19", broken: "<p title=\"hint\">Hover me</p\n<span>ok</span>", fixed: "<p title=\"hint\">Hover me</p>\n<span>ok</span>", tip: "Close the paragraph cleanly.", hint: "Write </p> on one line." },
      { id: "e20", broken: "<footer>THE TITAN</footer\n>", fixed: "<footer>THE TITAN</footer>", tip: "No newline inside the closing tag.", hint: "Write </footer> on one line." }
    ],
    medium: [
      { id: "m1", broken: "<div class=\"panel\">\n  <h3>Status</h3>\n  <p>All clear\n</div>", fixed: "<div class=\"panel\">\n  <h3>Status</h3>\n  <p>All clear</p>\n</div>", tip: "Nested tags must close innermost first.", hint: "Close the <p> before </div>." },
      { id: "m2", broken: "<form>\n  <input type=\"text\" name=\"rpm\"\n  <button type=\"submit\">Go</button>\n</form>", fixed: "<form>\n  <input type=\"text\" name=\"rpm\">\n  <button type=\"submit\">Go</button>\n</form>", tip: "Each tag needs its own closing >.", hint: "Finish the input line with >." },
      { id: "m3", broken: "<ul id=\"alarms\">\n  <li>High temp\n  <li>Low pressure</li>\n</ul>", fixed: "<ul id=\"alarms\">\n  <li>High temp</li>\n  <li>Low pressure</li>\n</ul>", tip: "First list item is still open.", hint: "Close the first <li>." },
      { id: "m4", broken: "<div>\n  <span class=\"label\">Voltage</span>\n  <span class=\"value\">440 V</span>\n<div>", fixed: "<div>\n  <span class=\"label\">Voltage</span>\n  <span class=\"value\">440 V</span>\n</div>", tip: "Last line opens another div instead of closing.", hint: "Use </div>." },
      { id: "m5", broken: "<button onclick=\"reset()\"RESET</button>", fixed: "<button onclick=\"reset()\">RESET</button>", tip: "Attribute quote and > are missing.", hint: "Add \"> after reset()." },
      { id: "m6", broken: "<p>Use &lt;E&gt; to interact</p>", fixed: "<p>Use &lt;E&gt; to interact</p>", tip: "This one is already correct — confirm and submit.", hint: "No change needed; just APPLY." },
      { id: "m7", broken: "<table>\n  <tr><th>Zone</th><th>State</tr>\n  <tr><td>Reactor</td><td>OK</td></tr>\n</table>", fixed: "<table>\n  <tr><th>Zone</th><th>State</th></tr>\n  <tr><td>Reactor</td><td>OK</td></tr>\n</table>", tip: "Header row is missing closes.", hint: "Close the second <th> and the <tr>." },
      { id: "m8", broken: "<label for=\"thr\">Throttle</label>\n<input id=\"thr type=\"range\">", fixed: "<label for=\"thr\">Throttle</label>\n<input id=\"thr\" type=\"range\">", tip: "id attribute quote is not closed.", hint: "id=\"thr\" with a closing quote." },
      { id: "m9", broken: "<section aria-label=\"Cooling\">\n  <h2>Cooling</h2>\n  <p>Pumps online\n</section>", fixed: "<section aria-label=\"Cooling\">\n  <h2>Cooling</h2>\n  <p>Pumps online</p>\n</section>", tip: "Paragraph is still open.", hint: "Add </p>." },
      { id: "m10", broken: "<div class=\"row\">\n  <button>A</button>\n  <button>B</button\n</div>", fixed: "<div class=\"row\">\n  <button>A</button>\n  <button>B</button>\n</div>", tip: "Second button tag is incomplete.", hint: "Close the button with >." },
      { id: "m11", broken: "<header>\n  <h1>TITAN</h1>\n  <nav><a href=\"#\">Home</a></nav>\n<header>", fixed: "<header>\n  <h1>TITAN</h1>\n  <nav><a href=\"#\">Home</a></nav>\n</header>", tip: "Closing header uses open-tag syntax.", hint: "Use </header>." },
      { id: "m12", broken: "<p data-unit=\"celsius\">72 C</p>", fixed: "<p data-unit=\"celsius\">72 C</p>", tip: "Already balanced — submit to clear.", hint: "No edit required." },
      { id: "m13", broken: "<div role=\"status\" aria-live=\"polite\"\n  System nominal\n</div>", fixed: "<div role=\"status\" aria-live=\"polite\">\n  System nominal\n</div>", tip: "Opening tag is not closed before content.", hint: "Add > after polite\"." },
      { id: "m14", broken: "<svg width=\"20\" height=\"20\">\n  <circle cx=\"10\" cy=\"10\" r=\"8\"\n</svg>", fixed: "<svg width=\"20\" height=\"20\">\n  <circle cx=\"10\" cy=\"10\" r=\"8\" />\n</svg>", tip: "SVG shapes are often self-closed.", hint: "End the circle with />." },
      { id: "m15", broken: "<details>\n  <summary>Logs</summary>\n  <pre>OK</pre>\n<details>", fixed: "<details>\n  <summary>Logs</summary>\n  <pre>OK</pre>\n</details>", tip: "Close details properly.", hint: "Use </details>." },
      { id: "m16", broken: "<p>Link: <a href=\"/docs\">docs</a>.</p\n>", fixed: "<p>Link: <a href=\"/docs\">docs</a>.</p>", tip: "Paragraph close is broken across lines.", hint: "Write </p> cleanly." },
      { id: "m17", broken: "<fieldset>\n  <legend>Feeds</legend>\n  <label><input type=\"checkbox\"> Motor 1</label>\n<fieldset>", fixed: "<fieldset>\n  <legend>Feeds</legend>\n  <label><input type=\"checkbox\"> Motor 1</label>\n</fieldset>", tip: "Closing fieldset.", hint: "Use </fieldset>." },
      { id: "m18", broken: "<div class=\"alert warn\">\n  <strong>Warning</strong> High RPM\n</div>", fixed: "<div class=\"alert warn\">\n  <strong>Warning</strong> High RPM\n</div>", tip: "Already valid — submit to clear.", hint: "No edit required." },
      { id: "m19", broken: "<ol>\n  <li>Isolate\n  <li>Vent\n  <li>Reset</li>\n</ol>", fixed: "<ol>\n  <li>Isolate</li>\n  <li>Vent</li>\n  <li>Reset</li>\n</ol>", tip: "First two items are open.", hint: "Close each <li>." },
      { id: "m20", broken: "<textarea rows=\"3\" cols=\"40\"\n  Enter command...\n</textarea>", fixed: "<textarea rows=\"3\" cols=\"40\">\n  Enter command...\n</textarea>", tip: "Textarea opening needs > before content.", hint: "Add > after 40\"." }
    ],
    hard: [
      { id: "h1", broken: "<div class=\"grid\">\n  <div class=\"cell\">A</div>\n  <div class=\"cell\">B\n  <div class=\"cell\">C</div>\n</div>", fixed: "<div class=\"grid\">\n  <div class=\"cell\">A</div>\n  <div class=\"cell\">B</div>\n  <div class=\"cell\">C</div>\n</div>", tip: "Middle cell was never closed; nesting breaks.", hint: "Close B's div before opening C." },
      { id: "h2", broken: "<form action=\"/set\" method=\"post\">\n  <label>RPM <input name=\"rpm\" type=\"number\" min=\"0\" max=\"1200\"></label>\n  <button>Set</button\n</form>", fixed: "<form action=\"/set\" method=\"post\">\n  <label>RPM <input name=\"rpm\" type=\"number\" min=\"0\" max=\"1200\"></label>\n  <button>Set</button>\n</form>", tip: "Button close is incomplete.", hint: "Finish </button> then keep </form>." },
      { id: "h3", broken: "<table>\n  <thead><tr><th>P</th><th>V</th></tr>\n  <tbody>\n    <tr><td>12</td><td>440</td></tr>\n  </tbody>\n</table>", fixed: "<table>\n  <thead><tr><th>P</th><th>V</th></tr></thead>\n  <tbody>\n    <tr><td>12</td><td>440</td></tr>\n  </tbody>\n</table>", tip: "thead is not closed.", hint: "Add </thead> after the header row." },
      { id: "h4", broken: "<div id=\"app\">\n  <header><h1>Terminal</h1></header>\n  <main><p>Ready</main>\n</div>", fixed: "<div id=\"app\">\n  <header><h1>Terminal</h1></header>\n  <main><p>Ready</p></main>\n</div>", tip: "Both <p> and <main> need to be closed.", hint: "Close p then main." },
      { id: "h5", broken: "<nav aria-label=\"Sectors\">\n  <ul>\n    <li><a href=\"#a\">A</a>\n    <li><a href=\"#b\">B</a></li>\n  </ul>\n</nav>", fixed: "<nav aria-label=\"Sectors\">\n  <ul>\n    <li><a href=\"#a\">A</a></li>\n    <li><a href=\"#b\">B</a></li>\n  </ul>\n</nav>", tip: "First <li> is unclosed.", hint: "Add </li> after the first link." },
      { id: "h6", broken: "<section>\n  <h2>Diagnostics</h2>\n  <pre><code>status: ok</pre></code>\n</section>", fixed: "<section>\n  <h2>Diagnostics</h2>\n  <pre><code>status: ok</code></pre>\n</section>", tip: "code / pre were closed in the wrong order.", hint: "Close code before pre." },
      { id: "h7", broken: "<div class=\"modal\">\n  <div class=\"dialog\" role=\"dialog\">\n    <h3>Confirm</h3>\n    <button>Yes</button>\n  </div>\n</div", fixed: "<div class=\"modal\">\n  <div class=\"dialog\" role=\"dialog\">\n    <h3>Confirm</h3>\n    <button>Yes</button>\n  </div>\n</div>", tip: "Outer div close is incomplete.", hint: "Finish </div>." },
      { id: "h8", broken: "<label>\n  <input type=\"checkbox\" name=\"auto\">\n  Auto-regulate\n</lable>", fixed: "<label>\n  <input type=\"checkbox\" name=\"auto\">\n  Auto-regulate\n</label>", tip: "Typo in the closing label.", hint: "lable → label." },
      { id: "h9", broken: "<article>\n  <header><h1>Report</h1></header>\n  <p>Unit heat nominal.\n  <footer>End</footer>\n</article>", fixed: "<article>\n  <header><h1>Report</h1></header>\n  <p>Unit heat nominal.</p>\n  <footer>End</footer>\n</article>", tip: "Paragraph was left open into the footer.", hint: "Close </p> before footer." },
      { id: "h10", broken: "<div data-zone=\"reactor\" class=\"holo\">\n  <span class=\"title\">REACTOR\n  <span class=\"val\">OK</span>\n</div>", fixed: "<div data-zone=\"reactor\" class=\"holo\">\n  <span class=\"title\">REACTOR</span>\n  <span class=\"val\">OK</span>\n</div>", tip: "Title span was never closed.", hint: "Close the title span." }
    ]
  };


  const TerminalUI = {
    visible: false,
    el: null,
    editor: null,
    status: null,
    hintEl: null,
    introEl: null,
    toolbarEl: null,
    editorWrap: null,
    workingEl: null,
    kbdEl: null,
    current: null,
    solved: 0,
    crisisActive: false,
    crisisCleared: true,
    _bootGrace: 25,
    _bootT: 0,
    _lastCond: "normal",
    _announced: false,
    _lockApplied: false,
    _viewportBound: false,
    _kbPad: 0,
    _shift: false,
    _physicalBlocked: true,

    init: function () {
      if (this.el) return;
      var host = document.getElementById("canvas-host") || document.getElementById("game") || document.body;
      var ov = document.createElement("div");
      ov.id = "terminal-overlay";
      ov.innerHTML =
        '<div class="term-shell">' +
        '  <div class="term-frame" role="dialog" aria-label="Engineering Terminal">' +
        '    <div class="term-header"><span class="term-title">TITAN // ENG-TERM-01</span><button type="button" class="term-close" aria-label="Close">×</button></div>' +
        '    <div class="term-body" id="term-intro"></div>' +
        '    <div id="term-working" class="term-working">WORKING...</div>' +
        '    <div class="term-editor-wrap"><textarea class="term-editor" id="term-editor" spellcheck="false" autocomplete="off" autocapitalize="off" enterkeyhint="done" inputmode="none" readonly style="display:none;"></textarea></div>' +
        '    <div class="term-hint" id="term-hint"></div>' +
        '    <div class="term-toolbar" id="term-toolbar" style="display:none;">' +
        '      <button type="button" class="primary" id="term-apply">APPLY FIX</button>' +
        '      <button type="button" id="term-hint-btn">HINT</button>' +
        '      <button type="button" id="term-skip">NEXT</button>' +
        '      <div class="term-nav">' +
        '        <button type="button" id="term-up" title="Up">▲</button>' +
        '        <button type="button" id="term-down" title="Down">▼</button>' +
        '        <button type="button" id="term-left" title="Left">◀</button>' +
        '        <button type="button" id="term-right" title="Right">▶</button>' +
        '      </div>' +
        '    </div>' +
        '    <div id="term-virtual-kbd" class="term-virtual-kbd" style="display:none;" aria-label="On-screen keyboard"></div>' +
        '    <div class="term-status" id="term-status">Standby.</div>' +
        '    <div class="term-kbd-hint">Use on-screen keyboard only · Esc closes · Challenges appear only during plant crises</div>' +
        '  </div>' +
        '  <button type="button" id="term-emergency-stop" class="term-emergency-stop" title="Emergency Stop — halt all plant systems">' +
        '    <span class="estop-label">EMERGENCY</span><span class="estop-sub">STOP</span>' +
        '  </button>' +
        '</div>';
      host.appendChild(ov);
      this.el = ov;
      this.editor = ov.querySelector("#term-editor");
      this.status = ov.querySelector("#term-status");
      this.hintEl = ov.querySelector("#term-hint");
      this.introEl = ov.querySelector("#term-intro");
      this.workingEl = ov.querySelector("#term-working");
      this.toolbarEl = ov.querySelector("#term-toolbar");
      this.kbdEl = ov.querySelector("#term-virtual-kbd");
      this._buildVirtualKeyboard();
      this._injectKbdStyles();
      var self = this;
      ov.querySelector(".term-close").addEventListener("click", function () { self.close(); });
      ov.querySelector("#term-apply").addEventListener("click", function () { self.apply(); });
      ov.querySelector("#term-hint-btn").addEventListener("click", function () { self.showHint(); });
      ov.querySelector("#term-skip").addEventListener("click", function () { self.nextChallenge(true); });
      ov.querySelector("#term-up").addEventListener("click", function () { self.nav("up"); });
      ov.querySelector("#term-down").addEventListener("click", function () { self.nav("down"); });
      ov.querySelector("#term-left").addEventListener("click", function () { self.nav("left"); });
      ov.querySelector("#term-right").addEventListener("click", function () { self.nav("right"); });
      ov.querySelector("#term-emergency-stop").addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.emergencyStop();
      });
      ov.addEventListener("click", function (e) { if (e.target === ov) self.close(); });
      document.addEventListener("keydown", function (e) {
        if (!self.visible) return;
        if (e.key === "Escape") { e.preventDefault(); self.close(); return; }
        // Block ALL physical keyboard input while terminal is open (force on-screen kbd)
        if (self._physicalBlocked) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
      }, true);
      // Make textarea non-editable via physical keys / IME
      this.editor.setAttribute("readonly", "readonly");
      this.editor.setAttribute("inputmode", "none");
      this.editor.addEventListener("keydown", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      this.editor.addEventListener("keypress", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      this.editor.addEventListener("beforeinput", function (e) {
        e.preventDefault();
      });
      this.editor.addEventListener("paste", function (e) {
        e.preventDefault();
      });
      this.editor.addEventListener("drop", function (e) {
        e.preventDefault();
      });
      this.editor.addEventListener("focus", function () { self._adaptToKeyboard(true); });
      this.editor.addEventListener("blur", function () { self._adaptToKeyboard(false); });
      this._bindViewport();
      this._setModeIdle();
      this._patchApplySwitch();
    },

    _injectKbdStyles: function () {
      if (document.getElementById("term-kbd-styles")) return;
      var css = document.createElement("style");
      css.id = "term-kbd-styles";
      css.textContent = [
        "#terminal-overlay .term-virtual-kbd {",
        "  display: none; flex: 0 0 auto; flex-direction: column; gap: clamp(1px, .45vh, 4px);",
        "  width: 100%; max-width: 100%; min-width: 0; padding: clamp(2px, .8vh, 6px) clamp(2px, .6vw, 8px);",
        "  background: #0a1a0a; border-top: 1px solid #1a3a1a; user-select: none;",
        "  -webkit-user-select: none; touch-action: manipulation;",
        "}",
        "#terminal-overlay .term-virtual-kbd.show { display: flex; }",
        "#terminal-overlay .term-kbd-row {",
        "  display: flex; width: 100%; min-width: 0; gap: clamp(1px, .3vw, 4px);",
        "  justify-content: center; align-items: stretch; flex-wrap: nowrap;",
        "}",
        "#terminal-overlay .term-kbd-key {",
        "  flex: 1 1 0; min-width: 0; max-width: clamp(34px, 5.2vw, 66px); height: clamp(22px, 4.4vh, 36px);",
        "  background: #142814; border: 1px solid #2a4a2a; border-radius: 4px;",
        "  color: #9fdf9f; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
        "  font-size: clamp(.48rem, 1.2vw, .78rem); font-weight: 600; cursor: pointer; display: flex;",
        "  align-items: center; justify-content: center; padding: 0 1px; line-height: 1; white-space: nowrap;",
        "  transition: background 0.08s, transform 0.06s; touch-action: manipulation;",
        "  -webkit-tap-highlight-color: transparent;",
        "}",
        "#terminal-overlay .term-kbd-key:active, #terminal-overlay .term-kbd-key.active {",
        "  background: #1e5a1e; transform: scale(0.96);",
        "}",
        "#terminal-overlay .term-kbd-key.wide { max-width: clamp(42px, 7vw, 70px); flex: 1.5 1 0; font-size: clamp(.46rem, 1.05vw, .7rem); }",
        "#terminal-overlay .term-kbd-key.wider { max-width: clamp(54px, 9vw, 90px); flex: 2 1 0; font-size: clamp(.46rem, 1.05vw, .7rem); }",
        "#terminal-overlay .term-kbd-key.space { max-width: none; flex: 4 1 0; }",
        "#terminal-overlay .term-kbd-key.special { background: #1a2a1a; color: #c0e0c0; }",
        "#terminal-overlay .term-kbd-key.shift-on { background: #2a5a2a; border-color: #44aa44; color: #fff; }",
        "#terminal-overlay .term-editor[readonly] { caret-color: #66ff99; }",
        "@media screen and (max-width: 520px) {",
        "  #terminal-overlay .term-kbd-key { height: clamp(22px, 4.1vh, 32px); font-size: clamp(.46rem, 1.8vw, .7rem); max-width: clamp(25px, 8vw, 42px); }",
        "  #terminal-overlay .term-kbd-key.wide { max-width: clamp(38px, 12vw, 54px); }",
        "  #terminal-overlay .term-kbd-key.wider { max-width: clamp(48px, 15vw, 72px); }",
        "}",
        "@media screen and (orientation: landscape) {",
        "  #terminal-overlay .term-virtual-kbd { gap: clamp(1px, .35vh, 3px); padding: clamp(2px, .6vh, 5px) clamp(2px, .6vw, 8px); }",
        "  #terminal-overlay .term-kbd-key { height: clamp(19px, 5.2vh, 31px); font-size: clamp(.46rem, 1.35vw, .72rem); }",
        "}",
        "@media screen and (orientation: landscape) and (max-height: 420px) {",
        "  #terminal-overlay .term-virtual-kbd { gap: 1px; padding: 2px; }",
        "  #terminal-overlay .term-kbd-row { gap: 1px; }",
        "  #terminal-overlay .term-kbd-key { height: clamp(16px, 4.8vh, 22px); font-size: clamp(.42rem, 1.15vw, .62rem); border-radius: 3px; }",
        "  #terminal-overlay .term-kbd-key.wide, #terminal-overlay .term-kbd-key.wider { font-size: clamp(.4rem, 1.05vw, .58rem); }",
        "}",
        "@media screen and (max-height: 480px) and (orientation: portrait) {",
        "  #terminal-overlay .term-kbd-key { height: 22px; }",
        "}",
        "@supports (height: 100dvh) {",
        "  @media screen and (orientation: landscape) and (max-height: 640px) {",
        "    #terminal-overlay .term-kbd-key { height: clamp(18px, 5.2dvh, 31px); }",
        "  }",
        "}"
      ].join("\n");
      document.head.appendChild(css);
    },

    _buildVirtualKeyboard: function () {
      if (!this.kbdEl) return;
      var self = this;
      // Full native-style keyboard: letters, numbers, and comprehensive symbols
      // so every character needed for terminal markup / recovery can be typed
      // without relying on the device system keyboard.
      var rows = [
        ["`", "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "-", "_", "=", "+"],
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\", "|"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", ":", "'", "\""],
        ["Shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "?", "Bksp"],
        ["<", ">", "{", "}", "(", ")", "&", "#", "@", "%", "*", "+"],
        ["Tab", "Space", "Enter", "Del"]
      ];
      this.kbdEl.innerHTML = "";
      rows.forEach(function (row) {
        var rowEl = document.createElement("div");
        rowEl.className = "term-kbd-row";
        row.forEach(function (label) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "term-kbd-key";
          btn.textContent = label === "Space" ? "␣" : label;
          btn.setAttribute("data-key", label);
          if (label === "Shift" || label === "Bksp" || label === "Tab" || label === "Enter" || label === "Del") {
            btn.classList.add("special");
            if (label === "Shift" || label === "Bksp") btn.classList.add("wide");
            if (label === "Tab" || label === "Enter" || label === "Del") btn.classList.add("wide");
          }
          if (label === "Space") btn.classList.add("space", "special");
          // Touch-friendly: use pointer events
          var fire = function (e) {
            e.preventDefault();
            e.stopPropagation();
            self._kbdPress(label, btn);
          };
          btn.addEventListener("pointerdown", fire);
          btn.addEventListener("click", function (e) { e.preventDefault(); });
          rowEl.appendChild(btn);
        });
        this.kbdEl.appendChild(rowEl);
      }.bind(this));
    },

    _kbdPress: function (label, btn) {
      var ed = this.editor;
      if (!ed || ed.style.display === "none") return;
      if (btn) {
        btn.classList.add("active");
        setTimeout(function () { btn.classList.remove("active"); }, 90);
      }
      var start = ed.selectionStart || 0;
      var end = ed.selectionEnd || 0;
      var val = ed.value || "";
      var insert = "";
      var newPos = start;

      if (label === "Shift") {
        this._shift = !this._shift;
        this._updateShiftKeys();
        return;
      }
      if (label === "Bksp") {
        if (start !== end) {
          ed.value = val.slice(0, start) + val.slice(end);
          newPos = start;
        } else if (start > 0) {
          ed.value = val.slice(0, start - 1) + val.slice(end);
          newPos = start - 1;
        } else {
          newPos = 0;
        }
        ed.selectionStart = ed.selectionEnd = newPos;
        this._notifyEditor();
        return;
      }
      if (label === "Del") {
        if (start !== end) {
          ed.value = val.slice(0, start) + val.slice(end);
        } else if (start < val.length) {
          ed.value = val.slice(0, start) + val.slice(start + 1);
        }
        ed.selectionStart = ed.selectionEnd = start;
        this._notifyEditor();
        return;
      }
      if (label === "Enter") {
        insert = "\n";
      } else if (label === "Tab") {
        insert = "  ";
      } else if (label === "Space") {
        insert = " ";
      } else {
        insert = this._shift ? label.toUpperCase() : label;
        if (this._shift && label.length === 1 && label >= "a" && label <= "z") {
          // already upper
        } else if (this._shift) {
          // keep symbols as-is; shift mainly for letters
        }
        // Auto-release shift after letter
        if (this._shift && label.length === 1 && /[a-z]/i.test(label)) {
          this._shift = false;
          this._updateShiftKeys();
        }
      }
      ed.value = val.slice(0, start) + insert + val.slice(end);
      newPos = start + insert.length;
      ed.selectionStart = ed.selectionEnd = newPos;
      this._notifyEditor();
      // Keep focus without opening system keyboard
      try { ed.focus({ preventScroll: true }); } catch (_) { try { ed.focus(); } catch (__) {} }
    },

    _updateShiftKeys: function () {
      if (!this.kbdEl) return;
      var keys = this.kbdEl.querySelectorAll(".term-kbd-key");
      var shiftOn = this._shift;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var lab = k.getAttribute("data-key") || "";
        if (lab === "Shift") {
          k.classList.toggle("shift-on", shiftOn);
        } else if (lab.length === 1 && lab >= "a" && lab <= "z") {
          k.textContent = shiftOn ? lab.toUpperCase() : lab;
        }
      }
    },

    _notifyEditor: function () {
      // Trigger any listeners if needed
      try {
        var ev = new Event("input", { bubbles: true });
        this.editor.dispatchEvent(ev);
      } catch (_) {}
    },

    _patchApplySwitch: function () {
      var self = this;
      // Patch InputManager so main breaker cannot be closed during terminal crisis
      function guard(key, on) {
        if (key === "main" && on && self.crisisActive && !self.crisisCleared) {
          if (window.Game && Game.log) {
            Game.log("BLOCKED: Main breaker cannot close while terminal crisis lock is active. Repair the engineering terminal first.");
          }
          self.speak("Main breaker interlock active. Repair the terminal under the dashboard before closing the breaker.");
          // Force UI back to OFF
          var btn = document.querySelector('.switch[data-switch="main"]');
          if (btn) {
            btn.setAttribute("aria-pressed", "false");
            btn.textContent = "OFF";
          }
          if (window.Game && Game.state && Game.state.electrics) {
            Game.state.electrics.main = false;
          }
          return false;
        }
        return true;
      }

      if (window.InputManager && InputManager.applySwitch && !InputManager._termGuard) {
        var prev = InputManager.applySwitch.bind(InputManager);
        InputManager.applySwitch = function (key, on) {
          if (!guard(key, on)) return;
          return prev(key, on);
        };
        InputManager._termGuard = true;
      }

      // Also patch direct voice path if still available later
      this._guardMain = guard;
    },

    _bindViewport: function () {
      if (this._viewportBound) return;
      this._viewportBound = true;
      var self = this;
      var onVV = function () {
        if (!self.visible) return;
        self._adaptToKeyboard(!!(self.editor && document.activeElement === self.editor));
      };
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", onVV);
        window.visualViewport.addEventListener("scroll", onVV);
      }
      window.addEventListener("resize", onVV);
      window.addEventListener("orientationchange", function () {
        setTimeout(onVV, 120);
        setTimeout(onVV, 400);
      });
    },

    _adaptToKeyboard: function (focused) {
      if (!this.el) return;
      var shell = this.el.querySelector(".term-shell");
      var frame = this.el.querySelector(".term-frame");
      if (!shell || !frame) return;
      var vv = window.visualViewport;
      var layoutH = window.innerHeight || document.documentElement.clientHeight || 600;
      var visH = vv ? vv.height : layoutH;
      var offsetTop = vv ? vv.offsetTop : 0;
      // Physical keyboard should not open; we still size for the on-screen kbd
      var hostH = this.el.getBoundingClientRect().height || visH;
      var avail = Math.max(120, Math.floor(Math.min(visH, hostH) - 16));
      shell.style.maxHeight = avail + "px";
      shell.style.top = Math.max(0, offsetTop) + "px";
      shell.style.transform = "translateY(0)";
      frame.style.maxHeight = Math.max(200, avail - 12) + "px";
      if (this.editor) {
        this.editor.style.maxHeight = Math.max(34, Math.min(140, Math.floor(avail * 0.22))) + "px";
      }
    },

    _setModeIdle: function () {
      if (this.workingEl) this.workingEl.style.display = "block";
      if (this.editor) this.editor.style.display = "none";
      if (this.toolbarEl) this.toolbarEl.style.display = "none";
      if (this.kbdEl) {
        this.kbdEl.style.display = "none";
        this.kbdEl.classList.remove("show");
      }
      if (this.introEl) this.introEl.textContent = "";
      if (this.hintEl) this.hintEl.textContent = "";
      if (this.status) this.status.textContent = "Standby — no active crisis.";
      this.current = null;
    },

    _setModeChallenge: function () {
      if (this.workingEl) this.workingEl.style.display = "none";
      if (this.editor) this.editor.style.display = "block";
      if (this.toolbarEl) this.toolbarEl.style.display = "flex";
      if (this.kbdEl) {
        this.kbdEl.style.display = "flex";
        this.kbdEl.classList.add("show");
      }
      this._shift = false;
      this._updateShiftKeys();
    },

    open: function () {
      this.init();
      this.visible = true;
      this.el.classList.add("show");
      this._adaptToKeyboard(false);
      if (this.crisisActive && !this.crisisCleared) {
        this._setModeChallenge();
        if (!this.current) this.nextChallenge(false);
        else this._loadCurrent();
        var ed = this.editor;
        requestAnimationFrame(function () {
          setTimeout(function () {
            try { ed.focus({ preventScroll: true }); } catch (_) { try { ed.focus(); } catch (__) {} }
          }, 40);
        });
      } else {
        this._setModeIdle();
      }
      if (window.Game && Game.log) {
        if (this.crisisActive && !this.crisisCleared)
          Game.log("Terminal crisis lock active — repair the HTML control block to restore full plant authority.");
        else
          Game.log("Engineering terminal: WORKING...");
      }
    },

    close: function () {
      this.visible = false;
      if (this.el) this.el.classList.remove("show");
      if (this.editor) try { this.editor.blur(); } catch (_) {}
      this._adaptToKeyboard(false);
    },

    _randomLevel: function () {
      var r = Math.random();
      if (r < 0.45) return "easy";
      if (r < 0.85) return "medium";
      return "hard";
    },

    _pick: function (level) {
      level = level || this._randomLevel();
      var list = TERM_CHALLENGES[level] || TERM_CHALLENGES.easy;
      var c = list[Math.floor(Math.random() * list.length)];
      return Object.assign({ level: level }, c);
    },

    nextChallenge: function (forceNew) {
      if (!this.crisisActive || this.crisisCleared) {
        this._setModeIdle();
        return;
      }
      this.current = this._pick(forceNew ? this._randomLevel() : (this.current && this.current.level) || this._randomLevel());
      this._setModeChallenge();
      this._loadCurrent();
    },

    _loadCurrent: function () {
      if (!this.current) return;
      if (this.introEl) {
        this.introEl.textContent =
          "CRISIS LOCK — difficulty: " + this.current.level.toUpperCase() +
          "\nPlant controls are constrained until this markup is valid.\nUse the ON-SCREEN KEYBOARD only.\nTip: " + this.current.tip;
      }
      if (this.editor) this.editor.value = this.current.broken;
      if (this.hintEl) this.hintEl.textContent = "";
      if (this.status) this.status.textContent = "Crisis challenge · " + this.current.level + " · solve to restore operations";
    },

    showHint: function () {
      if (this.current && this.hintEl) this.hintEl.textContent = "HINT: " + this.current.hint;
    },

    normalize: function (s) {
      return String(s || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    },

    apply: function () {
      if (!this.crisisActive || this.crisisCleared) {
        if (this.status) this.status.textContent = "No crisis — terminal is WORKING.";
        return;
      }
      if (!this.current || !this.editor) return;
      var user = this.normalize(this.editor.value);
      var target = this.normalize(this.current.fixed);
      var ok = user === target || user.replace(/\s+/g, " ") === target.replace(/\s+/g, " ");
      if (ok) {
        this.solved += 1;
        this.crisisCleared = true;
        this.crisisActive = false;
        this._announced = false;
        this._clearPlantLock();
        if (this.status) this.status.textContent = "ACCEPTED — crisis lock cleared. Operations restored.";
        if (window.Game && Game.log) Game.log("Terminal repair accepted. Full plant authority restored. Main breaker interlock released.");
        this.speak("Terminal markup repaired. Crisis lock cleared. Main breaker interlock released. Plant operations may continue.");
        this._setModeIdle();
      } else {
        if (this.status) this.status.textContent = "REJECTED — markup still invalid. Check tags and try again.";
        this.showHint();
      }
    },

    nav: function (dir) {
      var ed = this.editor;
      if (!ed || ed.style.display === "none") return;
      var start = ed.selectionStart || 0;
      var val = ed.value || "";
      if (dir === "left") ed.selectionStart = ed.selectionEnd = Math.max(0, start - 1);
      else if (dir === "right") ed.selectionStart = ed.selectionEnd = Math.min(val.length, start + 1);
      else if (dir === "up" || dir === "down") {
        var lines = val.split("\n");
        var pos = 0, row = 0, col = 0, i;
        for (i = 0; i < lines.length; i++) {
          if (pos + lines[i].length >= start) {
            row = i;
            col = start - pos;
            break;
          }
          pos += lines[i].length + 1;
        }
        if (dir === "up") row = Math.max(0, row - 1);
        else row = Math.min(lines.length - 1, row + 1);
        pos = 0;
        for (i = 0; i < row; i++) pos += lines[i].length + 1;
        pos += Math.min(col, lines[row] ? lines[row].length : 0);
        ed.selectionStart = ed.selectionEnd = pos;
      }
      try { ed.focus({ preventScroll: true }); } catch (_) { try { ed.focus(); } catch (__) {} }
    },

    speak: function (text) {
      try {
        if (window.VoiceCore && typeof VoiceCore.speak === "function") { VoiceCore.speak(text); return; }
        if (window.speechSynthesis) {
          var u = new SpeechSynthesisUtterance(text);
          u.rate = 1;
          window.speechSynthesis.speak(u);
        }
      } catch (_) {}
    },

    /**
     * Hard emergency stop: immediately halt propulsion & idle fuel, prioritise cooling,
     * clear heat deadlines. Plant is stabilised but FULL AUTHORITY is restored only
     * when the operator completes the terminal recovery (APPLY FIX). The terminal is
     * always the last required step after any critical event.
     */
    emergencyStop: function () {
      try {
        var st = window.Game && Game.state;
        if (st) {
          if (st.motors) {
            st.motors.motor1 = false;
            st.motors.motor2 = false;
            st.motors.clutch = false;
            st.motors.alt = false;
            if (typeof st.motors.targetRpm === "number") st.motors.targetRpm = 0;
            if (typeof st.motors.throttle === "number") st.motors.throttle = 0;
          }
          if (st.reactor) {
            if (typeof st.reactor.fuelFeed === "number") st.reactor.fuelFeed = 8;
            if (typeof st.reactor.airIntake === "number") st.reactor.airIntake = 12;
          }
          if (st.cooling) {
            if (st.cooling.lubPump === false) st.cooling.lubPump = true;
            if (st.cooling.swPump === false) st.cooling.swPump = true;
            if (typeof st.cooling.lubCooler === "number") st.cooling.lubCooler = Math.max(st.cooling.lubCooler, 80);
            if (typeof st.cooling.h2oCooler === "number") st.cooling.h2oCooler = Math.max(st.cooling.h2oCooler, 80);
          }
          if (st.machineHeat) {
            Object.keys(st.machineHeat).forEach(function (k) {
              if (st.machineHeat[k] > 55) st.machineHeat[k] = 55;
            });
          }
          // Keep condition elevated so recovery still routes through terminal
          st.condition = "warning";
          if (st.activeFaults) st.activeFaults = [];
        }
        if (window.HeatEmergency) {
          Object.keys(HeatEmergency.deadlines || {}).forEach(function (k) {
            HeatEmergency.deadlines[k] = null;
          });
          HeatEmergency._gameOverTriggered = false;
          if (typeof HeatEmergency._updateBanner === "function") HeatEmergency._updateBanner();
        }
        // Stabilise but do NOT clear the terminal recovery lock.
        // The terminal remains the final required action to restore full authority.
        this.crisisActive = true;
        this.crisisCleared = false;
        this._announced = false;
        this._applyPlantLock();
        this.current = this._pick("easy");
        this._setModeChallenge();
        this._loadCurrent();
        if (this.status) {
          this.status.textContent = "EMERGENCY STOP — propulsion halted. Complete terminal recovery to restore full authority.";
        }
        if (window.Game && Game.log) {
          Game.log("EMERGENCY STOP engaged. Motors offline, fuel idled, cooling prioritised. Terminal recovery still required.");
        }
        this.speak("Emergency stop. All propulsion systems offline. Fuel feed idled. Cooling maximised. Complete the terminal recovery under the dashboard to restore full plant authority.");
        var btn = this.el && this.el.querySelector("#term-emergency-stop");
        if (btn) {
          btn.classList.add("estop-fired");
          setTimeout(function () { btn.classList.remove("estop-fired"); }, 1800);
        }
      } catch (err) {
        console.warn("Emergency stop error", err);
        if (this.status) this.status.textContent = "Emergency stop attempted.";
      }
    },

    _detectCrisis: function () {
      try {
        if (window.HeatEmergency && HeatEmergency.anyCritical && HeatEmergency.anyCritical()) return true;
        var st = window.Game && Game.state;
        if (!st) return false;
        if (st.condition === "critical") return true;
        if (st.machineHeat) {
          var keys = ["electrics", "reactor", "regulator", "motors"];
          for (var i = 0; i < keys.length; i++) {
            if ((st.machineHeat[keys[i]] || 0) >= 95) return true;
          }
        }
        return false;
      } catch (_) { return false; }
    },

    _forceMainBreakerOff: function () {
      var st = window.Game && Game.state;
      if (!st || !st.electrics) return;
      if (st.electrics.main) {
        st.electrics.main = false;
        var btn = document.querySelector('.switch[data-switch="main"]');
        if (btn) {
          btn.setAttribute("aria-pressed", "false");
          btn.textContent = "OFF";
        }
      }
    },

    _applyPlantLock: function () {
      this._lockApplied = true;
      var st = window.Game && Game.state;
      if (!st) return;
      // Always force main breaker OFF while terminal crisis is unresolved
      this._forceMainBreakerOff();
      if (st.motors) {
        if (typeof st.motors.throttle === "number" && st.motors.throttle > 35) st.motors.throttle = 35;
        if (typeof st.motors.targetRpm === "number" && st.motors.targetRpm > 400) st.motors.targetRpm = 400;
      }
      if (st.reactor && typeof st.reactor.fuelFeed === "number" && st.reactor.fuelFeed > 40) st.reactor.fuelFeed = 40;
    },

    _clearPlantLock: function () {
      this._lockApplied = false;
      // Do NOT auto-close the breaker; user/assistant must re-close it after terminal is fixed
    },

    tick: function (dt) {
      this._bootT += dt;
      if (this._bootT < this._bootGrace) {
        this.crisisActive = false;
        this.crisisCleared = true;
        return;
      }

      var inCrisis = this._detectCrisis();
      if (inCrisis) {
        if (!this.crisisActive && this.crisisCleared) {
          this.crisisActive = true;
          this.crisisCleared = false;
          this.current = null;
          this._announced = false;
        }
        if (this.crisisActive && !this.crisisCleared) {
          this._applyPlantLock();
          if (!this._announced) {
            this._announced = true;
            if (window.Game && Game.log) {
              Game.log("CRISIS LOCK: Stabilise the plant AND repair terminal HTML under the central dashboard. Main breaker interlocked OPEN until terminal is fixed.");
            }
            var lines = [
              "Warning. Plant crisis detected. Stabilise the systems, then repair the terminal under the main dashboard. Main breaker is interlocked open. I cannot fix the HTML for you.",
              "Crisis lock engaged. Component adjustments alone are not enough. Walk to the engineering terminal under the monitor bank and repair the code. Main breaker will stay open until then.",
              "Overheat or fault path active. I am unable to edit the console markup. Please fix the terminal under the dashboard so operations can fully resume. Breaker interlock is active.",
              "Attention. A plant warning requires both stabilisation and a terminal HTML repair. The terminal is under the central dashboard. Main breaker remains open."
            ];
            this.speak(lines[Math.floor(Math.random() * lines.length)]);
          }
        }
      } else {
        // Plant itself is no longer in crisis, but terminal may still be unrepaired
        if (this.crisisCleared) {
          this.crisisActive = false;
        }
        if (!this.crisisCleared) {
          // Keep lock + main breaker forced OFF until terminal HTML is repaired
          this._applyPlantLock();
        }
      }
    }
  };
  window.TerminalUI = TerminalUI;
  window.TerminalUI = TerminalUI;

  function hookHardware() {
    if (!window.HardwareSystem || !HardwareSystem.update || HardwareSystem._termHooked) return;
    var prev = HardwareSystem.update.bind(HardwareSystem);
    HardwareSystem.update = function (dt) {
      prev(dt);
      try { TerminalUI.tick(dt); } catch (_) {}
    };
    HardwareSystem._termHooked = true;
  }

  function tryPlaceTerminalProp() {
    try {
      if (!window.THREE || !window.SceneManager || !SceneManager.scenes || !SceneManager.scenes.engine) return;
      if (SceneManager._terminalProp) return;
      var scene = SceneManager.scenes.engine;
      var g = new THREE.Group();
      var base = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.12, 0.65),
        new THREE.MeshStandardMaterial({ color: 0x1a2a1a, metalness: 0.4, roughness: 0.6 })
      );
      base.position.y = 0.06;
      g.add(base);
      var body = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.95, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x0d1a0d, metalness: 0.3, roughness: 0.55 })
      );
      body.position.y = 0.58;
      g.add(body);
      var screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.36, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x033303, emissive: 0x22ff55, emissiveIntensity: 0.55, metalness: 0.1, roughness: 0.4 })
      );
      screen.position.set(0, 0.85, 0.22);
      g.add(screen);
      var beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x22ff44, emissiveIntensity: 0.85 })
      );
      beacon.position.set(0.32, 1.12, 0.08);
      g.add(beacon);
      // Under central monitor bank (FRONT_Z ≈ -7.08) — slightly forward so walkable
      g.position.set(0, 0, -6.35);
      g.rotation.y = 0;
      scene.add(g);
      SceneManager._terminalProp = g;
      if (SceneManager.collisionBoxes) {
        SceneManager.collisionBoxes.push({ minX: -0.65, maxX: 0.65, minZ: -6.75, maxZ: -5.95, name: "terminal" });
      }
    } catch (e) {
      console.warn("Terminal prop placement skipped", e);
    }
  }

  function boot() {
    enhanceHologram();
    TerminalUI.init();
    hookHardware();
    var tries = 0;
    function place() {
      tries++;
      tryPlaceTerminalProp();
      if (!SceneManager._terminalProp && tries < 25) setTimeout(place, 400);
    }
    setTimeout(place, 600);

    if (window.HologramUI) {
      var ot = HologramUI.toggle;
      if (ot) {
        HologramUI.toggle = function (zone) {
          enhanceHologram();
          return ot.call(this, zone);
        };
      }
      var os = HologramUI.show;
      if (os) {
        HologramUI.show = function (zone) {
          enhanceHologram();
          var r = os.call(this, zone);
          if (this._render && this.zone) {
            var cfg = this.zoneConfig(this.zone);
            if (cfg) this._render(cfg);
          }
          return r;
        };
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 120);
})();
