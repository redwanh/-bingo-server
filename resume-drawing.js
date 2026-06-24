require('dotenv').config();
const mongoose = require('mongoose');
const MainBingoGame = require('./src/models/MainBingoGame');
const MainBingoEngine = require('./src/services/mainBingoEngine');
const http = require('http');
const socketIo = require('socket.io');

async function resumeDrawing() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const game = await MainBingoGame.getActiveGame();
  
  if (!game) {
    console.log('No active game found.');
    process.exit(0);
  }

  console.log('Game:', game.gameId);
  console.log('Status:', game.status);
  console.log('Numbers drawn:', game.drawnNumbers.length);
  console.log('Total numbers:', game.allNumbers.length);

  if (game.status === 'completed') {
    console.log('Game already completed.');
    process.exit(0);
  }

  if (game.drawnNumbers.length >= game.allNumbers.length) {
    console.log('All numbers already drawn.');
    process.exit(0);
  }

  // Create a server and socket.io to broadcast
  const server = http.createServer();
  const io = socketIo(server, { cors: { origin: '*' } });
  
  server.listen(5099, () => {
    console.log('Resume server on port 5099\n');
    
    const engine = new MainBingoEngine(io);
    
    // Start from where we left off
    engine.drawNumbers(game);
    console.log('✅ Drawing resumed!');
    console.log('Next number will be #' + (game.drawnNumbers.length + 1));
    console.log('\nKeep this running until game ends.');
    console.log('Press Ctrl+C to stop.\n');
  });
}

resumeDrawing().catch(e => { console.error(e); process.exit(1); });
