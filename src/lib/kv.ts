// src/lib/kv.ts
import { kv } from '@vercel/kv';

export const DB_KEY = 'ftv:db'; // chave única do “db.json”

export type DB = {
  // defina o shape do seu “db.json”
  // ex.: torneios, partidas, jogadores, etc.
  // torneios: { ... }[];
  // partidas: { ... }[];
  // ...
};

// Lê o “db.json” do KV
export async function readDB<T = DB>(): Promise<T | null> {
  return (await kv.get<T>(DB_KEY)) ?? null;
}

// Salva o “db.json” no KV (substitui o conteúdo atual)
export async function writeDB<T = DB>(data: T): Promise<'OK'> {
  await kv.set(DB_KEY, data);
  return 'OK';
}

// Inicializa caso ainda não exista
export async function ensureDB<T = DB>(seed: T): Promise<T> {
  const current = await kv.get<T>(DB_KEY);
  if (current) return current;
  await kv.set(DB_KEY, seed);
  return seed;
}
