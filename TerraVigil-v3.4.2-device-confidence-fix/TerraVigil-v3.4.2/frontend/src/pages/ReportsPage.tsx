import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Download,
  FileCheck2,
  FileText,
  Fingerprint,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { SweptNotClearedBanner } from '../components/ui/AlertNotice';
import { useReports } from '../hooks/useReports';
import { useSessionStore } from '../state/sessionStore';
import { config } from '../config';
import { apiAssetUrl } from '../services/assetUrl';
import { ABSENT, fmtArea, fmtCount, fmtDateTime } from '../lib/formatters';
import '../styles/evidence.css';

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready to download',
  generating: 'Generating',
  failed: 'Generation failed',
};

export const ReportsPage: React.FC = () => {
  const { reports, generateReport, isGenerating, isPending, isError, error, refetch } =
    useReports();
  const activeSession = useSessionStore((s) => s.activeSession);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [generationMode, setGenerationMode] = useState<'factual' | 'rag'>('factual');
  const isDemo = config.dataMode === 'demo';
  const hasPendingEditions = reports.some((report) => report.status === 'generating');
  useEffect(() => {
    if (!hasPendingEditions || isDemo) return;
    const timer = window.setInterval(() => {
      void refetch();
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingEditions, isDemo, refetch]);
  const rows = useMemo(
    () =>
      reports
        .filter((report) =>
          `${report.siteName} ${report.id} ${report.reportNumber}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.reportNumber - a.reportNumber),
    [reports, search],
  );
  const selected = rows.find((report) => report.id === selectedId) ?? rows[0];
  const sourceListLabel =
    selected?.generationMode === 'rag' && selected.narrativeSources === undefined
      ? 'Archived source references'
      : 'Factual source records';
  const handleGenerate = async (): Promise<void> => {
    if (!activeSession) return;
    setGenerationError(null);
    setGenerationNotice(null);
    try {
      const report = await generateReport(activeSession.id, generationMode === 'rag');
      setSelectedId(report.id);
      setSearch('');
      setGenerationNotice(
        isDemo
          ? 'Demo snapshot created. This records example metadata; a connected report service is required for PDF generation.'
          : report.status === 'ready'
            ? `Edition ${String(report.reportNumber)} is ready. PDF and CSV preserve the same source snapshot.`
            : 'Report generation requested. Its status will appear in the archive.',
      );
    } catch (cause) {
      setGenerationError(
        cause instanceof Error
          ? cause.message
          : 'The report could not be generated. Please try again.',
      );
    }
  };
  return (
    <div className="ev-page">
      <PageHeader
        eyebrow="Intelligence / Report archive"
        title="Evidence, ready for handover."
        description="PDF and CSV snapshots of the selected mission, Firebase timestamp matching, and recorded Pixhawk coordinates."
        actions={
          <div className="ev-report-actions">
            {!isDemo && (
              <label className="ev-generation-choice">
                <span>Edition content</span>
                <select
                  aria-label="Report generation mode"
                  value={generationMode}
                  disabled={isGenerating}
                  onChange={(event) => {
                    setGenerationMode(event.target.value === 'rag' ? 'rag' : 'factual');
                  }}
                >
                  <option value="factual">Factual snapshot · no AI</option>
                  <option value="rag">Add AI narrative · RAG</option>
                </select>
              </label>
            )}
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              disabled={isGenerating || activeSession === null}
              title={activeSession === null ? 'Select a scan session first' : undefined}
              onClick={() => {
                void handleGenerate();
              }}
            >
              {isGenerating ? 'Creating…' : isDemo ? 'Create demo snapshot' : 'Generate report'}
            </Button>
          </div>
        }
      />
      {!isDemo && (
        <p className="ev-form-help">
          Factual editions use stored records. AI narrative adds grounded generation and requires a
          configured embedding model and Gemini.
        </p>
      )}
      <div className="ev-report-intro">
        <div className="ev-intro-icon">
          <FileCheck2 size={25} />
        </div>
        <div>
          <span className="ev-kicker">A record you can trace</span>
          <h2>Every edition preserves its source.</h2>
          <p>
            Jetson Nano 4GB capture records, Firebase matching status, recorded GPS, and evidence
            references.
          </p>
        </div>
        <div className="ev-edition-counter">
          <strong>{isPending || isError ? ABSENT : String(reports.length).padStart(2, '0')}</strong>
          <span>{isDemo ? 'demo snapshots' : 'report editions'}</span>
        </div>
      </div>
      {generationError && (
        <p role="alert" className="ev-error">
          {generationError}
        </p>
      )}
      {generationNotice && (
        <p role="status" className="ev-notice">
          <Check size={16} />
          {generationNotice}
        </p>
      )}
      {activeSession && (
        <p className="ev-current-context">
          <span className="ev-mini-dot" />
          {isDemo ? 'Snapshot source' : 'Report source'} <strong>{activeSession.siteName}</strong>
        </p>
      )}
      {isPending && <Skeleton className="h-96 w-full" />}
      {!isPending && isError && (
        <EmptyState
          title="Reports unavailable"
          description={
            error instanceof Error ? error.message : 'The report archive could not be read.'
          }
        />
      )}
      {!isPending && !isError && reports.length === 0 && (
        <div className="ev-register ev-empty">
          <FileText size={32} className="text-accent" />
          <EmptyState
            title="Your first edition starts here"
            description="Generate a report from a scan session to assemble its survey findings and limitations."
          />
        </div>
      )}
      {!isPending && !isError && reports.length > 0 && (
        <div className="ev-report-layout">
          <section className="ev-register ev-report-library" aria-label="Report editions">
            <div className="ev-register-heading">
              <div>
                <span className="ev-kicker">Document archive</span>
                <h2>{isDemo ? 'Demo snapshots' : 'Report editions'}</h2>
              </div>
              <span className="ev-heading-count">{reports.length}</span>
            </div>
            <div className="ev-toolbar">
              <div className="ev-search">
                <Search size={17} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  aria-label="Search reports"
                  placeholder="Find a site or edition…"
                />
              </div>
            </div>
            {!rows.length && (
              <EmptyState
                title="No matching editions"
                description="Try searching for a different site or report number."
              />
            )}
            <ul className="ev-report-list">
              {rows.map((report) => (
                <li key={report.id}>
                  <button
                    className={`ev-report-item ${selected?.id === report.id ? 'is-selected' : ''}`}
                    aria-pressed={selected?.id === report.id}
                    onClick={() => {
                      setSelectedId(report.id);
                    }}
                  >
                    <span className="ev-file-icon">
                      <FileText size={21} />
                    </span>
                    <span className="ev-report-name">
                      <span className="ev-kicker">
                        Edition {String(report.reportNumber).padStart(4, '0')}
                      </span>
                      <strong>{report.siteName}</strong>
                      <span>{fmtDateTime(report.generatedAt)}</span>
                      <span className={`ev-status-pill ${report.status}`}>
                        <i />
                        {isDemo && report.status === 'ready'
                          ? 'Demo snapshot'
                          : (STATUS_LABEL[report.status] ?? report.status)}
                      </span>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                </li>
              ))}
            </ul>
            <footer className="ev-table-footer">
              <span>{rows.length} editions shown</span>
              <span>Version history preserved</span>
            </footer>
          </section>
          {selected && (
            <section
              className="ev-report-preview"
              aria-label={`Edition ${selected.reportNumber} details`}
            >
              <div className="ev-preview-top">
                <span className="ev-kicker">
                  Selected edition / {String(selected.reportNumber).padStart(4, '0')}
                </span>
                <span className="ev-subtle">
                  {isDemo ? 'Example metadata' : selected.formulaVersion}
                </span>
              </div>
              <div className="ev-document">
                <div className="ev-document-brand">
                  <span>
                    <CrosshairMark />
                    TERRAVIGIL
                  </span>
                  <span>{isDemo ? 'DEMO SNAPSHOT' : 'SURVEY RECORD'}</span>
                </div>
                <span className="ev-document-kicker">
                  Ground analysis / Edition {String(selected.reportNumber).padStart(4, '0')}
                </span>
                <h2>{selected.siteName}</h2>
                <p className="ev-document-date">{fmtDateTime(selected.generatedAt)}</p>
                <p className="ev-document-scope">
                  {isDemo
                    ? 'Offline example metadata'
                    : selected.generationMode === 'rag'
                      ? 'AI narrative · RAG'
                      : selected.generationMode === 'factual'
                        ? 'Factual snapshot · no AI generation'
                        : 'Generation mode unreported'}
                  {selected.synthetic && ' · Synthetic mission data'}
                </p>
                <div className="ev-document-rule" />
                <p className="ev-document-section">01 / Evidence summary</p>
                <div className="ev-report-metrics">
                  <div>
                    <strong>{fmtCount(selected.summary.confirmedMinesCount)}</strong>
                    <span>Confirmed records</span>
                  </div>
                  <div>
                    <strong>{fmtCount(selected.summary.unconfirmedVisualCount)}</strong>
                    <span>Unconfirmed visual</span>
                  </div>
                  <div>
                    <strong>{fmtCount(selected.summary.unresolvedMetalCount)}</strong>
                    <span>Unresolved metal</span>
                  </div>
                </div>
                <dl className="ev-document-facts">
                  <KeyValueRow
                    label="Onboard computer"
                    value={selected.hardware?.edgeComputer ?? 'Not recorded in this edition'}
                  />
                  <KeyValueRow
                    label="Aircraft / controller"
                    value={`${selected.hardware?.aircraft ?? ABSENT} / ${selected.hardware?.flightController ?? ABSENT}`}
                  />
                  <KeyValueRow
                    label="Firebase records / mapped"
                    value={`${fmtCount(selected.recordCounts?.firebaseEvents)} / ${fmtCount(selected.recordCounts?.firebaseMatched)}`}
                    mono
                  />
                  <KeyValueRow
                    label="Waiting for GPS / invalid"
                    value={`${fmtCount(selected.recordCounts?.firebasePending)} / ${fmtCount(selected.recordCounts?.firebaseInvalid)}`}
                    mono
                  />
                  <KeyValueRow
                    label="Removed at Firebase source"
                    value={fmtCount(selected.recordCounts?.firebaseRemoved)}
                    mono
                  />
                  <KeyValueRow
                    label="Risk · high / medium / low"
                    value={`${fmtCount(selected.summary.highRiskCount)} / ${fmtCount(selected.summary.mediumRiskCount)} / ${fmtCount(selected.summary.lowRiskCount)}`}
                    mono
                  />
                  <KeyValueRow
                    label="Visually swept"
                    value={fmtArea(selected.summary.visualSweptAreaM2)}
                    mono
                  />
                  <KeyValueRow
                    label="Dual swept"
                    value={fmtArea(selected.summary.dualSweptAreaM2)}
                    mono
                  />
                </dl>
                {selected.recordCounts &&
                  ((selected.recordCounts.imageInferenceRuns ?? 0) > 0 ||
                    (selected.recordCounts.imagePredictions ?? 0) > 0) && (
                    <section aria-label="Image inference summary">
                      <p className="ev-document-section">Image inference records</p>
                      <div className="ev-report-metrics">
                        <div>
                          <strong>{fmtCount(selected.recordCounts.imageInferenceRuns)}</strong>
                          <span>Image runs</span>
                        </div>
                        <div>
                          <strong>{fmtCount(selected.recordCounts.imagePredictions)}</strong>
                          <span>Model predictions</span>
                        </div>
                        <div>
                          <strong>
                            {fmtCount(selected.recordCounts.unlocalizedImagePredictions)}
                          </strong>
                          <span>Targets not localized</span>
                        </div>
                      </div>
                      <p className="ev-document-scope">
                        Image predictions are separate from observation totals. Model output alone
                        does not establish a confirmed mine or a measured target location.
                      </p>
                    </section>
                  )}
                <div className="ev-document-rule" />
                <p className="ev-document-section">02 / Scope & limitations</p>
                <p className="ev-document-scope">
                  Survey and decision support only. Single-sensor observations remain separate from
                  confirmed detections. Coverage records sensor passage and does not certify land
                  release.
                </p>
                <SweptNotClearedBanner compact />
                {selected.narrative && (
                  <>
                    <div className="ev-document-rule" />
                    <p className="ev-document-section">03 / AI narrative</p>
                    <p className="ev-document-scope whitespace-pre-wrap">{selected.narrative}</p>
                  </>
                )}
                {selected.narrativeError && (
                  <p role="alert" className="ev-error">
                    AI narrative: {selected.narrativeError}
                  </p>
                )}
                {!!selected.narrativeSources?.length && (
                  <section className="ev-report-sources" aria-label="AI narrative citations">
                    <h3>AI narrative citations</h3>
                    <ol>
                      {selected.narrativeSources.map((source) => (
                        <li key={source.citationNumber}>
                          <strong>
                            [{source.citationNumber}] {source.document}
                          </strong>
                          <span>
                            {source.section}
                            {source.sourceRecordId ? ` · ${source.sourceRecordId}` : ''}
                          </span>
                          <p>{source.snippet}</p>
                          {source.sha256 && <code>{source.sha256}</code>}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                {selected.narrative && !selected.narrativeSources?.length && (
                  <p className="ev-form-help">
                    Numbered AI references are unavailable for this edition.
                  </p>
                )}
                {!!selected.sources?.length && (
                  <details className="ev-report-sources" aria-label={sourceListLabel}>
                    <summary>
                      {sourceListLabel} · {selected.sources.length}
                    </summary>
                    <ul>
                      {selected.sources.map((source, index) => (
                        <li key={`${source.sourceRecordId ?? source.document}-${String(index)}`}>
                          <strong>{source.document}</strong>
                          <span>
                            {source.section}
                            {source.sourceRecordId ? ` · ${source.sourceRecordId}` : ''}
                          </span>
                          <p>{source.snippet}</p>
                          {source.sha256 && <code>{source.sha256}</code>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="ev-document-footer">
                  <span>Risk model {selected.formulaVersion}</span>
                  <span>{isDemo ? 'Demonstration only' : 'Summary preview'}</span>
                </div>
              </div>
              <div className="ev-report-integrity">
                <div>
                  <Fingerprint size={18} />
                  <span>Content reference</span>
                </div>
                <code title={selected.contentHash}>
                  {selected.contentHash || 'Awaiting content hash'}
                </code>
                <dl>
                  <KeyValueRow label="Report ID" value={selected.id} mono />
                  <KeyValueRow label="Source session" value={selected.sessionId} mono />
                </dl>
              </div>
              <Button
                variant="primary"
                className="w-full"
                icon={<Download size={16} />}
                disabled={
                  !apiAssetUrl(selected.downloadUrl) || selected.status !== 'ready' || isDemo
                }
                onClick={() => {
                  const url = apiAssetUrl(selected.downloadUrl);
                  if (url && selected.status === 'ready' && !isDemo)
                    window.open(url, '_blank', 'noopener,noreferrer');
                }}
              >
                {isDemo
                  ? 'PDF requires connected service'
                  : !selected.downloadUrl
                    ? 'PDF not available yet'
                    : 'Download survey PDF'}
              </Button>
              {!isDemo && (
                <Button
                  className="w-full"
                  icon={<Download size={16} />}
                  disabled={!apiAssetUrl(selected.csvDownloadUrl) || selected.status !== 'ready'}
                  onClick={() => {
                    const url = apiAssetUrl(selected.csvDownloadUrl);
                    if (url && selected.status === 'ready')
                      window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                >
                  Download evidence CSV
                </Button>
              )}
              <p className="ev-preview-note">
                <ShieldCheck size={14} />
                {isDemo
                  ? 'Example records for product evaluation. No field report is issued.'
                  : 'New editions preserve earlier reports and their original content hashes.'}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

const CrosshairMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
    <path d="M9 1v4M9 13v4M1 9h4M13 9h4" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="9" r="1.5" fill="currentColor" />
  </svg>
);
