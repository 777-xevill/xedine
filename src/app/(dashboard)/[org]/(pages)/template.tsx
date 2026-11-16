import { ViewTransition } from 'react';

/**
 * Remounts on every navigation, so each page arrives in its short cascade (ADR 0063, `.page-enter` in
 * globals.css): the title out of a soft blur, then each block rising in turn. The old page dissolves
 * as it goes (`page-swap`, a React <ViewTransition>); the sidebar and bars stay still. `.workspace`
 * scopes the dashboard-only polish (glass on hand-made cards, row hovers, list cascades).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition name="workspace" share="page-swap" default="none">
      <div className="page-enter workspace">{children}</div>
    </ViewTransition>
  );
}
