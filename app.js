import { h, render } from "https://esm.sh/preact@10.24.3";
import { useCallback, useEffect, useMemo, useState } from "https://esm.sh/preact@10.24.3/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { GitHub, WORKFLOW_PATH } from "./github.js";

const html = htm.bind(h);

const DEFAULT_REPO = "sivutnopeasti/youtube-shorts-bot";
const CONFIG_PATH = "state/config.json";
const ITEMS_DIR = "state/items";
const RESEARCH_PATH = "state/research/latest.json";
const POLL_MS = 30000;

const DEFAULT_CONFIG = {
  paused: false,
  autopilot: false,
  auto_publish: false,
  ideas_per_run: 6,
  videos_per_day: 1,
  privacy: "private",
  claude_model: "claude-sonnet-5-5",
  tts_voice: "hi-IN-MadhurNeural",
  monthly_budget_usd: 10,
  use_test_video: true,
  idea_expiry_days: 7,
};

const STATUS = {
  suggestion: { label: "Ehdotus", tone: "gray" },
  idea: { label: "Idea", tone: "blue" },
  approved: { label: "Hyväksytty", tone: "indigo" },
  producing: { label: "Tuotannossa", tone: "amber" },
  ready: { label: "Tarkistettavana", tone: "orange" },
  published: { label: "Julkaistu", tone: "green" },
  rejected: { label: "Hylätty", tone: "red" },
  failed: { label: "Epäonnistui", tone: "red" },
  archived: { label: "Arkistoitu", tone: "gray" },
};
const BOARD_COLUMNS = ["suggestion", "idea", "approved", "producing", "ready", "published"];
const OTHER_STATUSES = ["failed", "rejected", "archived"];

const VIZ = {
  choropleth_timeline: "Karttanimaatio",
  bar_chart_race: "Pylväskisa",
  line_race: "Viivakisa",
};
const REGION = {
  world: "Maailma",
  asia: "Aasia",
  south_asia: "Etelä-Aasia",
  india_vs_peers: "Intia vs. vertailumaat",
};
const COMMANDS = {
  daily: "Päivän ajo (koko putki)",
  research: "Tutkimus + uudet ideat",
  suggestions: "Käsittele omat ehdotukset",
  produce: "Tuota video",
  publish: "Julkaise video",
  "cleanup-media": "Siivoa vanhat esikatseluvideot",
};

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString("fi-FI", { dateStyle: "short", timeStyle: "short" }) : "–";
const itemTitle = (item) => item.idea?.title || item.suggestion || item.id;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const usd = (n) => `${(n || 0).toFixed(2)} $`;

function relative(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "juuri nyt";
  if (diff < 3600) return `${Math.round(diff / 60)} min sitten`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h sitten`;
  return `${Math.round(diff / 86400)} pv sitten`;
}

function parseCron(text) {
  const m = text?.match(/cron:\s*"(\d+)\s+(\d+)\s+\*\s+\*\s+\*"/);
  return m ? { minute: +m[1], hour: +m[2] } : null;
}

function nextRun(cron) {
  if (!cron) return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cron.hour, cron.minute));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function zoneTime(date, timeZone) {
  return date.toLocaleTimeString("fi-FI", { timeZone, hour: "2-digit", minute: "2-digit" });
}

function eventTime(item, prefix) {
  const ev = [...(item.events || [])].reverse().find((e) => e.msg.startsWith(prefix));
  return ev?.at || "";
}

function Badge({ status }) {
  const s = STATUS[status] || { label: status, tone: "gray" };
  return html`<span class="badge tone-${s.tone}">${s.label}</span>`;
}

function Toggle({ checked, onChange, label, hint }) {
  return html`<label class="toggle">
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    <span class="switch"></span>
    <span><b>${label}</b>${hint && html`<small>${hint}</small>`}</span>
  </label>`;
}

/* ---------- Login ---------- */

function Login({ onLogin }) {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const gh = new GitHub(token.trim(), repo.trim());
      await gh.repoInfo();
      localStorage.setItem("mp_token", token.trim());
      localStorage.setItem("mp_repo", repo.trim());
      onLogin(gh);
    } catch (err) {
      setError(`Kirjautuminen epäonnistui (${err.status || ""} ${err.message}). Tarkista token ja sen oikeudet.`);
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="login">
    <form class="card login-card" onSubmit=${submit}>
      <h1>MapPulse <span>ohjauspaneeli</span></h1>
      <p>Kirjaudu GitHub-tokenilla. Token tallentuu vain tähän selaimeen.</p>
      <label>GitHub-token<input type="password" value=${token} onInput=${(e) => setToken(e.target.value)} placeholder="github_pat_..." required /></label>
      <label>Repo<input value=${repo} onInput=${(e) => setRepo(e.target.value)} /></label>
      ${error && html`<div class="alert error">${error}</div>`}
      <button class="btn primary" disabled=${busy}>${busy ? "Tarkistetaan..." : "Kirjaudu"}</button>
      <details>
        <summary>Miten teen tokenin?</summary>
        <ol>
          <li>Avaa <a href="https://github.com/settings/personal-access-tokens/new" target="_blank">github.com/settings/personal-access-tokens/new</a></li>
          <li>Repository access: <b>Only select repositories</b> → <code>youtube-shorts-bot</code></li>
          <li>Permissions → Repository: <b>Contents</b>, <b>Actions</b> ja <b>Workflows</b> = Read and write</li>
          <li>Generate token ja liitä se yllä olevaan kenttään.</li>
        </ol>
      </details>
    </form>
  </div>`;
}

/* ---------- Overview ---------- */

function Overview({ items, config, runs, cron, actions, openItem }) {
  const month = thisMonth();
  const published = items.filter((i) => i.status === "published" && eventTime(i, "Julkaistu").startsWith(month));
  const spend = items
    .filter((i) => (i.created_at || "").startsWith(month))
    .reduce((s, i) => s + (i.costs?.claude_usd || 0) + (i.costs?.llm_usd || 0), 0);
  const count = (st) => items.filter((i) => i.status === st).length;
  const next = nextRun(cron);
  const lastRun = runs[0];

  const activity = items
    .flatMap((i) => (i.events || []).map((e) => ({ ...e, item: i })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  const mode = config.paused
    ? { text: "Pysäytetty", tone: "red" }
    : config.autopilot && config.auto_publish
      ? { text: "Täysautomaatti", tone: "green" }
      : config.autopilot
        ? { text: "Autopilotti, julkaisu käsin", tone: "indigo" }
        : { text: "Hyväksyntä käsin", tone: "blue" };

  return html`<div class="page">
    <div class="kpis">
      <div class="card kpi"><span>Julkaistu tässä kuussa</span><b>${published.length}</b></div>
      <div class="card kpi"><span>Ideat jonossa</span><b>${count("idea") + count("suggestion")}</b></div>
      <div class="card kpi"><span>Tuotannossa / hyväksytty</span><b>${count("producing") + count("approved")}</b></div>
      <div class="card kpi highlight"><span>Odottaa tarkistusta</span><b>${count("ready")}</b></div>
      <div class="card kpi"><span>Kulut tässä kuussa</span><b>${usd(spend)}</b><small>budjetti ${usd(config.monthly_budget_usd)}</small></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Automaatio</h3>
        <p><span class="badge tone-${mode.tone}">${mode.text}</span></p>
        <p class="muted">Seuraava ajastettu ajo: <b>${next ? `${fmt(next.toISOString())} (Intia ${zoneTime(next, "Asia/Kolkata")})` : "–"}</b></p>
        <p class="muted">Viimeisin ajo: ${lastRun ? html`<a href=${lastRun.html_url} target="_blank">${lastRun.display_title}</a> · ${runStatus(lastRun)} · ${relative(lastRun.created_at)}` : "–"}</p>
        <div class="stack">
          <${Toggle} checked=${!config.paused} onChange=${(v) => actions.saveConfig({ paused: !v })} label="Automaatio päällä" hint="Pois päältä = ajastettu ajo ei tee mitään" />
          <${Toggle} checked=${config.autopilot} onChange=${(v) => actions.saveConfig({ autopilot: v })} label="Autopilotti" hint="Paras idea hyväksytään tuotantoon automaattisesti" />
          <${Toggle} checked=${config.auto_publish} onChange=${(v) => actions.saveConfig({ auto_publish: v })} label="Automaattinen julkaisu" hint="Valmis video julkaistaan ilman tarkistusta" />
        </div>
        <div class="row">
          <button class="btn primary" onClick=${() => actions.dispatch("daily")}>Käynnistä päivän ajo nyt</button>
          <button class="btn" onClick=${() => actions.dispatch("research")}>Hae uusia ideoita</button>
        </div>
      </div>

      <div class="card">
        <h3>Viimeisimmät tapahtumat</h3>
        <ul class="feed">
          ${activity.length === 0 && html`<li class="muted">Ei tapahtumia vielä.</li>`}
          ${activity.map(
            (e) => html`<li onClick=${() => openItem(e.item.id)}>
              <span class="time">${fmt(e.at)}</span>
              <span><b>${itemTitle(e.item)}</b><br /><span class="muted">${e.msg}</span></span>
            </li>`,
          )}
        </ul>
      </div>
    </div>
  </div>`;
}

/* ---------- Board ---------- */

function Card({ item, onOpen }) {
  const idea = item.idea || {};
  return html`<div class="item-card" onClick=${() => onOpen(item.id)}>
    <div class="item-title">${itemTitle(item)}</div>
    <div class="item-meta">
      ${idea.viz_type && html`<span class="chip">${VIZ[idea.viz_type] || idea.viz_type}</span>`}
      ${idea.score && html`<span class="chip">★ ${idea.score}</span>`}
      ${item.source === "user" && html`<span class="chip user">Oma</span>`}
      ${item.video && html`<span class="chip">▶ video</span>`}
      ${item.error && html`<span class="chip warn" title=${item.error}>⚠</span>`}
    </div>
    <div class="item-date">${fmt(item.updated_at || item.created_at)}</div>
  </div>`;
}

function Board({ items, openItem }) {
  const [showOther, setShowOther] = useState(false);
  const byStatus = (st) =>
    items.filter((i) => i.status === st).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  const others = items.filter((i) => OTHER_STATUSES.includes(i.status));

  return html`<div class="page">
    <div class="board">
      ${BOARD_COLUMNS.map((st) => {
        const list = byStatus(st);
        const shown = st === "published" ? list.slice(0, 15) : list;
        return html`<div class="column">
          <div class="column-head"><${Badge} status=${st} /><span class="count">${list.length}</span></div>
          ${shown.map((i) => html`<${Card} item=${i} onOpen=${openItem} />`)}
          ${list.length === 0 && html`<div class="empty">Tyhjä</div>`}
        </div>`;
      })}
    </div>
    <button class="btn ghost" onClick=${() => setShowOther(!showOther)}>
      ${showOther ? "Piilota" : "Näytä"} epäonnistuneet, hylätyt ja arkistoidut (${others.length})
    </button>
    ${showOther &&
    html`<div class="card"><table class="table">
      <thead><tr><th>Otsikko</th><th>Tila</th><th>Päivitetty</th></tr></thead>
      <tbody>${others.map(
        (i) => html`<tr class="clickable" onClick=${() => openItem(i.id)}>
          <td>${itemTitle(i)}</td><td><${Badge} status=${i.status} /></td><td>${fmt(i.updated_at)}</td>
        </tr>`,
      )}</tbody>
    </table></div>`}
  </div>`;
}

/* ---------- Item drawer ---------- */

function ItemDrawer({ item, gh, config, actions, onClose }) {
  const idea = item.idea || {};
  const [form, setForm] = useState({});
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoError, setVideoError] = useState("");

  useEffect(() => {
    setForm({
      title: idea.title || "",
      hook: idea.hook || "",
      why_now: idea.why_now || "",
      hashtags: (idea.hashtags || []).join(" "),
      notes: item.notes || "",
    });
  }, [item.id, item.updated_at]);

  useEffect(() => {
    let url;
    setVideoUrl(null);
    setVideoError("");
    if (item.video) {
      gh.videoUrl(item.id)
        .then((u) => setVideoUrl((url = u)))
        .catch((err) => setVideoError(`Esikatselun lataus epäonnistui: ${err.message}`));
    }
    return () => url && URL.revokeObjectURL(url);
  }, [item.id, item.video?.path]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function saveEdits() {
    await actions.saveItem(item.id, (it) => {
      if (it.idea) {
        it.idea.title = form.title.trim();
        it.idea.hook = form.hook.trim();
        it.idea.why_now = form.why_now.trim();
        it.idea.hashtags = form.hashtags.split(/[\s,]+/).filter(Boolean);
      }
      it.notes = form.notes;
    }, "Muokattu paneelista");
  }

  const status = (st, msg) => actions.setStatus(item, st, msg);
  const produceNow = async () => {
    if (item.status !== "approved") await status("approved", "Hyväksytty paneelista");
    await actions.dispatch("produce", item.id);
  };

  const buttons = {
    suggestion: html`
      <button class="btn primary" onClick=${() => actions.dispatch("suggestions")}>Käsittele nyt</button>
      <button class="btn danger" onClick=${() => status("rejected", "Hylätty paneelista")}>Hylkää</button>`,
    idea: html`
      <button class="btn primary" onClick=${() => status("approved", "Hyväksytty paneelista")}>Hyväksy</button>
      <button class="btn" onClick=${produceNow}>Hyväksy ja tuota nyt</button>
      <button class="btn danger" onClick=${() => status("rejected", "Hylätty paneelista")}>Hylkää</button>`,
    approved: html`
      <button class="btn primary" onClick=${produceNow}>Tuota nyt</button>
      <button class="btn" onClick=${() => status("idea", "Palautettu ideaksi")}>Palauta ideaksi</button>
      <button class="btn danger" onClick=${() => status("rejected", "Hylätty paneelista")}>Hylkää</button>`,
    producing: html`
      <span class="muted">Tuotanto käynnissä…</span>
      <button class="btn" onClick=${() => status("failed", "Merkitty epäonnistuneeksi paneelista")}>Merkitse jumittuneeksi</button>`,
    ready: html`
      <button class="btn primary" onClick=${() => actions.dispatch("publish", item.id)}>Julkaise YouTubeen (${config.privacy})</button>
      <button class="btn" onClick=${produceNow}>Tuota uudelleen</button>
      <button class="btn danger" onClick=${() => status("rejected", "Hylätty tarkistuksessa")}>Hylkää</button>`,
    published: item.youtube?.url && html`<a class="btn primary" href=${item.youtube.url} target="_blank">Avaa YouTubessa</a>`,
    failed: html`
      <button class="btn primary" onClick=${() => status(item.idea ? "approved" : "suggestion", "Uusi yritys paneelista")}>Yritä uudelleen</button>
      <button class="btn" onClick=${() => status("archived", "Arkistoitu paneelista")}>Arkistoi</button>`,
    rejected: item.idea && html`<button class="btn" onClick=${() => status("idea", "Palautettu ideaksi")}>Palauta ideaksi</button>`,
    archived: item.idea && html`<button class="btn" onClick=${() => status("idea", "Palautettu ideaksi")}>Palauta ideaksi</button>`,
  };

  return html`<div class="drawer-backdrop" onClick=${onClose}>
    <aside class="drawer" onClick=${(e) => e.stopPropagation()}>
      <header>
        <div><${Badge} status=${item.status} /> ${item.source === "user" && html`<span class="chip user">Oma ehdotus</span>`}</div>
        <button class="btn ghost" onClick=${onClose}>✕</button>
      </header>
      <h2>${itemTitle(item)}</h2>
      <div class="row">${buttons[item.status]}</div>
      ${item.error && item.error !== "not_ready" && html`<div class="alert error">${item.error}</div>`}

      ${item.video &&
      html`<section>
        <h4>Esikatselu</h4>
        ${videoUrl ? html`<video class="preview" src=${videoUrl} controls playsinline></video>` : html`<p class="muted">${videoError || "Ladataan videota…"}</p>`}
      </section>`}

      ${item.suggestion && html`<section><h4>Oma ehdotus</h4><p>${item.suggestion}</p></section>`}

      ${item.idea &&
      html`<section class="form">
        <h4>Sisältö</h4>
        <label>Otsikko<input value=${form.title} onInput=${set("title")} maxlength="100" /></label>
        <label>Koukku (avausteksti)<input value=${form.hook} onInput=${set("hook")} /></label>
        <label>Miksi nyt<textarea rows="3" onInput=${set("why_now")} value=${form.why_now}></textarea></label>
        <label>Hashtagit<input value=${form.hashtags} onInput=${set("hashtags")} /></label>
        <label>Muistiinpanot<textarea rows="2" onInput=${set("notes")} value=${form.notes}></textarea></label>
        <button class="btn" onClick=${saveEdits}>Tallenna muutokset</button>
      </section>`}

      ${item.idea &&
      html`<section>
        <h4>Data ja visualisointi</h4>
        <dl class="details">
          <dt>Tyyppi</dt><dd>${VIZ[idea.viz_type] || idea.viz_type}</dd>
          <dt>Alue</dt><dd>${REGION[idea.region] || idea.region}${idea.countries?.length ? ` (${idea.countries.join(", ")})` : ""}</dd>
          <dt>Indikaattori</dt><dd><a href="https://data.worldbank.org/indicator/${idea.indicator}" target="_blank">${idea.indicator}</a> – ${idea.indicator_name}</dd>
          <dt>Vuodet</dt><dd>${idea.start_year}–${idea.end_year}</dd>
          <dt>Pisteet</dt><dd>★ ${idea.score}</dd>
          <dt>LLM</dt><dd>${item.llm_provider || "–"}</dd>
          <dt>Kulut</dt><dd>${usd((item.costs?.claude_usd || 0) + (item.costs?.llm_usd || 0))}</dd>
          ${item.youtube && html`<dt>YouTube</dt><dd><a href=${item.youtube.url} target="_blank">${item.youtube.id}</a> (${item.youtube.privacy})</dd>`}
        </dl>
      </section>`}

      <section>
        <h4>Historia</h4>
        <ul class="timeline">
          ${[...(item.events || [])].reverse().map((e) => html`<li><span class="time">${fmt(e.at)}</span>${e.msg}</li>`)}
        </ul>
        <p class="muted small">ID: ${item.id}</p>
      </section>
    </aside>
  </div>`;
}

/* ---------- Suggest ---------- */

function Suggest({ actions }) {
  const [text, setText] = useState("");
  const [approve, setApprove] = useState(true);
  const [processNow, setProcessNow] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await actions.createSuggestion(text.trim(), approve);
      if (processNow) await actions.dispatch("suggestions");
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="page narrow">
    <form class="card form" onSubmit=${submit}>
      <h3>Ehdota omaa aihetta</h3>
      <p class="muted">Kirjoita aihe vapaasti. Tekoäly muuttaa sen ideaksi, valitsee sopivan World Bank -datan ja visualisoinnin.</p>
      <label>Aihe<textarea rows="4" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Esim. Intian väkiluku vs Kiina 1960–2023, tai kuinka monella intialaisella on sähkö"></textarea></label>
      <${Toggle} checked=${approve} onChange=${setApprove} label="Hyväksy suoraan tuotantoon" hint="Muuten idea jää Ideat-sarakkeeseen hyväksyttäväksi" />
      <${Toggle} checked=${processNow} onChange=${setProcessNow} label="Käsittele heti" hint="Käynnistää ajon nyt, muuten seuraavassa päivän ajossa" />
      <button class="btn primary" disabled=${busy}>${busy ? "Lähetetään…" : "Lähetä ehdotus"}</button>
    </form>
  </div>`;
}

/* ---------- Runs ---------- */

function runStatus(run) {
  if (run.status !== "completed") return html`<span class="badge tone-amber">${run.status === "queued" ? "Jonossa" : "Käynnissä"}</span>`;
  const map = { success: ["Onnistui", "green"], failure: ["Epäonnistui", "red"], cancelled: ["Peruttu", "gray"] };
  const [label, tone] = map[run.conclusion] || [run.conclusion, "gray"];
  return html`<span class="badge tone-${tone}">${label}</span>`;
}

function duration(run) {
  if (!run.run_started_at) return "–";
  const end = run.status === "completed" ? new Date(run.updated_at) : new Date();
  const s = Math.max(0, Math.round((end - new Date(run.run_started_at)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function Runs({ runs, items, actions }) {
  const [command, setCommand] = useState("daily");
  const [item, setItem] = useState("");
  const needsItem = command === "produce" || command === "publish";
  const candidates = items.filter((i) =>
    command === "publish" ? i.status === "ready" : ["approved", "idea", "failed", "ready"].includes(i.status) && i.idea,
  );

  return html`<div class="page">
    <div class="card form inline">
      <h3>Käynnistä ajo</h3>
      <select value=${command} onChange=${(e) => setCommand(e.target.value)}>
        ${Object.entries(COMMANDS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
      </select>
      ${needsItem &&
      html`<select value=${item} onChange=${(e) => setItem(e.target.value)}>
        <option value="">Valitse video…</option>
        ${candidates.map((i) => html`<option value=${i.id}>${itemTitle(i)}</option>`)}
      </select>`}
      <button class="btn primary" disabled=${needsItem && !item} onClick=${() => actions.dispatch(command, needsItem ? item : "")}>Käynnistä</button>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Ajo</th><th>Tila</th><th>Käynnistäjä</th><th>Aloitettu</th><th>Kesto</th><th></th></tr></thead>
        <tbody>
          ${runs.length === 0 && html`<tr><td colspan="6" class="muted">Ei ajoja vielä.</td></tr>`}
          ${runs.map(
            (r) => html`<tr>
              <td>${r.display_title}</td>
              <td>${runStatus(r)}</td>
              <td>${r.event === "schedule" ? "Ajastus" : "Paneeli / käsin"}</td>
              <td>${fmt(r.created_at)}</td>
              <td>${duration(r)}</td>
              <td><a href=${r.html_url} target="_blank">Lokit ↗</a></td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </div>`;
}

/* ---------- Research ---------- */

function Research({ research, actions }) {
  if (!research) {
    return html`<div class="page narrow"><div class="card">
      <p>Tutkimusta ei ole vielä tehty.</p>
      <button class="btn primary" onClick=${() => actions.dispatch("research")}>Tee tutkimus nyt</button>
    </div></div>`;
  }
  const section = (title, list) => html`<div class="card">
    <h3>${title} <span class="count">${list?.length || 0}</span></h3>
    <ul class="plain">${(list || []).map((x) => html`<li>${x}</li>`)}</ul>
  </div>`;
  return html`<div class="page">
    <p class="muted">Viimeisin tutkimus: <b>${research.date}</b>
      <button class="btn small" onClick=${() => actions.dispatch("research")}>Päivitä nyt</button></p>
    <div class="grid-3">
      ${section("Uutisotsikot (Intia)", research.news_headlines)}
      ${section("YouTube-trendit Intiassa", research.youtube_trending_india)}
      ${section("Tänä päivänä historiassa", research.on_this_day)}
    </div>
  </div>`;
}

/* ---------- Settings ---------- */

function Settings({ gh, config, actions, onCronChange }) {
  const [form, setForm] = useState(config);
  const [workflow, setWorkflow] = useState({ text: undefined, sha: null });
  const [time, setTime] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  useEffect(() => setForm(config), [config]);
  useEffect(() => {
    gh.readText(WORKFLOW_PATH).then((wf) => {
      setWorkflow(wf);
      const cron = parseCron(wf.text);
      if (cron) setTime(`${String(cron.hour).padStart(2, "0")}:${String(cron.minute).padStart(2, "0")}`);
    });
  }, []);

  const set = (key, cast = (v) => v) => (e) =>
    setForm({ ...form, [key]: cast(e.target.type === "checkbox" ? e.target.checked : e.target.value) });

  async function saveSchedule() {
    setScheduleError("");
    const [hh, mm] = time.split(":").map(Number);
    if (!workflow.text) {
      setScheduleError("Workflow-tiedostoa ei löytynyt repoista.");
      return;
    }
    const text = workflow.text.replace(/cron:\s*"[^"]*"/, `cron: "${mm} ${hh} * * *"`);
    try {
      const res = await gh.writeText(WORKFLOW_PATH, text, workflow.sha, `dashboard: schedule ${time} UTC`);
      setWorkflow({ text, sha: res.content.sha });
      onCronChange({ hour: hh, minute: mm });
      actions.toast(`Aikataulu tallennettu: joka päivä ${time} UTC`);
    } catch (err) {
      setScheduleError(
        err.status === 403 || err.status === 404
          ? "Tokenilla ei ole Workflows-oikeutta. Lisää se tokenin asetuksista (Workflows: Read and write)."
          : err.message,
      );
    }
  }

  const preview = (() => {
    if (!time) return "";
    const [hh, mm] = time.split(":").map(Number);
    const d = new Date();
    d.setUTCHours(hh, mm, 0, 0);
    return `Suomi ${zoneTime(d, "Europe/Helsinki")} · Intia ${zoneTime(d, "Asia/Kolkata")}`;
  })();

  return html`<div class="page grid-2">
    <div class="card form">
      <h3>Automaatio</h3>
      <${Toggle} checked=${!form.paused} onChange=${(v) => setForm({ ...form, paused: !v })} label="Automaatio päällä" />
      <${Toggle} checked=${form.autopilot} onChange=${(v) => setForm({ ...form, autopilot: v })} label="Autopilotti" hint="Hyväksyy parhaan idean tuotantoon automaattisesti" />
      <${Toggle} checked=${form.auto_publish} onChange=${(v) => setForm({ ...form, auto_publish: v })} label="Automaattinen julkaisu" hint="Julkaisee valmiit videot ilman tarkistusta" />
      <${Toggle} checked=${form.use_test_video} onChange=${(v) => setForm({ ...form, use_test_video: v })} label="Testivideo" hint="Tuottaa testikuvan oikean videon sijaan (kunnes tuotantovaihe on valmis)" />
      <label>Ideoita per ajo<input type="number" min="1" max="12" value=${form.ideas_per_run} onInput=${set("ideas_per_run", Number)} /></label>
      <label>Videoita päivässä<input type="number" min="0" max="5" value=${form.videos_per_day} onInput=${set("videos_per_day", Number)} /></label>
      <label>Vanhat ideat arkistoidaan (päivää)<input type="number" min="1" max="60" value=${form.idea_expiry_days} onInput=${set("idea_expiry_days", Number)} /></label>
      <h3>Julkaisu ja tuotanto</h3>
      <label>YouTube-näkyvyys
        <select value=${form.privacy} onChange=${set("privacy")}>
          <option value="private">Yksityinen (private)</option>
          <option value="unlisted">Piilotettu (unlisted)</option>
          <option value="public">Julkinen (public)</option>
        </select>
        <small>Ennen YouTube-auditoinnin hyväksyntää API-lataukset jäävät aina yksityisiksi.</small>
      </label>
      <label>Claude-malli
        <select value=${form.claude_model} onChange=${set("claude_model")}>
          ${["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5"].map((m) => html`<option value=${m}>${m}</option>`)}
        </select>
      </label>
      <label>Hindi-ääni
        <select value=${form.tts_voice} onChange=${set("tts_voice")}>
          <option value="hi-IN-MadhurNeural">Madhur (mies)</option>
          <option value="hi-IN-SwaraNeural">Swara (nainen)</option>
        </select>
      </label>
      <label>Kuukausibudjetti (USD)<input type="number" min="0" step="1" value=${form.monthly_budget_usd} onInput=${set("monthly_budget_usd", Number)} />
        <small>Tuotanto pysähtyy, kun kuukauden kulut ylittävät budjetin.</small></label>
      <button class="btn primary" onClick=${() => actions.saveConfig(form)}>Tallenna asetukset</button>
    </div>

    <div class="card form">
      <h3>Aikataulu</h3>
      <p class="muted">Päivittäinen ajo käynnistyy tähän aikaan (UTC).</p>
      ${workflow.text === null &&
      html`<div class="alert error">Workflow-tiedostoa <code>${WORKFLOW_PATH}</code> ei ole vielä repossa, joten ajastus ja ajojen käynnistys eivät toimi.</div>`}
      <label>Kellonaika (UTC)<input type="time" value=${time} onInput=${(e) => setTime(e.target.value)} /></label>
      <p class="muted">${preview}</p>
      ${scheduleError && html`<div class="alert error">${scheduleError}</div>`}
      <button class="btn primary" onClick=${saveSchedule} disabled=${!time}>Tallenna aikataulu</button>
      <p class="muted small">Intian iltahuippu on noin klo 18–21 IST (12:30–15:30 UTC).</p>
    </div>
  </div>`;
}

/* ---------- Prompts ---------- */

function Prompts({ gh, actions }) {
  const [files, setFiles] = useState([]);
  const [current, setCurrent] = useState(null);
  const [text, setText] = useState("");
  const [sha, setSha] = useState(null);

  useEffect(() => {
    gh.listFiles("prompts").then((list) => {
      const md = list.filter((f) => f.name.endsWith(".md"));
      setFiles(md);
      if (md[0]) open(md[0].path);
    });
  }, []);

  async function open(path) {
    const res = await gh.readText(path);
    setCurrent(path);
    setText(res.text || "");
    setSha(res.sha);
  }

  async function save() {
    const res = await gh.writeText(current, text, sha, `dashboard: edit ${current}`);
    setSha(res.content.sha);
    actions.toast("Kehote tallennettu. Muutos on käytössä seuraavassa ajossa.");
  }

  return html`<div class="page">
    <div class="card">
      <div class="row">
        ${files.map((f) => html`<button class="btn ${current === f.path ? "primary" : ""}" onClick=${() => open(f.path)}>${f.name}</button>`)}
      </div>
      <p class="muted small">Paikkamerkit kuten <code>{{NEWS}}</code> ja <code>{{HISTORY}}</code> täyttyvät automaattisesti. Älä poista niitä.</p>
      <textarea class="code" rows="28" value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
      <div class="row"><button class="btn primary" onClick=${save} disabled=${!current}>Tallenna kehote</button></div>
    </div>
  </div>`;
}

/* ---------- Shell ---------- */

const PAGES = {
  overview: "Yleiskatsaus",
  board: "Putki",
  suggest: "Ehdota aihetta",
  runs: "Ajot",
  research: "Tutkimus",
  settings: "Asetukset",
  prompts: "Kehotteet",
};

function usePage() {
  const read = () => (location.hash.replace("#/", "") || "overview").split("?")[0];
  const [page, setPage] = useState(read);
  useEffect(() => {
    const onHash = () => setPage(read());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return page;
}

function Dashboard({ gh, onLogout }) {
  const page = usePage();
  const [items, setItems] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [research, setResearch] = useState(null);
  const [runs, setRuns] = useState([]);
  const [cron, setCron] = useState(null);
  const [openId, setOpenId] = useState(() => location.hash.match(/[?&]item=([^&]+)/)?.[1] || null);
  const [toastMsg, setToastMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const toast = useCallback((text, tone = "ok") => {
    setToastMsg({ text, tone });
    setTimeout(() => setToastMsg(null), 4500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [its, cfg, rs] = await Promise.all([
        gh.listDirectoryJSON(ITEMS_DIR),
        gh.readJSON(CONFIG_PATH),
        gh.runs(),
      ]);
      setItems(its);
      setConfig({ ...DEFAULT_CONFIG, ...(cfg.data || {}) });
      setRuns(rs);
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [gh]);

  useEffect(() => {
    refresh();
    gh.readJSON(RESEARCH_PATH).then((r) => setResearch(r.data)).catch(() => {});
    gh.readText(WORKFLOW_PATH).then((wf) => setCron(parseCron(wf.text))).catch(() => {});
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (page === "research") gh.readJSON(RESEARCH_PATH).then((r) => setResearch(r.data)).catch(() => {});
  }, [page]);

  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      toast(`Virhe: ${err.message}`, "error");
      throw err;
    }
  };

  const actions = useMemo(
    () => ({
      toast,
      saveItem: guard(async (id, mutate, msg) => {
        const next = await gh.updateJSON(`${ITEMS_DIR}/${id}.json`, (it) => {
          mutate(it);
          it.updated_at = nowIso();
          if (msg) (it.events ||= []).push({ at: nowIso(), msg });
          return it;
        }, `dashboard: ${id}`);
        setItems((list) => list.map((i) => (i.id === id ? next : i)));
        toast("Tallennettu");
      }),
      setStatus: guard(async (item, status, msg) => {
        const next = await gh.updateJSON(`${ITEMS_DIR}/${item.id}.json`, (it) => {
          it.status = status;
          it.updated_at = nowIso();
          if (status !== "failed") it.error = null;
          (it.events ||= []).push({ at: nowIso(), msg });
          return it;
        }, `dashboard: ${item.id} -> ${status}`);
        setItems((list) => list.map((i) => (i.id === item.id ? next : i)));
        toast(`Tila: ${STATUS[status]?.label || status}`);
      }),
      createSuggestion: guard(async (suggestion, approve) => {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const id = `${stamp}-ehdotus-${Math.random().toString(16).slice(2, 6)}`;
        const item = {
          id,
          created_at: nowIso(),
          updated_at: nowIso(),
          source: "user",
          status: "suggestion",
          suggestion,
          approve_on_create: approve,
          idea: null,
          events: [{ at: nowIso(), msg: "Luotu (user)" }],
          costs: { llm_usd: 0, claude_usd: 0, claude_input_tokens: 0, claude_output_tokens: 0 },
        };
        await gh.writeJSON(`${ITEMS_DIR}/${id}.json`, item, null, `dashboard: suggestion ${id}`);
        setItems((list) => [...list, item]);
        toast("Ehdotus tallennettu");
      }),
      saveConfig: guard(async (changes) => {
        const next = await gh.updateJSON(CONFIG_PATH, (cfg) => ({ ...DEFAULT_CONFIG, ...(cfg || {}), ...changes }), "dashboard: config");
        setConfig(next);
        toast("Asetukset tallennettu");
      }),
      dispatch: guard(async (command, item = "") => {
        await gh.dispatch(command, item);
        toast(`Ajo käynnistetty: ${COMMANDS[command]}. Tila päivittyy hetken kuluttua.`);
        setTimeout(refresh, 5000);
      }),
    }),
    [gh, refresh],
  );

  const openItem = items.find((i) => i.id === openId);
  const readyCount = items.filter((i) => i.status === "ready").length;
  const activeRun = runs.find((r) => r.status !== "completed");

  return html`<div class="layout">
    <nav class="sidebar">
      <div class="brand">MapPulse</div>
      ${Object.entries(PAGES).map(
        ([key, label]) => html`<a href="#/${key}" class=${page === key ? "active" : ""}>
          ${label}${key === "board" && readyCount > 0 ? html`<span class="pill">${readyCount}</span>` : ""}
        </a>`,
      )}
      <div class="sidebar-foot">
        <small>${gh.repo}</small>
        <button class="btn ghost small" onClick=${onLogout}>Kirjaudu ulos</button>
      </div>
    </nav>
    <main>
      <header class="topbar">
        <h2>${PAGES[page] || "MapPulse"}</h2>
        <div class="row">
          ${activeRun && html`<a class="badge tone-amber" href=${activeRun.html_url} target="_blank">Ajo käynnissä: ${activeRun.display_title}</a>`}
          ${config.paused && html`<span class="badge tone-red">Automaatio pysäytetty</span>`}
          <button class="btn small" onClick=${refresh}>Päivitä</button>
        </div>
      </header>
      ${loadError && html`<div class="alert error">Tietojen lataus epäonnistui: ${loadError}</div>`}
      ${loading
        ? html`<div class="page"><p class="muted">Ladataan…</p></div>`
        : page === "overview"
          ? html`<${Overview} items=${items} config=${config} runs=${runs} cron=${cron} actions=${actions} openItem=${setOpenId} />`
          : page === "board"
            ? html`<${Board} items=${items} openItem=${setOpenId} />`
            : page === "suggest"
              ? html`<${Suggest} actions=${actions} />`
              : page === "runs"
                ? html`<${Runs} runs=${runs} items=${items} actions=${actions} />`
                : page === "research"
                  ? html`<${Research} research=${research} actions=${actions} />`
                  : page === "settings"
                    ? html`<${Settings} gh=${gh} config=${config} actions=${actions} onCronChange=${setCron} />`
                    : page === "prompts"
                      ? html`<${Prompts} gh=${gh} actions=${actions} />`
                      : html`<div class="page">Sivua ei löydy.</div>`}
    </main>
    ${openItem && html`<${ItemDrawer} item=${openItem} gh=${gh} config=${config} actions=${actions} onClose=${() => setOpenId(null)} />`}
    ${toastMsg && html`<div class="toast ${toastMsg.tone}">${toastMsg.text}</div>`}
  </div>`;
}

function App() {
  const [gh, setGh] = useState(() => {
    const token = localStorage.getItem("mp_token");
    return token ? new GitHub(token, localStorage.getItem("mp_repo") || DEFAULT_REPO) : null;
  });
  const logout = () => {
    localStorage.removeItem("mp_token");
    setGh(null);
  };
  return gh ? html`<${Dashboard} gh=${gh} onLogout=${logout} />` : html`<${Login} onLogin=${setGh} />`;
}

render(html`<${App} />`, document.getElementById("app"));
