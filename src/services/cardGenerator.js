class CardGenerator {
  static generateGrid() {
    return {
      B: this.generateColumn(1, 15, false),
      I: this.generateColumn(16, 30, false),
      N: this.generateColumn(31, 45, true),
      G: this.generateColumn(46, 60, false),
      O: this.generateColumn(61, 75, false)
    };
  }

  static generateColumn(min, max, hasFreeSpace = false) {
    const nums = new Set();
    while (nums.size < 5) {
      nums.add(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    const arr = Array.from(nums).map(n => ({ number: n, isMarked: false }));
    if (hasFreeSpace) arr[2] = { number: 0, isMarked: true };
    return arr;
  }

  static generateCard(serialNumber) {
    return {
      cardId: `BINGO-${Date.now().toString(36)}-${serialNumber.toString(36).toUpperCase()}`,
      serialNumber,
      grid: this.generateGrid(),
      isUsed: false,
      isBlocked: false
    };
  }

  static displayCard(grid) {
    const cols = ['B','I','N','G','O'];
    let out = ' B   I   N   G   O\n-------------------\n';
    for (let r = 0; r < 5; r++) {
      for (let c of cols) {
        const n = grid[c][r].number;
        out += n === 0 ? 'FREE ' : `${n.toString().padStart(2)}  `;
      }
      out += '\n';
    }
    return out;
  }

  static getBingoLetter(number) {
    if (number <= 15) return 'B';
    if (number <= 30) return 'I';
    if (number <= 45) return 'N';
    if (number <= 60) return 'G';
    return 'O';
  }

  static shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

module.exports = CardGenerator;
