import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Radio,
  ScanLine,
  Target,
} from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Brand } from '../components/layout/Brand';
import { TerrainIllustration } from '../components/briefing/TerrainIllustration';
import { config } from '../config';
import '../styles/briefing.css';

gsap.registerPlugin(ScrollTrigger);

function subscribeToMotionPreference(listener: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', listener);
  return () => {
    query.removeEventListener('change', listener);
  };
}

function readMotionPreference() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const chapters = [
  {
    label: 'Observe',
    title: 'A candidate is a question.',
    body: 'The visual pass records surface observations. A camera finding remains unconfirmed until supporting metal evidence meets the fusion criteria.',
    icon: ScanLine,
    detail: 'Visual evidence',
    next: '/detections',
  },
  {
    label: 'Corroborate',
    title: 'Two sensors. One standard.',
    body: 'A separate metal pass adds independent evidence. Visual-only and metal-only observations stay distinct; confirmed detections require both.',
    icon: Radio,
    detail: 'Independent metal evidence',
    next: '/live',
  },
  {
    label: 'Understand',
    title: 'Put uncertainty on the map.',
    body: 'Review the evidence, its classification, and its stated location uncertainty together. Survey observations support decisions; swept ground is not released land.',
    icon: Target,
    detail: 'Human review + geospatial context',
    next: '/risk-map',
  },
] as const;

const tour = [
  { label: 'Operations', path: '/', text: 'Start with the selected survey and instrument status.' },
  {
    label: 'Live console',
    path: '/live',
    text: 'See telemetry, observations, and the recorded sweep.',
  },
  {
    label: 'Detections',
    path: '/detections',
    text: 'Compare visual and metal evidence, then review a record.',
  },
  {
    label: 'Risk map',
    path: '/risk-map',
    text: 'Explore confirmed evidence and location uncertainty.',
  },
  {
    label: 'Reports',
    path: '/reports',
    text: 'Inspect the reporting workflow and integration state.',
  },
] as const;

export function BriefingPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const chapterRef = useRef<HTMLDivElement>(null);
  const introTimeline = useRef<gsap.core.Timeline | null>(null);
  const [stage, setStage] = useState(0);
  const [motionPaused, setMotionPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, readMotionPreference);
  const chapter = chapters[stage] ?? chapters[0];

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || motionPaused) return;
    const media = gsap.matchMedia();
    media.add(
      '(prefers-reduced-motion: no-preference)',
      () => {
        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
        intro
          .from('.briefing-headline > span', {
            yPercent: 110,
            opacity: 0,
            duration: 0.95,
            stagger: 0.1,
          })
          .from(
            '.briefing-intro-copy, .briefing-hero-actions',
            { y: 16, opacity: 0, duration: 0.6, stagger: 0.08 },
            0.4,
          )
          .from('.terrain-mesh', { opacity: 0, y: 28, duration: 1.2 }, 0.12)
          .from('.terrain-aircraft', { y: -22, opacity: 0, duration: 0.8 }, 0.45)
          .from('.briefing-footnote', { opacity: 0, duration: 0.45 }, 0.9);
        introTimeline.current = intro;
        // Finite illustration sequence: no endless animation behind reading content.
        intro.to(
          '.terrain-scan',
          { x: 125, y: -60, opacity: 0, duration: 2.4, ease: 'sine.inOut' },
          0.6,
        );
        const reveals = page.querySelectorAll('.briefing-reveal');
        reveals.forEach((element) => {
          gsap.from(element, {
            y: 28,
            opacity: 0,
            duration: 0.65,
            ease: 'power2.out',
            scrollTrigger: { trigger: element, scroller: page, start: 'top 92%', once: true },
          });
        });
        return () => {
          introTimeline.current = null;
        };
      },
      page,
    );
    return () => {
      media.revert();
    };
  }, [motionPaused]);

  useLayoutEffect(() => {
    if (motionPaused) return;
    const media = gsap.matchMedia();
    media.add(
      '(prefers-reduced-motion: no-preference)',
      () => {
        gsap.from('.briefing-chapter-copy', {
          y: 10,
          opacity: 0,
          duration: 0.35,
          ease: 'power2.out',
        });
      },
      chapterRef,
    );
    return () => {
      media.revert();
    };
  }, [stage, motionPaused]);

  return (
    <div className="briefing-page" ref={pageRef}>
      <a
        className="skip-link"
        href="#briefing-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('briefing-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="briefing-nav">
        <Brand />
        <span className="briefing-nav-caption">AERIAL SURVEY INTELLIGENCE</span>
        <Link to="/" className="briefing-nav-action">
          Open workspace <ArrowUpRight size={16} />
        </Link>
      </header>
      <div className="briefing-mode">
        <span className="briefing-mode-dot" />
        {config.dataMode === 'demo'
          ? 'SIMULATED DATA · INTERACTIVE DEMONSTRATION'
          : 'PROJECT BRIEFING · CONCEPT ILLUSTRATION'}
        <span>READ-ONLY AIRCRAFT OBSERVATION</span>
      </div>
      <main id="briefing-content" tabIndex={-1}>
        <section className="briefing-hero" aria-labelledby="briefing-title">
          <div className="briefing-hero-copy">
            <p className="briefing-kicker">
              <span>FIELD NOTES / 01</span>
              <span>THE TERRAVIGIL PROJECT</span>
            </p>
            <h1 className="briefing-headline" id="briefing-title">
              <span>See the ground.</span>
              <span>Know the</span>
              <span className="briefing-accent">evidence.</span>
            </h1>
            <p className="briefing-intro-copy">
              Aerial observation. Independent confirmation. A shared picture of what we know—and
              what we don’t.
            </p>
            <div className="briefing-hero-actions">
              <Link to="/" className="briefing-primary">
                Explore the workspace <ArrowUpRight size={19} />
              </Link>
              <button
                className="briefing-secondary"
                onClick={() =>
                  chapterRef.current?.scrollIntoView({
                    behavior:
                      motionPaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
                  })
                }
              >
                How it works <ArrowDown size={15} />
              </button>
            </div>
            <p className="briefing-footnote">
              Built around a simple principle.
              <br />
              <strong>No single sensor tells the whole story.</strong>
            </p>
          </div>
          <div className="briefing-hero-visual">
            <TerrainIllustration stage={stage} />
            <div className="briefing-visual-controls">
              <span>CONCEPT VIEW / DUAL-SENSOR SURVEY</span>
              <button
                aria-pressed={motionPaused || reducedMotion}
                disabled={reducedMotion}
                onClick={() => {
                  setMotionPaused((value) => !value);
                }}
                aria-label={
                  motionPaused ? 'Enable presentation motion' : 'Pause presentation motion'
                }
              >
                {motionPaused ? <Play size={13} /> : <Pause size={13} />}
                {reducedMotion ? 'Reduced motion' : motionPaused ? 'Motion off' : 'Pause motion'}
              </button>
              <button
                className="briefing-replay"
                disabled={motionPaused || reducedMotion}
                onClick={() => introTimeline.current?.restart()}
                aria-label="Replay introduction"
              >
                Replay <Play size={12} />
              </button>
            </div>
          </div>
        </section>
        <div className="briefing-principles" aria-label="Product principles">
          <span>
            <span>01 /</span> Visual observation
          </span>
          <span>
            <span>02 /</span> Metal corroboration
          </span>
          <span>
            <span>03 /</span> Stated uncertainty
          </span>
          <span>
            <span>04 /</span> Human judgment
          </span>
        </div>
        <section
          className="briefing-method briefing-reveal"
          ref={chapterRef}
          aria-labelledby="method-title"
        >
          <div className="briefing-section-heading">
            <p className="briefing-kicker">THE METHOD</p>
            <h2 id="method-title">
              From a signal
              <br />
              to a reasoned decision.
            </h2>
            <p>Three steps, with the evidence kept intact.</p>
          </div>
          <div className="briefing-chapters">
            <div className="briefing-chapter-tabs" role="tablist" aria-label="Survey workflow">
              {chapters.map((item, index) => (
                <button
                  key={item.label}
                  id={`chapter-tab-${index}`}
                  role="tab"
                  aria-selected={stage === index}
                  aria-controls="chapter-panel"
                  tabIndex={stage === index ? 0 : -1}
                  onClick={() => {
                    setStage(index);
                  }}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'ArrowRight'
                        ? (index + 1) % chapters.length
                        : event.key === 'ArrowLeft'
                          ? (index + chapters.length - 1) % chapters.length
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? chapters.length - 1
                              : null;
                    if (next !== null) {
                      event.preventDefault();
                      setStage(next);
                      document.getElementById(`chapter-tab-${next}`)?.focus();
                    }
                  }}
                >
                  <span>0{index + 1}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div
              id="chapter-panel"
              className="briefing-chapter-panel"
              role="tabpanel"
              aria-labelledby={`chapter-tab-${stage}`}
              tabIndex={0}
            >
              <div className="briefing-chapter-symbol">
                <chapter.icon size={32} strokeWidth={1} />
                <span>0{stage + 1}</span>
              </div>
              <div className="briefing-chapter-copy" key={stage}>
                <span className="briefing-kicker">{chapter.detail}</span>
                <h3>{chapter.title}</h3>
                <p>{chapter.body}</p>
                <Link to={chapter.next}>
                  See it in the workspace <ArrowRight size={16} />
                </Link>
              </div>
              <div className="briefing-chapter-arrows">
                <button
                  aria-label="Previous workflow step"
                  onClick={() => {
                    setStage((value) => (value + 2) % 3);
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  aria-label="Next workflow step"
                  onClick={() => {
                    setStage((value) => (value + 1) % 3);
                  }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </section>
        <section className="briefing-tour briefing-reveal" aria-labelledby="tour-title">
          <div className="briefing-section-heading">
            <p className="briefing-kicker">INSIDE THE WORKSPACE</p>
            <h2 id="tour-title">Follow the evidence.</h2>
            <p>A five-stop walkthrough for your project demonstration.</p>
          </div>
          <div className="briefing-tour-list">
            {tour.map((item, index) => (
              <Link to={item.path} key={item.path}>
                <span className="briefing-tour-number">0{index + 1}</span>
                <h3>{item.label}</h3>
                <p>{item.text}</p>
                <ArrowUpRight size={22} strokeWidth={1} />
              </Link>
            ))}
          </div>
        </section>
        <section className="briefing-status briefing-reveal" aria-labelledby="status-title">
          <div className="briefing-section-heading">
            <p className="briefing-kicker">PROJECT STATUS</p>
            <h2 id="status-title">
              A working interface.
              <br />
              An honest boundary.
            </h2>
          </div>
          <div className="briefing-status-column">
            <span className="briefing-kicker">IN THIS FRONTEND</span>
            <h3>Ready to explore</h3>
            <ul>
              <li>
                <Check size={15} />
                Sessions, evidence review, and map layers
              </li>
              <li>
                <Check size={15} />
                Telemetry and recorded survey views
              </li>
              <li>
                <Check size={15} />
                Explicit synthetic demonstration data
              </li>
              <li>
                <Check size={15} />
                Adapters for the ground-station services
              </li>
            </ul>
          </div>
          <div className="briefing-status-column">
            <span className="briefing-kicker">REQUIRES CONNECTED SERVICES</span>
            <h3>The complete system</h3>
            <p>
              Aircraft and sensor feeds, validated fusion and risk outputs, source imagery, route
              computation, cited assistant answers, and generated report files.
            </p>
            <Link to="/settings">
              Inspect connection settings <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
        <footer className="briefing-footer">
          <div>
            <span className="briefing-kicker">TERRAVIGIL / FIELD INTELLIGENCE</span>
            <h2>
              Every observation
              <br />
              deserves context.
            </h2>
          </div>
          <div>
            <Link className="briefing-primary" to="/">
              Enter the workspace <ArrowUpRight size={20} />
            </Link>
            <p>
              Survey intelligence. Human decisions.
              <br />
              SWEPT ≠ CLEARED.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
