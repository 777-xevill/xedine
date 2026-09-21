import { NextResponse } from 'next/server';

/** Liveness only: no database access, no tenant data. */
export function GET() {
  return NextResponse.json({ ok: true });
}
