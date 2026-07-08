// save as server/scripts/generateFbCards.js and run: node scripts/generateFbCards.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const FB_Card = require('../src/models/FB_Card');

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

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo');
  console.log('✅ DB connected');

  const count = await FB_Card.countDocuments();
  if (count === 400) {
    console.log('✅ 400 FB cards already exist');
    process.exit(0);
  }

  await FB_Card.deleteMany({});
  
  const cards = [];
  for (let i = 0; i < 400; i++) {
    cards.push({
      displayId: 10001 + i,
      status: 'available',
      grid: generateGrid()
    });
  }

  await FB_Card.insertMany(cards);
  console.log(`✅ ${cards.length} FB cards created`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });