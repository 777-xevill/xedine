/** The workspace frame for every page except the chat, which uses the full height (ADR 0024). */
export default function PagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
  );
}
