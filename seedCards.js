require('dotenv').config();
const mongoose = require('mongoose');

// Use the same connection as the original seeder
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bingo-platform';

// Don't import the Card model from the seed — import it from your actual models
const Card = require('./src/models/Card');

function genCol(min, max) {
  const s = new Set();
  while (s.size < 5) s.add(Math.floor(Math.random() * (max - min + 1)) + min);
  return Array.from(s).map(n => ({ number: n, isMarked: false }));
}

function generateGrid() {
  const c = {
    B: genCol(1, 15),
    I: genCol(16, 30),
    N: genCol(31, 45),
    G: genCol(46, 60),
    O: genCol(61, 75)
  };
  c.N[2] = { number: 0, isMarked: true };
  return c;
}

async function seed() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    console.log('URI:', MONGO_URI.replace(/\/\/.*@/, '//*****@')); // Hide credentials
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Delete all cards
    const deleted = await Card.deleteMany({});
    console.log(`🗑️ Deleted ${deleted.deletedCount} old cards\n`);

    // Generate 400 new cards ONE BY ONE
    console.log('🃏 Generating 400 bingo cards...');
    let created = 0;
    for (let i = 0; i < 400; i++) {
      const grid = generateGrid();
      try {
        await Card.create({
          gameId: null,
          userId: null,
          displayId: 10001 + i,
          cardNumber: i + 1,
          grid,
          price: 10,
          status: 'available',
          isBlocked: false,
          bingoCalled: false,
        });
        created++;
        if ((i + 1) % 100 === 0) console.log(`   ${i + 1}/400 done`);
      } catch (e) {
        console.error(`   ❌ Card ${i + 1} failed:`, e.message);
      }
    }

    console.log(`\n✅ Created ${created} cards (displayId: 10001-${10000 + created})`);

    const total = await Card.countDocuments({ status: 'available' });
    console.log(`📊 Total available cards: ${total}`);

    // Show sample
    const sample = await Card.findOne({ displayId: 10001 });
    if (sample) {
      console.log('\nSample Card #10001:');
      console.log(`  displayId: ${sample.displayId}`);
      console.log(`  status: ${sample.status}`);
      console.log('  B:', sample.grid.B.map(c => c.number).join(', '));
    }

    await mongoose.connection.close();
    console.log('\n👋 Done!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

seed();