const MainBingoRule = require('../models/MainBingoRule'); // ✅ Just importing

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
     console.log('DEBUG testRoute - req.body:', JSON.stringify(req.body));
    console.log('DEBUG testRoute - Content-Type:', req.headers['content-type']);
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    // ✅ FIX: Check if body and markedCells exist
    if (!req.body || !req.body.markedCells || !Array.isArray(req.body.markedCells)) {
      return res.status(400).json({ 
        error: 'markedCells is required and must be an array',
        received: req.body 
      });
    }
    
    const { markedCells } = req.body;
    const result = validateRule(rule, markedCells);
    
    res.json({ 
      success: true, 
      result: {
        ...result,
        markedCells: markedCells
      }
    });
  } catch (e) { 
    console.error('Test error:', e);
    res.status(400).json({ error: e.message }); 
  }
};
// NEW: Sample management functions
exports.saveSample = async (req, res) => {
  try {
    const { type, sample } = req.body;
    
    if (!type || !['win', 'loss'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "win" or "loss"' });
    }
    
    const rule = await MainBingoRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    
    if (!rule.samples) {
      rule.samples = { wins: [], losses: [] };
    }
    
    const sampleData = {
      markedCells: sample.markedCells,
      isValid: sample.isValid !== undefined ? sample.isValid : (type === 'win'),
      details: sample.details || {},
      timestamp: new Date()
    };
    
    if (type === 'win') {
      rule.samples.wins.push(sampleData);
    } else {
      rule.samples.losses.push(sampleData);
    }
    
    await rule.save();
    res.json({ success: true, message: `${type} sample saved`, rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.removeSample = async (req, res) => {
  try {
    const { type, index } = req.params;
    
    if (!type || !['wins', 'losses'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "wins" or "losses"' });
    }
    
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

// Keep your existing validateRule function
function validateRule(rule, markedCells) {
  const markedSet = new Set(markedCells.map(c => `${c[0]},${c[1]}`));
  const cfg = rule.ruleConfig;
  const COLS = ['B','I','N','G','O'];
  
  // Handle free space
  let effectiveMarkedSet = new Set(markedSet);
  if (cfg.freeSpaceCounts !== false && cfg.freeSpaceBlocked !== true) {
    effectiveMarkedSet.add('2,2'); // Center free space
  }
  // Add additional free spaces
  if (cfg.additionalFreeSpaces) {
    cfg.additionalFreeSpaces.forEach(([r, c]) => {
      effectiveMarkedSet.add(`${r},${c}`);
    });
  }
  
  if (rule.method === 'pattern') {
    return validatePatternRule(rule, effectiveMarkedSet);
  }
  
  return validateLineBasedRule(rule, effectiveMarkedSet, markedSet,markedCells);
}

function validateLineBasedRule(rule, effectiveMarkedSet, originalMarkedSet,markedCells) {
  const cfg = rule.ruleConfig;
  const gridSize = 5;
  
  // Find all completed lines
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
      if (complete) {
        completedLines.push({ type: 'horizontal', index: r, cells });
      }
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
      if (complete) {
        completedLines.push({ type: 'vertical', index: c, cells });
      }
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
  
  // Count by type
  const rowsFound = completedLines.filter(l => l.type === 'horizontal').length;
  const colsFound = completedLines.filter(l => l.type === 'vertical').length;
  const diagsFound = completedLines.filter(l => l.type === 'diagonal').length;
  let totalLines = rowsFound + colsFound + diagsFound;
  
  // ============================================
  // OVERLAPPING CHECKS
  // ============================================
  const cellUsageCount = {};
  completedLines.forEach(line => {
    line.cells.forEach(([r, c]) => {
      const key = `${r},${c}`;
      cellUsageCount[key] = (cellUsageCount[key] || 0) + 1;
    });
  });
  
  const overlappingCells = Object.entries(cellUsageCount).filter(([_, count]) => count > 1);
  const maxOverlap = overlappingCells.length > 0 ? Math.max(...overlappingCells.map(([_, c]) => c)) : 0;
  
  // Handle non-overlapping requirement
  if (cfg.allowOverlapping === false) {
    // Remove overlapping lines, keeping the first ones found
    const uniqueLines = [];
    const usedCells = new Set();
    
    for (const line of completedLines) {
      const lineCellKeys = line.cells.map(([r, c]) => `${r},${c}`);
      const hasOverlap = lineCellKeys.some(key => usedCells.has(key));
      
      if (!hasOverlap) {
        uniqueLines.push(line);
        lineCellKeys.forEach(key => usedCells.add(key));
      }
    }
    
    // Recalculate with unique lines
    totalLines = uniqueLines.length;
  }
  
  // Shared cells limit
  if (cfg.sharedCellsLimit !== null && cfg.sharedCellsLimit !== undefined) {
    if (maxOverlap > cfg.sharedCellsLimit) {
      return {
        valid: false,
        message: `Lines share ${maxOverlap} cells, maximum allowed is ${cfg.sharedCellsLimit}`,
        details: { rowsFound, colsFound, diagsFound, totalLines, overlappingCells: overlappingCells.length }
      };
    }
  }
  
  // ============================================
  // EXACT COUNT CHECKS
  // ============================================
  if (cfg.exactRows !== null && rowsFound !== cfg.exactRows) {
    return {
      valid: false,
      message: `Need exactly ${cfg.exactRows} rows, found ${rowsFound}`,
      details: { rowsFound, colsFound, diagsFound, totalLines }
    };
  }
  if (cfg.exactColumns !== null && colsFound !== cfg.exactColumns) {
    return {
      valid: false,
      message: `Need exactly ${cfg.exactColumns} columns, found ${colsFound}`,
      details: { rowsFound, colsFound, diagsFound, totalLines }
    };
  }
  if (cfg.exactDiagonals !== null && diagsFound !== cfg.exactDiagonals) {
    return {
      valid: false,
      message: `Need exactly ${cfg.exactDiagonals} diagonals, found ${diagsFound}`,
      details: { rowsFound, colsFound, diagsFound, totalLines }
    };
  }
  
  // ============================================
  // MAX COUNT CHECKS
  // ============================================
  if (cfg.maxRows !== null && rowsFound > cfg.maxRows) {
    return {
      valid: false,
      message: `Maximum ${cfg.maxRows} rows allowed, found ${rowsFound}`,
      details: { rowsFound, colsFound, diagsFound, totalLines }
    };
  }
  if (cfg.maxColumns !== null && colsFound > cfg.maxColumns) {
    return {
      valid: false,
      message: `Maximum ${cfg.maxColumns} columns allowed, found ${colsFound}`,
      details: { rowsFound, colsFound, diagsFound, totalLines }
    };
  }
  if (cfg.maxDiagonals !== null && diagsFound > cfg.maxDiagonals) {
    return {
      valid: false,
      message: `Maximum ${cfg.maxDiagonals} diagonals allowed, found ${diagsFound}`,
      details: { rowsFound, colsFound, diagsFound, totalLines }
    };
  }
  
  // ============================================
  // COMBINATION CHECKS
  // ============================================
  if (cfg.requiredCombination) {
    const combo = cfg.requiredCombination;
    if (combo.rows !== null && rowsFound < combo.rows) {
      return {
        valid: false,
        message: `Need ${combo.rows} rows as part of combination, found ${rowsFound}`,
        details: { rowsFound, colsFound, diagsFound, totalLines }
      };
    }
    if (combo.columns !== null && colsFound < combo.columns) {
      return {
        valid: false,
        message: `Need ${combo.columns} columns as part of combination, found ${colsFound}`,
        details: { rowsFound, colsFound, diagsFound, totalLines }
      };
    }
    if (combo.diagonals !== null && diagsFound < combo.diagonals) {
      return {
        valid: false,
        message: `Need ${combo.diagonals} diagonals as part of combination, found ${diagsFound}`,
        details: { rowsFound, colsFound, diagsFound, totalLines }
      };
    }
  }
  
  // Must have all types
  if (cfg.mustHaveAllTypes) {
    if (rowsFound === 0 || colsFound === 0 || diagsFound === 0) {
      return {
        valid: false,
        message: `Must have at least 1 row, 1 column, AND 1 diagonal. Found: ${rowsFound}R ${colsFound}C ${diagsFound}D`,
        details: { rowsFound, colsFound, diagsFound, totalLines }
      };
    }
  }
  
  // Exclusive lines
  if (cfg.exclusiveLines) {
    if (cfg.exclusiveLines === 'rows' && (colsFound > 0 || diagsFound > 0)) {
      return { valid: false, message: 'Only rows allowed', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (cfg.exclusiveLines === 'columns' && (rowsFound > 0 || diagsFound > 0)) {
      return { valid: false, message: 'Only columns allowed', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (cfg.exclusiveLines === 'diagonals' && (rowsFound > 0 || colsFound > 0)) {
      return { valid: false, message: 'Only diagonals allowed', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
  }
  
  // ============================================
  // INTERSECTION CHECKS
  // ============================================
  if (cfg.linesMustIntersect && totalLines > 1) {
    // Find intersection points
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
      return {
        valid: false,
        message: 'Lines must intersect at a common point',
        details: { rowsFound, colsFound, diagsFound, totalLines, intersectionsFound: 0 }
      };
    }
    
    // Check specific intersection point
    if (cfg.intersectionPoint) {
      const { row, col } = cfg.intersectionPoint;
      const key = `${row},${col}`;
      if (!intersectionPoints[key] || intersectionPoints[key].length < totalLines) {
        return {
          valid: false,
          message: `Lines must intersect at row ${row}, col ${col}`,
          details: { rowsFound, colsFound, diagsFound, totalLines }
        };
      }
    }
  }
  
  if (cfg.linesMustNotIntersect && overlappingCells.length > 0) {
    return {
      valid: false,
      message: `Lines must not share any cells. Found ${overlappingCells.length} shared cells.`,
      details: { rowsFound, colsFound, diagsFound, totalLines, overlappingCells: overlappingCells.length }
    };
  }
  
  // ============================================
  // DIRECTION CHECKS
  // ============================================
  if (cfg.requiredDirections && cfg.requiredDirections.length > 0) {
    for (const dir of cfg.requiredDirections) {
      if (dir === 'horizontal' && rowsFound === 0) {
        return { valid: false, message: 'Must include at least 1 horizontal line', details: { rowsFound, colsFound, diagsFound, totalLines } };
      }
      if (dir === 'vertical' && colsFound === 0) {
        return { valid: false, message: 'Must include at least 1 vertical line', details: { rowsFound, colsFound, diagsFound, totalLines } };
      }
      if (dir === 'diagonal' && diagsFound === 0) {
        return { valid: false, message: 'Must include at least 1 diagonal line', details: { rowsFound, colsFound, diagsFound, totalLines } };
      }
    }
  }
  
  if (cfg.prohibitedDirections && cfg.prohibitedDirections.length > 0) {
    if (cfg.prohibitedDirections.includes('horizontal') && rowsFound > 0) {
      return { valid: false, message: 'Horizontal lines not allowed', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (cfg.prohibitedDirections.includes('vertical') && colsFound > 0) {
      return { valid: false, message: 'Vertical lines not allowed', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (cfg.prohibitedDirections.includes('diagonal') && diagsFound > 0) {
      return { valid: false, message: 'Diagonal lines not allowed', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
  }
  
  // ============================================
  // SPECIFIC LINE CHECKS
  // ============================================
  if (cfg.specificLines) {
    const sl = cfg.specificLines;
    if (sl.topRow && !completedLines.some(l => l.type === 'horizontal' && l.index === 0)) {
      return { valid: false, message: 'Top row must be complete', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (sl.bottomRow && !completedLines.some(l => l.type === 'horizontal' && l.index === 4)) {
      return { valid: false, message: 'Bottom row must be complete', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (sl.leftColumn && !completedLines.some(l => l.type === 'vertical' && l.index === 0)) {
      return { valid: false, message: 'Left column must be complete', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (sl.rightColumn && !completedLines.some(l => l.type === 'vertical' && l.index === 4)) {
      return { valid: false, message: 'Right column must be complete', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (sl.mainDiagonal && !completedLines.some(l => l.type === 'diagonal' && l.index === 1)) {
      return { valid: false, message: 'Main diagonal must be complete', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
    if (sl.antiDiagonal && !completedLines.some(l => l.type === 'diagonal' && l.index === 2)) {
      return { valid: false, message: 'Anti-diagonal must be complete', details: { rowsFound, colsFound, diagsFound, totalLines } };
    }
  }
  
  // ============================================
  // FINAL WIN CHECK
  // ============================================
  const totalMarked = markedCells ? markedCells.length : 0;
  let cornersOk = true;
  if (cfg.cornersRequired) {
    cornersOk = effectiveMarkedSet.has('0,0') && effectiveMarkedSet.has('0,4') && 
                effectiveMarkedSet.has('4,0') && effectiveMarkedSet.has('4,4');
  }
  
  const meetsMinimums = 
    rowsFound >= (cfg.minRows || 0) &&
    colsFound >= (cfg.minColumns || 0) &&
    diagsFound >= (cfg.minDiagonals || 0) &&
    totalLines >= (cfg.linesToWin || 1) &&
    (!cfg.minCellsMarked || totalMarked >= cfg.minCellsMarked) &&
    cornersOk;
  
  // Free space required check
  if (cfg.freeSpaceRequiredForWin && !effectiveMarkedSet.has('2,2')) {
    return {
      valid: false,
      message: 'Free space must be included in win',
      details: { rowsFound, colsFound, diagsFound, totalLines, totalMarked, cornersOk, overlappingCells: overlappingCells.length }
    };
  }
  
  return {
    valid: meetsMinimums,
    message: meetsMinimums 
      ? `Valid! ${totalLines} lines (${rowsFound}R ${colsFound}C ${diagsFound}D)`
      : `Need ${cfg.linesToWin} lines. Found: ${rowsFound}R ${colsFound}C ${diagsFound}D = ${totalLines} total`,
    details: { 
      rowsFound, colsFound, diagsFound, totalLines, totalMarked, cornersOk,
      overlappingCells: overlappingCells.length,
      maxOverlap,
      intersectionsFound: overlappingCells.filter(([_, count]) => count >= totalLines).length
    }
  };
}

function validatePatternRule(rule, effectiveMarkedSet) {
  // Pattern validation (existing logic)
  let patternMatched = false;
  let matchedPattern = null;
  
  for (const pattern of rule.patterns) {
    const allMatch = pattern.cells.every(([row, col]) => {
      return effectiveMarkedSet.has(`${row},${col}`);
    });
    
    if (allMatch) { 
      patternMatched = true; 
      matchedPattern = pattern.name;
      break; 
    }
  }
  
  return { 
    valid: patternMatched, 
    message: patternMatched ? `Pattern "${matchedPattern}" matched!` : 'Pattern not matched',
    details: { patternName: matchedPattern, rowsFound: 0, colsFound: 0, diagsFound: 0, totalLines: 0 }
  };
}

 
module.exports = { 
  getAllRules: exports.getAllRules, 
  getRule: exports.getRule, 
  createRule: exports.createRule, 
  updateRule: exports.updateRule, 
  deleteRule: exports.deleteRule, 
  testRule: exports.testRule,
  saveSample: exports.saveSample,
  removeSample: exports.removeSample,
  clearSamples: exports.clearSamples,
  getSamples: exports.getSamples
};