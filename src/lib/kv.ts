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
export async function readDB<T = any>(): Promise<T | null> {
  const raw = await kv.get(DB_KEY);
  if (raw == null) return null;
  // Se veio string (foi salvo como JSON string), parseia
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}

// Salva o “db.json” no KV (substitui o conteúdo atual)
export async function writeDB<T = any>(data: T): Promise<'OK'> {
  // Garante que salvamos como objeto (não string)
  const value = typeof data === 'string' ? JSON.parse(data) : data;
  await kv.set(DB_KEY, value);
  return 'OK';
}

// Inicializa caso ainda não exista
export async function ensureDB<T = DB>(seed: T): Promise<T> {
  const current = await kv.get<T>(DB_KEY);
  if (current) return current;
  await kv.set(DB_KEY, seed);
  return seed;
}
