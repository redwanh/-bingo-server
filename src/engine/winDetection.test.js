// ============================================================
// Test: Win Detection Logic
// ============================================================

// We don't need MongoDB for win detection tests
// Just test the pure logic

// Copy the checkWin function from the engine
function checkWin(card, drawnNumbers) {
  const cols = ['B', 'I', 'N', 'G', 'O'];
  const drawnSet = new Set(drawnNumbers.map(d => d.number));

  // Check rows (5)
  for (let r = 0; r < 5; r++) {
    let complete = true;
    for (let c = 0; c < 5; c++) {
      if (cols[c] === 'N' && r === 2) continue;
      if (!drawnSet.has(card.grid[cols[c]][r].number)) {
        complete = false;
        break;
      }
    }
    if (complete) return { type: 'line', cells: cols.map(c => ({ col: c, row: r })) };
  }

  // Check columns (5)
  for (let c = 0; c < 5; c++) {
    let complete = true;
    for (let r = 0; r < 5; r++) {
      if (cols[c] === 'N' && r === 2) continue;
      if (!drawnSet.has(card.grid[cols[c]][r].number)) {
        complete = false;
        break;
      }
    }
    if (complete) return { type: 'line', cells: [0,1,2,3,4].map(r => ({ col: cols[c], row: r })) };
  }

  // Check diagonals (2)
  let diag1 = true, diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!(cols[i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[i]][i].number)) diag1 = false;
    if (!(cols[4-i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[4-i]][i].number)) diag2 = false;
  }
  if (diag1) return { type: 'line', cells: cols.map((c, i) => ({ col: c, row: i })) };
  if (diag2) return { type: 'line', cells: cols.map((c, i) => ({ col: c, row: 4-i })) };

  // Check four corners
  if (drawnSet.has(card.grid.B[0].number) &&
      drawnSet.has(card.grid.O[0].number) &&
      drawnSet.has(card.grid.B[4].number) &&
      drawnSet.has(card.grid.O[4].number)) {
    return {
      type: 'four_corners',
      cells: [
        { col: 'B', row: 0 },
        { col: 'O', row: 0 },
        { col: 'B', row: 4 },
        { col: 'O', row: 4 }
      ]
    };
  }

  return null;
}

// Helper to create a test card
function makeCard(numbers) {
  // numbers = { B: [1,2,3,4,5], I: [16,17,18,19,20], ... }
  const grid = {};
  ['B','I','N','G','O'].forEach(col => {
    grid[col] = (numbers[col] || [1,2,3,4,5]).map(n => ({ number: n, isMarked: false }));
  });
  grid.N[2] = { number: 0, isMarked: true }; // FREE
  return { grid };
}

function makeDrawn(numbers) {
  return numbers.map(n => ({ number: n, letter: 'B' })); // Letter doesn't matter for checkWin
}

// ══════════════════════════════════════
// TESTS
// ══════════════════════════════════════

describe('Win Detection', () => {

  test('Horizontal row 0 win', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35], // FREE at row 2
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    // Draw all numbers in row 0
    const drawn = makeDrawn([1, 16, 31, 46, 61]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('line');
    expect(result.cells).toEqual([
      { col: 'B', row: 0 },
      { col: 'I', row: 0 },
      { col: 'N', row: 0 },
      { col: 'G', row: 0 },
      { col: 'O', row: 0 },
    ]);
  });

  test('Horizontal row 2 (with FREE space)', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    // Draw row 2 numbers (N2 is FREE, automatically marked)
    const drawn = makeDrawn([3, 18, 34, 48, 63]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('line');
  });

  test('Vertical column B win', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    const drawn = makeDrawn([1, 2, 3, 4, 5]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('line');
    expect(result.cells[0].col).toBe('B');
  });

  test('Vertical column N (with FREE space)', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    // N column, FREE at row 2
    const drawn = makeDrawn([31, 32, 34, 35]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('line');
  });

  test('Diagonal top-left to bottom-right', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    // B0=1, I1=17, N2=FREE, G3=49, O4=65
    const drawn = makeDrawn([1, 17, 49, 65]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('line');
  });

  test('Diagonal top-right to bottom-left', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    // O0=61, G1=47, N2=FREE, I3=19, B4=5
    const drawn = makeDrawn([61, 47, 19, 5]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('line');
  });

  test('Four corners', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    // B0=1, O0=61, B4=5, O4=65
    const drawn = makeDrawn([1, 61, 5, 65]);
    const result = checkWin(card, drawn);
    expect(result).not.toBeNull();
    expect(result.type).toBe('four_corners');
    expect(result.cells).toHaveLength(4);
  });

  test('No win - not enough numbers', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    const drawn = makeDrawn([1, 16, 31, 46]); // Only 4, missing O
    const result = checkWin(card, drawn);
    expect(result).toBeNull();
  });

  test('No win - scattered numbers', () => {
    const card = makeCard({
      B: [1, 2, 3, 4, 5],
      I: [16, 17, 18, 19, 20],
      N: [31, 32, 0, 34, 35],
      G: [46, 47, 48, 49, 50],
      O: [61, 62, 63, 64, 65],
    });
    const drawn = makeDrawn([1, 17, 34, 49, 62]); // Diagonal-ish but not complete
    const result = checkWin(card, drawn);
    expect(result).toBeNull();
  });

});