'use client';

import { useState, type ComponentProps } from 'react';

/** A plain form that sends only once, so a double tap on a slow phone never sends it twice. */
export function OnceForm(props: ComponentProps<'form'>) {
  const [sent, setSent] = useState(false);
  return (
    <form
      {...props}
      data-sent={sent || undefined}
      onSubmit={(e) => {
        if (sent) e.preventDefault();
        else setSent(true);
      }}
    />
  );
}
