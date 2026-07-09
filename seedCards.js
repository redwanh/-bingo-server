require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

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

// 🔥 3 Room Configurations
const ROOM_CARDS = [
  { room: '10 Birr', startId: 10001, endId: 10400, color: '🟢' },
  { room: '20 Birr', startId: 20001, endId: 20400, color: '🟡' },
  { room: '30 Birr', startId: 30001, endId: 30400, color: '🔴' },
];

async function seedFbCards() {
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected\n');

    // Delete existing FB cards
    await FB_Card.deleteMany({});
    console.log('🗑️  Old FB cards deleted\n');

    let totalCreated = 0;

    for (const room of ROOM_CARDS) {
      const count = room.endId - room.startId + 1;
      console.log(`${room.color} Creating ${count} cards for ${room.room} (${room.startId}-${room.endId})...`);
      console.time(`${room.room}`);

      const cards = [];
      for (let i = 0; i < count; i++) {
        cards.push({
          displayId: room.startId + i,
          status: 'available',
          grid: generateGrid(),
        });
      }

      const result = await FB_Card.insertMany(cards, { ordered: false });
      console.timeEnd(`${room.room}`);
      console.log(`   ✅ ${result.length} cards created for ${room.room}\n`);
      totalCreated += result.length;
    }

    // Verify
    const total = await FB_Card.countDocuments();
    console.log('═══════════════════════════════');
    console.log('📊 FB CARDS SUMMARY');
    console.log('═══════════════════════════════');
    console.log(`   Total cards: ${total}`);

    for (const room of ROOM_CARDS) {
      const roomCount = await FB_Card.countDocuments({
        displayId: { $gte: room.startId, $lte: room.endId }
      });
      const sample = await FB_Card.findOne({ displayId: room.startId });
      console.log(`   ${room.color} ${room.room}: ${roomCount} cards | Sample #${room.startId}: ${sample ? '✅ ' + sample.status : '❌ MISSING'}`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

seedFbCards();