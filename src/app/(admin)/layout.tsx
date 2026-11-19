import { AllMessages } from '@/components/all-messages';

/** This part's words for its browser code (the root layout sends only `common`). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AllMessages>{children}</AllMessages>;
}
