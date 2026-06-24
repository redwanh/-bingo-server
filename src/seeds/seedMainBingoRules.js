require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const MainBingoRule = require('../models/MainBingoRule');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo';

const seedRules = [
  // ============================================
  // 1. BASIC LINE RULES
  // ============================================
  {
    name: 'አንድ መስመር ነፃ ሳይጨምር',
    description: 'One line without free space',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, minRows: 0, minColumns: 0, minDiagonals: 0,
      freeSpaceCounts: false, freeSpaceCountsForLines: false, freeSpaceBlocked: true,
      lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'አንድ መስመር ነፃ ጨምሮ',
    description: 'One line with free space counting',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, minRows: 0, minColumns: 0, minDiagonals: 0,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'ሁለት መስመር',
    description: 'Any two lines (Double Bingo)',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, minRows: 0, minColumns: 0, minDiagonals: 0,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'ሶስት መስመር',
    description: 'Any three lines (Triple Bingo)',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, minRows: 0, minColumns: 0, minDiagonals: 0,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 2. EXACT COUNT RULES
  // ============================================
  {
    name: 'በትክክል ሁለት ረድፍ',
    description: 'Exactly 2 rows, no more no less',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, exactRows: 2, exactColumns: 0, exactDiagonals: 0,
      maxColumns: 0, maxDiagonals: 0, freeSpaceCounts: true,
      lineDirections: ['horizontal'], allowOverlapping: true
    }
  },
  {
    name: 'በትክክል ሁለት አምድ',
    description: 'Exactly 2 columns',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, exactColumns: 2, exactRows: 0, exactDiagonals: 0,
      maxRows: 0, maxDiagonals: 0, freeSpaceCounts: true,
      lineDirections: ['vertical'], allowOverlapping: true
    }
  },
  {
    name: 'በትክክል አንድ ረድፍ አንድ አምድ',
    description: 'Exactly 1 row and 1 column',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, exactRows: 1, exactColumns: 1, exactDiagonals: 0,
      maxDiagonals: 0, freeSpaceCounts: true,
      lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 3. COMBINATION RULES
  // ============================================
  {
    name: 'ሁለት ረድፍ አንድ አምድ',
    description: '2 rows AND 1 column combination',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3,
      requiredCombination: { rows: 2, columns: 1 },
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  },
  {
    name: 'አንድ ረድፍ ሁለት አምድ',
    description: '1 row AND 2 columns combination',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3,
      requiredCombination: { rows: 1, columns: 2 },
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  },
  {
    name: 'ረድፍ አምድ ዳያጎናል ሶስቱም',
    description: 'Must have all three: row, column, diagonal',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, mustHaveAllTypes: true,
      minRows: 1, minColumns: 1, minDiagonals: 1,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 4. INTERSECTION RULES
  // ============================================
  {
    name: 'መስመሮች መገናኘት አለባቸው',
    description: 'All lines must intersect at a common point',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, linesMustIntersect: true,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'መሀል ላይ ተገናኝተው',
    description: 'Lines must cross at center (free space)',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, linesMustIntersect: true,
      intersectionPoint: { row: 2, col: 2 },
      freeSpaceCounts: true, freeSpaceRequiredForWin: true,
      lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'መስመሮች አይነካኩ',
    description: 'Lines must NOT touch each other',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, linesMustNotIntersect: true,
      requireUniqueLines: true, allowOverlapping: false, sharedCellsLimit: 0,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical']
    }
  },
  
  // ============================================
  // 5. FREE SPACE RULES
  // ============================================
  {
    name: 'ነፃ ቦታ ግዴታ',
    description: 'Free space MUST be part of winning line',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, freeSpaceCounts: true, freeSpaceRequiredForWin: true,
      lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'ነፃ ቦታ አይቆጠርም',
    description: 'Free space blocked, must mark center cell',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, freeSpaceCounts: false, freeSpaceBlocked: true,
      freeSpaceCountsForLines: false,
      lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 6. OVERLAPPING RULES
  // ============================================
  {
    name: 'ያለመደራረብ ሶስት መስመር',
    description: '3 lines with NO cell sharing',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, allowOverlapping: false, requireUniqueLines: true,
      sharedCellsLimit: 0, freeSpaceCounts: true,
      lineDirections: ['horizontal','vertical','diagonal']
    }
  },
  {
    name: 'ቢበዛ አንድ መደራረብ',
    description: 'Lines can share maximum 1 cell',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, allowOverlapping: true, sharedCellsLimit: 1,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal']
    }
  },
  
  // ============================================
  // 7. DIRECTION RULES
  // ============================================
  {
    name: 'ረድፍ ብቻ',
    description: 'Horizontal lines only',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, exclusiveLines: 'rows',
      lineDirections: ['horizontal'], prohibitedDirections: ['vertical','diagonal'],
      maxColumns: 0, maxDiagonals: 0, freeSpaceCounts: true
    }
  },
  {
    name: 'አምድ ብቻ',
    description: 'Vertical lines only',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, exclusiveLines: 'columns',
      lineDirections: ['vertical'], prohibitedDirections: ['horizontal','diagonal'],
      maxRows: 0, maxDiagonals: 0, freeSpaceCounts: true
    }
  },
  {
    name: 'ዳያጎናል ግዴታ',
    description: 'Must include at least 1 diagonal',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, requiredDirections: ['diagonal'], minDiagonals: 1,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 8. SPECIFIC LINE RULES
  // ============================================
  {
    name: 'የላይኛው ረድፍ ግዴታ',
    description: 'Top row MUST be one of the winning lines',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, specificLines: { topRow: true }, minRows: 1,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'አራት ማዕዘን',
    description: 'Must have all 4 corners (border frame)',
    method: 'rule',
    ruleConfig: {
      linesToWin: 4,
      specificLines: { topRow: true, bottomRow: true, leftColumn: true, rightColumn: true },
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  },
  {
    name: 'ዋናው ዳያጎናል ግዴታ',
    description: 'Main diagonal (top-left to bottom-right) must be complete',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, specificLines: { mainDiagonal: true }, minDiagonals: 1,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 9. MAX LIMIT RULES
  // ============================================
  {
    name: 'ከሶስት መስመር አይበልጥ',
    description: 'Maximum 3 lines total',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, maxRows: 3, maxColumns: 3, maxDiagonals: 2,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'ቢበዛ ሁለት ረድፍ አንድ አምድ',
    description: 'Max 2 rows and max 1 column',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, maxRows: 2, maxColumns: 1, maxDiagonals: 0,
      requiredCombination: { rows: 1, columns: 1 },
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 10. COMPLEX RULES
  // ============================================
  {
    name: 'ሁለት ረድፍ ሁለት አምድ አንድ ዳያጎናል',
    description: '2 rows, 2 columns, and 1 diagonal',
    method: 'rule',
    ruleConfig: {
      linesToWin: 5,
      requiredCombination: { rows: 2, columns: 2, diagonals: 1 },
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'አምስት መስመር ያለመደራረብ',
    description: '5 unique lines with no overlapping',
    method: 'rule',
    ruleConfig: {
      linesToWin: 5, allowOverlapping: false, requireUniqueLines: true,
      sharedCellsLimit: 0, freeSpaceCounts: true,
      lineDirections: ['horizontal','vertical','diagonal']
    }
  },
  {
    name: 'ሶስት ረድፍ መሀል ላይ ተገናኝተው',
    description: '3 rows all intersecting at center',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, exactRows: 3, exactColumns: 0, exactDiagonals: 0,
      linesMustIntersect: true, intersectionPoint: { row: 2, col: 2 },
      freeSpaceRequiredForWin: true, lineDirections: ['horizontal'], freeSpaceCounts: true
    }
  },
  
  // ============================================
  // 11. CORNER & SPECIAL
  // ============================================
  {
    name: 'አራት ማዕዘን ግዴታ',
    description: 'All 4 corners must be marked',
    method: 'rule',
    ruleConfig: {
      linesToWin: 1, cornersRequired: true,
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical','diagonal'], allowOverlapping: true
    }
  },
  {
    name: 'መስቀል ንድፍ',
    description: 'Cross pattern (center row + center column)',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2,
      specificLines: { centerRow: true, centerColumn: true },
      linesMustIntersect: true, intersectionPoint: { row: 2, col: 2 },
      freeSpaceCounts: true, freeSpaceRequiredForWin: true,
      lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  },
  
  // ============================================
  // 12. FULL HOUSE
  // ============================================
  {
    name: 'ሙሉ ቤት ያለ ነፃ',
    description: 'Full house - all cells marked without free space',
    method: 'rule',
    ruleConfig: {
      linesToWin: 5, minCellsMarked: 25,
      freeSpaceCounts: false, freeSpaceBlocked: true,
      lineDirections: ['horizontal'], allowOverlapping: true, exactRows: 5
    }
  },
  {
    name: 'ሙሉ ቤት ነፃ ጨምሮ',
    description: 'Full house with free space counting',
    method: 'rule',
    ruleConfig: {
      linesToWin: 5, minCellsMarked: 24, exactRows: 5,
      freeSpaceCounts: true, lineDirections: ['horizontal'], allowOverlapping: true
    }
  },
  {
    name: 'ኤክስ ንድፍ ብቻ',
    description: 'X pattern - both diagonals only',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, exactDiagonals: 2, exactRows: 0, exactColumns: 0,
      maxRows: 0, maxColumns: 0, freeSpaceCounts: true,
      lineDirections: ['diagonal'], exclusiveLines: 'diagonals'
    }
  },
  {
    name: 'ቲ ንድፍ',
    description: 'T pattern - top row + center column',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2,
      specificLines: { topRow: true, centerColumn: true },
      linesMustIntersect: true, intersectionPoint: { row: 0, col: 2 },
      freeSpaceCounts: true, lineDirections: ['horizontal','vertical'], allowOverlapping: true
    }
  }
];

async function seedMainBingoRules() {
  try {
    console.log('📦 Connecting to MongoDB...');
    console.log(`   URI: ${MONGODB_URI}`);
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Count existing rules
    const existingCount = await MainBingoRule.countDocuments();
    console.log(`📊 Existing rules: ${existingCount}`);
    
    // Clear existing rules
    if (existingCount > 0) {
      await MainBingoRule.deleteMany({});
      console.log('🗑  Cleared existing rules');
    }
    
    // Insert seed data
    console.log('🌱 Seeding rules...');
    const rules = await MainBingoRule.insertMany(seedRules);
    console.log(`✅ Successfully seeded ${rules.length} rules!\n`);
    
    // Print summary
    console.log('📋 SEEDED RULES SUMMARY:');
    console.log('═'.repeat(60));
    rules.forEach((rule, i) => {
      const cfg = rule.ruleConfig;
      console.log(`${i + 1}. ${rule.name}`);
      console.log(`   ${rule.description}`);
      console.log(`   Lines:${cfg.linesToWin} | Rows:${cfg.minRows || cfg.exactRows || 0} | Cols:${cfg.minColumns || cfg.exactColumns || 0} | Diags:${cfg.minDiagonals || cfg.exactDiagonals || 0}`);
      console.log(`   Free:${cfg.freeSpaceCounts !== false ? 'Yes' : 'No'} | Overlap:${cfg.allowOverlapping !== false ? 'Yes' : 'No'} | Intersect:${cfg.linesMustIntersect ? 'Yes' : 'No'}`);
      console.log('');
    });
    
    console.log('═'.repeat(60));
    console.log('✅ SEED COMPLETE!');
    console.log('═'.repeat(60));
    
  } catch (error) {
    console.error('❌ SEED FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed');
    process.exit(0);
  }
}

// Run the seeder
seedMainBingoRules();