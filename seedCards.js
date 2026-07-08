require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

// Try all possible env variable names
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI || process.env.DATABASE_URL;

if (!uri) {
  console.error('❌ No MongoDB URI found. Check your .env file.');
  console.log('Available env vars containing MONGO:');
  Object.keys(process.env).filter(k => k.includes('MONGO') || k.includes('DB') || k.includes('DATABASE')).forEach(k => {
    console.log(`  ${k}=${process.env[k]}`);
  });
  process.exit(1);
}

const FB_Card = require('./src/models/FB_Card');

const ranges = { B: [1,15], I: [16,30], N: [31,45], G: [46,60], O: [61,75] };

function generateGrid() {
  const grid = {};
  for (const [col, [min, max]] of Object.entries(ranges)) {
    const set = new Set();
    while (set.size < 5) {
      set.add(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    grid[col] = Array.from(set).map(n => ({ number: n, isMarked: false }));
  }
  grid.N[2] = { number: 0, isMarked: true };
  return grid;
}

async function seedFbCards() {
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected\n');

    await FB_Card.deleteMany({});
    console.log('🗑️  Old FB cards deleted\n');

    const startId = 10001;
    const endId = 10400;

    console.log(`📦 Creating 400 FB cards (${startId}-${endId})...`);
    console.time('FB Cards');

    const cards = [];
    for (let i = 0; i < 400; i++) {
      cards.push({
        displayId: startId + i,
        status: 'available',
        grid: generateGrid(),
      });
    }

    const result = await FB_Card.insertMany(cards, { ordered: false });
    console.timeEnd('FB Cards');
    console.log(`✅ ${result.length} FB cards created!\n`);

    const count = await FB_Card.countDocuments();
    const sample = await FB_Card.findOne({ displayId: 10001 });
    console.log(`   Total: ${count}`);
    console.log(`   Sample #10001: ${sample ? `✅ (status: ${sample.status})` : '❌ MISSING'}`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

seedFbCards();