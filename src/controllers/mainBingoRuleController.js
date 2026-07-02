const MainBingoRule = require('../models/MainBingoRule');

exports.getAllRules = async (req, res) => {
  const rules = await MainBingoRule.find().sort({ createdAt: -1 });
  res.json({ success: true, rules });
};

exports.getRule = async (req, res) => {
  const rule = await MainBingoRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json({ success: true, rule });
};

exports.createRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.create({ ...req.body, createdBy: req.user.id });
    res.json({ success: true, rule });
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
  const rule = await MainBingoRule.findByIdAndDelete(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json({ success: true, message: 'Rule deleted' });
};

exports.testRule = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    if (!req.body || !req.body.markedCells || !Array.isArray(req.body.markedCells)) {
      return res.status(400).json({ error: 'markedCells is required and must be an array' });
    }
    
    const { markedCells } = req.body;
    const result = validateRule(rule, markedCells);
    
    res.json({ success: true, result: { ...result, markedCells } });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.saveSample = async (req, res) => {
  try {
    const { type, sample } = req.body;
    if (!type || !['win', 'loss'].includes(type)) return res.status(400).json({ error: 'Type must be "win" or "loss"' });
    
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
    res.json({ success: true, message: `${type} sample saved`, rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.removeSample = async (req, res) => {
  try {
    const { type, index } = req.params;
    if (!type || !['wins', 'losses'].includes(type)) return res.status(400).json({ error: 'Type must be "wins" or "losses"' });
    
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    if (rule.samples && rule.samples[type]) {
      const idx = parseInt(index);
      if (idx >= 0 && idx < rule.samples[type].length) {
        rule.samples[type].splice(idx, 1);
        await rule.save();
      }
    }
    res.json({ success: true, message: 'Sample removed', rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.clearSamples = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    rule.samples = { wins: [], losses: [] };
    await rule.save();
    res.json({ success: true, message: 'All samples cleared', rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.getSamples = async (req, res) => {
  try {
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, samples: rule.samples || { wins: [], losses: [] } });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

function validateRule(rule, markedCells) {
  const markedSet = new Set(markedCells.map(c => `${c[0]},${c[1]}`));
  const cfg = rule.ruleConfig;
  
  let effectiveMarkedSet = new Set(markedSet);
  if (cfg.freeSpaceCounts !== false && cfg.freeSpaceBlocked !== true) {
    effectiveMarkedSet.add('2,2');
  }
  if (cfg.additionalFreeSpaces) {
    cfg.additionalFreeSpaces.forEach(([r, c]) => effectiveMarkedSet.add(`${r},${c}`));
  }
  
  if (rule.method === 'pattern') return validatePatternRule(rule, effectiveMarkedSet);
  return validateLineBasedRule(rule, effectiveMarkedSet, markedCells);
}

function validateLineBasedRule(rule, effectiveMarkedSet, markedCells) {
  const cfg = rule.ruleConfig;
  const gridSize = 5;
  const completedLines = [];
  const lineDirections = cfg.lineDirections || ['horizontal', 'vertical', 'diagonal'];
  
  // Check rows
  if (lineDirections.includes('horizontal')) {
    for (let r = 0; r < gridSize; r++) {
      let complete = true;
      const cells = [];
      for (let c = 0; c < gridSize; c++) {
        if (!effectiveMarkedSet.has(`${r},${c}`)) { complete = false; break; }
        cells.push([r, c]);
      }
      if (complete) completedLines.push({ type: 'horizontal', index: r, cells });
    }
  }
  
  // Check columns
  if (lineDirections.includes('vertical')) {
    for (let c = 0; c < gridSize; c++) {
      let complete = true;
      const cells = [];
      for (let r = 0; r < gridSize; r++) {
        if (!effectiveMarkedSet.has(`${r},${c}`)) { complete = false; break; }
        cells.push([r, c]);
      }
      if (complete) completedLines.push({ type: 'vertical', index: c, cells });
    }
  }
  
  // Check diagonals
  if (lineDirections.includes('diagonal')) {
    let d1Complete = true;
    const d1Cells = [];
    for (let i = 0; i < gridSize; i++) {
      if (!effectiveMarkedSet.has(`${i},${i}`)) { d1Complete = false; break; }
      d1Cells.push([i, i]);
    }
    if (d1Complete) completedLines.push({ type: 'diagonal', index: 1, cells: d1Cells });
    
    let d2Complete = true;
    const d2Cells = [];
    for (let i = 0; i < gridSize; i++) {
      if (!effectiveMarkedSet.has(`${i},${gridSize-1-i}`)) { d2Complete = false; break; }
      d2Cells.push([i, gridSize-1-i]);
    }
    if (d2Complete) completedLines.push({ type: 'diagonal', index: 2, cells: d2Cells });
  }
  
  // Check squares
  let squaresFound = 0;
  if (lineDirections.includes('square')) {
    const minSize = cfg.squareMinSize || 2;
    const maxSize = cfg.squareMaxSize || 5;
    for (let size = minSize; size <= maxSize; size++) {
      for (let r = 0; r <= gridSize - size; r++) {
        for (let c = 0; c <= gridSize - size; c++) {
          let complete = true;
          const cells = [];
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
              if (!effectiveMarkedSet.has(`${r + i},${c + j}`)) { complete = false; break; }
              cells.push([r + i, c + j]);
            }
            if (!complete) break;
          }
          if (complete) { squaresFound++; completedLines.push({ type: 'square', size, row: r, col: c, cells }); }
        }
      }
    }
  }
  
  // Check rectangles
  let rectanglesFound = 0;
  if (lineDirections.includes('rectangle')) {
    const minW = cfg.rectMinWidth || 2, maxW = cfg.rectMaxWidth || 5;
    const minH = cfg.rectMinHeight || 2, maxH = cfg.rectMaxHeight || 5;
    for (let w = minW; w <= maxW; w++) {
      for (let h = minH; h <= maxH; h++) {
        if (w === h) continue;
        for (let r = 0; r <= gridSize - h; r++) {
          for (let c = 0; c <= gridSize - w; c++) {
            let complete = true;
            const cells = [];
            for (let i = 0; i < h; i++) {
              for (let j = 0; j < w; j++) {
                if (!effectiveMarkedSet.has(`${r + i},${c + j}`)) { complete = false; break; }
                cells.push([r + i, c + j]);
              }
              if (!complete) break;
            }
            if (complete) { rectanglesFound++; completedLines.push({ type: 'rectangle', width: w, height: h, row: r, col: c, cells }); }
          }
        }
      }
    }
  }
  
  // Count by type
  const rowsFound = completedLines.filter(l => l.type === 'horizontal').length;
  const colsFound = completedLines.filter(l => l.type === 'vertical').length;
  const diagsFound = completedLines.filter(l => l.type === 'diagonal').length;
  let totalLines = rowsFound + colsFound + diagsFound + squaresFound + rectanglesFound;
  
  // Exact/max checks
  if (cfg.exactRows !== null && rowsFound !== cfg.exactRows) return { valid: false, message: `Need exactly ${cfg.exactRows} rows, found ${rowsFound}` };
  if (cfg.exactColumns !== null && colsFound !== cfg.exactColumns) return { valid: false, message: `Need exactly ${cfg.exactColumns} columns, found ${colsFound}` };
  if (cfg.exactDiagonals !== null && diagsFound !== cfg.exactDiagonals) return { valid: false, message: `Need exactly ${cfg.exactDiagonals} diagonals, found ${diagsFound}` };
  if (cfg.exactSquares !== null && squaresFound !== cfg.exactSquares) return { valid: false, message: `Need exactly ${cfg.exactSquares} squares, found ${squaresFound}` };
  if (cfg.exactRectangles !== null && rectanglesFound !== cfg.exactRectangles) return { valid: false, message: `Need exactly ${cfg.exactRectangles} rectangles, found ${rectanglesFound}` };
  
  if (cfg.maxRows !== null && rowsFound > cfg.maxRows) return { valid: false, message: `Maximum ${cfg.maxRows} rows allowed, found ${rowsFound}` };
  if (cfg.maxColumns !== null && colsFound > cfg.maxColumns) return { valid: false, message: `Maximum ${cfg.maxColumns} columns allowed, found ${colsFound}` };
  if (cfg.maxDiagonals !== null && diagsFound > cfg.maxDiagonals) return { valid: false, message: `Maximum ${cfg.maxDiagonals} diagonals allowed, found ${diagsFound}` };
  if (cfg.maxSquares !== null && squaresFound > cfg.maxSquares) return { valid: false, message: `Maximum ${cfg.maxSquares} squares allowed, found ${squaresFound}` };
  if (cfg.maxRectangles !== null && rectanglesFound > cfg.maxRectangles) return { valid: false, message: `Maximum ${cfg.maxRectangles} rectangles allowed, found ${rectanglesFound}` };
  
  // Final check
  const totalMarked = markedCells ? markedCells.length : 0;
  let cornersOk = true;
  if (cfg.cornersRequired) {
    cornersOk = effectiveMarkedSet.has('0,0') && effectiveMarkedSet.has('0,4') && effectiveMarkedSet.has('4,0') && effectiveMarkedSet.has('4,4');
  }
  
  if (cfg.freeSpaceRequiredForWin && !effectiveMarkedSet.has('2,2')) {
    return { valid: false, message: 'Free space must be included in win' };
  }
  
  const meetsMinimums = 
    rowsFound >= (cfg.minRows || 0) &&
    colsFound >= (cfg.minColumns || 0) &&
    diagsFound >= (cfg.minDiagonals || 0) &&
    squaresFound >= (cfg.minSquares || 0) &&
    rectanglesFound >= (cfg.minRectangles || 0) &&
    totalLines >= (cfg.linesToWin || 1) &&
    (!cfg.minCellsMarked || totalMarked >= cfg.minCellsMarked) &&
    cornersOk;
  
  return {
    valid: meetsMinimums,
    message: meetsMinimums 
      ? `Valid! ${totalLines} lines (${rowsFound}R ${colsFound}C ${diagsFound}D ${squaresFound}Sq ${rectanglesFound}Re)`
      : `Need ${cfg.linesToWin} lines. Found: ${rowsFound}R ${colsFound}C ${diagsFound}D ${squaresFound}Sq ${rectanglesFound}Re = ${totalLines} total`,
    details: { rowsFound, colsFound, diagsFound, squaresFound, rectanglesFound, totalLines, totalMarked, cornersOk }
  };
}

function validatePatternRule(rule, effectiveMarkedSet) {
  for (const pattern of rule.patterns) {
    const allMatch = pattern.cells.every(([row, col]) => effectiveMarkedSet.has(`${row},${col}`));
    if (allMatch) return { valid: true, message: `Pattern "${pattern.name}" matched!`, details: { patternName: pattern.name } };
  }
  return { valid: false, message: 'Pattern not matched', details: { patternName: null } };
}

module.exports = { 
  getAllRules: exports.getAllRules, getRule: exports.getRule, createRule: exports.createRule, 
  updateRule: exports.updateRule, deleteRule: exports.deleteRule, testRule: exports.testRule,
  saveSample: exports.saveSample, removeSample: exports.removeSample, 
  clearSamples: exports.clearSamples, getSamples: exports.getSamples
};