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

  // Greetings (3 examples)
  nlp.addDocument('en', 'hello', 'greetings.hello');
  nlp.addDocument('en', 'hi', 'greetings.hello');
  nlp.addDocument('en', 'hey', 'greetings.hello');

  // Truck Status (4 examples)
  nlp.addDocument('en', 'what is the status of %truck_id%', 'truck.status');
  nlp.addDocument('en', 'check status of %truck_id%', 'truck.status');
  nlp.addDocument('en', 'status for %truck_id%', 'truck.status');
  nlp.addDocument('en', 'get status for %truck_id%', 'truck.status');

  // Truck Query (3 examples)
  nlp.addDocument('en', 'how many %consignor% trucks loaded %dateRange%', 'truck.query');
  nlp.addDocument('en', 'get entries for %truck_id%', 'truck.query');
  nlp.addDocument('en', 'how many %consignor% trucks have left', 'truck.query');

  // Add more training examples for better accuracy
  nlp.addDocument('en', 'good morning', 'greetings.hello');
  nlp.addDocument('en', 'good afternoon', 'greetings.hello');
  nlp.addDocument('en', 'good evening', 'greetings.hello');
  nlp.addDocument('en', 'greetings', 'greetings.hello');

  // More truck status variations
  nlp.addDocument('en', 'where is %truck_id%', 'truck.status');
  nlp.addDocument('en', 'find %truck_id%', 'truck.status');
  nlp.addDocument('en', 'locate %truck_id%', 'truck.status');
  nlp.addDocument('en', 'track %truck_id%', 'truck.status');

  // More truck query variations
  nlp.addDocument('en', 'count %consignor% trucks', 'truck.query');
  nlp.addDocument('en', 'show %consignor% trucks', 'truck.query');
  nlp.addDocument('en', 'list %consignor% vehicles', 'truck.query');

  // Remove all truck repair NLP training - let repair be handled by default parsing
  
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