import { LegalPage, PRIVACY_SECTIONS } from '@/components/legal-page';

export default function PrivacyPage() {
  return <LegalPage doc="privacy" sections={PRIVACY_SECTIONS} />;
}
