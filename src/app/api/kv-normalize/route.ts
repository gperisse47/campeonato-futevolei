export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { readDB, writeDB } from '@/lib/kv';

export async function POST() {
  const raw = await readDB<any>();
  if (raw == null) return NextResponse.json({ ok: true, note: 'empty' });

  // Se readDB já parseia, aqui basta regravar (ficará objeto no KV)
  await writeDB(raw);
  return NextResponse.json({ ok: true, normalized: true });
}
