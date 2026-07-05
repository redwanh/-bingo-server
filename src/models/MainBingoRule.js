const mongoose = require('mongoose');

const sampleSchema = new mongoose.Schema({
  markedCells: [[Number]],
  isValid: Boolean,
  details: {
    rowsFound: Number,
    colsFound: Number,
    diagsFound: Number,
    squaresFound: Number,
    rectanglesFound: Number,
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
  method: { type: String, enum: ['rule', 'pattern','mixed'], required: true },
  
  // Multi-language names
  nameAmharic: { type: String, default: '' },
  nameTigrinya: { type: String, default: '' },
  nameOromo: { type: String, default: '' },
  nameChinese: { type: String, default: '' },
  nameEnglish: { type: String, default: '' },
  
  // Multi-language descriptions
  descriptionAmharic: { type: String, default: '' },
  descriptionTigrinya: { type: String, default: '' },
  descriptionOromo: { type: String, default: '' },
  descriptionChinese: { type: String, default: '' },
  descriptionEnglish: { type: String, default: '' },
  
  ruleConfig: {
    // CORE
    linesToWin: { type: Number, default: 1 },
    minRows: { type: Number, default: 0 },
    minColumns: { type: Number, default: 0 },
    minDiagonals: { type: Number, default: 0 },

    // SQUARE COUNTS
    minSquares: { type: Number, default: 0 },
    exactSquares: { type: Number, default: null },
    maxSquares: { type: Number, default: null },
    squareMinSize: { type: Number, default: 2 },
    squareMaxSize: { type: Number, default: 5 },
    
    // RECTANGLE COUNTS
    minRectangles: { type: Number, default: 0 },
    exactRectangles: { type: Number, default: null },
    maxRectangles: { type: Number, default: null },
    rectMinWidth: { type: Number, default: 2 },
    rectMaxWidth: { type: Number, default: 5 },
    rectMinHeight: { type: Number, default: 2 },
    rectMaxHeight: { type: Number, default: 5 },
    
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
      diagonals: { type: Number, default: null },
      squares: { type: Number, default: null },
      rectangles: { type: Number, default: null }
    },
    mustHaveAllTypes: { type: Boolean, default: false },
    exclusiveLines: { type: String, default: null },
    
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
    lineDirections: [{ type: String, enum: ['horizontal', 'vertical', 'diagonal', 'square', 'rectangle'] }],
    requiredDirections: [{ type: String, enum: ['horizontal', 'vertical', 'diagonal', 'square', 'rectangle'] }],
    prohibitedDirections: [{ type: String, enum: ['horizontal', 'vertical', 'diagonal', 'square', 'rectangle'] }],
    
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
    touchingType: { type: String, default: null },
    parallelLinesAllowed: { type: Boolean, default: true },
    perpendicularLinesRequired: { type: Boolean, default: false }
  },
  
  patterns: [{
    name: { type: String },
    cells: [[Number]]
  }],
  // Mixed rules for 'mixed' method
mixedRules: [{
  type: { type: String, enum: ['count', 'pattern'] },
  countConfig: {
    linesToWin: { type: Number, default: 1 },
    minRows: { type: Number, default: 0 },
    minColumns: { type: Number, default: 0 },
    minDiagonals: { type: Number, default: 0 },
    minSquares: { type: Number, default: 0 },
    minRectangles: { type: Number, default: 0 },
    squareSize: { type: Number, default: 2 },
    rectWidth: { type: Number, default: 3 },
    rectHeight: { type: Number, default: 2 },
    lineDirections: [{ type: String }],
    allowOverlapping: { type: Boolean, default: true },
    freeSpaceCounts: { type: Boolean, default: true },
    cornersRequired: { type: Number, default: 0 },
  },
  patternIndex: { type: Number, default: 0 },
  interception: { type: String, enum: ['canIntercept', 'mustIntercept', 'noInterception'], default: 'canIntercept' },
}],
  
  samples: {
    wins: [sampleSchema],
    losses: [sampleSchema]
  },
  
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('MainBingoRule', mainBingoRuleSchema);