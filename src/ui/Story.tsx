import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_REGION } from '../data/baserates';
import { crumbTrail, crowdNow, leftTheCrowd, minimumFix, type Dossier } from '../lib/dossier';
import { estimate, humanCount } from '../lib/estimate';
import type { Attribute, CrowdEstimate, Grade, Post as CorePost } from '../lib/types';

/** p1.json posts carry the subreddit as `subreddit`. */
type Post = CorePost & { subreddit?: string };
import { COMMITTED, PREFILTER, REPO, receiptUrl } from '../eval/receipts';
import type { Replay } from '../lib/replay';
import { CrowdField } from './CrowdField';
import { FIELD_N, fieldBase, litCount } from './crowd';

/**
 * The home page explainer. Every number here is computed from the committed recorded run
 * (public/personas/p1-replay.json), the synthetic persona (p1.json) and the receipts folder,
 * with the same core the app uses. Nothing is typed in by hand except the test-suite sizes.
 */

interface Step {
  kind: 'start' | 'attr' | 'region';
  date?: string;
  label: string;
  share?: [number, number];
  grade?: Grade;
  post?: Post;
  quote?: string;
  est: CrowdEstimate;
  /** The crowd this one detail would leave on its own. */
  alone?: number;
}

/** Sizes of the test suites at the commit this page ships with (npm test, ext:test, swift test). */
const SUITE = { web: 147, ext: 65, swift: 18, golden: 435 };
/** P50 from the iPhone receipt (receipts/ios, Apple Foundation Models, typed generation). */
const IOS_P50 = '50.13432259896638';

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (x: number) => (x * 100 >= 10 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
const month = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Eases a number toward its target with rAF; jumps under reduced motion. */
function useTween(target: number, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); from.current = target; return; }
    const a = Math.log(Math.max(1, from.current)), b = Math.log(Math.max(1, target));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      const x = Math.exp(a + (b - a) * e);
      setV(x); from.current = x;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Highlight({ text, quote }: { text: string; quote?: string }) {
  const i = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (!quote || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + quote.length)}</mark>{text.slice(i + quote.length)}</>;
}

export function Story({ dossier, replay, onTry }: { dossier: Dossier | null; replay: Replay | null; onTry: () => void }) {
  const [posts, setPosts] = useState<Map<string, Post> | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}personas/p1.json`).then((r) => r.json())
      .then((p: { posts: Post[] }) => setPosts(new Map(p.posts.map((x) => [x.id, x]))))
      .catch(() => setPosts(new Map()));
  }, []);

  const steps = useMemo<Step[] | null>(() => {
    if (!dossier) return null;
    const all = fieldBase(DEFAULT_REGION);
    const start: Step = { kind: 'start', label: 'Every adult in the US', est: { p10: all, p50: all, p90: all, band: 'crowd', bits: 0 } };
    const byLabel = new Map<string, Attribute>(dossier.attributes.map((a) => [a.rate.label, a]));
    const out: Step[] = [start];
    for (const t of crumbTrail(dossier)) {
      const a = byLabel.get(t.added[0]);
      if (a) {
        const f = [...a.facts].sort((x, y) => x.date.localeCompare(y.date))[0];
        out.push({ kind: 'attr', date: t.date, label: a.rate.label, share: [a.rate.low, a.rate.high], grade: a.rate.grade, post: posts?.get(f.postId), quote: f.quote, est: t.estimate, alone: estimate(DEFAULT_REGION, [a]).p50 });
      } else {
        const f = [...dossier.regionFacts].sort((x, y) => x.date.localeCompare(y.date))[0];
        const adults = dossier.region.population * dossier.region.adultShare;
        out.push({ kind: 'region', date: t.date, label: dossier.region.label, share: [adults / start.est.p50, adults / start.est.p50], grade: dossier.region.grade, post: f ? posts?.get(f.postId) : undefined, quote: f?.quote, est: t.estimate, alone: adults });
      }
    }
    return out;
  }, [dossier, posts]);

  if (!dossier || !steps || !replay) return <div className="story-wait"><span className="lbl mut">Loading the recorded run</span></div>;
  const final = crowdNow(dossier);
  const left = leftTheCrowd(crumbTrail(dossier));
  const fix = minimumFix(dossier, 1000);
  const fixed = estimate(dossier.region, dossier.attributes.filter((a) => !fix.includes(a)));
  const fixPosts = new Set(fix.flatMap((a) => a.facts.map((f) => f.postId))).size;
  const postBytes = posts ? [...posts.values()].reduce((s, p) => s + new TextEncoder().encode(p.text).length, 0) : 0;
  const kept = replay.log.reduce((s, e) => s + e.facts.length, 0);
  const proposed = kept + replay.rejected;
  const years = posts && posts.size ? (() => { const d = [...posts.values()].map((p) => p.date).sort(); return Math.round((Date.parse(d[d.length - 1]) - Date.parse(d[0])) / 3.156e10); })() : 6;
  const msSorted = replay.log.map((e) => e.ms).sort((a, b) => a - b);
  const medianMs = msSorted[Math.floor(msSorted.length / 2)] ?? 0;

  return (
    <>
      <nav className="toc" aria-label="On this page">
        <a href="#story">How a stranger finds her</a>
        <a href="#together">Alone vs together</a>
        <a href="#words">Where your words go</a>
        <a href="#checker">The checker</a>
        <a href="#surfaces">Web, iPhone, Chrome</a>
        <a href="#receipts">Receipts</a>
        <a href="#try" onClick={(e) => { e.preventDefault(); onTry(); }}>Try it</a>
      </nav>

      <Threat steps={steps} years={years} postsTotal={replay.postsTotal} />
      <Scrolly steps={steps} final={final} leftDate={left?.date} base={fieldBase(dossier.region)} postsTotal={replay.postsTotal} />
      <Together steps={steps} final={final} fixPosts={fixPosts} fixed={fixed.p50} />
      <Words postBytes={postBytes} postsTotal={replay.postsTotal} onDevice={replay.onDevice} />
      <Checker proposed={proposed} kept={kept} rejected={replay.rejected} />
      <Surfaces final={final} />
      <Receipts replay={replay} medianMs={medianMs} />
      <Limits />
    </>
  );
}

function SecHead({ k, title, children }: { k: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="x-head">
      <span className="x-k lbl">{k}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  );
}

/* ── the threat ── */
function Threat({ steps, years, postsTotal }: { steps: Step[]; years: number; postsTotal: number }) {
  return (
    <section className="x threat" aria-labelledby="threat-h">
      <header className="x-head">
        <span className="x-k lbl">The threat</span>
        <h2 id="threat-h">Your pseudonym is not a hiding place anymore</h2>
        <p>An AI agent can read every comment you ever wrote, pull out each harmless detail, and search the world for the one person who matches all of them. Researchers already did it at scale.</p>
      </header>
      <div className="big3">
        <div><b>25–67%</b><span>of pseudonymous Hacker News and Reddit users re-identified by LLM agents</span></div>
        <div><b>70–90%</b><span>precision. When the agent named someone, it was usually right</span></div>
        <div className="s"><b>{steps.length - 1} of {postsTotal}</b><span>posts were enough to narrow our demo nurse to one of ~{humanCount(steps[steps.length - 1].est.p50)}, across {years} years</span></div>
      </div>
      <p className="x-cite">Lermen et al., “Large-scale online deanonymization with LLMs”, USENIX Security ’26. The demo persona is synthetic.</p>
    </section>
  );
}

/* ── the scrollytelling hero moment ── */
function Scrolly({ steps, final, leftDate, base, postsTotal }: { steps: Step[]; final: CrowdEstimate; leftDate?: string; base: number; postsTotal: number }) {
  const [i, setI] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setI(Number((e.target as HTMLElement).dataset.i));
    }, { rootMargin: '-45% 0px -45% 0px' });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [steps.length]);
  const s = steps[i];
  const n = useTween(s.est.p50);
  const isLast = i === steps.length - 1;
  return (
    <section className="x scrolly" id="story" aria-labelledby="story-h">
      <SecHead k="Case file: quietnight_rn (synthetic)" title={<span id="story-h">How a stranger finds her, one post at a time</span>}>
        Six years of posts by a night-shift nurse. Scroll through the {steps.length - 1} that matter. Each one is ordinary. Watch the crowd she hides in.
      </SecHead>
      <div className="sc-grid">
        <div className="sc-sticky">
          <div className={`sc-num band-${s.est.band}`} aria-live="polite">
            <span className="lbl mut">{i === 0 ? 'She could be any of' : 'She could still be any of'}</span>
            <b className="num">{humanCount(n)}</b>
            <span className="lbl mut">{s.kind === 'start' ? 'adults in the United States' : `range ${humanCount(s.est.p10)}–${humanCount(s.est.p90)}`}</span>
          </div>
          <div className="field-box sc-field"><CrowdField p50={s.est.p50} base={base} band={s.est.band} label={`${litCount(s.est.p50, base)} of ${FIELD_N} dots lit`} /></div>
          <ol className="sc-pips" aria-hidden>
            {steps.map((x, j) => <li key={j} className={`${j <= i ? 'on' : ''} band-${x.est.band}`}><span>{x.date ? x.date.slice(0, 4) : 'Start'}</span></li>)}
          </ol>
          {isLast && <p className="sc-left">She left the crowd in {leftDate ? month(leftDate) : 'the end'}. No single post did it.</p>}
        </div>
        <ol className="sc-steps">
          {steps.map((x, j) => (
            <li key={j} data-i={j} ref={(el) => { refs.current[j] = el; }} className={j === i ? 'on' : ''}>
              {x.kind === 'start' ? (
                <div className="sc-card">
                  <span className="lbl mut">Day zero</span>
                  <h3>Nobody knows who quietnight_rn is</h3>
                  <p>A throwaway handle. No name, no photo, no city in the profile. {postsTotal} posts across r/nursing, r/Parenting, r/Ohio, r/running and others. She is one of every adult in America.</p>
                </div>
              ) : (
                <div className="sc-card">
                  <div className="sc-meta"><span className="lbl">{x.date && month(x.date)}</span>{x.post?.subreddit && <span className="lbl mut">r/{x.post.subreddit}</span>}</div>
                  <blockquote>{x.post ? <Highlight text={x.post.text} quote={x.quote} /> : x.quote}</blockquote>
                  <div className="sc-fact">
                    <span className="lbl sig">Leaks</span>
                    <b>{x.label}</b>
                    {x.share && <span className="mono small mut">{x.kind === 'region' ? `${humanCount(x.alone ?? 0)} adults` : `${pct(x.share[0])}–${pct(x.share[1])} of adults`}{x.grade && <> · grade {x.grade}</>}</span>}
                  </div>
                  <p className="sc-after"><span className="lbl mut">Crowd now</span><b className={`band-${x.est.band}`}>{humanCount(x.est.p50)}</b></p>
                </div>
              )}
            </li>
          ))}
          <li className="sc-end" data-i={steps.length - 1}>
            <div className="sc-card end">
              <span className="lbl sig">Result</span>
              <h3>One of ~{humanCount(final.p50)}</h3>
              <p>Range {humanCount(final.p10)}–{humanCount(final.p90)}. Fifty people is a list a stranger can work through in an afternoon. This is an upper bound: an attacker who finds details OneOf missed narrows it further.</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ── alone vs together ── */
function Together({ steps, final, fixPosts, fixed }: { steps: Step[]; final: CrowdEstimate; fixPosts: number; fixed: number }) {
  const base = steps[0].est.p50;
  const w = (n: number) => `${Math.max(1.2, (Math.log10(Math.max(1, n)) / Math.log10(base)) * 100)}%`;
  const rows = steps.slice(1);
  return (
    <section className="x together" id="together" aria-labelledby="tog-h">
      <SecHead k="Why it works" title={<span id="tog-h">Alone, every detail is a crowd. Together, they’re a room.</span>}>
        Each bar is how many US adults share that one detail, on a log scale. None of them narrows it much. Multiply them and the crowd collapses.
      </SecHead>
      <div className="tg">
        {rows.map((r, j) => (
          <div className="tg-row" key={j}>
            <span className="tg-l">{r.label}</span>
            <span className="tg-bar"><i style={{ width: w(r.alone ?? base) }} /></span>
            <b className="tg-v">{humanCount(r.alone ?? base)}</b>
          </div>
        ))}
        <div className="tg-row all">
          <span className="tg-l">All {rows.length} together</span>
          <span className="tg-bar"><i style={{ width: w(final.p50) }} /></span>
          <b className="tg-v">~{humanCount(final.p50)}</b>
        </div>
        <div className="tg-axis" aria-hidden><span>1</span><span>100</span><span>10K</span><span>1M</span><span>100M</span></div>
      </div>
      <div className="tg-fix">
        <div>
          <span className="lbl mut">Rejoin the crowd</span>
          <p className="tg-fix-big">Edit {fixPosts} posts. Back to ~{humanCount(fixed)}.</p>
          <p className="mut">OneOf finds the smallest set of details whose removal puts you back above a thousand people, and lists the exact posts that carry them.</p>
        </div>
        <div className="tg-fix-bars" aria-hidden>
          <div><span className="lbl">Now</span><i className="sig" style={{ width: w(final.p50) }} /><b>{humanCount(final.p50)}</b></div>
          <div><span className="lbl">After {fixPosts} edits</span><i className="dev" style={{ width: w(fixed) }} /><b>{humanCount(fixed)}</b></div>
        </div>
      </div>
    </section>
  );
}

/* ── where your words go ── */
function Words({ postBytes, postsTotal, onDevice }: { postBytes: number; postsTotal: number; onDevice: number }) {
  const pipeline: Array<[string, string]> = [
    ['Import', 'Reddit export, JSON, CSV or paste. Only posts and comments are opened; IP logs and messages never are.'],
    ['Order', 'Posts with a life-detail cue go first. Nothing is skipped except empty and link-only posts.'],
    ['Extract', 'Gemini Nano in Chrome, or Apple Intelligence on iPhone, returns facts as schema-locked JSON.'],
    ['Verify', 'Code, not the model: the quote must be verbatim, about the author, literal and grounded.'],
    ['Dossier', 'Facts map to base rates from public tables. Health and religion stay local and never count.'],
    ['Estimate', '4,000 Monte Carlo draws give a range, never one number, with every factor’s source.'],
  ];
  return (
    <section className="x words" id="words" aria-labelledby="words-h">
      <SecHead k="Hybrid AI, honestly" title={<span id="words-h">Your words stay on your device. The cloud gets one phrase.</span>}>
        Firebase AI Logic routes every call. Your posts and drafts are pinned on-device. The only thing that can leave is a generic attribute, shown to you word for word, after you say yes.
      </SecHead>
      <div className="wd">
        <div className="wd-dev">
          <div className="wd-k"><span className="badge b-device">ON DEVICE</span><span className="lbl mut">Your computer or phone</span></div>
          <ol className="wd-pipe">
            {pipeline.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}
          </ol>
        </div>
        <div className="wd-gap" aria-hidden><span className="lbl">one generic attribute</span><i /><span className="lbl mut">after consent</span></div>
        <div className="wd-cloud">
          <div className="wd-k"><span className="badge b-cloud">IN CLOUD</span><span className="lbl mut">Gemini via Firebase</span></div>
          <p className="mut small">The exact request, nothing more:</p>
          <pre className="wd-req">{'occupation: registered nurse\nUnited States'}</pre>
          <p className="small">Answer: how common that is, with a source and a grade. Names, numbers, places, health and dated events are refused before they can be sent.</p>
          <p className="small mut">Every request carries an App Check token: reCAPTCHA Enterprise on the web, App Attest on iPhone.</p>
        </div>
      </div>
      <div className="bytes">
        <div className="by-row"><span className="lbl">Read on this device</span><span className="by-bar dev"><i style={{ width: '100%' }} /></span><b>{fmt(postBytes)} B</b></div>
        <div className="by-row"><span className="lbl">Sent anywhere</span><span className="by-bar"><i style={{ width: '0%' }} /></span><b className="dev">0 B</b></div>
        <p className="small mut">The recorded demo run: {onDevice} of {postsTotal} posts read by Gemini Nano, 0 in the cloud. Count it yourself in “What the cloud saw”, the receipt in the top bar.</p>
      </div>
      <div className="router">
        {[
          ['Your posts', 'ONLY_ON_DEVICE', 'b-device', 'No on-device model? The scan is blocked, never sent.'],
          ['Your drafts and rewrites', 'ONLY_ON_DEVICE', 'b-device', 'Whatever you type is treated as yours.'],
          ['Synthetic demo', 'PREFER_ON_DEVICE', 'b-amber', 'Cloud fallback allowed, because no one is real.'],
          ['Base rates', 'ONLY_IN_CLOUD', 'b-cloud', 'One generic phrase per request, after a yes.'],
        ].map(([a, m, c, d]) => (
          <div key={a}><span className="lbl mut">{a}</span><span className={`badge ${c}`}>{m}</span><p className="small">{d}</p></div>
        ))}
      </div>
    </section>
  );
}

/* ── the checker ── */
function Checker({ proposed, kept, rejected }: { proposed: number; kept: number; rejected: number }) {
  const decoys: Array<[string, string]> = [
    ['my sister in Seattle', 'someone else'], ['as an astronaut', 'joke'], ['imagine having five kids', 'hypothetical'], ['my friend moved to Chicago', 'someone else'],
    ['my brother is a software engineer', 'someone else'], ['I feel 80 years old', 'figurative'], ['the doctor on duty', 'someone else'], ['if I had a Harley', 'hypothetical'],
  ];
  return (
    <section className="x checker" id="checker" aria-labelledby="chk-h">
      <SecHead k="The model proposes, code decides" title={<span id="chk-h">{fmt(proposed)} claims in. {kept} survive.</span>}>
        Small on-device models over-read. So nothing a model says counts until a deterministic checker confirms it: the quote has to appear word for word, be about the author, and mean it literally.
      </SecHead>
      <div className="ck">
        <div className="ck-bar" role="img" aria-label={`${proposed} claims proposed by Gemini Nano, ${rejected} rejected by the checker, ${kept} kept`}>
          <i className="rej" style={{ flexGrow: rejected }}><span>{rejected} rejected</span></i>
          <i className="kep" style={{ flexGrow: Math.max(kept, proposed * 0.08) }}><span>{kept} kept</span></i>
        </div>
        <p className="small mut">From the recorded run of all {fmt(proposed)} claims Gemini Nano made about the demo persona.</p>
      </div>
      <div className="ck-traps">
        <div>
          <h3>8 planted traps. 0 counted.</h3>
          <p className="mut">The demo persona was written with decoys an over-eager model would bite on. None of them reached the estimate.</p>
        </div>
        <ul>
          {decoys.map(([q, why]) => <li key={q}><s>“{q}”</s><span className="lbl">{why}</span></li>)}
        </ul>
      </div>
    </section>
  );
}

/* ── three surfaces ── */
function Surfaces({ final }: { final: CrowdEstimate }) {
  const base = import.meta.env.BASE_URL;
  const webP50 = String(final.p50).slice(0, IOS_P50.length);
  return (
    <section className="x surfaces" id="surfaces" aria-labelledby="sf-h">
      <SecHead k="One core, three places" title={<span id="sf-h">Before you post, wherever you post</span>} />
      <div className="sf">
        <figure>
          <img src={`${base}shots/web-result.jpg`} alt="OneOf on the web: the result screen showing one of about 50, the crowd field and the crumb trail" loading="lazy" />
          <figcaption><b>Web</b><span>Scan years of history in Chrome with Gemini Nano. Crowd, crumb trail, the math, and the posts to edit.</span></figcaption>
        </figure>
        <figure className="phone">
          <img src={`${base}shots/ios-dossier.jpg`} alt="OneOf on iPhone: the dossier screen, built with Apple Intelligence" loading="lazy" />
          <figcaption><b>iPhone</b><span>Native SwiftUI on Firebase’s hybrid API: Apple Intelligence on the phone, Gemini only for public statistics.</span></figcaption>
        </figure>
        <figure>
          <img src={`${base}shots/ext-pill.jpg`} alt="The OneOf Chrome extension pill over a reply box: one of about 1, was about 50, if you post this" loading="lazy" />
          <figcaption><b>Chrome extension</b><span>Checks the draft in any reply box you allow, before you hit post. It has no network access at all.</span></figcaption>
        </figure>
      </div>
      <div className="same">
        <span className="lbl mut">Same dossier, two different on-device models, same answer</span>
        <div className="same-row"><span className="lbl">Gemini Nano in Chrome, computed in this browser</span><b>{webP50}</b></div>
        <div className="same-row"><span className="lbl">Apple Intelligence on iPhone, from its receipt</span><b>{IOS_P50}</b></div>
        <p className="small mut">Both platforms run one estimator: a Swift port checked against {SUITE.golden} golden cases generated by the TypeScript core, bit for bit on the random stream.{webP50 === IOS_P50 ? ' Here the two agree to the last digit.' : ' Any difference in the last digit is floating-point rounding between engines.'}</p>
      </div>
    </section>
  );
}

/* ── receipts ── */
function Receipts({ replay, medianMs }: { replay: Replay; medianMs: number }) {
  const rows = COMMITTED.map((r) => ({
    ...r,
    name: r.file.includes('cloud') ? 'Cloud baseline' : r.file.includes('x3') ? 'Prompt v3' : r.file.includes('x2r') ? 'Prompt v2r (shipped)' : 'Prompt v2',
    tag: r.file.includes('x3') ? 'rolled back' : r.file.includes('x2r') ? 'shipped' : r.file.includes('cloud') ? `${r.summary.errors}/${r.summary.n} rate-limited` : '',
    fa: r.summary.neg ? r.summary.negWithFacts / r.summary.neg : 0,
  }));
  return (
    <section className="x receipts" id="receipts" aria-labelledby="rc-h">
      <SecHead k="Receipts, not claims" title={<span id="rc-h">Tested on data we never tuned on</span>}>
        SynthPAI is a public set of synthetic Reddit comments with labelled personal attributes. We held part of it out and only measured on it. When a prompt looked better on our own data but doubled false alarms on the held-out set, we rolled it back.
      </SecHead>
      <div className="rc">
        <div className="rc-chart" role="table" aria-label="Held-out SynthPAI results">
          <div className="rc-legend" aria-hidden><span><i className="k1" />Attributes caught</span><span><i className="k2" />False alarms on quiet comments</span></div>
          {rows.map((r) => (
            <div className="rc-row" role="row" key={r.file}>
              <div className="rc-name" role="rowheader"><b>{r.name}</b>{r.tag && <span className={`lbl ${r.tag === 'rolled back' ? 'sig' : r.tag === 'shipped' ? 'dev' : 'mut'}`}>{r.tag}</span>}</div>
              <div className="rc-bars" role="cell">
                <div><i className="k1" style={{ width: `${r.summary.labelRecall * 100}%` }} /><span>{pct(r.summary.labelRecall)}</span></div>
                <div><i className="k2" style={{ width: `${r.fa * 100}%` }} /><span>{pct(r.fa)}</span></div>
              </div>
              <a className="rc-link lbl" href={receiptUrl(r.file)} target="_blank" rel="noreferrer">receipt</a>
            </div>
          ))}
          {PREFILTER && <p className="small mut">A keyword filter we used to rely on kept only {PREFILTER.revealing.recall} of revealing comments on {fmt(PREFILTER.comments)} held-out comments, so it now only decides reading order. Nothing is skipped.</p>}
        </div>
        <div className="rc-stats">
          <div><b>{replay.onDevice}/{replay.postsTotal}</b><span>posts read on-device in the recorded run</span></div>
          <div><b>{(replay.totalMs / 60000).toFixed(1)} min</b><span>for six years of history, {(medianMs / 1000).toFixed(1)} s median per post</span></div>
          <div><b>{SUITE.web + SUITE.ext + SUITE.swift}</b><span>automated tests across web, extension and Swift core, green in CI</span></div>
          <div><b>$0</b><span>Built and run on Firebase’s free plan. On-device inference has no quota.</span></div>
        </div>
      </div>
      <p className="x-cite"><a href={`${REPO}/tree/main/receipts`} target="_blank" rel="noreferrer">All receipts are in the repo</a>. Open <a href="?eval">the evaluation page</a> to see them rendered.</p>
    </section>
  );
}

/* ── honest limits ── */
function Limits() {
  const items: Array<[string, string]> = [
    ['It’s an upper bound', 'On held-out data the on-device model caught about 4 in 10 labelled attributes. A determined attacker finds more, so your real crowd is probably smaller.'],
    ['It never says “safe”', 'Or “identified”. You get a range, a band and the sources. A big crowd today can shrink with your next post.'],
    ['It doesn’t name anyone', 'OneOf counts how many people match. It never searches for who they are.'],
    ['Base rates have grades', 'A is an official table, B is derived or cited, C is rough judgement and shown in amber. Every factor opens to its source.'],
    ['A small map, for now', 'English posts. Bundled region tables cover the US, Ohio, Columbus and Bengaluru; anywhere else counts as the whole country.'],
    ['The demo person is made up', 'quietnight_rn is synthetic. Your own history is only ever read on your device.'],
  ];
  return (
    <section className="x limits" aria-labelledby="lim-h">
      <SecHead k="Read before trusting" title={<span id="lim-h">What OneOf won’t tell you</span>} />
      <div className="lim">
        {items.map(([t, d]) => <div key={t}><h4>{t}</h4><p>{d}</p></div>)}
      </div>
    </section>
  );
}
