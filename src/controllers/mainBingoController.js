const MainBingoConfig = require('../models/MainBingoConfig');
const MainBingoGame = require('../models/MainBingoGame');
const MainBingoRule = require('../models/MainBingoRule');
const Card = require('../models/Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// In exports.setupGame, add pre-generated cards with random display IDs
exports.setupGame = async (req, res) => {
  try {
    const { ruleId, cardPrice, maxCardsPerPlayer } = req.body;
    await MainBingoConfig.updateMany({ status: 'setup' }, { status: 'completed' });
    const rule = await MainBingoRule.findById(ruleId);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    const config = await MainBingoConfig.create({ ruleId, ruleName: rule.name, cardPrice, maxCardsPerPlayer: maxCardsPerPlayer || 10, createdBy: req.user.id });
    const lastNum = await MainBingoGame.getLatestGameNumber();
    const nums = []; for (let i = 1; i <= 75; i++) nums.push(i);
    for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]]; }
    const game = await MainBingoGame.create({ gameId: String(lastNum + 1).padStart(10, '0'), gameNumber: lastNum + 1, configId: config._id, ruleId, status: 'setup', allNumbers: nums });
    
    // 🔥 Add cards to GLOBAL POOL (gameId: null)
    const totalCards = 200;
    const displayIds = [];
    for (let i = 0; i < totalCards; i++) {
      displayIds.push(10000 + i);
    }
    const shuffledIds = displayIds.sort(() => Math.random() - 0.5);
    
    const cards = [];
    for (let i = 0; i < totalCards; i++) {
      const grid = { 
        B: genCol(1,15), I: genCol(16,30), N: genCol(31,45), 
        G: genCol(46,60), O: genCol(61,75) 
      };
      grid.N[2] = { number: 0, isMarked: true };
      
      cards.push({
        gameId: null,        // 🔥 NULL = in pool, not assigned to any game
        userId: null,        // 🔥 NULL = not assigned to any user
        displayId: shuffledIds[i],
        cardNumber: i + 1,
        grid,
        price: config.cardPrice || 0,
        status: 'preview'
      });
    }
    
    await Card.insertMany(cards);
    // game.totalCards stays 0 since cards are in pool, not in game
    await game.save();
    
    console.log(`🎫 Created ${totalCards} cards in pool`);
    
    const io = req.app.get('io'); if (io) io.emit('mainBingoSetup', { game, config, rule });
    res.json({ success: true, config, game });
  } catch (e) { res.status(400).json({ error: e.message }); }
};

exports.setPrize = async (req, res) => {
  try {
    const { prizeAmount } = req.body;
    const game = await MainBingoGame.getActiveGame();
    if (!game) return res.status(404).json({ error: 'No active game' });
    game.prizeAmount = prizeAmount; await game.save();
    await MainBingoConfig.findByIdAndUpdate(game.configId, { prizeAmount });
    const io = req.app.get('io'); if (io) io.emit('mainBingoPrizeSet', { prizeAmount });
    res.json({ success: true, prizeAmount });
  } catch (e) { res.status(400).json({ error: e.message }); }
};
exports.startGame = async (req, res) => {
  try {
    console.log('🚀 START GAME endpoint hit');
    
    const game = await MainBingoGame.getActiveGame();
    if (!game) return res.status(404).json({ error: 'No active game' });
    if (game.status !== 'setup') return res.status(400).json({ error: 'Game already started' });
    
    game.status = 'countdown';
    game.countdownStartedAt = new Date();
    await game.save();
    await MainBingoConfig.findByIdAndUpdate(game.configId, { status: 'countdown' });
    
    const io = req.app.get('io');
    console.log('🔍 io available:', !!io);
    
    if (io) {
      console.log('📡 Emitting mainBingoCountdown');
      io.emit('mainBingoCountdown', { seconds: 30 });
    }
    
    console.log('⏰ Setting 30-second timeout...');
    
    setTimeout(async () => {
      console.log('⏰ TIMEOUT FIRED - Starting game');
      
      try {
        const current = await MainBingoGame.findById(game._id);
        if (!current || current.status !== 'countdown') return;
        
        current.status = 'in_progress';
        current.startTime = new Date();
        await current.save();
        await MainBingoConfig.findByIdAndUpdate(current.configId, { 
          status: 'in_progress', 
          startedAt: new Date() 
        });
        
        const io = req.app.get('io');
        if (!io) return;
        
        console.log('📡 Emitting mainBingoStarted');
        io.emit('mainBingoStarted', { game: current });
        
        // Start drawing numbers
        const allNumbers = current.allNumbers || [];
        let index = 0;
        const letters = ['B','I','N','G','O'];
        
        const drawInterval = setInterval(async () => {
          // 🔥 Store globally so engine can stop it on BINGO
          if (!global.drawIntervals) global.drawIntervals = {};
          global.drawIntervals[current._id.toString()] = drawInterval;
          
          if (index >= allNumbers.length) {
            clearInterval(drawInterval);
            console.log('🏁 All numbers drawn');
            current.status = 'completed';
            current.endTime = new Date();
            await current.save();
            io.emit('gameEnded', { game: current, winners: [] });
            return;
          }
          
          const num = allNumbers[index];
          const letter = letters[Math.floor((num - 1) / 15)];
          
          console.log(`🎱 Drawing: ${letter}${num} (${index + 1}/75)`);
          
          current.drawnNumbers.push({ number: num, letter: letter, drawnAt: new Date() });
          await current.save();
          
          io.emit('numberDrawn', { number: num, letter: letter });
          index++;
        }, 5000);
        
      } catch (err) {
        console.error('❌ Draw error:', err);
      }
    }, 30000);
    
    res.json({ success: true, message: 'Game starting in 30 seconds' });
    
  } catch (e) {
    console.error('❌ startGame error:', e);
    res.status(400).json({ error: e.message });
  }
};

// 🔥 FIXED: buyCards with correct balance field
exports.buyCards = async (req, res) => {
  try {
    const { quantity } = req.body;
    const game = await MainBingoGame.getActiveGame();
    if (!game || (game.status !== 'setup' && game.status !== 'countdown')) {
      return res.status(400).json({ error: 'Game not available' });
    }
    
    const config = await MainBingoConfig.findById(game.configId);
    const player = game.players.find(p => p.userId.toString() === req.user.id);
    const currentCards = player?.cards.length || 0;
    const maxAllowed = config.maxCardsPerPlayer - currentCards;
    
    if (quantity > maxAllowed) {
      return res.status(400).json({ error: 'Max ' + maxAllowed + ' more cards' });
    }
    
    const totalCost = config.cardPrice * quantity;
    const user = await User.findById(req.user.id);
    
    // 🔥 FIX: Use user.balance instead of user.walletBalance
    if ((user.balance || 0) < totalCost) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    user.balance -= totalCost;
    await user.save();
    
    const cards = [];
    for (let i = 0; i < quantity; i++) {
      const grid = { 
        B: genCol(1,15), 
        I: genCol(16,30), 
        N: genCol(31,45), 
        G: genCol(46,60), 
        O: genCol(61,75) 
      };
      grid.N[2] = { number: 0, isMarked: true };
      const card = await Card.create({ 
        gameId: game._id, 
        userId: req.user.id, 
        cardNumber: game.totalCards + i + 1, 
        grid, 
        price: config.cardPrice 
      });
      cards.push(card);
    }
    
    if (!player) { 
      game.players.push({ userId: req.user.id, cards: cards.map(c => c._id) }); 
    } else { 
      player.cards.push(...cards.map(c => c._id)); 
    }
    game.totalCards += quantity; 
    await game.save();
    
    const io = req.app.get('io'); 
    if (io) io.emit('mainBingoCardsUpdated', { 
      playerCount: game.players.length, 
      totalCards: game.totalCards 
    });
    
    res.json({ 
      success: true, 
      cards, 
      balance: user.balance, // 🔥 Return updated balance
      cardsOwned: currentCards + quantity 
    });
  } catch (e) { 
    res.status(400).json({ error: e.message }); 
  }
};
exports.topupBalance = async (req, res) => {
  try {
    const { amount } = req.body;
    const User = require('../models/User');
    
    const user = await User.findById(req.user.id);
    user.balance = (user.balance || 0) + (amount * 100);
    await user.save();
    
    console.log(`💰 Topup: ${amount} ETB for ${user.phone}, new balance: ${user.balance}`);
    
    res.json({ 
      success: true, 
      balance: user.balance,
      balanceETB: (user.balance / 100).toFixed(2)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// 🔥 FIXED: getState now returns game._id and user's actual cards
exports.getState = async (req, res) => {
  try {
    const game = await MainBingoGame.getActiveGame();
    if (!game) {
      return res.json({ active: false, message: 'No active game' });
    }

    const rule = await MainBingoRule.findById(game.ruleId)
      .select('name description method ruleConfig samples');

    const config = await MainBingoConfig.findById(game.configId);

    const myCards = await Card.find({ 
      gameId: game._id,
      userId: req.user.id 
    });

    const User = require('../models/User');
    const user = await User.findById(req.user.id || req.user._id);

    // 🔥 Count only registered cards as sold
    const registeredCards = await Card.countDocuments({ 
      gameId: game._id, 
      status: 'registered' 
    });

    res.json({
      active: true,
      gameId: game._id,
      game: {
        _id: game._id,
        status: game.status,
        prizeAmount: game.prizeAmount,
        drawnNumbers: game.drawnNumbers || [],
      },
      config: {
        cardPrice: config?.cardPrice || 0,
        maxCardsPerPlayer: config?.maxCardsPerPlayer || 10,
      },
      rule: rule,
      myCards: myCards || [],
      balance: user?.walletBalance || user?.balance || 0,
      totalCards: registeredCards,  // 🔥 Only registered = sold
      playerCount: await Card.distinct('userId', { gameId: game._id, status: 'registered' }).then(r => r.length),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
// server/controllers/mainBingoController.js


// POST /api/main-bingo/register-cards
exports.registerCards = async (req, res) => {
  try {
    const { cardIds } = req.body;
    const game = await MainBingoGame.getActiveGame();
    
    if (!game || (game.status !== 'setup' && game.status !== 'countdown')) {
      return res.status(400).json({ error: 'Game not accepting registrations' });
    }
    
    const config = await MainBingoConfig.findById(game.configId);
    const user = await User.findById(req.user.id);
    
    // Verify cards belong to user and are in preview status
    const cards = await Card.find({ 
      _id: { $in: cardIds }, 
      userId: req.user.id,
      gameId: game._id,
      status: 'preview'
    });
    
    if (cards.length !== cardIds.length) {
      return res.status(400).json({ error: 'Some cards not available for registration' });
    }
    
    const totalCost = config.cardPrice * cards.length;
    
    if ((user.walletBalance || user.balance || 0) < totalCost) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct balance
    if (user.walletBalance !== undefined) {
      user.walletBalance -= totalCost;
    } else {
      user.balance -= totalCost;
    }
    await user.save();
    
    // 🔥 Update cards to registered
    await Card.updateMany(
      { _id: { $in: cardIds } },
      { $set: { status: 'registered' } }
    );
    
    // 🔥 NOW increment totalCards for registered cards only
    game.totalCards = (game.totalCards || 0) + cards.length;
    await game.save();
    
    res.json({ 
      success: true, 
      balance: user.walletBalance || user.balance,
      registeredCount: cards.length 
    });
    
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};


exports.pickCards = async (req, res) => {
  try {
    const { quantity } = req.body;
    console.log('🎫 PICK REQUEST:', { quantity, userId: req.user.id });
    
    const game = await MainBingoGame.getActiveGame();
    console.log('🎫 Game found:', game ? { id: game._id, status: game.status } : 'NO GAME');
    
    if (!game || (game.status !== 'setup' && game.status !== 'countdown')) {
      console.log('🎫 REJECTED: Game not available');
      return res.status(400).json({ error: 'Game not available' });
    }
    
    const config = await MainBingoConfig.findById(game.configId);
    console.log('🎫 Config:', { maxCards: config?.maxCardsPerPlayer, cardPrice: config?.cardPrice });
    
    const player = game.players.find(p => p.userId.toString() === req.user.id);
    const currentCards = player?.cards.length || 0;
    const maxAllowed = config.maxCardsPerPlayer - currentCards;
    
    console.log('🎫 Player cards:', currentCards, 'Max allowed:', maxAllowed);
    
    if (quantity > maxAllowed) {
      console.log('🎫 REJECTED: Exceeds limit');
      return res.status(400).json({ error: `Max ${maxAllowed} more cards. You have ${currentCards}/${config.maxCardsPerPlayer}` });
    }
    
    // Check pool
    const availableCards = await Card.find({ gameId: null, userId: null });
    console.log('🎫 Pool available:', availableCards.length);
    
    if (availableCards.length < quantity) {
      console.log('🎫 REJECTED: Not enough in pool');
      return res.status(400).json({ error: `Only ${availableCards.length} cards left in pool` });
    }

    // 🔥 SHUFFLE AND PICK
    const shuffled = [...availableCards].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, quantity);
    const cardIds = selected.map(c => c._id);
    
    console.log('🎫 Picked display IDs:', selected.map(c => c.displayId));
    
    // Assign cards to user and game
    await Card.updateMany(
      { _id: { $in: cardIds } },
      { 
        $set: { 
          gameId: game._id,
          userId: req.user.id,
          status: 'preview'
        } 
      }
    );
    
    // Get updated cards
    const cards = await Card.find({ _id: { $in: cardIds } });
    
    // Update game players
    if (!player) { 
      game.players.push({ userId: req.user.id, cards: cardIds }); 
    } else { 
      player.cards.push(...cardIds); 
    }
    await game.save();
    
    console.log('🎫 SUCCESS: Picked', cards.length, 'cards');
    
    res.json({ 
      success: true, 
      cards, 
      cardsOwned: currentCards + quantity 
    });
    
  } catch (e) {
    console.error('🎫 PICK ERROR:', e);
    res.status(400).json({ error: e.message });
  }
};

// Helper to get next display ID
async function getNextDisplayId() {
  const Card = require('../models/Card');
  const lastCard = await Card.findOne({ displayId: { $exists: true } })
    .sort({ displayId: -1 })
    .select('displayId');
  return (lastCard?.displayId || 1000) + 1;
}

exports.getMonitor = async (req, res) => {
  const game = await MainBingoGame.getActiveGame();
  if (!game) return res.json({ active: false });
  
  const config = await MainBingoConfig.findById(game.configId).populate('ruleId');
  
  // 🔥 Count ONLY registered cards (not preview)
  const totalPicked = await Card.countDocuments({ gameId: game._id });
  const registeredCards = await Card.countDocuments({ 
    gameId: game._id, 
    status: 'registered' 
  });
  
  // Count unique players with registered cards
  const registeredPlayers = await Card.distinct('userId', { 
    gameId: game._id, 
    status: 'registered' 
  });
  
  res.json({ 
    active: true, 
    game, 
    config, 
    rule: config?.ruleId, 
    totalPicked: totalPicked,        // All picked (preview)
    totalSold: registeredCards,       // Only registered (sold)
    playerCount: registeredPlayers.length,
    totalCards: game.totalCards 
  });
};
function genCol(min, max) { 
  const s = new Set(); 
  while (s.size < 5) s.add(Math.floor(Math.random() * (max - min + 1)) + min); 
  return Array.from(s).map(n => ({ number: n, isMarked: false })); 
}