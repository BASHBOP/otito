// Verbatim presentation blocks for the How It Works page.
//
// Generated-file authoring split: this module holds the styling and behaviour
// that do not depend on the tool catalog, while generate-how-it-works.mjs owns
// everything derived from it. Edit the CSS or the interaction code here; edit
// the page's content in the generator's PHASES, LAYOUT, SURFACES and STEPS
// tables.
//
// The palette is the docs site's (mkdocs Material, teal primary, cyan accent,
// docs/stylesheets/extra.css) so the page reads as part of the site it is
// linked from, in both colour schemes.

export const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

export const STYLE = `
:root {
  --bg: #f4f7f8;
  --surface: #ffffff;
  --surface-2: #eef3f5;
  --ink: #132029;
  --text: #22333d;
  --muted: #5b6b75;
  --line: rgba(19, 32, 41, 0.14);
  --line-strong: rgba(19, 32, 41, 0.28);
  --teal: #14746f;
  --cyan: #168aad;
  --green: #2d7d56;
  --amber: #b7791f;
  --violet: #6b5bb5;
  --slate: #4a5a66;
  --red: #b3403a;
  --shadow: 0 0.45rem 1.4rem rgba(19, 32, 41, 0.08);
  --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f171c;
    --surface: #16222a;
    --surface-2: #1c2a33;
    --ink: #eef3f6;
    --text: #d9e2e8;
    --muted: #9fb0ba;
    --line: rgba(230, 237, 241, 0.13);
    --line-strong: rgba(230, 237, 241, 0.3);
    --teal: #3fb6ae;
    --cyan: #4fb5d8;
    --green: #58b283;
    --amber: #e0a84a;
    --violet: #a99be0;
    --slate: #9aacb8;
    --red: #ef7b74;
    --shadow: 0 0.45rem 1.4rem rgba(0, 0, 0, 0.35);
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  --bg: #0f171c;
  --surface: #16222a;
  --surface-2: #1c2a33;
  --ink: #eef3f6;
  --text: #d9e2e8;
  --muted: #9fb0ba;
  --line: rgba(230, 237, 241, 0.13);
  --line-strong: rgba(230, 237, 241, 0.3);
  --teal: #3fb6ae;
  --cyan: #4fb5d8;
  --green: #58b283;
  --amber: #e0a84a;
  --violet: #a99be0;
  --slate: #9aacb8;
  --red: #ef7b74;
  --shadow: 0 0.45rem 1.4rem rgba(0, 0, 0, 0.35);
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--cyan);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

code,
.mono {
  font-family: var(--mono);
  font-size: 0.92em;
}

button {
  font: inherit;
  color: inherit;
}

.wrap {
  width: min(1180px, 100% - 32px);
  margin: 0 auto;
}

/* ---- masthead ------------------------------------------------------- */

.masthead {
  padding: 2.4rem 0 1.6rem;
}

.eyebrow {
  margin: 0 0 0.6rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--teal);
}

.masthead h1 {
  margin: 0;
  font-size: clamp(1.55rem, 1.1rem + 2vw, 2.45rem);
  font-weight: 720;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--ink);
  max-width: 30ch;
}

.masthead h1 em {
  font-style: normal;
  color: var(--teal);
}

.lede {
  margin: 0.9rem 0 0;
  max-width: 62ch;
  font-size: 1.02rem;
  color: var(--muted);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.6rem;
  margin: 1.2rem 0 0;
  padding: 0;
  list-style: none;
}

.facts li {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 0.8rem;
  color: var(--text);
}

.facts i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--teal);
  flex: none;
}

/* ---- strips (ways in, what comes out) -------------------------------- */

.strip {
  padding: 0.4rem 0 1.2rem;
}

.strip-head {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  margin: 0 0 0.7rem;
}

.strip-head h2,
.section-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.strip-head p {
  margin: 0;
  font-size: 0.86rem;
  color: var(--muted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.7rem;
}

/* ---- cards ------------------------------------------------------------ */

.card {
  --c: var(--teal);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0.75rem 0.85rem 0.7rem;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 12px 0 0 12px;
  background: var(--c);
  opacity: 0.85;
}

.card:hover,
.card:focus-visible {
  border-color: var(--c);
  outline: none;
  transform: translateY(-1px);
}

.card.is-active {
  border-color: var(--c);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--c) 40%, transparent),
    var(--shadow);
}

.card-name {
  font-family: var(--mono);
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.card.surface .card-name {
  font-family: var(--font);
  font-size: 0.95rem;
}

.card-sub {
  font-size: 0.82rem;
  color: var(--muted);
}

.card-cli {
  margin-top: 0.3rem;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
}

.card-hosts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.card-hosts span {
  padding: 0.12rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.74rem;
  color: var(--text);
}

/* ---- layout: timeline + rail ---------------------------------------- */

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  padding: 0.6rem 0 1.6rem;
}

@media (min-width: 980px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 1.4rem;
    align-items: start;
  }

  .rail {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow: auto;
    scrollbar-width: thin;
  }
}

.timeline {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline::before {
  content: "";
  position: absolute;
  top: 1.2rem;
  bottom: 1.2rem;
  left: 13px;
  width: 2px;
  background: var(--line-strong);
  opacity: 0.5;
}

.phase {
  --c: var(--teal);
  position: relative;
  margin: 0 0 0.85rem;
  padding: 0.95rem 1rem 1rem 2.4rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  transition:
    opacity 0.35s ease,
    border-color 0.35s ease,
    background 0.35s ease;
}

@supports (background: color-mix(in srgb, red 10%, white)) {
  .phase {
    background: color-mix(in srgb, var(--c) 4%, var(--surface));
  }

  .phase.is-active {
    background: color-mix(in srgb, var(--c) 9%, var(--surface));
  }
}

.phase.is-active {
  border-color: var(--c);
}

.timeline.has-focus .phase:not(.is-active) {
  opacity: 0.62;
}

.phase::before {
  content: "";
  position: absolute;
  top: 1.25rem;
  left: -1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c);
  border: 3px solid var(--bg);
  box-shadow: 0 0 0 2px var(--c);
  transform: translateX(-7px);
}

.phase-head {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.15rem 0.7rem;
  align-items: baseline;
  margin-bottom: 0.7rem;
}

.phase-index {
  grid-row: 1 / span 2;
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--c);
  padding-top: 0.2rem;
}

.phase-head h2 {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 680;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.phase-actor {
  margin: 0;
  font-size: 0.8rem;
  color: var(--c);
  font-weight: 600;
}

.phase-sub {
  grid-column: 2;
  margin: 0.15rem 0 0;
  font-size: 0.88rem;
  color: var(--muted);
  max-width: 70ch;
}

.phase .grid {
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 0.6rem;
}

.phase .card {
  --c: inherit;
}

.phase.model .grid {
  grid-template-columns: 1fr;
}

/* ---- rail: walkthrough + detail ------------------------------------- */

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem 1.05rem;
}

.panel + .panel {
  margin-top: 0.85rem;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.7rem;
}

.play {
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.play:hover,
.play:focus-visible {
  border-color: var(--teal);
  outline: none;
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.3rem;
}

.step {
  --c: var(--teal);
  display: grid;
  grid-template-columns: 1.6rem 1fr;
  gap: 0.15rem 0.7rem;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.25s ease,
    border-color 0.25s ease;
}

.step:hover,
.step:focus-visible {
  border-color: var(--line);
  outline: none;
}

.step.is-active {
  border-color: var(--c);
  background: var(--surface-2);
}

.step .step-num {
  grid-row: 1 / span 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: var(--c);
  color: #fff;
  font-family: var(--mono);
  font-size: 0.72rem;
  font-weight: 600;
}

.step strong {
  font-size: 0.9rem;
  color: var(--ink);
}

.step span {
  font-size: 0.8rem;
  color: var(--muted);
}

.detail-kind {
  margin: 0 0 0.25rem;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.detail h3 {
  margin: 0;
  font-family: var(--mono);
  font-size: 1rem;
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.detail h3.plain {
  font-family: var(--font);
}

.detail p {
  margin: 0.55rem 0 0;
  font-size: 0.9rem;
  color: var(--text);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.chip {
  padding: 0.18rem 0.55rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--text);
}

/* ---- guarantees --------------------------------------------------------- */

.guarantees {
  padding: 0.4rem 0 1.6rem;
}

.guarantees .grid {
  grid-template-columns: 1fr;
  margin-top: 0.7rem;
}

@media (min-width: 640px) {
  .guarantees .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1100px) {
  .guarantees .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.guarantee {
  --c: var(--teal);
  padding: 0.9rem 1rem 0.95rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}

.guarantee h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 680;
  color: var(--ink);
}

.guarantee h3::before {
  content: "";
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--c);
  flex: none;
}

.guarantee p {
  margin: 0;
  font-size: 0.86rem;
  color: var(--muted);
}

/* ---- footer ------------------------------------------------------------- */

footer {
  padding: 1.2rem 0 2.2rem;
  border-top: 1px solid var(--line);
  font-size: 0.82rem;
  color: var(--muted);
}

footer .wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.2rem;
}

@media (max-width: 600px) {
  .masthead {
    padding-top: 1.6rem;
  }

  .phase {
    padding-left: 2rem;
  }

  .phase .grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 420px) {
  .phase .grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
`;

export const SCRIPT = `
const cards = [...document.querySelectorAll(".card[data-id]")];
const phases = [...document.querySelectorAll(".phase[data-phase]")];
const steps = [...document.querySelectorAll(".step[data-node]")];
const timeline = document.getElementById("timeline");
const toggle = document.getElementById("play-toggle");
const detailKind = document.getElementById("detail-kind");
const detailTitle = document.getElementById("detail-title");
const detailBody = document.getElementById("detail-body");
const detailChips = document.getElementById("detail-chips");

const INTERVAL_MS = 4200;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let stepIndex = 0;
let timer = null;
let wantsPlay = !reduceMotion;

function chip(text) {
  const el = document.createElement("span");
  el.className = "chip";
  el.textContent = text;
  return el;
}

function show(card) {
  cards.forEach((el) => el.classList.toggle("is-active", el === card));
  phases.forEach((el) => el.classList.toggle("is-active", el.dataset.phase === card.dataset.phase));
  timeline.classList.toggle(
    "has-focus",
    phases.some((el) => el.dataset.phase === card.dataset.phase),
  );

  detailKind.textContent = card.dataset.kind === "tool" ? "MCP tool · also a CLI command" : card.dataset.kind === "cli" ? "CLI command" : "Surface";
  detailTitle.textContent = card.dataset.title;
  detailTitle.classList.toggle("plain", card.dataset.kind !== "tool");
  detailBody.textContent = card.dataset.desc;
  detailChips.replaceChildren(...(card.dataset.chips || "").split("|").filter(Boolean).map(chip));
}

function focusStep(index) {
  stepIndex = index;
  const step = steps[index];
  steps.forEach((el) => el.classList.toggle("is-active", el === step));
  const card = cards.find((el) => el.dataset.id === step.dataset.node);
  if (card) show(card);
}

function tick() {
  focusStep((stepIndex + 1) % steps.length);
}

function start() {
  if (timer !== null) return;
  timer = window.setInterval(tick, INTERVAL_MS);
}

function stop() {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

function renderToggle() {
  toggle.textContent = wantsPlay ? "Pause" : "Play";
  toggle.setAttribute("aria-pressed", wantsPlay ? "true" : "false");
}

function pauseByUser() {
  wantsPlay = false;
  stop();
  renderToggle();
}

toggle.addEventListener("click", () => {
  wantsPlay = !wantsPlay;
  if (wantsPlay) {
    tick();
    start();
  } else {
    stop();
  }
  renderToggle();
});

steps.forEach((step, index) => {
  step.addEventListener("click", () => {
    pauseByUser();
    focusStep(index);
  });
});

cards.forEach((card) => {
  card.addEventListener("click", () => {
    pauseByUser();
    show(card);
    const step = steps.findIndex((el) => el.dataset.node === card.dataset.id);
    steps.forEach((el, i) => el.classList.toggle("is-active", i === step));
    if (step >= 0) stepIndex = step;
  });
  card.addEventListener("focus", () => {
    pauseByUser();
    show(card);
  });
  card.addEventListener("mouseenter", () => {
    stop();
    show(card);
  });
  card.addEventListener("mouseleave", () => {
    if (wantsPlay) start();
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else if (wantsPlay) start();
});

focusStep(0);
renderToggle();
if (wantsPlay) start();
`;
