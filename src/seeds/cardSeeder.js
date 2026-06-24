require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Card = require('../models/Card');
const CardGenerator = require('../services/cardGenerator');

async function seedCards(count = 10000, startDisplayId = 10000) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected\n');

    await Card.deleteMany({});
    console.log('Cleared old cards\n');

    console.log(`Generating ${count.toLocaleString()} bingo cards...`);
    console.log(`Display IDs: ${startDisplayId} - ${startDisplayId + count - 1}`);
    console.time('Time');

    const BATCH = 500;
    const batches = Math.ceil(count / BATCH);
    let inserted = 0;

    for (let b = 0; b < batches; b++) {
      const cards = [];
      const start = b * BATCH + 1;
      const end = Math.min((b + 1) * BATCH, count);

      for (let i = start; i <= end; i++) {
        const card = CardGenerator.generateCard(i);
        card.displayId = startDisplayId + i - 1; // ← ADD DISPLAY ID STARTING FROM 10000
        cards.push(card);
      }

      await Card.insertMany(cards, { ordered: false });
      inserted += cards.length;
      console.log(`   ${inserted.toLocaleString()}/${count.toLocaleString()} (${Math.round(inserted/count*100)}%)`);
    }

    console.timeEnd('Time');
    console.log(`\n✅ ${inserted.toLocaleString()} cards in database!`);

    // Show sample
    const sample = await Card.findOne({ serialNumber: 1 });
    console.log('\nSample Card #1:');
    console.log(`  displayId: ${sample.displayId}`);
    console.log(`  cardId: ${sample.cardId}`);
    console.log(CardGenerator.displayCard(sample.grid));

    // Show another sample to verify displayId
    const sample2 = await Card.findOne({ serialNumber: 100 });
    if (sample2) {
      console.log('\nSample Card #100:');
      console.log(`  displayId: ${sample2.displayId}`);
      console.log(`  cardId: ${sample2.cardId}`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

const count = parseInt(process.argv[2]) || 10000;
const startId = parseInt(process.argv[3]) || 10000; // ← Custom start ID
seedCards(count, startId);