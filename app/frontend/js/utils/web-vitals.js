/**
 * Web Vitals instrumentation for dev builds.
 *
 * Reports Core Web Vitals (FCP, LCP, CLS, INP, TTFB) to the backend
 * tracing subscriber so metrics appear in structured logs alongside
 * Rust-side timings.
 *
 * Only active in dev builds (import is tree-shaken in production).
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import { reportError } from './error-reporter.js';

/**
 * Initialize web-vitals reporting. Call once at app startup.
 */
export function initWebVitals() {
  const report = (metric) => {
    const line = `[web-vitals] ${metric.name}: ${Math.round(metric.value)}ms (${metric.rating})`;
    console.log(line);
    reportError(
      'info',
      line,
      `id=${metric.id} delta=${Math.round(metric.delta)} navigationType=${metric.navigationType}`,
    );
  };

  onFCP(report);
  onLCP(report);
  onCLS((metric) => {
    // CLS is unitless, not ms
    const line = `[web-vitals] ${metric.name}: ${metric.value.toFixed(4)} (${metric.rating})`;
    console.log(line);
    reportError(
      'info',
      line,
      `id=${metric.id} delta=${metric.delta.toFixed(4)} navigationType=${metric.navigationType}`,
    );
  });
  onINP(report);
  onTTFB(report);
}
