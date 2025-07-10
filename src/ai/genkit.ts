import {genkit, Genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';
import {config} from 'dotenv';

let aiInstance: Genkit | null = null;
let dotenvLoaded = false;

function ensureDotenv() {
  if (!dotenvLoaded) {
    config();
    dotenvLoaded = true;
  }
}

export function getAi(): Genkit {
  ensureDotenv();
  if (!aiInstance) {
    aiInstance = genkit({
      plugins: [googleAI()],
    });
  }
  return aiInstance;
}

export const ai = getAi();
