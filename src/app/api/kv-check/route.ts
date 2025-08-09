export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { readDB } from '@/lib/kv';

export async function GET() {
  try {
    const data = await readDB();
    return NextResponse.json({ ok: true, hasData: !!data, data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
