const mongoose = require('mongoose');

const sampleSchema = new mongoose.Schema({
  markedCells: [[Number]],
  isValid: Boolean,
  details: {
    rowsFound: Number,
    colsFound: Number,
    diagsFound: Number,
    totalLines: Number,
    totalMarked: Number,
    cornersOk: Boolean,
    patternName: String,
    intersections: Number,
    uniqueLines: Number,
    overlappingCells: Number
  },
  timestamp: { type: Date, default: Date.now }
});

const mainBingoRuleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  method: { type: String, enum: ['rule', 'pattern'], required: true },
  
  ruleConfig: {
    // CORE
    linesToWin: { type: Number, default: 1 },
    minRows: { type: Number, default: 0 },
    minColumns: { type: Number, default: 0 },
    minDiagonals: { type: Number, default: 0 },
    
    // EXACT COUNTS
    exactRows: { type: Number, default: null },
    exactColumns: { type: Number, default: null },
    exactDiagonals: { type: Number, default: null },
    maxRows: { type: Number, default: null },
    maxColumns: { type: Number, default: null },
    maxDiagonals: { type: Number, default: null },
    
    // COMBINATION
    requiredCombination: {
      rows: { type: Number, default: null },
      columns: { type: Number, default: null },
      diagonals: { type: Number, default: null }
    },
    mustHaveAllTypes: { type: Boolean, default: false },
    exclusiveLines: { type: String, default: null }, // 'rows', 'columns', 'diagonals'
    
    // INTERSECTION
    linesMustIntersect: { type: Boolean, default: false },
    linesMustNotIntersect: { type: Boolean, default: false },
    intersectionPoint: {
      row: { type: Number, default: null },
      col: { type: Number, default: null }
    },
    minIntersections: { type: Number, default: null },
    maxIntersections: { type: Number, default: null },
    
    // FREE SPACE
    freeSpaceCounts: { type: Boolean, default: true },
    freeSpaceCountsForLines: { type: Boolean, default: true },
    freeSpaceRequiredForWin: { type: Boolean, default: false },
    freeSpaceBlocked: { type: Boolean, default: false },
    additionalFreeSpaces: [[Number]],
    
    // LINE QUALITY
    allowOverlapping: { type: Boolean, default: true },
    requireUniqueLines: { type: Boolean, default: false },
    sharedCellsLimit: { type: Number, default: null },
    
    // DIRECTION
    lineDirections: [{ type: String, enum: ['horizontal', 'vertical', 'diagonal'] }],
    requiredDirections: [{ type: String }],
    prohibitedDirections: [{ type: String }],
    
    // SPECIAL
    cornersRequired: { type: Boolean, default: false },
    minCellsMarked: { type: Number, default: null },
    specificLines: {
      topRow: { type: Boolean, default: false },
      bottomRow: { type: Boolean, default: false },
      leftColumn: { type: Boolean, default: false },
      rightColumn: { type: Boolean, default: false },
      centerRow: { type: Boolean, default: false },
      centerColumn: { type: Boolean, default: false },
      mainDiagonal: { type: Boolean, default: false },
      antiDiagonal: { type: Boolean, default: false }
    },
    
    // LINE TOUCHING
    linesCanTouch: { type: Boolean, default: true },
    touchingType: { type: String, default: null }, // 'adjacent', 'parallel', 'perpendicular', 'any'
    parallelLinesAllowed: { type: Boolean, default: true },
    perpendicularLinesRequired: { type: Boolean, default: false }
  },
  
  patterns: [{
    name: { type: String },
    cells: [[Number]]
  }],
  
  samples: {
    wins: [sampleSchema],
    losses: [sampleSchema]
  },
  
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('MainBingoRule', mainBingoRuleSchema);