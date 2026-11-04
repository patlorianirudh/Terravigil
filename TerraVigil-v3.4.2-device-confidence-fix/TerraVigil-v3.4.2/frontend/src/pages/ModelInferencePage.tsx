import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Cpu,
  Image as ImageIcon,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { api } from '../services/api';
import type { InferenceRequest, InferenceResult, ScanSession } from '../domain/types';
import { useSessionStore } from '../state/sessionStore';
import '../styles/evidence.css';
import '../styles/inference.css';

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The image could not be read.'));
    };
    reader.onerror = () => {
      reject(new Error('The image could not be read. Choose it again.'));
    };
    reader.readAsDataURL(file);
  });
}

export function ModelInferencePage() {
  const activeSession = useSessionStore((state) => state.activeSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const statusQuery = useQuery({
    queryKey: ['inference', 'status'],
    queryFn: () => api.getInferenceStatus(),
    retry: false,
    staleTime: 30_000,
  });
  const status = statusQuery.data;
  const modelReady = status?.ready === true && status.status === 'ready';
  const [filename, setFilename] = useState('');
  const [image, setImage] = useState('');
  const [reading, setReading] = useState(false);
  const [confidence, setConfidence] = useState('0.25');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [openingMission, setOpeningMission] = useState(false);
  const fileVersion = useRef(0);
  const maxBytes = status?.limits.maxImageBytes ?? 10 * 1024 * 1024;
  const mutation = useMutation({
    mutationFn: (input: InferenceRequest) => api.predictImage(input),
    onSuccess: (output) => {
      setResult(output);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['detections'] });
      void queryClient.invalidateQueries({ queryKey: ['missionStatistics'] });
      void queryClient.invalidateQueries({ queryKey: ['system', 'health'] });
    },
  });

  const selectFile = async (file: File | undefined) => {
    const version = ++fileVersion.current;
    setImage('');
    setFilename('');
    setResult(null);
    setError(null);
    setReading(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > maxBytes) {
      setError(`Choose a nonempty image no larger than ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }
    setReading(true);
    try {
      const data = await readImage(file);
      if (version === fileVersion.current) {
        setImage(data);
        setFilename(file.name);
      }
    } catch (cause) {
      if (version === fileVersion.current)
        setError(cause instanceof Error ? cause.message : 'Image read failed.');
    } finally {
      if (version === fileVersion.current) setReading(false);
    }
  };

  const run = async () => {
    if (!image || !status?.ready || status.status !== 'ready' || mutation.isPending) return;
    setError(null);
    setResult(null);
    const threshold = Number(confidence);
    if (
      !confidence.trim() ||
      !Number.isFinite(threshold) ||
      threshold < status.limits.minConfidence ||
      threshold > status.limits.maxConfidence
    ) {
      setError(
        `Choose a confidence threshold from ${String(status.limits.minConfidence)} to ${String(status.limits.maxConfidence)}.`,
      );
      return;
    }
    const hasLatitude = latitude.trim() !== '';
    const hasLongitude = longitude.trim() !== '';
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (
      hasLatitude !== hasLongitude ||
      (hasLatitude &&
        (!Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180))
    ) {
      setError(
        'Enter both GPS coordinates within latitude ±90 and longitude ±180, or leave both blank.',
      );
      return;
    }
    try {
      await mutation.mutateAsync({
        imageBase64: image,
        filename,
        confidence: threshold,
        ...(activeSession ? { missionId: activeSession.id } : {}),
        ...(hasLatitude ? { latitude: lat, longitude: lon } : {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inference could not complete.');
    }
  };

  const openMission = async () => {
    if (!result || openingMission) return;
    setOpeningMission(true);
    setError(null);
    try {
      const session = await api.getSession(result.missionId);
      if (session?.id !== result.missionId)
        throw new Error(
          'Inference mission could not be loaded. Refresh the mission list and try again.',
        );
      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      queryClient.setQueryData(['session', session.id], session);
      queryClient.setQueryData<ScanSession[]>(['sessions'], (current = []) => [
        ...current.filter((item) => item.id !== session.id),
        session,
      ]);
      useSessionStore.getState().setActiveSession(session);
      void navigate(`/sessions/${encodeURIComponent(session.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inference mission could not be loaded.');
    } finally {
      setOpeningMission(false);
    }
  };

  return (
    <div className="ev-page inference-page">
      <PageHeader
        eyebrow="Intelligence / Model inference"
        title="Put the model to the image."
        description="Run the supplied checkpoint on an uploaded image. Inspect its predictions, confidence and source frame."
        actions={
          <Button
            icon={
              <RefreshCw className={`size-4 ${statusQuery.isFetching ? 'animate-spin' : ''}`} />
            }
            disabled={statusQuery.isFetching || mutation.isPending}
            onClick={() => {
              void statusQuery.refetch();
            }}
          >
            Refresh model status
          </Button>
        }
      />
      <section className="inference-status" aria-label="Model readiness">
        <span className={`inference-status-icon ${modelReady ? 'is-ready' : ''}`}>
          <Cpu size={22} />
        </span>
        <div>
          <span className="ev-kicker">Checkpoint runtime</span>
          <h2>
            {statusQuery.isPending
              ? 'Checking model readiness…'
              : modelReady
                ? `${status.model.name} is ready`
                : status?.status === 'busy'
                  ? 'Model is processing an image'
                  : 'Model unavailable'}
          </h2>
          <p>
            {status?.model.device ? `Device ${status.model.device} · ` : ''}
            {status?.model.classes.length
              ? `${String(status.model.classes.length)} model classes`
              : 'Readiness is reported by the backend'}
          </p>
        </div>
        {modelReady && (
          <span className="inference-ready">
            <Check size={14} /> Ready to run
          </span>
        )}
        {status?.model.sha256 && (
          <details className="inference-model-detail">
            <summary>Model identity</summary>
            <code>{status.model.sha256}</code>
            <p>
              {Object.entries(status.runtime)
                .map(([key, value]) => `${key} ${value}`)
                .join(' · ')}
            </p>
          </details>
        )}
      </section>
      {(statusQuery.error ?? status?.error) && (
        <p role="alert" className="ev-error">
          {status?.error?.message ??
            (statusQuery.error instanceof Error
              ? statusQuery.error.message
              : 'Model status could not be read.')}
        </p>
      )}
      {error && (
        <p role="alert" className="ev-error">
          {error}
        </p>
      )}
      <div className="inference-layout">
        <form
          className="inference-form ev-register"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <div className="ev-register-heading">
            <div>
              <span className="ev-kicker">01 / Input</span>
              <h2>A frame to inspect</h2>
            </div>
            <ScanLine size={22} />
          </div>
          <div className="inference-form-body">
            <label className="inference-upload">
              <Upload size={27} />
              <strong>{reading ? 'Reading image…' : filename || 'Choose an image'}</strong>
              <span>JPEG, PNG or WebP · up to {(maxBytes / 1024 / 1024).toFixed(0)} MB</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Inference image"
                className="sr-only"
                disabled={mutation.isPending}
                onChange={(event) => {
                  void selectFile(event.target.files?.[0]);
                }}
              />
            </label>
            <label className="inference-field">
              <span>Confidence threshold</span>
              <input
                aria-label="Confidence threshold"
                type="number"
                min={status?.limits.minConfidence ?? 0.01}
                max={status?.limits.maxConfidence ?? 1}
                step="0.01"
                value={confidence}
                disabled={mutation.isPending}
                onChange={(event) => {
                  setConfidence(event.target.value);
                }}
              />
              <small>Only model predictions at or above this threshold are returned.</small>
            </label>
            <fieldset disabled={mutation.isPending}>
              <legend>
                Image location <span>Optional</span>
              </legend>
              <div className="inference-gps">
                <label className="inference-field">
                  <span>Latitude</span>
                  <input
                    aria-label="Latitude"
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={latitude}
                    onChange={(event) => {
                      setLatitude(event.target.value);
                    }}
                    placeholder="−90 to 90"
                  />
                </label>
                <label className="inference-field">
                  <span>Longitude</span>
                  <input
                    aria-label="Longitude"
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={longitude}
                    onChange={(event) => {
                      setLongitude(event.target.value);
                    }}
                    placeholder="−180 to 180"
                  />
                </label>
              </div>
              <p className="inference-help">
                These coordinates describe the image location, not an exact target location. Both
                are required to save eligible landmine predictions as unconfirmed observations.
              </p>
            </fieldset>
            <div className="inference-mission">
              <span className="ev-kicker">Mission destination</span>
              <strong>{activeSession?.siteName ?? 'New inference mission'}</strong>
              <p>
                {activeSession?.isSample
                  ? 'The selected mission is synthetic. This run creates a separate inference mission.'
                  : activeSession
                    ? 'Eligible observations are added to this mission.'
                    : 'The backend will create a mission for this run.'}
              </p>
            </div>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              icon={<ScanLine size={17} />}
              disabled={!image || reading || !modelReady || mutation.isPending}
            >
              {mutation.isPending ? 'Running model…' : 'Run inference'}
            </Button>
            <p className="inference-help">
              <ShieldCheck size={14} /> Visual predictions do not establish a confirmed mine or
              provide metal evidence.
            </p>
          </div>
        </form>
        <section className="ev-register inference-output" aria-label="Inference result">
          <div className="ev-register-heading">
            <div>
              <span className="ev-kicker">02 / Output</span>
              <h2>{result ? 'Actual model predictions' : 'Image workspace'}</h2>
            </div>
            {result && (
              <span className="ev-subtle">
                {result.image.width} × {result.image.height} px
              </span>
            )}
          </div>
          <div className={`inference-canvas ${mutation.isPending ? 'is-processing' : ''}`}>
            {result ? (
              <img src={result.annotatedImageUrl} alt="Model annotated result" />
            ) : image ? (
              <img src={image} alt="Selected inference image" />
            ) : (
              <div className="inference-empty">
                <ImageIcon size={44} strokeWidth={1} />
                <h3>Your source image appears here.</h3>
                <p>Upload a frame to run best.pt and inspect its annotated result.</p>
              </div>
            )}
            {mutation.isPending && (
              <div className="inference-processing" role="status">
                <RefreshCw className="size-5 animate-spin" />
                <span>Running the supplied checkpoint…</span>
              </div>
            )}
          </div>
          {result ? (
            <div className="inference-results">
              <div className="inference-result-summary">
                <div>
                  <strong>
                    {result.predictions.length} prediction
                    {result.predictions.length === 1 ? '' : 's'}
                  </strong>
                  <p>
                    {result.persistedObservations} unconfirmed observation
                    {result.persistedObservations === 1 ? '' : 's'} saved
                  </p>
                </div>
                <Link
                  to={`/sessions/${encodeURIComponent(result.missionId)}`}
                  className="inference-link"
                  aria-disabled={openingMission}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    void openMission();
                  }}
                >
                  {openingMission ? 'Opening mission…' : 'Open inference mission'}{' '}
                  <ArrowUpRight size={16} />
                </Link>
              </div>
              <p className="inference-help">
                {result.persistedObservations > 0
                  ? 'Saved coordinates are the supplied image location. Review the image and localization before any field decision.'
                  : 'No geolocated observation was saved. Predictions without supplied GPS, and non-landmine classes, remain image results.'}
              </p>
              {result.predictions.length ? (
                <div className="inference-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Model class</th>
                        <th>Confidence</th>
                        <th>Bounding box · px</th>
                        <th>Center · normalized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.predictions.map((prediction, index) => (
                        <tr key={index}>
                          <td>
                            {prediction.className}
                            <small>ID {prediction.classId}</small>
                          </td>
                          <td>{(prediction.confidence * 100).toFixed(1)}%</td>
                          <td>{prediction.bbox.map((v) => v.toFixed(1)).join(', ')}</td>
                          <td>
                            {prediction.normalizedCenter.x.toFixed(3)},{' '}
                            {prediction.normalizedCenter.y.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="inference-no-results">
                  No predictions met this run’s threshold. This does not establish that the image or
                  area is free of hazards.
                </p>
              )}
              <footer className="inference-result-footer">
                <a href={result.imageUrl} target="_blank" rel="noreferrer">
                  Open original <ArrowUpRight size={13} />
                </a>
                <a href={result.annotatedImageUrl} target="_blank" rel="noreferrer">
                  Open annotated image <ArrowUpRight size={13} />
                </a>
                <span>Run {result.runId}</span>
              </footer>
            </div>
          ) : (
            <p className="inference-preview-note">
              {image
                ? 'Input preview · run inference to produce model annotations.'
                : 'Results are produced by the backend model, with its original class names and confidence values.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
