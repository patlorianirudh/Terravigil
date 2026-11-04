import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, MapPinned } from 'lucide-react';
import '../styles/workspace.css';

export const NotFoundPage: React.FC = () => (
  <div className="not-found-page">
    <div className="not-found-art" aria-hidden>
      <Compass className="size-12" strokeWidth={1} />
      <span>404</span>
    </div>
    <p className="workspace-kicker text-accent">Outside the workspace</p>
    <h1>This page is off the map.</h1>
    <p>
      The address may have changed, or the page is no longer available.
      <br />
      Let’s get you back to your survey.
    </p>
    <Link to="/" className="not-found-primary">
      <ArrowLeft className="size-4" />
      Back to operations
    </Link>
    <Link to="/sessions" className="workspace-inline-link">
      <MapPinned className="size-4" />
      Browse survey sessions
    </Link>
  </div>
);
