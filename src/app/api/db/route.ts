export const runtime = 'edge'; // opcional: executa mais rápido

import { NextRequest, NextResponse } from 'next/server';
import { readDB, writeDB } from '@/lib/kv';

// Ler banco
export async function GET() {
  const db = await readDB();
  return NextResponse.json(db ?? {}, { status: 200 });
}

// Salvar banco
export async function POST(req: NextRequest) {
  const body = await req.json();
  await writeDB(body);
  return NextResponse.json({ ok: true }, { status: 200 });
}
