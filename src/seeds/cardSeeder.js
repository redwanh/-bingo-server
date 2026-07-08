require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Card = require('../models/Card');
const CardGenerator = require('../services/cardGenerator');

async function seedCards() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected\n');

    const existingCount = await Card.countDocuments();
    console.log(`Existing cards in DB: ${existingCount.toLocaleString()}\n`);

    // ══════════════════════════════════════
    // BATCH 1: Create cards 10001-10400 with status 'available'
    // ══════════════════════════════════════
    const availableStart = 10001;  // Changed from 10000
    const availableEnd = 10400;
    const availableCount = availableEnd - availableStart + 1;  // 400 cards
    
    console.log(`📦 Creating ${availableCount} cards (${availableStart}-${availableEnd}) with status: available`);
    console.time('Available Cards');

    const availableCards = [];
    for (let i = availableStart; i <= availableEnd; i++) {
      const card = CardGenerator.generateCard(i - availableStart + 1);
      card.displayId = i;
      card.cardNumber = i - availableStart + 1;
      card.status = 'available';
      card.userId = null;
      card.gameId = null;
      availableCards.push(card);
    }

    await Card.insertMany(availableCards, { ordered: false });
    console.timeEnd('Available Cards');
    console.log(`✅ ${availableCount} available cards created!\n`);

    // ══════════════════════════════════════
    // BATCH 2: Create cards 20000-21000 with status 'preview'
    // ══════════════════════════════════════
    const previewStart = 20000;
    const previewEnd = 21000;  // Changed from 29999
    const previewCount = previewEnd - previewStart + 1;  // 1001 cards
    
    console.log(`📦 Creating ${previewCount.toLocaleString()} cards (${previewStart}-${previewEnd}) with status: preview`);
    console.time('Preview Cards');

    const BATCH = 500;
    const batches = Math.ceil(previewCount / BATCH);
    let inserted = 0;

    for (let b = 0; b < batches; b++) {
      const cards = [];
      const start = b * BATCH + 1;
      const end = Math.min((b + 1) * BATCH, previewCount);

      for (let i = start; i <= end; i++) {
        const card = CardGenerator.generateCard(i);
        card.displayId = previewStart + i - 1;
        card.cardNumber = i;
        card.status = 'preview';
        card.userId = null;
        card.gameId = null;
        cards.push(card);
      }

      await Card.insertMany(cards, { ordered: false });
      inserted += cards.length;
      console.log(`   ${inserted.toLocaleString()}/${previewCount.toLocaleString()} (${Math.round(inserted/previewCount*100)}%)`);
    }

    console.timeEnd('Preview Cards');
    console.log(`✅ ${previewCount.toLocaleString()} preview cards created!\n`);

    // ══════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════
    const totalAfter = await Card.countDocuments();
    const availableTotal = await Card.countDocuments({ status: 'available' });
    const previewTotal = await Card.countDocuments({ status: 'preview' });
    
    console.log('═══════════════════════════════');
    console.log('📊 DATABASE SUMMARY');
    console.log('═══════════════════════════════');
    console.log(`   Total cards:    ${totalAfter.toLocaleString()}`);
    console.log(`   Available:      ${availableTotal.toLocaleString()}`);
    console.log(`   Preview:        ${previewTotal.toLocaleString()}`);
    console.log(`   New available:  ${availableCount} (IDs ${availableStart}-${availableEnd})`);
    console.log(`   New preview:    ${previewCount.toLocaleString()} (IDs ${previewStart}-${previewEnd})`);

    // Sample available card
    const sampleAvail = await Card.findOne({ displayId: 10001 });
    if (sampleAvail) {
      console.log(`\n📋 Sample Available Card #10001:`);
      console.log(`   _id: ${sampleAvail._id}`);
      console.log(`   displayId: ${sampleAvail.displayId}`);
      console.log(`   status: ${sampleAvail.status}`);
      console.log(`   userId: ${sampleAvail.userId || 'null'}`);
    }

    // Sample preview card
    const samplePrev = await Card.findOne({ displayId: 20001 });
    if (samplePrev) {
      console.log(`\n📋 Sample Preview Card #20001:`);
      console.log(`   _id: ${samplePrev._id}`);
      console.log(`   displayId: ${samplePrev.displayId}`);
      console.log(`   status: ${samplePrev.status}`);
      console.log(`   userId: ${samplePrev.userId || 'null'}`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

seedCards();