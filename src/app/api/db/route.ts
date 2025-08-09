// src/app/api/db/route.ts
export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { readDB, writeDB } from '@/lib/kv';

export async function GET() {
  const db = await readDB();
  return NextResponse.json(db ?? {}, { status: 200 });
}

export async function POST(req: NextRequest) {
  // Proteção: header com token ou senha de admin via env
  const token = req.headers.get('x-admin-token');
  const ok = token && process.env.ADMIN_PASSWORD && token === process.env.ADMIN_PASSWORD;
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json();
  await writeDB(body);
  return NextResponse.json({ ok: true }, { status: 200 });
}
