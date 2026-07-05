const MainBingoRule = require('../models/MainBingoRule');

const seedRules = [
  // ══════════════════════════════════════
  // 1. 3 Lines - No Interception
  // ══════════════════════════════════════
  {
    name: '3 Lines No Interception',
    nameEnglish: '3 Lines No Interception',
    nameAmharic: '3 መስመር ያለ መገናኘት',
    nameTigrinya: '3 መስመር ብዘይ ምትንኻፍ',
    nameOromo: 'Sarara 3 Walitti Hin Makamne',
    nameChinese: '3条线不相交',
    descriptionEnglish: 'Complete 3 lines that do not share any cells',
    descriptionAmharic: 'የማይገናኙ 3 መስመሮችን ያጠናቅቁ',
    descriptionTigrinya: 'ዘይነቃነቑ 3 መስመራት ኣጠናቕሙ',
    descriptionOromo: 'Sarara 3 walitti hin makamne xumuri',
    descriptionChinese: '完成3条不共享单元格的线',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: false, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 2. 2 Lines Any Direction
  // ══════════════════════════════════════
  {
    name: '2 Lines Any Direction',
    nameEnglish: '2 Lines Any Direction',
    nameAmharic: '2 መስመር በማንኛውም አቅጣጫ',
    nameTigrinya: '2 መስመር ብዝኾነ ኣንፈት',
    nameOromo: 'Sarara 2 Kallattii Kamiyyuu',
    nameChinese: '2条线任意方向',
    descriptionEnglish: 'Complete any 2 lines in any direction',
    descriptionAmharic: 'በማንኛውም አቅጣጫ 2 መስመሮችን ያጠናቅቁ',
    descriptionTigrinya: 'ብዝኾነ ኣንፈት 2 መስመራት ኣጠናቕሙ',
    descriptionOromo: 'Kallattii kamiyyuu sarara 2 xumuri',
    descriptionChinese: '完成任意方向的2条线',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 3. 3 Lines Any Direction
  // ══════════════════════════════════════
  {
    name: '3 Lines Any Direction',
    nameEnglish: '3 Lines Any Direction',
    nameAmharic: '3 መስመር በማንኛውም አቅጣጫ',
    nameTigrinya: '3 መስመር ብዝኾነ ኣንፈት',
    nameOromo: 'Sarara 3 Kallattii Kamiyyuu',
    nameChinese: '3条线任意方向',
    descriptionEnglish: 'Complete any 3 lines in any direction',
    descriptionAmharic: 'በማንኛውም አቅጣጫ 3 መስመሮችን ያጠናቅቁ',
    descriptionTigrinya: 'ብዝኾነ ኣንፈት 3 መስመራት ኣጠናቕሙ',
    descriptionOromo: 'Kallattii kamiyyuu sarara 3 xumuri',
    descriptionChinese: '完成任意方向的3条线',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 4. 3 Lines - Rows Only
  // ══════════════════════════════════════
  {
    name: '3 Lines Rows Only',
    nameEnglish: '3 Lines Rows Only',
    nameAmharic: '3 ረድፍ ብቻ',
    nameTigrinya: '3 መስርዕ ጥራይ',
    nameOromo: 'Tarree 3 Qofa',
    nameChinese: '仅3行',
    descriptionEnglish: 'Complete 3 horizontal rows',
    descriptionAmharic: '3 አግድም ረድፎችን ያጠናቅቁ',
    descriptionTigrinya: '3 ኣግዳሲ መስርዓት ኣጠናቕሙ',
    descriptionOromo: 'Tarree dalgee 3 xumuri',
    descriptionChinese: '完成3个横行',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, minRows: 3, lineDirections: ['horizontal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 5. 3 Lines - Columns Only
  // ══════════════════════════════════════
  {
    name: '3 Lines Columns Only',
    nameEnglish: '3 Lines Columns Only',
    nameAmharic: '3 አምድ ብቻ',
    nameTigrinya: '3 ዓምዲ ጥራይ',
    nameOromo: 'Tarja 3 Qofa',
    nameChinese: '仅3列',
    descriptionEnglish: 'Complete 3 vertical columns',
    descriptionAmharic: '3 ቁመታዊ አምዶችን ያጠናቅቁ',
    descriptionTigrinya: '3 ቀጥታዊ ዓምድታት ኣጠናቕሙ',
    descriptionOromo: 'Tarja dhaabbataa 3 xumuri',
    descriptionChinese: '完成3个竖列',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, minColumns: 3, lineDirections: ['vertical'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 6. T-Pattern Any Direction
  // ══════════════════════════════════════
  {
    name: 'T-Pattern Any Direction',
    nameEnglish: 'T-Pattern Any Direction',
    nameAmharic: 'ቲ-ቅርጽ በማንኛውም አቅጣጫ',
    nameTigrinya: 'ቲ-ቕርጺ ብዝኾነ ኣንፈት',
    nameOromo: 'T-Boca Kallattii Kamiyyuu',
    nameChinese: 'T形任意方向',
    descriptionEnglish: 'Match a T-shape pattern in any orientation (up, down, left, right)',
    descriptionAmharic: 'የቲ ቅርጽ በማንኛውም አቅጣጫ ያዛምዱ',
    descriptionTigrinya: 'ቕርጺ ቲ ብዝኾነ ኣንፈት ኣዛምዱ',
    descriptionOromo: 'Boca T kallattii kamiyyuu walitti qabsiisaa',
    descriptionChinese: '匹配任意方向的T形图案',
    method: 'pattern',
    ruleConfig: { linesToWin: 1, freeSpaceCounts: true, cornersRequired: 0 },
    patterns: [
      // T pointing DOWN (top bar, center column down)
      { name: 'T-Down', cells: [[0,1],[0,2],[0,3],[1,2],[2,2],[3,2],[4,2]] },
      // T pointing UP (center column up, bottom bar)
      { name: 'T-Up', cells: [[0,2],[1,2],[2,2],[3,2],[4,1],[4,2],[4,3]] },
      // T pointing RIGHT (left column, right bar)
      { name: 'T-Right', cells: [[1,0],[1,1],[1,2],[1,3],[1,4],[0,4],[2,4]] },
      // T pointing LEFT (right column, left bar)
      { name: 'T-Left', cells: [[1,0],[1,1],[1,2],[1,3],[1,4],[0,0],[2,0]] },
    ],
  },

  // ══════════════════════════════════════
  // 7. Full House (All Cells)
  // ══════════════════════════════════════
  {
    name: 'Full House',
    nameEnglish: 'Full House',
    nameAmharic: 'ሙሉ ቤት',
    nameTigrinya: 'ምሉእ ቤት',
    nameOromo: 'Mana Guutuu',
    nameChinese: '满堂',
    descriptionEnglish: 'Cover all 24 cells on the card (complete blackout)',
    descriptionAmharic: 'ሁሉንም 24 ሳጥኖች ይሸፍኑ',
    descriptionTigrinya: 'ኩሎም 24 ሳጹናት ሸፍኑ',
    descriptionOromo: 'Saantima 24 hunda guutaa',
    descriptionChinese: '覆盖卡片上所有24个格子',
    method: 'pattern',
    ruleConfig: { linesToWin: 1, freeSpaceCounts: true, cornersRequired: 0 },
    patterns: [{
      name: 'Full House',
      cells: [
        [0,0],[0,1],[0,2],[0,3],[0,4],
        [1,0],[1,1],[1,2],[1,3],[1,4],
        [2,0],[2,1],[2,2],[2,3],[2,4],
        [3,0],[3,1],[3,2],[3,3],[3,4],
        [4,0],[4,1],[4,2],[4,3],[4,4],
      ],
    }],
  },

  // ══════════════════════════════════════
  // 8. Cross Pattern (5x5)
  // ══════════════════════════════════════
  {
    name: 'Cross Pattern',
    nameEnglish: 'Cross Pattern',
    nameAmharic: 'መስቀል ቅርጽ',
    nameTigrinya: 'ቕርጺ መስቀል',
    nameOromo: 'Boca Fannoo',
    nameChinese: '十字形',
    descriptionEnglish: 'Match a cross shape (center row + center column)',
    descriptionAmharic: 'የመስቀል ቅርጽ ያዛምዱ (መካከለኛ ረድፍ + መካከለኛ አምድ)',
    descriptionTigrinya: 'ቕርጺ መስቀል ኣዛምዱ',
    descriptionOromo: 'Boca fannoo walitti qabsiisaa',
    descriptionChinese: '匹配十字形（中间行+中间列）',
    method: 'pattern',
    ruleConfig: { linesToWin: 1, freeSpaceCounts: true, cornersRequired: 0 },
    patterns: [{
      name: 'Cross',
      cells: [
        [2,0],[2,1],[2,2],[2,3],[2,4], // Center row
        [0,2],[1,2],[2,2],[3,2],[4,2], // Center column
      ],
    }],
  },

  // ══════════════════════════════════════
  // 9. Two Diagonals (Large X)
  // ══════════════════════════════════════
  {
    name: 'Two Diagonals X Shape',
    nameEnglish: 'Two Diagonals X Shape',
    nameAmharic: 'ሁለት ሰያፍ ኤክስ ቅርጽ',
    nameTigrinya: 'ክልተ ሰያፍ ኤክስ ቕርጺ',
    nameOromo: 'Diagonaalii Lama Boca X',
    nameChinese: '双对角线X形',
    descriptionEnglish: 'Complete both diagonal lines forming an X',
    descriptionAmharic: 'ኤክስ የሚፈጥሩ ሁለቱንም ሰያፍ መስመሮች ያጠናቅቁ',
    descriptionTigrinya: 'ኤክስ ዝፈጥራ ክልቲአን ሰያፍ መስመራት ኣጠናቕሙ',
    descriptionOromo: 'Sarara diagonaalii lamaan X uuman xumuri',
    descriptionChinese: '完成两条形成X的对角线',
    method: 'rule',
    ruleConfig: {
      linesToWin: 2, minDiagonals: 2, lineDirections: ['diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 10. 4, 5, 7, 8 Lines Any Direction
  // ══════════════════════════════════════
  {
    name: '4 Lines Any Direction',
    nameEnglish: '4 Lines Any Direction',
    nameAmharic: '4 መስመር በማንኛውም አቅጣጫ',
    nameTigrinya: '4 መስመር ብዝኾነ ኣንፈት',
    nameOromo: 'Sarara 4 Kallattii Kamiyyuu',
    nameChinese: '4条线任意方向',
    descriptionEnglish: 'Complete any 4 lines in any direction',
    descriptionAmharic: 'በማንኛውም አቅጣጫ 4 መስመሮችን ያጠናቅቁ',
    method: 'rule',
    ruleConfig: {
      linesToWin: 4, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },
  {
    name: '5 Lines Any Direction',
    nameEnglish: '5 Lines Any Direction',
    nameAmharic: '5 መስመር በማንኛውም አቅጣጫ',
    nameTigrinya: '5 መስመር ብዝኾነ ኣንፈት',
    nameOromo: 'Sarara 5 Kallattii Kamiyyuu',
    nameChinese: '5条线任意方向',
    descriptionEnglish: 'Complete any 5 lines in any direction',
    method: 'rule',
    ruleConfig: {
      linesToWin: 5, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },
  {
    name: '7 Lines Any Direction',
    nameEnglish: '7 Lines Any Direction',
    nameAmharic: '7 መስመር በማንኛውም አቅጣጫ',
    nameTigrinya: '7 መስመር ብዝኾነ ኣንፈት',
    nameOromo: 'Sarara 7 Kallattii Kamiyyuu',
    nameChinese: '7条线任意方向',
    descriptionEnglish: 'Complete any 7 lines in any direction',
    method: 'rule',
    ruleConfig: {
      linesToWin: 7, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },
  {
    name: '8 Lines Any Direction',
    nameEnglish: '8 Lines Any Direction',
    nameAmharic: '8 መስመር በማንኛውም አቅጣጫ',
    nameTigrinya: '8 መስመር ብዝኾነ ኣንፈት',
    nameOromo: 'Sarara 8 Kallattii Kamiyyuu',
    nameChinese: '8条线任意方向',
    descriptionEnglish: 'Complete any 8 lines in any direction',
    method: 'rule',
    ruleConfig: {
      linesToWin: 8, lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 11. 3 Squares
  // ══════════════════════════════════════
  {
    name: '3 Squares',
    nameEnglish: '3 Squares',
    nameAmharic: '3 ካሬዎች',
    nameTigrinya: '3 ካሬታት',
    nameOromo: 'Isquweerii 3',
    nameChinese: '3个方块',
    descriptionEnglish: 'Complete 3 squares (2x2 blocks)',
    descriptionAmharic: '3 ካሬዎችን (2x2) ያጠናቅቁ',
    descriptionTigrinya: '3 ካሬታት (2x2) ኣጠናቕሙ',
    descriptionOromo: 'Isquweerii 3 (2x2) xumuri',
    descriptionChinese: '完成3个方块（2x2）',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, minSquares: 3, squareSize: 2,
      lineDirections: ['square'],
      allowOverlapping: false, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minRectangles: 0,
      rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 12. 1 Row + 1 Column + 1 Diagonal
  // ══════════════════════════════════════
  {
    name: '1 Row 1 Column 1 Diagonal',
    nameEnglish: '1 Row 1 Column 1 Diagonal',
    nameAmharic: '1 ረድፍ 1 አምድ 1 ሰያፍ',
    nameTigrinya: '1 መስርዕ 1 ዓምዲ 1 ሰያፍ',
    nameOromo: 'Tarree 1 Tarja 1 Diagonaalii 1',
    nameChinese: '1行1列1对角线',
    descriptionEnglish: 'Complete exactly 1 row, 1 column, and 1 diagonal',
    descriptionAmharic: 'በትክክል 1 ረድፍ፣ 1 አምድ እና 1 ሰያፍ ያጠናቅቁ',
    descriptionTigrinya: 'ብልክዕ 1 መስርዕ፣ 1 ዓምዲን 1 ሰያፍን ኣጠናቕሙ',
    descriptionOromo: 'Tarree 1, tarja 1, diagonaalii 1 sirriitti xumuri',
    descriptionChinese: '恰好完成1行、1列和1条对角线',
    method: 'rule',
    ruleConfig: {
      linesToWin: 3, minRows: 1, minColumns: 1, minDiagonals: 1,
      lineDirections: ['horizontal', 'vertical', 'diagonal'],
      allowOverlapping: true, freeSpaceCounts: true, cornersRequired: 0,
      minSquares: 0, minRectangles: 0,
      squareSize: 2, rectWidth: 3, rectHeight: 2,
    },
  },

  // ══════════════════════════════════════
  // 13. 2 Lines + 2 Squares No Interception
  // ══════════════════════════════════════
  {
    name: '2 Lines 2 Squares No Touch',
    nameEnglish: '2 Lines 2 Squares No Touch',
    nameAmharic: '2 መስመር 2 ካሬ አይነካኩ',
    nameTigrinya: '2 መስመር 2 ካሬ ኣይንተናኸፉ',
    nameOromo: 'Sarara 2 Isquweerii 2 Wal Hin Tuqin',
    nameChinese: '2线2方块不接触',
    descriptionEnglish: 'Complete 2 lines and 2 squares that do not share any cells',
    descriptionAmharic: 'ምንም ሳጥን የማይጋሩ 2 መስመሮች እና 2 ካሬዎች ያጠናቅቁ',
    descriptionTigrinya: 'ዋላ ሓደ ሳጹን ዘይካፈላ 2 መስመራትን 2 ካሬታትን ኣጠናቕሙ',
    descriptionOromo: 'Sarara 2 fi isquweerii 2 saantima tokko illee hin qoodan xumuri',
    descriptionChinese: '完成2条线和2个不共享任何单元格的方块',
    method: 'rule',
    ruleConfig: {
      linesToWin: 4, minSquares: 2, squareSize: 2,
      lineDirections: ['horizontal', 'vertical', 'diagonal', 'square'],
      allowOverlapping: false, freeSpaceCounts: true, cornersRequired: 0,
      minRows: 0, minColumns: 0, minDiagonals: 0, minRectangles: 0,
      rectWidth: 3, rectHeight: 2,
    },
  },
];

// Seed function
async function seedMainBingoRules() {
  try {
    console.log('🌱 Seeding Main Bingo Rules...');
    
    for (const rule of seedRules) {
      await MainBingoRule.findOneAndUpdate(
        { name: rule.name },
        rule,
        { upsert: true, new: true }
      );
      console.log(`  ✅ ${rule.nameEnglish}`);
    }
    
    console.log(`🎉 Seeded ${seedRules.length} rules successfully!`);
  } catch (error) {
    console.error('❌ Seed error:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  const mongoose = require('mongoose');
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo-platform')
    .then(() => seedMainBingoRules())
    .then(() => mongoose.disconnect())
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seedMainBingoRules, seedRules };