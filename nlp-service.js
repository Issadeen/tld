
const { dockStart } = require('@nlpjs/core');
const { Nlp } = require('@nlpjs/nlp');
const { LangEn } = require('@nlpjs/lang-en-min');

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

module.exports = { initializeNlp, processNlp };
