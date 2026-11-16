/**
 * Remounts on every navigation, so each page arrives in its short cascade (ADR 0063, `.page-enter` in
 * globals.css): the title out of a soft blur, then each block rising in turn.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
