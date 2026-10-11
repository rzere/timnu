"use client";

import { useEffect, useMemo, useState } from "react";
import { csvCell, type Lead } from "@/lib/leads";
import { SENIORITIES, SIZE_BANDS, splitList, type Seniority, type SizeBand } from "@/lib/icp";

interface Config {
  serverKey: boolean;
  jev: boolean;
  demo: boolean;
  limits: { maxPages: number; allowReveal: boolean; allowLookalikes: boolean } | null;
}

interface Consultation {
  total: number;
  page: number;
  totalPages: number;
  leads: Lead[];
  companyIds: string[];
  spent: number;
  jev: boolean;
  demo?: boolean;
  notices: string[];
  unmasked: boolean;
}

interface Answers {
  offer: string;
  titles: string;
  seniority: Seniority[];
  industries: string;
  sizes: SizeBand[];
  locations: string;
  lookalikes: string;
}

const EMPTY: Answers = { offer: "", titles: "", seniority: [], industries: "", sizes: [], locations: "", lookalikes: "" };
const STORE = "timnu.keys";
const SENIORITY_LABEL: Partial<Record<Seniority, string>> = { c_suite: "C-suite", vp: "VP", "mid-level": "Mid-level" };

export default function Oracle() {
  const [config, setConfig] = useState<Config | null>(null);
  const [keys, setKeys] = useState({ aiark: "", typesafe: "" });
  const [remember, setRemember] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [result, setResult] = useState<Consultation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [spent, setSpent] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, "none" | "busy">>({});

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setConfig(null));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { aiark?: string; typesafe?: string } | null;
      if (saved) {
        setKeys({ aiark: saved.aiark ?? "", typesafe: saved.typesafe ?? "" });
        setRemember(true);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    if (config && !config.serverKey && !keys.aiark) setShowKeys(true);
  }, [config, keys.aiark]);

  useEffect(() => {
    try {
      if (remember) localStorage.setItem(STORE, JSON.stringify(keys));
      else localStorage.removeItem(STORE);
    } catch {
      /* storage unavailable */
    }
  }, [remember, keys]);

  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (keys.aiark.trim()) h["x-aiark-key"] = keys.aiark.trim();
    if (keys.typesafe.trim()) h["x-typesafe-key"] = keys.typesafe.trim();
    return h;
  }, [keys]);

  const ownKey = !!keys.aiark.trim();
  const demo = !!config?.demo && !ownKey;
  const canReveal = !demo || !!config?.limits?.allowReveal;
  const canLookalike = !demo || !!config?.limits?.allowLookalikes;

  // AI Ark allows only ~5 balance checks per minute, so fetch once per key and
  // subtract what each action reports spending instead of re-checking.
  useEffect(() => {
    if (!config?.serverKey && !ownKey) return;
    const t = setTimeout(() => {
      fetch("/api/credits", { headers })
        .then((r) => r.json())
        .then((j: { credits?: number | null }) => setCredits(typeof j.credits === "number" ? j.credits : null))
        .catch(() => setCredits(null));
    }, 800);
    return () => clearTimeout(t);
  }, [config?.serverKey, ownKey, headers]);

  const charge = (n: number) => {
    if (!n) return;
    setSpent((s) => s + n);
    setCredits((c) => (c === null ? c : c - n));
  };

  const icp = () => ({
    offer: answers.offer,
    titles: splitList(answers.titles),
    seniority: answers.seniority,
    industries: splitList(answers.industries),
    sizes: answers.sizes,
    locations: splitList(answers.locations),
    lookalikes: canLookalike ? splitList(answers.lookalikes) : [],
  });

  async function consult(page: number, unmask = false) {
    setError(null);
    setBusy(unmask ? "unmask" : page === 0 ? "consult" : "page");
    try {
      const r = await fetch("/api/consult", {
        method: "POST",
        headers,
        body: JSON.stringify({ icp: icp(), page, unmask, companyIds: page > 0 || unmask ? result?.companyIds : undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The oracle is silent.");
      setResult({ ...(j as Consultation), unmasked: unmask });
      setRevealed({});
      charge(j.spent ?? 0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function reveal(lead: Lead) {
    setRevealed((m) => ({ ...m, [lead.id]: "busy" }));
    setError(null);
    try {
      const r = await fetch("/api/reveal", { method: "POST", headers, body: JSON.stringify({ id: lead.id }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not reveal.");
      if (!j.found) {
        setRevealed((m) => ({ ...m, [lead.id]: "none" }));
        return;
      }
      setRevealed((m) => {
        const { [lead.id]: _done, ...rest } = m;
        return rest;
      });
      setResult((res) =>
        res && { ...res, leads: res.leads.map((l) => (l.id === lead.id ? { ...l, ...j.lead, fit: l.fit } : l)) },
      );
      charge(j.spent ?? 0);
    } catch (e) {
      setRevealed((m) => {
        const { [lead.id]: _failed, ...rest } = m;
        return rest;
      });
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function downloadCsv() {
    if (!result) return;
    const cols = ["fit", "name", "title", "company", "domain", "industry", "employees", "location", "linkedin", "email"];
    const rows = result.leads.map((l) => [
      l.fit.score, l.name, l.title, l.company.name, l.company.domain ?? "", l.company.industry,
      l.company.employees ?? "", l.location, l.linkedin ?? "", l.email?.address ?? "",
    ]);
    const csv = [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `timnu-leads-page-${result.page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ready = answers.offer.trim() && splitList(answers.titles).length > 0 && (config?.serverKey || ownKey);
  const lookalikeCount = canLookalike ? splitList(answers.lookalikes).length : 0;

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">timnu</a>
        <div className="topbar-right">
          {credits !== null && <span className="pill" title="AI Ark credits left">{fmt(credits)} credits</span>}
          {spent > 0 && <span className="pill" title="Spent this session">−{fmt(spent)} this session</span>}
          {demo && <span className="pill">demo</span>}
          <button className="pill" onClick={() => setShowKeys((s) => !s)} aria-expanded={showKeys}>
            {ownKey ? "Your keys ✓" : "Keys"}
          </button>
        </div>
      </header>

      <main className="wrap">
        {showKeys && (
          <section className="keys tablet" aria-label="API keys">
            <div className="screen">
              <h3>Bring your own keys</h3>
              <p>
                {config?.serverKey
                  ? "This deployment has a key configured. Paste your own to use your credits instead" + (config.demo ? " and lift the demo limits." : ".")
                  : "No server key is set. Paste an AI Ark key, or set AIARK_API_KEY in .env.local."}{" "}
                Keys are sent only to this app&apos;s server, per request, and are never stored there.
              </p>
              <div className="row">
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="AI Ark API key"
                  value={keys.aiark}
                  onChange={(e) => setKeys({ ...keys, aiark: e.target.value })}
                  aria-label="AI Ark API key"
                />
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="TypeSafe key for Jev scoring (optional)"
                  value={keys.typesafe}
                  onChange={(e) => setKeys({ ...keys, typesafe: e.target.value })}
                  aria-label="TypeSafe API key"
                />
              </div>
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember on this device (stored in this browser only)
              </label>
            </div>
          </section>
        )}

        {!result ? (
          <>
            <div className="hero">
              <h1>Timnu has <em>a few questions</em>.</h1>
              <p>Answer them, and she&apos;ll point her cane at the people most likely to buy.</p>
            </div>
            <form
              className="tablet"
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) void consult(0);
              }}
            >
              <div className="screen">
                <h2>timnu</h2>
                <p className="sub">The oracle of recurring revenue is listening.</p>

                <div className="q">
                  <label htmlFor="offer"><span className="n">1</span>What do you sell?</label>
                  <textarea id="offer" className="input" required maxLength={400}
                    placeholder="Product analytics for B2B SaaS teams"
                    value={answers.offer} onChange={(e) => setAnswers({ ...answers, offer: e.target.value })} />
                </div>

                <div className="q">
                  <label htmlFor="titles"><span className="n">2</span>Who signs the check?
                    <span className="hint">Job titles, comma-separated. Timnu also finds close variants.</span>
                  </label>
                  <input id="titles" className="input" required placeholder="Head of Product, VP Product, CPO"
                    value={answers.titles} onChange={(e) => setAnswers({ ...answers, titles: e.target.value })} />
                  <div className="chips" style={{ marginTop: 8 }} role="group" aria-label="Seniority">
                    {SENIORITIES.filter((s) => s !== "intern" && s !== "entry").map((s) => (
                      <button type="button" key={s} className="chip" aria-pressed={answers.seniority.includes(s)}
                        onClick={() => setAnswers({ ...answers, seniority: toggle(answers.seniority, s) })}>
                        {SENIORITY_LABEL[s] ?? cap(s)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="q">
                  <label htmlFor="industries"><span className="n">3</span>What kind of companies buy it?
                    <span className="hint">Industries, comma-separated. Leave empty for any.</span>
                  </label>
                  <input id="industries" className="input" placeholder="software development, financial services"
                    value={answers.industries} onChange={(e) => setAnswers({ ...answers, industries: e.target.value })} />
                </div>

                <div className="q">
                  <span className="label"><span className="n">4</span>How big are they? <span className="hint">Employees. Pick any.</span></span>
                  <div className="chips" role="group" aria-label="Company size">
                    {(Object.keys(SIZE_BANDS) as SizeBand[]).map((s) => (
                      <button type="button" key={s} className="chip" aria-pressed={answers.sizes.includes(s)}
                        onClick={() => setAnswers({ ...answers, sizes: toggle(answers.sizes, s) })}>{s}</button>
                    ))}
                  </div>
                </div>

                <div className="q">
                  <label htmlFor="locations"><span className="n">5</span>Where do they live?
                    <span className="hint">Countries, states, cities or regions. Leave empty for anywhere.</span>
                  </label>
                  <input id="locations" className="input" placeholder="United States, Europe"
                    value={answers.locations} onChange={(e) => setAnswers({ ...answers, locations: e.target.value })} />
                </div>

                {canLookalike && (
                  <details className="more">
                    <summary>Optional: who are your best customers?</summary>
                    <div className="q">
                      <label htmlFor="lookalikes">Up to 5 customer domains
                        <span className="hint">Timnu searches people at 50 companies that look like them (about 5 credits).</span>
                      </label>
                      <input id="lookalikes" className="input" placeholder="posthog.com, linear.app"
                        value={answers.lookalikes} onChange={(e) => setAnswers({ ...answers, lookalikes: e.target.value })} />
                    </div>
                  </details>
                )}

                <div className="actions">
                  <button className="btn primary" type="submit" disabled={!ready || !!busy}>
                    {busy === "consult" ? <span className="spinner" aria-hidden /> : "🔮"} Consult Timnu
                  </button>
                  <span className="cost">
                    {demo ? "Free in the demo." : `Costs 1 AI Ark credit${lookalikeCount ? " + about 5 for lookalikes" : ""}.`}
                  </span>
                </div>
                {error && <p className="notice error" role="alert">{error}</p>}
              </div>
            </form>
          </>
        ) : (
          <section className="tablet" aria-label="Leads">
            <div className="screen">
              <div className="verdict">
                <span className="compass" aria-hidden />
                <div>
                  <h2>The cane has spoken.</h2>
                  <p className="sub">
                    {result.total
                      ? `${result.total.toLocaleString("en-US")} people in that direction. Here are page ${result.page + 1}'s ${result.leads.length}, best fit first.`
                      : "Nobody in that direction. Try broader titles, fewer filters, or another region."}
                  </p>
                </div>
              </div>

              {result.notices.map((n) => <p className="notice" key={n}>{n}</p>)}
              {error && <p className="notice error" role="alert">{error}</p>}

              <div className="toolbar">
                <button className="btn ghost small" onClick={() => setResult(null)}>← Edit answers</button>
                {!result.unmasked && canReveal && result.leads.length > 0 && (
                  <button className="btn ghost small" disabled={!!busy}
                    onClick={() => {
                      const cost = fmt(result.leads.length * 0.5);
                      if (confirm(`Unmask full names and LinkedIn for this page? Costs ${cost} credits.`)) void consult(result.page, true);
                    }}>
                    {busy === "unmask" ? "Unmasking…" : `Unmask page · ${fmt(result.leads.length * 0.5)} credits`}
                  </button>
                )}
                {result.leads.length > 0 && <button className="btn ghost small" onClick={downloadCsv}>Download CSV</button>}
              </div>

              <ul className="leads">
                {result.leads.map((l) => (
                  <li className="lead" key={l.id}>
                    <span className="avatar" aria-hidden>{l.name.charAt(0)}</span>
                    <div className="who">
                      <div className="name">
                        {l.linkedin ? <a href={l.linkedin} target="_blank" rel="noopener noreferrer">{l.name}</a> : l.name}
                        {l.masked && !l.email && <span className="masked">name masked</span>}
                      </div>
                      <div className="role">{l.title || l.headline}{l.company.name && <> · <b>{l.company.name}</b></>}</div>
                      <div className="meta">
                        {[l.location, l.company.industry, l.company.employees != null && `${l.company.employees.toLocaleString("en-US")} employees`, l.company.domain]
                          .filter(Boolean).join(" · ")}
                      </div>
                      {l.fit.reasons.length > 0 && <div className="why">{l.fit.reasons.join(" · ")}</div>}
                      {l.email && <div className="email">✉ {l.email.address}{l.email.type === "CATCH_ALL" ? " (catch-all)" : ""}</div>}
                      {revealed[l.id] === "none" && <div className="why">No verified email found. Nothing was charged.</div>}
                    </div>
                    <div className="side">
                      <span className={`fit ${l.fit.score >= 0.75 ? "hi" : l.fit.score >= 0.5 ? "mid" : "lo"}`}
                        title={l.fit.source === "jev" ? "Scored by Jev" : "Built-in score"}>
                        fit {l.fit.score.toFixed(2)}{l.fit.source === "jev" ? " · Jev" : ""}
                      </span>
                      {!l.email && canReveal && revealed[l.id] !== "none" && (
                        <button className="btn ghost small" disabled={revealed[l.id] === "busy"} onClick={() => void reveal(l)}
                          title="Full profile + verified email. 1 credit only if an email is found.">
                          {revealed[l.id] === "busy" ? "Revealing…" : "Reveal email"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {result.totalPages > 1 && (
                <div className="pager">
                  <button className="btn ghost small" disabled={result.page === 0 || !!busy} onClick={() => void consult(result.page - 1)}>← Previous</button>
                  <span className="cost">
                    Page {result.page + 1} of {result.totalPages.toLocaleString("en-US")}{demo ? " (demo limit)" : " · 1 credit per page"}
                  </span>
                  <button className="btn ghost small" disabled={result.page + 1 >= result.totalPages || !!busy} onClick={() => void consult(result.page + 1)}>
                    {busy === "page" ? "Consulting…" : "Next →"}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        <p className="foot">
          Open source · <a href="https://github.com/rzere/timnu" target="_blank" rel="noopener noreferrer">GitHub</a> · data by{" "}
          <a href="https://ai-ark.com" target="_blank" rel="noopener noreferrer">AI Ark</a>
          {(result?.jev || config?.jev) && <> · fit by Jev</>}
        </p>
      </main>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
