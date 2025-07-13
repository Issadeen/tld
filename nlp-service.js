import { DockStart } from '@nlpjs/dock-core';
import { Nlp } from '@nlpjs/nlp';
import { LangEn } from '@nlpjs/lang-en-min';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let nlp;

async function initializeNlp() {
  if (nlp) {
    return nlp;
  }

  const dock = new DockStart({
    settings: {
      nlp: {
        languages: ['en'],
        forceNER: true,
      },
    },
    use: ['Nlp', 'LangEn'],
  });

  dock.register('Nlp', Nlp);
  dock.register('LangEn', LangEn);

  await dock.start();
  nlp = dock.get('nlp');
  const modelPath = path.join(__dirname, 'model.nlp');
  await nlp.load(modelPath);
  return nlp;
}

async function processNlp(text) {
  const localNlp = await initializeNlp();
  return localNlp.process('en', text);
}

export { initializeNlp, processNlp };