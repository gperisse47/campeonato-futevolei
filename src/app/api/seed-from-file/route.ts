export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { writeDB } from '@/lib/kv';

export async function POST() {
  try {
    // Caminho absoluto para o db.json na raiz do projeto
    const filePath = path.join(process.cwd(), 'db.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const json = JSON.parse(raw);

    await writeDB(json); // sobrescreve o KV

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
