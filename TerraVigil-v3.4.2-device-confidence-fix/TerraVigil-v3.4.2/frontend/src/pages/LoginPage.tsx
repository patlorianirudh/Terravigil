import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  Radio,
  Shield,
} from 'lucide-react';
import { api } from '../services/api';
import { config } from '../config';
import { Button } from '../components/ui/Button';
import '../styles/workspace.css';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const isDemo = config.dataMode === 'demo';
  const unavailable = !isDemo && config.backendStyle === 'missions';
  const signIn = async (): Promise<void> => {
    if (isSubmitting || unavailable) return;
    setIsSubmitting(true);
    setFailure(null);
    try {
      await api.login(email, password);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <span>
            <Shield className="size-5" strokeWidth={1.6} />
          </span>
          <strong>TerraVigil</strong>
          <small>FIELD INTELLIGENCE</small>
        </div>
        <div className="login-topography" aria-hidden>
          <svg viewBox="0 0 700 720" fill="none" preserveAspectRatio="xMidYMid slice">
            <g stroke="currentColor" strokeWidth="0.8">
              {Array.from({ length: 19 }, (_, i) => (
                <path
                  key={i}
                  d="M 282 165 C 354 112 501 164 499 238 C 497 294 424 302 452 356 C 485 420 561 486 490 536 C 407 594 401 485 315 494 C 218 504 161 426 203 357 C 245 289 183 238 282 165 Z"
                  transform={`translate(350 355) scale(${0.24 + i * 0.118}) translate(-350 -355)`}
                />
              ))}
            </g>
            <path
              d="M180 577 L180 397 L220 397 L220 515 L260 515 L260 397 L300 397 L300 490"
              stroke="currentColor"
              className="login-survey-line"
              strokeWidth="2"
              strokeDasharray="4 5"
            />
            <circle cx="300" cy="490" r="7" className="login-map-dot" />
            <circle cx="300" cy="490" r="19" stroke="currentColor" strokeWidth="1" />
            <path d="M300 460v-8m0 76v-8m-30-30h-8m76 0h-8" stroke="currentColor" />
            <text x="330" y="485" fill="currentColor" stroke="none" fontSize="9" letterSpacing="2">
              OBSERVATION POINT
            </text>
            <text x="330" y="502" fill="currentColor" stroke="none" fontSize="9" opacity="0.65">
              VISUAL + METALLIC EVIDENCE
            </text>
          </svg>
        </div>
        <div className="login-story-copy">
          <div className="login-story-eyebrow">
            <span />
            Built for the field. Grounded in evidence.
          </div>
          <h2>
            See further.
            <br />
            Understand more.
            <br />
            <em>Keep your distance.</em>
          </h2>
          <p>
            Aerial survey intelligence that connects the signals, so your team can focus on the
            decisions that matter.
          </p>
        </div>
        <div className="login-process">
          <div>
            <span>01</span>
            <strong>Observe</strong>
            <p>Survey from above</p>
          </div>
          <div>
            <span>02</span>
            <strong>Corroborate</strong>
            <p>Connect both sensors</p>
          </div>
          <div>
            <span>03</span>
            <strong>Understand</strong>
            <p>Review the evidence</p>
          </div>
        </div>
        <div className="login-story-footer">
          <Radio className="size-3.5" />
          <span>Survey & decision support</span>
          <span>TerraVigil / 01</span>
        </div>
      </section>
      <section className="login-access">
        <div className="login-mobile-brand">
          <Shield className="size-5 text-accent" />
          <strong>TerraVigil</strong>
        </div>
        <div className="login-access-top">
          <span className="workspace-kicker">Operator workspace</span>
          <span>
            <i />
            {isDemo ? 'Demo environment' : 'Authorized access'}
          </span>
        </div>
        <div className="login-form-wrap">
          <span className="login-access-icon">
            <Fingerprint className="size-7" strokeWidth={1.4} />
          </span>
          <p className="workspace-kicker text-accent">
            {isDemo ? 'Take a closer look' : 'Welcome back'}
          </p>
          <h1>{isDemo ? 'Intelligence starts here.' : 'Ready for a new perspective?'}</h1>
          <p className="login-form-intro">
            {isDemo
              ? 'Explore the complete TerraVigil workspace with an interactive demonstration survey.'
              : 'Sign in to your operator workspace to pick up where your survey left off.'}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void signIn();
            }}
          >
            {isDemo ? (
              <div className="login-demo-card">
                <div>
                  <span className="workspace-icon-box">
                    <Radio className="size-4" />
                  </span>
                  <div>
                    <strong>Your field console, ready to explore</strong>
                    <p>Sample sessions, evidence, and telemetry</p>
                  </div>
                </div>
                <ul>
                  <li>
                    <Check className="size-3.5" />
                    No account or credentials required
                  </li>
                  <li>
                    <Check className="size-3.5" />
                    All demonstration data is labeled
                  </li>
                  <li>
                    <Check className="size-3.5" />
                    Changes stay in the demo workspace
                  </li>
                </ul>
              </div>
            ) : (
              <>
                <div className="login-field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="you@organization.org"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                    className="field"
                  />
                </div>
                <div className="login-field">
                  <label htmlFor="password">Password</label>
                  <div className="login-password">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                      }}
                      className="field"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => {
                        setShowPassword(!showPassword);
                      }}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
            {failure !== null && (
              <p role="alert" className="login-error">
                {failure}
              </p>
            )}
            {unavailable && (
              <p role="status">
                Authentication is not available in this mission backend. No signed-in identity is
                established.
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isSubmitting || unavailable}
            >
              {isSubmitting
                ? 'Opening workspace…'
                : isDemo
                  ? 'Explore the workspace'
                  : 'Sign in to workspace'}
              <ArrowRight className="ml-auto size-4" />
            </Button>
          </form>
          <p className="login-access-help">
            <LockKeyhole className="size-3.5" />
            {isDemo
              ? 'Demonstration mode · no aircraft connection'
              : 'Access is managed by your organization’s administrator.'}
          </p>
        </div>
        <p className="login-disclaimer">
          TerraVigil supports survey decisions. It does not certify land release or authorize entry
          into a survey area.
        </p>
      </section>
    </main>
  );
};
