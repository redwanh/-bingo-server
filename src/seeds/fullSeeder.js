require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Card = require('../models/Card');
const CardGenerator = require('../services/cardGenerator');

async function seedAll() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected\n');

    // ============================================
    // 1. CLEAR ALL DATA
    // ============================================
    console.log('🗑️  Clearing old data...');
    await Promise.all([
      User.deleteMany({}),
      Card.deleteMany({})
    ]);
    console.log('   Done\n');

    // ============================================
    // 2. CREATE USERS (using create() for EACH to trigger password hashing)
    // ============================================
    console.log('👤 Creating users...\n');

    // Super Admin
    await User.create({
      phone: '+251900000000',
      password: 'Admin@1234',
      fullName: 'Super Admin',
      username: 'admin',
      role: 'superadmin',
      isActive: true,
      isVerified: true,
      walletBalance: 10000
    });
    console.log('   ✅ Super Admin: +251900000000 / Admin@1234');

    // Regular Admin
    await User.create({
      phone: '+251900000001',
      password: 'Admin@1234',
      fullName: 'Game Admin',
      username: 'gameadmin',
      role: 'admin',
      isActive: true,
      isVerified: true,
      walletBalance: 5000
    });
    console.log('   ✅ Admin: +251900000001 / Admin@1234');

    // Test Users (20 players) - Use create() for EACH to trigger hashing
    const names = [
      'Abebe Kebede', 'Tigist Haile', 'Dawit Mengistu', 'Selam Tesfaye',
      'Bruk Alemu', 'Meron Girma', 'Yonas Tadesse', 'Hanna Worku',
      'Ermias Desta', 'Bethelhem Assefa', 'Kaleb Wolde', 'Liya Bekele',
      'Natnael Tekle', 'Ruth Yohannes', 'Solomon Dereje', 'Sara Fikre',
      'Mikael Habte', 'Rebeka Tilahun', 'Daniel Getachew', 'Marta Ayele'
    ];

    for (let i = 0; i < 20; i++) {
      await User.create({
        phone: `+2519100000${i.toString().padStart(2, '0')}`,
        password: 'Test@1234',
        fullName: names[i],
        username: `player${i + 1}`,
        role: 'user',
        isActive: i < 18,
        isVerified: true,
        walletBalance: Math.floor(Math.random() * 5000) + 100
      });
    }
    console.log('   ✅ 20 Test Players: +251910000000 to +251910000019 / Test@1234\n');

    // ============================================
    // 3. CREATE BINGO CARDS (10,000)
    // ============================================
    console.log('🎴 Generating 10,000 Bingo Cards...');
    console.time('Card Generation');

    const CARD_COUNT = 10000;
    const BATCH = 500;
    const batches = Math.ceil(CARD_COUNT / BATCH);
    let inserted = 0;

    for (let b = 0; b < batches; b++) {
      const cards = [];
      const start = b * BATCH + 1;
      const end = Math.min((b + 1) * BATCH, CARD_COUNT);

      for (let i = start; i <= end; i++) {
        cards.push(CardGenerator.generateCard(i));
      }

      await Card.insertMany(cards, { ordered: false });
      inserted += cards.length;
      
      const pct = Math.round(inserted / CARD_COUNT * 100);
      const bar = '█'.repeat(pct / 2) + '░'.repeat(50 - pct / 2);
      process.stdout.write(`\r   [${bar}] ${pct}% (${inserted.toLocaleString()} cards)`);
    }

    console.timeEnd('Card Generation');
    console.log(`   ✅ ${inserted.toLocaleString()} cards generated\n`);

    // ============================================
    // 4. VERIFY PASSWORDS ARE HASHED
    // ============================================
    console.log('🔐 Verifying passwords...');
    const sampleUsers = await User.find().limit(3).select('+password');
    for (const u of sampleUsers) {
      const isHashed = u.password.startsWith('$2a$') || u.password.startsWith('$2b$');
      console.log(`   ${u.phone}: ${isHashed ? '✅ HASHED' : '❌ NOT HASHED'} (${u.password.substring(0, 20)}...)`);
    }
    console.log('');

    // ============================================
    // 5. SHOW SUMMARY
    // ============================================
    const [userCount, cardCount, adminCount, activeCount] = await Promise.all([
      User.countDocuments(),
      Card.countDocuments(),
      User.countDocuments({ role: { $in: ['admin', 'superadmin'] } }),
      User.countDocuments({ isActive: true })
    ]);

    const sample = await Card.findOne({ serialNumber: 1 });

    console.log('═══════════════════════════════════════');
    console.log('  📊 SEED SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`  Total Users:    ${userCount}`);
    console.log(`  Active Users:   ${activeCount}`);
    console.log(`  Admins:         ${adminCount}`);
    console.log(`  Total Cards:    ${cardCount.toLocaleString()}`);
    console.log('═══════════════════════════════════════\n');

    console.log('📋 LOGIN CREDENTIALS:');
    console.log('─────────────────────────────────────');
    console.log('  Super Admin:');
    console.log('    Phone:    +251900000000');
    console.log('    Password: Admin@1234');
    console.log('    Role:     superadmin\n');
    console.log('  Game Admin:');
    console.log('    Phone:    +251900000001');
    console.log('    Password: Admin@1234');
    console.log('    Role:     admin\n');
    console.log('  Test Players (20):');
    console.log('    Phone:    +251910000000 to +251910000019');
    console.log('    Password: Test@1234');
    console.log('    Role:     user\n');

    console.log('🎴 SAMPLE CARD (#1):');
    console.log(CardGenerator.displayCard(sample.grid));

    console.log('✅ SEED COMPLETE!\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeder error:', error.message);
    process.exit(1);
  }
}

seedAll();