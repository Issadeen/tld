import { dockStart } from '@nlpjs/core';
import { Nlp } from '@nlpjs/nlp';
import { LangEn } from '@nlpjs/lang-en-min';

let nlp;

async function initializeNlp() {
  const dock = await dockStart({
    settings: {
      nlp: {
        forceNER: true,
        languages: ['en'],
      },
    },
    use: ['Nlp', 'LangEn'],
  });

  nlp = dock.get('nlp');
  
  // Add training data
  nlp.addLanguage('en');

  // Greetings
  nlp.addDocument('en', 'hello', 'greetings.hello');
  nlp.addDocument('en', 'hi', 'greetings.hello');
  nlp.addDocument('en', 'hey', 'greetings.hello');

  // Truck Status
  nlp.addDocument('en', 'what is the status of %truck_id%', 'truck.status');
  nlp.addDocument('en', 'check status of %truck_id%', 'truck.status');
  nlp.addDocument('en', 'status for %truck_id%', 'truck.status');
  nlp.addDocument('en', 'get status for %truck_id%', 'truck.status');

  // Truck Query
  nlp.addDocument('en', 'how many %consignor% trucks loaded %dateRange%', 'truck.query');
  nlp.addDocument('en', 'get entries for %truck_id%', 'truck.query');
  nlp.addDocument('en', 'how many %consignor% trucks have left', 'truck.query');

  // Truck Repair
  nlp.addDocument('en', 'I need to report a repair for %truck_id%', 'truck.repair');
  nlp.addDocument('en', 'log a repair for %truck_id%', 'truck.repair');
  nlp.addDocument('en', 'truck %truck_id% needs repair', 'truck.repair');
  nlp.addDocument('en', 'initiate repair for %truck_id%', 'truck.repair');
  nlp.addDocument('en', 'send repair data for %truck_id%', 'truck.repair');
  
  // Add entities
  nlp.addNerRule('en', 'truck_id', 'regex', /[A-Z]{3}\s?\d{3}[A-Z]?/);
  nlp.addNerRule('en', 'consignor', 'regex', /MOK|GAPCO|HASS/i);
  nlp.addNerRule('en', 'dateRange', 'regex', /yesterday and today|today|yesterday/i);

  // Train the model
  await nlp.train();
  console.log('NLP model trained.');

  return nlp;
}

async function processNlp(text) {
  if (!nlp) {
    await initializeNlp();
  }
  return nlp.process('en', text);
}

export { initializeNlp, processNlp };