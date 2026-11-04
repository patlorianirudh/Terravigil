import { Link } from 'react-router-dom';
import type { ScanSession } from '../../domain/types';
import { useSessionStore } from '../../state/sessionStore';
import { Panel } from '../ui/Panel';
import { config } from '../../config';

export function SampleMissionWorkflow({ session }: { session: ScanSession }) {
  if (session.isSample !== true) return null;
  const selectMission = () => {
    useSessionStore.getState().setActiveSession(session);
  };
  return (
    <Panel title="Sample mission workflow" aria-label="Sample mission workflow">
      <p className="mb-3 text-xs text-text-muted">
        Synthetic practice data · {session.id}. Follow the recorded survey through the workspace.
      </p>
      <ol className="grid list-inside list-decimal gap-3 text-xs leading-relaxed text-text-secondary sm:grid-cols-2 lg:grid-cols-5">
        <li>
          <strong>Load and select.</strong> This sample is ready. Select it in the mission selector
          when returning.
        </li>
        <li>
          <Link to="/" onClick={selectMission} className="text-accent">
            Open Operations
          </Link>{' '}
          to view the recorded path and observations.
        </li>
        <li>
          Inspect{' '}
          <Link to="/detections" onClick={selectMission} className="text-accent">
            Detections
          </Link>
          , the{' '}
          <Link to="/risk-map" onClick={selectMission} className="text-accent">
            Risk map
          </Link>{' '}
          and{' '}
          <Link
            to={`/sessions/${encodeURIComponent(session.id)}`}
            onClick={selectMission}
            className="text-accent"
          >
            mission totals
          </Link>
          .
        </li>
        <li>
          <Link to="/route" onClick={selectMission} className="text-accent">
            Open Route planner
          </Link>
          , choose Use sample endpoints, then Compute route.
        </li>
        <li>
          <Link to="/assistant" onClick={selectMission} className="text-accent">
            Open Assistant
          </Link>{' '}
          {config.dataMode === 'demo'
            ? 'for offline summaries of bundled records. No AI model runs in this preview.'
            : 'and ask the connected assistant about these synthetic records. Indexing and Gemini require backend setup.'}
        </li>
      </ol>
    </Panel>
  );
}
