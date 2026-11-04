import { config } from '../config';
import { detectionClassLabel, detectionDeviceLabel, detectionLabel, sensorConfidenceLabel } from '../lib/classification';
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Radio,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { RiskBadge } from '../components/ui/RiskBadge';
import { ClassificationBadge } from '../components/ui/ClassificationBadge';
import { ConfidenceLedger } from '../components/ui/ConfidenceLedger';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useDetections } from '../hooks/useDetections';
import { useSessionStore } from '../state/sessionStore';
import { ABSENT, fmtLatLon, fmtTime, fmtUncertainty } from '../lib/formatters';
import type { Classification, RiskBand } from '../domain/types';
import '../styles/evidence.css';

const REVIEW_LABEL: Record<string, string> = {
  unreviewed: 'Needs review',
  operator_endorsed: 'Endorsed',
  operator_disputed: 'Disputed',
};
const TABS: { key: Classification | 'all'; label: string }[] = [
  { key: 'confirmed', label: 'Confirmed mines' },
  { key: 'unconfirmed_visual', label: 'Visual candidates' },
  { key: 'unresolved_metal', label: 'Metal observations' },
  { key: 'all', label: 'All observations' },
];
const PAGE_SIZE = 8;

export const DetectionsPage: React.FC = () => {
  const navigate = useNavigate();
  const activeSession = useSessionStore((s) => s.activeSession);
  const { detections, isPending, isError, error } = useDetections(activeSession?.id);
  const [tab, setTab] = useState<Classification | 'all'>('all');
  const [risk, setRisk] = useState<RiskBand | 'all'>('all');
  const [search, setSearch] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const reviewAvailable = config.dataMode === 'demo' || config.backendStyle === 'prd';
  const [newest, setNewest] = useState(true);
  const [page, setPage] = useState(1);
  const counts = useMemo(
    () => ({
      all: detections.length,
      confirmed: detections.filter((d) => d.classification === 'confirmed').length,
      unconfirmed_visual: detections.filter((d) => d.classification === 'unconfirmed_visual')
        .length,
      unresolved_metal: detections.filter((d) => d.classification === 'unresolved_metal').length,
      unreviewed: detections.filter((d) => d.reviewState === 'unreviewed').length,
    }),
    [detections],
  );
  const rows = useMemo(
    () =>
      detections
        .filter((d) => {
          if (tab !== 'all' && d.classification !== tab) return false;
          if (risk !== 'all' && d.riskBand !== risk) return false;
          if (reviewAvailable && reviewOnly && d.reviewState !== 'unreviewed') return false;
          return `${detectionLabel(d)} ${d.sourceRecordId ?? ''} ${d.id} ${d.className ?? ''} ${d.classId ?? ''}`
            .toLowerCase()
            .includes(search.trim().toLowerCase());
        })
        .sort((a, b) => (newest ? -1 : 1) * a.lastObservedAt.localeCompare(b.lastObservedAt)),
    [detections, tab, risk, search, reviewOnly, reviewAvailable, newest],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const changeTab = (value: Classification | 'all') => {
    setTab(value);
    setPage(1);
    setRisk('all');
  };
  const readCount = (value: number) =>
    isPending || isError ? '—' : String(value).padStart(2, '0');
  return (
    <div className="ev-page">
      <PageHeader
        eyebrow="Evidence / Detection register"
        title="Every signal. In context."
        description="Trace each observation from sensor evidence to operator review."
        actions={
          <Button
            variant="secondary"
            icon={<ArrowUpRight className="size-4" />}
            onClick={() => navigate('/live')}
          >
            Open live survey
          </Button>
        }
      />
      {detections.some((row) => row.validationIssue) && (
        <p role="alert" className="ev-error">
          Some stored classifications need validation. Inspect the flagged records before treating
          them as dual-sensor confirmations.
        </p>
      )}
      <div className="ev-stats-grid ev-stats-grid--detections">
        <button
          className={`ev-stat ${tab === 'confirmed' ? 'is-selected' : ''}`}
          onClick={() => {
            changeTab('confirmed');
          }}
        >
          <span className="ev-stat-top">
            <span>Confirmed mines</span>
            <Crosshair size={17} />
          </span>
          <strong>{readCount(counts.confirmed)}</strong>
          <span className="ev-stat-caption">Visual + metal corroboration</span>
        </button>
        <button
          className={`ev-stat ${tab === 'unresolved_metal' ? 'is-selected' : ''}`}
          onClick={() => {
            changeTab('unresolved_metal');
          }}
        >
          <span className="ev-stat-top">
            <span>Metal observations</span>
            <Radio size={17} />
          </span>
          <strong>{readCount(counts.unresolved_metal)}</strong>
          <span className="ev-stat-caption">No visual corroboration</span>
        </button>
        <button
          className={`ev-stat ${reviewAvailable && reviewOnly ? 'is-selected' : ''}`}
          disabled={!reviewAvailable}
          title={
            reviewAvailable ? undefined : 'Review status is not available in this mission backend.'
          }
          onClick={() => {
            setReviewOnly(!reviewOnly);
            setTab('all');
            setRisk('all');
            setPage(1);
          }}
        >
          <span className="ev-stat-top">
            <span>Review queue</span>
            <ArrowUpRight size={17} />
          </span>
          <strong>{reviewAvailable ? readCount(counts.unreviewed) : ABSENT}</strong>
          <span className="ev-stat-caption">
            {reviewAvailable ? 'Pending operator assessment' : 'Review unavailable'}
          </span>
        </button>
      </div>
      <section className="ev-register" aria-label="Detection register">
        <div className="ev-register-heading">
          <div>
            <span className="ev-kicker">Observation ledger</span>
            <h2>{activeSession?.siteName ?? 'All sessions'}</h2>
          </div>
          <span className="ev-subtle">
            {isPending ? 'Loading records' : `${counts.all} observations recorded`}
          </span>
        </div>
        <div className="ev-tabs" role="tablist" aria-label="Observation classification">
          {TABS.map((item, index) => (
            <button
              type="button"
              role="tab"
              id={`detection-tab-${item.key}`}
              aria-controls="detection-results"
              aria-selected={tab === item.key}
              tabIndex={tab === item.key ? 0 : -1}
              key={item.key}
              onClick={() => {
                changeTab(item.key);
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? TABS.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
                const nextTab = TABS[next];
                if (nextTab) {
                  changeTab(nextTab.key);
                  document.getElementById(`detection-tab-${nextTab.key}`)?.focus();
                }
              }}
            >
              {item.label}
              <span>{readCount(counts[item.key])}</span>
            </button>
          ))}
        </div>
        <div className="ev-toolbar">
          <div className="ev-search">
            <Search size={17} aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search target, class or observation ID…"
              aria-label="Search detections"
            />
          </div>
          <div className="ev-toolbar-actions">
            <label className="ev-select-wrap">
              <SlidersHorizontal size={15} aria-hidden />
              <span className="sr-only">Risk band</span>
              <select
                value={risk}
                onChange={(event) => {
                  setRisk(event.target.value as RiskBand | 'all');
                  setPage(1);
                }}
              >
                <option value="all">All risk bands</option>
                <option value="high">High · ≥ 0.70</option>
                <option value="medium">Medium · 0.40–0.69</option>
                <option value="low">Low · &lt; 0.40</option>
              </select>
            </label>
            <button
              className={`ev-filter-button ${reviewAvailable && reviewOnly ? 'is-active' : ''}`}
              disabled={!reviewAvailable}
              title={
                reviewAvailable
                  ? undefined
                  : 'Review status is not available in this mission backend.'
              }
              aria-pressed={reviewAvailable && reviewOnly}
              onClick={() => {
                setReviewOnly(!reviewOnly);
                setPage(1);
              }}
            >
              Needs review
            </button>
          </div>
        </div>
        <div id="detection-results" role="tabpanel" aria-labelledby={`detection-tab-${tab}`}>
          {isPending && (
            <div className="ev-loading">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {!isPending && isError && (
            <EmptyState
              title="Register unavailable"
              description={
                error instanceof Error ? error.message : 'The detection register could not be read.'
              }
            />
          )}
          {!isPending && !isError && rows.length === 0 && (
            <div className="ev-empty">
              <EmptyState
                title="No matching observations"
                description={
                  detections.length
                    ? 'Try another classification or reset the current filters.'
                    : 'Recorded observations will appear here when the session receives sensor evidence.'
                }
              />
              {detections.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setRisk('all');
                    setReviewOnly(false);
                    changeTab('all');
                  }}
                >
                  Reset filters
                </Button>
              )}
            </div>
          )}
          {!isPending && !isError && visible.length > 0 && (
            <div className="ev-table-scroll">
              <table className="ev-table">
                <caption className="sr-only">
                  Detection register, {rows.length} matching records
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Target / observation</th>
                    <th scope="col">Classification</th>
                    <th scope="col">Risk evidence</th>
                    <th scope="col">Sensor confidence</th>
                    <th scope="col">Position / CEP95</th>
                    <th scope="col">Operator review</th>
                    <th scope="col">
                      <span className="sr-only">View record</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((detection) => (
                    <tr key={detection.id}>
                      <th scope="row">
                        <Link className="ev-target-link" to={`/detections/${detection.id}`}>
                          <span
                            className={`ev-target-icon ${detection.classification === 'confirmed' ? 'ev-target-confirmed' : ''}`}
                          >
                            <Crosshair size={18} />
                          </span>
                          <span>
                            <strong>{detectionClassLabel(detection)}</strong>
                            <span className="ev-mono ev-cell-sub">{detectionLabel(detection)}</span>
                            {detectionDeviceLabel(detection) && (
                              <span className="ev-cell-sub">Source: {detectionDeviceLabel(detection)}</span>
                            )}
                            {sensorConfidenceLabel(detection) && (
                              <span className="ev-cell-sub">{sensorConfidenceLabel(detection)}</span>
                            )}
                            <span className="ev-cell-sub">
                              Last observed {fmtTime(detection.lastObservedAt)}
                            </span>
                          </span>
                        </Link>
                      </th>
                      <td>
                        <ClassificationBadge
                          classification={detection.classification}
                          validationIssue={detection.validationIssue ?? null}
                        />
                      </td>
                      <td>
                        {detection.riskBand ? (
                          <RiskBadge band={detection.riskBand} score={detection.riskScore} />
                        ) : (
                          <span className="ev-subtle">Risk unreported</span>
                        )}
                      </td>
                      <td className="ev-ledger-cell">
                        <ConfidenceLedger
                          visualConfidence={detection.bestVisualConfidence}
                          metalSignalNorm={detection.bestMetalSignalNorm}
                          visualThreshold={activeSession?.config.visualConfidenceThreshold ?? null}
                          metalThreshold={activeSession?.config.metalThresholdNorm ?? null}
                          compact
                        />
                        {sensorConfidenceLabel(detection) && (
                          <span className="ev-cell-sub">{sensorConfidenceLabel(detection)}</span>
                        )}
                      </td>
                      <td>
                        <span className="ev-mono ev-coordinate">
                          {fmtLatLon(detection.position.lat, detection.position.lon)}
                        </span>
                        <span className="ev-cell-sub">
                          {fmtUncertainty(detection.localizationUncertaintyM)} CEP95
                        </span>
                      </td>
                      <td>
                        <span className={`ev-review-state ${detection.reviewState}`}>
                          <i />
                          {detection.reviewState === null
                            ? 'Unavailable'
                            : REVIEW_LABEL[detection.reviewState]}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="ev-icon-link"
                          to={`/detections/${detection.id}`}
                          aria-label={`Open ${detection.className ?? detection.id}`}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <footer className="ev-table-footer">
          <span>
            {rows.length
              ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, rows.length)}`
              : '0'}{' '}
            of {rows.length} observations
          </span>
          <button
            className="ev-sort"
            onClick={() => {
              setNewest(!newest);
            }}
          >
            <ArrowDown size={14} style={{ transform: newest ? undefined : 'rotate(180deg)' }} />
            {newest ? 'Latest first' : 'Earliest first'}
          </button>
          <div className="ev-pagination">
            <button
              disabled={currentPage <= 1}
              onClick={() => {
                setPage(currentPage - 1);
              }}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {currentPage} / {totalPages}
            </span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => {
                setPage(currentPage + 1);
              }}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </section>
      <p className="ev-footnote">
        <span className="ev-mini-dot" />
        Only dual-sensor confirmations are published as mines. Risk describes evidence strength;
        single-sensor observations remain unconfirmed.
      </p>
    </div>
  );
};
