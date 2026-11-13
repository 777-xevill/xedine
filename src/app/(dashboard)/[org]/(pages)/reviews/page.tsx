import { redirect } from 'next/navigation';

/** Reviews and complaints are one page now (ADR 0054); old links and bookmarks land there. */
export default async function ReviewsRedirect({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/${org}/complaints`);
}
