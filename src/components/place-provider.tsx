'use client';

import { createContext, useContext } from 'react';

/**
 * The restaurant's currency and time zone for the parts of a page that run in the browser (the till, the
 * table menu, the studios), so they show the same money and clock as the server-drawn page (ADR 0062).
 */
export interface ClientPlace {
  currency: string;
  tz: string;
}

const PlaceContext = createContext<ClientPlace>({ currency: 'BDT', tz: 'Asia/Dhaka' });

export function PlaceProvider({
  value,
  children,
}: {
  value: ClientPlace;
  children: React.ReactNode;
}) {
  return <PlaceContext.Provider value={value}>{children}</PlaceContext.Provider>;
}

export const usePlace = (): ClientPlace => useContext(PlaceContext);
