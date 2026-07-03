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
  
  // ══════════════════════════════════════
  // CHECK ROWS
  // ══════════════════════════════════════
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
  
  // ══════════════════════════════════════
  // CHECK COLUMNS
  // ══════════════════════════════════════
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
  
  // ══════════════════════════════════════
  // CHECK DIAGONALS
  // ══════════════════════════════════════
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
  
  // ══════════════════════════════════════
  // CHECK SQUARES (2x2 only by default)
  // ══════════════════════════════════════
  let squaresFound = 0;
  if (lineDirections.includes('square')) {
    const minSize = cfg.squareMinSize || 2;
    const maxSize = cfg.squareMaxSize || 2; // Default to 2x2 only
    
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
          if (complete) {
            squaresFound++;
            completedLines.push({ type: 'square', size, row: r, col: c, cells });
          }
        }
      }
    }
  }
  
  // ══════════════════════════════════════
  // CHECK RECTANGLES (3x2 by default)
  // ══════════════════════════════════════
  let rectanglesFound = 0;
  if (lineDirections.includes('rectangle')) {
    const minW = cfg.rectMinWidth || 3;  // Default 3 wide
    const maxW = cfg.rectMaxWidth || 3;
    const minH = cfg.rectMinHeight || 2; // Default 2 tall
    const maxH = cfg.rectMaxHeight || 2;
    
    for (let w = minW; w <= maxW; w++) {
      for (let h = minH; h <= maxH; h++) {
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
            if (complete) {
              rectanglesFound++;
              completedLines.push({ type: 'rectangle', width: w, height: h, row: r, col: c, cells });
            }
          }
        }
      }
    }
  }
  
  // ══════════════════════════════════════
  // COUNT BY TYPE
  // ══════════════════════════════════════
  let rowsFound = completedLines.filter(l => l.type === 'horizontal').length;
  let colsFound = completedLines.filter(l => l.type === 'vertical').length;
  let diagsFound = completedLines.filter(l => l.type === 'diagonal').length;
  let totalLines = rowsFound + colsFound + diagsFound + squaresFound + rectanglesFound;
  
  // ══════════════════════════════════════
  // EXACT CHECKS (for all types)
  // ══════════════════════════════════════
  if (cfg.exactRows !== null && rowsFound !== cfg.exactRows)
    return { valid: false, message: `Need exactly ${cfg.exactRows} rows, found ${rowsFound}` };
  if (cfg.exactColumns !== null && colsFound !== cfg.exactColumns)
    return { valid: false, message: `Need exactly ${cfg.exactColumns} columns, found ${colsFound}` };
  if (cfg.exactDiagonals !== null && diagsFound !== cfg.exactDiagonals)
    return { valid: false, message: `Need exactly ${cfg.exactDiagonals} diagonals, found ${diagsFound}` };
  if (cfg.exactSquares !== null && squaresFound !== cfg.exactSquares)
    return { valid: false, message: `Need exactly ${cfg.exactSquares} squares, found ${squaresFound}` };
  if (cfg.exactRectangles !== null && rectanglesFound !== cfg.exactRectangles)
    return { valid: false, message: `Need exactly ${cfg.exactRectangles} rectangles, found ${rectanglesFound}` };
  
  // ══════════════════════════════════════
  // MAX CHECKS (for all types)
  // ══════════════════════════════════════
  if (cfg.maxRows !== null && rowsFound > cfg.maxRows)
    return { valid: false, message: `Maximum ${cfg.maxRows} rows, found ${rowsFound}` };
  if (cfg.maxColumns !== null && colsFound > cfg.maxColumns)
    return { valid: false, message: `Maximum ${cfg.maxColumns} columns, found ${colsFound}` };
  if (cfg.maxDiagonals !== null && diagsFound > cfg.maxDiagonals)
    return { valid: false, message: `Maximum ${cfg.maxDiagonals} diagonals, found ${diagsFound}` };
  if (cfg.maxSquares !== null && squaresFound > cfg.maxSquares)
    return { valid: false, message: `Maximum ${cfg.maxSquares} squares, found ${squaresFound}` };
  if (cfg.maxRectangles !== null && rectanglesFound > cfg.maxRectangles)
    return { valid: false, message: `Maximum ${cfg.maxRectangles} rectangles, found ${rectanglesFound}` };
  

 // ══════════════════════════════════════
// OVERLAPPING CHECK - FIXED
// ══════════════════════════════════════
if (cfg.allowOverlapping === false) {
    const uniqueLines = [];
    const usedCells = new Set(); // Track ALL used cells (any type)
    
    for (const line of completedLines) {
      const lineCellKeys = line.cells.map(([r, c]) => `${r},${c}`);
      
      // Check if ANY cell is already used by ANY other line
      const hasOverlap = lineCellKeys.some(key => usedCells.has(key));
      
      if (!hasOverlap) {
        uniqueLines.push(line);
        // Mark all cells as used
        lineCellKeys.forEach(key => usedCells.add(key));
      }
    }
    
    // Recalculate all counts with unique lines only
    rowsFound = uniqueLines.filter(l => l.type === 'horizontal').length;
    colsFound = uniqueLines.filter(l => l.type === 'vertical').length;
    diagsFound = uniqueLines.filter(l => l.type === 'diagonal').length;
    squaresFound = uniqueLines.filter(l => l.type === 'square').length;
    rectanglesFound = uniqueLines.filter(l => l.type === 'rectangle').length;
    totalLines = rowsFound + colsFound + diagsFound + squaresFound + rectanglesFound;
}
  
  // ══════════════════════════════════════
  // INTERSECTION CHECK (applies to ALL types)
  // ══════════════════════════════════════
  if (cfg.linesMustIntersect && totalLines > 1) {
    const intersectionPoints = {};
    completedLines.forEach((line, i) => {
      line.cells.forEach(([r, c]) => {
        const key = `${r},${c}`;
        if (!intersectionPoints[key]) intersectionPoints[key] = [];
        intersectionPoints[key].push(i);
      });
    });
    
    const commonIntersections = Object.entries(intersectionPoints)
      .filter(([_, lines]) => lines.length >= totalLines);
    
    if (commonIntersections.length === 0) {
      return { valid: false, message: 'Lines must intersect at a common point' };
    }
    
    if (cfg.intersectionPoint?.row !== null && cfg.intersectionPoint?.col !== null) {
      const key = `${cfg.intersectionPoint.row},${cfg.intersectionPoint.col}`;
      if (!intersectionPoints[key] || intersectionPoints[key].length < totalLines) {
        return { valid: false, message: `Lines must intersect at row ${cfg.intersectionPoint.row}, col ${cfg.intersectionPoint.col}` };
      }
    }
  }
  
  if (cfg.linesMustNotIntersect) {
    const cellUsageCount = {};
    completedLines.forEach(line => {
      line.cells.forEach(([r, c]) => {
        const key = `${r},${c}`;
        cellUsageCount[key] = (cellUsageCount[key] || 0) + 1;
      });
    });
    const overlaps = Object.entries(cellUsageCount).filter(([_, count]) => count > 1);
    if (overlaps.length > 0) {
      return { valid: false, message: `Lines must not share cells. Found ${overlaps.length} shared cells.` };
    }
  }
  
  // ══════════════════════════════════════
  // FREE SPACE CHECK
  // ══════════════════════════════════════
  if (cfg.freeSpaceRequiredForWin && !effectiveMarkedSet.has('2,2')) {
    return { valid: false, message: 'Free space must be included in win' };
  }
  
  // ══════════════════════════════════════
  // CORNERS CHECK
  // ══════════════════════════════════════
  let cornersOk = true;
  if (cfg.cornersRequired) {
    cornersOk = effectiveMarkedSet.has('0,0') && effectiveMarkedSet.has('0,4') && 
                effectiveMarkedSet.has('4,0') && effectiveMarkedSet.has('4,4');
  }
  
  // ══════════════════════════════════════
  // FINAL WIN CHECK
  // ══════════════════════════════════════
  const totalMarked = markedCells ? markedCells.length : 0;
  
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
      ? `✅ Valid! ${totalLines} lines (${rowsFound}R ${colsFound}C ${diagsFound}D ${squaresFound}Sq ${rectanglesFound}Re)`
      : `❌ Need ${cfg.linesToWin} total. Found: ${rowsFound}R ${colsFound}C ${diagsFound}D ${squaresFound}Sq ${rectanglesFound}Re = ${totalLines}`,
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