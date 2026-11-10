'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Prints the page; the print stylesheet shows only the `.print-cards` sheet (globals.css). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden className="size-4" />
      {label}
    </Button>
  );
}
