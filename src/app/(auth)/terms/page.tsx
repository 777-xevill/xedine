import { LegalPage, TERMS_SECTIONS } from '@/components/legal-page';

export default function TermsPage() {
  return <LegalPage doc="terms" sections={TERMS_SECTIONS} />;
}
