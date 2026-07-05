const MainBingoRule = require('../models/MainBingoRule');

// ══════════════════════════════════════
// CRUD
// ══════════════════════════════════════

exports.getAllRules = async (req, res) => {
  try {
    const rules = await MainBingoRule.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, rules });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, rule });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.createRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.create({ ...req.body, createdBy: req.user.id });
    res.status(201).json({ success: true, rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.updateRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.deleteRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ══════════════════════════════════════
// TEST
// ══════════════════════════════════════

exports.testRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    const { markedCells } = req.body;
    if (!markedCells || !Array.isArray(markedCells)) {
      return res.status(400).json({ error: 'markedCells required' });
    }
    
    const result = validateRule(rule, markedCells);
    res.json({ success: true, result: { ...result, markedCells, ruleName: rule.name, method: rule.method } });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

// ══════════════════════════════════════
// SAMPLES
// ══════════════════════════════════════

exports.getSamples = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, samples: rule.samples || { wins: [], losses: [] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.saveSample = async (req, res) => {
  try {
    const { type, sample } = req.body;
    if (!type || !['win', 'loss'].includes(type)) return res.status(400).json({ error: 'Type must be win or loss' });
    
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    if (!rule.samples) rule.samples = { wins: [], losses: [] };
    
    const sampleData = {
      markedCells: sample.markedCells,
      isValid: sample.isValid !== undefined ? sample.isValid : (type === 'win'),
      details: sample.details || {},
      timestamp: new Date()
    };
    
    if (type === 'win') rule.samples.wins.push(sampleData);
    else rule.samples.losses.push(sampleData);
    
    await rule.save();
    res.json({ success: true, message: `${type} sample saved`, samples: rule.samples });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.removeSample = async (req, res) => {
  try {
    const { type, index } = req.params;
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    const idx = parseInt(index);
    if (rule.samples && rule.samples[type] && idx >= 0 && idx < rule.samples[type].length) {
      rule.samples[type].splice(idx, 1);
      await rule.save();
    }
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.clearSamples = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    rule.samples = { wins: [], losses: [] };
    await rule.save();
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

// ══════════════════════════════════════
// VALIDATION ENGINE
// ══════════════════════════════════════

function validateRule(rule, markedCells) {
  const cfg = rule.ruleConfig || {};
  const markedSet = new Set(markedCells.map(c => `${c[0]},${c[1]}`));
  
  // Build effective set
  let effectiveSet = new Set(markedSet);
  
  // Only add FREE space if explicitly enabled
  if (cfg.freeSpaceCounts === true) {
    effectiveSet.add('2,2');
  }
  // If freeSpaceCounts is false, REMOVE free cell even if manually clicked
  if (cfg.freeSpaceCounts === false) {
    effectiveSet.delete('2,2');
  }
  
  if (rule.method === 'pattern') return validatePattern(rule, effectiveSet);
  if (rule.method === 'mixed') return validateMixed(rule, effectiveSet, markedCells);
  return validateCountBased(rule, effectiveSet, markedCells);
}

function validateCountBased(rule, effectiveSet, markedCells) {
  const cfg = rule.ruleConfig || {};
  
  // Get ALL completed shapes
  const allShapes = findAllShapes(effectiveSet, cfg);
  
  // If no overlapping allowed, filter to non-overlapping shapes
  let validShapes = allShapes;
  
  if (cfg.allowOverlapping === false) {
    validShapes = filterNonOverlapping(allShapes);
  }
  
  // Count by type from valid shapes
  const rowsFound = validShapes.filter(s => s.type === 'horizontal').length;
  const colsFound = validShapes.filter(s => s.type === 'vertical').length;
  const diagsFound = validShapes.filter(s => s.type === 'diagonal').length;
  const squaresFound = validShapes.filter(s => s.type === 'square').length;
  const rectanglesFound = validShapes.filter(s => s.type === 'rectangle').length;
  const total = rowsFound + colsFound + diagsFound + squaresFound + rectanglesFound;
  
  // Check specific lines
  if (cfg.specificLines) {
    const sl = cfg.specificLines;
    if (sl.topRow && !validShapes.some(s => s.type === 'horizontal' && s.index === 0)) return fail('Top row required');
    if (sl.bottomRow && !validShapes.some(s => s.type === 'horizontal' && s.index === 4)) return fail('Bottom row required');
    if (sl.leftColumn && !validShapes.some(s => s.type === 'vertical' && s.index === 0)) return fail('Left column required');
    if (sl.rightColumn && !validShapes.some(s => s.type === 'vertical' && s.index === 4)) return fail('Right column required');
    if (sl.mainDiagonal && !validShapes.some(s => s.type === 'diagonal' && s.index === 1)) return fail('Main diagonal required');
    if (sl.antiDiagonal && !validShapes.some(s => s.type === 'diagonal' && s.index === 2)) return fail('Anti-diagonal required');
  }
  
  // Corners
  if (cfg.cornersRequired > 0) {
    const corners = ['0,0', '0,4', '4,0', '4,4'].filter(c => effectiveSet.has(c));
    if (corners.length < cfg.cornersRequired) return fail(`Need ${cfg.cornersRequired} corners, found ${corners.length}`);
  }
  
  // Check minimums
  if (rowsFound < (cfg.minRows || 0)) return fail(`Need ${cfg.minRows || 0} rows, found ${rowsFound}`);
  if (colsFound < (cfg.minColumns || 0)) return fail(`Need ${cfg.minColumns || 0} columns, found ${colsFound}`);
  if (diagsFound < (cfg.minDiagonals || 0)) return fail(`Need ${cfg.minDiagonals || 0} diagonals, found ${diagsFound}`);
  if (squaresFound < (cfg.minSquares || 0)) return fail(`Need ${cfg.minSquares || 0} squares, found ${squaresFound}`);
  if (rectanglesFound < (cfg.minRectangles || 0)) return fail(`Need ${cfg.minRectangles || 0} rectangles, found ${rectanglesFound}`);
  
  if (total < (cfg.linesToWin || 1)) {
    return fail(`Need ${cfg.linesToWin} non-overlapping shapes, found ${total} (${rowsFound}R ${colsFound}C ${diagsFound}D ${squaresFound}Sq ${rectanglesFound}Re)`);
  }
  
  return {
    valid: true,
    message: `✅ WIN! ${total} shapes`,
    details: { rowsFound, colsFound, diagsFound, squaresFound, rectanglesFound, totalLines: total, totalMarked: effectiveSet.size, cornersOk: true }
  };
}

// 🔧 NEW: Find ALL completed shapes with their cells
function findAllShapes(effectiveSet, cfg) {
  const dirs = cfg.lineDirections || ['horizontal', 'vertical', 'diagonal'];
  const shapes = [];
  
  // Rows
  if (dirs.includes('horizontal')) {
    for (let r = 0; r < 5; r++) {
      if (isRowComplete(effectiveSet, r)) {
        const cells = [];
        for (let c = 0; c < 5; c++) cells.push([r, c]);
        shapes.push({ type: 'horizontal', index: r, cells });
      }
    }
  }
  
  // Columns
  if (dirs.includes('vertical')) {
    for (let c = 0; c < 5; c++) {
      if (isColComplete(effectiveSet, c)) {
        const cells = [];
        for (let r = 0; r < 5; r++) cells.push([r, c]);
        shapes.push({ type: 'vertical', index: c, cells });
      }
    }
  }
  
  // Diagonals
  if (dirs.includes('diagonal')) {
    if (isDiagComplete(effectiveSet, 1)) {
      const cells = [];
      for (let i = 0; i < 5; i++) cells.push([i, i]);
      shapes.push({ type: 'diagonal', index: 1, cells });
    }
    if (isDiagComplete(effectiveSet, 2)) {
      const cells = [];
      for (let i = 0; i < 5; i++) cells.push([i, 4-i]);
      shapes.push({ type: 'diagonal', index: 2, cells });
    }
  }
  
  // Squares
  if (dirs.includes('square')) {
    const size = cfg.squareSize || 2;
    for (let r = 0; r <= 5 - size; r++) {
      for (let c = 0; c <= 5 - size; c++) {
        if (isBlockComplete(effectiveSet, r, c, size, size)) {
          const cells = [];
          for (let i = 0; i < size; i++)
            for (let j = 0; j < size; j++)
              cells.push([r + i, c + j]);
          shapes.push({ type: 'square', size, row: r, col: c, cells });
        }
      }
    }
  }
  
  // Rectangles
  if (dirs.includes('rectangle')) {
    const w = cfg.rectWidth || 3, h = cfg.rectHeight || 2;
    for (let r = 0; r <= 5 - h; r++) {
      for (let c = 0; c <= 5 - w; c++) {
        if (isBlockComplete(effectiveSet, r, c, w, h)) {
          const cells = [];
          for (let i = 0; i < h; i++)
            for (let j = 0; j < w; j++)
              cells.push([r + i, c + j]);
          shapes.push({ type: 'rectangle', width: w, height: h, row: r, col: c, cells });
        }
      }
    }
  }
  
  return shapes;
}

// 🔧 NEW: Filter to non-overlapping shapes (greedy algorithm)
function filterNonOverlapping(shapes) {
  if (shapes.length <= 1) return shapes;
  
  const usedCells = new Set();
  const result = [];
  
  // Sort by type priority: lines first, then squares, then rectangles
  const priority = { horizontal: 1, vertical: 1, diagonal: 1, square: 2, rectangle: 3 };
  const sorted = [...shapes].sort((a, b) => (priority[a.type] || 1) - (priority[b.type] || 1));
  
  for (const shape of sorted) {
    const cellKeys = shape.cells.map(([r, c]) => `${r},${c}`);
    const hasOverlap = cellKeys.some(key => usedCells.has(key));
    
    if (!hasOverlap) {
      result.push(shape);
      cellKeys.forEach(key => usedCells.add(key));
    }
  }
  
  return result;
}

function countShapes(effectiveSet, cfg) {
  const dirs = cfg.lineDirections || ['horizontal', 'vertical', 'diagonal'];
  let rows = 0, cols = 0, diags = 0, squares = 0, rectangles = 0;
  
  // Rows
  if (dirs.includes('horizontal')) {
    for (let r = 0; r < 5; r++) { if (isRowComplete(effectiveSet, r)) rows++; }
  }
  // Columns
  if (dirs.includes('vertical')) {
    for (let c = 0; c < 5; c++) { if (isColComplete(effectiveSet, c)) cols++; }
  }
  // Diagonals
  if (dirs.includes('diagonal')) {
    if (isDiagComplete(effectiveSet, 1)) diags++;
    if (isDiagComplete(effectiveSet, 2)) diags++;
  }
  // Squares
  if (dirs.includes('square')) {
    const size = cfg.squareSize || 2;
    for (let r = 0; r <= 5 - size; r++) {
      for (let c = 0; c <= 5 - size; c++) {
        if (isBlockComplete(effectiveSet, r, c, size, size)) squares++;
      }
    }
  }
  // Rectangles
  if (dirs.includes('rectangle')) {
    const w = cfg.rectWidth || 3, h = cfg.rectHeight || 2;
    for (let r = 0; r <= 5 - h; r++) {
      for (let c = 0; c <= 5 - w; c++) {
        if (isBlockComplete(effectiveSet, r, c, w, h)) rectangles++;
      }
    }
  }
  
  return { rows, cols, diags, squares, rectangles };
}

function isRowComplete(set, r) {
  for (let c = 0; c < 5; c++) { if (!set.has(`${r},${c}`)) return false; }
  return true;
}
function isColComplete(set, c) {
  for (let r = 0; r < 5; r++) { if (!set.has(`${r},${c}`)) return false; }
  return true;
}
function isDiagComplete(set, type) {
  for (let i = 0; i < 5; i++) {
    const key = type === 1 ? `${i},${i}` : `${i},${4-i}`;
    if (!set.has(key)) return false;
  }
  return true;
}
function isBlockComplete(set, row, col, w, h) {
  for (let r = row; r < row + h; r++) {
    for (let c = col; c < col + w; c++) {
      if (!set.has(`${r},${c}`)) return false;
    }
  }
  return true;
}

function validatePattern(rule, effectiveSet) {
  for (const pattern of (rule.patterns || [])) {
    if (!pattern.cells || pattern.cells.length === 0) continue;
    if (pattern.cells.every(([r, c]) => effectiveSet.has(`${r},${c}`))) {
      return { valid: true, message: `✅ Pattern "${pattern.name}" matched!`, details: { patternName: pattern.name } };
    }
  }
  return fail('No pattern matched');
}

function validateMixed(rule, effectiveSet, markedCells) {
  const subRules = rule.mixedRules || [];
  if (subRules.length === 0) return fail('No sub-rules defined');
  
  for (let i = 0; i < subRules.length; i++) {
    const sr = subRules[i];
    let subResult;
    
    if (sr.type === 'count') {
      subResult = countShapes(effectiveSet, sr.countConfig || {});
      const total = subResult.rows + subResult.cols + subResult.diags + subResult.squares + subResult.rectangles;
      if (total < ((sr.countConfig?.linesToWin) || 1)) {
        return fail(`Sub-rule #${i+1} (count): Need ${sr.countConfig?.linesToWin || 1} shapes, found ${total}`);
      }
    } else if (sr.type === 'pattern') {
      const pattern = rule.patterns?.[sr.patternIndex];
      if (!pattern) return fail(`Sub-rule #${i+1}: Pattern not found`);
      if (!pattern.cells.every(([r, c]) => effectiveSet.has(`${r},${c}`))) {
        return fail(`Sub-rule #${i+1}: Pattern "${pattern.name}" not matched`);
      }
    }
  }
  
  return { valid: true, message: '✅ All mixed sub-rules passed!', details: { totalMarked: effectiveSet.size } };
}

function fail(msg) {
  return { valid: false, message: `❌ ${msg}`, details: {} };
}

module.exports = {
  getAllRules: exports.getAllRules, getRule: exports.getRule,
  createRule: exports.createRule, updateRule: exports.updateRule,
  deleteRule: exports.deleteRule, testRule: exports.testRule,
  saveSample: exports.saveSample, removeSample: exports.removeSample,
  clearSamples: exports.clearSamples, getSamples: exports.getSamples
};