/**
 * Inside the settings panel only the right side changes when you pick another setting, so only it
 * plays the page cascade (ADR 0063); the panel and its list stay still.
 */
export default function SettingsTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
